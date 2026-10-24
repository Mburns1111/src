import test from "node:test";
import assert from "node:assert/strict";
import { pollWeekStartUtc, pollEventKey, awardNativePollVote,
  POLL_POINTS_PER_POLL, POLL_WEEKLY_CAP } from "../services/poll-rewards.js";
import { parseBulkRecipients, bulkAwardDetails, BULK_REASON_CHOICES } from "../services/points-bulk.js";
import PointsWeeklyCounter from "../models/PointsWeeklyCounter.js";
import ParticipationSource from "../models/ParticipationSource.js";

const guildId = "1561372971355086958", channelId = "1561372971355086959";
const userId = "1561372971355086961";
const msg1 = "1561372971355086960", msg2 = "1561372971355086962",
  msg3 = "1561372971355086963", msg4 = "1561372971355086964";

test("poll rewards use UTC Monday–Sunday weeks, five Points, fifteen cap", () => {
  assert.equal(POLL_POINTS_PER_POLL, 5);
  assert.equal(POLL_WEEKLY_CAP, 15);
  assert.equal(pollWeekStartUtc(new Date("2026-10-24T23:59:59Z")), "2026-10-19");
  assert.equal(pollWeekStartUtc(new Date("2026-10-26T00:00:00Z")), "2026-10-26");
  assert.equal(pollEventKey(msg1), "native-poll:" + msg1);
  assert.ok(PointsWeeklyCounter.schema.indexes().some(([index, opts]) =>
    opts.unique === true && index.weekStartUtc === 1));
  assert.ok(ParticipationSource.schema.path("rewardEnabled"));
});

function createFakeDatabase() {
  const receipts = new Map();
  const counts = new Map();
  let walletBalance = 0;
  let approved = true, active = true;
  const keyFor = x => x.eventKey + ":" + x.discordUserId;
  const models = {
    sources: { findOne() { return { async lean() { return approved ? { rewardEnabled: true } : null; } }; } },
    participants: { findOne() { return { async lean() { return active ? { answerIds: [1] } : null; } }; } },
    ledger: {
      exists(q) { return { async session() { return receipts.has(keyFor(q)); } }; },
      async create(rows) {
        for (const row of rows) {
          if (receipts.has(keyFor(row))) { const error = Error("duplicate"); error.code = 11000; throw error; }
          receipts.set(keyFor(row), row);
        }
      },
    },
    wallets: { async findOneAndUpdate(_selector, patch) { walletBalance += patch.$inc.balance; } },
    counters: {
      async updateOne(filter) { if (!counts.has(filter.weekStartUtc)) counts.set(filter.weekStartUtc, 0); },
      async findOneAndUpdate(filter, patch) {
        const old = counts.get(filter.weekStartUtc);
        if (old > filter.pollPoints.$lte) return null;
        counts.set(filter.weekStartUtc, old + patch.$inc.pollPoints);
        return { pollPoints: old + patch.$inc.pollPoints };
      },
    },
    activityCounters: {
      async updateOne() {},
      async findOneAndUpdate() { return { earned: 5 }; },
    },
  };
  const sessionFactory = async () => ({
    async withTransaction(fn) { await fn(); },
    async endSession() {},
  });
  return { models, sessionFactory, get walletBalance() { return walletBalance; },
    counts, receipts, setApproved: x => { approved = x; },
    setActive: x => { active = x; } };
}

test("same vote is rewarded once; weekly cap blocks fourth unique poll", async () => {
  const db = createFakeDatabase();
  const guild = { members: { async fetch(id) { return { id, user: { bot: false } }; } } };
  const vote = messageId => awardNativePollVote({
    guildId, channelId, messageId, userId, guild, models: db.models,
    sessionFactory: db.sessionFactory, now: new Date("2026-10-24T15:00:00Z"),
  });
  for (const messageId of [msg1, msg2, msg3]) {
    assert.equal((await vote(messageId)).credited, true);
  }
  assert.equal((await vote(msg1)).reason, "already_awarded");
  assert.equal((await vote(msg4)).reason, "weekly_limit");
  assert.equal(db.walletBalance, 15);
  assert.equal(db.receipts.size, 3);
  assert.equal(db.counts.get("2026-10-19"), 15);
});

test("unapproved, removed, and bot votes never earn Points", async () => {
  const db = createFakeDatabase();
  const vote = (guild) => awardNativePollVote({
    guildId, channelId, messageId: msg1, userId, guild, models: db.models,
    sessionFactory: db.sessionFactory,
  });
  db.setApproved(false);
  assert.equal((await vote()).reason, "not_approved");
  db.setApproved(true); db.setActive(false);
  assert.equal((await vote()).reason, "no_active_vote");
  db.setActive(true);
  assert.equal((await vote({ members: { async fetch() { return { user: { bot: true } }; } } })).reason,
    "not_a_member");
  assert.equal(db.walletBalance, 0);
});

test("bulk member list accepts mentions, de-duplicates IDs, rejects nonmembers and roles", () => {
  const secondId = "1561372971355086972";
  assert.deepEqual(parseBulkRecipients(`<@${userId}>, <@!${secondId}> ${userId}`), [userId, secondId]);
  assert.throws(() => parseBulkRecipients("<@&1561372971355086961>"), /Invalid member/);
  assert.throws(() => parseBulkRecipients("all users"), /Invalid member/);
  assert.throws(() => parseBulkRecipients(""), /at least one member/);
  assert.throws(() => parseBulkRecipients(Array(21).fill(userId).join(",")), /at most 20/);
});

test("bulk credit reasons and event references are audit-friendly and stable", () => {
  assert.deepEqual(BULK_REASON_CHOICES.map(choice => choice.value),
    ["giveaway", "participation", "event", "helpfulness", "other"]);
  assert.deepEqual(bulkAwardDetails("giveaway", "Pumpkin raffle", "  October-Giveaway_1  "), {
    description: "Giveaway: Pumpkin raffle", category: "giveaway", reference: "october-giveaway_1",
  });
  assert.throws(() => bulkAwardDetails("giveaway", "", "oops invalid event"), /Event reference/);
});
