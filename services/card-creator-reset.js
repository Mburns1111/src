import mongoose from "mongoose";
import CardAchievement from "../models/CardAchievement.js";
import CardCollector from "../models/CardCollector.js";
import PointsLedger from "../models/PointsLedger.js";
import {
  AchievementControl, AchievementEvent, CardAcquisition,
  AchievementDiscovery, AchievementReleaseFirst,
} from "../models/CardAchievementState.js";
import {isUnrankedCardGameCreator} from "./card-owner-access.js";

function assertCreator(userId) {
  if (!isUnrankedCardGameCreator(userId))
    throw new Error("Only the configured live Hatchem creator can reset creator achievements.");
}

// Protect ALL purchased extras when forfeiting outstanding achievement rewards.
// A single pooled balance cannot distinguish which grant was spent first; this
// conservative calculation may leave some unidentifiable achievement extras
// rather than taking any Points-funded extra away from the owner.
export function safeCreatorRewardForfeiture({awards, wallet, purchases}) {
  const earned = {
    grab: awards.reduce((n,a)=>n+(a.rewardGrantedAt?Math.max(0,Number(a.rewardGrabs)||0):0),0),
    drop: awards.reduce((n,a)=>n+(a.rewardGrantedAt?Math.max(0,Number(a.rewardDrops)||0):0),0),
  };
  const purchased={grab:0,drop:0};
  for (const row of purchases) {
    const kind=row.sourceId;
    const cost=kind==="grab"?10:kind==="drop"?20:0;
    if (!cost || !Number.isSafeInteger(row.amount) || row.amount>=0 ||
        !Number.isSafeInteger(-row.amount/cost)) {
      // Do not forfeit anything when the purchase history cannot be trusted.
      return {earned,forfeit:{grab:0,drop:0},purchased,historyComplete:false};
    }
    purchased[kind]+=-row.amount/cost;
  }
  const balance={grab:Math.max(0,Number(wallet?.bonusGrabs)||0),
    drop:Math.max(0,Number(wallet?.bonusDrops)||0)};
  return {earned,purchased,historyComplete:true,forfeit:{
    grab:Math.min(earned.grab,Math.max(0,balance.grab-purchased.grab)),
    drop:Math.min(earned.drop,Math.max(0,balance.drop-purchased.drop)),
  }};
}

export async function previewCreatorAchievementReset(userId) {
  assertCreator(userId);
  const [awards,events,acquisitions,firsts,wallet,purchases]=await Promise.all([
    CardAchievement.find({discordUserId:userId}).lean(),
    AchievementEvent.countDocuments({userId}),
    CardAcquisition.countDocuments({userId}),
    AchievementReleaseFirst.countDocuments({userId}),
    CardCollector.findOne({discordUserId:userId}).select("bonusGrabs bonusDrops").lean(),
    PointsLedger.find({discordUserId:userId,kind:"spend",sourceType:"card_extras"})
      .select("sourceId amount").lean(),
  ]);
  const rewards=safeCreatorRewardForfeiture({awards,wallet,purchases});
  return {badges:awards.length,events,acquisitions,firsts,rewards,
    wallet:{grabs:wallet?.bonusGrabs||0,drops:wallet?.bonusDrops||0}};
}

/**
 * One-time, idempotent creator-only purge.
 * Serializes against achievement grants AND bonus consumption via the shared
 * achievement clock document. Never changes card copies, tags, ownership,
 * regular Points, other collectors' achievements or the active egg release.
 */
export async function resetCreatorAchievements(userId) {
  assertCreator(userId);
  const session=await mongoose.startSession();
  try {
    return await session.withTransaction(async()=>{
      const guard=await AchievementControl.updateOne({_id:"clock"},{$inc:{sequence:1}},{session});
      if (!guard.matchedCount)
        throw new Error("Achievement clock is not initialized. Reset was not attempted.");

      const awards=await CardAchievement.find({discordUserId:userId}).session(session).lean();
      const wallet=await CardCollector.findOne({discordUserId:userId})
        .select("bonusGrabs bonusDrops").session(session).lean();
      const purchases=await PointsLedger.find({
        discordUserId:userId,kind:"spend",sourceType:"card_extras",
      }).select("sourceId amount").session(session).lean();
      const rewards=safeCreatorRewardForfeiture({awards,wallet,purchases});
      const keys=[...new Set(awards.filter(a=>Number.isInteger(a.discoveryNumber)&&a.discoveryNumber>0)
        .map(a=>a.key))];

      const deleted=await CardAchievement.deleteMany({discordUserId:userId},{session});
      const events=await AchievementEvent.deleteMany({userId},{session});
      const acquisitions=await CardAcquisition.deleteMany({userId},{session});
      const firsts=await AchievementReleaseFirst.deleteMany({userId},{session});

      // Existing players keep their exact rank numbers. For each affected key,
      // the next rank follows the highest remaining rank. If ONLY the creator
      // earned it, discovery #1 is available to a player again.
      for (const key of keys) {
        const remaining=await CardAchievement.findOne({
          key,discoveryNumber:{$type:"number"},
        }).sort({discoveryNumber:-1}).select("discoveryNumber").session(session).lean();
        if (remaining?.discoveryNumber) {
          await AchievementDiscovery.updateOne({_id:key},{$set:{value:remaining.discoveryNumber}},
            {session,upsert:true});
        } else {
          await AchievementDiscovery.deleteOne({_id:key},{session});
        }
      }

      const forfeit=rewards.forfeit;
      if (forfeit.grab||forfeit.drop) {
        const changed=await CardCollector.updateOne({
          discordUserId:userId,
          bonusGrabs:{$gte:forfeit.grab},bonusDrops:{$gte:forfeit.drop},
        },{$inc:{bonusGrabs:-forfeit.grab,bonusDrops:-forfeit.drop}},{session});
        if (!changed.matchedCount)
          throw new Error("Creator bonus balance changed during reset. No changes were saved.");
      }
      return {badges:deleted.deletedCount,events:events.deletedCount,
        acquisitions:acquisitions.deletedCount,firsts:firsts.deletedCount,
        rewardGrabsForfeited:forfeit.grab,rewardDropsForfeited:forfeit.drop,
        purchasedExtrasProtected:true,historyComplete:rewards.historyComplete};
    });
  } finally {
    await session.endSession();
  }
}
