import test from "node:test";
import assert from "node:assert/strict";
import { SHOP_INDEX_PAGE_SIZE, shopDirectorySlice, shopItemIndexById } from "../services/shop-navigation.js";

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
