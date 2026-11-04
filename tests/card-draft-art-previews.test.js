import test from "node:test";
import assert from "node:assert/strict";
import { selectReleasePreviewCards } from "../services/card-draft-art-previews.js";

test("draft preview favors assigned art and samples across rarities", () => {
  const definitions = [
    { petId: "z-dog", rarity: "Common", petArtworkKey: "" },
    { petId: "cat", rarity: "Common", petArtworkKey: "cat-v1" },
    { petId: "dragon", rarity: "Legendary", petArtworkKey: "dragon-v1" },
    { petId: "fox", rarity: "Ultra-Rare", petArtworkKey: "fox-v1" },
    { petId: "bunny", rarity: "Rare", petArtworkKey: "" },
  ];
  const result = selectReleasePreviewCards(definitions);
  assert.equal(result.length, 3);
  assert.deepEqual(new Set(result.map(card => card.rarity)),
    new Set(["Common", "Legendary", "Ultra-Rare"]));
  assert.ok(result.every(card => card.petArtworkKey));
  assert.equal(definitions[0].petId, "z-dog", "source list remains untouched");
});

test("draft preview fills same-rarity slots without duplicating pets", () => {
  const definitions = [
    { petId: "c", rarity: "Common", petArtworkKey: "" },
    { petId: "a", rarity: "Common", petArtworkKey: "a-v1" },
    { petId: "b", rarity: "Common", petArtworkKey: "b-v1" },
  ];
  assert.deepEqual(selectReleasePreviewCards(definitions).map(card => card.petId), ["a", "b", "c"]);
  assert.deepEqual(selectReleasePreviewCards(definitions, 1).map(card => card.petId), ["a"]);
});

test("draft preview handles insufficient artwork and rejects invalid selection", () => {
  assert.deepEqual(selectReleasePreviewCards([]), []);
  assert.deepEqual(selectReleasePreviewCards([{ petId: "one", rarity: "Common" }]).map(c => c.petId), ["one"]);
  assert.throws(() => selectReleasePreviewCards(null));
  assert.throws(() => selectReleasePreviewCards([], 0));
});
