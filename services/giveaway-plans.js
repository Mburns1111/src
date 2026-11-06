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
  // If a restart interrupted the plan after saving its drawing, reuse that
  // drawing before any fresh activity scan. Never lose or redraw its winners.
  const existing=await Giveaway.findOne({scheduleId:plan._id,scheduleRunAt:runAt}).lean();
  if(existing){
    const restored=existing.status==="ended" ? existing
      : await closeGiveaway({id:existing._id,guildId:plan.guildId,now,client});
    if(restored?.status!=="ended") throw Error("Prior drawing could not yet be recovered.");
    try { await publishGiveawayResult(client,restored); }
    catch(error) { console.error("[Giveaways] Recovered drawing is waiting for Discord publish:",error); }
    return {result:`Recovered saved drawing ${restored._id}`,drawn:true,week:completedActivityWeek(runAt)};
  }
  if(now.getTime()-runAt.getTime()>=7*24*60*60_000)
    return {result:"Skipped an outdated drawing after extended bot downtime; no prize consumed.",
      drawn:false,week:completedActivityWeek(runAt)};
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

export function nextGiveawayPlanCycle(plan,outcome,now=new Date()) {
 const nextIndex=plan.nextPrizeIndex+(outcome.drawn?1:0);
 const finishedPrizes=nextIndex>=plan.prizes.length;
 return {
   status:!plan.recurring ? "completed" : (finishedPrizes && !plan.repeatPrizes ? "paused" : "active"),
   nextRunAt:plan.recurring ? nextWeeklyAnnouncement(plan.nextRunAt) : plan.nextRunAt,
   nextPrizeIndex:finishedPrizes && plan.repeatPrizes ? 0 : nextIndex,
   lastRunAt:now,lastResult:outcome.result,
 };
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
    await GiveawayPlan.updateOne({_id:owned._id,leaseKey},{$set:{
      ...nextGiveawayPlanCycle(owned,outcome,now),leaseUntil:null,leaseKey:"",
    }});
  }catch(error) {
    // Expired leases are retried; a unique schedule/run constraint prevents a second draw.
    console.error("[Giveaways] Scheduled plan failed:",owned.name,error);
  }
 }
 return due.length;
}
