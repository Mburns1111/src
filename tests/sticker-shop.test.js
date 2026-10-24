import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import {
  STICKER_CATALOG, STICKER_OUTLINES, stickerDefaults,
  validStickerHex, isStickerForSale,
} from "../services/sticker-catalog.js";
import { drawStickerArtwork } from "../services/sticker-artwork.js";
import { APPEARANCE_CATALOG, resolveAppearance } from "../services/post-appearance.js";
import { FREE_APPEARANCE, filterOwnedAppearance } from "../services/appearance-ownership.js";
import { shopItems, shopItem } from "../services/shop-catalog.js";

const STANDARD = ["heart", "star", "flower", "crescent", "sparkle"];
const HALLOWEEN = ["spookyBat", "littleGhost", "pumpkinPatch"];
const TWO_COLOR = ["flower", "littleGhost", "pumpkinPatch"];
const expectedPrices = {
  heart: 50, star: 50, flower: 75, crescent: 50, sparkle: 50,
  spookyBat: 50, littleGhost: 75, pumpkinPatch: 75,
};
function ownership(stickers = []) {
  return Object.fromEntries(Object.entries(FREE_APPEARANCE)
    .map(([key, ids]) => [key, new Set(key === "stickers" ? stickers : ids)]));
}
function renderSticker(instance) {
  const canvas = createCanvas(160, 160);
  const ctx = canvas.getContext("2d");
  ctx.translate(80, 80);
  assert.equal(drawStickerArtwork(ctx, instance, 110), true);
  return ctx.getImageData(0, 0, 160, 160).data;
}
function pixelCount(pixels, hex) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i+3] > 200 && Math.abs(pixels[i] - rgb[0]) <= 2 &&
        Math.abs(pixels[i+1] - rgb[1]) <= 2 &&
        Math.abs(pixels[i+2] - rgb[2]) <= 2) count++;
  }
  return count;
}

test("stable sticker names, prices, ownership IDs and seasonal flags", () => {
  assert.deepEqual(Object.keys(STICKER_CATALOG), [
    "heart", "star", "flower", "crescent", "sparkle",
    "spookyBat", "littleGhost", "pumpkinPatch",
  ]);
  assert.equal(STICKER_CATALOG.flower.name, "Daisy");
  assert.equal(STICKER_CATALOG.pumpkinPatch.name, "Pumpkin Patch");
  for (const [id, price] of Object.entries(expectedPrices)) {
    assert.equal(STICKER_CATALOG[id].price, price, id);
    assert.equal(STICKER_CATALOG[id].seasonal, HALLOWEEN.includes(id), id);
    assert.equal(Boolean(APPEARANCE_CATALOG.stickers[id]), true, id);
  }
  for (const id of TWO_COLOR) assert.equal(STICKER_CATALOG[id].colors, 2, id);
});

test("seasonal rotation is annual and does not affect standard designs", () => {
  const october = new Date("2026-10-24T12:00:00-04:00");
  const november = new Date("2026-11-03T12:00:00-05:00");
  for (const id of HALLOWEEN) {
    assert.equal(isStickerForSale(id, october, ""), true, id);
    assert.equal(isStickerForSale(id, november, ""), false, id);
    assert.equal(isStickerForSale(id, october, "off"), false, id);
    assert.equal(isStickerForSale(id, november, "halloween"), true, id);
  }
  for (const id of STANDARD) {
    assert.equal(isStickerForSale(id, november, "off"), true, id);
  }
});

test("sticker shop never offers seasonal items when disabled", () => {
  const old = process.env.STICKER_SEASONS_OVERRIDE;
  try {
    process.env.STICKER_SEASONS_OVERRIDE = "off";
    const items = shopItems().filter(item => item.category === "stickers");
    assert.equal(items.length, 5);
    assert.deepEqual(items.map(item => item.id), STANDARD);
    assert.equal(shopItem("stickers", "spookyBat"), undefined);
    process.env.STICKER_SEASONS_OVERRIDE = "halloween";
    assert.equal(shopItems().filter(item => item.category === "stickers").length, 8);
    for (const item of shopItems().filter(item => item.category === "stickers")) {
      assert.equal(item.price, expectedPrices[item.id]);
    }
  } finally {
    if (old === undefined) delete process.env.STICKER_SEASONS_OVERRIDE;
    else process.env.STICKER_SEASONS_OVERRIDE = old;
  }
});

test("purchased Halloween stickers remain equipped outside their sales window", () => {
  const saved = { stickers: [stickerDefaults("littleGhost"), stickerDefaults("star")] };
  const afterSaleEnds = filterOwnedAppearance(saved, ownership(["littleGhost"]));
  assert.equal(afterSaleEnds.stickers.length, 1);
  assert.equal(afterSaleEnds.stickers[0].id, "littleGhost");
  assert.equal(filterOwnedAppearance(saved, ownership([])).stickers.length, 0);
});

test("HEX validation, per-instance accents and outline normalization", () => {
  assert.equal(validStickerHex("  aa22cC "), "#AA22CC");
  assert.equal(validStickerHex("#ABCDEF"), "#ABCDEF");
  for (const invalid of ["#ZZZZZZ", "#12345", "red", "none", null]) {
    assert.equal(validStickerHex(invalid), null);
  }
  const d = resolveAppearance({ stickers: [{
    ...stickerDefaults("flower"), color: "#aa0000",
    accentColor: "00BB00", outline: "white",
  }, {
    ...stickerDefaults("star"), color: "#223344",
    accentColor: "#445566", outline: "black",
  }] }).stickers;
  assert.equal(d[0].color, "#AA0000");
  assert.equal(d[0].accentColor, "#00BB00");
  assert.equal(d[0].outline, "white");
  assert.equal(d[1].color, "#223344");
  assert.equal(d[1].accentColor, null, "One-color shapes ignore accent data");
  for (const o of STICKER_OUTLINES) {
    assert.equal(resolveAppearance({ stickers: [{ ...stickerDefaults("heart"), outline:o }] })
      .stickers[0].outline, o);
  }
  const invalid = resolveAppearance({ stickers: [{ id:"flower", color:"bad", accentColor:"no", outline:"invalid" }] }).stickers[0];
  assert.equal(invalid.color, STICKER_CATALOG.flower.color);
  assert.equal(invalid.accentColor, STICKER_CATALOG.flower.accentColor);
  assert.equal(invalid.outline, "auto");
});

test("instances can reuse the same sticker with different colors; maximum eight", () => {
  const input = Array.from({ length: 9 }, (_, i) => ({
    ...stickerDefaults("heart"), x: i / 8,
    color: i % 2 ? "#112233" : "#FFEE44",
  }));
  const result = resolveAppearance({ stickers: input }).stickers;
  assert.equal(result.length, 8);
  assert.notEqual(result[0].color, result[1].color);
  assert.ok(result.every(s => s.x >= 0.04 && s.x <= 0.96));
});

test("legacy Star and Flower placements still work without saved colors", () => {
  const old = resolveAppearance({ stickers: [
    { id:"star", x:0.85, y:0.15, scale:1, rotation:0 },
    { id:"flower", x:0.72, y:0.3, scale:1, rotation:0 },
  ] }).stickers;
  assert.equal(old.length, 2);
  assert.equal(old[0].color, STICKER_CATALOG.star.color);
  assert.equal(old[1].accentColor, STICKER_CATALOG.flower.accentColor);
});

test("all eight vector designs render visible opaque pixels in their selected color", () => {
  for (const id of Object.keys(STICKER_CATALOG)) {
    const color = "#F426BE";
    const pixels = renderSticker({ ...stickerDefaults(id), color, outline:"none" });
    assert.ok(pixelCount(pixels, color) > 50, id);
  }
});

test("Daisy, Little Ghost and Pumpkin Patch render the user's accent color", () => {
  for (const id of TWO_COLOR) {
    const accentColor = "#11EC82";
    const pixels = renderSticker({
      ...stickerDefaults(id), color:"#ED75CC", accentColor, outline:"none",
    });
    assert.ok(pixelCount(pixels, accentColor) > 15, id);
  }
});
