import test from "node:test";
import assert from "node:assert/strict";
import { OUTFIT_PICK_PAGE_SIZE, outfitPhotoUrl, outfitCardData, outfitPickerOptions } from "../services/outfit-style.js";

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
