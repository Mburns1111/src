import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import Giveaway from "../models/Giveaway.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import {
  activeGiveawayIndexData,activeGiveawayIndexEmbed,reconcileActiveGiveawayIndex,
  GIVEAWAY_INDEX_STICKY_INTERVAL_MS,
} from "../services/giveaway-index.js";

const guildId="123456789012345678",staffChannelId="234567890123456789",
  publicChannelId="345678901234567890";
const now=new Date("2026-11-10T15:00:00Z");
const item=(id,mode,status,extra={})=>({
  _id:id,guildId,mode,status,title:"Sample "+mode,prize:"Neon pet",
  channelId:publicChannelId,messageId:id,
  endsAt:new Date("2026-11-11T12:00:00Z"),
  winnerIds:[],winnerClaims:[],claimResolvedSlots:[],...extra,
});
const plans=[{
 _id:"507f1f77bcf86cd799439011",guildId,status:"active",
 title:"Type anywhere 3 times on 3 different days",listChannelId:publicChannelId,
 listMessageId:"567890123456789012",
 nextRunAt:new Date("2026-11-16T05:00:00Z"),
}];

test("staff index includes open giveaways, ongoing schedules, claims, and real links",()=>{
 const records=[
   item("111111111111111111","standard","open"),
   item("222222222222222222","survival","ended",{
     winnerIds:["333333333333333333"],
   }),
   item("333333333333333333","activity","pending_review"),
 ];
 const rendered=activeGiveawayIndexEmbed({records,plans}).toJSON();
 assert.equal(rendered.title,"📌 Active Giveaway Directory · Staff");
 assert.match(rendered.description,/4 active or pending giveaways/);
 assert.match(rendered.description,/Open for entries/);
 assert.match(rendered.description,/Waiting for winner claim/);
 assert.match(rendered.description,/Awaiting staff approval/);
 assert.match(rendered.description,/Ongoing schedule/);
 assert.match(rendered.description,/Public post/);
 assert.match(rendered.description,/https:\/\/discord.com\/channels\/123456789012345678\/345678901234567890\/111111111111111111/);
 assert.doesNotMatch(rendered.description,/No giveaways are accepting entries/);
});

test("staff index data retains ended winner claims and live trial, but excludes settled events",async()=>{
 const old={find:Giveaway.find,plans:GiveawayPlan.find};
 try{
  const records=[
   item("111111111111111111","standard","open"),
   item("222222222222222222","standard","ended",{winnerIds:["444444444444444444"]}),
   item("333333333333333333","activity","pending_review"),
   item("444444444444444444","survival","running",{
     endsAt:new Date("2026-11-09T12:00:00Z"),
   }),
   item("555555555555555555","standard","ended",{
     winnerIds:["666666666666666666"],claimResolvedSlots:[0],
   }),
   item("777777777777777777","standard","cancelled"),
  ];
  Giveaway.find=()=>({sort:()=>({limit:()=>({lean:async()=>records})})});
  GiveawayPlan.find=()=>({sort:()=>({limit:()=>({lean:async()=>plans})})});
  const result=await activeGiveawayIndexData(guildId,now);
  assert.deepEqual(result.records.map(r=>r._id),[
   "111111111111111111","222222222222222222",
   "333333333333333333","444444444444444444",
  ]);
  assert.equal(result.plans.length,1);
 }finally{Giveaway.find=old.find;GiveawayPlan.find=old.plans;}
});

test("staff sticky moves after an hour only if it is no longer last",async()=>{
 const old={config:GuildConfig.find,update:GuildConfig.updateOne,
   records:Giveaway.find,plans:GiveawayPlan.find};
 const state={guildId,activityGiveawayReviewChannelId:staffChannelId,
   giveawayIndexChannelId:"",giveawayIndexMessageId:"",
   giveawayIndexFingerprint:"",giveawayIndexCheckedAt:null};
 let newest=null;
 const msgs=new Map(),sends=[],deletes=[],edits=[],reads=[];
 const staffChannel={id:staffChannelId,messages:{fetch:async option=>{
   reads.push(option);
   if(option?.limit===1)return {first:()=>newest?{id:newest}:null};
   if(option?.limit===100)return {find:()=>null};
   return msgs.get(option)||null;
 }},send:async payload=>{
   const id=sends.length===0?"888888888888888888":"999999999999999999";
   sends.push(payload);newest=id;
   const msg={id,author:{id:"bot"},edit:async()=>{edits.push(id);},
     delete:async()=>{deletes.push(id);}};
   msgs.set(id,msg);return msg;
 }};
 try{
  GuildConfig.find=()=>({select:()=>({lean:async()=>[state]})});
  GuildConfig.updateOne=async(q,u)=>Object.assign(state,u.$set);
  Giveaway.find=()=>({sort:()=>({limit:()=>({lean:async()=>[]})})});
  GiveawayPlan.find=()=>({sort:()=>({limit:()=>({lean:async()=>[]})})});
  const client={user:{id:"bot"},channels:{fetch:async id=>{
   assert.equal(id,staffChannelId);return staffChannel;
  }}};
  await reconcileActiveGiveawayIndex(client,{now});
  assert.equal(sends.length,1);
  const readCount=reads.length;
  await reconcileActiveGiveawayIndex(client,{now:new Date(now.getTime()+30*60_000)});
  assert.equal(reads.length,readCount);
  newest="777777777777777777";
  await reconcileActiveGiveawayIndex(client,{now:new Date(now.getTime()+59*60_000)});
  assert.equal(sends.length,1);
  await reconcileActiveGiveawayIndex(client,{now:new Date(now.getTime()+GIVEAWAY_INDEX_STICKY_INTERVAL_MS)});
  assert.equal(sends.length,2);
  assert.deepEqual(deletes,["888888888888888888"]);
  assert.equal(state.giveawayIndexMessageId,"999999999999999999");
  await reconcileActiveGiveawayIndex(client,{now:new Date(now.getTime()+2*GIVEAWAY_INDEX_STICKY_INTERVAL_MS)});
  assert.equal(sends.length,2);
 }finally{
  GuildConfig.find=old.config;GuildConfig.updateOne=old.update;
  Giveaway.find=old.records;GiveawayPlan.find=old.plans;
 }
});

test("moving sticky from public channel deletes only the prior bot-owned directory",async()=>{
 const old={config:GuildConfig.find,update:GuildConfig.updateOne,
   records:Giveaway.find,plans:GiveawayPlan.find};
 const state={guildId,activityGiveawayReviewChannelId:staffChannelId,
   giveawayIndexChannelId:publicChannelId,giveawayIndexMessageId:"888888888888888888",
   giveawayIndexFingerprint:"legacy",giveawayIndexCheckedAt:now};
 const deleted=[],sent=[],fetched=[];
 const publicIndex={id:state.giveawayIndexMessageId,author:{id:"bot"},
   embeds:[{footer:{text:"AM Isa · Active Giveaway Index"}}],
   delete:async()=>deleted.push("old index")};
 const publicChannel={messages:{fetch:async id=>{
   fetched.push({channel:"public",id});return publicIndex;
 }}};
 const staffChannel={id:staffChannelId,messages:{fetch:async arg=>{
   if(arg?.limit===100)return {find:()=>null};
   if(arg?.limit===1)return {first:()=>null};
   return null;
 }},send:async payload=>{sent.push(payload);return{id:"999999999999999999",author:{id:"bot"}};}};
 try{
  GuildConfig.find=()=>({select:()=>({lean:async()=>[state]})});
  GuildConfig.updateOne=async(q,u)=>Object.assign(state,u.$set);
  Giveaway.find=()=>({sort:()=>({limit:()=>({lean:async()=>[]})})});
  GiveawayPlan.find=()=>({sort:()=>({limit:()=>({lean:async()=>[]})})});
  const client={user:{id:"bot"},channels:{fetch:async id=>
   id===publicChannelId?publicChannel:staffChannel}};
  await reconcileActiveGiveawayIndex(client,{now});
  assert.deepEqual(deleted,["old index"]);
  assert.equal(sent.length,1);
  assert.equal(state.giveawayIndexChannelId,staffChannelId);
  assert.equal(state.giveawayIndexMessageId,"999999999999999999");
 }finally{
  GuildConfig.find=old.config;GuildConfig.updateOne=old.update;
  Giveaway.find=old.records;GiveawayPlan.find=old.plans;
 }
});
