import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import GiveawayActivityMinuteCount from "../models/GiveawayActivityMinuteCount.js";
import {ensureGiveawayStaffRecord} from "../services/giveaway-staff-records.js";

test("recurring drawings each receive new permanent staff control and progress posts",async()=>{
 const original={updateOne:Giveaway.updateOne,config:GuildConfig.findOne,
   aggregate:GiveawayActivityMinuteCount.aggregate};
 const previousId="507f1f77bcf86cd799439011",currentId="507f1f77bcf86cd799439012";
 const channelId="123456789012345678",mainId="234567890123456789",
   progressId="345678901234567890",scheduleId="507f1f77bcf86cd799439013";
 const previous={_id:previousId,guildId:"456789012345678901",scheduleId,
   activityStartAt:new Date("2026-11-04T05:00:00Z"),staffCardId:"111111111111111111",
   staffProgressMessageId:"222222222222222222",
   winnerIds:["567890123456789012"],status:"ended"};
 const current={_id:currentId,guildId:previous.guildId,mode:"activity",scheduleId,
   activityStartAt:new Date("2026-11-11T05:00:00Z"),
   activityEndAt:new Date("2026-11-18T05:00:00Z"),
   activityMinTotalMessages:30,activityMinimum:1,activityDays:1,
   title:"Weekly Activity Giveaway",prize:"Neon Cat",creatorId:"999999999999999999",
   status:"open",winnerCount:1,entrantIds:[],winnerIds:[],endsAt:new Date("2026-11-18T23:00:00Z"),
   staffCardId:"",staffCardChannelId:""};
 const sent=[],updates=[];
 const channel={id:channelId,guild:{roles:{everyone:{id:"everyone"}}},
   permissionsFor:()=>({has:()=>false}),
   messages:{fetch:async()=>({find:()=>null})},
   send:async payload=>{sent.push(payload);return {id:sent.length===1?mainId:progressId,author:{id:"bot"}};}};
 try{
  Giveaway.updateOne=async(query,update)=>{updates.push({query,update});};
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({activityGiveawayReviewChannelId:channelId})})});
  GiveawayActivityMinuteCount.aggregate=async()=>[{_id:"567890123456789012",totalMessages:8,activeDays:1}];
  const client={user:{id:"bot"},channels:{fetch:async()=>channel}};
  assert.equal(await ensureGiveawayStaffRecord(client,current),true);
  assert.equal(sent.length,2);
  assert.ok(updates.some(x=>x.update.$set?.staffCardId===mainId));
  assert.ok(updates.some(x=>x.update.$set?.staffProgressMessageId===progressId));
  assert.deepEqual(previous.winnerIds,["567890123456789012"]);
  assert.equal(previous.staffCardId,"111111111111111111");
  assert.equal(previous.staffProgressMessageId,"222222222222222222");
 }finally{
  Giveaway.updateOne=original.updateOne;
  GuildConfig.findOne=original.config;GiveawayActivityMinuteCount.aggregate=original.aggregate;
 }
});
