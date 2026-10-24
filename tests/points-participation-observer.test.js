import test from "node:test";
import assert from "node:assert/strict";
import { data as observeCommand } from "../commands/points-observe.js";
import ParticipationSource from "../models/ParticipationSource.js";
import NativePollParticipation from "../models/NativePollParticipation.js";
import {
  parseNativePollEvent, parseGuildMessageLink, messageVisibility,
  observeNativePollVote,
} from "../services/participation-observer.js";

const guildId = "1561372971355086958";
const channelId = "1561372971355086959";
const messageId = "1561372971355086960";
const userId = "1561372971355086961";
const link = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

test("native Discord Gateway vote add/remove can be read without message content or cache", () => {
  const raw = { t: "MESSAGE_POLL_VOTE_ADD", d: {
    guild_id: guildId, channel_id: channelId, message_id: messageId,
    user_id: userId, answer_id: 1,
  } };
  assert.deepEqual(parseNativePollEvent(raw), {
    guildId, channelId, messageId, userId, answerId: 1, added: true,
  });
  assert.equal(parseNativePollEvent({ ...raw, t: "MESSAGE_POLL_VOTE_REMOVE" }).added, false);
  assert.equal(parseNativePollEvent({ ...raw, t: "INTERACTION_CREATE" }), null);
  assert.equal(parseNativePollEvent({ ...raw, d: { ...raw.d, guild_id: undefined } }), null);
  assert.equal(parseNativePollEvent({ ...raw, d: { ...raw.d, answer_id: "n/a" } }), null);
});

test("Discord message links are validated and cannot cross server boundaries", () => {
  assert.deepEqual(parseGuildMessageLink(link, guildId), { guildId, channelId, messageId });
  assert.deepEqual(parseGuildMessageLink(link.replace("discord.com", "discordapp.com"), guildId),
    { guildId, channelId, messageId });
  assert.equal(parseGuildMessageLink(link, "1561372971355086999"), null);
  assert.equal(parseGuildMessageLink("https://arclo.gg/dashboard/giveaways", guildId), null);
  assert.equal(parseGuildMessageLink("file:///etc/passwd", guildId), null);
});

test("one native voter selecting multiple answers stays one participation record", async () => {
  const sources = [];
  const records = new Map();
  const fakeSources = {
    async updateOne(filter, update) {
      if (!sources.length) sources.push({ ...update.$setOnInsert });
      sources[0].lastObservedAt = update.$set.lastObservedAt;
      assert.equal(filter.messageId, messageId);
    },
  };
  const fakeParticipants = {
    async updateOne(filter, update, options = {}) {
      let record = records.get(filter.discordUserId);
      if (!record && !options.upsert) return;
      if (!record) { record = new Set(); records.set(filter.discordUserId, record); }
      if (update.$addToSet) record.add(update.$addToSet.answerIds);
      if (update.$pull) record.delete(update.$pull.answerIds);
    },
  };
  const deps = { sources: fakeSources, participants: fakeParticipants };
  const event = {
    guildId, channelId, messageId, userId, answerId: 1, added: true,
  };
  await observeNativePollVote(event, deps);
  await observeNativePollVote(event, deps);
  await observeNativePollVote({ ...event, answerId: 2 }, deps);
  assert.equal(records.size, 1);
  assert.deepEqual([...records.get(userId)], [1, 2]);
  assert.equal(sources[0].source, "discord-native-poll");
  await observeNativePollVote({ ...event, added: false }, deps);
  assert.deepEqual([...records.get(userId)], [2]);
  await observeNativePollVote({ ...event, added: false, answerId: 2 }, deps);
  assert.equal(records.get(userId).size, 0);
});

test("per-member native ballots have a unique index and are not PointsLedger awards", () => {
  assert.ok(NativePollParticipation.schema.indexes().some(([fields, options]) =>
    fields.guildId === 1 && fields.messageId === 1 &&
    fields.discordUserId === 1 && options.unique === true));
  assert.ok(ParticipationSource.schema.indexes().some(([fields, options]) =>
    fields.guildId === 1 && fields.messageId === 1 && options.unique === true));
  assert.ok(!NativePollParticipation.schema.path("points"));
  assert.ok(!ParticipationSource.schema.path("points"));
});

test("Arclo bot message visibility is NOT proof of participants or voters", () => {
  assert.deepEqual(messageVisibility({
    author: { id: "1561372971355086970", bot: true },
    embeds: [], components: [], content: "", poll: undefined,
  }), {
    authorId: "1561372971355086970", authorBot: true,
    embedCount: 0, componentCount: 0, hasContent: false, nativePollVisible: false,
  });
});

test("points-observe manager commands inspect, register, report and list without rewards", () => {
  const command = observeCommand.toJSON();
  assert.equal(command.name, "points-observe");
  assert.deepEqual(command.options.map(option => option.name),
    ["inspect", "register", "report", "list"]);
  const register = command.options.find(option => option.name === "register");
  assert.deepEqual(register.options.find(option => option.name === "type")
    .choices.map(choice => choice.value), ["arclo-poll", "arclo-giveaway", "arclo-panel"]);
});
