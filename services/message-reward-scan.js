import mongoose from "mongoose";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import PointsSettings from "../models/PointsSettings.js";
import PointsLedger from "../models/PointsLedger.js";
import PointsWallet from "../models/PointsWallet.js";
import PointsActivityCounter from "../models/PointsActivityCounter.js";
import { activityPeriod } from "./activity-period.js";
import { MESSAGE_BASE_POINTS, MESSAGE_COOLDOWN_MS,
  qualifyingMessageText } from "./activity-rewards.js";

const DISCORD_EPOCH = 1420070400000n;
export const MESSAGE_SCAN_MAX_HOURS = 168;
export const MESSAGE_SCAN_MAX_CHANNELS = 100;
export const MESSAGE_SCAN_MAX_MESSAGES = 6000;
export const MESSAGE_SCAN_MAX_AWARDS = 500;

export function timestampFromSnowflake(id) {
  try { return Number((BigInt(id) >> 22n) + DISCORD_EPOCH); }
  catch { return NaN; }
}
export function snowflakeAtTimestamp(timestamp) {
  return ((BigInt(Math.floor(timestamp)) - DISCORD_EPOCH) << 22n).toString();
}
export function messageAwardKey(id) {
  return `activity-message:${id}`;
}

// Planning is pure. Existing awarded messages act as anchors even when they
// are outside the current scan, so a replay cannot fill gaps around paid posts.
// Input messages contain ONLY a hash and metadata, never message bodies.
export function planMessageCredits(messages, receipts, currentMembers) {
  const paid = new Map();
  const scannedById = new Map(messages.map(item => [item.id, item]));
  for (const entry of receipts) {
    const id = String(entry.eventKey ?? "").replace(/^activity-message:/, "");
    const when = timestampFromSnowflake(id);
    if (!Number.isFinite(when)) continue;
    if (!paid.has(entry.discordUserId)) paid.set(entry.discordUserId, []);
    paid.get(entry.discordUserId).push({
      timestamp: when, hash: scannedById.get(id)?.hash ?? null, paid: true,
    });
  }
  const accepted = new Map([...paid].map(([id, entries]) => [id, entries]));
  const proposed = [];
  const sorted = [...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp ||
    a.id.localeCompare(b.id));
  for (const msg of sorted) {
    const member = currentMembers.get(msg.userId);
    if (!member || member.user?.bot || !member.joinedAt ||
        msg.createdTimestamp < new Date(member.joinedAt).getTime()) continue;
    const anchors = accepted.get(msg.userId) ?? [];
    // A posted message may already have been rewarded by the online listener.
    if (anchors.some(item => item.timestamp === msg.createdTimestamp && item.paid)) continue;
    // Respect past AND future previously paid events; scanning never
    // retroactively awards a message too close to a live credited message.
    if (anchors.some(item => Math.abs(item.timestamp - msg.createdTimestamp) < MESSAGE_COOLDOWN_MS)) continue;
    const latestEarlier = anchors.filter(x => x.timestamp < msg.createdTimestamp)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (latestEarlier?.hash && latestEarlier.hash === msg.hash) continue;
    const period = activityPeriod(member.joinedAt, new Date(msg.createdTimestamp));
    const amount = MESSAGE_BASE_POINTS * period.multiplier;
    proposed.push({ ...msg, amount, periodKey: period.key });
    anchors.push({ timestamp: msg.createdTimestamp, hash: msg.hash, paid: false });
    accepted.set(msg.userId, anchors);
  }
  return proposed;
}

function hasAccess(channel, member, clientMember) {
  if (!channel.messages || typeof channel.messages.fetch !== "function") return false;
  if (typeof channel.permissionsFor !== "function") return true;
  const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
  const staffPermissions = channel.permissionsFor(member);
  const botPermissions = clientMember ? channel.permissionsFor(clientMember) : null;
  return Boolean(staffPermissions?.has(required) && botPermissions?.has(required));
}

// A configured category excludes its children; a configured text/announcement
// channel excludes active threads beneath it. Unrelated channels are unaffected.
export function channelIgnoredByScan(channel, excludedIds, channelMap) {
  const seen = new Set();
  let current = channel;
  while (current && !seen.has(current.id)) {
    if (excludedIds.has(current.id)) return true;
    seen.add(current.id);
    if (!current.parentId) break;
    if (excludedIds.has(current.parentId)) return true;
    current = channelMap.get(current.parentId);
  }
  return false;
}

export async function collectRecentMessages(guild, manager, {
  now = new Date(), hours = 24, excludedChannelIds = [],
} = {}) {
  if (!Number.isInteger(hours) || hours < 1 || hours > MESSAGE_SCAN_MAX_HOURS) {
    throw new Error(`Choose 1–${MESSAGE_SCAN_MAX_HOURS} hours to scan.`);
  }
  const cutoff = now.getTime() - MESSAGE_COOLDOWN_MS;
  const since = now.getTime() - hours * 3600000;
  if (since >= cutoff) throw new Error("The scan window must be longer than the live 30-minute cooldown.");
  const fetched = await guild.channels.fetch();
  let all = [...fetched.values()];
  if (typeof guild.channels.fetchActiveThreads === "function") {
    const threads = await guild.channels.fetchActiveThreads();
    all.push(...(threads?.threads?.values?.() ?? []));
  }
  const eligibleTypes = new Set([
    ChannelType.GuildText, ChannelType.GuildAnnouncement,
    ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread,
  ]);
  const channelMap = new Map(all.filter(Boolean).map(channel => [channel.id, channel]));
  const unique = new Map();
  for (const channel of all) {
    if (channel && eligibleTypes.has(channel.type)) unique.set(channel.id, channel);
  }
  const excludedIds = new Set(excludedChannelIds);
  const candidates = [...unique.values()].filter(channel =>
    !channelIgnoredByScan(channel, excludedIds, channelMap));
  const skippedExcluded = unique.size - candidates.length;
  const allowed = candidates.filter(channel =>
    hasAccess(channel, manager, guild.members.me));
  if (allowed.length > MESSAGE_SCAN_MAX_CHANNELS) {
    throw new Error(`Too many readable channels (${allowed.length}); a scan supports at most ${MESSAGE_SCAN_MAX_CHANNELS}. Use /points-admin scan-exclude to omit channels or categories.`);
  }
  const messages = [], messageIds = new Set();
  let totalFetched = 0, skippedInaccessible = candidates.length - allowed.length;
  const cutoffSnowflake = snowflakeAtTimestamp(cutoff);
  for (const channel of allowed) {
    let before = cutoffSnowflake, channelFetched = 0;
    while (true) {
      let page;
      try {
        page = await channel.messages.fetch({ limit: 100, before });
      } catch (error) {
        throw new Error(`Unable to read channel ${channel.id}: ${error.message}. No Points have been changed.`);
      }
      const entries = [...page.values()];
      if (!entries.length) break;
      channelFetched += entries.length;
      totalFetched += entries.length;
      if (totalFetched > MESSAGE_SCAN_MAX_MESSAGES || channelFetched > 1000) {
        throw new Error("Scan is too large to complete safely. Try a shorter hours window; no Points have been changed.");
      }
      for (const message of entries) {
        if (!message.guildId || message.author?.bot || !message.author?.id ||
            message.webhookId || message.system || message.createdTimestamp < since ||
            message.createdTimestamp >= cutoff || messageIds.has(message.id)) continue;
        const hash = qualifyingMessageText(message.content);
        if (!hash) continue;
        messageIds.add(message.id);
        messages.push({ id: message.id, guildId: message.guildId,
          channelId: message.channelId, userId: message.author.id,
          createdTimestamp: message.createdTimestamp, hash });
      }
      const oldest = entries.reduce((a, b) =>
        BigInt(a.id) < BigInt(b.id) ? a : b);
      if (oldest.createdTimestamp < since || entries.length < 100) break;
      before = oldest.id;
    }
  }
  return { messages, totalFetched, channels: allowed.length,
    skippedExcluded, skippedInaccessible, since, cutoff };
}

export async function creditScannedMessage({ guildId, message, member, actorId,
  models = {}, sessionFactory = () => mongoose.startSession() }) {
  const { ledger = PointsLedger, wallets = PointsWallet, counters = PointsActivityCounter } = models;
  const selector = { guildId, discordUserId: member.id, eventKey: messageAwardKey(message.id) };
  const period = { guildId, discordUserId: member.id, periodKey: message.periodKey };
  await counters.updateOne(period, { $setOnInsert: { ...period, earned: 0 } }, { upsert: true });
  const session = await sessionFactory();
  let credited = false;
  try {
    await session.withTransaction(async () => {
      if (await ledger.exists(selector).session(session)) return;
      await ledger.create([{ ...selector, kind: "message", amount: message.amount,
        description: "Qualified Discord message (staff scan)",
        sourceId: message.channelId, actorId,
      }], { session });
      await wallets.findOneAndUpdate({ guildId, discordUserId: member.id },
        { $inc: { balance: message.amount } },
        { session, upsert: true, setDefaultsOnInsert: true, returnDocument: "after" });
      await counters.findOneAndUpdate(period, { $inc: { earned: message.amount } },
        { session, returnDocument: "after" });
      credited = true;
    });
  } catch (error) {
    if (Number(error?.code) === 11000 && await ledger.exists(selector)) return false;
    throw error;
  } finally {
    await session.endSession();
  }
  return credited;
}

export async function scanAndAwardMessages({ guild, manager, hours = 24,
  apply = false, now = new Date(), actorId }) {
  const guildId = guild.id;
  const settings = await PointsSettings.findOne({ guildId }).lean();
  if (settings?.messageRewardsEnabled !== true) {
    throw new Error("Message earning is disabled. Enable it with /points-admin activity-toggle before scanning.");
  }
  const snapshot = await collectRecentMessages(guild, manager, {
    hours, now, excludedChannelIds: settings.messageScanExcludedChannelIds ?? [],
  });
  const ids = [...new Set(snapshot.messages.map(item => item.userId))];
  const members = new Map();
  for (const id of ids) {
    const member = await guild.members.fetch(id).catch(() => null);
    if (member && !member.user?.bot) members.set(id, member);
  }
  let paid = [];
  if (ids.length) {
    const possible = await PointsLedger.find({
      guildId, discordUserId: { $in: ids }, kind: "message",
      // Snowflake IDs sort chronologically as decimal strings in the same
      // modern Discord ID width. A one-cooldown margin on both ends includes
      // live awards that might affect the first/last scanned messages.
      eventKey: {
        $gte: messageAwardKey(snowflakeAtTimestamp(snapshot.since - MESSAGE_COOLDOWN_MS)),
        $lt: messageAwardKey(snowflakeAtTimestamp(snapshot.cutoff + MESSAGE_COOLDOWN_MS)),
      },
    }).select("discordUserId eventKey").limit(20001).lean();
    if (possible.length > 20000) {
      throw new Error("Too many historical message receipts to audit safely. Narrow the scan before awarding.");
    }
    paid = possible;
  }
  const planned = planMessageCredits(snapshot.messages, paid, members);
  if (planned.length > MESSAGE_SCAN_MAX_AWARDS) {
    throw new Error(`This scan contains ${planned.length} eligible awards, exceeding the ${MESSAGE_SCAN_MAX_AWARDS}-award safety limit. Use a shorter hours window.`);
  }
  let credited = 0, points = 0, failed = 0;
  if (apply) {
    for (const message of planned) {
      try {
        if (await creditScannedMessage({
          guildId, message, member: members.get(message.userId), actorId,
        })) {
          credited++;
          points += message.amount;
        }
      } catch (error) {
        failed++;
        console.error(`[Points] Failed historical message credit ${message.id}:`, error);
      }
    }
  }
  return {
    ...snapshot, apply, candidates: planned.length,
    recipientCount: new Set(planned.map(x => x.userId)).size,
    plannedPoints: planned.reduce((sum, x) => sum + x.amount, 0),
    credited, points, failed,
  };
}
