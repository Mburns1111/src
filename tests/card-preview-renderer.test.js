import test from "node:test";
import assert from "node:assert/strict";
import { CARD_PREVIEW_SIZE, renderCollectibleCardPreview } from "../services/card-preview-renderer.js";
import { data as cardsCommand } from "../commands/cards.js";
import CardDefinition from "../models/CardDefinition.js";

test("single card preview renders valid PNG for normal neon and mega", async () => {
  for (const upgradeLevel of ["normal", "neon", "mega"]) {
    const bytes = await renderCollectibleCardPreview({
      petName: "2D Doggy", rarity: "Legendary", upgradeLevel,
      releaseName: "TEST Release 1", seriesName: "TEST Series 1",
      publicId: "A7_kQ", artStatus: "test-placeholder",
    });
    assert.ok(Buffer.isBuffer(bytes));
    assert.ok(bytes.length > 10_000);
    assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), CARD_PREVIEW_SIZE.width);
    assert.equal(bytes.readUInt32BE(20), CARD_PREVIEW_SIZE.height);
  }
});
test("view command defaults to newest owned card", () => {
  const command = cardsCommand.toJSON();
  const preview = command.options.find(option => option.name === "view");
  assert.ok(preview);
  assert.equal(preview.options.find(o => o.name === "card_id").required, false);
});
test("artist metadata stays independent of art approval", () => {
  assert.ok(CardDefinition.schema.path("artistCredit"));
  assert.ok(CardDefinition.schema.path("artistUrl"));
});
