import CardSeries from "../models/CardSeries.js";
import CardRelease from "../models/CardRelease.js";
import CardDefinition from "../models/CardDefinition.js";
import PetCatalog from "../models/PetCatalog.js";
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
  const escaped = text.replace(/[^\p{L}\p{N} ]/gu, "\\export async function addReleasePet({ releaseId: requestedId, petId, weight = 1 }) {");
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
export async function removeReleasePet({ releaseId: requestedId, petId }) {
  const id = releaseId(requestedId), pid = releaseId(petId);
  requireDraft(await CardRelease.findOne({ releaseId: id }).lean());
  const result = await CardDefinition.deleteOne({ releaseId: id, petId: pid,
    enabled: false, artStatus: { $in: ["missing", "pending"] } });
  if (!result.deletedCount)
    throw new Error("Only unapproved, disabled draft pets can be removed; assigned art is protected.");
  return { releaseId: id, petId: pid };
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
