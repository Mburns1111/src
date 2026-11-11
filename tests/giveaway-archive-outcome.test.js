import test from "node:test";
import assert from "node:assert/strict";
import {giveawayArchiveOutcome} from "../services/giveaway-claims.js";

const ended = {status:"ended", mode:"activity", winnerIds:["a","b"]};
const ticket = (slot,userId) => ({slot,userId});

test("every current winning place needs a claim or closure before staff can archive", () => {
  const first = ticket(0,"a");
  for (const mode of ["activity","standard"]) {
    const record = {...ended,mode,winnerClaims:[first]};
    assert.equal(giveawayArchiveOutcome(record), null);
    assert.equal(giveawayArchiveOutcome({...record,winnerClaims:[first,ticket(1,"former")]}), null);
    for (const complete of [{claimResolvedSlots:[1]}, {winnerClaims:[first,ticket(1,"b")]}])
      assert.equal(giveawayArchiveOutcome({...record,...complete}), "Claims complete — delivery unconfirmed");
  }
});

test("archive outcomes distinguish delivery, closed places, empty draws and cancellations", () => {
  assert.equal(giveawayArchiveOutcome({...ended,prizeDeliveredAt:new Date()}),"All prizes delivered");
  assert.equal(giveawayArchiveOutcome({...ended,claimResolvedSlots:[0,1]}),"All winning places closed");
  assert.equal(giveawayArchiveOutcome({...ended,winnerIds:[]}),"Completed — no winners selected");
  assert.equal(giveawayArchiveOutcome({status:"cancelled"}),"Cancelled");
  assert.equal(giveawayArchiveOutcome({status:"open"}),null);
  assert.equal(giveawayArchiveOutcome({...ended,mode:"survival",winnerClaims:[ticket(0,"a"),ticket(1,"b")]}),null);
});
