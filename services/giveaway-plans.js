import { randomUUID } from "node:crypto";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import {sharedGiveawayPingRoleId} from "./giveaway-notification-roles.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import GiveawayWatchRule from "../models/GiveawayWatchRule.js";
import { completedActivityWeek, previousActivityDay, qualifyingActivity, qualifyingWatchActivity,countActivityParticipants } from "./giveaway-activity-counter.js";
import { easternMidnight, shiftCalendarDay, nextPlanAnnouncement } from "./giveaway-plan-time.js";
import { closeGiveaway, publishGiveawayResult } from "./giveaways.js";
import {publishGiveawayReview} from "./giveaway-review.js";
import {normalizeRoleBonuses} from "./giveaway-role-weights.js";
import {activeActivityParticipants} from "./activity-participation.js";
import {configuredGiveawayBanRole,memberPassesGiveawayBan} from "./giveaway-exclusion.js";

export function planRepeatMode(plan) {
  return plan.repeatMode || (plan.recurring ? "weekly" : "once");
}
export function planActivityWindow(plan,runAt) {
  const period=plan.activityPeriod || "weekly";
  if(!["daily","weekly"].includes(period)) throw Error("Invalid activity window.");
  if(plan.customActivityStartAt&&plan.customActivityEndAt){
    const startAt=new Date(plan.customActivityStartAt),endAt=new Date(plan.customActivityEndAt);
    if(startAt>=endAt||endAt>new Date(runAt))throw Error("Custom activity range must end before drawing.");
    return {period,key:`custom:${startAt.toISOString()}-${endAt.toISOString()}`,startAt,endAt,custom:true};
  }
  const key=period==="daily" ? previousActivityDay(runAt) : completedActivityWeek(runAt);
  return {period,key,startAt:easternMidnight(key),
    endAt:easternMidnight(shiftCalendarDay(key,period==="daily"?1:7))};
}
export async function runGiveawayPlan(client,plan,{now=new Date()}={}) {
  if (plan.status!=="active" || new Date(plan.nextRunAt)>now) return "not-due";
  const runAt=new Date(plan.nextRunAt);
  const activityWindow=planActivityWindow(plan,runAt);
  // If a restart interrupted the plan after saving its drawing, reuse that
  // drawing before any fresh activity scan. Never lose or redraw its winners.
  const existing=await Giveaway.findOne({scheduleId:plan._id,scheduleRunAt:runAt}).lean();
  if(existing){
    if(existing.status==="pending_review"){
      await publishGiveawayReview(client,existing);
      return {result:"Awaiting staff review",pending:true,drawn:false,
        activityPeriod:activityWindow.period,activityKey:activityWindow.key};
    }
    if(existing.status==="cancelled")
      return {result:"Staff declined the drawing; prize retained.",drawn:false,
        activityPeriod:activityWindow.period,activityKey:activityWindow.key};
    const restored=existing.status==="ended" ? existing
      : await closeGiveaway({id:existing._id,guildId:plan.guildId,now,client});
    if(restored?.status!=="ended") throw Error("Prior drawing could not yet be recovered.");
    try { await publishGiveawayResult(client,restored); }
    catch(error) { console.error("[Giveaways] Recovered drawing is waiting for Discord publish:",error); }
    return {result:`Recovered saved drawing ${restored._id}`,drawn:(restored.winnerIds||[]).length>0,
      activityPeriod:activityWindow.period,activityKey:activityWindow.key};
  }
  const staleAfter=activityWindow.period==="daily"?24*60*60_000:7*24*60*60_000;
  if(now.getTime()-runAt.getTime()>=staleAfter)
    return {result:"Skipped an outdated drawing after extended bot downtime; no prize consumed.",
      drawn:false,activityPeriod:activityWindow.period,activityKey:activityWindow.key};
  // Editing a plan's time or running at a custom interval must never award the same
  // named watched channel's prior day (or Wednesday-to-Wednesday week) twice.
  const priorPeriod=await Giveaway.findOne({
    scheduleId:plan._id,activityPeriodKey:activityWindow.key,
  }).lean();
  if(priorPeriod) return {result:"That activity period has already been drawn for this plan; no prize consumed.",
    drawn:false,activityPeriod:activityWindow.period,activityKey:activityWindow.key};
  const nameKey=plan.watchNameKey;
  const rule=nameKey==="general" ? null
    : await GiveawayWatchRule.findOne({guildId:plan.guildId,nameKey}).lean();
  if (nameKey!=="general" && !rule) throw Error(`Watched-channel rule ${nameKey} is missing. Restore it or update the plan.`);
  const qualification=rule
    ? {type:"channels",channelIds:[rule.channelId],minimum:rule.minimumMessages,days:rule.activeDays,minimumChars:rule.minimumChars}
    : {type:"general",channelIds:[],minimum:1,days:1,minimumChars:1};
  const requirement={...qualification,days:activityWindow.period==="daily"?1:qualification.days};
  const minimumTotalMessages=plan.minimumTotalMessages??rule?.minimumTotalMessages??1;
  // Minute-count queries are restricted to each member's current opt-in window.
  const startAt=new Date(activityWindow.startAt);
  const endAt=activityWindow.endAt;
  const hasConsentWindow=startAt<endAt;
  const windowOptions={startAt,endAt};
  const entrants=!hasConsentWindow?[]:rule ? await qualifyingWatchActivity({
      guildId:plan.guildId,rule,period:activityWindow.period,key:activityWindow.key,
      minimum:requirement.minimum,
      days:activityWindow.custom?qualification.days:requirement.days,
      minimumChars:requirement.minimumChars,minimumTotalMessages,
      ...windowOptions,
    }) : await qualifyingActivity({guildId:plan.guildId,...requirement,minimumTotalMessages,
      ...windowOptions});
  const guild=await client.guilds.fetch(plan.guildId);
  const optedIn=await activeActivityParticipants(plan.guildId,entrants);
  const excludedRoleId=await configuredGiveawayBanRole(plan.guildId);
  const eligible=[];
  for(const id of [...new Set(entrants)].filter(id=>optedIn.has(String(id)))) {
    try {
      const member=await guild.members.fetch({user:id,force:true});
      if (member && !member.user?.bot && memberPassesGiveawayBan(member,excludedRoleId)) eligible.push(id);
    } catch(error) {
      if (error.code!==10007) throw error; // never discard a member on temporary Discord failures
    }
  }
  if(!eligible.length && !plan.announceEmptyResults && !plan.requireStaffReview)
    return {result:"No qualifying members — outcome recorded privately, prize retained.",
      drawn:false,activityPeriod:activityWindow.period,activityKey:activityWindow.key};
  const prize=plan.prizes[plan.nextPrizeIndex];
  if (!prize) throw Error("No next prize configured.");
  const config=await GuildConfig.findOne({guildId:plan.guildId})
    .select("activityGiveawayWinnersChannelId activityGiveawayReviewChannelId giveawayPingRoleId giveawayNotificationRoleIds activityNotificationRoleIds trialNotificationRoleIds survivalTrialPingRoleId").lean();
  if(!config?.activityGiveawayWinnersChannelId)
    throw Error("Configure the activity winners channel with /setup activity-giveaways before scheduled activity drawings.");
  if(plan.requireStaffReview&&!config.activityGiveawayReviewChannelId)
    throw Error("Configure the private staff review channel with /setup activity-giveaways before using staff review.");
  const candidateCount=plan.requireStaffReview&&hasConsentWindow?await countActivityParticipants({
    guildId:plan.guildId,type:qualification.type,channelIds:qualification.channelIds,
    ...windowOptions,
  }):0;
  const roleBonuses=normalizeRoleBonuses([...new Map([...(rule?.roleBonuses||[]),
    ...(plan.roleBonuses||[])].map(b=>[b.roleId,{roleId:b.roleId,extraEntries:b.extraEntries}])).values()]);
  let record=await Giveaway.findOne({scheduleId:plan._id,scheduleRunAt:runAt}).lean();
  if (!record) {
    try {
      record=await Giveaway.create({
        guildId:plan.guildId,channelId:config.activityGiveawayWinnersChannelId,
        creatorId:plan.creatorId,bannerNameKey:plan.bannerNameKey||"",
        // Bot-managed activity consent; no Discord role is needed.
        title:plan.title,prize,description:plan.description||"",winnerCount:plan.winnerCount,endsAt:runAt,
        mode:"activity",status:plan.requireStaffReview?"pending_review":"closing",
        requireStaffReview:Boolean(plan.requireStaffReview),progressEnabled:Boolean(plan.progressEnabled),
        announceEmptyResults:Boolean(plan.announceEmptyResults),
        roleBonuses,customActivityStartAt:plan.customActivityStartAt||null,
        customActivityEndAt:plan.customActivityEndAt||null,
        entrantIds:eligible,activityVerifiedIds:eligible,
        activityType:qualification.type,activityChannelIds:qualification.channelIds,
        activityMinimum:qualification.minimum,activityDays:activityWindow.custom?qualification.days:requirement.days,
        activityMinChars:qualification.minimumChars,
        activityRequiredMentionUserId:rule?.requiredMentionUserId||"",
        activityRequiredPhrase:rule?.requiredPhrase||"",
        activityMinTotalMessages:minimumTotalMessages,
        activityPeriod:activityWindow.period,
        activityPeriodKey:activityWindow.key,activityStartAt:activityWindow.startAt,
        activityEndAt:activityWindow.endAt,
        activityCheckedAt:now,activityCandidateCount:candidateCount,
        claimWindowHours:plan.claimWindowHours,autoRerollClaims:true,
        claimInstructions:plan.claimInstructions||"",maxAutoRerolls:plan.maxAutoRerolls??2,
        notificationRoleIds:sharedGiveawayPingRoleId(config)?[sharedGiveawayPingRoleId(config)]:[],announceEmptyResults:plan.announceEmptyResults!==false,
        scheduleId:plan._id,scheduleRunAt:runAt,
      });
      record=record.toObject();
    } catch(error) {
      if(error.code!==11000) throw error;
      record=await Giveaway.findOne({scheduleId:plan._id,scheduleRunAt:runAt}).lean();
      if(!record) {
        const already=await Giveaway.findOne({scheduleId:plan._id,
          activityPeriodKey:activityWindow.key}).lean();
        if(already) return {result:"This activity period was already drawn; no prize consumed.",
          drawn:false,activityPeriod:activityWindow.period,activityKey:activityWindow.key};
        throw error;
      }
    }
  }
  if(record.status==="pending_review"){
    await publishGiveawayReview(client,record);
    return {result:"Awaiting staff approval",drawn:false,pending:true,
      activityPeriod:activityWindow.period,activityKey:activityWindow.key};
  }
  if(record.status!=="ended")
    record=await closeGiveaway({id:record._id,guildId:plan.guildId,now,client});
  if(record.status!=="ended") throw Error("Scheduled giveaway draw is not ready.");
  try { await publishGiveawayResult(client,record); }
  catch(error) { console.error("[Giveaways] Scheduled drawing saved but Discord post failed:",String(record._id),error); }
  return {result:eligible.length?
      `Drawn: ${eligible.length} eligible members; giveaway ${record._id}.`:
      `No qualifying members — result posted with no winners; prize retained. Giveaway ${record._id}.`,
    drawn:(record.winnerIds||[]).length>0,
    activityPeriod:activityWindow.period,activityKey:activityWindow.key};
}

export function nextGiveawayPlanCycle(plan,outcome,now=new Date()) {
 const mode=planRepeatMode(plan);
 const nextIndex=plan.nextPrizeIndex+(outcome.drawn?1:0);
 const finishedPrizes=nextIndex>=plan.prizes.length;
 let nextRunAt=nextPlanAnnouncement(plan.nextRunAt,mode,plan.intervalMinutes);
 // Never re-announce old windows after long downtime. Keep the original recurrence
 // boundaries and Eastern wall-clock scheduling while skipping missed occurrences.
 const staleMs=(plan.activityPeriod || "weekly")==="daily"?24*60*60_000:7*24*60*60_000;
 let skipped=0;
 while(mode!=="once" && new Date(nextRunAt).getTime()+staleMs<=new Date(now).getTime()
       && skipped<20000) {
   nextRunAt=nextPlanAnnouncement(nextRunAt,mode,plan.intervalMinutes);
   skipped++;
 }
 return {
   status:mode==="once" ? "completed" : (finishedPrizes && !plan.repeatPrizes ? "paused" : "active"),
   nextRunAt, nextPrizeIndex:finishedPrizes && plan.repeatPrizes ? 0 : nextIndex,
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
    if(outcome.pending){
      await GiveawayPlan.updateOne({_id:owned._id,leaseKey},
        {$set:{leaseUntil:null,leaseKey:""}});
      continue;
    }
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
