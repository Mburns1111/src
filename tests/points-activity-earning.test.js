import test from "node:test";
import assert from "node:assert/strict";
import { activityPeriod, FIRST_WEEK_MS } from "../services/activity-period.js";
import { MESSAGE_BASE_POINTS, MESSAGE_COOLDOWN_MS,
  VOICE_BASE_POINTS, VOICE_INTERVAL_MINUTES, qualifyingMessageText,
  eligibleVoiceStates, awardRepeatableActivity, recordVoiceMinute,
  awardMessageActivity } from "../services/activity-rewards.js";
import PointsActivityCounter from "../models/PointsActivityCounter.js";
import PointsActivityMessageState from "../models/PointsActivityMessageState.js";
import PointsVoiceProgress from "../models/PointsVoiceProgress.js";
import PointsSettings from "../models/PointsSettings.js";

const guildId = "1561372971355086958", userId = "1561372971355086961";
const oldMemberJoin = new Date("2026-09-01T10:00:00Z");
const freshJoin = new Date("2026-10-24T14:00:00Z");

test("seven-day newcomer window is anchored to join instant, then Monday UTC weeks", () => {
  const starter = activityPeriod(freshJoin, new Date(freshJoin.getTime() + FIRST_WEEK_MS - 1));
  assert.equal(starter.cap, 425);
  assert.equal(starter.multiplier, 2);
  assert.equal(starter.key, `starter:${freshJoin.getTime()}`);
  const regular = activityPeriod(freshJoin, new Date(freshJoin.getTime() + FIRST_WEEK_MS));
  assert.equal(regular.cap, 225);
  assert.equal(regular.multiplier, 1);
  assert.match(regular.key, /^week:\d{4}-\d\d-\d\d$/);
  assert.equal(activityPeriod(null, new Date("2026-10-24T14:00:00Z")).starter, false);
});

test("message qualification drops URLs, short messages and bot commands", () => {
  assert.equal(MESSAGE_BASE_POINTS, 2);
  assert.equal(MESSAGE_COOLDOWN_MS, 120000);
  assert.equal(qualifyingMessageText("hi"), null);
  assert.equal(qualifyingMessageText("https://example.com/this-is-a-very-long-link"), null);
  assert.equal(qualifyingMessageText("/points-admin activity-toggle enabled:true"), null);
  assert.equal(qualifyingMessageText("@everyone"), null);
  const hash = qualifyingMessageText("Enjoying all the new Halloween decorations!");
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, qualifyingMessageText("  enjoying ALL the new Halloween decorations!  "));
  assert.ok(!hash.includes("Halloween"));
});

test("voice eligibility requires two live humans, not AFK, bot, stage-suppressed or deafened", () => {
  const memberA = { id: userId, user: { bot: false } };
  const memberB = { id: "1561372971355086962", user: { bot: false } };
  const bot = { id: "1561372971355086963", user: { bot: true } };
  const channelId = "1561372971355086964", afkChannelId = "1561372971355086965";
  const guild = {
    afkChannelId,
    members: { cache: new Map() },
    voiceStates: { cache: new Map([
      [memberA.id, { id: memberA.id, channelId, member: memberA }],
      [memberB.id, { id: memberB.id, channelId, member: memberB }],
      [bot.id, { id: bot.id, channelId, member: bot }],
    ]) },
  };
  assert.deepEqual(eligibleVoiceStates(guild).map(m => m.id), [userId, memberB.id]);
  guild.voiceStates.cache.get(memberB.id).selfDeaf = true;
  assert.equal(eligibleVoiceStates(guild).length, 0);
  guild.voiceStates.cache.get(memberB.id).selfDeaf = false;
  guild.voiceStates.cache.get(memberB.id).channelId = afkChannelId;
  assert.equal(eligibleVoiceStates(guild).length, 0);
});

function makeFakeActivityDb() {
  const states = new Map(), receipts = new Map(), earned = new Map();
  let wallet = 0, enabled = true;
  const models = {
    settings: { findOne() { return { async lean() {
      return { messageRewardsEnabled: enabled, voiceRewardsEnabled: enabled };
    } }; } },
    counters: {
      async updateOne(key) { if (!earned.has(key.periodKey)) earned.set(key.periodKey, 0); },
      async findOneAndUpdate(key, change) {
        const cur = earned.get(key.periodKey);
        if (cur > key.earned.$lte) return null;
        earned.set(key.periodKey, cur + change.$inc.earned);
        return { earned: cur + change.$inc.earned };
      },
    },
    messageStates: {
      async updateOne(query, update) {
        if (!states.has(query.discordUserId)) states.set(query.discordUserId, update.$setOnInsert);
      },
      async findOneAndUpdate(query, patch) {
        const state = states.get(query.discordUserId);
        if (state.lastRewardAt > query.lastRewardAt.$lte ||
            state.lastHash === query.lastHash.$ne) return null;
        Object.assign(state, patch.$set);
        return state;
      },
    },
    ledgers: {
      exists(query) { return { async session() { return receipts.has(query.eventKey); } }; },
      async create(rows) {
        for (const row of rows) receipts.set(row.eventKey, row);
      },
    },
    wallets: { async findOneAndUpdate(_key, change) { wallet += change.$inc.balance; } },
  };
  return { models, receipts, earned, states,
    sessionFactory: async () => ({ async withTransaction(fn) { await fn(); }, async endSession() {} }),
    setEnabled(v) { enabled = v; },
    get balance() { return wallet; },
  };
}

test("message earning respects 2m cooldown, duplicate text, idempotency and weekly cap", async () => {
  const db = makeFakeActivityDb(), start = new Date("2026-10-24T12:00:00Z");
  const award = (id, hash, at) => awardRepeatableActivity({
    guildId, userId, joinedAt: oldMemberJoin, type: "message",
    eventKey: `activity-message:${id}`, messageHash: hash,
    now: new Date(start.getTime() + at),
    models: db.models, sessionFactory: db.sessionFactory,
  });
  assert.equal((await award("a", "one", 0)).amount, 2);
  assert.equal((await award("a", "one", 0)).reason, "already_awarded");
  assert.equal((await award("b", "two", 30_000)).reason, "cooldown_or_duplicate");
  assert.equal((await award("c", "one", 150_000)).reason, "cooldown_or_duplicate");
  assert.equal((await award("d", "different", 150_000)).amount, 2);
  assert.equal(db.balance, 4);
  db.setEnabled(false);
  assert.equal((await award("e", "new", 500_000)).reason, "disabled");
});

test("newcomer messages double 2 to 4 Points, but max at starter cap", async () => {
  const db = makeFakeActivityDb(), start = new Date("2026-10-24T14:05:00Z");
  const period = activityPeriod(freshJoin, start);
  db.earned.set(period.key, 424);
  const result = await awardRepeatableActivity({
    guildId, userId, joinedAt: freshJoin, type: "message", eventKey: "msg-one",
    messageHash: "test", now: start, models: db.models, sessionFactory: db.sessionFactory,
  });
  assert.equal(result.reason, "activity_cap");
  assert.equal(db.balance, 0);
  assert.equal(db.earned.get(period.key), 424);
  db.earned.set(period.key, 420);
  const next = await awardRepeatableActivity({
    guildId, userId, joinedAt: freshJoin, type: "message", eventKey: "msg-two",
    messageHash: "fresh", now: new Date(start.getTime() + 125_000),
    models: db.models, sessionFactory: db.sessionFactory,
  });
  assert.equal(next.amount, 4);
  assert.equal(db.balance, 4);
});

test("voice clock pays once per ten eligible minutes, avoids restart minute duplication", async () => {
  assert.equal(VOICE_BASE_POINTS, 5);
  assert.equal(VOICE_INTERVAL_MINUTES, 10);
  const guild = { id: guildId }, member = {
    id: userId, user: { bot: false }, joinedAt: oldMemberJoin,
  };
  let record = null, awardCalls = 0, progressUpdates = 0;
  const progress = {
    async updateOne(key, patch) {
      progressUpdates++;
      if (!record) record = { ...patch.$setOnInsert };
      if (patch.$max) record.lastSettledBlock = Math.max(record.lastSettledBlock, patch.$max.lastSettledBlock);
    },
    async findOneAndUpdate(key, patch) {
      if (record.lastMinuteStamp >= key.lastMinuteStamp.$lt) return null;
      record.eligibleMinutes++;
      record.lastMinuteStamp = patch.$set.lastMinuteStamp;
      return { ...record };
    },
  };
  const now = new Date("2026-10-24T14:10:00Z");
  for (let i = 0; i < 9; i++) {
    const r = await recordVoiceMinute({ guildId, member, now: new Date(now.getTime() + i * 60_000),
      models: { progress }, award: async () => { throw new Error("too early"); } });
    assert.equal(r.reason, "building_voice_time");
  }
  const tenth = new Date(now.getTime() + 9 * 60_000);
  let result = await recordVoiceMinute({ guildId, member, now: tenth,
    models: { progress },
    award: async () => { awardCalls++; return { credited: true, amount: 5 }; } });
  assert.equal(result.amount, 5);
  assert.equal(awardCalls, 1);
  result = await recordVoiceMinute({ guildId, member, now: tenth,
    models: { progress }, award: async () => { awardCalls++; } });
  assert.equal(result.reason, "already_counted_minute");
  assert.equal(awardCalls, 1);
  assert.equal(record.eligibleMinutes, 10);
});

test("chat listener refuses bot and webhook authored messages", async () => {
  const sample = { guildId, id: "1561372971355086960",
    author: { id: userId, bot: true }, content: "This is a long normal message." };
  assert.equal((await awardMessageActivity(sample)).reason, "not_eligible");
  sample.author.bot = false; sample.webhookId = "1561372971355086968";
  assert.equal((await awardMessageActivity(sample)).reason, "not_eligible");
});

test("activity models have unique guild, member and period indexes", () => {
  assert.ok(PointsSettings.schema.path("messageRewardsEnabled").defaultValue === false);
  assert.ok(PointsSettings.schema.path("voiceRewardsEnabled").defaultValue === false);
  assert.ok(PointsActivityCounter.schema.indexes().some(([field, spec]) =>
    field.guildId === 1 && field.discordUserId === 1 && field.periodKey === 1 && spec.unique));
  assert.ok(PointsActivityMessageState.schema.indexes().some(([field, spec]) =>
    field.guildId === 1 && field.discordUserId === 1 && spec.unique));
  assert.ok(PointsVoiceProgress.schema.indexes().some(([field, spec]) =>
    field.guildId === 1 && field.discordUserId === 1 && field.periodKey === 1 && spec.unique));
});
