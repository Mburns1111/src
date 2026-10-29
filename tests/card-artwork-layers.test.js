import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { data } from "../commands/cards.js";
import CardArtwork from "../models/CardArtwork.js";
import CardDefinition from "../models/CardDefinition.js";
import CardRelease from "../models/CardRelease.js";
import { CARD_ARTWORK_BUCKET, validateCardArtworkKey } from "../services/card-artwork-assets.js";
import { renderCollectibleCardPreview, CARD_PREVIEW_SIZE } from "../services/card-preview-renderer.js";
import { renderThreeCardDropImage, CARD_DROP_IMAGE_SIZE } from "../services/card-drop-renderer.js";

test("artwork upload and assignment are manager-facing Discord subcommands", () => {
  const commands = data.toJSON().options;
  assert.ok(commands.find(c => c.name === "art-upload")?.options.find(o => o.name === "image" && o.type === 11));
  assert.ok(commands.find(c => c.name === "art-assign")?.options.find(o => o.name === "key"));
});
test("artwork references are optional and live separately from existing art URLs", () => {
  assert.ok(CardDefinition.schema.path("petArtworkKey"));
  assert.ok(CardRelease.schema.path("cardBackgroundKey"));
  assert.ok(CardRelease.schema.path("cardFrameKey"));
  assert.ok(CardArtwork.schema.path("artistCredit"));
  assert.ok(CardArtwork.schema.path("licenseReviewStatus"));
  assert.ok(CardArtwork.schema.path("key").options.unique);
  assert.equal(CARD_ARTWORK_BUCKET, "cardArtwork");
  assert.equal(validateCardArtworkKey("Cat-Art-01"), "cat-art-01");
  assert.throws(() => validateCardArtworkKey("../oops"));
});
test("custom 900x1260 card layers render without removing placeholder or artist metadata", async () => {
  const color = (rgba, width = 900, height = 1260) => {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = rgba; ctx.fillRect(0, 0, width, height);
    return canvas.toBuffer("image/png");
  };
  const layers = {
    backgroundImageSource: color("#c6e6dc"),
    frameImageSource: color("rgba(20,10,200,0.06)"),
    petImageSource: color("#ecb1cd", 750, 760),
  };
  const card = await renderCollectibleCardPreview({
    petName: "Abyssinian Cat", rarity: "Rare",
    artStatus: "test-placeholder", artistCredit: "Test Artist",
    ...layers, dropMode: true,
  });
  assert.equal(card.readUInt32BE(16), CARD_PREVIEW_SIZE.width);
  assert.equal(card.readUInt32BE(20), CARD_PREVIEW_SIZE.height);
  const drop = await renderThreeCardDropImage({
    cards: [1,2,3].map(() => ({
      petName: "Abyssinian Cat", rarity: "Rare",
      artStatus: "test-placeholder", artistCredit: "Test Artist", ...layers,
    })),
  });
  assert.equal(drop.readUInt32BE(16), CARD_DROP_IMAGE_SIZE.width);
  assert.equal(drop.readUInt32BE(20), CARD_DROP_IMAGE_SIZE.height);
});
