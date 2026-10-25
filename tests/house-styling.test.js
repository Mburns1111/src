import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { POST_LAYOUTS } from "../services/post-layouts.js";
import { renderPostImage } from "../services/post-renderer.js";
import { houseActionComponents } from "../services/house-components.js";
import { houseCardPayload } from "../services/house-card.js";
import { houseCardData, housePickerOptions, isGalleryPhoto, mergeOriginalMedia } from "../services/house-style.js";
import { snapshotListingAppearance } from "../services/listing-appearance.js";
import { FREE_APPEARANCE } from "../services/appearance-ownership.js";
import { stickerDefaults } from "../services/sticker-catalog.js";
import { makeAppearanceControls } from "../commands/profile.js";

const listing = {
  _id: "6add69d69249c7f6f595751d", guildId: "1561372971355086958",
  ownerId: "999999999999999999", ownerName: "LILLY",
  ownerRobloxUsername: "RobloxPlayer", title: "Floral House",
  description: "Beautiful balcony and garden", askingPrice: "20 VAL",
  estimatedValue: "30 VAL", interestedUserIds: [],
  notifyOnInterest: false, galleryPageIndex: 0, mediaAttachments: [],
};
test("house card renders a valid PNG with optional uploaded photo", async () => {
  const canvas = createCanvas(45, 45);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#666666"; ctx.fillRect(0, 0, 45, 45);
  const png = await renderPostImage({
    type: "house",
    data: { ...houseCardData(listing), galleryIndex: 1, galleryCount: 3 },
    images: { photo: canvas.toBuffer("image/png") },
  });
  assert.deepEqual([...png.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
  assert.ok(png.length > 1000);
});
test("house artwork is exactly half the outfit-style house canvas height", async () => {
  assert.equal(POST_LAYOUTS.house.width, 1200);
  assert.equal(POST_LAYOUTS.house.height, 430);
  assert.equal(POST_LAYOUTS.outfit.height, 860, "Outfit size must not change");

  const photo = createCanvas(160, 250);
  const ctx = photo.getContext("2d");
  ctx.fillStyle = "#865D8B";
  ctx.fillRect(0, 0, 160, 250);
  for (const images of [{}, { photo: photo.toBuffer("image/png") }]) {
    const png = await renderPostImage({
      type: "house",
      data: { ...houseCardData(listing),
        title: "A pretty and very detailed cottage home",
        description: "A long, lovely garden and multiple rooms on the first floor with space for friends and decorations.",
        galleryIndex: 2, galleryCount: 3,
      },
      images,
      appearance: { stickers: [stickerDefaults("star")] },
    });
    assert.deepEqual([...png.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
    assert.equal(png.readUInt32BE(16), 1200, "PNG IHDR width");
    assert.equal(png.readUInt32BE(20), 430, "PNG IHDR height");
    assert.ok(png.length > 1000);
  }
});

test("house photo pagination and seller controls share ONE message", () => {
  const rows = houseActionComponents(listing, 3).map(r => r.toJSON().components);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].map(b => b.label), ["◀ Previous", "Photo 1 / 3", "Next ▶", "Choose photo"]);
  assert.equal(rows[0][1].disabled, true);
  assert.deepEqual(rows[1].map(b => b.label), [
    "Mark sold", "Interested (0)", "Interest DMs: Off",
  ]);
  assert.equal(rows[0][2].custom_id, `house:page:next:${listing._id}`);
  assert.equal(rows[0][3].custom_id, `house:page:choose:${listing._id}`);
  const payload = houseCardPayload(listing, { count: 3 }, Buffer.from("test"));
  assert.equal(payload.embeds[0].toJSON().image.url, "attachment://house-style-card.png");
  assert.equal(payload.files[0].name, "house-style-card.png");
  assert.equal(payload.components.length, 2);
  assert.deepEqual(payload.attachments, []);
});
test("house videos stay native above the styled embed card in the SAME message", () => {
  const record = { ...listing, mediaMessageId: "" };
  const videos = [{ id: "555555555555555555", name: "tour.mp4", contentType: "video/mp4" }];
  const payload = houseCardPayload(record, { count: 1 }, Buffer.from("test"), videos);
  assert.deepEqual(payload.attachments, [{ id: videos[0].id }]);
  assert.equal(payload.files.length, 1);
  assert.equal(payload.components.length, 1);
  assert.equal(payload.embeds[0].toJSON().image.url, "attachment://house-style-card.png");
  assert.doesNotMatch(payload.content, /Watch house video tour/);
});
test("generated house artwork is NEVER treated as a buyer photo", () => {
  const media = [
    { id: "a", name: "front.jpg", contentType: "image/jpeg" },
    { id: "b", name: "house-style-card.png", contentType: "image/png" },
    { id: "c", name: "walk.mp4", contentType: "video/mp4" },
  ];
  assert.deepEqual(media.filter(isGalleryPhoto).map(x => x.id), ["a"]);
  assert.deepEqual(mergeOriginalMedia([], media).map(x => x.attachmentId), ["a", "c"]);
});
test("houses can use three different independent appearances from shared purchases", () => {
  const owned = Object.fromEntries(Object.entries(FREE_APPEARANCE).map(([k,v]) =>
    [k, new Set([...v, ...(k === "backgrounds" ? ["rosePastel"] : [])])]));
  const profile = { profileAppearance: {
    background: "rosePastel", stickers: [stickerDefaults("star")],
  } };
  const houses = Array.from({ length: 3 }, (_, i) =>
    ({ ...listing, _id: i.toString(16).padStart(24, "0"), postAppearance: snapshotListingAppearance(profile, owned) }));
  houses[0].postAppearance.background = "rosePastel";
  houses[1].postAppearance.background = "default";
  houses[2].postAppearance.frame = "default";
  assert.notEqual(houses[0].postAppearance.background, houses[1].postAppearance.background);
  assert.deepEqual(houses.map(x => x.postAppearance.stickers), [[],[],[]]);
  assert.equal(housePickerOptions(houses).length, 3);
  assert.equal(new Set(housePickerOptions(houses).map(x => x.value)).size, 3);
});
test("House DM editor uses reusable controls with Remove Sticker and Remove All", () => {
  const owned = Object.fromEntries(Object.entries(FREE_APPEARANCE).map(([k,v]) =>
    [k, new Set([...v, ...(k === "stickers" ? ["star"] : [])])]));
  const member = { profileAppearance: {
    background: "sagePreview", stickers: [stickerDefaults("star")],
  } };
  for (const mode of ["position", "style"]) {
    const rows = makeAppearanceControls(member, "stickers", 0, owned,
      "abc123456789", {}, mode, "listing:dm", "Save House Style")
      .map(row => row.toJSON().components);
    assert.ok(rows.length <= 5 && rows.every(row => row.length <= 5));
    assert.ok(rows.flat().some(button => button.label === "Save House Style"));
    assert.ok(rows.flat().some(button => button.label === "Remove Sticker"));
    assert.ok(rows.flat().some(button => button.label === "Remove All Stickers"));
  }
});
