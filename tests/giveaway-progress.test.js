import test from "node:test";
import assert from "node:assert/strict";
import GiveawayPlan from "../models/GiveawayPlan.js";
import GiveawayActivityCount from "../models/GiveawayActivityCount.js";
import {handleActivityGiveawayProgress} from "../services/giveaway-progress.js";

const guildId="123456789012345678",userId="234567890123456789",
 planId="507f1f77bcf86cd799439011",listMessageId="345678901234567890",
 listChannelId="456789012345678901";
test("opt-in progress button privately counts only the caller's activity for next drawing",async()=>{
 const saved=[GiveawayPlan.findOne,GiveawayActivityCount.aggregate],seen=[];
 try{
  GiveawayPlan.findOne=()=>({lean:async()=>({
    _id:planId,guildId,title:"50 Chat Messages",progressEnabled:true,status:"active",
    listMessageId,listChannelId,watchNameKey:"general",activityPeriod:"daily",
    minimumTotalMessages:50,nextRunAt:new Date("2026-11-12T00:30:00Z"),
  })});
  GiveawayActivityCount.aggregate=async pipeline=>{
    seen.push(pipeline[0].$match);
    return [{_id:userId,totalMessages:12,activeDays:1}];
  };
  let response,deferred;
  await handleActivityGiveawayProgress({
    guildId,channelId:listChannelId,message:{id:listMessageId},
    customId:`activity-progress:plan:${planId}`,user:{id:userId},
    deferReply:async options=>{deferred=options;},
    editReply:async content=>{response=content;},
  });
  assert.ok(deferred.flags);
  assert.equal(seen.length,1);
  assert.equal(seen[0].userId,userId);
  assert.equal(seen[0].day,"2026-11-10"); // next Wed drawing checks the previous Tuesday
  assert.match(response.content,/12 \/ 50 qualifying messages/);
  assert.match(response.content,/Not qualified yet/);
  assert.doesNotMatch(response.content,/<@234567890123456789>/);
 }finally{[GiveawayPlan.findOne,GiveawayActivityCount.aggregate]=saved;}
});
test("disabled progress setting refuses any request, even for a known listed plan",async()=>{
 const old=GiveawayPlan.findOne;
 try {
  GiveawayPlan.findOne=()=>({lean:async()=>({
    _id:planId,guildId,status:"active",progressEnabled:false,listMessageId,listChannelId,
  })});
  let value;
  await handleActivityGiveawayProgress({
    guildId,channelId:listChannelId,message:{id:listMessageId},
    customId:`activity-progress:plan:${planId}`,user:{id:userId},
    deferReply:async()=>{},editReply:async x=>{value=x;},
  });
  assert.match(value,/unavailable/);
 }finally{GiveawayPlan.findOne=old;}
});
