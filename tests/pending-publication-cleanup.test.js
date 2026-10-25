import test from "node:test";
import assert from "node:assert/strict";
import PendingForm from "../models/PendingForm.js";
import HouseListing from "../models/HouseListing.js";
import OutfitListing from "../models/OutfitListing.js";
import { cleanupPendingForms } from "../commands/pending-forms.js";

const guildId = "123456789012345678";
const channelId = "234567890123456789";
const botId = "345678901234567890";
const ownerId = "456789012345678901";
const messageId = "567890123456789012";
const pending = type => ({
  _id: "db", guildId, channelId, messageId, ownerId, type,
});

async function runCleanup(type, { disabled = true, staged = true, author = botId } = {}) {
  const oldFind = PendingForm.find, oldDelete = PendingForm.deleteOne;
  const oldHouse = HouseListing.exists, oldOutfit = OutfitListing.exists;
  const actions = [];
  PendingForm.find = () => ({ lean: async () => [pending(type)] });
  PendingForm.deleteOne = async () => { actions.push("clear-record"); };
  HouseListing.exists = async () => staged ? { _id: "record" } : null;
  OutfitListing.exists = async () => staged ? { _id: "record" } : null;
  const guild = { id: guildId, client: { user: { id: botId } },
    channels: { fetch: async () => ({ messages: { fetch: async () => ({
      author: { id: author },
      components: [{ components: [{
        customId: `${type}:new:${ownerId}`, disabled,
      }] }],
      delete: async () => { actions.push("delete-message"); },
    }) } }) } };
  try {
    const removed = await cleanupPendingForms(guild);
    return { removed, actions };
  } finally {
    PendingForm.find = oldFind; PendingForm.deleteOne = oldDelete;
    HouseListing.exists = oldHouse; OutfitListing.exists = oldOutfit;
  }
}

test("startup preserves a staged house submission and its pending form record", async () => {
  const result = await runCleanup("house");
  assert.equal(result.removed, undefined);
  assert.deepEqual(result.actions, []);
});
test("startup preserves an interrupted disabled outfit form even if DB record wasn't saved", async () => {
  const result = await runCleanup("outfit", { staged: false });
  assert.deepEqual(result.actions, []);
});
test("ordinary unfinished, enabled forms still get cleaned up safely", async () => {
  const result = await runCleanup("outfit", { staged: false, disabled: false });
  assert.deepEqual(result.actions, ["delete-message", "clear-record"]);
});
test("stale reference to someone else's form is never deleted", async () => {
  const result = await runCleanup("house", { staged: false, disabled: false, author: "another-bot" });
  assert.deepEqual(result.actions, ["clear-record"]);
});
