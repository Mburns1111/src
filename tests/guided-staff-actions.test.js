import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Giveaway from "../models/Giveaway.js";
import {activityRoster,GuidedActivitySeries,resetGuidedActivityCriteria} from "../services/guided-activity.js";
import {GUIDED_EDIT_FIELDS,validateGuidedStaffEdit,describeGuidedStaffOptions,
  updateGuidedRepeatSchedule,handleGuidedStaffAction} from "../services/guided-staff-actions.js";

const guildId="123456789012345678",channelId="234567890123456789";
const eventId="507f1f77bcf86cd799439011";
const event={
  _id:eventId,guildId,staffCardChannelId:channelId,staffCardId:"345678901234567890",
  guidedSeries:"507f1f77bcf86cd799439012",status:"open",
  title:"Weekly pet giveaway",prize:"Pet",activityType:"general",activityChannelIds:[],
  activityStartAt:new Date("2027-01-01T00:00:00Z"),
  activityEndAt:new Date("2027-01-10T00:00:00Z"),
  endsAt:new Date("2027-01-10T01:00:00Z"),
  activityMinTotalMessages:10,activityMinimum:1,activityDays:2,
  progressEnabled:true,requireStaffReview:false,roleBonuses:[],
};

test("staff editor includes all creation settings plus clear editing guidance",()=>{
  const values=GUIDED_EDIT_FIELDS.map(field=>field.value);
  for(const name of [
    "title","prize","description","winnerCount","activityMinTotalMessages",
    "activityDays","activityEndAt","endsAt","requireStaffReview","progressEnabled",
    "roleBonuses","claimWindowHours","bannerNameKey","activityChannelIds",
    "activityRequiredMentionUserId","activityRequiredPhrase","repeatSchedule","activityStartAt"
  ])assert.ok(values.includes(name),name);
  assert.ok(values.length<=25,"Discord permits at most 25 select choices");
  assert.match(describeGuidedStaffOptions(event),/Manual approval/);
  assert.match(describeGuidedStaffOptions(event),/Future repeats/);
  assert.match(describeGuidedStaffOptions(event),/RESET/);
});

test("edit values validate counts, dates, announcements, filters, and recurrence",()=>{
  const now=new Date("2027-01-02T00:00:00Z");
  const check=(field,value)=>validateGuidedStaffEdit(field,value,event,{now});
  assert.deepEqual(check("title","Flower contest"),{title:"Flower contest"});
  assert.deepEqual(check("description",""),{description:""});
  assert.deepEqual(check("winnerCount","3"),{winnerCount:3});
  assert.deepEqual(check("activityMinTotalMessages","12"),{activityMinTotalMessages:12});
  assert.deepEqual(check("activityDays","3"),{activityDays:3});
  assert.deepEqual(check("requireStaffReview","on"),{requireStaffReview:true});
  assert.deepEqual(check("progressEnabled","off"),{progressEnabled:false});
  assert.deepEqual(check("roleBonuses","<@&"+channelId+"> 2"),
    {roleBonuses:[{roleId:channelId,extraEntries:2}]});
  assert.deepEqual(check("roleBonuses","clear"),{roleBonuses:[]});
  assert.deepEqual(check("activityChannelIds","<#"+channelId+">"),
    {activityChannelIds:[channelId],activityType:"channels"});
  assert.deepEqual(check("activityChannelIds","all"),
    {activityChannelIds:[],activityType:"general"});
  assert.deepEqual(check("activityRequiredMentionUserId","<@"+channelId+">"),
    {activityRequiredMentionUserId:channelId});
  assert.deepEqual(check("activityRequiredPhrase","thank you"),{activityRequiredPhrase:"thank you"});
  assert.deepEqual(check("repeatSchedule","every 14 days"),
    {repeat:"custom",amount:14,unit:"days",interval:20160});
  assert.deepEqual(check("repeatSchedule","once"),{repeat:"once"});
  assert.ok(check("activityEndAt","2027-01-08 12:30").activityEndAt instanceof Date);
  assert.ok(check("endsAt","2027-01-11 12:30").endsAt instanceof Date);
  assert.throws(()=>check("endsAt","2027-01-05 12:00"),/before counting ends/);
  assert.throws(()=>check("winnerCount","0"),/whole number/);
  assert.throws(()=>check("activityStartAt","2026-12-31 09:00"),/cannot be edited/);
  assert.throws(()=>check("roleBonuses","<@&"+channelId+"> 21"),/between 1 and 20/);
});

test("changing watched criteria requires an explicit RESET input",async()=>{
  const original=Giveaway.findOne;
  try{
    Giveaway.findOne=()=>({lean:async()=>({...event})});
    let modal;
    await handleGuidedStaffAction({
      guildId,channelId,customId:"activitystaff:select:"+eventId,
      values:["activityRequiredPhrase"],memberPermissions:{has:()=>true},
      showModal:async m=>{modal=m.toJSON();},
    });
    assert.equal(modal.components.length,2);
    assert.equal(modal.components[0].components[0].custom_id,"value");
    assert.equal(modal.components[1].components[0].custom_id,"reset");
  }finally{Giveaway.findOne=original;}
});

test("criteria reset filters existing receipts by message timestamp",async()=>{
  const findOriginal=Giveaway.findOneAndUpdate;
  const Receipt=mongoose.models.GuidedActivityReceipt;
  const aggregateOriginal=Receipt.aggregate;
  let changed,aggregateMatch;
  try{
    Giveaway.findOneAndUpdate=(_query,update)=>({lean:async()=>{
      changed=update.$set;
      return {...event,...changed};
    }});
    const updated=await resetGuidedActivityCriteria(event,
      {activityRequiredPhrase:"grateful"},new Date("2027-01-02T00:00:00Z"));
    assert.equal(updated.activityRequiredPhrase,"grateful");
    assert.equal(+changed.activityStartAt,+new Date("2027-01-02T00:00:00Z"));
    assert.equal(+changed.activityResetAt,+changed.activityStartAt);
    Receipt.aggregate=async pipeline=>{aggregateMatch=pipeline[0].$match;return [];};
    await activityRoster(updated);
    assert.equal(+aggregateMatch.at.$gte,+changed.activityResetAt);
  }finally{
    Giveaway.findOneAndUpdate=findOriginal;
    Receipt.aggregate=aggregateOriginal;
  }
});

test("future-repeat edits change only the series schedule",async()=>{
  const findOriginal=GuidedActivitySeries.findOne;
  const updateOriginal=GuidedActivitySeries.updateOne;
  let saved;
  try{
    GuidedActivitySeries.findOne=()=>({lean:async()=>({
      _id:event.guidedSeries,guildId,settings:{repeat:"weekly",period:"24 hours",hours:24}
    })});
    GuidedActivitySeries.updateOne=async (_filter,update)=>{saved=update.$set;};
    const result=await updateGuidedRepeatSchedule(event,
      {repeat:"custom",amount:14,unit:"days",interval:20160},
      {now:new Date("2027-01-02T00:00:00Z")});
    assert.equal(result.enabled,true);
    assert.equal(saved.settings.repeat,"custom");
    assert.ok(new Date(saved.nextStart)>new Date(event.activityEndAt));
    const disabled=await updateGuidedRepeatSchedule(event,{repeat:"once"});
    assert.equal(disabled.enabled,false);
    assert.equal(saved.enabled,false);
  }finally{
    GuidedActivitySeries.findOne=findOriginal;
    GuidedActivitySeries.updateOne=updateOriginal;
  }
});
