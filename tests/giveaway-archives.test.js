import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import Giveaway from "../models/Giveaway.js";
import GiveawayActivityMinuteCount from "../models/GiveawayActivityMinuteCount.js";
import {EmbedBuilder} from "discord.js";
import {archiveGiveawayStaffRecord,giveawayReadyToArchive} from "../services/giveaway-archives.js";

const guildId="123456789012345678",staffId="234567890123456789",
 archiveId="345678901234567890",eventId="507f1f77bcf86cd799439011";
const winner="456789012345678901";
const record=(more={})=>({
 _id:eventId,guildId,mode:"standard",status:"ended",
 title:"Copy Cat giveaway",prize:"Copy Cat",creatorId:winner,
 channelId:"567890123456789012",messageId:"678901234567890123",
 staffCardChannelId:staffId,staffCardId:"789012345678901234",
 staffProgressMessageId:"",entrantIds:[winner],winnerIds:[winner],
 winnerClaims:[{slot:0,userId:winner,ticketNumber:"ABC-123",
   ticketUrl:"https://discord.com/channels/1/2/3"}],
 claimResolvedSlots:[],rerollHistory:[],
 prizeDeliveredAt:new Date("2026-11-10T15:00:00Z"),
 prizeDeliveredBy:"999999999999999999",...more,
});
const payload={embeds:[new EmbedBuilder().setTitle("Staff record")
 .setDescription("All winners, claims and reroll details")
 .setFooter({text:"Giveaway staff record · "+eventId})],components:[]};

test("only cancelled/no-winner/confirmed-delivered drawings can archive",()=>{
 assert.equal(giveawayReadyToArchive(record({prizeDeliveredAt:null})),false);
 assert.equal(giveawayReadyToArchive(record()),true);
 assert.equal(giveawayReadyToArchive(record({winnerIds:[],prizeDeliveredAt:null})),true);
 assert.equal(giveawayReadyToArchive(record({status:"cancelled",prizeDeliveredAt:null})),true);
 assert.equal(giveawayReadyToArchive(record({status:"open"})),false);
});

test("archiver copies complete record with claims before deleting old staff post",async()=>{
 const old={config:GuildConfig.findOne,update:Giveaway.updateOne};
 const saved=[],removed=[],posts=[];
 const card={id:"789012345678901234",author:{id:"bot"},
   embeds:[{footer:{text:"Giveaway staff record · "+eventId}}],
   delete:async()=>removed.push("active card")};
 const archiveChannel={id:archiveId,guild:{roles:{everyone:{id:"everyone"}}},
   permissionsFor:target=>({has:()=>target?.id!=="everyone"}),
   messages:{fetch:async()=>({find:()=>null})},
   send:async input=>{
     posts.push(input);return{id:"890123456789012345",author:{id:"bot"}};
   }};
 const activeChannel={messages:{fetch:async()=>card}};
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
    giveawayArchiveChannelId:archiveId,activityGiveawayReviewChannelId:staffId,
  })})});
  Giveaway.updateOne=async(_q,update)=>{saved.push(update.$set);};
  const client={user:{id:"bot"},channels:{fetch:async id=>
    id===archiveId?archiveChannel:activeChannel}};
  assert.equal(await archiveGiveawayStaffRecord(client,record(),{staffPayload:payload}),true);
  assert.equal(posts.length,1);
  assert.equal(posts[0].components.length,0,"Archived controls must be disabled");
  assert.match(posts[0].embeds[0].toJSON().title,/Archived giveaway/);
  const blob=posts[0].files[0].attachment;
  const data=JSON.parse(Buffer.from(blob).toString("utf8"));
  assert.equal(data.giveaway.prize,"Copy Cat");
  assert.equal(data.giveaway.winnerClaims[0].ticketNumber,"ABC-123");
  assert.deepEqual(removed,["active card"]);
  assert.equal(saved.at(-1).archiveMovedAt instanceof Date,true);
 }finally{GuildConfig.findOne=old.config;Giveaway.updateOne=old.update;}
});

test("archive transfer is not attempted before prize delivery",async()=>{
 const prior=GuildConfig.findOne;
 try{
  GuildConfig.findOne=()=>{throw Error("Must not query archive before prize delivery");};
  assert.equal(await archiveGiveawayStaffRecord(null,record({prizeDeliveredAt:null}),
    {staffPayload:payload}),false);
 }finally{GuildConfig.findOne=prior;}
});

test("completed activity giveaway archives both staff posts and the final member totals",async()=>{
 const old={config:GuildConfig.findOne,update:Giveaway.updateOne,
   aggregate:GiveawayActivityMinuteCount.aggregate};
 const sent=[],deleted=[],updates=[];
 const activeIds=["789012345678901234","890123456789012345"];
 const channel={id:archiveId,guild:{roles:{everyone:{id:"everyone"}}},
   permissionsFor:target=>({has:()=>target?.id!=="everyone"}),
   messages:{fetch:async()=>({find:()=>null})},
   send:async payload=>{sent.push(payload);return{id:sent.length===1?
     "901234567890123456":"912345678901234567",author:{id:"bot"}};}};
 const source={messages:{fetch:async id=>({
   id,author:{id:"bot"},
   embeds:[{footer:{text:(id===activeIds[1]?"Activity staff progress · ":"Giveaway staff record · ")+eventId}}],
   delete:async()=>deleted.push(id),
 })}};
 const activity=record({mode:"activity",status:"ended",winnerIds:[],
   prizeDeliveredAt:null,prizeDeliveredBy:"",
   staffProgressMessageId:activeIds[1],
   activityStartAt:new Date("2026-11-01T12:00:00Z"),
   activityEndAt:new Date("2026-11-10T12:00:00Z"),
   activityMinTotalMessages:10,activityMinimum:1,activityDays:1});
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
    giveawayArchiveChannelId:archiveId,activityGiveawayReviewChannelId:staffId,
  })})});
  Giveaway.updateOne=async(_q,u)=>updates.push(u.$set);
  GiveawayActivityMinuteCount.aggregate=async()=>[{
    _id:"111111111111111111",totalMessages:14,activeDays:1,
  }];
  const client={user:{id:"bot"},channels:{fetch:async id=>
    id===archiveId?channel:source}};
  assert.equal(await archiveGiveawayStaffRecord(client,activity,{staffPayload:payload}),true);
  assert.equal(sent.length,2);
  assert.match(sent[1].embeds[0].toJSON().description,/14\/10/);
  assert.deepEqual(deleted,[activeIds[1],activeIds[0]]);
  assert.ok(updates.at(-1).archiveMovedAt);
 }finally{
  GuildConfig.findOne=old.config;Giveaway.updateOne=old.update;
  GiveawayActivityMinuteCount.aggregate=old.aggregate;
 }
});

test("failed archive upload never deletes active moderator record",async()=>{
 const old={config:GuildConfig.findOne,update:Giveaway.updateOne};
 const deleted=[],updates=[];
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
    giveawayArchiveChannelId:archiveId,activityGiveawayReviewChannelId:staffId,
  })})});
  Giveaway.updateOne=async(...args)=>updates.push(args);
  const archiveChannel={id:archiveId,guild:{roles:{everyone:{id:"everyone"}}},
    messages:{fetch:async()=>({find:()=>null})},
    send:async()=>{throw Error("Attachment upload denied");}};
  const active={messages:{fetch:async id=>({
    id,author:{id:"bot"},delete:async()=>deleted.push(id),
  })}};
  const client={user:{id:"bot"},channels:{fetch:async id=>
    id===archiveId?archiveChannel:active}};
  await assert.rejects(archiveGiveawayStaffRecord(client,record(),{staffPayload:payload}),
    /Attachment upload denied/);
  assert.deepEqual(deleted,[]);
  assert.equal(updates.length,0);
 }finally{GuildConfig.findOne=old.config;Giveaway.updateOne=old.update;}
});

test("failed final activity count retrieval never archives or removes active records",async()=>{
 const old={config:GuildConfig.findOne,update:Giveaway.updateOne,
   aggregate:GiveawayActivityMinuteCount.aggregate};
 let writes=0,deletes=0;
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
    giveawayArchiveChannelId:archiveId,activityGiveawayReviewChannelId:staffId,
  })})});
  Giveaway.updateOne=async()=>{writes++;};
  GiveawayActivityMinuteCount.aggregate=async()=>{throw Error("MongoDB temporarily unavailable");};
  const archiveChannel={id:archiveId,guild:{roles:{everyone:{id:"everyone"}}},
    messages:{fetch:async()=>({find:()=>null})},
    send:async()=>{writes++;throw Error("Should not post archive");}};
  const client={user:{id:"bot"},channels:{fetch:async id=>id===archiveId?
    archiveChannel:{messages:{fetch:async()=>({delete:async()=>deletes++})}}}};
  const activity=record({mode:"activity",winnerIds:[],prizeDeliveredAt:null,
    activityStartAt:new Date("2026-11-01T12:00:00Z"),
    activityEndAt:new Date("2026-11-10T12:00:00Z"),
    activityMinTotalMessages:10,activityDays:1});
  await assert.rejects(archiveGiveawayStaffRecord(client,activity,{staffPayload:payload}),
    /MongoDB temporarily unavailable/);
  assert.equal(writes,0);
  assert.equal(deletes,0);
 }finally{
  GuildConfig.findOne=old.config;Giveaway.updateOne=old.update;
  GiveawayActivityMinuteCount.aggregate=old.aggregate;
 }
});

test("archive transfer refuses to delete a different bot-owned moderator post",async()=>{
 const old={config:GuildConfig.findOne,update:Giveaway.updateOne};
 const deleted=[],updates=[];
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
    giveawayArchiveChannelId:archiveId,activityGiveawayReviewChannelId:staffId,
  })})});
  Giveaway.updateOne=async(_q,u)=>updates.push(u.$set);
  const archiveChannel={id:archiveId,guild:{roles:{everyone:{id:"everyone"}}},
    messages:{fetch:async()=>({find:()=>null})},
    send:async()=>({id:"890123456789012345",author:{id:"bot"}})};
  const activeChannel={messages:{fetch:async()=>({
    author:{id:"bot"},embeds:[{footer:{text:"AM Isa · Active Giveaway Index"}}],
    delete:async()=>deleted.push(true),
  })}};
  const client={user:{id:"bot"},channels:{fetch:async id=>
    id===archiveId?archiveChannel:activeChannel}};
  await assert.rejects(archiveGiveawayStaffRecord(client,record(),{staffPayload:payload}),
    /identity mismatch/);
  assert.equal(deleted.length,0);
  assert.equal(updates.at(-1).archiveMovedAt,undefined);
 }finally{GuildConfig.findOne=old.config;Giveaway.updateOne=old.update;}
});

test("simultaneous archive requests share one copy and delete old post only once",async()=>{
 const old={config:GuildConfig.findOne,update:Giveaway.updateOne};
 const sent=[],deleted=[];
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const archived={id:"890123456789012345",author:{id:"bot"}};
 const channel={id:archiveId,guild:{roles:{everyone:{id:"everyone"}}},
   messages:{fetch:async()=>({find:()=>null})},
   send:async payload=>{sent.push(payload);await gate;return archived;}};
 const source={messages:{fetch:async()=>({
   author:{id:"bot"},embeds:[{footer:{text:"Giveaway staff record · "+eventId}}],
   delete:async()=>deleted.push(true),
 })}};
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
    giveawayArchiveChannelId:archiveId,activityGiveawayReviewChannelId:staffId,
  })})});
  Giveaway.updateOne=async()=>{};
  const client={user:{id:"bot"},channels:{fetch:async id=>
    id===archiveId?channel:source}};
  const recordValue=record();
  const first=archiveGiveawayStaffRecord(client,recordValue,{staffPayload:payload});
  const second=archiveGiveawayStaffRecord(client,recordValue,{staffPayload:payload});
  release();
  assert.deepEqual(await Promise.all([first,second]),[true,true]);
  assert.equal(sent.length,1);
  assert.equal(deleted.length,1);
 }finally{GuildConfig.findOne=old.config;Giveaway.updateOne=old.update;}
});
