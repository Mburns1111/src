import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderCollectibleCardPreview } from "../services/card-preview-renderer.js";

const W = 900, H = 1260;
function filledRarityArt() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#d8488d";
  ctx.fillRect(0, 0, W, H);
  return canvas.toBuffer("image/png");
}
async function rgba(png, x, y) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(await loadImage(png), 0, 0);
  return Array.from(ctx.getImageData(x, y, 1, 1).data);
}

test("card footer gets automatic text-sized white chips, leaving other artist artwork visible", async () => {
  const png = await renderCollectibleCardPreview({
    petName: "Albino Bat", rarity: "Ultra-Rare",
    seriesName: "S1", releaseName: "Release 1",
    otherCollectorCount: 0, artistCredit: "", publicId: "A1B2",
    rarityFrameImageSource: filledRarityArt(),
  });
  for (const [x, y] of [[79,1108],[79,1145],[79,1178],[818,1178]]) {
    const [r,g,b] = await rgba(png,x,y);
    assert.ok(r > 230 && g > 230 && b > 230, "white backing at " + x + "," + y);
  }
  const [r,g,b] = await rgba(png, 500, 1108);
  assert.ok(r > 175 && g < 125 && b > 110, "unoccupied artwork must remain pink");
});

test("long credited artist text cannot overlap the ID chip", async () => {
  const png = await renderCollectibleCardPreview({
    petName: "Albino Bat", rarity: "Ultra-Rare", upgradeLevel: "mega",
    artistCredit: "An Extremely Long Artist Name That Reaches the Card Footer Limit and Must Be Clamped",
    publicId: "abcDEF123456",
    rarityFrameImageSource: filledRarityArt(),
  });
  const [r,g,b] = await rgba(png, 623, 1178);
  assert.ok(r > 175 && g < 125 && b > 110, "keep a visible artwork gutter between long credit and ID");
  const [ir,ig,ib] = await rgba(png, 818, 1178);
  assert.ok(ir > 230 && ig > 230 && ib > 230, "ID always has a readable white backing");
});
