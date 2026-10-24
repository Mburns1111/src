import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { appearanceCatalogItem } from "../services/post-appearance.js";
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
    [27, 27, 6, 6, 3, 8]);
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

test("frame gallery shows six enlarged top-left corners on plain white", async () => {
  const frames = shopItems().filter(item => item.category === "frames");
  const buffer = await renderClassicFrameSheet(frames);
  const image = await loadImage(buffer);
  assert.equal(image.width, 1200);
  assert.equal(image.height, 1415);

  const canvas = createCanvas(1200, 1415);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  assert.deepEqual([...ctx.getImageData(1185, 1400, 1, 1).data],
    [255, 255, 255, 255], "sheet background is plain white");

  const columns = [40, 554];
  const rows = [165, 555, 945];
  for (let i = 0; i < frames.length; i++) {
    const x = columns[i % 2], y = rows[Math.floor(i / 2)];
    const { data } = ctx.getImageData(x + 10, y + 10, 125, 145);
    let artworkPixels = 0;
    for (let p = 0; p < data.length; p += 4) {
      if (data[p] < 245 || data[p + 1] < 245 || data[p + 2] < 245) {
        artworkPixels++;
      }
    }
    assert.ok(artworkPixels > 50, `frame ${frames[i].id} has a visible enlarged corner`);
  }
});

test("Plum is retired from shop and classic previews, but legacy saved colors remain valid", () => {
  assert.ok(!shopItems().some(item => item.category === "fontColors" && item.id === "plum"));
  assert.deepEqual(CLASSIC_SHOP_ITEMS.fontColors, ["default", "black", "white"]);
  assert.equal(shopItems().filter(item => item.category === "fontColors").length, 1);
  assert.ok(appearanceCatalogItem("fontColors", "plum"),
    "old Plum profiles and ownership IDs must still render without migration");
});
