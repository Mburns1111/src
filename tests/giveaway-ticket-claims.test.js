import test from "node:test";
import assert from "node:assert/strict";
import { validateTicketClaim } from "../services/giveaway-ticket-claims.js";
import { nextClaimCheckAt, winnerClaimDeadline, winnerHasClaim, hasOutstandingTicketClaims, prizeClaimLines } from "../services/giveaway-claims.js";
import { giveawayAnnouncement } from "../services/giveaways.js";
const first="111111111111111111", second="222222222222222222";
const record={_id:"507f1f77bcf86cd799439011",guildId:"123456789012345678",mode:"standard",status:"ended",
  title:"Weekly prize",prize:"Diamond Egg",creatorId:first,winnerCount:2,endsAt:new Date("2026-11-06T12:00:00Z"),
  winnerIds:[first,second],entrantIds:[first,second],winnerAssignedAt:[new Date("2026-11-06T12:00:00Z"),new Date("2026-11-06T12:00:00Z")],
  claimWindowHours:24,claimStartedAt:new Date("2026-11-06T12:00:00Z"),autoRerollClaims:true,winnerClaims:[],
  claimResolvedSlots:[],rerollHistory:[]};
test("ticket validation requires HTTPS and a safe ticket number",()=>{
 assert.equal(validateTicketClaim("ticket-123","https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890").ticketNumber,"ticket-123");
 assert.throws(()=>validateTicketClaim("<@everyone>","https://example.com"),/ticket number/);
 assert.throws(()=>validateTicketClaim("123","javascript:alert(1)"),/Discord message link/);
});
test("per-winner deadlines stop being checked once claims are filed",()=>{
 assert.equal(winnerClaimDeadline(record,0).toISOString(),"2026-11-07T12:00:00.000Z");
 assert.equal(nextClaimCheckAt(record).toISOString(),"2026-11-07T12:00:00.000Z");
 const claimed={...record,winnerClaims:[{slot:0,userId:first,ticketNumber:"123",ticketUrl:"https://discord.com/channels/1/2"}]};
 assert.equal(winnerHasClaim(claimed,0),true);
 const done={...claimed,winnerClaims:[...claimed.winnerClaims,{slot:1,userId:second,ticketNumber:"456",ticketUrl:"https://discord.com/channels/1/3"}]};
 assert.equal(nextClaimCheckAt(done),null);
 assert.match(giveawayAnnouncement(done).embeds[0].data.description,/Claim submitted/);
 assert.equal(giveawayAnnouncement(done).components.length,0,"all claim buttons disappear once current winners have claimed");
 assert.deepEqual(giveawayAnnouncement(done).embeds[0].data.fields||[],[]);
});
test("rerolled winners receive new deadlines",()=>{
 const later={...record,winnerAssignedAt:[new Date("2026-11-08T12:00:00Z"),record.winnerAssignedAt[1]]};
 assert.equal(winnerClaimDeadline(later,0).toISOString(),"2026-11-09T12:00:00.000Z");
});

test("one-winner regular and activity results remove public claim details on successful ticket submission",()=>{
 const solo={...record,winnerCount:1,winnerIds:[first],winnerAssignedAt:[record.claimStartedAt],
   winnerClaims:[{slot:0,userId:first,ticketNumber:"ABC",submittedAt:new Date()}]};
 for(const mode of ["standard","activity"]){
   const result=giveawayAnnouncement({...solo,mode});
   const text=result.embeds[0].toJSON().description;
   assert.match(text,/Claim submitted successfully/);
   assert.doesNotMatch(text,/Claiming your prize|Claim deadline|How to claim|Submit your claim|FORFEIT YOUR WIN|Awaiting ticket claim/);
   assert.deepEqual(result.embeds[0].toJSON().fields||[],[]);
   assert.equal(result.components.length,0);
   assert.equal(hasOutstandingTicketClaims({...solo,mode}),false);
   assert.deepEqual(prizeClaimLines({...solo,mode},{finished:true}),[]);
 }
});

test("multiple winners keep instructions while another winner is pending, then remove them after all claims",()=>{
 const firstClaim={...record,winnerClaims:[{slot:0,userId:first,ticketNumber:"123",submittedAt:new Date()}]};
 for(const mode of ["standard","activity"]){
   const active=giveawayAnnouncement({...firstClaim,mode});
   assert.match(active.embeds[0].toJSON().description,/Claim submitted successfully/);
   assert.match(active.embeds[0].toJSON().description,/Awaiting ticket claim/);
   assert.doesNotMatch(active.embeds[0].toJSON().description,new RegExp("#1 <@"+first+"> — \\*\\*Awaiting"));
   assert.ok(active.embeds[0].toJSON().fields?.some(f=>f.name==="Claim deadline"));
   assert.ok(active.embeds[0].toJSON().fields?.some(f=>f.name==="⚠️ Forfeit deadline"));
   assert.equal(active.components.length,1);
   const claimed={...firstClaim,mode,winnerClaims:[
     ...firstClaim.winnerClaims,{slot:1,userId:second,ticketNumber:"456",submittedAt:new Date()}]};
   const finished=giveawayAnnouncement(claimed);
   assert.match(finished.embeds[0].toJSON().description,/#2 .*Claim submitted successfully/);
   assert.deepEqual(finished.embeds[0].toJSON().fields||[],[]);
   assert.equal(finished.components.length,0);
 }
});

test("forfeited prize places do not keep expired general instructions; new reroll winners restore them",()=>{
 const resolved={...record,claimResolvedSlots:[0,1],winnerClaims:[]};
 assert.equal(hasOutstandingTicketClaims(resolved),false);
 assert.deepEqual(prizeClaimLines(resolved,{finished:true}),[]);
 assert.equal(giveawayAnnouncement(resolved).components.length,0);
 const rerolled={...resolved,claimResolvedSlots:[0],winnerIds:[first,"333333333333333333"],
   winnerClaims:[{slot:0,userId:first,ticketNumber:"123"}]};
 assert.equal(hasOutstandingTicketClaims(rerolled),true);
 assert.equal(giveawayAnnouncement(rerolled).components.length,1);
 assert.ok(giveawayAnnouncement(rerolled).embeds[0].toJSON().fields.length>0);
});
