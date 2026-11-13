import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import ActivityGiveawayOptIn from "../models/ActivityGiveawayOptIn.js";
import GiveawayWinnerCooldown from "../models/GiveawayWinnerCooldown.js";
import {closeGiveaway,rerollGiveaway,finishPendingReroll,joinGiveaway} from "../services/giveaways.js";
import {giveawayStaffRecordPayload} from "../services/giveaway-staff-records.js";
import {
 cooldownExpiration,giveawayUsesCooldown,activeGiveawayCooldownIds,
 applyGiveawayWinnerCooldown,removeGiveawayWinnerCooldown,adjustGiveawayWinnerCooldown,
 removeActiveCooldownEntries,reconcileOpenCooldownEntries,
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

test("Apply Cooldown is beside Archive only after delivery for non-Trials",()=>{
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
 assert.ok(labels({...record,publicListingRemovedAt:now}).includes("Apply Cooldown"),"winner-specific cooldowns remain available from archives");
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

test("Enter Giveaway rejects active winner cooldowns when check is ON, without adding entry",async()=>{
 const backups=[],writes=[];
 try{
   replace(Giveaway,"findOne",()=>({select:()=>({lean:async()=>({
     mode:"standard",status:"open",endsAt:new Date(+now+86_400_000),
     winnerCooldownEnabled:true,entrantIds:[],
   })})}),backups);
   replace(GiveawayWinnerCooldown,"findOne",filter=>({lean:async()=>{
     assert.equal(filter.guildId,guildId);
     assert.equal(filter.userId,A);
     assert.deepEqual(filter.expiresAt,{$gt:now});
     return {userId:A,expiresAt:new Date(+now+86_400_000)};
   }}),backups);
   replace(Giveaway,"updateOne",async(q,u)=>{writes.push({q,u});return {modifiedCount:1};},backups);
   assert.equal(await joinGiveaway({id,guildId,userId:A,mode:"standard",now}),"cooldown");
   assert.equal(writes.length,0,"blocked member must not be inserted into entrantIds");
 }finally{restore(backups);}
});

test("an active cooldown cleans up an old entry if the member tries entering again",async()=>{
 const backups=[],writes=[];
 try{
   replace(Giveaway,"findOne",()=>({select:()=>({lean:async()=>({
     mode:"standard",status:"open",endsAt:new Date(+now+86_400_000),
     winnerCooldownEnabled:true,entrantIds:[A],
   })})}),backups);
   replace(GiveawayWinnerCooldown,"findOne",()=>({lean:async()=>({userId:A,expiresAt:new Date(+now+86_400_000)})}),backups);
   replace(Giveaway,"updateOne",async(q,u)=>{writes.push({q,u});return {modifiedCount:1};},backups);
   assert.equal(await joinGiveaway({id,guildId,userId:A,now}),"cooldown");
   assert.equal(writes.length,1);
   assert.equal(writes[0].q.winnerCooldownEnabled,true);
   assert.deepEqual(writes[0].u,{$pull:{entrantIds:A}});
 }finally{restore(backups);}
});

test("cooldown OFF permits regular entry and never queries cooldown records",async()=>{
 const backups=[];
 try{
   replace(Giveaway,"findOne",()=>({select:()=>({lean:async()=>({
     mode:"standard",status:"open",endsAt:new Date(+now+86_400_000),
     winnerCooldownEnabled:false,entrantIds:[],
   })})}),backups);
   replace(GiveawayWinnerCooldown,"findOne",()=>{throw Error("OFF must not check cooldown");},backups);
   replace(Giveaway,"updateOne",async(q,u)=>{
     assert.equal(q.mode,"standard");assert.equal(u.$addToSet.entrantIds,A);
     return {modifiedCount:1};
   },backups);
   assert.equal(await joinGiveaway({id,guildId,userId:A,now}),"joined");
 }finally{restore(backups);}
});

test("expired cooldown allows entry to an enabled giveaway",async()=>{
 const backups=[];
 try{
   replace(Giveaway,"findOne",()=>({select:()=>({lean:async()=>({
     mode:"standard",status:"open",endsAt:new Date(+now+86_400_000),
     winnerCooldownEnabled:true,entrantIds:[],
   })})}),backups);
   replace(GiveawayWinnerCooldown,"findOne",filter=>({lean:async()=>{
     assert.deepEqual(filter.expiresAt,{$gt:now});
     return null;
   }}),backups);
   replace(Giveaway,"updateOne",async(q,u)=>({modifiedCount:u.$addToSet?1:0}),backups);
   assert.equal(await joinGiveaway({id,guildId,userId:A,now}),"joined");
 }finally{restore(backups);}
});

test("cooldown application prunes only open, ON regular entries, not disabled or activity events",async()=>{
 const backups=[];let query,update;
 try{
   replace(Giveaway,"updateMany",async(q,u)=>{query=q;update=u;return {modifiedCount:2};},backups);
   assert.equal(await removeActiveCooldownEntries(guildId,[A,A,B],{now}),2);
   assert.equal(query.guildId,guildId);
   assert.equal(query.mode,"standard");
   assert.equal(query.status,"open");
   assert.equal(query.winnerCooldownEnabled,true);
   assert.deepEqual(query.endsAt,{$gt:now});
   assert.deepEqual(query.entrantIds,{$in:[A,B]});
   assert.deepEqual(update,{$pull:{entrantIds:{$in:[A,B]}}});
   assert.equal(await removeActiveCooldownEntries(guildId,[],{now}),0);
 }finally{restore(backups);}
});

test("restart sweep removes entries whose cooldown predated the entry guard",async()=>{
 const backups=[],now=new Date("2026-11-13T20:00:00Z");
 try{
   const matches=[
     {_id:id,guildId,entrantIds:[A,B]},
     {_id:"507f1f77bcf86cd799439012",guildId,entrantIds:[B]},
   ];
   let filter,selection,limit,updated=[];
   replace(Giveaway,"find",q=>{
     filter=q;
     return {select:fields=>{
       selection=fields;
       return {limit:n=>{
         limit=n;
         return {lean:async()=>matches};
       }};
     }};
   },backups);
   replace(GiveawayWinnerCooldown,"find",q=>({
     lean:async()=>q.userId.$in.includes(A)?[{userId:A}]:[]
   }),backups);
   replace(Giveaway,"updateOne",async(q,u)=>{
     updated.push({q,u});
     return {modifiedCount:1};
   },backups);
   assert.equal(await reconcileOpenCooldownEntries({now,limit:10}),1);
   assert.equal(filter.mode,"standard");
   assert.equal(filter.status,"open");
   assert.equal(filter.winnerCooldownEnabled,true);
   assert.deepEqual(filter.endsAt,{$gt:now});
   assert.match(selection,/entrantIds/);
   assert.equal(limit,10);
   assert.deepEqual(updated[0].u,{$pull:{entrantIds:{$in:[A]}}});
 }finally{restore(backups);}
});
