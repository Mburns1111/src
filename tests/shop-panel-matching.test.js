import test from "node:test";
import assert from "node:assert/strict";
import {
  FREE_APPEARANCE, filterOwnedAppearance, ownsAppearanceItem,
} from "../services/appearance-ownership.js";
import { APPEARANCE_CATALOG } from "../services/post-appearance.js";
import { tryOnShopMix } from "../services/shop-preview-mix.js";
import { previewPurchasePlan } from "../services/shop-mix-checkout.js";
import { shopItems } from "../services/shop-catalog.js";
import { STANDARD_PANEL_ID, STANDARD_BACKGROUND_ID } from "../services/classic-colors.js";

function owner(extra = {}) {
  return Object.fromEntries(Object.entries(FREE_APPEARANCE).map(([category, defaults]) =>
    [category, new Set([...defaults, ...(extra[category] || [])])]));
}

test("owned Classic background permits free Match Background without granting a panel license", () => {
  const ownership = owner({ backgrounds: ["roseDark"] });
  const saved = filterOwnedAppearance({
    background: "roseDark", panelColor: "match",
  }, ownership);
  assert.equal(saved.background, "roseDark");
  assert.equal(saved.panelColor, "match");
  assert.equal(ownsAppearanceItem(ownership, "panels", "roseDark"), false);
  assert.deepEqual(APPEARANCE_CATALOG.backgrounds[saved.background].palette.panel,
    APPEARANCE_CATALOG.panels.roseDark.palette.panel);
  const quote = previewPurchasePlan({ backgrounds: "roseDark", panels: "match" }, ownership);
  assert.equal(quote.total, 0);
  assert.ok(!quote.purchasable.some(item => item.category === "panels"));
});

test("free matching follows current background but NEVER unlocks that color for other backgrounds", () => {
  const ownership = owner({ backgrounds: ["roseDark", "yellowPastel"] });
  const first = filterOwnedAppearance({ background: "roseDark", panelColor: "match" }, ownership);
  const second = filterOwnedAppearance({ ...first, background: "yellowPastel" }, ownership);
  assert.equal(second.background, "yellowPastel");
  assert.equal(second.panelColor, "match");
  assert.notEqual(APPEARANCE_CATALOG.backgrounds[first.background].palette.panel,
    APPEARANCE_CATALOG.backgrounds[second.background].palette.panel);
  assert.equal(ownsAppearanceItem(ownership, "panels", "roseDark"), false);
  // Trying to reuse the old rose-colored panel by its exact item ID resets to
  // the owned/free gray standard panel instead of keeping the old color.
  const denied = filterOwnedAppearance({
    background: "yellowPastel", panelColor: "roseDark",
  }, ownership);
  assert.equal(denied.panelColor, STANDARD_PANEL_ID);
});

test("choosing a fixed Classic panel color requires purchasing it even with matching background owned", () => {
  const ownership = owner({ backgrounds: ["roseDark", "yellowPastel"] });
  const plan = previewPurchasePlan({
    backgrounds: "roseDark", panels: "roseDark",
  }, ownership, shopItems());
  assert.deepEqual(plan.purchasable.map(item => [item.category, item.id, item.price]),
    [["panels", "roseDark", 60]]);
  assert.equal(plan.total, 60);
  assert.equal(filterOwnedAppearance({
    background: "roseDark", panelColor: "roseDark",
  }, ownership).panelColor, STANDARD_PANEL_ID);
});

test("buying the panel separately permits using that exact panel on any owned background", () => {
  const ownership = owner({
    backgrounds: ["roseDark", "yellowPastel"],
    panels: ["roseDark"],
  });
  const saved = filterOwnedAppearance({
    background: "yellowPastel", panelColor: "roseDark",
  }, ownership);
  assert.equal(saved.panelColor, "roseDark");
  assert.notEqual(saved.background, saved.panelColor);
  assert.equal(ownsAppearanceItem(ownership, "panels", "roseDark"), true);
  const plan = previewPurchasePlan({ backgrounds: "yellowPastel", panels: "roseDark" }, ownership);
  assert.equal(plan.total, 0);
});

test("Preview Multiple Match Background stays a dynamic try-on without a payable panel", () => {
  const ownership = owner({ backgrounds: ["yellowPastel"] });
  const shown = tryOnShopMix({
    background: "yellowPastel", panelColor: STANDARD_PANEL_ID,
  }, { backgrounds: "roseDark", panels: "match" });
  assert.equal(shown.background, "roseDark");
  assert.equal(shown.panelColor, "match");
  assert.equal(ownsAppearanceItem(ownership, "panels", "roseDark"), false);
  const plan = previewPurchasePlan({ backgrounds: "roseDark", panels: "match" }, ownership);
  assert.deepEqual(plan.purchasable.map(item => [item.category, item.id]),
    [["backgrounds", "roseDark"]]);
  assert.equal(plan.total, 75);
});

test("unowned backgrounds cannot be equipped to exploit free matching", () => {
  const ownership = owner();
  const saved = filterOwnedAppearance({ background: "roseDark", panelColor: "match" }, ownership);
  assert.equal(saved.background, STANDARD_BACKGROUND_ID);
  assert.equal(saved.panelColor, "match");
  assert.equal(ownsAppearanceItem(ownership, "backgrounds", "roseDark"), false);
});
