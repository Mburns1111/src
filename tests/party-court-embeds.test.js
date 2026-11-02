import test from "node:test";
import assert from "node:assert/strict";
import PartyGame from "../models/PartyGame.js";
import PartyResponse from "../models/PartyResponse.js";
import { courtGameDisplay } from "../services/party-court-engine.js";
import { handlePartyInteraction } from "../commands/party.js";

const gameId="507f1f77bcf86cd799439011";
const a="234567890123456789",b="345678901234567890";
const guildId="123456789012345678";
const game=()=>({
  _id:gameId,guildId,messageId:"456789012345678901",
  phase:"lobby",players:[a],hostId:a,category:"mixed",
  round:1,batch:0,paused:false,phaseEndsAt:new Date(Date.now()+90_000),
  scores:{[a]:500,[b]:500},roundScores:{},matchupWins:{},
  matchups:[{playerIds:[a,b],promptId:1,prompt:"Why did the wizard lose his job?"}],
});
const text=payload=>(payload.embeds||[]).map(embed=>{
  const v=embed.toJSON ? embed.toJSON() : embed;
  return [v.title,v.description,...(v.fields||[]).flatMap(f=>[f.name,f.value])].join("\n");
}).join("\n");

test("all public Court phases are fully embeds, with no plain post body",async()=>{
  const oldFind=PartyResponse.find;
  PartyResponse.find=()=>({lean:async()=>[
    {kind:"answer",matchupIndex:0,userId:a,text:"Turned into a pumpkin"},
    {kind:"answer",matchupIndex:0,userId:b,text:"Forgot spellbook"},
    {kind:"vote",matchupIndex:0,userId:"audience",targetId:a},
  ]});
  try {
    for(const phase of ["lobby","answering","voting","reveal","intermission","ended","cancelled"]) {
      const value=await courtGameDisplay({...game(),phase});
      assert.equal(value.content,"",phase+" should have no standalone plaintext body");
      assert.equal(value.embeds.length,1,phase+" should contain exactly one embed");
      const embed=value.embeds[0].toJSON();
      assert.match(embed.title,/Court of Chaos/);
      assert.ok(embed.color>0);
      assert.ok(embed.description);
      assert.ok(embed.description.length<=4096);
      assert.equal(value.allowedMentions.parse.length,0);
    }
    const vote=await courtGameDisplay({...game(),phase:"voting"});
    assert.match(text(vote),/Why did the wizard lose his job/);
    assert.match(text(vote),/Turned into a pumpkin/);
    assert.doesNotMatch(text(vote),/<@234567890123456789>/);
    const reveal=await courtGameDisplay({...game(),phase:"reveal"});
    assert.match(text(reveal),/1 vote/);
    assert.match(text(reveal),/1000 pts/);
    assert.match(text(reveal),new RegExp(a));
    assert.equal(reveal.components.length,0);
    const breakView=await courtGameDisplay({...game(),phase:"intermission"});
    assert.match(text(breakView),/Standings/);
    assert.equal(breakView.components[0].components[0].data.label,"Start Next Round");
  } finally {PartyResponse.find=oldFind;}
});

test("joining a Court lobby succeeds silently and relies on public member list",async()=>{
  const origFind=PartyGame.findOne,origUpdate=PartyGame.updateOne,origPublish=PartyGame.findOneAndUpdate;
  const calls=[];
  try {
    PartyGame.findOne=async()=>game();
    PartyGame.updateOne=async()=>({modifiedCount:1});
    PartyGame.findOneAndUpdate=async()=>null; // no Discord publication needed in unit test
    await handlePartyInteraction({
      isButton:()=>true,isStringSelectMenu:()=>false,isModalSubmit:()=>false,
      customId:"party:join:"+gameId,guildId,user:{id:b},client:{},
      deferUpdate:async()=>calls.push("acknowledged"),
      deferReply:async()=>assert.fail("Joining must not create a private reply"),
      editReply:async()=>assert.fail("Joining must not edit an ephemeral reply"),
      followUp:async()=>assert.fail("Joining must not send a private follow-up"),
    });
    assert.deepEqual(calls,["acknowledged"]);
  } finally {
    PartyGame.findOne=origFind;PartyGame.updateOne=origUpdate;
    PartyGame.findOneAndUpdate=origPublish;
  }
});

test("failed join still explains errors privately",async()=>{
  const origFind=PartyGame.findOne,origUpdate=PartyGame.updateOne;
  const replies=[];
  try {
    PartyGame.findOne=async()=>game();
    PartyGame.updateOne=async()=>({modifiedCount:0});
    await handlePartyInteraction({
      isButton:()=>true,isStringSelectMenu:()=>false,isModalSubmit:()=>false,
      customId:"party:join:"+gameId,guildId,user:{id:a},client:{},
      deferUpdate:async()=>{},
      followUp:async reply=>replies.push(reply),
    });
    assert.equal(replies.length,1);
    assert.match(replies[0].content,/already in the lobby/);
    assert.ok(replies[0].flags);
  } finally {PartyGame.findOne=origFind;PartyGame.updateOne=origUpdate;}
});
