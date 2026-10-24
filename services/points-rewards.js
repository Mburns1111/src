import mongoose from "mongoose";
import PointsLedger from "../models/PointsLedger.js";
import PointsWallet from "../models/PointsWallet.js";
import PointsSettings from "../models/PointsSettings.js";
import { POINTS_MILESTONES, milestoneAwardAmount } from "./points-policy.js";

// No change to the existing shop wallet: every grant credits PointsWallet and
// writes an immutable receipt in ONE MongoDB transaction.
export async function grantPoints({ guildId, userId, eventKey, kind, amount,
  description, sourceId = "", actorId = "", sourceType = "",
  relatedEventKey = "" }) {
  if (!guildId || !userId || typeof eventKey !== "string" ||
      !eventKey || eventKey.length > 200 ||
      !Number.isSafeInteger(amount) || amount <= 0 || amount > 5000) {
    throw new Error("Invalid Points credit");
  }
  const selector = { guildId, discordUserId: userId, eventKey };
  const session = await mongoose.startSession();
  let credited = false;
  try {
    await session.withTransaction(async () => {
      if (await PointsLedger.exists(selector).session(session)) return;
      await PointsLedger.create([{
        ...selector, kind, amount, description, sourceId, actorId,
        sourceType, relatedEventKey,
      }], { session });
      await PointsWallet.findOneAndUpdate(
        { guildId, discordUserId: userId },
        { $inc: { balance: amount } },
        { upsert: true, session, setDefaultsOnInsert: true, returnDocument: "after" },
      );
      credited = true;
    });
  } catch (error) {
    // The unique ledger index protects against simultaneous duplicate events.
    if (Number(error?.code) === 11000 && await PointsLedger.exists(selector)) {
      credited = false;
    } else {
      throw error;
    }
  } finally {
    await session.endSession();
  }
  return { credited, amount: credited ? amount : 0 };
}

export async function awardMilestone(guildId, userId, milestone, { sourceId = "" } = {}) {
  const definition = POINTS_MILESTONES[milestone];
  if (!definition) throw new Error(`Unknown Points milestone: ${milestone}`);
  const settings = await PointsSettings.findOne({ guildId }).lean();
  if (settings?.milestonesEnabled === false) return { credited: false, amount: 0, disabled: true };
  const amount = milestoneAwardAmount(settings, milestone);
  if (!amount) return { credited: false, amount: 0, disabled: true };
  return grantPoints({
    guildId, userId, eventKey: `milestone:${milestone}`,
    kind: "milestone", amount,
    description: definition.label, sourceId,
  });
}

// Failed rewards never invalidate an already published post, successful shop
// action or saved profile. Staff can inspect and backfill missing achievements.
export async function awardMilestoneSafely(guildId, userId, milestone, sourceId = "") {
  try {
    return await awardMilestone(guildId, userId, milestone, { sourceId });
  } catch (error) {
    console.error(`[Points] Unable to award ${milestone} for user ${userId}:`, error);
    return { credited: false, amount: 0, error: true };
  }
}


// Future features may issue a refund for a completed, verified transaction.
// Use an explicit unique refund event key per decision and retain the original
// spending record instead of deleting or altering history. There is deliberately
// no automatic refund-on-button API.
export async function refundPoints({ guildId, userId, eventKey, amount,
  description, originalEventKey, sourceType = "shop", sourceId = "",
  actorId = "" }) {
  if (typeof originalEventKey !== "string" || !originalEventKey) {
    throw new Error("Refunds require the original spending event reference.");
  }
  return grantPoints({
    guildId, userId, eventKey, kind: "refund", amount, description,
    sourceType, sourceId, actorId, relatedEventKey: originalEventKey,
  });
}
