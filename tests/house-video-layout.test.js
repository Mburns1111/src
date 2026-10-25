import test from "node:test";
import assert from "node:assert/strict";
import HouseListing from "../models/HouseListing.js";
import {
  houseMediaPayload,
  houseMediaNeedsRepair,
  ensureHouseMediaMessage,
  deleteHouseMediaMessage,
  mergedHouseMediaMetadata,
} from "../services/house-media.js";
import { houseCardPayload } from "../services/house-card.js";
import { houseNeedsFormatUpgrade } from "../services/house-availability.js";

const guildId = "1561372971355086958";
const botId = "111111111111111111";
const postId = "222222222222222222";
const channelId = "333333333333333333";
const id = "6add69d69249c7f6f595751d";
const originalVideo = (n = 1) => ({
  id: `old-${n}`,
  name: `tour-${n}.mp4`,
  contentType: "video/mp4",
  size: 4000,
  url: `https://cdn.discordapp.com/tour-${n}.mp4`,
});
const listing = overrides => ({
  _id: id, guildId, ownerId: "555555555555555555", status: "active",
  title: "Pretty house", ownerName: "Seller", postChannelId: channelId,
  postMessageId: postId, mediaMessageId: "", mediaAttachments: [],
  interestedUserIds: [], notifyOnInterest: false, ...overrides,
});
const sourcePost = (...assets) => ({
  id: postId, attachments: new Map(assets.map(item => [item.id,item])),
});
const makeGuild = channel => ({
  id: guildId, client: { user: { id: botId } },
  channels: { fetch: async channelName => {
    assert.equal(channelName, channelId);
    return channel;
  } },
});

test("decorated house always has one image even when linked video exists", () => {
  const data = listing({ mediaMessageId: "444444444444444444" });
  const card = houseCardPayload(data, { count: 2 }, Buffer.from("png"));
  assert.deepEqual(card.attachments, []);
  assert.deepEqual(card.embeds, []);
  assert.equal(card.files.length, 1);
  assert.equal(card.files[0].name, "house-style-card.png");
  assert.match(card.content, /Watch house video tour/);
  assert.equal(card.components.length, 2);
});
test("separate video reply is connected to original post, not placed in house card", () => {
  const payload = houseMediaPayload(listing(), [{ attachment: "https://cdn.discordapp.com/tour.mp4", name: "video.mp4" }]);
  assert.equal(payload.reply.messageReference, postId);
  assert.equal(payload.reply.failIfNotExists, true);
  assert.match(payload.content, /House video tour/);
  assert.equal(payload.files.length, 1);
  assert.equal(payload.allowedMentions.repliedUser, false);
});
test("legacy tiled video attachment migrates safely BEFORE original loses it", async () => {
  const current = listing({ mediaAttachments: [originalVideo()] });
  let updates = 0;
  let deleted = false;
  const posted = {
    id: "444444444444444444", author: { id: botId },
    attachments: new Map([["new-video", {
      ...originalVideo(), id: "new-video", url: "https://cdn.discordapp.com/new.mp4",
    }]]),
    delete: async () => { deleted = true; },
  };
  let sent;
  const channel = {
    messages: { fetch: async () => { throw Object.assign(new Error("not found"), { code: 10008 }); } },
    send: async payload => { sent = payload; return posted; },
  };
  const guild = makeGuild(channel);
  const original = HouseListing.updateOne;
  HouseListing.updateOne = async (filter, patch) => {
    updates++;
    assert.equal(filter.postMessageId, postId);
    assert.equal(patch.$set.mediaMessageId, posted.id);
    return { matchedCount: 1 };
  };
  try {
    const post = sourcePost(originalVideo());
    const migrated = await ensureHouseMediaMessage(guild, current, post, { channel });
    assert.equal(migrated.message.id, posted.id);
    assert.equal(migrated.videos.length, 1);
    assert.equal(migrated.created, true);
    assert.equal(sent.files.length, 1);
    assert.equal(updates, 1);
    assert.equal(current.mediaMessageId, posted.id);
    assert.equal(post.attachments.size, 1, "do not detach original video during migration");
    assert.equal(deleted, false);
    assert.equal(houseMediaNeedsRepair(current, post), true);
    const merged = mergedHouseMediaMetadata(current.mediaAttachments, migrated.videos);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].attachmentId, "new-video");
    assert.equal(merged[0].url, "https://cdn.discordapp.com/new.mp4");
  } finally {
    HouseListing.updateOne = original;
  }
});
test("failed legacy video copy leaves original attachments intact and never records a media message", async () => {
  const current = listing({ mediaAttachments: [originalVideo(2)] });
  const source = sourcePost(originalVideo(2));
  let updated = false;
  const original = HouseListing.updateOne;
  HouseListing.updateOne = async () => { updated = true; };
  try {
    const channel = {
      messages: { fetch: async () => null },
      send: async () => { throw new Error("Discord upload refused"); },
    };
    await assert.rejects(ensureHouseMediaMessage(makeGuild(channel), current, source, { channel }),
      /Discord upload refused/);
    assert.equal(updated, false);
    assert.equal(source.attachments.size, 1);
    assert.equal(current.mediaMessageId, "");
  } finally {
    HouseListing.updateOne = original;
  }
});
test("already separated videos are reused without creating duplicate replies", async () => {
  const video = { ...originalVideo(), id: "new-video" };
  const current = listing({
    mediaMessageId: "444444444444444444", mediaAttachments: [video],
  });
  let sends = 0;
  const channel = {
    messages: { fetch: async () => ({
      id: current.mediaMessageId, author: { id: botId }, attachments: new Map([[video.id,video]]),
    }) },
    send: async () => { sends++; throw new Error("Unexpected duplicate reply"); },
  };
  const result = await ensureHouseMediaMessage(makeGuild(channel), current, sourcePost(), { channel });
  assert.equal(result.created, false);
  assert.equal(result.videos.length, 1);
  assert.equal(sends, 0);
});
test("missing video reply without recoverable sources fails instead of silently deleting its link", async () => {
  const current = listing({ mediaMessageId: "444444444444444444" });
  const channel = {
    messages: { fetch: async () => { throw Object.assign(new Error("Unknown Message"), { code: 10008 }); } },
    send: async () => { throw Error("Should not send"); },
  };
  await assert.rejects(
    ensureHouseMediaMessage(makeGuild(channel), current, sourcePost(), { channel }),
    /source videos are unavailable/,
  );
});
test("sold house deletes linked bot media but does not delete arbitrary user message", async () => {
  const current = listing({ mediaMessageId: "444444444444444444" });
  let deleted = 0;
  const channel = {
    messages: { fetch: async () => ({ author: { id: botId }, delete: async () => { deleted++; } }) },
  };
  await deleteHouseMediaMessage(makeGuild(channel), current);
  assert.equal(deleted, 1);
  channel.messages.fetch = async () => ({ author: { id: "someone-else" }, delete: async () => { deleted++; } });
  await deleteHouseMediaMessage(makeGuild(channel), current);
  assert.equal(deleted, 1);
});
test("startup reconciliation upgrades video-tiling legacy houses but not photo-only completed cards", () => {
  const modern = {
    attachments: new Map([["style", { name: "house-style-card.png", contentType: "image/png" }]]),
    embeds: [], components: [{ components: ["sold", "interest", "notify"].map(action =>
      ({ customId: `house:${action}:${id}` })) }],
  };
  assert.equal(houseNeedsFormatUpgrade(listing(), modern), false);
  const old = { ...modern, attachments: new Map([...modern.attachments, ["v", originalVideo()]]) };
  assert.equal(houseNeedsFormatUpgrade(listing(), old), true);
  assert.equal(houseNeedsFormatUpgrade(listing({ mediaAttachments: [originalVideo()] }), modern), true);
  assert.equal(houseNeedsFormatUpgrade(listing({
    mediaMessageId: "444444444444444444", mediaAttachments: [originalVideo()],
  }), modern), false);
});
