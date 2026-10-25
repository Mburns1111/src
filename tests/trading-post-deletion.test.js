import test from "node:test";
import assert from "node:assert/strict";
import { finalizeTradingPostDeletion, resumePendingTradingPostDeletes } from "../services/trading-post-deletion.js";

const post = { _id: "db", guildId: "123456789012345678", ownerId: "234567890123456789",
  postChannelId: "345678901234567890", postMessageId: "456789012345678901", deletePending: true };
const botId = "567890123456789012";

test("completed deletion removes Discord message before deleting the record", async () => {
  const order = [];
  const guild = { id: post.guildId, client: { user: { id: botId } },
    channels: { fetch: async () => ({ messages: { fetch: async () => ({
      author: { id: botId }, delete: async () => order.push("discord"),
    }) } }) } };
  const PostModel = { deleteOne: async filter => {
    assert.equal(filter.deletePending, true); order.push("mongo");
  } };
  await finalizeTradingPostDeletion(guild, post, { PostModel });
  assert.deepEqual(order, ["discord", "mongo"]);
});

test("restart finishes tombstones after Discord deletion but Mongo failure", async () => {
  let calls = 0;
  const guild = { id: post.guildId, client: { user: { id: botId } },
    channels: { fetch: async () => ({ messages: { fetch: async () => {
      calls++;
      if (calls === 1) return { author: { id: botId }, delete: async () => {} };
      throw Object.assign(new Error("Unknown Message"), { code: 10008 });
    } } }) } };
  const PostModel = { find: () => ({ lean: async () => [post] }),
    deleteOne: async () => { if (calls === 1) throw new Error("Mongo unavailable"); } };
  await assert.rejects(finalizeTradingPostDeletion(guild, post, { PostModel }), /Mongo unavailable/);
  const result = await resumePendingTradingPostDeletes(guild, { PostModel });
  assert.equal(result.completed, 1);
});

test("foreign message is preserved even if Mongo reference is wrong", async () => {
  let deletions = 0;
  const guild = { id: post.guildId, client: { user: { id: botId } },
    channels: { fetch: async () => ({ messages: { fetch: async () => ({
      author: { id: "another-bot" }, delete: async () => { deletions++; },
    }) } }) } };
  await assert.rejects(finalizeTradingPostDeletion(guild, post, {
    PostModel: { deleteOne: async () => { deletions++; } },
  }), /another author/);
  assert.equal(deletions, 0);
});
