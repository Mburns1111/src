import mongoose from "mongoose";
import CardCopy from "../models/CardCopy.js";
import CardClaim from "../models/CardClaim.js";
import CardDefinition from "../models/CardDefinition.js";
import PetCatalog from "../models/PetCatalog.js";

export const COLLECTION_RARITIES = Object.freeze(["Common", "Uncommon", "Rare", "Ultra-Rare", "Legendary"]);
export const COLLECTION_UPGRADES = Object.freeze(["normal", "neon", "mega"]);
export const MAX_CARD_TAG_LENGTH = 32;

export function normalizeCardTag(value) {
  const tag = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!tag || tag.length > MAX_CARD_TAG_LENGTH || !/^[\p{L}\p{N} _-]+$/u.test(tag)) {
    throw new Error("Tags must be 1–32 characters using letters, numbers, spaces, - or _.");
  }
  return tag;
}

export async function updateOwnedCardTag({ discordUserId, cardId, tag }) {
  // Default to the most recent *awarded* grab, not an in-progress reservation.
  // If it was traded or consumed, report that instead of silently tagging an older card.
  let targetId = cardId;
  if (!targetId) {
    const lastGrab = await CardClaim.findOne({ discordUserId })
      .sort({ createdAt: -1, _id: -1 }).select("cardCopyId").lean();
    if (!lastGrab) throw new Error("You haven't collected a card yet. Grab a card first or enter a card ID.");
    targetId = lastGrab.cardCopyId;
  }
  if (!mongoose.isValidObjectId(targetId)) throw new Error("Enter a valid card ID from your collection.");
  const normalized = tag === null ? "" : normalizeCardTag(tag);
  const card = await CardCopy.findOneAndUpdate(
    { _id: targetId, ownerDiscordUserId: discordUserId, state: "owned" },
    { $set: { tag: normalized } },
    { returnDocument: "after", runValidators: true },
  );
  if (!card) throw new Error("That card is no longer in your owned collection. Enter the ID of a card you currently own.");
  return { id: String(card._id), tag: card.tag };
}

export async function getCardCollectionSummary(discordUserId) {
  // Full collection counts, plus the five most recent settled grabs.
  // Claims are ordered by acquisition, not alphabetically by pet.
  const groups = await CardCopy.aggregate([
    { $match: { ownerDiscordUserId: discordUserId, state: "owned" } },
    { $lookup: {
      from: CardDefinition.collection.name, localField: "cardDefinitionId",
      foreignField: "_id", as: "definition",
    } },
    { $unwind: { path: "$definition", preserveNullAndEmptyArrays: true } },
    { $group: {
      _id: { rarity: { $ifNull: ["$definition.rarity", "Unknown"] }, upgrade: "$upgradeLevel" },
      count: { $sum: 1 },
    } },
  ]);
  const rarity = Object.fromEntries([...COLLECTION_RARITIES, "Unknown"].map(r => [r, 0]));
  const upgrade = Object.fromEntries(COLLECTION_UPGRADES.map(v => [v, 0]));
  let total = 0;
  for (const group of groups) {
    const n = group.count;
    total += n;
    rarity[group._id.rarity] = (rarity[group._id.rarity] ?? 0) + n;
    upgrade[group._id.upgrade] = (upgrade[group._id.upgrade] ?? 0) + n;
  }

  const claims = await CardClaim.find({ discordUserId })
    .sort({ createdAt: -1, _id: -1 }).limit(5).lean();
  const copies = await CardCopy.find({ _id: { $in: claims.map(c => c.cardCopyId) } }).lean();
  const copyById = new Map(copies.map(copy => [String(copy._id), copy]));
  const definitions = await CardDefinition.find({
    _id: { $in: copies.map(copy => copy.cardDefinitionId) },
  }).select("petId rarity releaseId").lean();
  const definitionById = new Map(definitions.map(d => [String(d._id), d]));
  const pets = await PetCatalog.find({
    petId: { $in: definitions.map(d => d.petId) },
  }).select("petId name").lean();
  const petNames = new Map(pets.map(p => [p.petId, p.name]));
  const recent = claims.map(claim => {
    const copy = copyById.get(String(claim.cardCopyId));
    const def = copy && definitionById.get(String(copy.cardDefinitionId));
    return {
      id: String(claim.cardCopyId),
      name: petNames.get(def?.petId) || def?.petId || "Unknown pet",
      rarity: def?.rarity || "Unknown",
      upgradeLevel: copy?.upgradeLevel || "normal",
      tag: copy?.tag || "",
      owned: copy?.ownerDiscordUserId === discordUserId && copy?.state === "owned",
      acquiredAt: claim.createdAt,
    };
  });
  return { total, rarity, upgrade, recent };
}

export function formatCardCollectionSummary({ total, rarity, upgrade, recent = [] }) {
  const safe = value => String(value).replace(/[`*_~|<>@]/g, "");
  const recentLines = recent.length ? recent.flatMap((card, i) => [
    `${i + 1}. **${safe(card.name)}** · ${safe(card.rarity)} · ${card.upgradeLevel === "mega" ? "Mega Neon" : card.upgradeLevel === "neon" ? "Neon" : "Normal"}${card.owned ? "" : " · No longer owned"}`,
    `   ID: \`${safe(card.id)}\`${card.tag ? ` · Tag: **${safe(card.tag)}**` : ""}`,
  ]) : ["No cards grabbed yet."];
  return [
    `**Your Card Collection — ${total} cards**`,
    "",
    "**By rarity**",
    ...COLLECTION_RARITIES.map(r => `${r}: **${rarity[r] ?? 0}**`),
    ...(rarity.Unknown ? [`Unknown: **${rarity.Unknown}**`] : []),
    "",
    "**By upgrade**",
    `Normal: **${upgrade.normal ?? 0}** · Neon: **${upgrade.neon ?? 0}** · Mega Neon: **${upgrade.mega ?? 0}**`,
    "",
    "**Last 5 grabbed cards**",
    ...recentLines,
    "",
    "*Use /cards tag or /cards untag. Card ID is optional and defaults to your last grabbed card. Full gallery and trading are coming next.*",
  ].join("\n");
}
