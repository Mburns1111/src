import test from "node:test";
import assert from "node:assert/strict";
import { OUTFIT_PICK_PAGE_SIZE, outfitPhotoUrl, outfitCardData, outfitPickerOptions } from "../services/outfit-style.js";
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
