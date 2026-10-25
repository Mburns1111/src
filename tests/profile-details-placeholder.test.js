import test from "node:test";
import assert from "node:assert/strict";
import {
  makeProfileCardContent,
  makeProfileDetailsPayloadFromLinks,
} from "../commands/profile.js";

const guildId = "1561372971355086958";
const userId = "123456789012345678";
const emptyLinks = () => ({ houses: [], outfits: [], trades: [], tradingPost: null });
const profile = () => ({
  discordUserId: userId,
  profileCardChannelId: "222222222222222222",
  profileCardMessageId: "333333333333333333",
  inventoryVideoPostChannelId: "",
  inventoryVideoPostMessageId: "",
  inventoryVideoUrl: "",
  albumPosts: [],
});

test("brand-new profile always has a visible second message even without links", () => {
  const user = profile();
  const payload = makeProfileDetailsPayloadFromLinks(user, guildId, emptyLinks());
  assert.equal(payload.embeds.length, 0);
  assert.match(payload.content, /Links & listings/);
  assert.match(payload.content, /Nothing linked yet/i);
  assert.match(payload.content, /inventory, house, outfit, trade, and Trading Post/i);
  assert.match(payload.content, new RegExp(userId));
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test("as listings appear the SAME details message can become a linked embed", () => {
  const user = profile();
  const empty = makeProfileDetailsPayloadFromLinks(user, guildId, emptyLinks());
  const next = makeProfileDetailsPayloadFromLinks(user, guildId, {
    ...emptyLinks(),
    houses: [{
      title: "Pink house",
      postChannelId: "444444444444444444",
      postMessageId: "555555555555555555",
    }],
  });
  assert.ok(empty.content);
  assert.deepEqual(empty.embeds, []);
  assert.equal(next.content, "", "clear placeholder content when adding links");
  assert.equal(next.embeds.length, 1, "the details post now contains real links");
  const description = next.embeds[0].toJSON().description;
  assert.match(description, /House listings \(1\)/);
  assert.match(description, /Pink house/);
  assert.match(description, /discord.com\/channels/);
  assert.doesNotMatch(description, /Nothing linked yet/);

  const cleared = makeProfileDetailsPayloadFromLinks(user, guildId, emptyLinks());
  assert.ok(cleared.content, "placeholder returns when last listing disappears");
  assert.deepEqual(cleared.embeds, [], "previous linked embed gets cleared");
});

test("inventory videos and inventory photo links suppress the empty placeholder", () => {
  const videoUser = { ...profile(), inventoryVideoUrl: "https://example.com/house-video" };
  const videoPayload = makeProfileDetailsPayloadFromLinks(videoUser, guildId, emptyLinks());
  assert.equal(videoPayload.content, "");
  assert.equal(videoPayload.embeds.length, 1);
  assert.match(videoPayload.embeds[0].toJSON().description, /Inventory video/);

  const photosUser = {
    ...profile(),
    albumPosts: [{
      channelId: "444444444444444444",
      messageId: "555555555555555555",
    }],
  };
  const photoPayload = makeProfileDetailsPayloadFromLinks(photosUser, guildId, emptyLinks());
  assert.equal(photoPayload.content, "");
  assert.match(photoPayload.embeds[0].toJSON().description, /Inventory photos/);
});

test("the profile's own card never counts as an inventory photo link", () => {
  const user = {
    ...profile(),
    albumPosts: [{
      channelId: "222222222222222222",
      messageId: "333333333333333333",
    }],
  };
  const payload = makeProfileDetailsPayloadFromLinks(user, guildId, emptyLinks());
  assert.match(payload.content, /Nothing linked yet/i);
  assert.deepEqual(payload.embeds, []);
});

test("profile links formatter remains within Discord's embed description limit", () => {
  const user = profile();
  const links = {
    ...emptyLinks(),
    houses: Array.from({ length: 85 }, (_, n) => ({
      title: "Beautiful garden house with a long name " + String(n).repeat(9),
      postChannelId: "444444444444444444",
      postMessageId: String(555555555555555555n + BigInt(n)),
    })),
  };
  const description = makeProfileCardContent(user, guildId, links);
  assert.ok(description.length <= 4096);
  assert.match(description, /House listings/);
});
