import mongoose from "mongoose";
import CardSeries from "../models/CardSeries.js";
import CardRelease from "../models/CardRelease.js";
import { validCardArtistUrl } from "./card-artist-links.js";
import CardDefinition from "../models/CardDefinition.js";
import PetCatalog from "../models/PetCatalog.js";
import CardArtwork from "../models/CardArtwork.js";
import CardEggArtwork from "../models/CardEggArtwork.js";
import { freezeAchievementRelease } from "./card-achievement-engine.js";
import { CARD_RARITIES, DEFAULT_HATCH_ODDS, validateHatchOdds } from "./card-hatch-engine.js";

// A series, release, and definition are global across all guilds.
// No guild-specific copy or print limit is created here.
export function releaseId(value) {
  const id = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id))
    throw new Error("ID must be 2–64 lowercase letters, digits, or hyphens.");
  return id;
}
export function releaseName(value) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 90 || /[<>@]/.test(name))
    throw new Error("Names must be 1–90 characters, without mentions or angle brackets.");
  return name;
}
export function hatchWeight(value) {
  const weight = Number(value);
  if (!Number.isFinite(weight) || weight < 0 || weight > 10000)
    throw new Error("Hatch weight must be between 0 and 10,000.");
  return weight;
}
export function releaseOdds(value) {
  const odds = Object.fromEntries(CARD_RARITIES.map(rarity => [rarity, Number(value?.[rarity])]));
  validateHatchOdds(odds);
  return odds;
}
export function requireDraft(release) {
  if (!release) throw new Error("That global release does not exist or is not editable.");
  if (release.status !== "draft") throw new Error("Only draft releases can be edited. Active and retired releases are locked.");
  return release;
}
export async function createSeries({ seriesId, name }) {
  const id = releaseId(seriesId), title = releaseName(name);
  try {
    const item = await CardSeries.create({ seriesId: id, name: title, status: "draft" });
    return { id: item.seriesId, name: item.name };
  } catch (error) {
    if (error?.code === 11000) throw new Error("A series with that ID already exists.");
    throw error;
  }
}
export async function createRelease({ seriesId, releaseId: requestedId, name, eggName }) {
  const id = releaseId(requestedId), sid = releaseId(seriesId);
  const title = releaseName(name), egg = releaseName(eggName);
  const series = await CardSeries.findOne({ seriesId: sid }).lean();
  if (!series) throw new Error("Create the series first using create-series.");
  if (series.status === "retired") throw new Error("The series is retired.");
  if (await CardRelease.exists({ releaseId: id })) throw new Error("This release ID already exists.");
  try {
    const created = await CardRelease.create({
      seriesId: sid, releaseId: id, name: title, eggName: egg,
      status: "draft", hatchOdds: { ...DEFAULT_HATCH_ODDS },
    });
    return { id: created.releaseId, name: created.name, seriesId: created.seriesId, status: created.status };
  } catch (error) {
    if (error?.code === 11000) throw new Error("This release ID was already created.");
    throw error;
  }
}
export async function editRelease({ releaseId: requestedId, name, eggName }) {
  const id = releaseId(requestedId);
  const fields = {};
  if (name !== undefined && name !== null && String(name).trim()) fields.name = releaseName(name);
  if (eggName !== undefined && eggName !== null && String(eggName).trim()) fields.eggName = releaseName(eggName);
  if (!Object.keys(fields).length) throw new Error("Provide a new release name or egg name.");
  const updated = await CardRelease.findOneAndUpdate({ releaseId: id, status: "draft" },
    { $set: fields }, { new: true, runValidators: true }).lean();
  return requireDraft(updated);
}
// Accept a full exact pet name or canonical ID; never guess a partial match.
export async function findCatalogPet(reference) {
  const text = String(reference ?? "").trim();
  if (!text || text.length > 120) throw new Error("Enter a pet name or catalog ID.");
  const asId = text.toLowerCase();
  if (/^[a-z0-9][a-z0-9-]{1,63}$/.test(asId)) {
    const found = await PetCatalog.findOne({ petId: asId }).lean();
    if (found) return found;
  }
  const escaped = text.replace(/[^\p{L}\p{N} ]/gu, "\\$&");
  const matches = await PetCatalog.find({ name: new RegExp("^" + escaped + "$", "i") })
    .limit(2).lean();
  if (matches.length > 1) throw new Error("More than one pet has that name. Use its canonical pet ID.");
  if (!matches.length) throw new Error("Pet not found in the master catalog.");
  return matches[0];
}

export async function addReleasePet({ releaseId: requestedId, petId, weight = 1 }) {
  const id = releaseId(requestedId), selectedWeight = hatchWeight(weight);
  const current = requireDraft(await CardRelease.findOne({ releaseId: id }).lean());
  const pet = await findCatalogPet(petId);
  const pid = pet.petId;
  if (!CARD_RARITIES.includes(pet.rarity))
    throw new Error("This pet has an unresolved official rarity.");
  if (!await CardRelease.exists({ releaseId: id, status: "draft" }))
    throw new Error("This release is no longer a draft.");
  try {
    await CardDefinition.create({
      seriesId: current.seriesId, releaseId: id, petId: pid, rarity: pet.rarity,
      hatchWeight: selectedWeight, enabled: false, artStatus: "missing",
    });
  } catch (error) {
    if (error?.code === 11000) throw new Error("This pet already belongs to this release.");
    throw error;
  }
  return { releaseId: id, petName: pet.name, petId: pid, rarity: pet.rarity, weight: selectedWeight };
}
export function parseReleasePetBatch(value) {
  const refs = String(value ?? "").split(/[,\n]+/).map(part => part.trim()).filter(Boolean);
  if (!refs.length || refs.length > 100)
    throw new Error("Enter 1–100 pet IDs or exact names, separated by commas or new lines.");
  if (refs.some(ref => ref.length > 120))
    throw new Error("A pet name or ID is too long.");
  return refs;
}

// All-or-nothing bulk assignment: never leave half of a 100-pet roster added.
export async function addReleasePetsBulk({ releaseId: requestedId, pets }) {
  const id = releaseId(requestedId);
  const refs = parseReleasePetBatch(pets);
  const release = requireDraft(await CardRelease.findOne({ releaseId: id }).lean());
  const resolved = await Promise.all(refs.map(findCatalogPet));
  const unique = new Set(resolved.map(pet => pet.petId));
  if (unique.size !== resolved.length)
    throw new Error("Some pets are listed more than once; remove duplicates before importing.");
  const unknown = resolved.find(pet => !CARD_RARITIES.includes(pet.rarity));
  if (unknown) throw new Error("Unresolved rarity for " + unknown.name + ". No pets were added.");
  const documents = resolved.map(pet => ({
    seriesId: release.seriesId, releaseId: id, petId: pet.petId,
    rarity: pet.rarity, hatchWeight: 1, artStatus: "missing", enabled: false,
  }));
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const stillDraft = await CardRelease.findOne({ releaseId: id, status: "draft" }).session(session).lean();
      if (!stillDraft) throw new Error("This release is no longer a draft.");
      const existing = await CardDefinition.find({
        releaseId: id, petId: { $in: resolved.map(pet => pet.petId) },
      }).session(session).lean();
      if (existing.length)
        throw new Error("One or more pets are already assigned to this release. No pets were added.");
      await CardDefinition.insertMany(documents, { session, ordered: true });
    });
  } catch (error) {
    if (error?.code === 11000)
      throw new Error("Some pets already belong to this release. No pets were added.");
    throw error;
  } finally {
    await session.endSession();
  }
  return { releaseId: id, added: documents.length };
}

export async function removeReleasePet({ releaseId: requestedId, petId }) {
  const id = releaseId(requestedId), pid = releaseId(petId);
  requireDraft(await CardRelease.findOne({ releaseId: id }).lean());
  const result = await CardDefinition.deleteOne({ releaseId: id, petId: pid,
    enabled: false, artStatus: { $in: ["missing", "pending"] } });
  if (!result.deletedCount)
    throw new Error("Only unapproved, disabled draft pets can be removed; assigned art is protected.");
  return { releaseId: id, petId: pid };
}
/** Owner records the exact original artwork page for a draft pet.
 * Does not approve the artist's license or enable the card.
 */
export async function setReleasePetArtSource({ releaseId: requestedId, petId, sourceUrl }) {
  const id = releaseId(requestedId), pid = releaseId(petId);
  requireDraft(await CardRelease.findOne({ releaseId: id }).lean());
  const url = validCardArtistUrl(sourceUrl);
  if (!url) throw Error("Provide a valid HTTPS original-artwork link.");
  const updated = await CardDefinition.findOneAndUpdate(
    { releaseId: id, petId: pid },
    { $set: { artSourceUrl: url } }, { new: true, runValidators: true },
  ).lean();
  if (!updated) throw Error("That pet is not assigned to this draft release.");
  return { releaseId: id, petId: pid, sourceUrl: url };
}

export async function setReleasePetWeight({ releaseId: requestedId, petId, weight }) {
  const id = releaseId(requestedId), pid = releaseId(petId), selectedWeight = hatchWeight(weight);
  requireDraft(await CardRelease.findOne({ releaseId: id }).lean());
  const updated = await CardDefinition.findOneAndUpdate({ releaseId: id, petId: pid },
    { $set: { hatchWeight: selectedWeight } }, { new: true, runValidators: true }).lean();
  if (!updated) throw new Error("That pet is not assigned to the release.");
  return { releaseId: id, petId: pid, weight: selectedWeight };
}
export async function setReleaseOdds({ releaseId: requestedId, odds }) {
  const id = releaseId(requestedId), verified = releaseOdds(odds);
  const updated = await CardRelease.findOneAndUpdate({ releaseId: id, status: "draft" },
    { $set: { hatchOdds: verified } }, { new: true, runValidators: true }).lean();
  return requireDraft(updated);
}
export async function checkRelease({ releaseId: requestedId }) {
  const id = releaseId(requestedId);
  const release = await CardRelease.findOne({ releaseId: id }).lean();
  if (!release) throw new Error("That release does not exist.");
  const cards = await CardDefinition.find({ releaseId: id }).lean();
  const problems = [];
  if (!cards.length) problems.push("No pets assigned.");
  try { releaseOdds(release.hatchOdds); }
  catch { problems.push("Rarity odds must total 100%."); }
  const usable = cards.filter(card => card.enabled && card.artStatus === "approved" && card.hatchWeight > 0);
  if (!usable.length) problems.push("No enabled cards with approved artwork and positive weight.");
  for (const rarity of CARD_RARITIES) {
    if (Number(release.hatchOdds?.[rarity]) > 0 && !usable.some(card => card.rarity === rarity))
      problems.push(rarity + " has no hatchable cards; its odds would be redistributed.");
  }
  return { release, pets: cards.length, usable: usable.length, problems };
}


// Only owner-approved artwork may be attached to a draft official release.
// The pet is enabled in a separate explicit step after its art is reviewed.
export async function assignReleaseArtwork({ releaseId: requestedId, kind, key, petId }) {
  const id = releaseId(requestedId);
  requireDraft(await CardRelease.findOne({ releaseId: id }).lean());
  if (id.startsWith("test-")) throw Error("Use the dedicated test-artwork tools for test releases.");
  if (!["pet","background","frame"].includes(kind)) throw Error("Artwork kind must be pet, background or frame.");
  const artwork = await CardArtwork.findOne({ key: String(key).trim().toLowerCase(), kind, licenseReviewStatus: "approved" }).lean();
  if (!artwork) throw Error("Only artwork with an approved license review may be assigned.");
  if (kind === "pet") {
    if (!petId || !artwork.artistCredit) throw Error("Pet artwork requires a pet and artist credit.");
    const selected = await CardDefinition.updateOne({ releaseId: id, petId: String(petId).trim(), artStatus: { $ne: "test-placeholder" } },
      { $set: { petArtworkKey: artwork.key, artistCredit: artwork.artistCredit, artStatus: "approved" } });
    if (selected.modifiedCount !== 1) throw Error("That draft pet was not updated. Check its ID and current artwork.");
  } else {
    if (petId) throw Error("Background/frame artwork is release-wide; omit the pet.");
    const field = kind === "background" ? "cardBackgroundKey" : "cardFrameKey";
    const updated = await CardRelease.updateOne({ releaseId: id, status: "draft" }, { $set: { [field]: artwork.key } });
    if (updated.modifiedCount !== 1) throw Error("That draft release was not updated.");
  }
  return { releaseId: id, key: artwork.key, kind, petId: petId || "" };
}

export async function setReleasePetEnabled({ releaseId: requestedId, petId, enabled }) {
  const id = releaseId(requestedId);
  requireDraft(await CardRelease.findOne({ releaseId: id }).lean());
  if (typeof enabled !== "boolean") throw Error("Choose enabled or disabled.");
  const card = await CardDefinition.findOne({ releaseId: id, petId: String(petId).trim() }).lean();
  if (!card) throw Error("That pet is not in the draft release.");
  if (enabled) {
    if (card.artStatus !== "approved" || !card.petArtworkKey || !card.artistCredit)
      throw Error("Approve and assign credited pet artwork before enabling this card.");
    if (!await CardArtwork.exists({ key: card.petArtworkKey, kind: "pet", licenseReviewStatus: "approved" }))
      throw Error("The pet's artwork license is not approved.");
  }
  await CardDefinition.updateOne({ _id: card._id, releaseId: id }, { $set: { enabled } });
  return { releaseId: id, petId: card.petId, enabled };
}

// More stringent than a draft hatch-odds check: this is the official launch gate.
export async function checkOfficialReleaseReadiness({ releaseId: requestedId }) {
  const base = await checkRelease({ releaseId: requestedId });
  const { release } = base;
  const problems = [...base.problems];
  if (release.releaseId.startsWith("test-")) problems.push("Test releases cannot be launched as official releases.");
  if (!release.eggImageFileId) problems.push("Official egg artwork must be uploaded to MongoDB.");
  else if (!await CardEggArtwork.exists({releaseId:release.releaseId,licenseReviewStatus:"approved",fileId:release.eggImageFileId}))
    problems.push("Official egg artwork has not passed its source/license review.");
  const activeDefs = await CardDefinition.find({
    releaseId: release.releaseId, enabled: true, artStatus: "approved", hatchWeight: { $gt: 0 },
  }).lean();
  const keys = [
    ...activeDefs.map(d => d.petArtworkKey).filter(Boolean),
    release.cardBackgroundKey, release.cardFrameKey,
    ...Object.values(release.cardRarityFrameKeys || {}),
    ...Object.values(release.cardStageOverlayKeys || {}),
  ].filter(Boolean);
  const assets = keys.length ? await CardArtwork.find({ key: { $in: [...new Set(keys)] } }).lean() : [];
  const approved = new Map(assets.map(asset => [asset.key, asset]));
  for (const card of activeDefs) {
    const asset = approved.get(card.petArtworkKey);
    if (!card.petArtworkKey || !card.artistCredit || !asset || asset.kind !== "pet" || asset.licenseReviewStatus !== "approved")
      problems.push("Missing approved, credited pet artwork: " + card.petId);
  }
  const sharedArtwork = [
    [release.cardBackgroundKey, "background"],
    [release.cardFrameKey, "frame"],
    ...Object.values(release.cardRarityFrameKeys || {}).map(key => [key, "frame"]),
    ...Object.values(release.cardStageOverlayKeys || {}).map(key => [key, "frame"]),
  ];
  for (const [key, kind] of sharedArtwork) {
    if (key && (approved.get(key)?.kind !== kind || approved.get(key)?.licenseReviewStatus !== "approved"))
      problems.push("Release " + kind + " art must be license-approved: " + key);
  }
  const secrets = release.achievementSecrets || [];
  if (secrets.length < 6 || ["basic","medium","advanced"].some(tier => secrets.filter(secret => secret.tier === tier).length < 2))
    problems.push("Configure six private egg achievements (at least two per tier) before activation.");
  return { ...base, problems };
}

export async function activateRelease({ releaseId: requestedId }) {
  const id = releaseId(requestedId);
  const check = await checkOfficialReleaseReadiness({ releaseId: id });
  if (check.release.status !== "draft") throw Error("Only draft releases may be activated.");
  if (check.problems.length) throw Error("Release not ready: " + check.problems.join(" | "));
  const session = await mongoose.startSession();
  try {
    let updated;
    await session.withTransaction(async () => {
      updated = await CardRelease.findOneAndUpdate({ releaseId: id, status: "draft" },
        { $set: { status: "active" } }, { session, new: true });
      if (!updated) throw Error("Release status changed before activation.");
      await freezeAchievementRelease(id, session);
    });
    return { releaseId: id, status: "active" };
  } finally { await session.endSession(); }
}

export async function transitionRelease({ releaseId: requestedId, action }) {
  const id = releaseId(requestedId);
  const moves = {
    pause: { from: "active", to: "paused" },
    resume: { from: "paused", to: "active" },
    retire: { from: ["active","paused"], to: "retired" },
  };
  const move = moves[action];
  if (!move) throw Error("Invalid release transition.");
  const source = Array.isArray(move.from) ? { $in: move.from } : move.from;
  const updated = await CardRelease.findOneAndUpdate({ releaseId: id, status: source },
    { $set: { status: move.to } }, { new: true }).lean();
  if (!updated) throw Error("Release is not in a state that allows " + action + ". Retired eggs cannot be restarted.");
  return { releaseId: id, status: updated.status };
}
