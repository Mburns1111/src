// Pure functions: no Discord, MongoDB, or user data dependencies.
export const CARD_RARITIES = Object.freeze(["Common", "Uncommon", "Rare", "Ultra-Rare", "Legendary"]);
export const DEFAULT_HATCH_ODDS = Object.freeze({
  Common: 26, Uncommon: 26, Rare: 26, "Ultra-Rare": 14, Legendary: 8,
});

export function validateHatchOdds(odds) {
  if (!odds || typeof odds !== "object") throw new Error("Hatch odds are required");
  const total = CARD_RARITIES.reduce((sum, rarity) => {
    const percent = odds[rarity];
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error(`Invalid hatch odds for ${rarity}`);
    return sum + percent;
  }, 0);
  if (Math.abs(total - 100) > 1e-8) throw new Error("Hatch odds must total 100%");
  return odds;
}

function chooseWeighted(items, getWeight, random) {
  const weighted = items.map(item => ({ item, weight: getWeight(item) }));
  for (const entry of weighted) {
    if (!Number.isFinite(entry.weight) || entry.weight < 0) throw new Error("Invalid hatch weight");
  }
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (!(total > 0)) throw new Error("No eligible card with positive hatch weight");
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("Random value must be between 0 (inclusive) and 1 (exclusive)");
  let roll = value * total;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll < 0) return entry.item;
  }
  return weighted[weighted.length - 1].item;
}

// Each eligible card is an approved, active design from ONE release.
// Weight is an administrator-reviewed game value, not an automatic live trade-site feed.
export function hatchCard({ cards, odds = DEFAULT_HATCH_ODDS, random = Math.random, allowTestPlaceholders = false }) {
  validateHatchOdds(odds);
  if (!Array.isArray(cards)) throw new Error("Cards must be an array");
  const eligible = cards.filter(card => card?.enabled === true && (card?.artStatus === "approved" || (allowTestPlaceholders && card?.artStatus === "test-placeholder")) && CARD_RARITIES.includes(card.rarity));
  const groups = new Map(CARD_RARITIES.map(rarity => [rarity, eligible.filter(card => card.rarity === rarity)]));
  // Rarity percentages are renormalized when a release has no approved cards for a rarity.
  const possibleRarities = CARD_RARITIES.filter(rarity => groups.get(rarity).some(card => card.hatchWeight > 0) && odds[rarity] > 0);
  if (!possibleRarities.length) throw new Error("Release has no hatchable cards");
  const rarity = chooseWeighted(possibleRarities, value => odds[value], random);
  const card = chooseWeighted(groups.get(rarity), value => value.hatchWeight ?? 0, random);
  return { rarity, card };
}

export function revealDrop({ cards, odds = DEFAULT_HATCH_ODDS, random = Math.random, count = 3, allowTestPlaceholders = false }) {
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("Invalid drop card count");
  // Duplicates are allowed: they are required for upgrades and dust.
  return Array.from({ length: count }, () => hatchCard({ cards, odds, random, allowTestPlaceholders }));
}
