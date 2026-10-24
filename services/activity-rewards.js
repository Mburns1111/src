import { createHash } from "node:crypto";
import mongoose from "mongoose";
import PointsSettings from "../models/PointsSettings.js";
import PointsActivityCounter from "../models/PointsActivityCounter.js";
import PointsActivityMessageState from "../models/PointsActivityMessageState.js";
import PointsVoiceProgress from "../models/PointsVoiceProgress.js";
import PointsLedger from "../models/PointsLedger.js";
import PointsWallet from "../models/PointsWallet.js";
import { activityPeriod, FIRST_WEEK_MS } from "./activity-period.js";
export { activityPeriod, FIRST_WEEK_MS } from "./activity-period.js";

export const MESSAGE_BASE_POINTS = 2;
export const MESSAGE_COOLDOWN_MS = 30 * 60_000;
export const MESSAGE_MIN_LETTERS = 8;
export const MESSAGE_MIN_LENGTH = 15;
export const VOICE_BASE_POINTS = 5;
export const VOICE_INTERVAL_MINUTES = 10;
export function qualifyingMessageText(content) {
  if (typeof content !== "string") return null;
  // Never store content; discard URLs, mentions and Discord formatting before
  // testing for substantial human writing.
  const normalized = content
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/<[@#&]!?(?:\d{17,21})>/g, " ")
    .replace(/<a?:[^:>]+:\d{17,21}>/g, " ")
    .replace(/[\u200b-\u200f\u2060]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized.length < MESSAGE_MIN_LENGTH ||
      (normalized.match(/\p{L}/gu)?.length ?? 0) < MESSAGE_MIN_LETTERS ||
      /^[/!.$]/.test(normalized)) return null;
  return createHash("sha256").update(normalized).digest("hex");
}

export function eligibleVoiceStates(guild) {
  const byChannel = new Map();
  const afk = guild?.afkChannelId;
  for (const state of guild?.voiceStates?.cache?.values?.() ?? []) {
    if (!state.channelId || state.channelId === afk || state.deaf === true ||
        state.selfDeaf === true || state.serverDeaf === true || state.suppress === true) continue;
    const member = state.member ?? guild.members.cache.get(state.id);
    if (!member || member.user?.bot) continue;
    if (!byChannel.has(state.channelId)) byChannel.set(state.channelId, []);
    byChannel.get(state.channelId).push(member);
  }
  return [...byChannel.values()].filter(group => group.length >= 2).flat();
}

export async function awardRepeatableActivity({
  guildId, userId, joinedAt, now = new Date(), type, eventKey,
  channelId = "", messageHash = "", models = {}, sessionFactory = () => mongoose.startSession(),
}) {
  const { settings = PointsSettings, counters = PointsActivityCounter,
    messageStates = PointsActivityMessageState, ledgers = PointsLedger,
    wallets = PointsWallet } = models;
  if (type !== "message" && type !== "voice") throw new Error("Unsupported activity source");
  const no = reason => ({ credited: false, amount: 0, reason });
  const setting = await settings.findOne({ guildId }).lean();
  if (setting?.[type === "message" ? "messageRewardsEnabled" : "voiceRewardsEnabled"] !== true) {
    return no("disabled");
  }
  const period = activityPeriod(joinedAt, now);
  const amount = (type === "message" ? MESSAGE_BASE_POINTS : VOICE_BASE_POINTS) * period.multiplier;
  const key = { guildId, discordUserId: userId, periodKey: period.key };
  const selector = { guildId, discordUserId: userId, eventKey };
  await counters.updateOne(key, { $setOnInsert: { ...key, earned: 0 } }, { upsert: true });
  if (type === "message") {
    await messageStates.updateOne({ guildId, discordUserId: userId }, {
      $setOnInsert: { guildId, discordUserId: userId,
        lastRewardAt: new Date(0), lastHash: "" },
    }, { upsert: true });
  }

  const session = await sessionFactory();
  let result = no("already_awarded");
  try {
    await session.withTransaction(async () => {
      if (await ledgers.exists(selector).session(session)) {
        result = no("already_awarded");
        return;
      }
      if (type === "message") {
        const cooldown = new Date(now.getTime() - MESSAGE_COOLDOWN_MS);
        const ok = await messageStates.findOneAndUpdate({
          guildId, discordUserId: userId,
          lastRewardAt: { $lte: cooldown }, lastHash: { $ne: messageHash },
        }, { $set: { lastRewardAt: now, lastHash: messageHash } },
        { session, returnDocument: "after" });
        if (!ok) { result = no("cooldown_or_duplicate"); return; }
      }
      // This is an accounting total, NOT an earning limit. Members can
      // continue earning for every qualifying activity without a weekly cap.
      await counters.findOneAndUpdate(
        key, { $inc: { earned: amount } },
        { session, returnDocument: "after" });
      await ledgers.create([{ ...selector, kind: type, amount,
        description: type === "message" ? "Qualified Discord message" : "Qualified voice participation",
        sourceId: channelId,
      }], { session });
      await wallets.findOneAndUpdate({ guildId, discordUserId: userId },
        { $inc: { balance: amount } },
        { session, upsert: true, setDefaultsOnInsert: true, returnDocument: "after" });
      result = { credited: true, amount, reason: "credited", period };
    });
  } catch (error) {
    if (Number(error?.code) === 11000 && await ledgers.exists(selector)) {
      return no("already_awarded");
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return result;
}

export async function awardMessageActivity(message, deps = {}) {
  if (!message?.guildId || !message?.id || !message?.author?.id ||
      message.author.bot || message.webhookId || message.system) {
    return { credited: false, amount: 0, reason: "not_eligible" };
  }
  const hash = qualifyingMessageText(message.content);
  if (!hash) return { credited: false, amount: 0, reason: "message_not_qualified" };
  let member = message.member;
  if (!member?.joinedAt) {
    member = await message.guild?.members?.fetch(message.author.id).catch(() => null);
  }
  if (!member || member.user?.bot) return { credited: false, amount: 0, reason: "not_a_member" };
  return awardRepeatableActivity({
    guildId: message.guildId, userId: message.author.id, joinedAt: member.joinedAt,
    now: message.createdAt ?? new Date(), type: "message", eventKey: `activity-message:${message.id}`,
    messageHash: hash, channelId: message.channelId, ...deps,
  });
}

export async function recordVoiceMinute({
  guildId, member, now = new Date(), models = {}, award = awardRepeatableActivity,
}) {
  const progress = models.progress ?? PointsVoiceProgress;
  if (!member || member.user?.bot || !member.id) return { credited: false, reason: "not_a_member" };
  const period = activityPeriod(member.joinedAt, now);
  const periodKey = { guildId, discordUserId: member.id, periodKey: period.key };
  const minuteStamp = Math.floor(now.getTime() / 60_000);
  // Persist the last tick so a restart cannot award the same minute twice.
  await progress.updateOne(periodKey, { $setOnInsert: { ...periodKey,
    lastMinuteStamp: 0, eligibleMinutes: 0, lastSettledBlock: 0 } }, { upsert: true });
  const updated = await progress.findOneAndUpdate({
    ...periodKey, lastMinuteStamp: { $lt: minuteStamp },
  }, { $inc: { eligibleMinutes: 1 }, $set: { lastMinuteStamp: minuteStamp } },
  { returnDocument: "after" });
  if (!updated) return { credited: false, reason: "already_counted_minute" };
  const blocks = Math.floor(updated.eligibleMinutes / VOICE_INTERVAL_MINUTES);
  if (blocks <= (updated.lastSettledBlock ?? 0)) {
    return { credited: false, reason: "building_voice_time", minutes: updated.eligibleMinutes };
  }
  const nextBlock = (updated.lastSettledBlock ?? 0) + 1;
  const reward = await award({
    guildId, userId: member.id, joinedAt: member.joinedAt, now, type: "voice",
    eventKey: `activity-voice:${period.key}:${nextBlock}`,
  });
  // If awarding failed with an exception, preserve the pending block for the
  // following minute's retry. Skipped cap/disabled blocks don't accumulate.
  await progress.updateOne(periodKey, { $max: { lastSettledBlock: nextBlock } });
  return { ...reward, minutes: updated.eligibleMinutes, block: nextBlock };
}
