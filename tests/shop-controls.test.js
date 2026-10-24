import test from "node:test";
import assert from "node:assert/strict";
import {
  dmCategoryHomeControls, dmCategoryMenu, dmIndexTools, dmShopTools,
} from "../commands/shop.js";

const guildId = "123456789012345678";
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
