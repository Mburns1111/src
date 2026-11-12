import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import ActivityGiveawayOptIn from "../models/ActivityGiveawayOptIn.js";
import GiveawayActivityMinuteCount from "../models/GiveawayActivityMinuteCount.js";
import GiveawayActivityRuleMinuteCount from "../models/GiveawayActivityRuleMinuteCount.js";
import {
 handleActivityGiveawayBanRoleUpdate,reconcileBannedActivityOptIns,
} from "../services/activity-participation-ban-reconcile.js";
import {handleActivityOptInButton} from "../services/activity-giveaway-optin-ui.js";

const guildId="123456789012345678",userId="234567890123456789",
 roleId="345678901234567890",channelId="456789012345678901",
 panelId="567890123456789012";
const originalStart=new Date("2026-11-10T09:00:00Z");
const bannedAt=new Date("2026-11-12T15:00:00Z");
const member=hasBan=>({id:userId,guild:{id:guildId},
 roles:{cache:new Map(hasBan?[[roleId,{}]]:[])}});
function patch(model,key,replacement,saved){
 saved.push([model,key,model[key]]);model[key]=replacement;
}
function restore(saved){
 for(const [model,key,original] of saved.reverse())model[key]=original;
}

test("receiving the banned role revokes consent without depending on the winner cooldown setting",async()=>{
 const saved=[],updates=[];
 try{
  patch(GuildConfig,"findOne",()=>({select:()=>({lean:async()=>({
   giveawayExcludedRoleId:roleId,
  })})}),saved);
  patch(ActivityGiveawayOptIn,"updateOne",async(filter,change)=>{
   updates.push({filter,change});return {modifiedCount:1};
  },saved);
  assert.equal(await handleActivityGiveawayBanRoleUpdate(member(false),member(true),bannedAt),true);
  assert.deepEqual(updates[0].filter,{guildId,userId,active:true});
  assert.equal(updates[0].change.$set.active,false);
  assert.equal(updates[0].change.$set.optOutReason,"giveaway-ban");
  assert.equal(+updates[0].change.$set.optedOutAt,+bannedAt);
  // Removing the role never reactivates Mongo consent.
  assert.equal(await handleActivityGiveawayBanRoleUpdate(member(true),member(false)),false);
  assert.equal(updates.length,1);
 }finally{restore(saved);}
});

test("role-ban reconciliation revokes consent even when member was silent or bot missed the update",async()=>{
 const saved=[];
 let active=true,revocations=0;
 try{
  patch(GuildConfig,"find",()=>({select:()=>({lean:async()=>[
   {guildId,giveawayExcludedRoleId:roleId},
  ]})}),saved);
  patch(ActivityGiveawayOptIn,"find",query=>({
   sort:()=>({limit:()=>({lean:async()=>query.active&&active?
    [{guildId,userId,active:true,optedInAt:originalStart}]:[]})}),
  }),saved);
  patch(ActivityGiveawayOptIn,"updateOne",async(filter,change)=>{
   assert.equal(filter.active,true);
   assert.equal(change.$set.optOutReason,"giveaway-ban");
   active=false;revocations++;
   return {modifiedCount:1};
  },saved);
  const client={guilds:{fetch:async()=>({members:{fetch:async()=>member(true)}})}};
  assert.equal(await reconcileBannedActivityOptIns(client,{batchSize:4,now:bannedAt}),1);
  assert.equal(active,false);
  assert.equal(revocations,1);
  assert.equal(await reconcileBannedActivityOptIns(client,{batchSize:4}),0);
  assert.equal(revocations,1);
 }finally{restore(saved);}
});

test("after the ban is removed, status remains opted out until the user explicitly opts in again",async()=>{
 const saved=[];
 let state={
  guildId,userId,active:false,optedInAt:originalStart,countFrom:originalStart,
  optedOutAt:bannedAt,optOutReason:"giveaway-ban",
 };
 const start=new Date();
 try{
  patch(GuildConfig,"findOne",()=>({select:()=>({lean:async()=>({
   activityGiveawayListChannelId:channelId,
   activityParticipationPanelMessageId:panelId,
   giveawayExcludedRoleId:roleId,
  })})}),saved);
  patch(ActivityGiveawayOptIn,"findOne",()=>({lean:async()=>({...state})}),saved);
  patch(ActivityGiveawayOptIn,"findOneAndUpdate",(_filter,change)=>({lean:async()=>{
   state={...state,...change.$set};return {...state};
  }}),saved);
  patch(GiveawayActivityMinuteCount,"deleteMany",async()=>({deletedCount:0}),saved);
  patch(GiveawayActivityRuleMinuteCount,"deleteMany",async()=>({deletedCount:0}),saved);
  const interaction=action=>{
   const answers=[];
   return {
    answers,
    input:{
     customId:"activity-optin:"+action,guildId,channelId,
     guild:{members:{fetch:async()=>member(false)}},
     user:{id:userId},message:{id:panelId},
     deferReply:async()=>{},
     editReply:async value=>{answers.push(value);},
    },
   };
  };
  const status=interaction("status");
  await handleActivityOptInButton(status.input);
  assert.equal(state.active,false,"removing the role must not restore opt-in");
  assert.match(status.answers.at(-1),/Opt In.*again/);
  const optin=interaction("in");
  await handleActivityOptInButton(optin.input);
  assert.equal(state.active,true);
  assert.equal(state.optOutReason,"");
  assert.equal(state.optedOutAt,null);
  assert.ok(+state.optedInAt>=+start);
  assert.ok(+state.countFrom>+originalStart);
  assert.match(optin.answers.at(-1),/now \*\*opted in\*\*/);
 }finally{restore(saved);}
});
