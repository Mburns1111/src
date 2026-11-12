import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import ActivityGiveawayOptIn from "../models/ActivityGiveawayOptIn.js";
import {closeGiveaway,rerollGiveaway} from "../services/giveaways.js";
import {configuredGiveawayBanRole,memberPassesGiveawayBan,giveawayBanMessage} from "../services/giveaway-exclusion.js";
import {describeActivityGiveawaySetup} from "../commands/activity-giveaway-setup.js";
import {defaultActivityWizardSettings} from "../commands/activity-wizard.js";
import {giveawayStaffEditableFields} from "../services/giveaway-staff-edit.js";
import {GUIDED_EDIT_FIELDS} from "../services/guided-staff-actions.js";

const guildId="123456789012345678",A="234567890123456789",
 B="345678901234567890",bannedRole="456789012345678901",
 giveawayId="507f1f77bcf86cd799439011";
const makeMember=(id,banned)=>({id,user:{bot:false},roles:{cache:new Map(banned?[[bannedRole,{}]]:[])}});
const makeClient=()=>({guilds:{fetch:async()=>({members:{fetch:async({user})=>
 user===A?makeMember(A,false):makeMember(B,true)}})}});
const optIn=()=>({lean:async()=>[A,B].map(userId=>({guildId,userId,active:true}))});

test("Giveaway Banned role is global and never overridable by event or mode",async()=>{
 const saved=GuildConfig.findOne;
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({giveawayExcludedRoleId:bannedRole})})});
  assert.equal(await configuredGiveawayBanRole(guildId),bannedRole);
  assert.equal(await configuredGiveawayBanRole(guildId,{required:true}),bannedRole);
  assert.equal(memberPassesGiveawayBan(makeMember(A,false),bannedRole),true);
  assert.equal(memberPassesGiveawayBan(makeMember(B,true),bannedRole),false);
  assert.equal(memberPassesGiveawayBan(null,bannedRole),false);
  assert.match(giveawayBanMessage,/cannot enter giveaways/);
  assert.ok(!GUIDED_EDIT_FIELDS.some(x=>x.value==="enforceExclusionRole"));
  assert.ok(!giveawayStaffEditableFields({status:"open",mode:"standard"}).includes("enforceExclusionRole"));
 }finally{GuildConfig.findOne=saved;}
});

test("both regular and activity winner draws silently omit punished members",async()=>{
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
   assert.deepEqual(result.winnerIds,[A]);
   assert.deepEqual(result.activityVerifiedIds,[A]);
  }
 }finally{
  Giveaway.findOne=saved.findOne;Giveaway.findOneAndUpdate=saved.update;
  GuildConfig.findOne=saved.config;ActivityGiveawayOptIn.find=saved.participation;
 }
});

test("rerolls never choose the banned member",async()=>{
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

test("setup shows mandatory role and individual giveaway models have no override",()=>{
 const settings={giveawayExcludedRoleId:bannedRole,activityClaimWindowHours:12,activityMaxAutoRerolls:2};
 for(const mode of ["activity","regular"]){
  const review=describeActivityGiveawaySetup(settings,{mode});
  assert.match(review,/Giveaway Banned role \(required\)/);
  assert.match(review,new RegExp(bannedRole));
 }
 assert.equal(new GuildConfig({guildId}).giveawayExcludedRoleId,"");
 assert.equal(new Giveaway({guildId,channelId:A,creatorId:A,title:"test",prize:"test",
  endsAt:new Date(),winnerCount:1,mode:"standard"}).enforceExclusionRole,undefined);
 assert.equal(defaultActivityWizardSettings(A).enforceExclusionRole,undefined);
});
