import ActivityGiveawayOptIn from "../models/ActivityGiveawayOptIn.js";
import GiveawayActivityMinuteCount from "../models/GiveawayActivityMinuteCount.js";
import GiveawayActivityRuleMinuteCount from "../models/GiveawayActivityRuleMinuteCount.js";
import {configuredGiveawayBanRole} from "./giveaway-exclusion.js";

// Both activity counters see each message. Share one consent lookup for that
// message, but recheck MongoDB for every NEW message. No role is required.
const messageChecks=new WeakMap();
export const startOfMinute=at=>new Date(Math.floor(+new Date(at)/60000)*60000);

// The banned role ends consent, not merely eligibility. Removing that role
// later does NOT restore consent: the member must press Opt In again.
export async function revokeActivityParticipationForBan(guildId,userId,now=new Date()){
 if(!guildId||!userId)throw Error("Missing server or member.");
 const changed=await ActivityGiveawayOptIn.updateOne(
  {guildId,userId,active:true},
  {$set:{active:false,optedOutAt:now,optOutReason:"giveaway-ban"}},
 );
 return Boolean(changed.modifiedCount);
}


export async function eligibleActivityParticipant(message){
 if(!message?.guildId||!message?.author?.id||message.author.bot||message.webhookId)
  return null;
 let checked=messageChecks.get(message);
 if(!checked){
  checked=(async()=>{
    const entry=await ActivityGiveawayOptIn.findOne({
      guildId:message.guildId,userId:message.author.id,active:true,
    }).lean();
    if(!entry)return null;
    // Only after confirming consent do we make the ban check. Real Discord
    // messages carry a guild/member; older unit fixtures without a guild
    // still exercise the pure consent gate.
    if(!message.guild?.members?.fetch)return entry;
    const roleId=await configuredGiveawayBanRole(message.guildId);
    if(!roleId)return entry; // pre-migration server; /setup requires a role.
    const member=message.member?.roles?.cache?message.member:
      await message.guild.members.fetch({user:message.author.id,force:true}).catch(()=>null);
    if(!member?.roles?.cache)return null;
    if(member.roles.cache.has(roleId)){
      await revokeActivityParticipationForBan(message.guildId,message.author.id);
      return null;
    }
    return entry;
  })();
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
   {$set:{active:true,optedInAt:now,countFrom:minute,optedOutAt:null,optOutReason:""}},
   {upsert:!existing,new:true,runValidators:true}).lean();
  if(!p)return {changed:false,participant:await ActivityGiveawayOptIn.findOne({guildId,userId}).lean()};
  return {changed:true,participant:p};
 }
 if(!existing?.active)return {changed:false,participant:existing};
 const p=await ActivityGiveawayOptIn.findOneAndUpdate(
  {guildId,userId,active:true},{$set:{active:false,optedOutAt:now,optOutReason:"member"}},
  {new:true}).lean();
 return {changed:Boolean(p),participant:p||existing};
}
