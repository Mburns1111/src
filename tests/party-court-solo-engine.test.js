import test from "node:test";
import assert from "node:assert/strict";
import PartyGame from "../models/PartyGame.js";
import { beginCourtGame, advanceCourtGame } from "../services/party-court-engine.js";

// The game engine's MongoDB update is stubbed. No real Discord or database
// is needed to verify solo mode's state transitions.
test("one player can start and moves from answering straight to reveal", async () => {
  const original = PartyGame.updateOne;
  const writes = [];
  PartyGame.updateOne = async (query, update) => {
    writes.push({ query, update });
    return { modifiedCount: 1 };
  };
  try {
    const lobby = { _id: "fake-game-id", phase: "lobby", players: ["solo"],
      category: "mixed", round: 0, batch: 0, matchups: [], phaseEndsAt: null };
    assert.equal(await beginCourtGame(lobby), true);
    const start = writes[0].update.$set;
    assert.equal(start.phase, "answering");
    assert.equal(start.matchups.length, 1);
    assert.deepEqual(start.matchups[0].playerIds, ["solo"]);
    assert.equal(start.round, 1);

    const answering = { ...lobby, ...start, phaseEndsAt: new Date(Date.now() - 1000) };
    assert.equal(await advanceCourtGame(answering), true);
    assert.equal(writes[1].update.$set.phase, "reveal");
    assert.equal(writes[1].update.$set.batch, 0);
    assert.ok(writes[1].update.$set.phaseEndsAt.getTime() > Date.now());
    assert.equal(writes.filter(x => x.update.$set.phase === "voting").length, 0);
  } finally {
    PartyGame.updateOne = original;
  }
});
