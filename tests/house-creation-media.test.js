import test from "node:test";
import assert from "node:assert/strict";
import {
  makeCreateListingModal, validateHouseCreationUploads,
  handleHouseButton, handleHouseModal,
} from "../commands/house.js";
import { houseActionComponents } from "../services/house-components.js";
import { houseCardPayload } from "../services/house-card.js";
import { houseNeedsFormatUpgrade } from "../services/house-availability.js";

const owner = "123456789012345678";
const houseId = "6add69d69249c7f6f595751d";
const originalPost = { channelId: "222222222222222222", id: "333333333333333333" };
const house = {
  _id: houseId, title: "Snowy Cottage", ownerName: "LILLY",
  interestedUserIds: [], notifyOnInterest: false, galleryPageIndex: 0,
  mediaAttachments: [], cardLayoutVersion: 1,
};
const photo = index => ({
  id: `photo-${index}`, name: `house-${index}.jpg`, contentType: "image/jpeg",
  url: `https://cdn.discordapp.com/house-${index}.jpg`, size: 30000,
});
const video = index => ({
  id: `video-${index}`, name: `tour-${index}.mp4`, contentType: "video/mp4",
  url: `https://cdn.discordapp.com/tour-${index}.mp4`, size: 500000,
});

test("the creation form REQUIRES photo/video upload alongside four house details", () => {
  const modal = makeCreateListingModal(owner, originalPost).toJSON();
  assert.equal(modal.components.length, 5, "Discord modal allows exactly five fields");
  const fields = modal.components.map(label => label.component);
  assert.deepEqual(fields.slice(0, 4).map(field => field.custom_id),
    ["title", "description", "asking_price", "estimated_value"]);
  const uploader = fields[4];
  assert.equal(uploader.custom_id, "house_media");
  assert.equal(uploader.min_values, 1);
  assert.equal(uploader.max_values, 10);
  assert.ok(!fields.some(field => field.custom_id === "video_url"),
    "replace optional URL field to make space for mandatory media");
});

test("creation validation accepts photo-only, video-only and mixed media", () => {
  for (const assets of [
    [photo(1)],
    [video(1)],
    [photo(1), photo(2), photo(3)],
    [video(1), video(2), photo(1)],
    Array.from({ length: 10 }, (_, i) => photo(i)),
    [...Array.from({ length: 9 }, (_, i) => video(i)), photo(10)],
  ]) {
    const { photos, videos } = validateHouseCreationUploads(assets);
    assert.equal(photos.length + videos.length, assets.length);
  }
});

test("creation validation rejects missing media, unsupported attachments and ten videos", () => {
  for (const assets of [
    [],
    Array.from({ length: 11 }, (_, i) => photo(i)),
    Array.from({ length: 10 }, (_, i) => video(i)),
    [{ ...photo(1), contentType: "application/pdf", name: "floorplan.pdf" }],
  ]) assert.throws(() => validateHouseCreationUploads(assets));
});

test("no post-creation Add Pictures/Video button is published", () => {
  const labels = houseActionComponents(house, 3).flatMap(row =>
    row.toJSON().components.map(item => item.label));
  assert.deepEqual(labels, [
    "◀ Previous", "Photo 1 / 3", "Next ▶",
    "Mark sold", "Interested (0)", "Interest DMs: Off",
  ]);
  const photoOnly = houseCardPayload(house, { count: 3 }, Buffer.from("fake"));
  const videoOnly = houseCardPayload({ ...house, mediaMessageId: "555555555555555555" }, { count: 0 }, Buffer.from("fake"));
  assert.equal(photoOnly.components.length, 2);
  assert.equal(videoOnly.components.length, 1);
  assert.deepEqual(videoOnly.attachments, [], "Videos are deliberately NOT attached to the house artwork post");
  assert.match(videoOnly.content, /Watch house video tour/);
  assert.deepEqual(photoOnly.embeds, []);
  assert.deepEqual(videoOnly.embeds, []);
});

test("old public Add pictures/video button responds safely and does not touch Mongo or media", async () => {
  let reply;
  const result = await handleHouseButton({
    customId: `house:media:${houseId}`,
    reply: async payload => { reply = payload; },
  });
  assert.equal(result, true);
  assert.match(reply.content, /when creating the listing/i);
  assert.match(reply.content, /unchanged/i);
});

test("old house upload modal submits safely without updating the original listing", async () => {
  let reply;
  const result = await handleHouseModal({
    customId: `house:media:${houseId}`,
    reply: async payload => { reply = payload; },
  });
  assert.equal(result, true);
  assert.match(reply.content, /not modified/i);
});

test("startup repair detects legacy house cards with obsolete Add Pictures/video control", () => {
  const bot = {
    embeds: [], attachments: new Map([[1, { name: "house-style-card.png" }]]),
    components: [{
      components: ["sold", "media", "interest", "notify"].map(action => ({
        customId: `house:${action}:${houseId}`,
      })),
    }],
  };
  assert.equal(houseNeedsFormatUpgrade(house, bot), true);
  bot.components[0].components = bot.components[0].components
    .filter(x => !x.customId.includes(":media:"));
  assert.equal(houseNeedsFormatUpgrade(house, bot), false);
});
