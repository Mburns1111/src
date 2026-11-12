import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import GiveawayActivityMinuteCount from "../models/GiveawayActivityMinuteCount.js";
import {runGiveawayPlan} from "../services/giveaway-plans.js";

test("zero qualifying members generate an explicit empty-result winner announcement without consuming the prize",async()=>{
 const original=[Giveaway.findOne,Giveaway.findOneAndUpdate,Giveaway.create,Giveaway.updateOne,
   GuildConfig.findOne,GiveawayActivityMinuteCount.aggregate];
 const guildId="123456789012345678",winnersId="234567890123456789",id="507f1f77bcf86cd799439011";
 let record,sent=0,announcement;
 try {
  Giveaway.findOne=query=>({lean:async()=>query._id?record:null});
  GiveawayActivityMinuteCount.aggregate=async()=>[];
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
    activityGiveawayWinnersChannelId:winnersId,
    activityParticipationRoleId:"567890123456789012",activityParticipationRoleConfiguredAt:new Date("2026-11-09T00:00:00Z"),
  })})});
  Giveaway.create=async data=>{
    record={...data,_id:id,renderVersion:0,status:"closing",winnerIds:[]};
    return {...record,toObject:()=>({...record})};
  };
  Giveaway.findOneAndUpdate=(query,update)=>({lean:async()=>{
    if(query.status==="open")return null;
    record={...record,status:"ended",winnerIds:[],claimStartedAt:new Date(),
      renderedAt:null,renderVersion:1};
    return {...record};
  }});
  Giveaway.updateOne=async()=>({modifiedCount:1});
  const client={user:{id:"bot"},guilds:{fetch:async()=>({members:{fetch:async()=>null}})},
   channels:{fetch:async channelId=>{
     assert.equal(channelId,winnersId);
     return {messages:{fetch:async()=>({find:()=>null})},
       send:async payload=>{sent++;announcement=payload;return {id:"345678901234567890"};}};
   }}};
  const plan={_id:"507f1f77bcf86cd799439012",guildId,status:"active",
   watchNameKey:"general",title:"Empty QOTD",creatorId:"456789012345678901",
   prizes:["Copy Cat"],nextPrizeIndex:0,claimWindowHours:48,winnerCount:1,
   announceEmptyResults:true,activityPeriod:"daily",minimumTotalMessages:1,
   nextRunAt:new Date("2026-11-12T00:30:00Z")};
  const result=await runGiveawayPlan(client,plan,{now:new Date("2026-11-12T00:31:00Z")});
  assert.equal(result.drawn,false);
  assert.equal(sent,1);
  assert.equal(record.entrantIds.length,0);
  assert.match(announcement.embeds[0].toJSON().description,/No eligible winner/);
  assert.doesNotMatch(announcement.embeds[0].toJSON().description,/How to claim|Winner ticket claims|How to qualify/);
 }finally{
  [Giveaway.findOne,Giveaway.findOneAndUpdate,Giveaway.create,Giveaway.updateOne,
   GuildConfig.findOne,GiveawayActivityMinuteCount.aggregate]=original;
 }
});
