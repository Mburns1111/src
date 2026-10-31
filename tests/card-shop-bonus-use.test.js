import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import CardActionCooldown from "../models/CardActionCooldown.js";
import CardCollector from "../models/CardCollector.js";
import { AchievementControl, CardBonusUse } from "../models/CardAchievementState.js";
import { claimCardActionCooldown, releaseCardActionCooldown } from "../services/card-action-cooldowns.js";

const userId="123456789012345678", guildId="234567890123456789";
const stub=(entries,object,key,value)=>{entries.push([object,key,object[key]]);object[key]=value;};
const restore=entries=>{for(const [object,key,old] of entries.reverse())object[key]=old;};

test("Extra Grabs work in the development game before achievement launch and refund on failed entry",async()=>{
 const oldFlag=process.env.ENABLE_CARD_GAME_TEST,oldStart=process.env.CARD_ACHIEVEMENTS_START_AT;
 const old=[],now=new Date("2026-11-02T15:00:00Z");
 let bonusGrabs=1,refunds=0,used=false,source="";
 const session={withTransaction:fn=>fn(),endSession:async()=>{}};
 try{
  process.env.ENABLE_CARD_GAME_TEST="1";
  delete process.env.CARD_ACHIEVEMENTS_START_AT;
  stub(old,mongoose,"startSession",async()=>session);
  stub(old,AchievementControl,"updateOne",async()=>({matchedCount:0}));
  stub(old,CardActionCooldown,"findById",()=>({session:()=>({lean:async()=>({
   _id:"grab:"+guildId+":"+userId,
   sourceId:"previous",availableAt:new Date("2026-11-02T15:05:00Z"),
  })})}));
  stub(old,CardActionCooldown,"deleteOne",async()=>({deletedCount:0}));
  stub(old,CardBonusUse,"findById",()=>({session:()=>({lean:async()=>used?{sourceId:source,refundedAt:null}:null})}));
  stub(old,CardBonusUse,"updateOne",async(q,update)=>{
   if(Object.hasOwn(q,"refundedAt")){
    if(!used)return {modifiedCount:0};
    used=false;refunds++;return {modifiedCount:1};
   }
   used=true;source=update.$set.sourceId;return {modifiedCount:1};
  });
  stub(old,CardCollector,"updateOne",async(query,change)=>{
   const amount=change.$inc.bonusGrabs;
   if(amount<0){
    if(bonusGrabs===0)return {modifiedCount:0};
    bonusGrabs+=amount;return {modifiedCount:1};
   }
   bonusGrabs+=amount;return {modifiedCount:1};
  });
  // Legacy nontransactional cooldown logic must NOT be used when extras are enabled.
  stub(old,CardActionCooldown,"findOneAndUpdate",()=>{throw Error("legacy cooldown not used");});
  const claimed=await claimCardActionCooldown({
   action:"grab",discordUserId:userId,guildId,sourceId:"new-drop",now,
  });
  assert.equal(claimed.allowed,true);
  assert.equal(claimed.bonus,true);
  assert.equal(bonusGrabs,0);
  assert.equal((await claimCardActionCooldown({
   action:"grab",discordUserId:userId,guildId,sourceId:"new-drop",now,
  })).allowed,false,"repeated clicks cannot double-charge");
  assert.equal(bonusGrabs,0);
  assert.equal(await releaseCardActionCooldown({
   action:"grab",discordUserId:userId,guildId,sourceId:"new-drop",
  }),true);
  assert.equal(refunds,1);
  assert.equal(bonusGrabs,1);
 }finally{
  restore(old);
  if(oldFlag===undefined)delete process.env.ENABLE_CARD_GAME_TEST;
  else process.env.ENABLE_CARD_GAME_TEST=oldFlag;
  if(oldStart===undefined)delete process.env.CARD_ACHIEVEMENTS_START_AT;
  else process.env.CARD_ACHIEVEMENTS_START_AT=oldStart;
 }
});
