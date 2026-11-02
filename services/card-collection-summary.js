import CardCopy from "../models/CardCopy.js";
import CardClaim from "../models/CardClaim.js";
import CardDefinition from "../models/CardDefinition.js";
import PetCatalog from "../models/PetCatalog.js";
import { displayCardId, upgradeLabel } from "./card-identifiers.js";
import { selectOwnedTagTargets } from "./card-tag-targets.js";
import { normalizeCardTag, tagKey, requireSavedCardTag } from "./card-tag-catalog.js";
export { normalizeCardTag } from "./card-tag-catalog.js";

export const COLLECTION_RARITIES = Object.freeze(["Common", "Uncommon", "Rare", "Ultra-Rare", "Legendary"]);
export const COLLECTION_UPGRADES = Object.freeze(["normal", "neon", "mega"]);
export async function updateOwnedCardTag({ discordUserId, cardId, tag }) {
  const target = await selectOwnedTagTargets(discordUserId, cardId);
  const normalized = tag === null ? "" : await requireSavedCardTag(discordUserId, tag);
  const ids = target.cards.map(copy => copy._id);
  const filter = { _id: { $in: ids }, ownerDiscordUserId: discordUserId, state: "owned" };
  const result = await CardCopy.updateMany(filter, { $set: { tag: normalized } },
    { runValidators: true });
  if (result.matchedCount !== ids.length)
    throw new Error("Your collection changed during tagging. Please check the affected cards.");

  const copy = target.cards[0];
  const definition = await CardDefinition.findById(copy.cardDefinitionId).select("petId rarity").lean();
  const pet = definition && await PetCatalog.findOne({ petId: definition.petId }).select("name").lean();
  return {
    id: displayCardId(copy),
    name: target.name || pet?.name || definition?.petId || "Unknown pet",
    rarity: definition?.rarity || "Unknown",
    upgradeLevel: copy.upgradeLevel,
    tag: normalized,
    count: ids.length,
    changed: result.modifiedCount,
    mode: target.mode,
  };
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
      id: displayCardId(copy),
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
    `${i + 1}. **${safe(card.name)}** · ${safe(card.rarity)} · ${upgradeLabel(card.upgradeLevel)}${card.owned ? "" : " · No longer owned"}`,
    `   ID: \`${card.id}\`${card.tag ? ` · Tag: **${safe(card.tag)}**` : ""}`,
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
    "*Use /cards tag or /cards untag. Card ID is optional; tags target your newest owned card (including upgrades). Full gallery and trading are coming next.*",
  ].join("\n");
}
