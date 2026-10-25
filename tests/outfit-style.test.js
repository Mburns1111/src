import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { renderPostImage } from "../services/post-renderer.js";
import { makeAppearanceControls } from "../commands/profile.js";
import { FREE_APPEARANCE } from "../services/appearance-ownership.js";
import { stickerDefaults } from "../services/sticker-catalog.js";
import { outfitCardData, outfitPickerOptions, OUTFIT_PICK_PAGE_SIZE } from "../services/outfit-style.js";
import {
  isGalleryPhoto, isGalleryVideo, isGalleryMedia, mergeOriginalMedia, safePageIndex,
} from "../services/outfit-gallery-utils.js";
import { resizeOutfitImage } from "../services/outfit-gallery.js";

test("three outfit listings keep independent appearance and picker targets", () => {
  const records = [
    { _id: "a".repeat(24), title: "Pink", postAppearance: { background: "rosePastel" } },
    { _id: "b".repeat(24), title: "Dark", postAppearance: { background: "blackDark" } },
    { _id: "c".repeat(24), title: "Green", postAppearance: { background: "greenNormal" } },
  ];
  assert.equal(OUTFIT_PICK_PAGE_SIZE, 20);
  assert.deepEqual(outfitPickerOptions(records).map(item => item.value), records.map(r => r._id));
  records[1].postAppearance.background = "yellowPastel";
  assert.equal(records[0].postAppearance.background, "rosePastel");
  assert.equal(records[2].postAppearance.background, "greenNormal");
});

test("outfit canvas combines title, photo, cost, details and page indicator in one PNG", async () => {
  const source = createCanvas(220, 330);
  const ctx = source.getContext("2d");
  ctx.fillStyle = "#693B90";
  ctx.fillRect(0, 0, 220, 330);
  const photo = await resizeOutfitImage(source.toBuffer("image/png"));
  const data = {
    ...outfitCardData({
      title: "Pink cape", ownerName: "Seller", ownerRobloxUsername: "Player",
      cost: "5 VAL", description: "Warm and cozy",
    }),
    galleryIndex: 2, galleryCount: 3,
  };
  const png = await renderPostImage({
    type: "outfit", data, images: { photo },
    appearance: { stickers: [stickerDefaults("star")] },
  });
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 1000);
});

test("videos and photos are recognized while previously rendered cards are excluded", () => {
  const media = [
    { id: "1", name: "front.jpg", contentType: "image/jpeg" },
    { id: "2", name: "walk.mp4", contentType: "video/mp4" },
    { id: "3", name: "outfit-style-card.png", contentType: "image/png" },
  ];
  assert.deepEqual(media.filter(isGalleryPhoto).map(x => x.id), ["1"]);
  assert.deepEqual(media.filter(isGalleryVideo).map(x => x.id), ["2"]);
  assert.deepEqual(media.filter(isGalleryMedia).map(x => x.id), ["1", "2"]);
  const merged = mergeOriginalMedia([{ attachmentId: "1", name: "front.jpg",
    url: "https://cdn.discordapp.com/front.jpg" }], media);
  assert.equal(merged.length, 2);
});

test("gallery page numbering wraps without reading a second Discord post", () => {
  assert.equal(safePageIndex(-1, 3), 2);
  assert.equal(safePageIndex(3, 3), 0);
  assert.equal(safePageIndex(7, 3), 1);
});

test("appearance editor retains style controls for a photo-based listing", () => {
  const owned = Object.fromEntries(Object.entries(FREE_APPEARANCE).map(([k, ids]) =>
    [k, new Set([...ids, ...(k === "stickers" ? ["flower"] : [])])]));
  const profile = { discordUserId: "12345", profileAppearance: {
    background: "sagePreview", stickers: [stickerDefaults("flower")],
  } };
  for (const mode of ["position", "style"]) {
    const rows = makeAppearanceControls(profile, "stickers", 0, owned,
      "abc123456789", {}, mode, "listing:dm", "Save Outfit Style")
      .map(row => row.toJSON().components);
    assert.ok(rows.length <= 5);
    assert.ok(rows.flat().some(button => button.label === "Remove Sticker"));
    assert.ok(rows.flat().some(button => button.label === "Remove All Stickers"));
  }
});
