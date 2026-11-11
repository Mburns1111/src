import test from "node:test";
import assert from "node:assert/strict";
import {MessageFlags} from "discord.js";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import {
  giveawayStaffRecordPayload,giveawayStaffStatusMarker,
  giveawayStaffEntrantsPage,handleGiveawayStaffAction,STAFF_ENTRANTS_PER_PAGE
} from "../services/giveaway-staff-records.js";
import {giveawayAnnouncement} from "../services/giveaways.js";
import {activityOneOffListingEmbed} from "../services/giveaway-directory.js";

const guildId="123456789012345678",staffChannelId="234567890123456789";
const staffCardId="345678901234567890",giveawayId="507f1f77bcf86cd799439011";
const entrants=Array.from({length:61},(_,i)=>String(400000000000000000n+BigInt(i)));
const first=entrants[0],second=entrants[1];
const ticket=(slot,userId)=>({slot,userId,ticketNumber:"ticket-"+slot,submittedAt:new Date()});
const record=(opts={})=>({
  _id:giveawayId,guildId,creatorId:first,staffCardChannelId:staffChannelId,
  staffCardId,mode:"standard",status:"open",title:"Staff test giveaway",
  prize:"Example prize",entrantIds:entrants,winnerIds:[],
  winnerCount:2,claimWindowHours:12,
  endsAt:new Date("2026-11-10T01:00:00Z"),claimStartedAt:new Date("2026-11-10T01:00:00Z"),
  winnerAssignedAt:[new Date("2026-11-10T01:00:00Z"),new Date("2026-11-10T01:00:00Z")],
  winnerClaims:[],claimResolvedSlots:[],autoRerollClaims:true,maxAutoRerolls:2,
  ...opts
});
const buttons=p=>p.components.flatMap(r=>r.components).map(b=>b.data.custom_id);

test("active giveaways, activity review and running Trials show blue status, never claim colors",()=>{
  for(const [mode,status] of [
    ["standard","open"],["activity","open"],["activity","pending_review"],
    ["activity","closing"],["survival","open"],["survival","preparing"],["survival","running"]
  ]){
    const current=record({mode,status});
    const payload=giveawayStaffRecordPayload(current);
    const json=payload.embeds[0].toJSON();
    assert.match(giveawayStaffStatusMarker(current).title,/🟦 IN PROGRESS/);
    assert.match(json.title,/🟦 IN PROGRESS/);
    assert.match(json.description,/🟦.*GIVEAWAY IN PROGRESS/);
    assert.doesNotMatch(json.description,/🟨|🟩|🟥/);
    assert.equal(json.color,0x3498DB);
    assert.ok(buttons(payload).includes("giveawaystaff:entrants:"+giveawayId+":0"));
  }
});

test("staff claim status markers distinguish pending yellow, completed green and no winner red",()=>{
  for(const mode of ["standard","activity","survival"]){
    const claimSettings={mode,trialTicketClaimsEnabled:mode==="survival",status:"ended",
      winnerIds:[first],winnerCount:1};
    const pending=record(claimSettings);
    const pendingPayload=giveawayStaffRecordPayload(pending).embeds[0].toJSON();
    assert.match(pendingPayload.title,/🟨 CLAIM PENDING/);
    assert.match(pendingPayload.description,/🟨.*WINNER CLAIM PENDING/);
    assert.equal(pendingPayload.color,0xF1C40F);

    const complete=record({...claimSettings,winnerClaims:[ticket(0,first)]});
    const completePayload=giveawayStaffRecordPayload(complete).embeds[0].toJSON();
    assert.match(completePayload.title,/🟩 CLAIM COMPLETED/);
    assert.match(completePayload.description,/🟩.*CLAIM COMPLETED/);
    assert.equal(completePayload.color,0x2ECC71);

    const empty=record({...claimSettings,winnerIds:[]});
    const emptyPayload=giveawayStaffRecordPayload(empty).embeds[0].toJSON();
    assert.match(emptyPayload.title,/🟥 NO ELIGIBLE WINNER/);
    assert.match(emptyPayload.description,/🟥.*NO ELIGIBLE WINNER/);
    assert.equal(emptyPayload.color,0xE74C3C);

    const forfeited=record({...claimSettings,claimResolvedSlots:[0]});
    assert.match(giveawayStaffRecordPayload(forfeited).embeds[0].toJSON().title,/🟥 NO ELIGIBLE WINNER/);
  }
});

test("deleted completed listings are gray regardless of previous red, yellow or green claim status",()=>{
  const deletedAt=new Date("2026-11-12T12:00:00Z");
  for(const mode of ["standard","activity","survival"]){
    const base={mode,trialTicketClaimsEnabled:mode==="survival",status:"ended",
      winnerIds:[first],winnerCount:1,publicListingRemovedAt:deletedAt,
      publicListingRemovedBy:second};
    for(const claims of [
      {winnerClaims:[]}, // claim previously pending
      {winnerClaims:[ticket(0,first)]}, // claim was completed
      {winnerClaims:[],claimResolvedSlots:[0]}, // no eligible winner
      {winnerIds:[],winnerClaims:[]}, // nobody entered
    ]){
      const archived=record({...base,...claims});
      const payload=giveawayStaffRecordPayload(archived,{archived:true});
      const embed=payload.embeds[0].toJSON();
      assert.match(embed.title,/⬜ ARCHIVED/);
      assert.match(embed.description,mode==="survival"
        ?/⬜.*COURT'S TRIAL ARCHIVED — ROYAL VERDICT PRESERVED/
        :/⬜.*COMPLETED — PUBLIC LISTING DELETED/);
      assert.doesNotMatch(embed.description,/🟦|🟨|🟩|🟥/);
      assert.equal(embed.color,0x777777);
      assert.match(embed.description,mode==="survival"
        ?/Trial archived — Royal Verdict preserved/
        :/Completed — public listing deleted/);
      assert.ok(buttons(payload).includes("giveawaystaff:entrants:"+giveawayId+":0"));
      assert.ok(!buttons(payload).some(x=>x.includes(":remove:")));
    }
  }
});

test("cancelled giveaway archives are gray even if unclaimed winners are in their history",()=>{
  for(const mode of ["standard","activity","survival"]){
    const cancelled=record({mode,status:"cancelled",winnerIds:[first],
      staffCancelReason:"Test cancellation",staffCancelledBy:second});
    const embed=giveawayStaffRecordPayload(cancelled).embeds[0].toJSON();
    assert.match(embed.title,/⬜ CANCELLED/);
    assert.match(embed.description,/⬜.*CANCELLED — PUBLIC LISTING REMOVED/);
    assert.equal(embed.color,0x777777);
    assert.doesNotMatch(embed.description,/🟦|🟨|🟩|🟥/);
  }
});

test("multi-winner staff marker stays yellow while one winner is pending, green when all are settled",()=>{
  const pending=record({status:"ended",winnerIds:[first,second],
    winnerClaims:[ticket(0,first)]});
  assert.match(giveawayStaffStatusMarker(pending).title,/🟨/);
  const both=record({...pending,winnerClaims:[ticket(0,first),ticket(1,second)]});
  assert.match(giveawayStaffStatusMarker(both).title,/🟩/);
  const partial=record({...pending,claimResolvedSlots:[1]});
  assert.match(giveawayStaffStatusMarker(partial).title,/🟩/);
  const trialLegacy=record({mode:"survival",status:"ended",winnerIds:[first],
    trialTicketClaimsEnabled:false});
  assert.match(giveawayStaffStatusMarker(trialLegacy).title,/🟨 STAFF CLAIM FOLLOW-UP/);
});

test("staff entrant pages show 25 names, Discord IDs and pagination privately",()=>{
  const large=record();
  const p0=giveawayStaffEntrantsPage(large,0);
  assert.match(p0.content,/Total:\*\* 61/);
  assert.match(p0.content,new RegExp(first));
  assert.doesNotMatch(p0.content,new RegExp(entrants[25]));
  assert.deepEqual(buttons(p0),["giveawaystaff:entrants:"+giveawayId+":1"]);
  assert.deepEqual(p0.allowedMentions,{parse:[]});
  const p1=giveawayStaffEntrantsPage(large,1);
  assert.deepEqual(buttons(p1),[
    "giveawaystaff:entrants:"+giveawayId+":0",
    "giveawaystaff:entrants:"+giveawayId+":2"
  ]);
  const p2=giveawayStaffEntrantsPage(large,2);
  assert.match(p2.content,new RegExp(entrants[60]));
  assert.deepEqual(buttons(p2),["giveawaystaff:entrants:"+giveawayId+":1"]);
  assert.equal(STAFF_ENTRANTS_PER_PAGE,25);
  assert.throws(()=>giveawayStaffEntrantsPage(large,3),/no longer available/);
  const empty=giveawayStaffEntrantsPage(record({entrantIds:[]}),0);
  assert.match(empty.content,/No members have entered/);
  assert.deepEqual(empty.components,[]);
  const activeActivity=giveawayStaffEntrantsPage(record({mode:"activity",entrantIds:[]}),0);
  assert.match(activeActivity.content,/Preview qualifying members/);
});

test("View Entrants opens privately; navigation uses ephemeral update and requires staff role",async()=>{
  const prior=Giveaway.findOne;
  const priorConfig=GuildConfig.findOne;
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({giveawayManagerRoleId:""})})});
  const calls=[];
  const current=record();
  Giveaway.findOne=()=>({lean:async()=>current});
  const base={
    guildId,channelId:staffChannelId,user:{id:first},client:{user:{id:"bot"}},
    memberPermissions:{has:()=>true},
    reply:async payload=>calls.push({kind:"reply",payload}),
    update:async payload=>calls.push({kind:"update",payload}),
  };
  try{
    await handleGiveawayStaffAction({...base,
      customId:"giveawaystaff:entrants:"+giveawayId+":0",
      message:{id:staffCardId}});
    assert.equal(calls[0].kind,"reply");
    assert.equal(calls[0].payload.flags,MessageFlags.Ephemeral);
    assert.match(calls[0].payload.content,/61/);
    const ephemeral={id:"999999999999999999",author:{id:"bot"},
      flags:{has:flag=>flag===MessageFlags.Ephemeral}};
    await handleGiveawayStaffAction({...base,
      customId:"giveawaystaff:entrants:"+giveawayId+":1",message:ephemeral});
    assert.equal(calls[1].kind,"update");
    assert.match(calls[1].payload.content,new RegExp(entrants[25]));
    await handleGiveawayStaffAction({...base,
      customId:"giveawaystaff:entrants:"+giveawayId+":0",message:ephemeral});
    assert.equal(calls[2].kind,"update","returning to page 1 must not prompt a new reply");
    await handleGiveawayStaffAction({...base,
      customId:"giveawaystaff:entrants:"+giveawayId+":0",
      message:{id:"111111111111111111"}});
    assert.match(calls[3].payload.content,/current staff record/);
    await handleGiveawayStaffAction({...base,
      memberPermissions:{has:()=>false},
      customId:"giveawaystaff:entrants:"+giveawayId+":0",
      message:{id:staffCardId}});
    assert.match(calls[4].payload.content,/Manage Server|Giveaway Manager/);
  }finally{Giveaway.findOne=prior;GuildConfig.findOne=priorConfig;}
});

test("no-winner public results are short, preserve the prize, and never expose old claim history",()=>{
  for(const mode of ["standard","activity"]){
    for(const options of [{entrantIds:[],winnerIds:[]},
      {entrantIds:[first],winnerIds:[first],claimResolvedSlots:[0]}]){
      const example=record({mode,status:"ended",
        description:"A long description that should not remain after the giveaway ends",
        rules:"All entrants must have a role",
        requiredRoleInstructions:"Go to #roles",...options});
      const output=giveawayAnnouncement(example);
      const embed=output.embeds[0].toJSON();
      assert.match(embed.title,/No Eligible Winner/);
      assert.match(embed.description,/No eligible winner/);
      assert.match(embed.description,/Example prize/);
      assert.doesNotMatch(embed.description,/A long description|All entrants|Reroll history|Ticket claim|Forfeit deadline|Claiming your prize|How to claim/i);
      assert.ok(embed.description.length<450,"public no-winner notice should be concise");
      assert.equal(output.components.length,0);
      assert.equal((embed.fields||[]).length,0);
      if(mode==="activity"){
        const publicList=activityOneOffListingEmbed(example).toJSON();
        assert.match(publicList.description,/No eligible winner/);
        assert.doesNotMatch(publicList.description,/How to qualify|A long description|All entrants/);
        assert.ok(publicList.description.length<350);
      }
    }
  }
});
