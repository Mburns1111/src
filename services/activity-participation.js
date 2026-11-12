import ActivityGiveawayOptIn from "../models/ActivityGiveawayOptIn.js";
import GiveawayActivityMinuteCount from "../models/GiveawayActivityMinuteCount.js";
import GiveawayActivityRuleMinuteCount from "../models/GiveawayActivityRuleMinuteCount.js";

// Both activity counters see each message. Share one consent lookup for that
// message, but recheck MongoDB for every NEW message. No role is required.
const messageChecks=new WeakMap();
export const startOfMinute=at=>new Date(Math.floor(+new Date(at)/60000)*60000);

export async function eligibleActivityParticipant(message){
 if(!message?.guildId||!message?.author?.id||message.author.bot||message.webhookId)
  return null;
 let checked=messageChecks.get(message);
 if(!checked){
  checked=ActivityGiveawayOptIn.findOne({
   guildId:message.guildId,userId:message.author.id,active:true,
  }).lean();
  messageChecks.set(message,checked);
 }
 return checked;
}

export async function activeActivityParticipants(guildId,userIds){
 const ids=[...new Set((userIds||[]).map(String).filter(Boolean))];
 if(!ids.length)return new Map();
 const entries=await ActivityGiveawayOptIn.find({
  guildId,userId:{$in:ids},active:true,
 }).lean();
 return new Map(entries.map(p=>[String(p.userId),p]));
}

// The final threshold $match still comes last so staff can remove it to
// display partial progress. The opt-in lookup is scoped to THIS guild.
export function activityConsentStages(guildId,{timeField="minute"}={}){
 return [
  {$lookup:{
   from:ActivityGiveawayOptIn.collection.name,localField:"userId",
   foreignField:"userId",as:"activityConsent",
   pipeline:[{$match:{guildId,active:true}}],
  }},
  {$unwind:"$activityConsent"},
  ...(timeField?[{$match:{$expr:{
   $gte:["$"+timeField,"$activityConsent."+(timeField==="minute"?"countFrom":"optedInAt")],
  }}}]:[]),
 ];
}

export async function setActivityParticipation(guildId,userId,active,now=new Date()){
 if(!guildId||!userId)throw Error("Missing server or member.");
 const existing=await ActivityGiveawayOptIn.findOne({guildId,userId}).lean();
 if(active){
  if(existing?.active)return {changed:false,participant:existing};
  const minute=startOfMinute(now);
  // The unfinished minute bucket may contain data from the prior session.
  // Remove it before re-entry so only fresh messages qualify in that bucket.
  await Promise.all([
   GiveawayActivityMinuteCount.deleteMany({guildId,userId,minute}),
   GiveawayActivityRuleMinuteCount.deleteMany({guildId,userId,minute}),
  ]);
  const p=await ActivityGiveawayOptIn.findOneAndUpdate(
   {guildId,userId,...(existing?{active:false}:{})},
   {$set:{active:true,optedInAt:now,countFrom:minute,optedOutAt:null}},
   {upsert:!existing,new:true,runValidators:true}).lean();
  if(!p)return {changed:false,participant:await ActivityGiveawayOptIn.findOne({guildId,userId}).lean()};
  return {changed:true,participant:p};
 }
 if(!existing?.active)return {changed:false,participant:existing};
 const p=await ActivityGiveawayOptIn.findOneAndUpdate(
  {guildId,userId,active:true},{$set:{active:false,optedOutAt:now}},
  {new:true}).lean();
 return {changed:Boolean(p),participant:p||existing};
}
