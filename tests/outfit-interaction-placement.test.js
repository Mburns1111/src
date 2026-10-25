import test from "node:test";
import assert from "node:assert/strict";
import { handleListingInterest } from "../commands/listing-interest.js";
import { deleteLegacyOutfitMessages } from "../services/outfit-card.js";
import OutfitListing from "../models/OutfitListing.js";

const listingId = "a".repeat(24);
const originalId = "111111111111111111";
const ownerId = "333333333333333333";
const viewerId = "444444444444444444";

function makeInteraction(action, userId) {
  const edits = [];
  const i = {
    customId: `outfit:${action}:${listingId}`,
    channelId: "555555555555555555", guildId: "666666666666666666",
    user: { id: userId },
    message: {
      id: originalId, url: "https://discord.com/channels/1/2/3",
      edit: async payload => { edits.push(payload); },
    },
    deferReply: async () => {},
    editReply: async payload => { i.reply = payload; },
    guild: { name: "Test guild" },
    client: { users: { fetch: async () => ({ send: async () => {} }) } },
    edits,
  };
  return i;
}

test("outfit interest now acts from original card, not old controls reply", async () => {
  const initial = { _id: listingId, ownerId, title: "Pretty outfit",
    interestedUserIds: [], notifyOnInterest: false };
  const queries = [];
  const ListingModel = {
    findOne: async query => { queries.push(query); return initial; },
    findOneAndUpdate: async (query, patch) => {
      queries.push(query);
      assert.equal(patch.$addToSet.interestedUserIds, viewerId);
      return { ...initial, interestedUserIds: [viewerId] };
    },
  };
  const interaction = makeInteraction("interest", viewerId);
  await handleListingInterest(interaction, {
    ListingModel, listingType: "outfit",
    makeComponents: () => ["card buttons"],
  });
  assert.ok(queries.every(query => query.postMessageId === originalId));
  assert.ok(queries.every(query => !("controlsMessageId" in query)));
  assert.deepEqual(interaction.edits[0].components, ["card buttons"]);
  assert.match(interaction.reply.content, /interest was added/i);
});

test("seller notification toggle updates original card buttons in place", async () => {
  const current = { _id: listingId, ownerId,
    interestedUserIds: [], notifyOnInterest: false };
  const queries = [];
  const ListingModel = {
    findOne: async query => { queries.push(query); return current; },
    findOneAndUpdate: async (query, patch) => {
      queries.push(query);
      assert.equal(patch.$set.notifyOnInterest, true);
      return { ...current, notifyOnInterest: true };
    },
  };
  const interaction = makeInteraction("notify", ownerId);
  await handleListingInterest(interaction, {
    ListingModel, listingType: "outfit",
    makeComponents: () => ["updated buttons"],
  });
  assert.ok(queries.every(query => query.postMessageId === originalId));
  assert.deepEqual(interaction.edits[0].components, ["updated buttons"]);
});

test("legacy outfit gallery and action replies delete only after successful migration", async () => {
  const record = {
    _id: listingId, guildId: "666666666666666666", ownerId,
    postMessageId: originalId, postChannelId: "555555555555555555",
    galleryMessageId: "777777777777777777",
    controlsMessageId: "888888888888888888",
    styleCardMessageId: "999999999999999999",
  };
  const deletions = [];
  const botId = "555555555555555556";
  const channel = { messages: {
    fetch: async id => ({
      id, author: { id: id === record.styleCardMessageId ? "other-bot" : botId },
      delete: async () => { deletions.push(id); },
    }),
  } };
  const guild = { id: record.guildId, client: { user: { id: botId } },
    channels: { fetch: async () => channel } };
  const prevUpdate = OutfitListing.updateOne;
  let updates = null;
  OutfitListing.updateOne = async (_, op) => { updates = op.$set; return { matchedCount: 1 }; };
  try {
    await deleteLegacyOutfitMessages(guild, record);
  } finally {
    OutfitListing.updateOne = prevUpdate;
  }
  assert.deepEqual(deletions, ["777777777777777777", "888888888888888888"]);
  assert.deepEqual(updates, { galleryMessageId: "", controlsMessageId: "" });
  assert.equal(record.styleCardMessageId, "999999999999999999");
  assert.equal(record.postMessageId, originalId);
});
