import test from "node:test";
import assert from "node:assert/strict";
import PartyGame from "../models/PartyGame.js";
import PartyResponse from "../models/PartyResponse.js";
import { handlePartyInteraction } from "../commands/party.js";
import {
  courtGameDisplay, advanceCourtGame, startNextCourtRound, COURT_TIMINGS,
} from "../services/party-court-engine.js";

const gameId = "507f1f77bcf86cd799439011";
const guildId = "123456789012345678";
const a = "234567890123456789";
const b = "345678901234567890";
const game = () => ({
  _id: gameId, guildId, messageId: "456789012345678901",
  phase: "answering", paused: false,
  phaseEndsAt: new Date(Date.now() + 60_000),
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

test("standard pace allows full 60s answers, 30s per question, 8s reveals and 10s intermissions", () => {
  assert.equal(COURT_TIMINGS.answerMs, 60_000);
  assert.equal(COURT_TIMINGS.voteMs, 30_000);
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
    stub(changes, PartyResponse, "find", () => ({lean: async () => [{ matchupIndex:0, text: "Microwave with legs" }] }));
    await handlePartyInteraction({
      isButton: () => true, isModalSubmit: () => false,
      customId: "party:prompt:" + gameId, guildId, user:{id:a},
      deferReply: async () => {},
      editReply: async msg => replies.push(msg),
    });
    assert.match(replies[0].content,/Your saved answer/);
    assert.match(replies[0].content,/Microwave with legs/);
    assert.equal(replies[0].components[0].components[0].data.label,"Edit Question 1");
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


test("answer phase cannot end early even after all players submit", async () => {
  const changes = [];
  try {
    const g = { ...game(), phaseEndsAt:new Date(Date.now()+50_000) };
    const updates=[];
    stub(changes, PartyGame, "updateOne", async (...args) => {
      updates.push(args);return {modifiedCount:1};
    });
    assert.equal(await advanceCourtGame(g), false);
    assert.equal(updates.length,0);
    const expired = { ...g, phaseEndsAt:new Date(Date.now()-1_000) };
    assert.equal(await advanceCourtGame(expired),true);
    assert.equal(updates[0][1].$set.phase,"voting");
    const until = updates[0][1].$set.phaseEndsAt.getTime()-Date.now();
    assert.ok(until>0 && until <= 30_000);
  } finally { restore(changes); }
});

test("intermission never moves on its own even after ten seconds", async () => {
  const changes=[];
  try {
    stub(changes, PartyGame, "updateOne", async () => assert.fail("Must wait for staff"));
    const g = { ...game(), round:1, phase:"intermission",
      phaseEndsAt:new Date(Date.now()-30_000) };
    assert.equal(await advanceCourtGame(g),false);
  } finally { restore(changes); }
});

test("staff transition respects ten-second break and starts exactly the next round", async () => {
  const changes=[],writes=[];
  try {
    stub(changes, PartyGame, "updateOne", async (filter,change) => {
      writes.push({filter,change});return {modifiedCount:1};
    });
    const g={...game(), round:1, phase:"intermission", category:"silly",
      usedPromptIds:[], phaseEndsAt:new Date(Date.now()+7_000)};
    assert.equal(await startNextCourtRound(g),false);
    assert.equal(writes.length,0);
    g.phaseEndsAt=new Date(Date.now()-1_000);
    assert.equal(await startNextCourtRound(g),true);
    assert.equal(writes.length,1);
    assert.equal(writes[0].filter.phase,"intermission");
    assert.equal(writes[0].filter.round,1);
    assert.equal(writes[0].change.$set.round,2);
    assert.equal(writes[0].change.$set.phase,"answering");
    assert.equal(writes[0].change.$set.matchups.length,2);
  } finally { restore(changes); }
});

test("each member sees two questions, two saved answers and separate buttons", async () => {
  const changes=[],replies=[];
  try {
    const g=game();
    g.matchups=[
      {playerIds:[a,b], promptId:1, prompt:"First question?"},
      {playerIds:[a,b], promptId:2, prompt:"Second question?"},
    ];
    stub(changes, PartyGame, "findOne", async () => g);
    stub(changes, PartyResponse, "find", () => ({lean:async ()=>[
      {matchupIndex:0,text:"First answer"}, {matchupIndex:1,text:"Second answer"},
    ]}));
    await handlePartyInteraction({
      isButton:()=>true,isModalSubmit:()=>false,customId:"party:prompt:"+gameId,
      guildId,user:{id:a},deferReply:async()=>{},
      editReply:async msg=>replies.push(msg),
    });
    assert.match(replies[0].content,/First question/);
    assert.match(replies[0].content,/Second question/);
    assert.match(replies[0].content,/First answer/);
    assert.match(replies[0].content,/Second answer/);
    assert.equal(replies[0].components[0].components.length,2);
    assert.ok(replies[0].components[0].components[1].data.custom_id.endsWith(":1:1"));
  } finally {restore(changes);}
});
