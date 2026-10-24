import test from "node:test";
import assert from "node:assert/strict";
import { renderPostImage } from "../services/post-renderer.js";
import { makeAppearanceControls } from "../commands/profile.js";
import { FREE_APPEARANCE } from "../services/appearance-ownership.js";
import { stickerDefaults } from "../services/sticker-catalog.js";

const ownership = Object.fromEntries(Object.entries(FREE_APPEARANCE).map(([name, ids]) =>
  [name, new Set([ ...ids, ...(name === "stickers" ? ["star"] : []) ])]));

test("Trading Post renders a valid PNG with the shared appearance pipeline", async () => {
  const png = await renderPostImage({
    type: "tradingPost",
    data: {
      discordName: "Tester",
      robloxName: "RobloxTester",
      lookingFor: "A red dragon",
      willingToTrade: "A blue unicorn",
    },
    appearance: { stickers: [stickerDefaults("star")] },
  });
  assert.ok(Buffer.isBuffer(png));
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 1000);
});

test("shared controls target a separate listing editor instead of profile handlers", () => {
  const controls = makeAppearanceControls(
    { discordUserId: "12345", profileAppearance: {} },
    "colors", 0, ownership, "abc123456789", {}, "position",
    "listing:dm", "Save Trading Post Style",
  );
  const rows = controls.map(row => row.toJSON());
  assert.ok(rows.length <= 5);
  const items = rows.flatMap(row => row.components);
  assert.ok(items.every(item => item.custom_id?.startsWith("listing:dm:")));
  assert.ok(items.some(item => item.label === "Save Trading Post Style"));
});

test("sticker buttons fit Discord row limits and point to the listing editor", () => {
  const controls = makeAppearanceControls(
    { discordUserId: "12345", profileAppearance: {
      stickers: [stickerDefaults("star")],
    } },
    "stickers", 0, ownership, "abc123456789", {}, "position",
    "listing:dm", "Save Trading Post Style",
  );
  const rows = controls.map(row => row.toJSON());
  assert.ok(rows.length <= 5);
  const controlsFlat = rows.flatMap(row => row.components);
  assert.ok(controlsFlat.some(item => item.label === "Colors & Style"));
  assert.ok(controlsFlat.some(item => item.custom_id === "listing:dm:button:abc123456789:confirm"));
});
