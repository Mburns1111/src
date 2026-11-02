import test from "node:test";
import assert from "node:assert/strict";
import PartyGame from "../models/PartyGame.js";
import PartyResponse from "../models/PartyResponse.js";
import { handlePartyInteraction } from "../commands/party.js";
import {
  courtGameDisplay, shortenCourtAnswerWindow, COURT_TIMINGS,
} from "../services/party-court-engine.js";

const gameId = "507f1f77bcf86cd799439011";
const guildId = "123456789012345678";
const a = "234567890123456789";
const b = "345678901234567890";
const game = () => ({
  _id: gameId, guildId, messageId: "456789012345678901",
  phase: "answering", paused: false,
  phaseEndsAt: new Date(Date.now() + 45_000),
  players: [a, b], round: 1, batch: 0,
  matchups: [{ playerIds: [a,b], promptId: 1, prompt: "What is the worst prize?" }],
});
function stub(changes, obj, name, fn) {
  changes.push([obj,name,obj[name]]);
  obj[name] = fn;
}
function restore(changes) {
  for (const [obj,name,fn] of changes.reverse()) obj[name] = fn;
}

test("fast standard pace caps answers at 45s, votes at 15s and reveals at 8s and intermissions at 10s", () => {
  assert.equal(COURT_TIMINGS.answerMs, 45_000);
  assert.equal(COURT_TIMINGS.voteMs, 15_000);
  assert.equal(COURT_TIMINGS.revealMs, 8_000);
  assert.equal(COURT_TIMINGS.intermissionMs, 10_000);
});

test("modal submission writes correct round/matchup then confirms stored answer", async () => {
  const changes = [], saved = [], replies = [];
  try {
    stub(changes, PartyGame, "findOne", async () => game());
    stub(changes, PartyResponse, "findOneAndUpdate", async (filter, update, opts) => {
      saved.push({ filter, update, opts });
      return { ...filter, text: update.$set.text };
    });
    await handlePartyInteraction({
      isButton: () => false, isModalSubmit: () => true,
      customId: "party:submit:" + gameId + ":1:0",
      guildId, user: {id: a},
      deferReply: async () => {},
      editReply: async msg => {replies.push(msg);},
      fields: { getTextInputValue: key => {
        assert.equal(key,"answer");
        return "Microwave with legs";
      }},
    });
    assert.equal(saved.length,1);
    assert.deepEqual(saved[0].filter, {
      gameId, guildId, round: 1, matchupIndex: 0, kind: "answer", userId: a,
    });
    assert.equal(saved[0].opts.upsert,true);
    assert.equal(saved[0].opts.new,true);
    assert.match(replies[0].content,/Saved for Round 1/);
    assert.match(replies[0].content,/Microwave with legs/);
  } finally { restore(changes); }
});

test("a write that isn't confirmed never shows Saved", async () => {
  const changes = [], replies = [];
  try {
    stub(changes, PartyGame, "findOne", async () => game());
    stub(changes, PartyResponse, "findOneAndUpdate", async () => null);
    await handlePartyInteraction({
      isButton: () => false, isModalSubmit: () => true,
      customId: "party:submit:" + gameId + ":1:0",
      guildId, user: {id: a}, deferReply: async () => {},
      editReply: async msg => replies.push(msg),
      fields: {getTextInputValue: () => "Some funny answer"},
    });
    assert.match(replies[0].content,/NOT confirmed/);
    assert.doesNotMatch(replies[0].content,/Saved for Round/);
  } finally { restore(changes); }
});

test("player can check their exact saved answer privately", async () => {
  const changes = [], replies = [];
  try {
    stub(changes, PartyGame, "findOne", async () => game());
    stub(changes, PartyResponse, "findOne", async () => ({ text: "Microwave with legs" }));
    await handlePartyInteraction({
      isButton: () => true, isModalSubmit: () => false,
      customId: "party:prompt:" + gameId, guildId, user:{id:a},
      deferReply: async () => {},
      editReply: async msg => replies.push(msg),
    });
    assert.match(replies[0].content,/Your saved answer/);
    assert.match(replies[0].content,/Microwave with legs/);
    assert.equal(replies[0].components[0].components[0].data.label,"Edit Saved Answer");
  } finally { restore(changes); }
});

test("saved responses are displayed during the voting phase, not treated as missing", async () => {
  const changes = [];
  try {
    stub(changes, PartyResponse, "find", () => ({
      lean: async () => [
        { gameId, userId:a, round:1, matchupIndex:0, kind:"answer", text:"Microwave with legs" },
        { gameId, userId:b, round:1, matchupIndex:0, kind:"answer", text:"Unpaid Tax Collector" },
      ],
    }));
    const display = await courtGameDisplay({ ...game(), phase:"voting", batch:0 });
    assert.match(display.content,/Microwave with legs/);
    assert.match(display.content,/Unpaid Tax Collector/);
    assert.doesNotMatch(display.content,/No answer submitted/);
    assert.equal(display.components.length,1);
    assert.equal(display.components[0].components.length,2);
  } finally { restore(changes); }
});

test("all saved answers shorten the countdown; partial entries don't", async () => {
  const changes = [], updates = [];
  try {
    let answers = [{ userId:a, matchupIndex:0 }];
    stub(changes, PartyResponse, "find", () => ({
      select: () => ({ lean: async () => answers }),
    }));
    stub(changes, PartyGame, "updateOne", async (filter, update) => {
      updates.push({filter,update});
      return {modifiedCount:1};
    });
    const g = game();
    assert.equal(await shortenCourtAnswerWindow(g),false);
    assert.equal(updates.length,0);
    answers = [{userId:a,matchupIndex:0},{userId:b,matchupIndex:0}];
    assert.equal(await shortenCourtAnswerWindow(g),true);
    assert.equal(updates.length,1);
    const ms = updates[0].update.$set.phaseEndsAt.getTime() - Date.now();
    assert.ok(ms > 0 && ms <= 5_000);
    assert.equal(updates[0].update.$inc.renderVersion,1);
  } finally { restore(changes); }
});

test("a saved answer from the wrong matchup does not end the round early", async () => {
  const changes = [];
  try {
    stub(changes, PartyResponse, "find", () => ({
      select: () => ({ lean: async () => [
        {userId:a,matchupIndex:1},{userId:b,matchupIndex:0},
      ] }),
    }));
    stub(changes, PartyGame, "updateOne", async () =>
      assert.fail("The round cannot end with a mismatched submission"));
    assert.equal(await shortenCourtAnswerWindow(game()),false);
  } finally { restore(changes); }
});
