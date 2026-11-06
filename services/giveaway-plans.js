import { randomUUID } from "node:crypto";
import Giveaway from "../models/Giveaway.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import GiveawayWatchRule from "../models/GiveawayWatchRule.js";
import { completedActivityWeek, qualifyingActivity } from "./giveaway-activity-counter.js";
import { nextWeeklyAnnouncement } from "./giveaway-plan-time.js";
import { closeGiveaway, publishGiveawayResult } from "./giveaways.js";

export async function runGiveawayPlan(client,plan,{now=new Date()}={}) {
  if (plan.status!=="active" || new Date(plan.nextRunAt)>now) return "not-due";
  const runAt=new Date(plan.nextRunAt);
  const nameKey=plan.watchNameKey;
  const rule=nameKey==="general" ? null
    : await GiveawayWatchRule.findOne({guildId:plan.guildId,nameKey}).lean();
  if (nameKey!=="general" && !rule) throw Error(`Watched-channel rule ${nameKey} is missing. Restore it or update the plan.`);
  const qualification=rule
    ? {type:"channels",channelIds:[rule.channelId],minimum:rule.minimumMessages,days:rule.activeDays,minimumChars:rule.minimumChars}
    : {type:"general",channelIds:[],minimum:1,days:1,minimumChars:1};
  const week=completedActivityWeek(runAt);
  const entrants=await qualifyingActivity({guildId:plan.guildId,week,...qualification});
  const guild=await client.guilds.fetch(plan.guildId);
  const eligible=[];
  for(const id of [...new Set(entrants)]) {
    try {
      const member=await guild.members.fetch({user:id,force:true});
      if (member && !member.user?.bot) eligible.push(id);
    } catch(error) {
      if (error.code!==10007) throw error; // never discard a member on temporary Discord failures
    }
  }
  if(!eligible.length) return {result:"No qualifying members; no giveaway posted.",drawn:false,week};
  const prize=plan.prizes[plan.nextPrizeIndex];
  if (!prize) throw Error("No next prize configured.");
  let record=await Giveaway.findOne({scheduleId:plan._id,scheduleRunAt:runAt}).lean();
  if (!record) {
    try {
      record=await Giveaway.create({
        guildId:plan.guildId,channelId:plan.channelId,creatorId:plan.creatorId,
        title:plan.title,prize,winnerCount:plan.winnerCount,endsAt:runAt,
        mode:"activity",status:"closing",entrantIds:eligible,activityVerifiedIds:eligible,
        activityType:qualification.type,activityChannelIds:qualification.channelIds,
        activityMinimum:qualification.minimum,activityDays:qualification.days,
        activityMinChars:qualification.minimumChars,activityStartAt:new Date(week+"T12:00:00Z"),
        activityCheckedAt:now,claimWindowHours:plan.claimWindowHours,autoRerollClaims:true,
        scheduleId:plan._id,scheduleRunAt:runAt,
      });
      record=record.toObject();
    } catch(error) {
      if(error.code!==11000) throw error;
      record=await Giveaway.findOne({scheduleId:plan._id,scheduleRunAt:runAt}).lean();
      if(!record) throw error;
    }
  }
  if(record.status!=="ended")
    record=await closeGiveaway({id:record._id,guildId:plan.guildId,now,client});
  if(record.status!=="ended") throw Error("Scheduled giveaway draw is not ready.");
  try { await publishGiveawayResult(client,record); }
  catch(error) { console.error("[Giveaways] Scheduled drawing saved but Discord post failed:",String(record._id),error); }
  return {result:`Drawn: ${eligible.length} eligible entrants; giveaway ${record._id}.`,drawn:true,week};
}

export async function reconcileGiveawayPlans(client,{now=new Date(),limit=10}={}) {
 const due=await GiveawayPlan.find({status:"active",nextRunAt:{$lte:now},
   $or:[{leaseUntil:null},{leaseUntil:{$lte:now}}]}).sort({nextRunAt:1}).limit(limit).lean();
 for(const plan of due) {
  const leaseKey=randomUUID();
  const owned=await GiveawayPlan.findOneAndUpdate(
    {_id:plan._id,status:"active",nextRunAt:plan.nextRunAt,
      $or:[{leaseUntil:null},{leaseUntil:{$lte:now}}]},
    {$set:{leaseKey,leaseUntil:new Date(now.getTime()+10*60_000)}},
    {returnDocument:"after"}).lean();
  if(!owned)continue;
  try {
    const outcome=await runGiveawayPlan(client,owned,{now});
    if (outcome==="not-due") continue;
    const nextIndex=owned.nextPrizeIndex+(outcome.drawn?1:0);
    const finishedPrizes=nextIndex >= owned.prizes.length;
    const nextPrizeIndex=finishedPrizes && owned.repeatPrizes ? 0 : nextIndex;
    const status=!owned.recurring ? "completed" :
      (finishedPrizes && !owned.repeatPrizes ? "paused" : "active");
    await GiveawayPlan.updateOne({_id:owned._id,leaseKey},{$set:{
      status, nextRunAt:owned.recurring ? nextWeeklyAnnouncement(owned.nextRunAt) : owned.nextRunAt,
      nextPrizeIndex,lastRunAt:now,lastResult:outcome.result,leaseUntil:null,leaseKey:"",
    }});
  }catch(error) {
    // Expired leases are retried; a unique schedule/run constraint prevents a second draw.
    console.error("[Giveaways] Scheduled plan failed:",owned.name,error);
  }
 }
 return due.length;
}
