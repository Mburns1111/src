import test from "node:test";
import assert from "node:assert/strict";
import { ButtonStyle, PermissionFlagsBits } from "discord.js";
import PartyGame from "../models/PartyGame.js";
import PartyResponse from "../models/PartyResponse.js";
import { handlePartyInteraction, privateCourtPromptPanel, execute } from "../commands/party.js";
import { advanceCourtGame } from "../services/party-court-engine.js";
import { trackCourtAnswerPanel, closeCourtAnswerPanels } from "../services/party-private-panels.js";

const id="507f1f77bcf86cd799439011";
const guildId="123456789012345678";
const hostId="234567890123456789";
const playerId="345678901234567890";
const game=()=>({_id:id,guildId,hostId,round:1,batch:0,phase:"answering",
  phaseEndsAt:new Date(Date.now()+90_000),paused:false,active:true,players:[hostId,playerId],
  matchups:[
    {playerIds:[hostId,playerId],promptId:1,prompt:"First prompt?"},
    {playerIds:[hostId,playerId],promptId:2,prompt:"Second prompt?"},
  ]});
const stub=(stack,obj,key,value)=>{stack.push([obj,key,obj[key]]);obj[key]=value;};
const restore=stack=>{for(const [obj,key,value] of stack.reverse())obj[key]=value;};

test("saved question buttons turn green while pending questions stay blue",async()=>{
  const patches=[];
  try{
    stub(patches,PartyResponse,"find",()=>({lean:async()=>[
      {matchupIndex:0,text:"Already answered"},
    ]}));
    const view=await privateCourtPromptPanel(game(),hostId);
    const buttons=view.components[0].components.map(b=>b.toJSON());
    assert.equal(buttons.length,2);
    assert.equal(buttons[0].style,ButtonStyle.Success);
    assert.equal(buttons[1].style,ButtonStyle.Primary);
    assert.match(view.content,/Already answered/);
    assert.match(view.content,/No answer saved yet/);
  }finally{restore(patches)}
});

test("answer panels are actually deleted as answering transitions into voting",async()=>{
  const patches=[],deleted=[];
  try{
    const g=game();
    const expired={...g,phaseEndsAt:new Date(Date.now()-1000)};
    trackCourtAnswerPanel(g,{user:{id:hostId},deleteReply:async()=>deleted.push(hostId)});
    trackCourtAnswerPanel(g,{user:{id:playerId},deleteReply:async()=>deleted.push(playerId)});
    stub(patches,PartyGame,"updateOne",async()=>({modifiedCount:1}));
    assert.equal(await advanceCourtGame(expired),true);
    assert.deepEqual(deleted.sort(),[hostId,playerId].sort());
    await closeCourtAnswerPanels(id,1);
    assert.equal(deleted.length,2,"Cleaning a round twice is safe");
  }finally{
    restore(patches);
    await closeCourtAnswerPanels(id,1);
  }
});

test("reopening a private panel dismisses the earlier panel and tracks the new one",async()=>{
  const gameId="507f1f77bcf86cd799439012";
  const first=[],second=[];
  const g={...game(),_id:gameId};
  trackCourtAnswerPanel(g,{user:{id:playerId},deleteReply:async()=>first.push(true)});
  trackCourtAnswerPanel(g,{user:{id:playerId},deleteReply:async()=>second.push(true)});
  await closeCourtAnswerPanels(gameId,1);
  await Promise.resolve();
  assert.equal(first.length,1);
  assert.equal(second.length,1);
});

test("failed private panel cleanup never prevents answering from closing",async()=>{
  const patches=[];
  const g=game();
  try{
    trackCourtAnswerPanel(g,{
      user:{id:hostId},deleteReply:async()=>{throw Object.assign(new Error("Unknown Webhook"),{code:10015});},
    });
    stub(patches,PartyGame,"updateOne",async()=>({modifiedCount:1}));
    assert.equal(await advanceCourtGame({...g,phaseEndsAt:new Date(Date.now()-1000)}),true);
  }finally{restore(patches);await closeCourtAnswerPanels(id,1)}
});

test("only the original host can configure a first-place prize announcement",async()=>{
  const patches=[],writes=[],replies=[];
  const g={...game(),phase:"lobby"};
  try{
    stub(patches,PartyGame,"findOne",async()=>g);
    stub(patches,PartyGame,"updateOne",async(query,update)=>{
      writes.push({query,update});return {modifiedCount:1};
    });
    stub(patches,PartyGame,"findOneAndUpdate",async()=>null);
    const call=async(userId,message)=>execute({
      guildId,user:{id:userId},memberPermissions:{has:()=>true},
      options:{getSubcommand:()=> "prize",getString:()=>message},
      editReply:async v=>replies.push(v),client:{},
    });
    await call(playerId,"Give them a pet");
    assert.match(replies[0].content,/Only the original party host/);
    assert.equal(writes.length,0);
    await call(hostId,"Winner receives a Mystery Egg!");
    assert.equal(writes.length,1);
    assert.equal(writes[0].query.hostId,hostId);
    assert.equal(writes[0].update.$set.prizeMessage,"Winner receives a Mystery Egg!");
    assert.match(replies[1].content,/manual/);
  }finally{restore(patches)}
});

test("Start Next Round succeeds with no redundant ephemeral confirmation",async()=>{
  const patches=[],events=[];
  try{
    const g={...game(),round:1,phase:"intermission",phaseEndsAt:new Date(Date.now()-15_000)};
    stub(patches,PartyGame,"findOne",async()=>g);
    stub(patches,PartyGame,"updateOne",async()=>({modifiedCount:1}));
    stub(patches,PartyGame,"findOneAndUpdate",async()=>null);
    await handlePartyInteraction({
      customId:"party:next:"+id+":1",guildId,user:{id:hostId},
      memberPermissions:{has:flag=>flag===PermissionFlagsBits.ManageGuild},
      isButton:()=>true,isModalSubmit:()=>false,isStringSelectMenu:()=>false,
      deferUpdate:async()=>events.push("acknowledged"),
      followUp:async()=>assert.fail("Successful next-round start should not send a confirmation"),
      client:{},
    });
    assert.deepEqual(events,["acknowledged"]);
  }finally{restore(patches)}
});
