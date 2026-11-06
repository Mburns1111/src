import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import { data as giveawayCommand, trialData as trialCommand } from "../commands/giveaway.js";
import {
  GIVEAWAY_MAX_MINUTES, chooseGiveawayWinners, giveawayAnnouncement,
  joinGiveaway, leaveGiveaway, closeGiveaway, rerollGiveaway,
} from "../services/giveaways.js";

const guildId="123456789012345678", userId="234567890123456789";
const id="507f1f77bcf86cd799439011";
const now=new Date("2026-11-01T12:00:00Z");
const snapshot=(overrides={})=>({
  _id:id,guildId,channelId:"345678901234567890",messageId:"456789012345678901",
  title:"Halloween Pet Giveaway",prize:"1st · Jester Dragon\n2nd · Copy Cat",
  creatorId:userId,endsAt:new Date("2026-11-01T13:00:00Z"),
  status:"open",entrantIds:[],winnerIds:[],winnerCount:2,
  rules:"Must be a server member",rerollHistory:[],renderVersion:0,...overrides,
});
const stub=(records,model,key,fn)=>{records.push([model,key,model[key]]);model[key]=fn;};
const restore=records=>{for(const [model,key,fn] of records.reverse())model[key]=fn;};

test("giveaway commands have staff gate and flexible prize, role, channel, and reroll controls",()=>{
 const spec=giveawayCommand.toJSON();
 assert.equal(spec.name,"giveaway");
 assert.equal(spec.default_member_permissions, String(32)); // ManageGuild
 const opts=spec.options;
 assert.deepEqual(opts.map(x=>x.name),["start","activity","watch-save","watch-list","watch-delete","edit-prize","end","reroll","list","entrants","plan-create","plan-list","plan-view","plan-edit","prize-add","prize-edit","prize-remove","prize-move"]);
 const start=opts[0].options.map(x=>x.name);
 for(const name of ["title","prize","minutes","winners","rules","role","claim_hours","claim_instructions"])
   assert.ok(start.includes(name));
 assert.ok(!start.includes("channel"), "standard events use the configured channel");
 const speed=trialCommand.toJSON().options.find(option=>option.name==="start").options.map(x=>x.name);
 assert.ok(!speed.includes("channel"), "survival trials use their own configured channel");
 assert.ok(speed.includes("claim_minutes"), "trials accept minute-based claim windows");
 assert.ok(!speed.includes("claim_hours"), "legacy hour input is no longer offered for new trials");
 assert.ok(speed.includes("claim_instructions"));
 assert.ok(Giveaway.schema.path("claimWindowHours"));
 assert.ok(Giveaway.schema.path("claimWindowMinutes"));
 assert.ok(Giveaway.schema.path("claimInstructions"));
 assert.ok(Giveaway.schema.path("claimStartedAt"));
 assert.ok(start.includes("claim_hours"), "regular giveaways still use hours");
 assert.ok(!start.includes("claim_minutes"));
 assert.equal(GIVEAWAY_MAX_MINUTES,20160);
});

test("announcement remains on completion with details, winners and audit trail",()=>{
 const open=giveawayAnnouncement(snapshot());
 assert.equal(open.components.length,1);
 assert.match(open.embeds[0].data.description,/Jester Dragon/);
 assert.match(open.embeds[0].data.description,/Rules/);
 assert.match(open.embeds[0].data.description,/Ends:/);
 const finished=giveawayAnnouncement(snapshot({
   status:"ended",entrantIds:[userId,"333333333333333333"],
   winnerIds:[userId,"333333333333333333"],
   rerollHistory:[{slot:0,previousId:"444444444444444444",replacementId:userId}],
 }));
 assert.equal(finished.components.length,1,"entry buttons are replaced by the winner ticket form");
 assert.equal(finished.components[0].components[0].data.label,"File Ticket Claim");
 const description=finished.embeds[0].data.description;
 assert.match(description,/Jester Dragon/);
 assert.match(description,/Reroll history/);
 assert.match(description,/<@444444444444444444>/);
 assert.match(description,/<@234567890123456789>/);
 assert.match(open.embeds[0].data.description,/fox whispers/i);
 assert.match(open.embeds[0].data.description,/pocket/i);
 assert.match(description,/fox cackles/i);
 assert.match(description,/pocket heist/i);
 assert.match(description,/Prize delivery is handled by the giveaway host/i);
 const oneWinner = giveawayAnnouncement(snapshot({status:"ended",winnerIds:[userId]}));
 assert.match(oneWinner.embeds[0].data.description,new RegExp(userId));
 assert.match(oneWinner.embeds[0].data.description,/sneaky helper/i);
 const nobody = giveawayAnnouncement(snapshot({status:"ended",winnerIds:[]}));
 assert.match(nobody.embeds[0].data.description,/no accomplice/i);
 assert.match(nobody.embeds[0].data.description,/no eligible entries/i);
});

test("random selection chooses distinct entrants, excludes past winners, and never overdraws",()=>{
 const picked=chooseGiveawayWinners(["A","A","B","C","D"],3,["B"]);
 assert.equal(picked.length,3);
 assert.equal(new Set(picked).size,3);
 assert.ok(!picked.includes("B"));
 assert.deepEqual(chooseGiveawayWinners(["A","A"],3),["A"]);
 assert.throws(()=>chooseGiveawayWinners(["A"],11));
});

test("entry and leave operations guard status and deadline and handle duplicate clicks",async()=>{
 const old=[];
 try{
  let n=0,entered=false;
  stub(old,Giveaway,"updateOne",async(query,update)=>{
   assert.equal(query.guildId,guildId);
   assert.equal(query.status,"open");
   assert.deepEqual(query.endsAt,{$gt:now});
   if(update.$addToSet) {n++;if(entered)return {modifiedCount:0};entered=true;return {modifiedCount:1};}
   if(update.$pull){if(!entered)return {modifiedCount:0};entered=false;return {modifiedCount:1};}
   throw Error("unexpected change");
  });
  stub(old,Giveaway,"findOne",()=>({select:()=>({lean:async()=>snapshot({entrantIds:entered?[userId]:[]})})}));
  assert.equal(await joinGiveaway({id,guildId,userId,now}),"joined");
  assert.equal(await joinGiveaway({id,guildId,userId,now}),"already");
  assert.equal(await leaveGiveaway({id,guildId,userId,now}),"left");
  assert.equal(await leaveGiveaway({id,guildId,userId,now}),"not-entered");
  assert.equal(n,2);
 }finally{restore(old);}
});

test("closing a giveaway commits winners once and keeps finished results unchanged on retry",async()=>{
 const old=[];
 try{
  let stored=snapshot({entrantIds:[userId,"333333333333333333","444444444444444444"]});
  stub(old,Giveaway,"findOneAndUpdate",(filter,update)=>({
    lean:async()=>{
      if(stored.status!==filter.status)return null;
      if(update.$set.status==="closing"){
        stored={...stored,status:"closing"};
      }else if(update.$set.status==="ended"){
        stored={...stored,status:"ended",winnerIds:update.$set.winnerIds,renderVersion:stored.renderVersion+1,renderedAt:null};
      }else throw Error("unexpected transition");
      return {...stored};
    },
  }));
  stub(old,Giveaway,"findOne",()=>({lean:async()=>({...stored})}));
  const result=await closeGiveaway({id,guildId,now});
  assert.equal(result.status,"ended");
  assert.equal(result.winnerIds.length,2);
  assert.equal(new Set(result.winnerIds).size,2);
  const again=await closeGiveaway({id,guildId,now});
  assert.deepEqual(again.winnerIds,result.winnerIds);
  assert.equal(again.renderVersion,1);
 }finally{restore(old);}
});

test("reroll selects a new entrant without erasing earlier winner or reroll history",async()=>{
 const old=[];
 const prior=userId,replacement="444444444444444444";
 let stored=snapshot({status:"ended",entrantIds:[prior,replacement],winnerCount:1,winnerIds:[prior]});
 try{
  stub(old,Giveaway,"findOne",()=>({lean:async()=>({...stored})}));
  stub(old,Giveaway,"findOneAndUpdate",(filter,update)=>({lean:async()=>{
    if(filter.status!==stored.status)return null;
    if(update.$set.status==="rerolling")stored={...stored,...update.$set};
    else {
      stored={...stored,...update.$set,rerollHistory:[...stored.rerollHistory,update.$push.rerollHistory],renderVersion:stored.renderVersion+1};
    }
    return {...stored};
  }}));
  const result=await rerollGiveaway({id,guildId,staffId:prior,slot:0});
  assert.deepEqual(result.winnerIds,[replacement]);
  assert.equal(result.status,"ended");
  assert.deepEqual([result.rerollHistory[0].previousId,result.rerollHistory[0].replacementId],[prior,replacement]);
  await assert.rejects(()=>rerollGiveaway({id,guildId,staffId:prior,slot:0}),/no unused entrants/i);
 }finally{restore(old);}
});

test("giveaway claim instructions announce a real Discord-local deadline and how to schedule ticket pickup", () => {
  const ended = giveawayAnnouncement(snapshot({
    status: "ended", winnerIds: [userId],
    claimWindowHours: 48, claimStartedAt: new Date("2026-11-01T12:00:00Z"),
    claimInstructions: "Please include your Roblox username.",
  }));
  const body = ended.embeds[0].data.description;
  assert.match(body, /Claim deadline:/);
  assert.match(body, /<t:1793707200:F>/); // 48h after 2026-11-01 12:00 UTC
  assert.match(body, /https:\/\/hammertime\.cyou/);
  assert.match(body, /Open a support ticket/i);
  assert.match(body, /2–3 dates\/times/);
  assert.match(body, /Roblox username/);
  assert.deepEqual(ended.allowedMentions, { parse: [] });
  const signup = giveawayAnnouncement(snapshot({ claimWindowHours: 48, claimInstructions: "Include Roblox name" }));
  assert.match(signup.embeds[0].data.description, /Claim window:.*48 hours/);
  assert.doesNotMatch(signup.embeds[0].data.description, /Claim deadline/);
  const none = giveawayAnnouncement(snapshot({ status: "ended", winnerIds: [] }));
  assert.doesNotMatch(none.embeds[0].data.description, /Open a support ticket/i);
});
