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
 assert.equal(spec.default_member_permissions, undefined); // Discord permits the role; the bot gates staff actions
 const opts=spec.options;
 assert.deepEqual(opts.map(x=>x.name),["start","activity","list","banner"],
   "staff management is through staff record buttons, not slash commands");
 const banner=opts.find(x=>x.name==="banner");
 assert.deepEqual(banner.options.map(x=>x.name),["save","list","default","clear","remove"]);
 assert.equal(banner.type,2,"nested banner operations must be in a Discord subcommand group");
 assert.ok(!opts.some(x=>x.name.startsWith("banner-")),"banner commands no longer clutter the top-level list");
 const start=opts[0];
 assert.deepEqual(start.options||[],[],"regular giveaway fields belong in the guided channel wizard");
 assert.match(start.description,/guided setup/i);
 assert.ok(!opts.some(x=>/^plan-|^prize-(add|edit|remove|move)$/.test(x.name)),
   "old plan/prize editing subcommands must not clutter /giveaway");
 const speed=trialCommand.toJSON().options.find(option=>option.name==="start").options.map(x=>x.name);
 assert.ok(!speed.includes("channel"), "survival trials use their own configured channel");
 assert.ok(speed.includes("claim_minutes"), "trials accept minute-based claim windows");
 assert.ok(!speed.includes("claim_hours"), "legacy hour input is no longer offered for new trials");
 assert.ok(speed.includes("claim_instructions"));
 assert.ok(speed.includes("description"), "trials can include optional creator details");
 assert.ok(Giveaway.schema.path("claimWindowHours"));
 assert.ok(Giveaway.schema.path("claimWindowMinutes"));
 assert.ok(Giveaway.schema.path("claimInstructions"));
 assert.ok(Giveaway.schema.path("claimStartedAt"));
 assert.ok(Giveaway.schema.path("claimWindowHours"),"guided regular giveaways keep hour-based claims");
 assert.ok(!start.options?.some(x=>x.name==="claim_minutes"));
 assert.equal(GIVEAWAY_MAX_MINUTES,184*24*60,"absolute safe bound for six calendar months");
});

test("custom creator details are separate from prizes and requirements",()=>{
 const post=giveawayAnnouncement(snapshot({description:"Show us your favorite Adopt Me memory."}));
 const text=post.embeds[0].data.description;
 assert.match(text,/Giveaway Details/);
 assert.match(text,/Show us your favorite Adopt Me memory/);
 assert.match(text,/Jester Dragon/);
 assert.doesNotMatch(giveawayAnnouncement(snapshot({description:""})).embeds[0].data.description,/Giveaway Details/);
});
test("standard giveaway title preserves member and channel mentions",()=>{
 const post=giveawayAnnouncement(snapshot({title:"Tell <@123456789012345678> in <#234567890123456789>"}));
 assert.match(post.embeds[0].data.description,/<@123456789012345678>/);
 assert.match(post.embeds[0].data.description,/<#234567890123456789>/);
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
 assert.equal(finished.components[0].components[0].data.label,"Enter Ticket Claim info");
 const description=finished.embeds[0].data.description;
 assert.match(description,/Jester Dragon/);
 assert.doesNotMatch(description,/Reroll history/);
 assert.doesNotMatch(description,/<@444444444444444444>/,"former winner and reroll history must only be in private staff records");
 assert.match(description,/<@234567890123456789>/);
 assert.match(open.embeds[0].data.description,/fox whispers/i);
 assert.match(open.embeds[0].data.description,/pocket/i);
 assert.match(description,/fox cackles/i);
 assert.match(description,/pocket heist/i);
 assert.match(description,/Prize delivery is handled by the giveaway host/i);
 assert.doesNotMatch(description,/\*\*Winners \/ Results\*\*|\*\*Winner ticket claims\*\*/);
 const resultFields=finished.embeds[0].toJSON().fields.filter(field=>field.name==="🏆 Winners / Results");
 assert.equal(resultFields.length,1,"winners and claims should appear in one dedicated field");
 assert.equal(resultFields[0].value.split("\n").length,2);
 assert.match(resultFields[0].value,/Awaiting ticket claim/);
 const oneWinner = giveawayAnnouncement(snapshot({status:"ended",winnerIds:[userId]}));
 assert.match(oneWinner.embeds[0].data.description,new RegExp(userId));
 assert.match(oneWinner.embeds[0].data.description,/sneaky helper/i);
 const nobody = giveawayAnnouncement(snapshot({status:"ended",winnerIds:[]}));
 assert.match(nobody.embeds[0].data.description,/No eligible winner/i);
 assert.match(nobody.embeds[0].data.description,/No one entered or qualified/i);
 assert.ok(nobody.embeds[0].data.description.length<450);
});

test("Court's Trials reject staff and automatic rerolls on old records",async()=>{
 const original=Giveaway.findOne;
 try {
   Giveaway.findOne=()=>({lean:async()=>snapshot({
     mode:"survival",status:"ended",winnerIds:[userId],
     maxAutoRerolls:10,autoRerollClaims:true,trialTicketClaimsEnabled:true,
   })});
   for(const reason of ["staff","claim-expired"]){
     await assert.rejects(
       rerollGiveaway({id,guildId,staffId:userId,slot:0,reason}),
       /Court's Trials do not allow rerolls/
     );
   }
 }finally{Giveaway.findOne=original;}
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
  await assert.rejects(()=>rerollGiveaway({id,guildId,staffId:prior,slot:0}),/no unused (entrants|current server members)/i);
 }finally{restore(old);}
});

test("giveaway claim instructions announce a real Discord-local deadline and how to schedule ticket pickup", () => {
  const ended = giveawayAnnouncement(snapshot({
    status: "ended", winnerIds: [userId],
    claimWindowHours: 48, claimStartedAt: new Date("2026-11-01T12:00:00Z"),
    claimInstructions: "Please include your Roblox username.",
  }));
  const body = [ended.embeds[0].data.description,
    ...(ended.embeds[0].data.fields||[]).map(field=>field.value)].join("\n");
  assert.match(body, /Claim deadline:/);
  assert.match(body, /<t:1793707200:F>/); // 48h after 2026-11-01 12:00 UTC
  assert.match(body, /Roblox username/);
  assert.match(body, /Enter Ticket Claim info/);
  assert.match(body, /ticket number/);
  assert.match(body, /Discord message link/);
  assert.match(body, /FORFEIT YOUR WIN/);
  assert.doesNotMatch(body, /hammertime\.cyou/, "custom instructions replace the old template");
  assert.deepEqual(ended.allowedMentions, { parse: [] });
  const signup = giveawayAnnouncement(snapshot({ claimWindowHours: 48, claimInstructions: "Include Roblox name" }));
  assert.match(signup.embeds[0].data.description, /Claim window:.*48 hours/);
  assert.doesNotMatch(signup.embeds[0].data.description, /Claim deadline/);
  const none = giveawayAnnouncement(snapshot({ status: "ended", winnerIds: [] }));
  assert.doesNotMatch(none.embeds[0].data.description, /Open a support ticket/i);
});
