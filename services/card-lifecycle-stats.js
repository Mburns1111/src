import CardLifecycleEvent from "../models/CardLifecycleEvent.js";

// Historical actions are recorded separately from currently owned card copies.
// Only actual, committed events count; planned upgrades/burns count as zero.
export async function getCardLifecycleStats(cardDefinitionId) {
  if (!cardDefinitionId) throw new Error("Card definition required");
  const [burned, upgradedToNeon, upgradedToMega] = await Promise.all([
    CardLifecycleEvent.countDocuments({ cardDefinitionId, eventType: "burn" }),
    CardLifecycleEvent.countDocuments({ cardDefinitionId, eventType: "upgrade", targetUpgradeLevel: "neon" }),
    CardLifecycleEvent.countDocuments({ cardDefinitionId, eventType: "upgrade", targetUpgradeLevel: "mega" }),
  ]);
  return { burned, upgradedToNeon, upgradedToMega };
}
