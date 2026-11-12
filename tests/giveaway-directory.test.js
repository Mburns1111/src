import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import Giveaway from "../models/Giveaway.js";
import GiveawayWatchRule from "../models/GiveawayWatchRule.js";
import {activityPlanListingEmbed,activityOneOffListingEmbed,
  publishActivityPlanListing,publishActivityOneOffListing} from "../services/giveaway-directory.js";

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
 assert.match(embed.description,/50 messages/);
 assert.match(embed.description,/Tell us about your favorite pet!/);
 assert.match(embed.description,/<#456789012345678901>/);
 assert.match(embed.description,/<@567890123456789012>/);
 assert.match(embed.description,/you are wonderful/);
 assert.match(embed.description,/Spelling and word order must match; capitals do not matter/);
 assert.match(embed.description,/Copy Cat/);
 assert.match(embed.description,/Previous calendar day/);
 assert.match(embed.description,/<t:1794423600:F>/);
 assert.doesNotMatch(embed.description,/\b(entrantIds|winnerIds|locked entries)\b/);
 assert.match(embed.footer.text,/Automatic entry.*#99439011.*forget to opt in/i);
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
 const exactOneOff=activityOneOffListingEmbed({
   _id:planId,title:"Exact phrase test",prize:"Pet",winnerCount:1,
   activityRequiredPhrase:"Thank You",activityMinTotalMessages:2,
   endsAt:new Date("2026-11-11T19:00:00Z"),
 }).toJSON();
 assert.match(exactOneOff.description,/exact phrase \*\*Thank You\*\*/);
 assert.match(exactOneOff.description,/Spelling and word order must match; capitals do not matter/);
});
test("active plan publishes a member-facing directory listing to list channel, not winners channel",async()=>{
 const old=[GuildConfig.findOne,GiveawayWatchRule.findOne,GiveawayPlan.updateOne];
 const sent=[],updates=[],fetched=[];
 try {
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
    activityGiveawayListChannelId:listId,activityGiveawayWinnersChannelId:winnersId,
    giveawayPingRoleId:"567890123456789012"})})});
  GiveawayWatchRule.findOne=()=>({lean:async()=>rule});
  GiveawayPlan.updateOne=async (_query,update)=>{updates.push(update.$set);return {modifiedCount:1}};
  const channel={id:listId,messages:{fetch:async()=>({find:()=>null})},
    send:async payload=>{sent.push(payload);return {id:"678901234567890123"}}};
  const client={user:{id:"bot"},channels:{fetch:async id=>{fetched.push(id);return channel;}}};
  assert.equal(await publishActivityPlanListing(client,plan),true);
  assert.deepEqual(fetched,[listId]);
  assert.equal(sent.length,1);
  assert.equal(sent[0].content,"<@&567890123456789012>");
  assert.deepEqual(sent[0].allowedMentions,{parse:[],roles:["567890123456789012"]});
  assert.match(sent[0].embeds[0].toJSON().description,/50 messages/);
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
 assert.match(guided.description,/5 messages/);
 assert.match(guided.description,/Tag <@123456789012345678>/);
 assert.match(guided.description,/cozy community challenge/);
 assert.match(guided.description,/Ends and draws/);
 assert.doesNotMatch(guided.description,/1\+ characters|locked entries|autoReroll|criteriaVersion|Activity Giveaway ID/);
 assert.match(guided.footer.text,/forget to opt in/i);
 assert.ok(guided.footer.text.length<90);
 const advanced=activityOneOffListingEmbed({
   _id:"507f1f77bcf86cd799439014",guidedSeries:"507f1f77bcf86cd799439015",
   title:"Weekly Event",prize:"Pet",activityMinTotalMessages:10,
   activityChannelIds:[],activityDays:3,activityMinimum:1,activityMinChars:25,
   activityRequiredPhrase:"thank you",winnerCount:2,
 }).toJSON();
 assert.match(advanced.description,/10 messages/);
 assert.match(advanced.description,/3 different days/);
 assert.match(advanced.description,/25 characters/);
 assert.match(advanced.description,/thank you/);
 assert.doesNotMatch(advanced.description,/per active day/);
});

test("ended one-off activity poster stays on public list until staff uses Delete Listing",async()=>{
 const old={config:GuildConfig.findOne,update:Giveaway.updateOne};
 const edits=[],deleted=[],updates=[];
 const event={
   _id:planId,guildId,mode:"activity",status:"ended",
   title:"Finished activity",prize:"Special pet",winnerCount:1,
   winnerIds:["456789012345678901"],channelId:winnersId,
   endsAt:new Date("2026-11-08T18:00:00Z"),
   listChannelId:listId,listMessageId:"567890123456789012",
   listFingerprint:"previous",progressEnabled:true,
 };
 try{
   GuildConfig.findOne=()=>({
     giveawayDefaultBannerNameKey:"",
     select:()=>({lean:async()=>({
       activityGiveawayListChannelId:listId,activityGiveawayWinnersChannelId:winnersId,
     })}),
   });
   Giveaway.updateOne=async (_query,change)=>updates.push(change.$set);
   const existing={author:{id:"bot"},id:event.listMessageId,
     embeds:[{footer:{text:"#99439011"}}],edit:async p=>edits.push(p),
     delete:async()=>deleted.push("activity-list")};
   const channel={id:listId,messages:{fetch:async()=>existing},send:async()=>{throw Error("Should edit existing completed listing");}};
   const client={user:{id:"bot"},channels:{fetch:async()=>channel}};
   assert.equal(await publishActivityOneOffListing(client,event,{now:new Date("2026-11-09T14:00:00Z")}),true);
   assert.deepEqual(deleted,[],"ending must not automatically remove the public list entry");
   assert.equal(edits.length,1);
   assert.match(edits[0].embeds[0].data.description,/Giveaway ended/);
   assert.doesNotMatch(edits[0].embeds[0].data.description,/Qualify automatically|Draws <t:/);
   assert.equal(edits[0].components,undefined,"there must be no activity-progress button on a completed listing");
   assert.ok(updates.some(x=>x.listMessageId===event.listMessageId));
 }finally{
   GuildConfig.findOne=old.config;Giveaway.updateOne=old.update;
 }
});

test("new one-off activity giveaway pings only the shared role, even when old event roles differ",async()=>{
 const old={config:GuildConfig.findOne,update:Giveaway.updateOne};
 const sent=[],edits=[];
 const role="567890123456789012";
 const event={_id:"507f1f77bcf86cd799439030",guildId,
   mode:"activity",status:"open",title:"Shared role event",prize:"Pet",winnerCount:1,
   channelId:winnersId,endsAt:new Date("2026-11-12T19:00:00Z"),
   notificationRoleIds:["678901234567890123","789012345678901234"],
   listMessageId:"",listChannelId:"",progressEnabled:true,
 };
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
    activityGiveawayListChannelId:listId,activityGiveawayWinnersChannelId:winnersId,
    giveawayPingRoleId:role,activityNotificationRoleIds:["678901234567890123"],
  })})});
  Giveaway.updateOne=async()=>({});
  const posted={id:"890123456789012345",author:{id:"bot"},edit:async payload=>edits.push(payload)};
  const channel={id:listId,messages:{fetch:async v=>
    typeof v==="string"?posted:{find:()=>null}},
    send:async p=>{sent.push(p);return posted;}};
  const client={user:{id:"bot"},channels:{fetch:async()=>channel}};
  assert.equal(await publishActivityOneOffListing(client,event),true);
  assert.equal(sent.length,1);
  assert.equal(sent[0].content,"<@&"+role+">");
  assert.deepEqual(sent[0].allowedMentions,{parse:[],roles:[role]});
  // Edits must never ping the role again, including a change in the shared role.
  const existing={...event,listChannelId:listId,listMessageId:posted.id,listFingerprint:"old"};
  assert.equal(await publishActivityOneOffListing(client,existing),true);
  assert.equal(sent.length,1);
  assert.equal(edits.length,1);
  assert.equal(edits[0].content,undefined);
  assert.deepEqual(edits[0].allowedMentions,{parse:[]});
 }finally{GuildConfig.findOne=old.config;Giveaway.updateOne=old.update;}
});

test("ended activity poster stays published as No Eligible Winner for zero entrants or all forfeited claims",()=>{
  const shared={
    _id:planId,guildId,mode:"activity",status:"ended",title:"Unclaimed activity",
    prize:"Test-only pet",winnerCount:1,entrantIds:["234567890123456789"],
    activityPeriod:"daily",activityMinTotalMessages:1,activityChannelIds:[],
    endsAt:new Date("2026-11-09T19:00:00Z"),
    channelId:winnersId,listChannelId:listId,listMessageId:"567890123456789012",
  };
  const empty=activityOneOffListingEmbed({...shared,entrantIds:[],winnerIds:[]}).toJSON();
  assert.match(empty.description,/No eligible winner/i);
  assert.doesNotMatch(empty.description,/How to qualify|Activity:|Required role|Check My Progress/i);
  const forfeited=activityOneOffListingEmbed({...shared,
    winnerIds:["234567890123456789"],claimResolvedSlots:[0]}).toJSON();
  assert.match(forfeited.description,/No eligible winner/i);
  const pending=activityOneOffListingEmbed({...shared,
    winnerIds:["234567890123456789"],claimResolvedSlots:[]}).toJSON();
  assert.doesNotMatch(pending.description,/No eligible winner/i);
});
