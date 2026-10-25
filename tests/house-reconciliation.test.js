import test from "node:test";
import assert from "node:assert/strict";
import HouseListing from "../models/HouseListing.js";
import {
  houseNeedsFormatUpgrade, reconcileHousesForGuild,
  checkHousePost,
} from "../services/house-availability.js";
import { handleHousePageButton } from "../commands/house.js";

const id = "6add69d69249c7f6f595751d";
const guildId = "1561372971355086958";
const botId = "111111111111111111";
const postId = "222222222222222222";
const channelId = "333333333333333333";
const listing = (overrides={}) => ({
  _id: id, ownerId: "444444444444444444", guildId,
  postChannelId: channelId, postMessageId: postId, status: "active", cardLayoutVersion: 1,
  ...overrides,
});
const correct = {
  author: { id: botId }, embeds: [],
  attachments: new Map([[1, { name: "house-style-card.png" }]]),
  components: [{ components: ["sold","interest","notify"].map(action => ({
    customId: `house:${action}:${id}`,
  })) }],
};
test("already-styled houses remain unchanged and old embeds get converted", () => {
  assert.equal(houseNeedsFormatUpgrade(listing(), correct), false);
  assert.equal(houseNeedsFormatUpgrade(listing({ cardLayoutVersion: 0 }), correct), true,
    "Older tall house artwork must be re-rendered on startup");
  assert.equal(houseNeedsFormatUpgrade(listing(), { ...correct, embeds: [{ title: "legacy" }] }), true);
  assert.equal(houseNeedsFormatUpgrade(listing(), { ...correct, attachments: new Map() }), true);
});
test("startup upgrades old houses but leaves unavailable and already-current records alone", async () => {
  const a = listing({ _id: "a".repeat(24) });
  const b = listing({ _id: id });
  const c = listing({ _id: "c".repeat(24) });
  const refreshed = [];
  const currentFor = house => ({
    ...correct,
    components: [{ components: ["sold","interest","notify"].map(action => ({
      customId: `house:${action}:${house._id}`,
    })) }],
  });
  const result = await reconcileHousesForGuild({ id: guildId }, {
    records: [a,b,c],
    check: async (_guild, house) => house === c
      ? { state: "unavailable" }
      : { state: "present", message: house === a
        ? { ...currentFor(house), embeds: [{ title: "old house" }] }
        : currentFor(house) },
    refresh: async (_guild, house) => refreshed.push(String(house._id)),
  });
  assert.deepEqual(refreshed, ["a".repeat(24)]);
  assert.deepEqual(result, {
    scanned: 3, converted: 1, missing: 0, current: 1, unavailable: 1, failed: 0,
  });
});
test("deleted Discord house original is archived; permission errors are not deletions", async () => {
  const original = HouseListing.updateOne;
  const writes = [];
  HouseListing.updateOne = async (_filter, update) => {
    writes.push(update.$set);
    return { modifiedCount: 1 };
  };
  try {
    const guild = code => ({
      id: guildId, client: { user: { id: botId } },
      channels: { fetch: async () => ({ messages: { fetch: async () => {
        throw Object.assign(new Error("Discord"), { code });
      } } }) },
    });
    const gone = await checkHousePost(guild(10008), listing());
    const denied = await checkHousePost(guild(50001), listing());
    assert.equal(gone.state, "missing");
    assert.equal(denied.state, "unavailable");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].status, "missing");
  } finally { HouseListing.updateOne = original; }
});
test("house Previous and Next validate mixed numeric Mongo IDs then query the original post", async () => {
  const original = HouseListing.findOne;
  const queries = [];
  HouseListing.findOne = async filter => { queries.push(filter); return null; };
  try {
    for (const direction of ["prev", "next"]) {
      const interaction = {
        customId: `house:page:${direction}:${id}`, guildId,
        message: { id: postId }, deferUpdate: async () => {},
      };
      await assert.rejects(handleHousePageButton(interaction), /no longer available/);
      assert.equal(queries.at(-1)._id, id);
      assert.equal(queries.at(-1).postMessageId, postId);
    }
  } finally { HouseListing.findOne = original; }
});
