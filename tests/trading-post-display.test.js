import test from "node:test";
import assert from "node:assert/strict";
import {
  tradingPostCardPayload,
  tradingPostPreviewPayload,
} from "../services/trading-post-display.js";

const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test("Trading Post image is a native Discord attachment without any embeds", () => {
  const links = [
    "Outfit: [Pink outfit](https://discord.com/channels/123/456/789)",
    "House: [Dream house](https://discord.com/channels/123/456/790)",
    "[Inventory video](https://discord.com/channels/123/456/791)",
  ];
  const components = [{ type: "test" }];
  const message = tradingPostCardPayload(image, links, components);
  assert.deepEqual(message.embeds, [], "old styled and legacy embeds must be cleared");
  assert.deepEqual(message.attachments, [], "old artwork must not be duplicated on edit");
  assert.equal(message.files.length, 1);
  assert.equal(message.files[0].name, "trading-post-card.png");
  assert.deepEqual(message.files[0].attachment, image);
  assert.ok(links.every(link => message.content.includes(link)));
  assert.equal(message.components, components);
  assert.deepEqual(message.allowedMentions, { parse: [] });
});

test("Refreshing an existing Trading Post clears old embeds instead of appending an image", async () => {
  const oldCard = {
    embeds: [{ title: "Old Trading Post" }, { description: "Old details" }],
    attachments: [{ id: "old-image" }],
  };
  const payload = tradingPostCardPayload(image, ["[Outfit](https://discord.com/channels/1/2/3)"], ["buttons"]);
  const updated = await {
    edit: async value => ({
      ...oldCard,
      embeds: value.embeds,
      attachments: value.files,
      components: value.components,
      content: value.content,
    }),
  }.edit(payload);
  assert.deepEqual(updated.embeds, []);
  assert.equal(updated.attachments.length, 1);
  assert.equal(updated.attachments[0].name, "trading-post-card.png");
  assert.deepEqual(updated.components, ["buttons"]);
});

test("Trading Post link output stays inside Discord 2,000 character limit", () => {
  const long = Array.from({ length: 20 }, (_, i) =>
    `[Outfit ${i}](https://discord.com/channels/123/456/${i.toString().repeat(110)})`);
  const message = tradingPostCardPayload(image, long, []);
  assert.ok(message.content.length <= 1900);
  assert.deepEqual(message.embeds, []);
});

test("Trading Post private preview uses the same plain image presentation", () => {
  const controls = [{ type: "preview-button" }];
  const preview = tradingPostPreviewPayload(image, "Edit your Trading Post", controls);
  assert.deepEqual(preview.embeds, []);
  assert.deepEqual(preview.attachments, []);
  assert.equal(preview.files.length, 1);
  assert.equal(preview.files[0].name, "trading-post-preview.png");
  assert.deepEqual(preview.files[0].attachment, image);
  assert.equal(preview.content, "Edit your Trading Post");
  assert.equal(preview.components, controls);
});
