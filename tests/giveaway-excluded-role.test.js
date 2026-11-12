import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import ActivityGiveawayOptIn from "../models/ActivityGiveawayOptIn.js";
import {closeGiveaway,rerollGiveaway} from "../services/giveaways.js";
import {giveawayExclusionEnabled,memberPassesGiveawayExclusion,
 configuredGiveawayExclusionRole} from "../services/giveaway-exclusion.js";
import {describeActivityGiveawaySetup} from "../commands/activity-giveaway-setup.js";
import {defaultActivityWizardSettings} from "../commands/activity-wizard.js";
import {validateGuidedStaffEdit} from "../services/guided-staff-actions.js";
import {validateGiveawayStaffEdit} from "../services/giveaway-staff-edit.js";

const guildId="123456789012345678",A="234567890123456789",
 B="345678901234567890",bannedRole="456789012345678901",
 giveawayId="507f1f77bcf86cd799439011";
const makeMember=(id,banned)=>({id,user:{bot:false},roles:{cache:new Map(banned?[[bannedRole,{}]]:[])}});
const makeClient=()=>({guilds:{fetch:async()=>({members:{fetch:async({user})=>
 user===A?makeMember(A,false):makeMember(B,true)}})}});
const optIn=()=>({lean:async()=>[A,B].map(userId=>({guildId,userId,active:true}))});

test("banned giveaway role is optional, can be switched off for an event, and never affects Trials",async()=>{
 const saved=GuildConfig.findOne;
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({giveawayExcludedRoleId:bannedRole})})});
  assert.equal(await configuredGiveawayExclusionRole(guildId,{mode:"standard"}),bannedRole);
  assert.equal(await configuredGiveawayExclusionRole(guildId,{mode:"activity"}),bannedRole);
  assert.equal(await configuredGiveawayExclusionRole(guildId,{mode:"standard",enforceExclusionRole:false}),"");
  assert.equal(await configuredGiveawayExclusionRole(guildId,{mode:"survival"}),"");
  assert.equal(giveawayExclusionEnabled({mode:"survival"}),false);
  assert.equal(memberPassesGiveawayExclusion(makeMember(A,false),bannedRole,{mode:"standard"}),true);
  assert.equal(memberPassesGiveawayExclusion(makeMember(B,true),bannedRole,{mode:"standard"}),false);
  assert.equal(memberPassesGiveawayExclusion(null,bannedRole,{mode:"activity"}),false);
  assert.equal(memberPassesGiveawayExclusion(makeMember(B,true),bannedRole,{mode:"standard",enforceExclusionRole:false}),true);
  assert.equal(memberPassesGiveawayExclusion(makeMember(B,true),bannedRole,{mode:"survival"}),true);
 }finally{GuildConfig.findOne=saved;}
});

test("both regular and activity winner draws silently omit members holding the banned role",async()=>{
 const saved={findOne:Giveaway.findOne,update:Giveaway.findOneAndUpdate,
  config:GuildConfig.findOne,participation:ActivityGiveawayOptIn.find};
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({giveawayExcludedRoleId:bannedRole})})});
  ActivityGiveawayOptIn.find=optIn;
  for(const mode of ["standard","activity"]){
   const record={_id:giveawayId,guildId,status:"closing",mode,
    entrantIds:[A,B],winnerCount:2,claimWindowHours:24,winnerIds:[],
    claimResolvedSlots:[],winnerClaims:[],rerollHistory:[]};
   Giveaway.findOne=()=>({lean:async()=>record});
   Giveaway.findOneAndUpdate=(query,change)=>({lean:async()=>
    query.status==="open"?null:{...record,...change.$set}});
   const result=await closeGiveaway({id:giveawayId,guildId,client:makeClient()});
   assert.deepEqual(result.winnerIds,[A],mode+" excluded role must never be drawn");
   assert.deepEqual(result.activityVerifiedIds,[A]);
  }
 }finally{
  Giveaway.findOne=saved.findOne;Giveaway.findOneAndUpdate=saved.update;
  GuildConfig.findOne=saved.config;ActivityGiveawayOptIn.find=saved.participation;
 }
});

test("per-giveaway exclusion off allows both members while leaving global role unchanged",async()=>{
 const saved={findOne:Giveaway.findOne,update:Giveaway.findOneAndUpdate,config:GuildConfig.findOne};
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({giveawayExcludedRoleId:bannedRole})})});
  const record={_id:giveawayId,guildId,status:"closing",mode:"standard",
   enforceExclusionRole:false,entrantIds:[A,B],winnerCount:2,claimWindowHours:24,
   winnerIds:[],winnerClaims:[],rerollHistory:[]};
  Giveaway.findOne=()=>({lean:async()=>record});
  Giveaway.findOneAndUpdate=(query,change)=>({lean:async()=>query.status==="open"?null:{...record,...change.$set}});
  const result=await closeGiveaway({id:giveawayId,guildId,client:makeClient()});
  assert.deepEqual([...result.winnerIds].sort(),[A,B].sort());
 }finally{
  Giveaway.findOne=saved.findOne;Giveaway.findOneAndUpdate=saved.update;GuildConfig.findOne=saved.config;
 }
});

test("automatic or staff rerolls cannot select a newly banned member",async()=>{
 const saved={findOne:Giveaway.findOne,config:GuildConfig.findOne};
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({giveawayExcludedRoleId:bannedRole})})});
  Giveaway.findOne=()=>({lean:async()=>({
   _id:giveawayId,guildId,status:"ended",mode:"standard",
   winnerIds:[A],entrantIds:[A,B],activityVerifiedIds:[A,B],
   claimResolvedSlots:[],winnerClaims:[],rerollHistory:[],
  })});
  await assert.rejects(
   rerollGiveaway({id:giveawayId,guildId,staffId:A,slot:0,client:makeClient()}),
   /no unused current server members/i);
 }finally{Giveaway.findOne=saved.findOne;GuildConfig.findOne=saved.config;}
});

test("setup and staff edit screens show the exclusion choice",()=>{
 const settings={giveawayExcludedRoleId:bannedRole,activityClaimWindowHours:12,activityMaxAutoRerolls:2};
 for(const mode of ["activity","regular"]){
  const text=describeActivityGiveawaySetup(settings,{mode});
  assert.match(text,/banned giveaway role/i);
  assert.match(text,new RegExp(bannedRole));
 }
 assert.equal(new GuildConfig({guildId}).giveawayExcludedRoleId,"");
 assert.equal(new Giveaway({guildId,channelId:A,creatorId:A,title:"test",prize:"test",
  endsAt:new Date(),winnerCount:1,mode:"standard"}).enforceExclusionRole,true);
 assert.equal(defaultActivityWizardSettings(A).enforceExclusionRole,true);
 const event={activityStartAt:new Date("2026-11-11T00:00:00Z"),
  activityEndAt:new Date("2026-11-14T00:00:00Z")};
 assert.deepEqual(validateGuidedStaffEdit("enforceExclusionRole","off",event),{enforceExclusionRole:false});
 const regular={mode:"standard",status:"open"};
 assert.deepEqual(validateGiveawayStaffEdit(regular,"enforceExclusionRole","off"),{enforceExclusionRole:false});
});
