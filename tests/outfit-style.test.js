import test from "node:test";
import assert from "node:assert/strict";
import { OUTFIT_PICK_PAGE_SIZE, outfitPhotoUrl, outfitPhotoUrls, outfitCardData, outfitPickerOptions, outfitGalleryMedia, outfitStylePlacement, isOutfitMediaAttachment, OUTFIT_STYLE_IMAGE_NAME } from "../services/outfit-style.js";
import { renderPostImage } from "../services/post-renderer.js";
import { makeAppearanceControls } from "../commands/profile.js";
import { FREE_APPEARANCE } from "../services/appearance-ownership.js";
import { stickerDefaults } from "../services/sticker-catalog.js";

test("two or three outfit records keep independent appearance and picker identity", () => {
  const outfits = [
    { _id: "a".repeat(24), title: "Pink dress", cost: "150", postAppearance: { background: "rosePastel" } },
    { _id: "b".repeat(24), title: "Dark costume", cost: "200", postAppearance: { background: "blackDark" } },
    { _id: "c".repeat(24), title: "Green set", cost: "300", postAppearance: { background: "greenNormal" } },
  ];
  const opts = outfitPickerOptions(outfits);
  assert.equal(OUTFIT_PICK_PAGE_SIZE, 20);
  assert.deepEqual(opts.map(opt => opt.value), outfits.map(o => o._id));
  outfits[1].postAppearance.background = "yellowPastel";
  assert.equal(outfits[0].postAppearance.background, "rosePastel");
  assert.equal(outfits[2].postAppearance.background, "greenNormal");
});

test("choose only image media for the styled photo; never replace the video gallery", () => {
  const listing = { mediaAttachments: [
    { url: "https://cdn.discordapp.com/a.mp4", name: "a.mp4", contentType: "video/mp4" },
    { url: "https://cdn.discordapp.com/b.jpg", name: "b.jpg", contentType: "image/jpeg" },
    { url: "https://cdn.discordapp.com/c.png", name: "c.png", contentType: "image/png" },
  ] };
  assert.equal(outfitPhotoUrl(listing), "https://cdn.discordapp.com/b.jpg");
  assert.equal(listing.mediaAttachments.length, 3);
  assert.equal(outfitPhotoUrl({ mediaAttachments: [] }), null);
});

test("outfit style data keeps the seller, title, cost and description", () => {
  assert.deepEqual(outfitCardData({
    title: "A look", ownerName: "Member", ownerRobloxUsername: "Player",
    cost: "100", description: "An elegant outfit",
  }), {
    title: "A look", seller: "Member · Player",
    cost: "100", description: "An elegant outfit",
  });
});

test("outfits render with independent decorative styles even without uploaded photos", async () => {
  for (const look of [
    { background: "rosePastel", stickers: [] },
    { background: "black", stickers: [stickerDefaults("star")] },
  ]) {
    const png = await renderPostImage({
      type: "outfit",
      data: {
        title: "My fancy look", seller: "Member · Roblox",
        cost: "100", description: "Pretty shoes and a bow",
      },
      appearance: look,
    });
    assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(png.length > 1000);
  }
});

test("outfit editors share the familiar profile style controls without exceeding Discord row limits", () => {
  const owned = Object.fromEntries(Object.entries(FREE_APPEARANCE).map(([k, v]) => [
    k, new Set([...v, ...(k === "stickers" ? ["flower"] : [])]),
  ]));
  const sample = {
    discordUserId: "1234567890",
    profileAppearance: { background: "sagePreview", stickers: [stickerDefaults("flower")] },
  };
  for (const page of ["colors", "fonts", "details", "stickers"]) {
    for (const mode of ["position", "style"]) {
      const rows = makeAppearanceControls(sample, page, 0, owned, "123456789abc", {}, mode,
        "listing:dm", "Save Outfit Style").map(row => row.toJSON().components);
      assert.ok(rows.length <= 5);
      assert.ok(rows.every(row => row.length <= 5));
      const buttons = rows.flat();
      assert.ok(buttons.some(c => c.label === "Save Outfit Style"));
      if (page === "stickers") {
        assert.ok(buttons.some(c => c.label === "Remove Sticker"));
        assert.ok(buttons.some(c => c.label === "Remove All Stickers"));
      }
    }
  }
});

test("outfit picker scales beyond 3 listings without losing identity", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    _id: i.toString(16).padStart(24, "0"), title: `Outfit ${i + 1}`,
  }));
  const options = outfitPickerOptions(items);
  assert.equal(options.length, OUTFIT_PICK_PAGE_SIZE);
  assert.equal(new Set(options.map(item => item.value)).size, 20);
});

test("style PNG is never counted as an uploaded outfit picture", () => {
  const media = [
    { id: "media1", name: "look-front.jpg", contentType: "image/jpeg" },
    { id: "style", name: OUTFIT_STYLE_IMAGE_NAME, contentType: "image/png" },
    { id: "media2", name: "look-back.png", contentType: "image/png" },
    { id: "media3", name: "walkthrough.mp4", contentType: "video/mp4" },
  ];
  assert.equal(isOutfitMediaAttachment(media[1]), false);
  assert.deepEqual(outfitGalleryMedia(media).map(x => x.id),
    ["media1", "media2", "media3"]);
  assert.deepEqual(media.map(x => x.id), ["media1", "style", "media2", "media3"],
    "The source gallery collection is not mutated");
});

test("outfit cards live on the original message with space, never evict ten uploads", () => {
  for (const count of [0, 1, 2, 3, 9]) {
    assert.equal(outfitStylePlacement(count), "original");
    assert.ok(count + 1 <= 10);
  }
  assert.equal(outfitStylePlacement(10), "reply");
  for (const invalid of [-1, 11, 1.2, null]) {
    assert.throws(() => outfitStylePlacement(invalid), RangeError);
  }
});

test("outfit collage includes three photo URLs without including videos", () => {
  const gallery = { mediaAttachments: [
    { url: "https://cdn.discordapp.com/1.jpg", name: "1.jpg", contentType: "image/jpeg" },
    { url: "https://cdn.discordapp.com/video.mp4", name: "video.mp4", contentType: "video/mp4" },
    { url: "https://cdn.discordapp.com/2.jpg", name: "2.jpg", contentType: "image/jpeg" },
    { url: "https://cdn.discordapp.com/3.png", name: "3.png", contentType: "image/png" },
    { url: "https://cdn.discordapp.com/4.jpg", name: "4.jpg", contentType: "image/jpeg" },
  ] };
  assert.deepEqual(outfitPhotoUrls(gallery), [
    "https://cdn.discordapp.com/1.jpg",
    "https://cdn.discordapp.com/2.jpg",
    "https://cdn.discordapp.com/3.png",
  ]);
  assert.equal(gallery.mediaAttachments.length, 5);
});
