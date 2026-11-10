import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import Giveaway from "../models/Giveaway.js";
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
