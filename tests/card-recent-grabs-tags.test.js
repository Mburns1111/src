import test from "node:test";
import assert from "node:assert/strict";
import CardCopy from "../models/CardCopy.js";
import { formatCardCollectionSummary, normalizeCardTag } from "../services/card-collection-summary.js";

test("recent grabs include unique card ids, rarity, tier and optional tag", () => {
  const result = formatCardCollectionSummary({
    total: 2,
    rarity: { Common: 1, Uncommon: 0, Rare: 0, "Ultra-Rare": 0, Legendary: 1 },
    upgrade: { normal: 2, neon: 0, mega: 0 },
    recent: [
      { id: "507f1f77bcf86cd799439011", name: "Shadow Dragon", rarity: "Legendary",
        upgradeLevel: "normal", tag: "Favorite", owned: true },
      { id: "507f1f77bcf86cd799439012", name: "Cat", rarity: "Common",
        upgradeLevel: "normal", tag: "", owned: true },
    ],
  });
  assert.match(result, /Last 5 grabbed cards/);
  assert.match(result, /507f1f77bcf86cd799439011/);
  assert.match(result, /Shadow Dragon.*Legendary.*Normal/);
  assert.match(result, /Tag: \*\*Favorite\*\*/);
  assert.match(result, /507f1f77bcf86cd799439012/);
  assert.equal((result.match(/ID:/g) || []).length, 2);
});
test("tag rules reject Discord formatting and accept readable labels", () => {
  assert.equal(normalizeCardTag("  My   Favorite  "), "My Favorite");
  assert.throws(() => normalizeCardTag("@everyone"), /Tags must/);
  assert.throws(() => normalizeCardTag("a".repeat(33)), /Tags must/);
  assert.throws(() => normalizeCardTag(""), /Tags must/);
  assert.ok(CardCopy.schema.path("tag"));
});
test("no grabs shows an empty history rather than placeholder cards", () => {
  const result = formatCardCollectionSummary({ total: 0, rarity: {}, upgrade: {} });
  assert.match(result, /No cards grabbed yet/);
});

test("tag commands require name but have optional card ID for last grab", async () => {
  const { data } = await import("../commands/cards.js");
  const command = data.toJSON();
  const tag = command.options.find(o => o.name === "tag");
  const untag = command.options.find(o => o.name === "untag");
  assert.equal(tag.options.find(o => o.name === "tag").required, true);
  assert.equal(tag.options.find(o => o.name === "card_id").required, false);
  assert.equal(untag.options.find(o => o.name === "card_id").required, false);
});
