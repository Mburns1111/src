import test from "node:test";
import assert from "node:assert/strict";
import {giveawayArchiveOutcome} from "../services/giveaway-claims.js";

const ended={status:"ended",mode:"activity",winnerIds:["a","b"],claimResolvedSlots:[]};
const ticket=(slot,userId)=>({slot,userId,ticketNumber:"T"+slot,
  ticketUrl:"https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890",
  submittedAt:new Date()});

test("submitted claims alone never allow archiving a completed prize giveaway",()=>{
  const claims=[ticket(0,"a"),ticket(1,"b")];
  assert.equal(giveawayArchiveOutcome({...ended,winnerClaims:claims}),null);
  assert.equal(giveawayArchiveOutcome({...ended,winnerClaims:claims,prizeDeliveredAt:new Date()}),"All prizes delivered");
});

test("unclaimed, forfeited and zero-winner results require cancellation",()=>{
  const first=ticket(0,"a");
  assert.equal(giveawayArchiveOutcome({...ended,winnerClaims:[first],prizeDeliveredAt:new Date()}),null);
  assert.equal(giveawayArchiveOutcome({...ended,winnerClaims:[first],claimResolvedSlots:[1],prizeDeliveredAt:new Date()}),null);
  assert.equal(giveawayArchiveOutcome({...ended,winnerIds:[],prizeDeliveredAt:new Date()}),null);
  assert.equal(giveawayArchiveOutcome({status:"cancelled"}),"Cancelled");
  assert.equal(giveawayArchiveOutcome({status:"open"}),null);
});
