import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { renderPostImage } from "../services/post-renderer.js";
import { makeAppearanceControls } from "../commands/profile.js";
import { FREE_APPEARANCE } from "../services/appearance-ownership.js";
import { stickerDefaults } from "../services/sticker-catalog.js";
import { outfitCardData, outfitPickerOptions, OUTFIT_PICK_PAGE_SIZE } from "../services/outfit-style.js";
import {
  OUTFIT_BANNER_NAME, isGalleryPhoto, isGalleryVideo, isGalleryMedia,
  mergeOriginalMedia, galleryNavigationButtons, safePageIndex,
} from "../services/outfit-gallery-utils.js";
import { outfitBannerPayload } from "../services/outfit-card.js";
import { resizeOutfitImage, galleryMessagePayload } from "../services/outfit-gallery.js";

test("each of three outfit listings has its own independent style and picker ID", () => {
  const outfits = [
    { _id: "a".repeat(24), title: "Pink dress", postAppearance: { background: "rosePastel" } },
    { _id: "b".repeat(24), title: "Dark costume", postAppearance: { background: "blackDark" } },
    { _id: "c".repeat(24), title: "Green outfit", postAppearance: { background: "greenNormal" } },
  ];
  assert.deepEqual(outfitPickerOptions(outfits).map(x => x.value), outfits.map(x => x._id));
  outfits[1].postAppearance.background = "yellowPastel";
  assert.equal(outfits[0].postAppearance.background, "rosePastel");
  assert.equal(outfits[2].postAppearance.background, "greenNormal");
  assert.equal(OUTFIT_PICK_PAGE_SIZE, 20);
});

test("outfit banner keeps seller, cost and description but no photo", async () => {
  const data = outfitCardData({
    title: "My look", ownerName: "Seller", ownerRobloxUsername: "Player",
    description: "Really cute", cost: "300",
  });
  assert.deepEqual(data, {
    title: "My look", seller: "Seller · Player", cost: "300",
    description: "Really cute",
  });
  const png = await renderPostImage({
    type: "outfit", data, appearance: { stickers: [stickerDefaults("star")] },
  });
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 1000);
});

test("the original outfit post contains just the decorated banner and saved video files", () => {
  const listing = { title: "One", ownerName: "Tester", videoUrl: "https://example.com/video" };
  const videos = [
    { id: "vid1", name: "clip1.mp4", contentType: "video/mp4" },
    { id: "vid2", name: "clip2.webm", contentType: "video/webm" },
  ];
  const payload = outfitBannerPayload(listing, videos, Buffer.from("fake"));
  assert.deepEqual(payload.attachments, [{ id: "vid1" }, { id: "vid2" }]);
  assert.equal(payload.files[0].name, OUTFIT_BANNER_NAME);
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].toJSON().image.url, "attachment://" + OUTFIT_BANNER_NAME);
  assert.equal(payload.components, undefined, "original listing buttons stay intact");
  assert.match(payload.content, /Outfit video/);
});

test("old photos, new photos and videos are identifiable while artwork is excluded", () => {
  const assets = [
    { id: "photo1", name: "one.jpg", contentType: "image/jpeg" },
    { id: "photo2", name: "two.png", contentType: "image/png" },
    { id: "video", name: "clip.mp4", contentType: "video/mp4" },
    { id: "banner", name: OUTFIT_BANNER_NAME, contentType: "image/png" },
  ];
  assert.deepEqual(assets.filter(isGalleryPhoto).map(x => x.id), ["photo1", "photo2"]);
  assert.deepEqual(assets.filter(isGalleryVideo).map(x => x.id), ["video"]);
  assert.deepEqual(assets.filter(isGalleryMedia).map(x => x.id), ["photo1", "photo2", "video"]);
  const merged = mergeOriginalMedia([
    { attachmentId: "photo1", name: "one.jpg", url: "https://cdn.discordapp.com/one.jpg" },
  ], assets);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].attachmentId, "photo1");
});

test("flipbook navigation is circular and uses one page image at a time", () => {
  assert.deepEqual(galleryNavigationButtons(0, 3), { previous: 2, next: 1, count: 3 });
  assert.deepEqual(galleryNavigationButtons(2, 3), { previous: 1, next: 0, count: 3 });
  assert.equal(safePageIndex(-1, 3), 2);
  assert.equal(safePageIndex(3, 3), 0);
  const listing = {
    _id: "a".repeat(24), guildId: "123456789012345678",
    title: "Three views", postChannelId: "123456789012345678",
    postMessageId: "123456789012345678",
  };
  const payload = galleryMessagePayload(listing, 2, 3);
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].toJSON().image.url, "attachment://outfit-gallery-page.jpg");
  assert.match(payload.content, /3 \/ 3/);
  assert.equal(payload.components.length, 1);
  assert.deepEqual(payload.components[0].toJSON().components.map(x => x.label), ["◀ Previous", "Next ▶"]);
});

test("large images resize to a stable JPEG, leaving the originals unchanged", async () => {
  const cv = createCanvas(1400, 960);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#763BA8"; ctx.fillRect(0, 0, 1400, 960);
  const source = cv.toBuffer("image/png");
  const resized = await resizeOutfitImage(source);
  assert.ok(Buffer.isBuffer(resized));
  assert.deepEqual(Array.from(resized.subarray(0, 3)), [255, 216, 255]);
  assert.ok(resized.length < source.length || resized.length > 500);
});

test("outfit editor uses the same purchased style controls under Discord limits", () => {
  const owned = Object.fromEntries(Object.entries(FREE_APPEARANCE).map(([k, v]) =>
    [k, new Set([...v, ...(k === "stickers" ? ["flower"] : [])])]));
  const member = { discordUserId: "1234", profileAppearance: {
    background: "sagePreview", stickers: [stickerDefaults("flower")],
  } };
  for (const page of ["colors", "fonts", "details", "stickers"]) {
    for (const mode of ["position", "style"]) {
      const rows = makeAppearanceControls(member, page, 0, owned, "123456789abc", {}, mode,
        "listing:dm", "Save Outfit Style").map(r => r.toJSON().components);
      assert.ok(rows.length <= 5);
      assert.ok(rows.every(r => r.length <= 5));
      if (page === "stickers") {
        assert.ok(rows.flat().some(c => c.label === "Remove Sticker"));
        assert.ok(rows.flat().some(c => c.label === "Remove All Stickers"));
      }
    }
  }
});
