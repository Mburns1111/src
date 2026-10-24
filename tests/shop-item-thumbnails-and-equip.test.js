import test from "node:test";
import assert from "node:assert/strict";
import { loadImage, createCanvas } from "@napi-rs/canvas";
import { shopItems } from "../services/shop-catalog.js";
import { classicItemThumbnail } from "../services/shop-item-thumbnails.js";
import { FREE_APPEARANCE } from "../services/appearance-ownership.js";
import { equipPurchasedShopMix } from "../services/shop-mix-equip.js";

const ownership = (extra = {}) => Object.fromEntries(Object.entries(FREE_APPEARANCE)
  .map(([category, ids]) => [category, new Set([...ids, ...(extra[category] || [])])]));

test("selected Classic backgrounds, panels, frames, fonts and stickers each have a compact PNG", async () => {
  const all = shopItems();
  const categories = ["backgrounds", "panels", "frames", "fonts", "stickers"];
  for (const category of categories) {
    const item = all.find(entry => entry.category === category);
    assert.ok(item, `expected ${category} item`);
    const bytes = await classicItemThumbnail(item);
    const img = await loadImage(bytes);
    assert.equal(img.width, 760);
    assert.equal(img.height, 300);
    const canvas = createCanvas(760, 300);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, 760, 300).data;
    let marked = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245) marked++;
    }
    assert.ok(marked > 1500, `thumbnail for ${category} must contain visible artwork`);
    assert.strictEqual(await classicItemThumbnail(item), bytes, "thumbnail should be cached");
  }
});

test("Equip All applies the purchased appearance and preserves unselected settings", () => {
  const saved = {
    background: "yellowPastel", panelColor: "match", frame: "default",
    headerFont: "default", bodyFont: "default", fontColor: "black",
    stickers: [{ id: "heart", x: .4, y: .3, scale: .9 }],
  };
  const owned = ownership({
    backgrounds: ["yellowPastel", "roseDark"],
    frames: ["doubleLine"],
    fonts: ["nunito"],
    stickers: ["heart"],
  });
  const original = structuredClone(saved);
  const result = equipPurchasedShopMix(saved, {
    backgrounds: "roseDark", frames: "doubleLine",
    headerFont: "nunito", bodyFont: "nunito",
  }, owned);
  assert.equal(result.ready, true);
  assert.equal(result.appearance.background, "roseDark");
  assert.equal(result.appearance.panelColor, "match");
  assert.equal(result.appearance.frame, "doubleLine");
  assert.equal(result.appearance.headerFont, "nunito");
  assert.equal(result.appearance.bodyFont, "nunito");
  assert.equal(result.appearance.fontColor, "black");
  assert.equal(result.appearance.stickers[0].x, .4);
  assert.deepEqual(saved, original, "computing Equip All must not mutate the saved profile");
});

test("Equip All refuses any unpaid or unavailable preview item", () => {
  const owned = ownership({ backgrounds: ["roseDark"] });
  assert.equal(equipPurchasedShopMix({}, { frames: "doubleLine" }, owned).ready, false);
  assert.equal(equipPurchasedShopMix({}, { backgrounds: "roseDark", panels: "roseDark" }, owned).ready, false);
  assert.equal(equipPurchasedShopMix({}, { backgrounds: "roseDark", panels: "match" }, owned).ready, true);
});

test("Equip All places chosen sticker and can intentionally clear stickers", () => {
  const owned = ownership({ stickers: ["heart"] });
  const base = { stickers: [{ id: "heart", x: .25, y: .35 }] };
  const chosen = equipPurchasedShopMix(base, { stickers: "heart" }, owned);
  assert.equal(chosen.ready, true);
  assert.equal(chosen.appearance.stickers[0].x, .8);
  const cleared = equipPurchasedShopMix(base, { stickers: "none" }, owned);
  assert.equal(cleared.ready, true);
  assert.deepEqual(cleared.appearance.stickers, []);
});
