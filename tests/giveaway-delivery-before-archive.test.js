import test from "node:test";
import assert from "node:assert/strict";
import {giveawayClaimsComplete,completedGiveawayCanDeleteListing} from "../services/giveaway-listing-lifecycle.js";
import {validGiveawayDeliveryProofUrl,giveawayStaffRecordPayload} from "../services/giveaway-staff-records.js";

const id="123456789012345678";
const winner={status:"ended",mode:"standard",winnerIds:[id],claimResolvedSlots:[],
  winnerClaims:[{slot:0,userId:id,ticketNumber:"T-1",ticketUrl:"https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890",submittedAt:new Date()}],
  publicListingRemovedAt:null,prizeDeliveredAt:null};

test("prize giveaway cannot archive merely because its ticket claim is complete",()=>{
  assert.equal(giveawayClaimsComplete(winner),true);
  assert.equal(completedGiveawayCanDeleteListing(winner),false);
  assert.equal(completedGiveawayCanDeleteListing({...winner,prizeDeliveredAt:new Date()}),true);
});

test("missing, forfeited, or zero-winner results must use cancellation rather than archive",()=>{
  assert.equal(completedGiveawayCanDeleteListing({...winner,winnerIds:[],prizeDeliveredAt:new Date()}),false);
  assert.equal(completedGiveawayCanDeleteListing({...winner,winnerClaims:[],prizeDeliveredAt:new Date()}),false);
  assert.equal(completedGiveawayCanDeleteListing({...winner,claimResolvedSlots:[0],prizeDeliveredAt:new Date()}),false);
  assert.equal(completedGiveawayCanDeleteListing({...winner,status:"cancelled",prizeDeliveredAt:new Date()}),false);
});

test("legacy staff-managed Trials still need staff delivery confirmation",()=>{
  const trial={...winner,mode:"survival",trialTicketClaimsEnabled:false,winnerClaims:[]};
  assert.equal(giveawayClaimsComplete(trial),true);
  assert.equal(completedGiveawayCanDeleteListing(trial),false);
  assert.equal(completedGiveawayCanDeleteListing({...trial,prizeDeliveredAt:new Date()}),true);
});

test("private staff controls show Confirm Prizes Delivered before Archive Giveaway",()=>{
  const record={...winner,_id:"507f1f77bcf86cd799439011",guildId:id,title:"Test prize",prize:"Gift",creatorId:id,endsAt:new Date()};
  const first=giveawayStaffRecordPayload(record);
  const labels=x=>x.components.flatMap(row=>row.components).map(b=>b.data.label);
  assert.ok(labels(first).includes("Confirm Prizes Delivered"));
  assert.ok(!labels(first).includes("Archive Giveaway"));
  const confirmed=giveawayStaffRecordPayload({...record,prizeDeliveredAt:new Date(),prizeDeliveredBy:id});
  assert.ok(labels(confirmed).includes("Archive Giveaway"));
  assert.ok(!labels(confirmed).includes("Confirm Prizes Delivered"));
});

test("optional delivery proof is restricted to a Discord message link",()=>{
  assert.equal(validGiveawayDeliveryProofUrl(""),true);
  assert.equal(validGiveawayDeliveryProofUrl("https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890"),true);
  assert.equal(validGiveawayDeliveryProofUrl("https://example.com/claim"),false);
});
