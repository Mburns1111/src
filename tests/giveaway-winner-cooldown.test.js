import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import ActivityGiveawayOptIn from "../models/ActivityGiveawayOptIn.js";
import GiveawayWinnerCooldown from "../models/GiveawayWinnerCooldown.js";
import {closeGiveaway,rerollGiveaway,finishPendingReroll} from "../services/giveaways.js";
import {giveawayStaffRecordPayload} from "../services/giveaway-staff-records.js";
import {
 cooldownExpiration,giveawayUsesCooldown,activeGiveawayCooldownIds,
 applyGiveawayWinnerCooldown,removeGiveawayWinnerCooldown,adjustGiveawayWinnerCooldown,
} from "../services/giveaway-cooldowns.js";

const guildId="123456789012345678",A="234567890123456789",
 B="345678901234567890",staff="456789012345678901";
const id="507f1f77bcf86cd799439011";
const now=new Date("2026-11-12T13:00:00Z");
const delivery=new Date("2026-11-12T11:00:00Z");
const member=userId=>({id:userId,user:{id:userId,bot:false},roles:{cache:new Map()}});
const client={guilds:{fetch:async()=>({members:{fetch:async({user})=>member(user)}})}};
const restore=(pairs)=>pairs.forEach(([model,field,fn])=>{model[field]=fn;});
function replace(model,field,fn,backups){backups.push([model,field,model[field]]);model[field]=fn;}

test("cooldown is optional per regular/activity giveaway, never used by Trials",()=>{
 assert.equal(giveawayUsesCooldown({mode:"standard"}),false);
 assert.equal(giveawayUsesCooldown({mode:"activity",winnerCooldownEnabled:true}),true);
 assert.equal(giveawayUsesCooldown({mode:"standard",winnerCooldownEnabled:true}),true);
 assert.equal(giveawayUsesCooldown({mode:"survival",winnerCooldownEnabled:true}),false);
 assert.equal(new Giveaway({guildId,channelId:A,creatorId:A,title:"a",prize:"b",
  winnerCount:1,endsAt:now}).winnerCooldownEnabled,false);
 assert.equal(+cooldownExpiration(delivery,7),+delivery+7*86400000);
 assert.throws(()=>cooldownExpiration(delivery,0),/whole number/);
 assert.throws(()=>cooldownExpiration(delivery,366),/whole number/);
});

test("an existing longer cooldown is never shortened; assignments, removals and corrections are auditable",async()=>{
 const before=GiveawayWinnerCooldown.findOneAndUpdate;
 const updates=[];let expiration=new Date(+delivery+14*86400000);
 try{
  GiveawayWinnerCooldown.findOneAndUpdate=(query,changes,opts)=>({
   lean:async()=>{
    updates.push({query,changes,opts});
    if(changes.$max?.expiresAt&&+changes.$max.expiresAt>+expiration)expiration=changes.$max.expiresAt;
    else if(changes.$set?.expiresAt)expiration=changes.$set.expiresAt;
    return {guildId,userId:A,expiresAt:expiration};
   },
  });
  const applied=await applyGiveawayWinnerCooldown({
   guildId,userId:A,sourceGiveawayId:id,staffId:staff,
   deliveredAt:delivery,days:7,now,
  });
  assert.equal(applied.extended,false);
  assert.equal(+applied.expiresAt,+delivery+14*86400000);
  assert.equal(updates[0].changes.$push.history.action,"apply");
  assert.equal(updates[0].changes.$max.expiresAt.getTime(),+delivery+7*86400000);
  assert.equal(updates[0].opts.upsert,true);
  const adjusted=await adjustGiveawayWinnerCooldown({
   guildId,userId:A,staffId:staff,daysRemaining:3,now,
  });
  assert.equal(+adjusted.expiresAt,+now+3*86400000);
  assert.equal(updates[1].changes.$push.history.action,"adjust");
  assert.equal(await removeGiveawayWinnerCooldown({guildId,userId:A,staffId:staff,now}),true);
  assert.equal(updates[2].changes.$push.history.action,"remove");
 }finally{GiveawayWinnerCooldown.findOneAndUpdate=before;}
});

test("expired winner cooldowns never appear in active selection",async()=>{
 const backups=[];
 try{
  replace(GiveawayWinnerCooldown,"find",filter=>({lean:async()=>{
   assert.equal(filter.guildId,guildId);
   assert.ok(filter.expiresAt.$gt instanceof Date);
   return [{userId:A,expiresAt:new Date(+now+1000)}];
  }}),backups);
  assert.deepEqual([...await activeGiveawayCooldownIds(guildId,[A,B],{now})],[A]);
  assert.equal((await activeGiveawayCooldownIds(guildId,[],{now})).size,0);
 }finally{restore(backups);}
});

test("active cooldown is silently excluded before regular and activity winner draws",async()=>{
 const backups=[];
 try{
  replace(GuildConfig,"findOne",()=>({select:()=>({lean:async()=>({giveawayExcludedRoleId:""})})}),backups);
  replace(ActivityGiveawayOptIn,"find",()=>({lean:async()=>[A,B].map(userId=>({guildId,userId,active:true}))}),backups);
  replace(GiveawayWinnerCooldown,"find",()=>({lean:async()=>[{userId:B,expiresAt:new Date(+now+86400000)}]}),backups);
  for(const mode of ["standard","activity"]){
   const record={_id:id,guildId,mode,status:"closing",winnerCooldownEnabled:true,
    winnerCount:2,entrantIds:[A,B],winnerIds:[],winnerClaims:[],rerollHistory:[],
    claimWindowHours:24,autoRerollClaims:true};
   replace(Giveaway,"findOne",()=>({lean:async()=>record}),backups);
   replace(Giveaway,"findOneAndUpdate",(filter,change)=>({lean:async()=>
    filter.status==="open"?null:{...record,...change.$set}}),backups);
   const result=await closeGiveaway({id,guildId,now,client});
   assert.deepEqual(result.winnerIds,[A],mode+" must select only eligible winners");
   assert.deepEqual(result.activityVerifiedIds,[A],mode+" must save only eligible draw pool");
   // Restore only the two per-loop stubs.
   Giveaway.findOneAndUpdate=backups.pop()[2];
   Giveaway.findOne=backups.pop()[2];
  }
 }finally{restore(backups);}
});

test("cooldown OFF keeps both members in the regular draw without consulting cooldown MongoDB",async()=>{
 const backups=[];let queries=0;
 try{
  replace(GuildConfig,"findOne",()=>({select:()=>({lean:async()=>({giveawayExcludedRoleId:""})})}),backups);
  replace(GiveawayWinnerCooldown,"find",()=>{queries++;throw Error("must not query");},backups);
  const record={_id:id,guildId,mode:"standard",status:"closing",winnerCooldownEnabled:false,
   winnerCount:2,entrantIds:[A,B],winnerIds:[],winnerClaims:[],rerollHistory:[],claimWindowHours:24};
  replace(Giveaway,"findOne",()=>({lean:async()=>record}),backups);
  replace(Giveaway,"findOneAndUpdate",(filter,change)=>({lean:async()=>
   filter.status==="open"?null:{...record,...change.$set}}),backups);
  const result=await closeGiveaway({id,guildId,now,client});
  assert.deepEqual(result.winnerIds.slice().sort(),[A,B].sort());
  assert.equal(queries,0);
 }finally{restore(backups);}
});

test("automatic/staff rerolls do not select a member currently on cooldown",async()=>{
 const backups=[];
 try{
  replace(GuildConfig,"findOne",()=>({select:()=>({lean:async()=>({giveawayExcludedRoleId:""})})}),backups);
  replace(GiveawayWinnerCooldown,"find",()=>({lean:async()=>[{userId:B}]}),backups);
  replace(Giveaway,"findOne",()=>({lean:async()=>({
   _id:id,guildId,mode:"standard",status:"ended",winnerCooldownEnabled:true,
   winnerIds:[A],entrantIds:[A,B],winnerClaims:[],rerollHistory:[],claimResolvedSlots:[],
  })}),backups);
  await assert.rejects(rerollGiveaway({id,guildId,staffId:staff,slot:0,
    client,now}),/no unused current server members/i);
 }finally{restore(backups);}
});

test("Apply Cooldown is available after delivery, including on archived non-Trial records",()=>{
 const record={_id:id,guildId,status:"ended",mode:"standard",title:"Test",
  prize:"Prize",creatorId:A,endsAt:now,prizeDeliveredAt:now,prizeDeliveredBy:staff,
  winnerIds:[A],winnerClaims:[{slot:0,userId:A,ticketNumber:"123",
   ticketUrl:"https://discord.com/channels/123/456/789",submittedAt:now}],
  claimResolvedSlots:[]};
 const labels=r=>giveawayStaffRecordPayload(r).components.flatMap(row=>
  row.components).map(c=>c.data.label);
 const controls=labels(record);
 assert.ok(controls.includes("Archive Giveaway"));
 assert.equal(controls.indexOf("Apply Cooldown"),controls.indexOf("Archive Giveaway")+1);
 assert.ok(!labels({...record,prizeDeliveredAt:null}).includes("Apply Cooldown"));
 assert.ok(!labels({...record,mode:"survival"}).includes("Apply Cooldown"));
 assert.ok(labels({...record,publicListingRemovedAt:now}).includes("Apply Cooldown"));
 assert.ok(!labels({...record,mode:"survival",publicListingRemovedAt:now}).includes("Apply Cooldown"));
 assert.ok(labels({...record,cooldownAssignments:[{userId:A,days:3,expiresAt:now,
  appliedAt:now,appliedBy:staff}]}).includes("Manage Cooldowns"));
});

test("crash-recovered reroll settles without a winner if the last replacement is now cooled down",async()=>{
 const backups=[],priorWinner=A;
 try{
  replace(GiveawayWinnerCooldown,"find",()=>({lean:async()=>[{userId:B}]}),backups);
  const pending={
   _id:id,guildId,mode:"standard",status:"rerolling",winnerCooldownEnabled:true,
   winnerIds:[priorWinner],winnerClaims:[],claimResolvedSlots:[],entrantIds:[A,B],
   pendingRerollSlot:0,pendingRerollEligibleIds:[B],claimWindowHours:1,
   claimStartedAt:now,autoRerollClaims:true,
  };
  let set;
  replace(Giveaway,"findOneAndUpdate",(_filter,update)=>({lean:async()=>{
   set=update.$set;return {...pending,...set};
  }}),backups);
  const ended=await finishPendingReroll(pending,{now:new Date(+now+2*3600000)});
  assert.equal(ended.status,"ended");
  assert.deepEqual(ended.winnerIds,[priorWinner],"the original winner remains in the private history");
  assert.deepEqual(ended.claimResolvedSlots,[0]);
  assert.deepEqual(ended.pendingRerollEligibleIds,[]);
  assert.equal(set.pendingRerollSlot,null);
 }finally{restore(backups);}
});
