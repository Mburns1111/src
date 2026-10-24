import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { shopItems } from "../services/shop-catalog.js";
import { SHOP_PRESENTATION_RULES, CLASSIC_SHOP_ITEMS,
  isClassicShopItem, classicShowcaseItems, complexShowcaseItems } from "../services/shop-presentation.js";
import { shopColorFamilyDirectory } from "../services/shop-navigation.js";
import { renderClassicFrameSheet, renderClassicFontSheet,
  renderClassicStickerSheet, renderClassicTextColorSheet } from "../services/shop-showcase-sheets.js";

const categories = ["backgrounds", "panels", "frames", "fonts", "fontColors", "stickers"];

test("all six shop categories have explicit classic-sheet and direct-index rules", () => {
  assert.deepEqual(Object.keys(SHOP_PRESENTATION_RULES), categories);
  for (const category of categories) {
    assert.equal(SHOP_PRESENTATION_RULES[category].classic, "category-sheet");
    assert.equal(SHOP_PRESENTATION_RULES[category].classicNavigation, "direct-index");
    assert.equal(SHOP_PRESENTATION_RULES[category].complex, "standalone");
  }
  assert.deepEqual(categories.map(category => CLASSIC_SHOP_ITEMS[category].length),
    [27, 27, 6, 6, 4, 8]);
});

test("new premium items stay separate and do not silently become classics", () => {
  const category = "frames";
  const items = shopItems().filter(item => item.category === category);
  const premium = { category, id: "brandNewPremiumFrame", name: "New premium",
    price: 999, included: false };
  assert.equal(isClassicShopItem(category, premium.id), false);
  assert.ok(!classicShowcaseItems(category, [...items, premium])
    .some(item => item.id === premium.id));
  assert.deepEqual(complexShowcaseItems(category, [...items, premium]).map(item => item.id),
    [premium.id]);
  assert.equal(isClassicShopItem(category, "doubleLine"), true);
  assert.equal(items.find(item => item.id === "doubleLine").price, 125);
});

test("future complex backgrounds and panels remain selectable alongside nine families", () => {
  for (const category of ["backgrounds", "panels"]) {
    const items = shopItems().filter(item => item.category === category);
    const premium = { id: "paintedGardenPremium", category, name: "Painted Garden", price: 900 };
    const entries = shopColorFamilyDirectory([...items, premium]);
    assert.equal(entries.length, 11);
    assert.deepEqual(entries.slice(0, 9).map(item => item.itemIds.length), Array(9).fill(3));
    assert.equal(entries[9].isCustom, true);
    assert.equal(entries[10].id, premium.id);
    assert.equal(entries[10].isStandalone, true);
    assert.equal(entries[10].minPrice, 900);
  }
});

test("one font sheet, sticker gallery and text color sheet render as PNGs", async () => {
  const all = shopItems();
  const images = [
    renderClassicFontSheet(all.filter(item => item.category === "fonts")),
    renderClassicStickerSheet(all.filter(item => item.category === "stickers")),
    renderClassicTextColorSheet(),
  ];
  for (const buffer of images) {
    assert.ok(Buffer.isBuffer(buffer));
    const loaded = await loadImage(buffer);
    assert.equal(loaded.width, 1200);
    assert.ok(loaded.height >= 500);
  }
});

test("one frame sheet stacks six examples in one PNG without extra files", async () => {
  const canvas = createCanvas(1200, 800);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#D6E6DB";
  ctx.fillRect(0, 0, 1200, 800);
  const sample = canvas.toBuffer("image/png");
  let renders = 0;
  const frames = shopItems().filter(item => item.category === "frames");
  const buffer = await renderClassicFrameSheet(frames, async () => {
    renders++;
    return sample;
  });
  assert.equal(renders, 6);
  const image = await loadImage(buffer);
  assert.equal(image.width, 1200);
  assert.equal(image.height, 150 + 6 * 405);
});
