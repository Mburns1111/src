import test from "node:test";
import assert from "node:assert/strict";
import { planMessageCredits, collectRecentMessages, creditScannedMessage,
  timestampFromSnowflake, snowflakeAtTimestamp, MESSAGE_SCAN_MAX_HOURS,
} from "../services/message-reward-scan.js";
import { MESSAGE_COOLDOWN_MS } from "../services/activity-rewards.js";
import { data as adminCommand } from "../commands/points-admin.js";

const guildId = "1561372971355086958";
const memberId = "1561372971355086961";
const otherId = "1561372971355086962";
const channelId = "1561372971355086963";
const base = new Date("2026-10-24T10:00:00Z").getTime();
function idAt(timestamp, sequence = 0) {
  return ((BigInt(timestamp - 1420070400000) << 22n) + BigInt(sequence)).toString();
}
function message(userId, minutes, hash, seq=0) {
  const createdTimestamp = base + minutes * 60_000;
  return { userId, createdTimestamp, hash, channelId,
    guildId, id: idAt(createdTimestamp, seq) };
}
const old = { id: memberId, joinedAt: new Date("2026-09-01T10:00:00Z"), user: { bot: false } };
const newMember = { id: otherId, joinedAt: new Date("2026-10-24T09:55:00Z"), user: { bot: false } };

test("message scan command offers configurable hours and requires apply:true to credit", () => {
  const command = adminCommand.toJSON();
  const scan = command.options.find(x => x.name === "scan-messages");
  assert.ok(scan);
  assert.equal(scan.options.find(x => x.name === "apply").required, false);
  assert.equal(scan.options.find(x => x.name === "hours").max_value, MESSAGE_SCAN_MAX_HOURS);
});

test("Discord snowflake scan cutoff and decoded historical timestamps are reversible", () => {
  assert.equal(timestampFromSnowflake(idAt(base)), base);
  assert.equal(timestampFromSnowflake(snowflakeAtTimestamp(base)), base);
  assert.equal(MESSAGE_COOLDOWN_MS, 30 * 60_000);
});

test("staff scan respects historical paid anchors, per-member cooldown and first-week multiplier", () => {
  const messages = [
    message(memberId, 0, "a"),
    message(memberId, 10, "b"),
    message(memberId, 20, "c"),
    message(memberId, 51, "d"),
    message(otherId, 5, "x"),
    message(otherId, 35, "y"),
    message(otherId, 65, "z"),
  ];
  // Member A was already rewarded at minute 20 by live events.
  const prior = [{ discordUserId: memberId, eventKey: `activity-message:${messages[2].id}` }];
  const results = planMessageCredits(messages, prior, new Map([
    [memberId, old], [otherId, newMember],
  ]));
  assert.deepEqual(results.filter(x => x.userId === memberId).map(x => x.createdTimestamp),
    [base + 51 * 60_000], "paid at 20m blocks older messages within its cooldown");
  assert.deepEqual(results.filter(x => x.userId === otherId).map(x => x.amount),
    [4, 4, 4]);
  assert.equal(results.reduce((sum, x) => sum + x.amount, 0), 14);
});

test("historical scans cannot pay immediately repeated content or members who left", () => {
  const msgs = [
    message(memberId, 0, "same"),
    message(memberId, 35, "same"),
    message(memberId, 65, "new"),
    message(otherId, 65, "left"),
  ];
  const result = planMessageCredits(msgs, [], new Map([[memberId, old]]));
  assert.deepEqual(result.map(x => x.createdTimestamp), [
    base, base + 65 * 60_000,
  ]);
});

test("catch-up fetch excludes last 30 minutes, ignores low-content posts and honors readability", async () => {
  const now = new Date(base + 120 * 60_000);
  const eligible = message(memberId, 45, "unused");
  const recent = message(memberId, 105, "unused");
  const tiny = message(memberId, 20, "unused");
  const channel = {
    id: channelId, type: 0,
    permissionsFor() { return { has() { return true; } }; },
    messages: {
      async fetch(options) {
        assert.equal(options.limit, 100);
        // Discord returns messages strictly before the cutoff snowflake.
        const all = [
          { ...eligible, author: { id: memberId, bot: false }, content: "A very readable qualifying Discord sentence." },
          { ...recent, author: { id: memberId, bot: false }, content: "Another full sentence that is too recent." },
          { ...tiny, author: { id: memberId, bot: false }, content: "hi" },
        ];
        return new Map(all.filter(x => BigInt(x.id) < BigInt(options.before))
          .map(x => [x.id, x]));
      },
    },
  };
  const guild = {
    members: { me: { id: "1561372971355086968" } },
    channels: {
      async fetch() { return new Map([[channelId, channel]]); },
      async fetchActiveThreads() { return { threads: new Map() }; },
    },
  };
  const result = await collectRecentMessages(guild, old, { hours: 2, now });
  assert.equal(result.channels, 1);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].id, eligible.id);
  assert.equal("content" in result.messages[0], false, "message text is never retained by scan planner");
});

test("scanned message credits update ledger, wallet and earnings totals only once", async () => {
  const receipts = new Set();
  let balance = 0, total = 0;
  const models = {
    ledger: {
      exists(query) { return { async session() { return receipts.has(query.eventKey); } }; },
      async create(rows) {
        assert.equal(rows[0].kind, "message");
        assert.equal(rows[0].description, "Qualified Discord message (staff scan)");
        receipts.add(rows[0].eventKey);
      },
    },
    wallets: { async findOneAndUpdate(_filter, update) { balance += update.$inc.balance; } },
    counters: {
      async updateOne() {},
      async findOneAndUpdate(_filter, update) { total += update.$inc.earned; },
    },
  };
  const source = { ...message(memberId, 0, "good"), amount: 2, periodKey: "week:2026-10-19" };
  const sessionFactory = async () => ({
    async withTransaction(callback) { await callback(); },
    async endSession() {},
  });
  for (const expected of [true, false]) {
    const credited = await creditScannedMessage({
      guildId, message: source, member: old,
      actorId: otherId, models, sessionFactory,
    });
    assert.equal(credited, expected);
  }
  assert.equal(balance, 2);
  assert.equal(total, 2);
  assert.equal(receipts.size, 1);
});
