import test from "node:test";
import assert from "node:assert/strict";
import { tradingPostCardPayload } from "../services/trading-post-display.js";

test("the Trading Post has only its styled card embed, never a second old text embed", () => {
  const links = [
    "Outfit: [Pink outfit](https://discord.com/channels/123/456/789)",
    "House: [Dream house](https://discord.com/channels/123/456/790)",
    "[Inventory video](https://discord.com/channels/123/456/791)",
  ];
  const components = [{ type: "test" }];
  const message = tradingPostCardPayload(Buffer.from("fake"), links, components);
  assert.equal(message.embeds.length, 1);
  assert.equal(message.embeds[0].toJSON().image.url, "attachment://trading-post-card.png");
  assert.equal(message.embeds[0].toJSON().fields, undefined);
  assert.ok(links.every(link => message.content.includes(link)));
  assert.equal(message.components, components);
  assert.equal(message.files.length, 1);
});
test("Trading Post link output stays inside Discord 2,000 character limit", () => {
  const long = Array.from({ length: 20 }, (_, i) =>
    `[Outfit ${i}](https://discord.com/channels/123/456/${i.toString().repeat(110)})`);
  const message = tradingPostCardPayload(Buffer.from("fake"), long, []);
  assert.ok(message.content.length <= 1900);
  assert.equal(message.embeds.length, 1);
});
