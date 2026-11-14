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
const winnerResultText=announcement=>{
 const embed=announcement.embeds[0].toJSON();
 const results=(embed.fields||[]).filter(field=>field.name==="🏆 Winners / Results");
 assert.equal(results.length,1,"the public result must have exactly one winner list");
 assert.doesNotMatch(embed.description,/\*\*Winners \/ Results\*\*|\*\*Winner ticket claims\*\*/);
 assert.doesNotMatch(embed.description,/^#?\d+\.? <@/m,"no extra winner rows in description");
 return results[0].value;
};
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
 assert.match(winnerResultText(giveawayAnnouncement(done)),/Claim submitted/);
 assert.equal(giveawayAnnouncement(done).components.length,0,"all claim buttons disappear once current winners have claimed");
 assert.deepEqual((giveawayAnnouncement(done).embeds[0].data.fields||[]).filter(f=>!/Winners \/ Results/.test(f.name)),[]);
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
   assert.match(winnerResultText(result),/Claim submitted successfully/);
   assert.doesNotMatch(text,/Claim submitted successfully/);
   assert.doesNotMatch(text,/Claiming your prize|Claim deadline|How to claim|Submit your claim|FORFEIT YOUR WIN|Awaiting ticket claim/);
   assert.deepEqual((result.embeds[0].toJSON().fields||[]).filter(f=>!/Winners \/ Results/.test(f.name)),[]);
   assert.equal(result.components.length,0);
   assert.equal(hasOutstandingTicketClaims({...solo,mode}),false);
   assert.deepEqual(prizeClaimLines({...solo,mode},{finished:true}),[]);
 }
});

test("multiple winners keep instructions while another winner is pending, then remove them after all claims",()=>{
 const firstClaim={...record,winnerClaims:[{slot:0,userId:first,ticketNumber:"123",submittedAt:new Date()}]};
 for(const mode of ["standard","activity"]){
   const active=giveawayAnnouncement({...firstClaim,mode});
   const results=winnerResultText(active);
   assert.match(results,/Claim submitted successfully/);
   assert.match(results,/Awaiting ticket claim/);
   assert.doesNotMatch(active.embeds[0].toJSON().description,/Claim submitted successfully|Awaiting ticket claim/);
   assert.doesNotMatch(results,new RegExp("1\\. <@"+first+"> — \\*\\*Awaiting"));
   assert.ok(active.embeds[0].toJSON().fields?.some(f=>f.name==="Claim deadline"));
   assert.ok(active.embeds[0].toJSON().fields?.some(f=>f.name==="⚠️ Forfeit deadline"));
   assert.equal(active.components.length,1);
   const claimed={...firstClaim,mode,winnerClaims:[
     ...firstClaim.winnerClaims,{slot:1,userId:second,ticketNumber:"456",submittedAt:new Date()}]};
   const finished=giveawayAnnouncement(claimed);
   assert.match(winnerResultText(finished),/2\. .*Claim submitted successfully/);
   assert.deepEqual((finished.embeds[0].toJSON().fields||[]).filter(f=>!/Winners \/ Results/.test(f.name)),[]);
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

test("single public winner list combines pending, submitted and forfeited places without duplicate names",()=>{
 const third="333333333333333333";
 const mixed={...record,
   winnerCount:3,winnerIds:[first,second,third],
   winnerAssignedAt:[new Date("2099-01-01T00:00:00Z"),new Date("2099-01-01T00:00:00Z"),new Date("2099-01-01T00:00:00Z")],
   winnerClaims:[{slot:0,userId:first,ticketNumber:"C-1"}],
   claimResolvedSlots:[2]};
 for(const mode of ["standard","activity"]){
   const announcement=giveawayAnnouncement({...mixed,mode});
   const embed=announcement.embeds[0].toJSON();
   const results=winnerResultText(announcement);
   const lines=results.split("\n");
   assert.equal(lines.length,3);
   assert.match(lines[0],new RegExp("^1\\. <@"+first+"> — \\*\\*Claim submitted successfully"));
   assert.match(lines[1],new RegExp("^2\\. <@"+second+"> — \\*\\*Awaiting ticket claim"));
   assert.match(lines[1],/Due <t:\d+:R>/);
   assert.match(lines[2],new RegExp("^3\\. \\*\\*No eligible winner\\*\\* — <@"+third+"> forfeited"));
   for(const id of [first,second,third]){
     assert.equal((results.match(new RegExp("<@"+id+">","g"))||[]).length,1);
   }
   assert.doesNotMatch(embed.description,/Winner ticket claims|\*\*Winners \/ Results\*\*|Claim submitted successfully|Awaiting ticket claim/);
   assert.equal(announcement.components.length,1);
 }
});
