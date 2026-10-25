import test from "node:test";
import assert from "node:assert/strict";
import { cleanupDepartedProfiles, retireProfileMessage } from "../commands/profile-cleanup.js";
import { ensureChannelEntry } from "../commands/channel-entry.js";
import GuildConfig from "../models/GuildConfig.js";

const guildId = "123456789012345678";
const channelId = "234567890123456789";
const botId = "345678901234567890";
const cardId = "456789012345678901";
const detailsId = "567890123456789012";

function makeGuild(items) {
  const deleted = [];
  const guild = {
    id: guildId, client: { user: { id: botId } },
    members: { fetch: async () => { throw Object.assign(new Error("Unknown member"), { code: 10007 }); } },
    channels: { fetch: async () => ({ messages: { fetch: async id => {
      const item = items[id];
      if (!item) throw Object.assign(new Error("Unknown Message"), { code: 10008 });
      return {
        author: { id: item.author },
        delete: async () => {
          if (item.failure) throw item.failure;
          deleted.push(id);
        },
      };
    } } }) },
  };
  return { guild, deleted };
}
function mockProfiles(doc, updates) {
  return {
    find: () => ({ select: () => ({ lean: async () => [doc] }) }),
    updateOne: async (_query, patch) => { updates.push(patch.$set); },
  };
}

test("departed member cleanup retires both messages and clears both IDs", async () => {
  const { guild, deleted } = makeGuild({
    [cardId]: { author: botId }, [detailsId]: { author: botId },
  });
  const doc = { _id: "db", discordUserId: "111111111111111111", profileCardChannelId: channelId,
    profileCardMessageId: cardId, profileDetailsMessageId: detailsId };
  const updates = [];
  const result = await cleanupDepartedProfiles(guild, { Profiles: mockProfiles(doc, updates) });
  assert.deepEqual(deleted, [cardId, detailsId]);
  assert.equal(result.removedPosts, 2);
  assert.deepEqual(updates[0], {
    profileCardMessageId: "", profileDetailsMessageId: "", profileCardChannelId: "",
  });
});

test("foreign and deleted messages are safely untracked without deleting user content", async () => {
  const { guild, deleted } = makeGuild({ [cardId]: { author: "other-bot" } });
  const other = await retireProfileMessage(guild, channelId, cardId);
  const missing = await retireProfileMessage(guild, channelId, detailsId);
  assert.equal(other.otherAuthor, true);
  assert.equal(missing.resolved, true);
  assert.deepEqual(deleted, []);
});

test("failed message deletion preserves its reference and shared channel ID", async () => {
  const { guild } = makeGuild({ [cardId]: {
    author: botId, failure: Object.assign(new Error("Missing Permissions"), { code: 50013 }),
  } });
  const doc = { _id: "db", discordUserId: "111111111111111111",
    profileCardChannelId: channelId, profileCardMessageId: cardId, profileDetailsMessageId: detailsId };
  const updates = [];
  const result = await cleanupDepartedProfiles(guild, { Profiles: mockProfiles(doc, updates) });
  assert.equal(result.failures.length, 1);
  assert.deepEqual(updates, [{ profileDetailsMessageId: "" }]);
});

test("entry update saves replacement ID before deleting the previous message", async () => {
  const originalFind = GuildConfig.findOne, originalUpdate = GuildConfig.updateOne;
  const order = [];
  GuildConfig.findOne = async () => ({ houseEntryChannelId: channelId, houseEntryMessageId: cardId });
  GuildConfig.updateOne = async (_filter, patch) => {
    assert.equal(patch.$set.houseEntryMessageId, detailsId);
    order.push("saved"); return { acknowledged: true };
  };
  const channel = { id: channelId, messages: { fetch: async () => ({
    author: { id: botId }, delete: async () => order.push("deleted-old"),
  }) }, send: async () => { order.push("sent"); return {
    id: detailsId, delete: async () => order.push("deleted-new"),
  }; } };
  try {
    await ensureChannelEntry({ id: guildId, client: { user: { id: botId } },
      channels: { fetch: async () => channel } }, channel, {
      channelField: "houseEntryChannelId", messageField: "houseEntryMessageId",
      customId: "house:entry", label: "House", description: "Test", moveToBottom: true,
    });
    assert.deepEqual(order, ["sent", "saved", "deleted-old"]);
  } finally {
    GuildConfig.findOne = originalFind; GuildConfig.updateOne = originalUpdate;
  }
});

test("failed entry database write never deletes the old button", async () => {
  const originalFind = GuildConfig.findOne, originalUpdate = GuildConfig.updateOne;
  let deletedOld = false, deletedNew = false;
  GuildConfig.findOne = async () => ({ houseEntryChannelId: channelId, houseEntryMessageId: cardId });
  GuildConfig.updateOne = async () => { throw new Error("MongoDB unavailable"); };
  const channel = { id: channelId, messages: { fetch: async () => ({
    author: { id: botId }, delete: async () => { deletedOld = true; },
  }) }, send: async () => ({ id: detailsId, delete: async () => { deletedNew = true; } }) };
  try {
    await assert.rejects(ensureChannelEntry({ id: guildId, client: { user: { id: botId } },
      channels: { fetch: async () => channel } }, channel, {
      channelField: "houseEntryChannelId", messageField: "houseEntryMessageId",
      customId: "house:entry", label: "House", description: "Test", moveToBottom: true,
    }), /MongoDB unavailable/);
    assert.equal(deletedOld, false);
    assert.equal(deletedNew, true);
  } finally {
    GuildConfig.findOne = originalFind; GuildConfig.updateOne = originalUpdate;
  }
});
