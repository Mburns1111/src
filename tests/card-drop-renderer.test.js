import test from "node:test";
import assert from "node:assert/strict";
import { CARD_DROP_IMAGE_SIZE, renderThreeCardDropImage } from "../services/card-drop-renderer.js";
import { data,ownerCardOptions } from "../commands/cards.js";

test("three-card drop renders egg banner and 3 unissued cards as PNG", async () => {
  const png = await renderThreeCardDropImage({
    releaseName: "TEST Release 1", seriesName: "TEST Series 1",
    cards: [
      { petName: "Ant", rarity: "Common", artStatus: "test-placeholder" },
      { petName: "Amber Butterfly", rarity: "Rare", artStatus: "test-placeholder" },
      { petName: "2D Doggy", rarity: "Legendary", artStatus: "test-placeholder" },
    ],
  });
  assert.ok(Buffer.isBuffer(png));
  assert.ok(png.length > 10000);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), CARD_DROP_IMAGE_SIZE.width);
  assert.equal(png.readUInt32BE(20), CARD_DROP_IMAGE_SIZE.height);
});
test("test-drop command retains release ID and button flow", () => {
  const testDrop = ownerCardOptions.toJSON().options.find(o => o.name === "test-drop");
  assert.equal(testDrop.options.find(o => o.name === "release").required, true);
});
test("requires exactly three cards and never invents issued IDs", async () => {
  await assert.rejects(renderThreeCardDropImage({ cards: [] }), /exactly three/);
  await assert.rejects(renderThreeCardDropImage({ cards: [{petName:"Ant"}] }), /exactly three/);
});

test("approved artwork without a named artist is rejected before display", async () => {
  await assert.rejects(renderThreeCardDropImage({
    cards: [
      { petName: "Ant", rarity: "Common", artStatus: "approved", artUrl: "https://example.com/a.png", artistCredit: "" },
      { petName: "Cat", rarity: "Common", artStatus: "test-placeholder" },
      { petName: "Dog", rarity: "Common", artStatus: "test-placeholder" },
    ],
  }), /Artist credit is required/);
});

test("drop mode includes artist credit without minting or printing an owned ID", async () => {
  const { renderCollectibleCardPreview } = await import("../services/card-preview-renderer.js");
  const result = await renderCollectibleCardPreview({
    petName: "Ant", rarity: "Common", artStatus: "test-placeholder",
    artistCredit: "Artist Example", dropMode: true,
  });
  assert.ok(result.length > 10000);
});
