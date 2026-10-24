// MongoDB-backed, bounded manager audit. No in-memory full-history scans.
import PointsLedger from "../models/PointsLedger.js";

export const AUDIT_MAX_DAYS = 90;
export const AUDIT_EXPORT_MAX_ROWS = 25000;
export const AUDIT_EXPORT_MAX_BYTES = 5 * 1024 * 1024;
export const AUDIT_TYPES = Object.freeze([
  { name: "All earning types", value: "all" },
  { name: "Messages", value: "message" },
  { name: "Voice", value: "voice" },
  { name: "Polls", value: "poll" },
  { name: "Manual and giveaway", value: "manual" },
  { name: "Milestones", value: "milestone" },
]);

export function auditFilter({ guildId, days = 1, userId = null, kind = "all", now = new Date() }) {
  if (typeof guildId !== "string" || !guildId ||
      !Number.isInteger(days) || days < 1 || days > AUDIT_MAX_DAYS ||
      !AUDIT_TYPES.some(x => x.value === kind) || Number.isNaN(now.getTime())) {
    throw new Error("Invalid Points audit filters.");
  }
  const match = { guildId, createdAt: {
    $gte: new Date(now.getTime() - days * 86_400_000), $lte: now,
  } };
  if (userId) match.discordUserId = userId;
  if (kind !== "all") match.kind = kind;
  return match;
}

export function summarizeAuditGroups(groups) {
  const byType = new Map(), byMember = new Map();
  let points = 0, awards = 0;
  for (const entry of groups) {
    const kind = entry._id.kind ?? "unknown";
    const userId = entry._id.discordUserId;
    const amount = Number(entry.points) || 0;
    const count = Number(entry.awards) || 0;
    points += amount; awards += count;
    const type = byType.get(kind) ?? { kind, points: 0, awards: 0 };
    type.points += amount; type.awards += count;
    byType.set(kind, type);
    const member = byMember.get(userId) ?? { userId, points: 0, awards: 0 };
    member.points += amount; member.awards += count;
    byMember.set(userId, member);
  }
  return {
    totalPoints: points, awardCount: awards, memberCount: byMember.size,
    byType: [...byType.values()].sort((a, b) => b.points - a.points || a.kind.localeCompare(b.kind)),
    topMembers: [...byMember.values()].sort((a, b) => b.points - a.points ||
      a.userId.localeCompare(b.userId)).slice(0, 5),
  };
}

export async function pointsAuditSummary({ guildId, days = 1, userId, kind = "all",
  now = new Date(), Ledger = PointsLedger }) {
  const match = auditFilter({ guildId, days, userId, kind, now });
  // Group by kind+member, not by individual receipt. A 700-person guild
  // produces a small result even if the matching ledger contains many records.
  const groups = await Ledger.aggregate([
    { $match: match },
    { $group: {
      _id: { kind: "$kind", discordUserId: "$discordUserId" },
      points: { $sum: "$amount" }, awards: { $sum: 1 },
    } },
  ]).option({ maxTimeMS: 20000 });
  return { ...summarizeAuditGroups(groups), since: match.createdAt.$gte, until: now, days };
}

// Escape comma/newline/quotes and guard formula injection when opened as a
// spreadsheet. User IDs and snowflakes are quoted strings. Import ID columns
// as text in Excel to avoid rounding their 17–21 digits.
export function csvCell(value) {
  let string = value instanceof Date ? value.toISOString() : String(value ?? "");
  if (/^[\s\t]*[=+@-]/.test(string)) string = "'" + string;
  return '"' + string.replace(/"/g, '""') + '"';
}

export const AUDIT_CSV_HEADERS = [
  "awarded_at_utc", "guild_id", "member_id", "type", "points",
  "reason", "source_id", "awarded_by_id", "event_key",
];
export function receiptCsvLine(receipt) {
  return [
    receipt.createdAt, receipt.guildId, receipt.discordUserId,
    receipt.kind, receipt.amount, receipt.description,
    receipt.sourceId, receipt.actorId, receipt.eventKey,
  ].map(csvCell).join(",") + "\r\n";
}

export async function exportPointsAudit({ guildId, days = 7, userId,
  kind = "all", now = new Date(), Ledger = PointsLedger,
  maxRows = AUDIT_EXPORT_MAX_ROWS, maxBytes = AUDIT_EXPORT_MAX_BYTES }) {
  const match = auditFilter({ guildId, days, userId, kind, now });
  // Bounded result, cursor/batches instead of .find().lean() on millions.
  // Never silently truncate: a partial CSV would be misleading for auditing.
  const cursor = Ledger.find(match).select(
    "createdAt guildId discordUserId kind amount description sourceId actorId eventKey",
  ).sort({ createdAt: -1 }).limit(maxRows + 1).lean()
    .maxTimeMS(20000).cursor({ batchSize: 500 });
  const parts = ["\uFEFF", AUDIT_CSV_HEADERS.join(",") + "\r\n"];
  let rows = 0, bytes = Buffer.byteLength(parts.join(""), "utf8");
  try {
    for await (const entry of cursor) {
      if (rows >= maxRows) {
        throw new Error(`Audit export exceeds ${maxRows.toLocaleString()} records. Choose fewer days, a member, or a type.`);
      }
      const line = receiptCsvLine(entry);
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (bytes + lineBytes > maxBytes) {
        throw new Error("Audit CSV exceeds 5 MiB. Choose fewer days, a member, or a type.");
      }
      parts.push(line);
      rows++;
      bytes += lineBytes;
    }
  } finally {
    await cursor.close();
  }
  return { rows, bytes, csv: Buffer.from(parts.join(""), "utf8"), since: match.createdAt.$gte };
}
