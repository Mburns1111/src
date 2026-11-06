import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import GiveawayActivityCount from "../models/GiveawayActivityCount.js";
import {runGiveawayPlan} from "../services/giveaway-plans.js";

test("scheduled activity drawing announces winners exclusively in the configured results channel",async()=>{
 const original=[Giveaway.findOne,Giveaway.findOneAndUpdate,Giveaway.create,Giveaway.updateOne,
   GuildConfig.findOne,GiveawayActivityCount.aggregate];
 const guildId="123456789012345678",listId="234567890123456789",
   winnersId="345678901234567890",userId="456789012345678901",
   planId="507f1f77bcf86cd799439011",eventId="507f1f77bcf86cd799439012";
 let created,drawn,sent=[],channelsRequested=[];
 try {
  Giveaway.findOne=()=>({lean:async()=>null});
  GiveawayActivityCount.aggregate=async()=>[{_id:userId}];
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
    activityGiveawayListChannelId:listId,activityGiveawayWinnersChannelId:winnersId,
  })})});
  Giveaway.create=async data=>{
    created={...data,_id:eventId,renderVersion:0,rerollHistory:[]};
    return {...created,toObject:()=>({...created})};
  };
  Giveaway.findOneAndUpdate=(filter,update)=>({lean:async()=>{
    if(filter.status==="closing"){
      drawn={...created,status:"ended",winnerIds:[userId],activityVerifiedIds:[userId],
        renderVersion:1,claimStartedAt:new Date("2026-11-12T00:30:00Z")};
      return drawn;
    }
    return {...created,status:"closing"};
  }});
  Giveaway.updateOne=async()=>({matchedCount:1,modifiedCount:1});
  const guild={members:{fetch:async()=>({user:{bot:false}})}};
  const winnerChannel={id:winnersId,messages:{fetch:async()=>({find:()=>null})},
    send:async payload=>{sent.push(payload);return {id:"567890123456789012"};}};
  const client={user:{id:"bot"},guilds:{fetch:async()=>guild},
    channels:{fetch:async id=>{channelsRequested.push(id);return id===winnersId?winnerChannel:null;}}};
  const plan={_id:planId,guildId,status:"active",
    name:"QOTD",watchNameKey:"general",bannerNameKey:"",
    title:"QOTD Daily",prizes:["Pet"],nextPrizeIndex:0,winnerCount:1,
    activityPeriod:"daily",minimumTotalMessages:1,claimWindowHours:24,
    nextRunAt:new Date("2026-11-12T00:30:00Z"),creatorId:"567890123456789013"};
  const result=await runGiveawayPlan(client,plan,{now:new Date("2026-11-12T00:31:00Z")});
  assert.equal(result.drawn,true);
  assert.equal(created.channelId,winnersId);
  assert.equal(created.mode,"activity");
  assert.deepEqual(channelsRequested,[winnersId]);
  assert.equal(sent.length,1);
  assert.match(sent[0].embeds[0].toJSON().description,/Winners/);
  assert.match(sent[0].embeds[0].toJSON().description,/456789012345678901/);
 }finally{
  [Giveaway.findOne,Giveaway.findOneAndUpdate,Giveaway.create,Giveaway.updateOne,
   GuildConfig.findOne,GiveawayActivityCount.aggregate]=original;
 }
});
