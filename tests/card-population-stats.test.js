import test from "node:test";
import assert from "node:assert/strict";
import CardLifecycleEvent from "../models/CardLifecycleEvent.js";
import { data } from "../commands/cards.js";
import { CARD_PREVIEW_SIZE, renderCollectibleCardPreview } from "../services/card-preview-renderer.js";

test("burn and upgrade counters have independent, indexed audit fields", () => {
  for (const name of ["operationKey", "cardDefinitionId", "eventType", "targetUpgradeLevel", "consumedCardCopyIds", "resultCardCopyId"]) {
    assert.ok(CardLifecycleEvent.schema.path(name));
  }
  assert.ok(CardLifecycleEvent.schema.path("operationKey").options.unique);
});
test("stats command defaults to latest grabbed card", () => {
  const stats = data.toJSON().options.find(option => option.name === "stats");
  assert.ok(stats);
  assert.equal(stats.options.find(o => o.name === "card_id").required, false);
});
test("card portrait renderer accepts live other-collectors count", async () => {
  const png = await renderCollectibleCardPreview({
    petName: "2D Doggy", rarity: "Legendary", publicId: "KmwP7",
    artStatus: "test-placeholder", otherCollectorCount: 12,
  });
  assert.equal(png.readUInt32BE(16), CARD_PREVIEW_SIZE.width);
  assert.equal(png.readUInt32BE(20), CARD_PREVIEW_SIZE.height);
});
