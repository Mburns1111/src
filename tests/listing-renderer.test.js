import test from "node:test";
import assert from "node:assert/strict";
import { renderPostImage } from "../services/post-renderer.js";
import { makeAppearanceControls, clearDraftStickers, adjustDraftSticker } from "../commands/profile.js";
import { FREE_APPEARANCE } from "../services/appearance-ownership.js";
import { stickerDefaults } from "../services/sticker-catalog.js";
import { newListingEditorToken, isListingEditorToken } from "../services/listing-editor-token.js";

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
      background: "sagePreview",
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

test("every generated Trading Post control routes to an accepted editor session", () => {
  const token = newListingEditorToken();
  for (const page of ["colors", "fonts", "details", "stickers"]) {
    for (const mode of ["position", "style"]) {
      const controls = makeAppearanceControls({
        discordUserId: "12345",
        profileAppearance: { background: "sagePreview", stickers: [stickerDefaults("star")] },
      }, page, 0, ownership, token, {}, mode, "listing:dm", "Save Trading Post Style");
      for (const control of controls.flatMap(row => row.toJSON().components)) {
        const parts = control.custom_id.split(":");
        assert.deepEqual(parts.slice(0, 2), ["listing", "dm"]);
        assert.ok(["select", "button"].includes(parts[2]));
        assert.equal(parts[3], token);
        assert.equal(isListingEditorToken(parts[3]), true);
      }
    }
  }
});

test("profile and listing editors expose Remove Sticker and Remove All in both sticker modes", () => {
  const cases = [
    { editorPrefix: "profile:dm", label: "Confirm & update profile" },
    { editorPrefix: "listing:dm", label: "Save Trading Post Style" },
  ];
  for (const { editorPrefix, label } of cases) {
    for (const mode of ["position", "style"]) {
      const rows = makeAppearanceControls({
        discordUserId: "12345",
        profileAppearance: { background: "sagePreview", stickers: [stickerDefaults("star")] },
      }, "stickers", 0, ownership, "abc123456789", {}, mode, editorPrefix, label)
        .map(row => row.toJSON().components);
      assert.ok(rows.length <= 5, `${editorPrefix}/${mode}: too many action rows`);
      assert.ok(rows.every(row => row.length <= 5), `${editorPrefix}/${mode}: too many controls in a row`);
      const controls = rows.flat();
      const removeOne = controls.find(item => item.label === "Remove Sticker");
      const clearAll = controls.find(item => item.label === "Remove All Stickers");
      assert.equal(removeOne?.custom_id, `${editorPrefix}:button:abc123456789:remove`);
      assert.equal(clearAll?.custom_id, `${editorPrefix}:button:abc123456789:clearStickers`);
    }
  }
});

test("removing one sticker preserves the others and does not remove ownership", () => {
  const draft = {
    appearance: { stickers: [stickerDefaults("star"), stickerDefaults("flower")] },
    selected: 0, stickerMode: "position",
  };
  adjustDraftSticker(draft, "remove");
  assert.deepEqual(draft.appearance.stickers.map(item => item.id), ["flower"]);
  assert.equal(draft.selected, 0);
  assert.ok(ownership.stickers.has("star"));
});

test("clearing all stickers leaves other appearance settings untouched", () => {
  const draft = {
    appearance: {
      background: "rosePastel", frame: "doubleLine",
      stickers: [stickerDefaults("star"), stickerDefaults("flower")],
    },
    selected: 1, stickerMode: "style",
  };
  clearDraftStickers(draft);
  assert.deepEqual(draft.appearance.stickers, []);
  assert.equal(draft.appearance.background, "rosePastel");
  assert.equal(draft.appearance.frame, "doubleLine");
  assert.equal(draft.selected, 0);
  assert.equal(draft.stickerMode, "position");
});

test("editor with no placed stickers retains placement controls but no removal buttons", () => {
  const rows = makeAppearanceControls({
    discordUserId: "12345",
    profileAppearance: { background: "sagePreview", stickers: [] },
  }, "stickers", 0, ownership, "abc123456789", {}, "position", "listing:dm", "Save Trading Post Style")
    .map(row => row.toJSON().components);
  assert.ok(rows.length <= 5);
  const buttons = rows.flat();
  assert.ok(!buttons.some(item => item.label === "Remove Sticker" || item.label === "Remove All Stickers"));
  const dropdown = buttons.find(item => item.custom_id?.endsWith(":stickerPick"));
  assert.ok(dropdown?.options.some(item => item.value === "add:star"));
});
