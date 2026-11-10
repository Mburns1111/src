import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import {MessageFlags} from "discord.js";
import {giveawayStaffRecordPayload,handleGiveawayStaffAction} from "../services/giveaway-staff-records.js";
import {giveawayStaffEditMenuOptions,validateGiveawayStaffEdit,giveawayStaffEditModal} from "../services/giveaway-staff-edit.js";

const guildId="123456789012345678",staffId="234567890123456789",
  messageId="345678901234567890",userId="456789012345678901";
const id="507f1f77bcf86cd799439011";
const example=(x={})=>({
  _id:id,guildId,staffCardChannelId:staffId,staffCardId:messageId,
  status:"open",mode:"standard",creatorId:userId,
  title:"Private staff actions",prize:"Test pet",winnerCount:1,
  entrantIds:[userId],winnerIds:[],winnerClaims:[],claimResolvedSlots:[],
  autoRerollClaims:true,maxAutoRerolls:2,
  claimWindowHours:12,endsAt:new Date(Date.now()+3600000),renderVersion:0,
  ...x,
});
const controls=p=>p.components.flatMap(row=>row.components).map(btn=>btn.data);

test("all relevant staff records offer End Early or guided End Early and Edit, never new slash commands",()=>{
 const regular=controls(giveawayStaffRecordPayload(example()));
 assert.ok(regular.some(x=>x.label==="Edit Giveaway"));
 assert.ok(regular.some(x=>x.label==="End Early"));
 const trial=controls(giveawayStaffRecordPayload(example({mode:"survival"})));
 assert.ok(trial.some(x=>x.label==="Edit Giveaway"));
 assert.ok(trial.some(x=>x.label==="Start Trial Early"));
 const running=controls(giveawayStaffRecordPayload(example({mode:"survival",status:"running"})));
 assert.ok(running.some(x=>x.label==="Finish Trial Early"));
 const activity=controls(giveawayStaffRecordPayload(example({mode:"activity",guidedSeries:id})));
 assert.ok(activity.some(x=>x.custom_id==="activitystaff:edit:"+id));
 assert.ok(activity.some(x=>x.custom_id==="activitystaff:end:"+id));
 const legacy=controls(giveawayStaffRecordPayload(example({mode:"activity"})));
 assert.ok(legacy.some(x=>x.label==="Edit Giveaway"));
 assert.ok(legacy.some(x=>x.label==="End Early"));
});

test("private staff controls offer manual rerolls only while waiting on ticket claims",()=>{
 const pending=controls(giveawayStaffRecordPayload(example({
   status:"ended",winnerIds:[userId],claimStartedAt:new Date(),
   winnerAssignedAt:[new Date()],
 })));
 assert.ok(pending.some(x=>x.label==="Manual Reroll"));
 const claimed=controls(giveawayStaffRecordPayload(example({
   status:"ended",winnerIds:[userId],claimStartedAt:new Date(),
   winnerClaims:[{slot:0,userId,ticketNumber:"abc",submittedAt:new Date(),
     ticketUrl:"https://discord.com/channels/"+guildId+"/"+staffId+"/"+messageId}]
 })));
 assert.ok(!claimed.some(x=>x.label==="Manual Reroll"));
 assert.ok(claimed.some(x=>x.label==="Delete Listing"));
 const archive=controls(giveawayStaffRecordPayload(example({
   mode:"survival",status:"ended",trialTicketClaimsEnabled:false,
   winnerIds:[userId],originalChampionId:userId
 })));
 assert.ok(archive.some(x=>x.label==="Archive Trial"));
 assert.ok(!archive.some(x=>x.label==="Delete Listing"));
 const archived=controls(giveawayStaffRecordPayload(example({
   mode:"survival",status:"ended",publicListingRemovedAt:new Date(),
   winnerIds:[userId]
 })));
 assert.ok(!archived.some(x=>x.label==="Archive Trial"));
});

test("staff-only edits support custom long durations, winners and claim instructions",()=>{
 const regular=example();
 const fields=giveawayStaffEditMenuOptions(regular).map(x=>x.value);
 for(const item of ["title","prize","description","rules","winnerCount",
   "durationMinutes","claimWindowHours","claimInstructions","bannerNameKey"])
   assert.ok(fields.includes(item),item);
 assert.equal(validateGiveawayStaffEdit(regular,"winnerCount","3").winnerCount,3);
 assert.equal(validateGiveawayStaffEdit(regular,"claimWindowHours","24").claimWindowHours,24);
 assert.equal(validateGiveawayStaffEdit(regular,"bannerNameKey","default").bannerNameKey,"");
 const now=new Date("2026-11-09T12:00:00Z");
 const changed=validateGiveawayStaffEdit(regular,"durationMinutes","14400",{now});
 assert.equal(+changed.endsAt,+now+14400*60000);
 assert.throws(()=>validateGiveawayStaffEdit(regular,"durationMinutes","999999",{now}),/up to six calendar months/);
 assert.throws(()=>validateGiveawayStaffEdit(regular,"winnerCount","11"),/whole number/);
 assert.match(giveawayStaffEditModal(regular,"claimInstructions").toJSON().custom_id,/editsave/);
 assert.ok(!giveawayStaffEditMenuOptions(example({status:"ended"})).length);
 assert.ok(!giveawayStaffEditMenuOptions(example({guidedSeries:id})).length);
 const trialFields=giveawayStaffEditMenuOptions(example({mode:"survival"})).map(x=>x.value);
 assert.ok(trialFields.includes("claimWindowMinutes"));
 assert.ok(!trialFields.includes("claimWindowHours"));
});

test("ticket number, link and submission timestamp appear once in dedicated staff fields, never duplicated",()=>{
 const url="https://discord.com/channels/"+guildId+"/"+staffId+"/"+messageId;
 const data=example({status:"ended",winnerIds:[userId],
  winnerClaims:[{slot:0,userId,ticketNumber:"TEST-123",ticketUrl:url,submittedAt:new Date()}]});
 const embed=giveawayStaffRecordPayload(data).embeds[0].toJSON();
 assert.doesNotMatch(embed.description,/TEST-123|https:\/\/discord\.com/);
 assert.equal(embed.fields.length,1);
 assert.match(embed.fields[0].value,/TEST-123/);
 assert.match(embed.fields[0].value,/Discord message/);
});

test("End Early staff button requires confirmation and manual reroll selector hides claimed places",async()=>{
 const prior=Giveaway.findOne;
 const input=example({status:"ended",winnerIds:[userId,"567890123456789012"],
   winnerClaims:[{slot:0,userId,ticketNumber:"x",submittedAt:new Date()}]});
 const answers=[];
 try{
  Giveaway.findOne=()=>({lean:async()=>input});
  const handler=async customId=>handleGiveawayStaffAction({
    customId,guildId,channelId:staffId,user:{id:userId},
    memberPermissions:{has:()=>true},message:{id:messageId},
    reply:async payload=>answers.push(payload),client:{user:{id:"bot"}},
  });
  await handler("giveawaystaff:reroll:"+id);
  assert.equal(answers[0].flags,MessageFlags.Ephemeral);
  const selector=answers[0].components[0].components[0].toJSON();
  assert.equal(selector.options.length,1);
  assert.equal(selector.options[0].value,"1");
  input.status="open";
  input.winnerIds=[];
  await handler("giveawaystaff:end:"+id);
  assert.match(answers[1].content,/End this giveaway now/);
  assert.ok(answers[1].components.some(r=>r.components.some(b=>b.data.custom_id==="giveawaystaff:confirmend:"+id)));
 }finally{Giveaway.findOne=prior;}
});
