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
  assert.equal(starter.multiplier, 2);
  assert.equal("cap" in starter, false);
  assert.equal(starter.key, `starter:${freshJoin.getTime()}`);
  const regular = activityPeriod(freshJoin, new Date(freshJoin.getTime() + FIRST_WEEK_MS));
  assert.equal(regular.multiplier, 1);
  assert.equal("cap" in regular, false);
  assert.match(regular.key, /^week:\d{4}-\d\d-\d\d$/);
  assert.equal(activityPeriod(null, new Date("2026-10-24T14:00:00Z")).starter, false);
});

test("message qualification drops URLs, short messages and bot commands", () => {
  assert.equal(MESSAGE_BASE_POINTS, 2);
  assert.equal(MESSAGE_COOLDOWN_MS, 1_800_000);
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
        assert.equal("earned" in key, false, "activity records must not enforce a weekly ceiling");
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

test("message earning respects 30m cooldown, duplicate text and idempotency without a weekly cap", async () => {
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
  assert.equal((await award("c", "one", 1_830_000)).reason, "cooldown_or_duplicate");
  assert.equal((await award("d", "different", 1_830_000)).amount, 2);
  assert.equal(db.balance, 4);
  db.setEnabled(false);
  assert.equal((await award("e", "new", 500_000)).reason, "disabled");
});

test("newcomer messages double 2 to 4 Points and exceed the former 425-Point limit", async () => {
  const db = makeFakeActivityDb(), start = new Date("2026-10-24T14:05:00Z");
  const period = activityPeriod(freshJoin, start);
  db.earned.set(period.key, 424);
  const first = await awardRepeatableActivity({
    guildId, userId, joinedAt: freshJoin, type: "message", eventKey: "msg-one",
    messageHash: "test", now: start, models: db.models, sessionFactory: db.sessionFactory,
  });
  assert.equal(first.amount, 4);
  assert.equal(db.balance, 4);
  assert.equal(db.earned.get(period.key), 428);
  const second = await awardRepeatableActivity({
    guildId, userId, joinedAt: freshJoin, type: "message", eventKey: "msg-two",
    messageHash: "fresh", now: new Date(start.getTime() + 1_805_000),
    models: db.models, sessionFactory: db.sessionFactory,
  });
  assert.equal(second.amount, 4);
  assert.equal(db.balance, 8);
  assert.equal(db.earned.get(period.key), 432);
});

test("one-Point voice awards continue beyond the former weekly limit", async () => {
  const db = makeFakeActivityDb();
  const now = new Date("2026-10-24T12:00:00Z");
  const period = activityPeriod(oldMemberJoin, now);
  db.earned.set(period.key, 225);
  const award = await awardRepeatableActivity({
    guildId, userId, joinedAt: oldMemberJoin, type: "voice", eventKey: "voice-above-old-cap",
    now, models: db.models, sessionFactory: db.sessionFactory,
  });
  assert.equal(award.amount, 1);
  assert.equal(db.earned.get(period.key), 226);
  assert.equal(db.balance, 1);
});

test("voice clock pays once per ten eligible minutes, avoids restart minute duplication", async () => {
  assert.equal(VOICE_BASE_POINTS, 1);
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
    award: async () => { awardCalls++; return { credited: true, amount: 1 }; } });
  assert.equal(result.amount, 1);
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

test("no daily cap: more than ten qualifying messages can earn in one UTC day", async () => {
  const db = makeFakeActivityDb();
  const origin = new Date("2026-10-24T00:01:00Z");
  for (let i = 0; i < 12; i++) {
    const result = await awardRepeatableActivity({
      guildId, userId, joinedAt: oldMemberJoin,
      type: "message", eventKey: `daily-msg-${i}`,
      messageHash: `unique-${i}`,
      now: new Date(origin.getTime() + i * MESSAGE_COOLDOWN_MS),
      models: db.models, sessionFactory: db.sessionFactory,
    });
    assert.equal(result.amount, 2, `message ${i + 1} should earn two Points`);
  }
  assert.equal(db.balance, 24);
  assert.equal(db.receipts.size, 12);
  assert.equal(db.earned.get(activityPeriod(oldMemberJoin, origin).key), 24);
});

test("voice rewards are 1 Point for established members and 2 for first-week members", async () => {
  const now = new Date("2026-10-24T14:10:00Z");
  for (const [joinedAt, expected] of [[oldMemberJoin, 1], [freshJoin, 2]]) {
    const db = makeFakeActivityDb();
    const result = await awardRepeatableActivity({
      guildId, userId, joinedAt, type: "voice",
      eventKey: `voice-${expected}`, now,
      models: db.models, sessionFactory: db.sessionFactory,
    });
    assert.equal(result.amount, expected);
    assert.equal(db.balance, expected);
  }
});
