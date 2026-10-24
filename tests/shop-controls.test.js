import test from "node:test";
import assert from "node:assert/strict";
import {
  dmCategoryHomeControls, dmCategoryMenu, dmIndexTools, dmShopTools, mixEditorChrome,
} from "../commands/shop.js";

import { previewPurchasePlan } from "../services/shop-mix-checkout.js";
import { FREE_APPEARANCE } from "../services/appearance-ownership.js";
import { customColorId } from "../services/custom-colors.js";

const guildId = "123456789012345678";
const owned = extra => Object.fromEntries(Object.entries(FREE_APPEARANCE)
  .map(([category, ids]) => [category, new Set([...ids, ...(extra?.[category] || [])])]));
const previewChrome = (category, mix, ownership = owned(), balance = 10000) =>
  mixEditorChrome({ guildId }, {
    shopMixCategory: category, shopMixOptionPage: 0, shopMixFontScope: "both",
  }, mix, ownership, previewPurchasePlan(mix, ownership), balance);
const components = row => row.toJSON().components;

test("shop home presents all six direct category buttons within Discord action-row limits", () => {
  const rows = dmCategoryHomeControls(guildId);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => components(row).length <= 5));

  const categoryButtons = rows.slice(0, -1).flatMap(components);
  assert.deepEqual(categoryButtons.map(button => button.label), [
    "Backgrounds", "Panels", "Frames", "Fonts", "Text Colors", "Stickers",
  ]);
  assert.deepEqual(categoryButtons.map(button => button.custom_id), [
    "backgrounds", "panels", "frames", "fonts", "fontColors", "stickers",
  ].map(category => `shop:dm:${guildId}:index:${category}:0`));

  const tools = components(rows.at(-1));
  assert.deepEqual(tools.map(button => button.label), ["Preview Multiple", "Customize Profile"]);
  assert.equal(tools[0].custom_id, `shop:dm:${guildId}:hubMix:backgrounds:0`);
});

test("category picker explicitly prompts navigation rather than showing just Stickers", () => {
  const menu = components(dmCategoryMenu(guildId, "stickers"))[0];
  assert.match(menu.placeholder, /^Switch Category/);
  assert.match(menu.placeholder, /Stickers/);
  assert.equal(menu.custom_id, `shop:dm:${guildId}:category`);
  assert.equal(menu.options.length, 6);
  assert.ok(menu.options.every(option => option.default !== true));
  assert.equal(menu.options.find(option => option.value === "backgrounds").label, "Backgrounds");
});

test("category indexes and item pages both expose All Categories and Preview Multiple", () => {
  const screens = [
    components(dmIndexTools(guildId, "stickers", 0)),
    components(dmShopTools(guildId, "stickers", 3)),
  ];
  for (const buttons of screens) {
    assert.ok(buttons.length <= 5);
    const labels = buttons.map(button => button.label);
    assert.ok(labels.includes("Preview Multiple"));
    assert.ok(labels.includes("All Categories"));
    assert.ok(!labels.includes("Mix & Match"));
    assert.equal(buttons.find(button => button.label === "All Categories").custom_id,
      `shop:dm:${guildId}:home`);
  }
});

test("Preview Multiple displays itemized total with one confirmable Purchase All button", () => {
  const mix = { backgrounds: "yellowPastel", headerFont: "nunito", bodyFont: "nunito" };
  const result = previewChrome("fonts", mix);
  const rows = result.components.map(row => row.toJSON().components);
  assert.ok(rows.length <= 5);
  assert.ok(rows.every(row => row.length <= 5));
  assert.match(result.content, /Purchase summary/);
  const plan = previewPurchasePlan(mix, owned());
  assert.match(result.content, new RegExp(`Purchase All total: ${plan.total} Points`));
  assert.equal(plan.purchasable.filter(item => item.category === "fonts").length, 1);
  const buttons = rows.at(-1);
  const purchase = buttons.find(item => item.custom_id === `shop:dm:${guildId}:mixCheckout`);
  assert.ok(purchase, "Purchase All is in the existing bottom row");
  assert.equal(purchase.disabled, false);
  assert.ok(buttons.length <= 5);
});

test("Preview Multiple retains at most five controls on Text Colors and owned HEX pages", () => {
  const color = customColorId("#112233");
  const owner = owned({ backgrounds: [color] });
  const examples = [
    previewChrome("fontColors", { headerFont: "nunito" }, owner),
    previewChrome("backgrounds", { backgrounds: color }, owner),
    previewChrome("backgrounds", { backgrounds: "roseDark" }, owner, 0),
  ];
  for (const chrome of examples) {
    const rows = chrome.components.map(row => row.toJSON().components);
    assert.ok(rows.length <= 5);
    assert.ok(rows.every(row => row.length <= 5));
  }
  const customButtons = examples[0].components.at(-1).toJSON().components;
  assert.equal(customButtons.length, 5,
    "Text Colors keeps Enter Custom HEX and Purchase All without exceeding Discord limits");
  const unpaid = examples[2].components.at(-1).toJSON().components
    .find(item => item.custom_id === `shop:dm:${guildId}:mixCheckout`);
  assert.equal(unpaid.disabled, true, "insufficient Points prevent checkout");
  const allOwned = examples[1].components.at(-1).toJSON().components
    .find(item => item.custom_id === `shop:dm:${guildId}:mixCheckout`);
  assert.equal(allOwned.disabled, true, "previously purchased HEX has no new cost");
});
