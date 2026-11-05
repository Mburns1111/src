import mongoose from "mongoose";
import CardAchievement from "../models/CardAchievement.js";
import CardCollector from "../models/CardCollector.js";
import {
  AchievementControl, AchievementEvent, CardAcquisition,
  AchievementDiscovery, AchievementReleaseFirst,
} from "../models/CardAchievementState.js";
import {rewardFor} from "./card-achievement-catalog.js";
import {isSharedCardGameCreator} from "./card-owner-access.js";

function assertCreator(userId) {
  if (!isSharedCardGameCreator(userId))
    throw new Error("Only the configured live Hatchem creator can convert achievements to shared badges.");
}

// Preview is read-only. Do not expose undiscovered secret titles or IDs.
export async function previewCreatorSharing(userId) {
  assertCreator(userId);
  const badges=await CardAchievement.find({discordUserId:userId}).lean();
  const firsts=await AchievementReleaseFirst.find({userId}).lean();
  const ranked=badges.filter(a=>Number.isInteger(a.discoveryNumber)&&a.discoveryNumber>0);
  let playerRanks=0,firstRewards=0;
  for (const award of ranked) {
    const players=await CardAchievement.find({
      key:award.key,discordUserId:{$ne:userId},discoveryNumber:{$type:"number"},
    }).select("_id").lean();
    playerRanks+=players.length;
  }
  for (const first of firsts) {
    const candidate=await CardAchievement.findOne({
      key:first.key,releaseId:first.releaseId,discordUserId:{$ne:userId},
      rewardGrantedAt:{$type:"date"},
    }).select("_id").lean();
    if(candidate)firstRewards++;
  }
  return {
    badges:badges.length,ranked:ranked.length,playerRanks,
    releaseFirsts:firsts.length,firstRewards,
    events:await AchievementEvent.countDocuments({userId}),
    acquisitions:await CardAcquisition.countDocuments({userId}),
  };
}

/**
 * An explicit, idempotent, creator-only migration. No achievements, progress,
 * card copies, bonuses or Points are deleted. The clock serializes this
 * conversion with achievement awards, grants and release-first allocation.
 * Members retain earned badges and their relative ordering, with contiguous
 * discovery numbers that no longer count the creator.
 */
export async function convertCreatorAchievementsToShared(userId) {
  assertCreator(userId);
  const session=await mongoose.startSession();
  try {
    return await session.withTransaction(async()=>{
      const guard=await AchievementControl.updateOne(
        {_id:"clock"},{$inc:{sequence:1}},{session});
      if(!guard.matchedCount)
        throw new Error("Achievement clock is not initialized. Conversion was not attempted.");

      const badges=await CardAchievement.find({discordUserId:userId}).session(session).lean();
      const ranked=badges.filter(a=>Number.isInteger(a.discoveryNumber)&&a.discoveryNumber>0);
      const firsts=await AchievementReleaseFirst.find({userId}).session(session).lean();
      // Unset the creator's competitive places FIRST to free the unique index.
      await CardAchievement.updateMany({discordUserId:userId},{
        $set:{creatorShared:true,releaseFirst:false},
        $unset:{discoveryNumber:""},
      },{session});
      // Historical reward entitlements and wallet balances remain untouched.
      // Don't send belated rank announcements after the conversion.
      await CardAchievement.updateMany({
        discordUserId:userId,noticeAttemptedAt:null,rewardGrantedAt:{$ne:null},
      },{$set:{noticeAttemptedAt:new Date()}},{session});

      let playerRanksAdjusted=0;
      for (const key of [...new Set(ranked.map(a=>a.key))]) {
        const players=await CardAchievement.find({
          key,discordUserId:{$ne:userId},discoveryNumber:{$type:"number"},
        }).sort({discoveryNumber:1,_id:1}).session(session).lean();
        // Assign from lowest to highest: each newly opened index slot is free.
        // Never change an earned badge's user, date or reward.
        for (let i=0;i<players.length;i++) {
          const newRank=i+1;
          if(players[i].discoveryNumber!==newRank) {
            const result=await CardAchievement.updateOne({
              _id:players[i]._id,discoveryNumber:players[i].discoveryNumber,
            },{$set:{discoveryNumber:newRank}},{session});
            if(!result.matchedCount)throw new Error("A player rank changed during creator conversion.");
            playerRanksAdjusted++;
          }
        }
        if(players.length)
          await AchievementDiscovery.updateOne({_id:key},{$set:{value:players.length}},{session,upsert:true});
        else
          await AchievementDiscovery.deleteOne({_id:key},{session});
      }

      let firstRewardsTransferred=0,firstSlotsOpened=0;
      for (const first of firsts) {
        await AchievementReleaseFirst.deleteOne({_id:first._id,userId},{session});
        const earliest=await CardAchievement.findOne({
          key:first.key,releaseId:first.releaseId,
          discordUserId:{$ne:userId},rewardGrantedAt:{$type:"date"},
        }).sort({unlockedAt:1,_id:1}).session(session).lean();
        if(!earliest){firstSlotsOpened++;continue;}
        // Only the incremental first-in-release grab is newly awarded.
        const reward=rewardFor(earliest.tier,true);
        const baseline=rewardFor(earliest.tier,false);
        const extraGrabs=reward.grabs-baseline.grabs;
        if(extraGrabs<=0)throw new Error("A creator-held first slot has an invalid recipient tier.");
        const result=await CardAchievement.updateOne({
          _id:earliest._id,releaseFirst:{$ne:true},
        },{$set:{releaseFirst:true},$inc:{rewardGrabs:extraGrabs}},{session});
        if(!result.matchedCount)throw new Error("Release-first recipient changed during conversion.");
        await CardCollector.updateOne({discordUserId:earliest.discordUserId},
          {$inc:{bonusGrabs:extraGrabs}},{session,upsert:true});
        await AchievementReleaseFirst.create([{
          _id:first._id,userId:earliest.discordUserId,
          key:first.key,releaseId:first.releaseId,
        }],{session});
        firstRewardsTransferred++;
      }
      return {
        badgesPreserved:badges.length,creatorRanksReleased:ranked.length,
        playerRanksAdjusted,firstRewardsTransferred,firstSlotsOpened,
        progressPreserved:true,previousCreatorRewardsPreserved:true,
      };
    });
  } finally {
    await session.endSession();
  }
}
