import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import GiveawayWatchRule from "../models/GiveawayWatchRule.js";
import {activityPlanListingEmbed,activityOneOffListingEmbed,
  publishActivityPlanListing} from "../services/giveaway-directory.js";

const guildId="123456789012345678",listId="234567890123456789",winnersId="345678901234567890";
const planId="507f1f77bcf86cd799439011";
const plan={_id:planId,guildId,status:"active",name:"QOTD",title:"QOTD Daily Drawing",
  watchNameKey:"qotd",bannerNameKey:"",
  prizes:["Copy Cat","Diamond Egg"],nextPrizeIndex:0,nextRunAt:new Date("2026-11-11T19:00:00Z"),
  winnerCount:1,activityPeriod:"daily",repeatMode:"daily",repeatPrizes:true,progressEnabled:true,
  description:"Tell us about your favorite pet!"};
const rule={channelId:"456789012345678901",minimumChars:25,
  minimumTotalMessages:50,minimumMessages:1,activeDays:1,
  requiredMentionUserId:"567890123456789012",requiredPhrase:"you are wonderful"};

test("public directory announces watch requirements, next draw and prize without showing entries or winners",()=>{
 const embed=activityPlanListingEmbed(plan,rule).toJSON();
 const linked=activityPlanListingEmbed({...plan,title:"Ping <@123456789012345678> in <#234567890123456789>"},rule).toJSON();
 assert.match(linked.description,/<@123456789012345678>/);
 assert.match(linked.description,/<#234567890123456789>/);
 assert.match(embed.description,/50 qualifying messages/);
 assert.match(embed.description,/Tell us about your favorite pet!/);
 assert.match(embed.description,/<#456789012345678901>/);
 assert.match(embed.description,/<@567890123456789012>/);
 assert.match(embed.description,/you are wonderful/);
 assert.match(embed.description,/Copy Cat/);
 assert.match(embed.description,/Previous calendar day/);
 assert.match(embed.description,/<t:1794423600:F>/);
 assert.doesNotMatch(embed.description,/\b(entrantIds|winnerIds|locked entries)\b/);
 assert.match(embed.footer.text,/Automatic entry.*#99439011/);
 const directed=activityPlanListingEmbed(plan,rule,{winnerChannelId:winnersId}).toJSON();
 assert.ok(directed.description.includes(`<#${winnersId}>`));
 const oneOff=activityOneOffListingEmbed({_id:planId,status:"open",mode:"activity",
  title:"Special Event",prize:"Fancy Pet",endsAt:new Date("2026-11-11T19:00:00Z"),
  winnerCount:1,entrantIds:["private-member"],activityChannelIds:["456789012345678901"],
  activityPeriod:"daily",activityMinTotalMessages:50,activityMinChars:10,
  description:"Giveaway details written by the host."});
 assert.doesNotMatch(oneOff.toJSON().description,/private-member/);
 const linkedOneOff=activityOneOffListingEmbed({
  _id:planId,title:"Ask <@123456789012345678> in <#234567890123456789>",
  prize:"Pet",endsAt:new Date("2026-11-11T19:00:00Z"),activityChannelIds:[],
  activityPeriod:"daily",activityMinTotalMessages:1,
 }).toJSON();
 assert.match(linkedOneOff.description,/<@123456789012345678>/);
 assert.match(linkedOneOff.description,/<#234567890123456789>/);
 assert.match(oneOff.toJSON().description,/Qualify automatically/);
 assert.match(oneOff.toJSON().description,/Giveaway details written by the host/);
});
test("active plan publishes a member-facing directory listing to list channel, not winners channel",async()=>{
 const old=[GuildConfig.findOne,GiveawayWatchRule.findOne,GiveawayPlan.updateOne];
 const sent=[],updates=[],fetched=[];
 try {
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
    activityGiveawayListChannelId:listId,activityGiveawayWinnersChannelId:winnersId})})});
  GiveawayWatchRule.findOne=()=>({lean:async()=>rule});
  GiveawayPlan.updateOne=async (_query,update)=>{updates.push(update.$set);return {modifiedCount:1}};
  const channel={id:listId,messages:{fetch:async()=>({find:()=>null})},
    send:async payload=>{sent.push(payload);return {id:"678901234567890123"}}};
  const client={user:{id:"bot"},channels:{fetch:async id=>{fetched.push(id);return channel;}}};
  assert.equal(await publishActivityPlanListing(client,plan),true);
  assert.deepEqual(fetched,[listId]);
  assert.equal(sent.length,1);
  assert.match(sent[0].embeds[0].toJSON().description,/50 qualifying messages/);
 assert.equal(sent[0].components[0].components[0].data.label,"Check My Progress");
 assert.equal(sent[0].components[0].components[0].data.custom_id,`activity-progress:plan:${planId}`);
  assert.equal(updates[0].listChannelId,listId);
  assert.equal(updates[0].listMessageId,"678901234567890123");
 }finally{
  [GuildConfig.findOne,GiveawayWatchRule.findOne,GiveawayPlan.updateOne]=old;
 }
});
test("finished or paused activity plan listing is removed without deleting its actual results",async()=>{
 const old=GiveawayPlan.updateOne;
 let deleted=0,updated;
 try {
  GiveawayPlan.updateOne=async(_query,update)=>{updated=update.$set;};
  const existing={author:{id:"bot"},delete:async()=>{deleted++;}};
  const client={user:{id:"bot"},channels:{fetch:async()=>({
   messages:{fetch:async()=>existing},
  })}};
  assert.equal(await publishActivityPlanListing(client,{...plan,status:"paused",
    listChannelId:listId,listMessageId:"678901234567890123"}),true);
  assert.equal(deleted,1);
  assert.deepEqual(updated,{listChannelId:"",listMessageId:"",listFingerprint:""});
 }finally{GiveawayPlan.updateOne=old;}
});

test("public cards hide internal details while keeping real entry requirements",()=>{
 const guided=activityOneOffListingEmbed({
   _id:"507f1f77bcf86cd799439011",guidedSeries:"507f1f77bcf86cd799439012",
   status:"open",title:"Say hi to <@123456789012345678> in <#234567890123456789>",
   prize:"Neon Pet",description:"A cozy community challenge.",
   activityChannelIds:["456789012345678901"],activityMinTotalMessages:5,activityMinimum:1,
   activityMinChars:1,activityDays:1,activityRequiredMentionUserId:"123456789012345678",
   activityStartAt:new Date("2026-11-08T21:00:00Z"),
   activityEndAt:new Date("2026-11-09T01:00:00Z"),
   endsAt:new Date("2026-11-09T01:00:00Z"),channelId:winnersId,winnerCount:1,
 }).toJSON();
 assert.match(guided.description,/🎁 \*\*Prize\*\*/);
 assert.match(guided.description,/✨ \*\*How to qualify\*\*/);
 assert.match(guided.description,/<@123456789012345678>/);
 assert.match(guided.description,/<#234567890123456789>/);
 assert.match(guided.description,/5 matching messages/);
 assert.match(guided.description,/Tag <@123456789012345678>/);
 assert.match(guided.description,/cozy community challenge/);
 assert.match(guided.description,/Ends and draws/);
 assert.doesNotMatch(guided.description,/1\+ characters|locked entries|autoReroll|criteriaVersion|Activity Giveaway ID/);
 assert.ok(guided.footer.text.length<55);
 const advanced=activityOneOffListingEmbed({
   _id:"507f1f77bcf86cd799439014",guidedSeries:"507f1f77bcf86cd799439015",
   title:"Weekly Event",prize:"Pet",activityMinTotalMessages:10,
   activityChannelIds:[],activityDays:3,activityMinimum:1,activityMinChars:25,
   activityRequiredPhrase:"thank you",winnerCount:2,
 }).toJSON();
 assert.match(advanced.description,/10 matching messages/);
 assert.match(advanced.description,/3 different days/);
 assert.match(advanced.description,/25 characters/);
 assert.match(advanced.description,/thank you/);
 assert.doesNotMatch(advanced.description,/per active day/);
});
