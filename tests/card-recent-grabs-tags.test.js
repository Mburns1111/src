import test from "node:test";
import assert from "node:assert/strict";
import CardCopy from "../models/CardCopy.js";
import { formatCardCollectionSummary, normalizeCardTag } from "../services/card-collection-summary.js";

test("recent grabs include five-character card ID, rarity, tier and tag", () => {
  const result = formatCardCollectionSummary({
    total: 2,
    rarity: { Common: 1, Uncommon: 0, Rare: 0, "Ultra-Rare": 0, Legendary: 1 },
    upgrade: { normal: 2, neon: 0, mega: 0 },
    recent: [
      { id: "A7_kQ", name: "Shadow Dragon", rarity: "Legendary", upgradeLevel: "normal", tag: "Favorite", owned: true },
      { id: "B83-z", name: "Cat", rarity: "Common", upgradeLevel: "normal", tag: "", owned: true },
    ],
  });
  assert.match(result, /Last 5 grabbed cards/);
  assert.match(result, /A7_kQ/);
  assert.match(result, /Shadow Dragon.*Legendary.*Normal/);
  assert.match(result, /Tag: \*\*Favorite\*\*/);
  assert.match(result, /B83-z/);
  assert.doesNotMatch(result, /507f1f77bcf86cd799439011/);
});
test("tag normalization and optional ID command", async () => {
  assert.equal(normalizeCardTag("  My   Favorite  "), "My Favorite");
  assert.throws(() => normalizeCardTag("@everyone"), /Tags must/);
  assert.ok(CardCopy.schema.path("tag"));
  const { data } = await import("../commands/cards.js");
  const command = data.toJSON();
  const tag = command.options.find(o => o.name === "tag");
  const untag = command.options.find(o => o.name === "untag");
  assert.equal(tag.options.find(o => o.name === "tag").required, true);
  assert.equal(tag.options.find(o => o.name === "card_id").required, false);
  assert.equal(untag.options.find(o => o.name === "card_id").required, false);
});
