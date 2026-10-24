import mongoose from "mongoose";
import ParticipationSource from "../models/ParticipationSource.js";
import NativePollParticipation from "../models/NativePollParticipation.js";
import PointsLedger from "../models/PointsLedger.js";
import PointsWallet from "../models/PointsWallet.js";
import PointsWeeklyCounter from "../models/PointsWeeklyCounter.js";
import PointsActivityCounter from "../models/PointsActivityCounter.js";
import { activityPeriod, pollWeekStartUtc } from "./activity-period.js";
export { pollWeekStartUtc } from "./activity-period.js";

export const POLL_POINTS_PER_POLL = 5;
export const POLL_WEEKLY_CAP = 15;

export function pollEventKey(messageId) {
  return `native-poll:${messageId}`;
}

export async function awardNativePollVote({ guildId, channelId, messageId, userId,
  guild = null, now = new Date(), models = {}, sessionFactory = () => mongoose.startSession() }) {
  const {
    sources = ParticipationSource, participants = NativePollParticipation,
    ledger = PointsLedger, wallets = PointsWallet, counters = PointsWeeklyCounter,
    activityCounters = PointsActivityCounter,
  } = models;
  const no = reason => ({ credited: false, amount: 0, reason });

  // A server manager must have explicitly approved this exact native poll.
  // Arclo messages are never eligible.
  const source = await sources.findOne({
    guildId, channelId, messageId, source: "discord-native-poll",
    rewardEnabled: true,
  }).lean();
  if (!source) return no("not_approved");

  const active = await participants.findOne({
    guildId, messageId, discordUserId: userId, "answerIds.0": { $exists: true },
  }).lean();
  if (!active) return no("no_active_vote");

  // Verify current guild membership and bot status, never credit an external
  // account or bot from a stale or malicious event. A GuildMembers privileged
  // gateway subscription is not required to REST-fetch one known member.
  let member;
  if (guild) {
    member = await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user?.bot) return no("not_a_member");
  }
  const activity = activityPeriod(member?.joinedAt, now);
  const activitySelector = { guildId, discordUserId: userId, periodKey: activity.key };
  const selector = { guildId, discordUserId: userId, eventKey: pollEventKey(messageId) };
  const period = { guildId, discordUserId: userId, weekStartUtc: pollWeekStartUtc(now) };

  // Creating the empty counter outside a transaction avoids racing upserts
  // of the same week for votes in unrelated polls.
  await counters.updateOne(period, { $setOnInsert: { ...period, pollPoints: 0 } },
    { upsert: true });
  await activityCounters.updateOne(activitySelector,
    { $setOnInsert: { ...activitySelector, earned: 0 } }, { upsert: true });

  const session = await sessionFactory();
  let result = no("already_awarded");
  try {
    await session.withTransaction(async () => {
      if (await ledger.exists(selector).session(session)) {
        result = no("already_awarded");
        return;
      }
      const activityCounter = await activityCounters.findOneAndUpdate({
        ...activitySelector, earned: { $lte: activity.cap - POLL_POINTS_PER_POLL },
      }, { $inc: { earned: POLL_POINTS_PER_POLL } },
      { session, returnDocument: "after" });
      if (!activityCounter) {
        result = no("activity_cap");
        return;
      }
      const counter = await counters.findOneAndUpdate({
        ...period, pollPoints: { $lte: POLL_WEEKLY_CAP - POLL_POINTS_PER_POLL },
      }, { $inc: { pollPoints: POLL_POINTS_PER_POLL } },
      { session, returnDocument: "after" });
      if (!counter) {
        // Do not commit the activity counter update when the independent
        // 15-Point poll cap is already full.
        const error = new Error("Poll weekly reward cap reached");
        error.code = "POLL_WEEKLY_LIMIT";
        throw error;
      }
      await ledger.create([{
        ...selector, kind: "poll", amount: POLL_POINTS_PER_POLL,
        description: "Approved Discord poll participation",
        sourceId: messageId,
      }], { session });
      await wallets.findOneAndUpdate({ guildId, discordUserId: userId },
        { $inc: { balance: POLL_POINTS_PER_POLL } },
        { session, upsert: true, setDefaultsOnInsert: true, returnDocument: "after" });
      result = { credited: true, amount: POLL_POINTS_PER_POLL, reason: "credited" };
    });
  } catch (error) {
    if (error?.code === "POLL_WEEKLY_LIMIT") return no("weekly_limit");
    // The ledger unique index also guards re-votes across restarts. In a
    // competing transaction, the losing attempt cannot spend the weekly cap.
    if (Number(error?.code) === 11000 && await ledger.exists(selector)) {
      return no("already_awarded");
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return result;
}

export async function awardObservedPollVoters({ guildId, messageId, channelId, guild,
  limit = 200 }) {
  const source = await ParticipationSource.exists({
    guildId, messageId, channelId, source: "discord-native-poll", rewardEnabled: true,
  });
  if (!source) return { credited: 0, points: 0, skipped: 0, approved: false };
  const voters = await NativePollParticipation.find({
    guildId, messageId, "answerIds.0": { $exists: true },
  }).select("discordUserId").limit(limit + 1).lean();
  if (voters.length > limit) {
    // Do not pay only the first N participants: this could favor IDs/order.
    throw new Error("Too many poll participants for a single reward synchronization.");
  }
  const result = { credited: 0, points: 0, skipped: 0, approved: true };
  for (const voter of voters) {
    const award = await awardNativePollVote({
      guildId, channelId, messageId, userId: voter.discordUserId, guild,
    });
    if (award.credited) {
      result.credited++;
      result.points += award.amount;
    } else {
      result.skipped++;
    }
  }
  return result;
}
