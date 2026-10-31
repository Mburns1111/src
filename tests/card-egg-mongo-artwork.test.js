import test from "node:test";
import assert from "node:assert/strict";
import { renderThreeCardDropImage, CARD_DROP_IMAGE_SIZE } from "../services/card-drop-renderer.js";
import { createCanvas } from "@napi-rs/canvas";
import CardRelease from "../models/CardRelease.js";
import { EGG_ART_BUCKETS, EGG_ART_MAX_BYTES } from "../services/card-egg-artwork.js";

test("three-card drop accepts egg art bytes from MongoDB, without filesystem path", async () => {
  const canvas = createCanvas(1200, 430);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#eab2e0";
  ctx.fillRect(0, 0, 1200, 430);
  const png = await renderThreeCardDropImage({
    releaseName: "TEST Release 1",
    eggImageSource: canvas.toBuffer("image/png"),
    cards: [
      { petName: "Ant", rarity: "Common", artStatus: "test-placeholder" },
      { petName: "Cat", rarity: "Common", artStatus: "test-placeholder" },
      { petName: "Dog", rarity: "Common", artStatus: "test-placeholder" },
    ],
  });
  assert.equal(png.readUInt32BE(16), CARD_DROP_IMAGE_SIZE.width);
  assert.equal(png.readUInt32BE(20), CARD_DROP_IMAGE_SIZE.height);
});
test("releases can link artwork from existing database without local files", () => {
  assert.ok(CardRelease.schema.path("eggImageBucket"));
  assert.ok(CardRelease.schema.path("eggImageFileId"));
  assert.ok(EGG_ART_BUCKETS.includes("profilePhotos"));
  assert.ok(EGG_ART_MAX_BYTES > 1024);
});
