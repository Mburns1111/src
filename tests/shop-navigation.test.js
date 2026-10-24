import test from "node:test";
import assert from "node:assert/strict";
import {
  SHOP_INDEX_PAGE_SIZE, shopDirectorySlice, shopItemIndexById,
  shopColorFamilyDirectory, shopColorDirectorySelection, shopPurchaseTargetMatches,
} from "../services/shop-navigation.js";
import { shopItems } from "../services/shop-catalog.js";
import { CLASSIC_COLOR_FAMILIES } from "../services/classic-colors.js";
import { CUSTOM_COLOR_SHOP_ID } from "../services/custom-colors.js";

const entries = Array.from({ length: 28 }, (_, i) => ({
  id: `color${i}`, name: `Color ${i + 1}`, price: i < 27 ? 75 : 225,
}));

test("shop categories open with an index of up to twenty items", () => {
  assert.equal(SHOP_INDEX_PAGE_SIZE, 20);
  const index = shopDirectorySlice(entries, 0);
  assert.equal(index.page, 0);
  assert.equal(index.count, 2);
  assert.equal(index.visible.length, 20);
  assert.equal(index.visible[0].id, "color0");
  assert.equal(index.visible[19].id, "color19");
});

test("a large color category can directly open its second directory page", () => {
  const index = shopDirectorySlice(entries, 1);
  assert.equal(index.start, 20);
  assert.equal(index.visible.length, 8);
  assert.equal(index.visible[7].id, "color27");
});

test("old/invalid index pages safely clamp to the available range", () => {
  assert.equal(shopDirectorySlice(entries, -5).page, 0);
  assert.equal(shopDirectorySlice(entries, 999).page, 1);
  assert.equal(shopDirectorySlice(entries, NaN).page, 0);
  assert.equal(shopDirectorySlice(entries, 0.5).page, 0);
  assert.equal(shopDirectorySlice([], 0).count, 1);
  assert.equal(shopDirectorySlice([], 0).visible.length, 0);
});

test("smaller categories fit into a single direct-selection menu", () => {
  for (const length of [2, 5, 6, 8, 20]) {
    const index = shopDirectorySlice(entries.slice(0, length));
    assert.equal(index.count, 1);
    assert.equal(index.visible.length, length);
    assert.ok(index.visible.length <= 25, "Discord select menu limit");
  }
});

test("stable IDs, not list positions, determine the chosen shop item", () => {
  const before = [
    { id: "heart" }, { id: "spookyBat" }, { id: "star" }, { id: "pumpkinPatch" },
  ];
  const afterSeason = before.filter(item => !["spookyBat", "pumpkinPatch"].includes(item.id));
  assert.equal(shopItemIndexById(before, "star"), 2);
  assert.equal(shopItemIndexById(afterSeason, "star"), 1);
  assert.equal(shopItemIndexById(afterSeason, "spookyBat"), -1);
  assert.equal(shopItemIndexById(before, "ghostFromOldButton"), -1);
});

test("pagination never mutates catalog records or changes their prices", () => {
  const initial = structuredClone(entries);
  shopDirectorySlice(entries, 0);
  shopDirectorySlice(entries, 1);
  shopItemIndexById(entries, "color27");
  assert.deepEqual(entries, initial);
});

test("background index groups 27 individual shades into nine families plus Custom HEX", () => {
  const items = shopItems().filter(item => item.category === "backgrounds");
  const original = structuredClone(items);
  const choices = shopColorFamilyDirectory(items);

  assert.equal(items.length, 28);
  assert.equal(choices.length, 10);
  assert.deepEqual(choices.slice(0, 9).map(item => item.id),
    CLASSIC_COLOR_FAMILIES.map(family => family.id));
  assert.ok(choices.slice(0, 9).every(family =>
    family.itemIds.length === 3 && family.minPrice === 75 && family.maxPrice === 75));
  assert.equal(choices[9].id, CUSTOM_COLOR_SHOP_ID);
  assert.equal(choices[9].minPrice, 225);
  assert.deepEqual(items, original, "grouping never changes stored prices or item IDs");
});

test("panels group by family while keeping free Normal gray and shade-specific prices", () => {
  const items = shopItems().filter(item => item.category === "panels");
  const choices = shopColorFamilyDirectory(items);
  assert.equal(choices.length, 10);
  const gray = choices.find(family => family.id === "gray");
  assert.deepEqual(gray.itemIds, ["grayPastel", "grayNormal", "grayDark"]);
  assert.equal(gray.minPrice, 0);
  assert.equal(gray.maxPrice, 60);
  assert.equal(items.find(item => item.id === "grayNormal").price, 0);
  assert.equal(choices.find(item => item.isCustom).minPrice, 150);
});

test("color family selection enters its Normal shade, but never changes purchased shade IDs", () => {
  for (const category of ["backgrounds", "panels"]) {
    const items = shopItems().filter(item => item.category === category);
    for (const family of CLASSIC_COLOR_FAMILIES) {
      const i = shopColorDirectorySelection(items, family.id);
      assert.equal(items[i]?.id, `${family.id}Normal`);
    }
    // Old index select menus still send individual IDs; those must keep working.
    assert.equal(items[shopColorDirectorySelection(items, "roseDark")]?.id, "roseDark");
    assert.equal(items[shopColorDirectorySelection(items, CUSTOM_COLOR_SHOP_ID)]?.id,
      CUSTOM_COLOR_SHOP_ID);
    assert.equal(shopColorDirectorySelection(items, "not-a-family"), -1);
    assert.equal(shopColorDirectorySelection(items, "missingOldShade"), -1);
  }
});

test("new purchase controls reject stale IDs after a category is reordered", () => {
  for (const category of ["backgrounds", "panels", "frames", "fonts", "fontColors", "stickers"]) {
    assert.equal(shopPurchaseTargetMatches(category, "itemA", "itemA"), true);
    assert.equal(shopPurchaseTargetMatches(category, "itemB", "itemA"), false);
  }
  assert.equal(shopPurchaseTargetMatches("stickers", "heart", undefined), false);
  assert.equal(shopPurchaseTargetMatches("frames", "doubleLine", undefined), true,
    "older non-sticker controls can be refreshed without breaking");
  assert.equal(shopPurchaseTargetMatches("frames", undefined, undefined), false);
});
