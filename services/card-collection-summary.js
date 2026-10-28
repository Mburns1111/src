import CardCopy from "../models/CardCopy.js";
import CardDefinition from "../models/CardDefinition.js";

export const COLLECTION_RARITIES = Object.freeze(["Common", "Uncommon", "Rare", "Ultra-Rare", "Legendary"]);
export const COLLECTION_UPGRADES = Object.freeze(["normal", "neon", "mega"]);

export async function getCardCollectionSummary(discordUserId) {
  // Count the complete owned collection, rather than displaying just 200 cards.
  // Rarity belongs to the definition; upgrade level belongs to each owned copy.
  const groups = await CardCopy.aggregate([
    { $match: { ownerDiscordUserId: discordUserId, state: "owned" } },
    { $lookup: {
      from: CardDefinition.collection.name,
      localField: "cardDefinitionId",
      foreignField: "_id",
      as: "definition",
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
  return { total, rarity, upgrade };
}

export function formatCardCollectionSummary({ total, rarity, upgrade }) {
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
    "*Full card gallery and filtering are coming next.*",
  ].join("\n");
}
