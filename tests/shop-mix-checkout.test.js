import test from "node:test";
import assert from "node:assert/strict";
import { previewPurchasePlan, previewPurchaseFingerprint } from "../services/shop-mix-checkout.js";
import { FREE_APPEARANCE } from "../services/appearance-ownership.js";
import { shopItems } from "../services/shop-catalog.js";
import { CUSTOM_COLOR_PRICES, customColorId } from "../services/custom-colors.js";

const ownership = (extra = {}) => Object.fromEntries(
  Object.entries(FREE_APPEARANCE).map(([category, defaults]) =>
    [category, new Set([...defaults, ...(extra[category] || [])])]),
);
const catalog = shopItems();

test("Preview Multiple totals separate colors, frame, font and sticker exactly once", () => {
  const mix = {
    backgrounds: "yellowPastel",
    panels: "roseDark",
    frames: "doubleLine",
    headerFont: "nunito",
    bodyFont: "nunito",
    stickers: "heart",
  };
  const result = previewPurchasePlan(mix, ownership(), catalog);
  const get = (cat, id) => catalog.find(item => item.category === cat && item.id === id);
  const expected = [
    ["backgrounds", "yellowPastel"], ["panels", "roseDark"],
    ["frames", "doubleLine"], ["fonts", "nunito"], ["stickers", "heart"],
  ].map(([cat, id]) => get(cat, id));
  assert.ok(expected.every(Boolean), "test products must currently be sold");
  assert.deepEqual(result.purchasable.map(item => item.id), [
    "yellowPastel", "roseDark", "doubleLine", "heart", "nunito",
  ]);
  assert.equal(result.total, expected.reduce((sum, item) => sum + item.price, 0));
  assert.equal(result.purchasable.filter(item => item.category === "fonts").length, 1);
});

test("different header and body fonts are counted individually", () => {
  const plan = previewPurchasePlan({ headerFont: "nunito", bodyFont: "cinzel" }, ownership(), catalog);
  assert.deepEqual(new Set(plan.purchasable.map(item => item.id)), new Set(["nunito", "cinzel"]));
  assert.equal(plan.total, catalog.find(item => item.id === "nunito").price +
    catalog.find(item => item.id === "cinzel").price);
});

test("owned or free try-on items cost zero and are excluded from purchase", () => {
  const plan = previewPurchasePlan({
    backgrounds: "yellowPastel", panels: "grayNormal", frames: "default",
    headerFont: "nunito", bodyFont: "default", fontColors: "white",
    stickers: "none",
  }, ownership({ backgrounds: ["yellowPastel"], fonts: ["nunito"] }), catalog);
  assert.equal(plan.total, 0);
  assert.equal(plan.purchasable.length, 0);
  assert.equal(plan.unavailable.length, 0);
  assert.ok(plan.entries.every(item => item.owned || item.free));
});

test("match panels and no stickers are preview-only, not purchasable products", () => {
  const plan = previewPurchasePlan({
    panels: "match", stickers: "none", backgrounds: "roseNormal",
  }, ownership(), catalog);
  assert.deepEqual(plan.purchasable.map(item => item.id), ["roseNormal"]);
});

test("previously bought out-of-season sticker remains owned without new charge", () => {
  const sticker = "spookyBat";
  const offered = catalog.filter(item => !(item.category === "stickers" && item.id === sticker));
  const purchased = previewPurchasePlan({ stickers: sticker },
    ownership({ stickers: [sticker] }), offered);
  assert.equal(purchased.total, 0);
  assert.equal(purchased.unavailable.length, 0);
  assert.equal(purchased.entries[0].owned, true);
  const notOwned = previewPurchasePlan({ stickers: sticker }, ownership(), offered);
  assert.equal(notOwned.unavailable.length, 1);
  assert.equal(notOwned.total, 0);
});

test("owned custom HEX colors stay free; unowned codes cannot be bought via Purchase All", () => {
  const itemId = customColorId("#AABBCC");
  const paid = previewPurchasePlan({ fontColors: itemId },
    ownership({ fontColors: [itemId] }), catalog);
  assert.equal(paid.total, 0);
  assert.equal(paid.unavailable.length, 0);
  const unowned = previewPurchasePlan({ fontColors: itemId }, ownership(), catalog);
  assert.equal(unowned.unavailable.length, 1);
  assert.ok(CUSTOM_COLOR_PRICES.fontColors > 0);
});

test("preview purchase fingerprint changes if item price or selection changes", () => {
  const mix = { frames: "doubleLine", headerFont: "nunito" };
  const plan = previewPurchasePlan(mix, ownership(), catalog);
  const old = previewPurchaseFingerprint(plan);
  const changedPrice = catalog.map(item => item.category === "frames" && item.id === "doubleLine"
    ? { ...item, price: item.price + 5 } : item);
  assert.notEqual(previewPurchaseFingerprint(previewPurchasePlan(mix, ownership(), changedPrice)), old);
  assert.notEqual(previewPurchaseFingerprint(previewPurchasePlan(
    { frames: "softRounded", headerFont: "nunito" }, ownership(), catalog)), old);
  assert.notEqual(previewPurchaseFingerprint(previewPurchasePlan(mix,
    ownership({ frames: ["doubleLine"] }), catalog)), old);
});
