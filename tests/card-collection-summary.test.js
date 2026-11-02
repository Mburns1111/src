import test from "node:test";
import assert from "node:assert/strict";
import { COLLECTION_RARITIES, formatCardCollectionSummary } from "../services/card-collection-summary.js";

test("card collection displays all five official rarities and upgrade counts", () => {
  const result = formatCardCollectionSummary({
    total: 4,
    rarity: { Common: 2, Uncommon: 0, Rare: 1, "Ultra-Rare": 0, Legendary: 1 },
    upgrade: { normal: 4, neon: 0, mega: 0 },
  });
  for (const rarity of COLLECTION_RARITIES) assert.ok(result.includes(rarity + ":"));
  assert.match(result, /4 cards/);
  assert.match(result, /Normal: \*\*4\*\*/);
  assert.match(result, /Neon: \*\*0\*\*/);
  assert.match(result, /Mega Neon: \*\*0\*\*/);
  assert.doesNotMatch(result, /first 200/);
});
test("empty collection and unknown rarity remain understandable", () => {
  const result = formatCardCollectionSummary({ total: 1, rarity: { Unknown: 1 }, upgrade: { normal: 1 } });
  assert.match(result, /Unknown: \*\*1\*\*/);
  assert.match(result, /Common: \*\*0\*\*/);
});
