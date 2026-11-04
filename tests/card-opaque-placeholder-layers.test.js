import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import CardRelease from "../models/CardRelease.js";
import CardArtwork from "../models/CardArtwork.js";
import { renderCollectibleCardPreview } from "../services/card-preview-renderer.js";

function png(draw) {
  const canvas = createCanvas(900, 1260);
  const ctx = canvas.getContext("2d");
  draw(ctx);
  return canvas.toBuffer("image/png");
}
async function pixel(buffer,x,y) {
  const image = await loadImage(buffer);
  const canvas = createCanvas(900,1260);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image,0,0);
  return Array.from(ctx.getImageData(x,y,1,1).data);
}

test("full-canvas pet art retains its transparent coordinates and does not get cropped at y=1000", async () => {
  const background = png(ctx=>{ctx.fillStyle="#f0eddc";ctx.fillRect(0,0,900,1260)});
  const rarity = png(ctx=>{ctx.fillStyle="#e6b5d9";ctx.fillRect(0,0,900,1260)});
  const pet = png(ctx=>{
    ctx.fillStyle="#ffffff";ctx.fillRect(83,256,734,748);
    ctx.fillStyle="#134eda";ctx.fillRect(400,997,80,7);
    // The transparent top left corner must show the rarity design.
  });
  const rendered = await renderCollectibleCardPreview({
    petName:"Cat",rarity:"Common",artStatus:"pending",
    backgroundImageSource:background,rarityFrameImageSource:rarity,
    petImageSource:pet,
  });
  const bottom = await pixel(rendered,450,1001);
  assert.ok(bottom[2]>180 && bottom[0]<50, "pet artwork extends to the intended y=1004");
  const corner = await pixel(rendered,5,5);
  assert.ok(corner[0]>200 && corner[2]>150, "frame beneath transparent pet remains visible");
  const middle = await pixel(rendered,450,650);
  assert.ok(middle[0]>245 && middle[1]>245 && middle[2]>245, "opaque placeholder window is preserved");
});

test("stage overlays remain on top of pet and rarity artwork", async () => {
  const pet = png(ctx=>{ctx.fillStyle="#dddddd";ctx.fillRect(100,300,500,600)});
  const rarity = png(ctx=>{ctx.fillStyle="#111111";ctx.fillRect(0,0,900,1260)});
  const stage = png(ctx=>{ctx.fillStyle="#02fbcd";ctx.fillRect(5,5,25,25)});
  const rendered = await renderCollectibleCardPreview({
    petName:"Dog",rarity:"Legendary",upgradeLevel:"neon",
    petImageSource:pet,rarityFrameImageSource:rarity,
    stageOverlayImageSource:stage,
  });
  const corner = await pixel(rendered,12,12);
  assert.ok(corner[1]>230 && corner[2]>150 && corner[0]<20);
});

test("existing release documents can omit new art slots", () => {
  const existing = new CardRelease({releaseId:"draft-legacy",seriesId:"series-1",name:"Draft",eggName:"Egg"});
  assert.equal(existing.cardRarityFrameKeys.Common,"");
  assert.equal(existing.cardStageOverlayKeys.neon,"");
  assert.equal(existing.cardStageOverlayKeys.mega,"");
  assert.ok(CardArtwork.schema.path("checksumSha256"));
});
