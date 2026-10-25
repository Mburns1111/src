import test from "node:test";
import assert from "node:assert/strict";
import { handleListingInterest } from "../commands/listing-interest.js";

const listingId = "a".repeat(24);
const controlsId = "222222222222222222";
const originalId = "111111111111111111";
const ownerId = "333333333333333333";
const viewerId = "444444444444444444";

function interaction(action, userId) {
  const edits = [];
  const result = {
    customId: `outfit:${action}:${listingId}`,
    channelId: "555555555555555555",
    guildId: "666666666666666666",
    user: { id: userId },
    message: { id: controlsId, url: "https://discord.com/channels/1/2/3",
      edit: async payload => { edits.push(payload); } },
    deferred: false,
    deferReply: async () => { result.deferred = true; },
    editReply: async payload => { result.reply = payload; },
    guild: { name: "Test guild" },
    client: { users: { fetch: async () => ({ send: async () => {} }) } },
    edits,
  };
  return result;
}

test("interest button uses outfit controlsMessageId instead of banner postMessageId", async () => {
  const initial = {
    _id: listingId, ownerId, title: "Fancy costume", controlsMessageId: controlsId,
    postMessageId: originalId, interestedUserIds: [], notifyOnInterest: false,
  };
  const queries = [];
  const ListingModel = {
    findOne: async query => { queries.push(query); return initial; },
    findOneAndUpdate: async (query, patch) => {
      queries.push(query);
      assert.equal(patch.$addToSet.interestedUserIds, viewerId);
      return { ...initial, interestedUserIds: [viewerId] };
    },
  };
  const ctx = interaction("interest", viewerId);
  await handleListingInterest(ctx, {
    ListingModel, listingType: "outfit",
    messageIdField: "controlsMessageId",
    makeComponents: () => ["buttons"],
  });
  assert.equal(queries.length, 2);
  assert.ok(queries.every(q => q.controlsMessageId === controlsId));
  assert.ok(queries.every(q => !("postMessageId" in q)));
  assert.deepEqual(ctx.edits[0].components, ["buttons"]);
  assert.match(ctx.reply.content, /interest was added/i);
});

test("notify button updates controls message and only permits owner", async () => {
  const initial = {
    _id: listingId, ownerId, title: "Outfit", interestedUserIds: [],
    notifyOnInterest: false,
  };
  const queries = [];
  const ListingModel = {
    findOne: async query => { queries.push(query); return initial; },
    findOneAndUpdate: async (query, patch) => {
      queries.push(query);
      assert.equal(patch.$set.notifyOnInterest, true);
      return { ...initial, notifyOnInterest: true };
    },
  };
  const ctx = interaction("notify", ownerId);
  await handleListingInterest(ctx, {
    ListingModel, listingType: "outfit",
    messageIdField: "controlsMessageId",
    makeComponents: () => ["updated"],
  });
  assert.ok(queries.every(q => q.controlsMessageId === controlsId));
  assert.deepEqual(ctx.edits[0].components, ["updated"]);
  assert.match(ctx.reply.content, /now on/);
});

test("house and other listing buttons still default to original post ID", async () => {
  const listing = { _id: listingId, ownerId, title: "House", interestedUserIds: [],
    notifyOnInterest: false };
  const queries = [];
  const ListingModel = {
    findOne: async q => { queries.push(q); return listing; },
    findOneAndUpdate: async q => { queries.push(q); return { ...listing, interestedUserIds: [viewerId] }; },
  };
  const ctx = interaction("interest", viewerId);
  await handleListingInterest(ctx, {
    ListingModel, listingType: "house",
    makeComponents: () => ["houseButtons"],
  });
  assert.ok(queries.every(q => q.postMessageId === controlsId));
  assert.ok(queries.every(q => !("controlsMessageId" in q)));
});
