import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import CardCollector from "../models/CardCollector.js";
import CardActionCooldown from "../models/CardActionCooldown.js";
import {AchievementControl,CardBonusUse} from "../models/CardAchievementState.js";
import {claimWithBonus,refundWithBonus} from "../services/card-bonus-actions.js";

test("free cooldown never spends a token; active cooldown spends once and refunds once",async()=>{
 const old=[];const stub=(o,k,v)=>{old.push([o,k,o[k]]);o[k]=v;};
 let balance=2,cooldown=null;const uses=new Map();
 const session={withTransaction:async fn=>fn(),endSession:async()=>{}};
 const q=x=>({session:()=>({lean:async()=>x})});
 stub(mongoose,"startSession",async()=>session);
 stub(AchievementControl,"updateOne",async()=>({matchedCount:1}));
 stub(CardActionCooldown,"findById",()=>q(cooldown));
 stub(CardActionCooldown,"updateOne",async(q,u)=>{cooldown={...u.$set};});
 stub(CardActionCooldown,"deleteOne",async q=>{if(cooldown?.sourceId===q.sourceId){cooldown=null;return {deletedCount:1};}return {deletedCount:0};});
 stub(CardBonusUse,"findById",id=>q(uses.get(id)));
 stub(CardBonusUse,"updateOne",async(q,u)=>{
  const prior=uses.get(q._id);
  if(Object.hasOwn(q,"refundedAt")){
   if(!prior||prior.refundedAt)return {modifiedCount:0};
   prior.refundedAt=u.$set.refundedAt;return {modifiedCount:1};
  }
  uses.set(q._id,{...u.$set});return {modifiedCount:1};
 });
 stub(CardCollector,"updateOne",async(q,u)=>{
  if(q.bonusGrabs?.$gte&&balance<q.bonusGrabs.$gte)return {modifiedCount:0};
  balance+=u.$inc.bonusGrabs;return {modifiedCount:1};
 });
 try{
  const identity={_id:"grab:g:u",action:"grab",discordUserId:"u",scope:"g"};
  const now=new Date("2026-11-01"),duration=300000;
  const claim=sourceId=>claimWithBonus({identity,sourceId,now,duration});
  assert.equal((await claim("normal")).bonus,false);assert.equal(balance,2);
  assert.equal((await claim("normal")).allowed,false);assert.equal(balance,2);
  assert.equal((await claim("extra")).bonus,true);assert.equal(balance,1);
  assert.equal(cooldown.sourceId,"normal");
  assert.equal((await claim("extra")).allowed,false);assert.equal(balance,1);
  assert.equal(await refundWithBonus(identity,"extra"),true);assert.equal(balance,2);
  assert.equal(await refundWithBonus(identity,"extra"),false);assert.equal(balance,2);
  assert.equal(cooldown.sourceId,"normal","refund must preserve an independent normal cooldown");
  assert.equal((await claim("extra")).bonus,true,"a displaced entrant may try another slot after refund");
  balance=0;assert.equal((await claim("empty")).allowed,false);
  assert.equal(await refundWithBonus(identity,"normal"),true);assert.equal(balance,0);
 }finally{for(const [o,k,v] of old)o[k]=v;}
});
