import test from "node:test";
import assert from "node:assert/strict";
import PointsLedger from "../models/PointsLedger.js";
import { data as adminData } from "../commands/points-admin.js";
import { runBounded, VOICE_TICK_CONCURRENCY } from "../services/bounded-work.js";
import {
  AUDIT_TYPES, AUDIT_MAX_DAYS, AUDIT_EXPORT_MAX_ROWS, AUDIT_EXPORT_MAX_BYTES,
  auditFilter, csvCell, receiptCsvLine, summarizeAuditGroups,
  pointsAuditSummary, exportPointsAudit, AUDIT_CSV_HEADERS,
} from "../services/points-audit.js";

const guildId = "1561372971355086958";
const memberId = "1561372971355086961";
const now = new Date("2026-10-24T16:00:00.000Z");
const record = n => ({
  createdAt: new Date(now.getTime() - n * 1000),
  guildId, discordUserId: memberId, kind: n % 2 ? "voice" : "message",
  amount: n % 2 ? 1 : 2,
  description: "Qualified Discord message",
  sourceId: "1561372971355086999", actorId: "",
  eventKey: `activity-message:${1561372971355086970n + BigInt(n)}`,
});

test("audit commands are management-only and provide 1-90 day filters", () => {
  const command = adminData.toJSON();
  assert.ok(command.default_member_permissions, "manager-only default");
  for (const name of ["audit", "audit-export"]) {
    const sub = command.options.find(x => x.name === name);
    assert.ok(sub, name);
    assert.equal(sub.options.find(x => x.name === "days").max_value, 90);
    assert.ok(sub.options.find(x => x.name === "member"));
    assert.equal(sub.options.find(x => x.name === "type").choices.length, AUDIT_TYPES.length);
  }
  assert.equal(AUDIT_MAX_DAYS, 90);
});

test("audits are time-bound, guild-specific, and optionally member/type-filtered", () => {
  const match = auditFilter({ guildId, days: 7, kind: "voice", userId: memberId, now });
  assert.equal(match.guildId, guildId);
  assert.equal(match.kind, "voice");
  assert.equal(match.discordUserId, memberId);
  assert.equal(match.createdAt.$lte.toISOString(), now.toISOString());
  assert.equal(match.createdAt.$gte.toISOString(), "2026-10-17T16:00:00.000Z");
  assert.throws(() => auditFilter({ guildId, days: 0, now }), /Invalid/);
  assert.throws(() => auditFilter({ guildId, days: 91, now }), /Invalid/);
  assert.throws(() => auditFilter({ guildId, days: 7, kind: "$ne", now }), /Invalid/);
});

test("server-wide reporting summarizes 700 members without materializing every event", async () => {
  const members = Array.from({ length: 700 }, (_, i) =>
    (1561372971355086958n + BigInt(i + 1)).toString());
  const groups = members.flatMap((id, i) => [
    { _id: { kind: "message", discordUserId: id }, points: (i < 100 ? 48 : 8), awards: i < 100 ? 24 : 4 },
    { _id: { kind: "voice", discordUserId: id }, points: i < 100 ? 18 : 1, awards: i < 100 ? 18 : 1 },
  ]);
  const report = summarizeAuditGroups(groups);
  assert.equal(report.memberCount, 700);
  assert.equal(report.awardCount, 100 * 42 + 600 * 5);
  assert.equal(report.totalPoints, 100 * 66 + 600 * 9);
  assert.equal(report.byType.length, 2);
  assert.equal(report.topMembers.length, 5);
  let pipeline;
  const Ledger = {
    aggregate(value) {
      pipeline = value;
      return { async option(config) {
        assert.equal(config.maxTimeMS, 20000);
        return groups;
      } };
    },
  };
  const result = await pointsAuditSummary({ guildId, days: 1, now, Ledger });
  assert.equal(result.awardCount, report.awardCount);
  assert.equal(pipeline[0].$match.guildId, guildId);
  assert.ok(pipeline[0].$match.createdAt);
  assert.equal(pipeline[1].$group._id.discordUserId, "$discordUserId");
});

test("CSV escapes quotes, commas, newlines and spreadsheet-formula prefixes", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvCell("=HYPERLINK()"), '"\'=HYPERLINK()"');
  assert.equal(csvCell(" -1+1"), '"\' -1+1"');
  const line = receiptCsvLine({ ...record(0), description: "=evil,\nformula" });
  assert.match(line, /"\'=evil,\nformula"/);
  assert.equal(line.split("\r\n").length, 2);
});

function fakeLedger(records, flags = {}) {
  let cursorClosed = false;
  const query = {
    select() { return this; },
    sort(sort) { assert.equal(sort.createdAt, -1); return this; },
    limit(number) { assert.ok(number <= AUDIT_EXPORT_MAX_ROWS + 1); return this; },
    lean() { return this; },
    maxTimeMS(n) { assert.equal(n, 20000); return this; },
    cursor({ batchSize }) {
      assert.equal(batchSize, 500);
      return {
        async *[Symbol.asyncIterator]() {
          for (const rec of records) yield rec;
        },
        async close() { cursorClosed = true; },
      };
    },
  };
  return {
    find(match) { assert.equal(match.guildId, guildId); return query; },
    get closed() { return cursorClosed; },
  };
}

test("CSV export streams and includes all critical audit fields", async () => {
  const ledger = fakeLedger([record(0), record(1)]);
  const result = await exportPointsAudit({ guildId, days: 7, now, Ledger: ledger });
  assert.equal(result.rows, 2);
  assert.ok(result.csv.length < AUDIT_EXPORT_MAX_BYTES);
  assert.match(result.csv.toString("utf8"), /awarded_at_utc,guild_id,member_id,type,points,reason,source_id,awarded_by_id,event_key/);
  assert.ok(result.csv.toString("utf8").includes(memberId));
  assert.equal(ledger.closed, true);
  assert.equal(AUDIT_CSV_HEADERS.length, 9);
});

test("CSV aborts rather than exporting incomplete history when row or size cap reached", async () => {
  let ledger = fakeLedger([record(0), record(1)]);
  await assert.rejects(() => exportPointsAudit({
    guildId, days: 7, now, Ledger: ledger, maxRows: 1,
  }), /exceeds 1 records/);
  assert.equal(ledger.closed, true);
  ledger = fakeLedger([record(0)]);
  await assert.rejects(() => exportPointsAudit({
    guildId, days: 7, now, Ledger: ledger, maxBytes: 120,
  }), /exceeds 5 MiB/);
  assert.equal(ledger.closed, true);
});

test("ledger has indexes for time-window and type filtering, as well as per-user receipts", () => {
  const keys = PointsLedger.schema.indexes().map(([fields]) => fields);
  assert.ok(keys.some(x => x.guildId === 1 && x.createdAt === -1 &&
    Object.keys(x).length === 2));
  assert.ok(keys.some(x => x.guildId === 1 && x.kind === 1 && x.createdAt === -1));
  assert.ok(keys.some(x => x.guildId === 1 && x.discordUserId === 1 && x.createdAt === -1));
  assert.ok(keys.some(x => x.guildId === 1 && x.discordUserId === 1 && x.eventKey === 1));
});

test("voice work runs up to ten concurrent tasks without exceeding the cap", async () => {
  assert.equal(VOICE_TICK_CONCURRENCY, 10);
  let active = 0, peak = 0, done = 0;
  const records = Array.from({ length: 700 }, (_, i) => i);
  await runBounded(records, async () => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    done++;
  });
  assert.equal(done, 700);
  assert.ok(peak <= 10 && peak >= 2);
  await assert.rejects(() => runBounded([1], () => {}, 0), /Invalid/);
});
