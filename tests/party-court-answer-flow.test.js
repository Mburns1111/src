import test from "node:test";
import assert from "node:assert/strict";
import PartyGame from "../models/PartyGame.js";
import PartyResponse from "../models/PartyResponse.js";
import { handlePartyInteraction } from "../commands/party.js";
import {
  courtGameDisplay, advanceCourtGame, startNextCourtRound, COURT_TIMINGS,
} from "../services/party-court-engine.js";

function embedText(view) {
  return (view.embeds || []).map(embed=>{
    const e=typeof embed.toJSON === "function" ? embed.toJSON() : embed;
    return [e.title,e.description,...(e.fields || []).flatMap(f=>[f.name,f.value])].join("\n");
  }).join("\n");
}
const gameId = "507f1f77bcf86cd799439011";
const guildId = "123456789012345678";
const a = "234567890123456789";
const b = "345678901234567890";
const game = () => ({
  _id: gameId, guildId, messageId: "456789012345678901",
  phase: "answering", paused: false,
  phaseEndsAt: new Date(Date.now() + 90_000),
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

test("standard pace allows full 90s answers, 30s per question, 8s reveals and 10s intermissions", () => {
  assert.equal(COURT_TIMINGS.answerMs, 90_000);
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
    stub(changes, PartyResponse, "find", () => ({ lean: async () => [
      { matchupIndex: 0, text: "Microwave with legs" },
    ] }));
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
    assert.match(embedText(display),/Microwave with legs/);
    assert.match(embedText(display),/Unpaid Tax Collector/);
    assert.doesNotMatch(embedText(display),/No answer submitted/);
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

test("round break shows a staff-only Start Next Round action and does not restart itself", async () => {
  const shown = await courtGameDisplay({
    ...game(), phase:"intermission", round:1, players:[a,b],
    scores:{ [a]:120, [b]:30 },
    phaseEndsAt:new Date(Date.now()-2000),
  });
  assert.match(embedText(shown),/will not start automatically/);
  assert.equal(shown.components.length,1);
  assert.equal(shown.components[0].components[0].data.label,"Start Next Round");
  assert.equal(shown.components[0].components[0].data.custom_id,"party:next:"+gameId+":1");
});

test("ordinary members cannot start the next round from the public button", async () => {
  const changes=[],replies=[];
  try {
    const g={...game(),phase:"intermission",round:1,
      phaseEndsAt:new Date(Date.now()-15_000)};
    stub(changes,PartyGame,"findOne",async()=>g);
    stub(changes,PartyGame,"updateOne",async()=>assert.fail("Only staff may advance rounds"));
    await handlePartyInteraction({
      isButton:()=>true, isModalSubmit:()=>false,
      customId:"party:next:"+gameId+":1",
      guildId,user:{id:a},memberPermissions:{has:()=>false},
      deferReply:async()=>{},editReply:async msg=>replies.push(msg),
    });
    assert.match(replies[0].content,/Only staff/);
  } finally {restore(changes);}
});

test("two answers in one round count as one completed round for rewards", async () => {
  const changes=[],updates=[];
  try {
    stub(changes,PartyGame,"updateOne",async(_query,change)=>{
      updates.push(change);return {modifiedCount:1};
    });
    stub(changes,PartyResponse,"find",()=>({
      select:()=>({lean:async()=>[
        {userId:a},{userId:a},{userId:b},{userId:b},
      ]}),
    }));
    const g={...game(),phase:"reveal",round:1,batch:1,
      matchups:[
        {playerIds:[a,b],promptId:1,prompt:"One"},
        {playerIds:[a,b],promptId:2,prompt:"Two"},
      ],
      answeredCounts:{[a]:0,[b]:0},usedPromptIds:[1,2],
      phaseEndsAt:new Date(Date.now()-10_000),
    };
    assert.equal(await advanceCourtGame(g),true);
    assert.equal(updates[0].$set.phase,"intermission");
    assert.equal(updates[0].$set.answeredCounts[a],1);
    assert.equal(updates[0].$set.answeredCounts[b],1);
  } finally {restore(changes);}
});

test("modal submit refreshes the same private message and both answer statuses", async () => {
  const changes=[], events=[],responses=[];
  const g=game();
  g.matchups=[
    {playerIds:[a,b],promptId:1,prompt:"First question?"},
    {playerIds:[a,b],promptId:2,prompt:"Second question?"},
  ];
  const answers=new Map();
  try {
    stub(changes,PartyGame,"findOne",async()=>g);
    stub(changes,PartyResponse,"findOneAndUpdate",async(filter,update)=>{
      answers.set(filter.matchupIndex,update.$set.text);
      return {...filter,text:update.$set.text};
    });
    stub(changes,PartyResponse,"find",()=>({lean:async()=>[...answers].map(([matchupIndex,text])=>({matchupIndex,text}))}));
    for (const [idx,text] of [[0,"First saved"],[1,"Second saved"]]) {
      await handlePartyInteraction({
        isButton:()=>false,isModalSubmit:()=>true,isStringSelectMenu:()=>false,
        isFromMessage:()=>true,
        customId:"party:submit:"+gameId+":1:"+idx, guildId,user:{id:a},
        deferUpdate:async()=>events.push("deferUpdate"),
        deferReply:async()=>assert.fail("Modal opened from private panel must not send another ephemeral reply"),
        editReply:async content=>{events.push("editReply");responses.push(content)},
        fields:{getTextInputValue:()=>text},
      });
    }
    assert.deepEqual(events,["deferUpdate","editReply","deferUpdate","editReply"]);
    assert.match(responses[0].content,/Saved for Round 1/);
    assert.match(responses[0].content,/First saved/);
    assert.match(responses[0].content,/No answer saved yet/);
    assert.equal(responses[0].components[0].components.length,2);
    assert.match(responses[1].content,/First saved/);
    assert.match(responses[1].content,/Second saved/);
    assert.doesNotMatch(responses[1].content,/No answer saved yet/);
    assert.deepEqual(responses[1].components[0].components.map(b=>b.data.label),
      ["Edit Question 1","Edit Question 2"]);
  } finally{restore(changes)}
});

test("fallback modal submission without a source message is still acknowledged privately",async()=>{
  const changes=[],events=[],replies=[];
  try {
    stub(changes,PartyGame,"findOne",async()=>game());
    stub(changes,PartyResponse,"findOneAndUpdate",async(filter,update)=>({...filter,text:update.$set.text}));
    stub(changes,PartyResponse,"find",()=>({lean:async()=>[{matchupIndex:0,text:"Recorded"}]}));
    await handlePartyInteraction({
      isButton:()=>false,isModalSubmit:()=>true,isStringSelectMenu:()=>false,
      isFromMessage:()=>false,
      customId:"party:submit:"+gameId+":1:0",guildId,user:{id:a},
      deferReply:async opts=>events.push(opts),
      deferUpdate:async()=>assert.fail("No source message to update"),
      editReply:async content=>replies.push(content),
      fields:{getTextInputValue:()=> "Recorded"},
    });
    assert.equal(events.length,1);
    assert.match(replies[0].content,/Recorded/);
  }finally {restore(changes)}
});
