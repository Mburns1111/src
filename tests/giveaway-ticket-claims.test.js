import test from "node:test";
import assert from "node:assert/strict";
import { validateTicketClaim,submitGiveawayTicket } from "../services/giveaway-ticket-claims.js";
import Giveaway from "../models/Giveaway.js";
import {rerollGiveaway} from "../services/giveaways.js";
import { nextClaimCheckAt, winnerClaimDeadline, winnerHasClaim } from "../services/giveaway-claims.js";
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
 assert.equal(giveawayAnnouncement(done).components.length,0);
 const result=giveawayAnnouncement(done).embeds[0].toJSON();
 assert.match(result.description,/All winner claims received/);
 assert.doesNotMatch(result.description,/Claiming your prize|Claim before the deadline/i);
 assert.equal(result.fields?.length||0,0);
 const partial=giveawayAnnouncement(claimed);
 assert.equal(partial.components.length,1,"Other unclaimed winners must still be able to submit");
 assert.ok(partial.embeds[0].toJSON().fields.length>0);
});
test("rerolled winners receive new deadlines",()=>{
 const later={...record,winnerAssignedAt:[new Date("2026-11-08T12:00:00Z"),record.winnerAssignedAt[1]]};
 assert.equal(winnerClaimDeadline(later,0).toISOString(),"2026-11-09T12:00:00.000Z");
});

test("fulfilled or archived giveaways reject new claims and rerolls",async()=>{
 const previous=Giveaway.findOne;
 try{
   Giveaway.findOne=()=>({lean:async()=>({...record,archivedAt:new Date("2026-11-10T12:00:00Z")})});
   await assert.rejects(submitGiveawayTicket({id:record._id,guildId:record.guildId,
     userId:first,ticketNumber:"T-1",ticketUrl:"https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890"}),/not accepting ticket claims/);
   await assert.rejects(rerollGiveaway({id:record._id,guildId:record.guildId,
     staffId:first,slot:0}),/fulfilled or archived/);
 }finally{Giveaway.findOne=previous;}
});

test("public claim buttons disappear after delivery or fully forfeited winning places",()=>{
 const delivered=giveawayAnnouncement({...record,prizeDeliveredAt:new Date()});
 assert.equal(delivered.components.length,0);
 assert.match(delivered.embeds[0].toJSON().description,/Prize delivery:\*\* Confirmed complete/);
 const forfeited=giveawayAnnouncement({...record,claimResolvedSlots:[0,1]});
 assert.equal(forfeited.components.length,0);
 assert.doesNotMatch(forfeited.embeds[0].toJSON().description,/Claiming your prize/);
});

test("single activity winner appears once and claim instructions disappear after submission",()=>{
 const id="333333333333333333";
 const activity={...record,mode:"activity",title:"testing new layout",winnerCount:1,
   winnerIds:[id],entrantIds:[id],winnerAssignedAt:[record.winnerAssignedAt[0]],
   winnerClaims:[{slot:0,userId:id,ticketNumber:"Q-7",
     ticketUrl:"https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890"}]};
 const result=giveawayAnnouncement(activity);
 const embed=result.embeds[0].toJSON();
 assert.match(embed.description,/🏆 \*\*The Court Has Chosen\*\* · \*\*testing new layout\*\*/);
 assert.equal(embed.description.split("<@"+id+">").length-1,1);
 assert.match(embed.description,/<@333333333333333333> — Claim submitted/);
 assert.doesNotMatch(embed.description,/Claiming your prize|Winner ticket claims/);
 assert.equal(embed.fields?.length||0,0);
 assert.equal(result.components.length,0);
});
