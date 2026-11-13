import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import ActivityGiveawayOptIn from "../models/ActivityGiveawayOptIn.js";
import {finishPendingReroll} from "../services/giveaways.js";

const guildId="123456789012345678",oldWinner="234567890123456789",
 candidate="345678901234567890",banRole="456789012345678901",
 id="507f1f77bcf86cd799439011";
const now=new Date("2026-11-13T20:00:00Z");
const record=()=>({
 _id:id,guildId,mode:"activity",status:"rerolling",
 winnerIds:[oldWinner],entrantIds:[oldWinner,candidate],
 winnerCount:1,pendingRerollSlot:0,pendingRerollEligibleIds:[candidate],
 pendingRerollAt:now,pendingRerollStaffId:"bot",
 claimWindowHours:12,claimStartedAt:now,winnerAssignedAt:[now],
 winnerCooldownEnabled:false,claimResolvedSlots:[],winnerClaims:[],rerollHistory:[]
});

for(const [name,scenario] of [
 ["left the Discord server",{left:true,opted:true,banned:false}],
 ["opted out after the reroll was reserved",{left:false,opted:false,banned:false}],
 ["received the Giveaway Banned role during downtime",{left:false,opted:true,banned:true}]
]){
 test("resumed activity reroll never selects a member who "+name,async()=>{
  const prior={config:GuildConfig.findOne,optin:ActivityGiveawayOptIn.find,
   update:Giveaway.findOneAndUpdate};
  let settled;
  try{
   GuildConfig.findOne=()=>({select:()=>({lean:async()=>({giveawayExcludedRoleId:banRole})})});
   ActivityGiveawayOptIn.find=()=>({lean:async()=>scenario.opted?
     [{userId:candidate,active:true}]:[]});
   Giveaway.findOneAndUpdate=(_query,change)=>({lean:async()=>{
     settled={...record(),...change.$set};
     return settled;
   }});
   const client={guilds:{fetch:async()=>({members:{fetch:async()=>{
     if(scenario.left)throw Object.assign(Error("Unknown member"),{code:10007});
     return {id:candidate,user:{id:candidate,bot:false},
       roles:{cache:new Map(scenario.banned?[[banRole,{}]]:[])}};
   }}})}};
   const result=await finishPendingReroll(record(),{client,now});
   assert.equal(result.status,"ended");
   assert.deepEqual(result.winnerIds,[oldWinner],
     "the old winner stays only as staff audit history, never as an eligible replacement");
   assert.deepEqual(result.claimResolvedSlots,[0],
     "a now-ineligible candidate must leave the winning slot unawarded");
   assert.equal(result.pendingRerollSlot,null);
  }finally{
   GuildConfig.findOne=prior.config;
   ActivityGiveawayOptIn.find=prior.optin;
   Giveaway.findOneAndUpdate=prior.update;
  }
 });
}
