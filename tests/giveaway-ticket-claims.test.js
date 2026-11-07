import test from "node:test";
import assert from "node:assert/strict";
import { validateTicketClaim } from "../services/giveaway-ticket-claims.js";
import { nextClaimCheckAt, winnerClaimDeadline, winnerHasClaim } from "../services/giveaway-claims.js";
import { giveawayAnnouncement } from "../services/giveaways.js";
const first="111111111111111111", second="222222222222222222";
const record={_id:"507f1f77bcf86cd799439011",guildId:"123456789012345678",mode:"standard",status:"ended",
  title:"Weekly prize",prize:"Diamond Egg",creatorId:first,winnerCount:2,endsAt:new Date("2026-11-06T12:00:00Z"),
  winnerIds:[first,second],entrantIds:[first,second],winnerAssignedAt:[new Date("2026-11-06T12:00:00Z"),new Date("2026-11-06T12:00:00Z")],
  claimWindowHours:24,claimStartedAt:new Date("2026-11-06T12:00:00Z"),autoRerollClaims:true,winnerClaims:[],
  claimResolvedSlots:[],rerollHistory:[]};
test("ticket validation requires HTTPS and a safe ticket number",()=>{
 assert.equal(validateTicketClaim("ticket-123","https://discord.com/channels/1/2").ticketNumber,"ticket-123");
 assert.throws(()=>validateTicketClaim("<@everyone>","https://example.com"),/ticket number/);
 assert.throws(()=>validateTicketClaim("123","javascript:alert(1)"),/HTTPS/);
});
test("per-winner deadlines stop being checked once claims are filed",()=>{
 assert.equal(winnerClaimDeadline(record,0).toISOString(),"2026-11-07T12:00:00.000Z");
 assert.equal(nextClaimCheckAt(record).toISOString(),"2026-11-07T12:00:00.000Z");
 const claimed={...record,winnerClaims:[{slot:0,userId:first,ticketNumber:"123",ticketUrl:"https://discord.com/channels/1/2"}]};
 assert.equal(winnerHasClaim(claimed,0),true);
 const done={...claimed,winnerClaims:[...claimed.winnerClaims,{slot:1,userId:second,ticketNumber:"456",ticketUrl:"https://discord.com/channels/1/3"}]};
 assert.equal(nextClaimCheckAt(done),null);
 assert.match(giveawayAnnouncement(done).embeds[0].data.description,/Claim filed/);
 assert.equal(giveawayAnnouncement(done).components[0].components[0].data.label,"File Ticket Claim");
});
test("rerolled winners receive new deadlines",()=>{
 const later={...record,winnerAssignedAt:[new Date("2026-11-08T12:00:00Z"),record.winnerAssignedAt[1]]};
 assert.equal(winnerClaimDeadline(later,0).toISOString(),"2026-11-09T12:00:00.000Z");
});
