import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import {giveawayReviewPayload,publishGiveawayReview,
  handleGiveawayReviewButton} from "../services/giveaway-review.js";
import {PermissionFlagsBits} from "discord.js";
const guildId="123456789012345678",reviewChannelId="234567890123456789";
const record={_id:"507f1f77bcf86cd799439011",guildId,status:"pending_review",
 title:"QOTD",prize:"Copy Cat",winnerCount:1,activityMinTotalMessages:1,
 activityStartAt:new Date("2026-11-10T05:00:00Z"),
 activityEndAt:new Date("2026-11-11T05:00:00Z"),
 entrantIds:["345678901234567890"],roleBonuses:[{roleId:"456789012345678901",extraEntries:2}]};
test("review payload is private and staff action buttons never announce a winner",()=>{
 const payload=giveawayReviewPayload(record);
 assert.match(payload.embeds[0].toJSON().description,/Qualified members:.*1/);
 const extended=giveawayReviewPayload({...record,activityCandidateCount:5});
 assert.match(extended.embeds[0].toJSON().description,/Active members during window:.*5/);
 assert.match(extended.embeds[0].toJSON().description,/Not eligible at review time:.*4/);
 assert.equal(payload.components[0].components[0].data.label,"Approve & Draw");
 assert.equal(payload.components[0].components[1].data.label,"Decline Drawing");
 assert.ok(!payload.embeds[0].toJSON().description.includes("Winner: <@"));
});
test("pending review card publishes in configured private channel, never results channel",async()=>{
 const prior=[Giveaway.updateOne,GuildConfig.findOne],sent=[],ids=[];
 try{
  Giveaway.updateOne=async (_q,u)=>{ids.push(u.$set.reviewChannelId);return {}};
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
   activityGiveawayReviewChannelId:reviewChannelId,
   activityGiveawayWinnersChannelId:"567890123456789012",
  })})});
  const channel={messages:{fetch:async()=>({find:()=>null})},
    send:async p=>{sent.push(p);return {id:"678901234567890123"}}};
  const client={user:{id:"bot"},channels:{fetch:async id=>{
   assert.equal(id,reviewChannelId);return channel;
  }}};
  assert.equal(await publishGiveawayReview(client,record),true);
  assert.equal(sent.length,1);
  assert.deepEqual(ids,[reviewChannelId]);
 }finally{[Giveaway.updateOne,GuildConfig.findOne]=prior;}
});
test("member lacking Manage Server cannot approve giveaway",async()=>{
 let reply;
 await handleGiveawayReviewButton({
  memberPermissions:{has:()=>false},customId:`giveaway-review:approve:${record._id}`,
  deferReply:async()=>{},editReply:async value=>{reply=value;},
 });
 assert.match(reply,/Only staff/);
});
