import test from "node:test";
import assert from "node:assert/strict";
import PartyGame from "../models/PartyGame.js";
import PartyPost from "../models/PartyPost.js";
import PartyResponse from "../models/PartyResponse.js";
import { publishCourtGame } from "../services/party-court-engine.js";

const gameId = "507f1f77bcf86cd799439011";
const guildId = "123456789012345678";
const channelId = "234567890123456789";
const a = "345678901234567890", b = "456789012345678901";
const original = [
  { playerIds: [a,b], promptId: 1, prompt: "Question one?" },
  { playerIds: [a,b], promptId: 2, prompt: "Question two?" },
];

function fixture() {
  const history = [];
  const posts = new Map();
  let nextMessage = 100;
  const messages = new Map();
  messages.set("lobby-1", {
    id:"lobby-1", content:"Join Court", author:{id:"bot"},
    edit:async function(payload) {this.content=payload.content;this.components=payload.components;history.push(["edit",this.id,payload.content]);},
  });
  const channel = {
    client:{user:{id:"bot"}},isTextBased:()=>true,
    messages:{fetch:async id => {
      if (typeof id === "object") return new Map(messages);
      if (!messages.has(id)) throw new Error("Missing message: "+id);
      return messages.get(id);
    }},
    send:async payload => {
      const id="msg-"+(++nextMessage);
      const message={id,content:payload.content,author:{id:"bot"},
        components:payload.components,
        edit:async function(next) {this.content=next.content;this.components=next.components;history.push(["edit",id,next.content]);},
      };
      messages.set(id,message);
      history.push(["send",id,payload.content]);
      return message;
    },
  };
  let snapshot={
    _id:gameId, guildId, channelId, messageId:"lobby-1", lobbyArchived:false,
    phase:"answering", active:true, players:[a,b], round:1, batch:0,
    matchups:original, roundMatchups:{"1":original}, completedRounds:0,
    phaseEndsAt:new Date(Date.now()+60_000),renderVersion:2,renderedVersion:1,
    scores:{[a]:0,[b]:0},roundScores:{},matchupWins:{[a]:0,[b]:0},
    usedPromptIds:[1,2], answeredCounts:{[a]:0,[b]:0}, paused:false,
    publishingUntil:null, publishingToken:"",
  };
  const patches=[];
  function stub(obj,name,fn){patches.push([obj,name,obj[name]]);obj[name]=fn;}
  stub(PartyGame,"findOneAndUpdate",async(query,update)=> {
    if (snapshot.publishingUntil && snapshot.publishingUntil > new Date()) return null;
    Object.assign(snapshot,update.$set);
    return {...snapshot};
  });
  stub(PartyGame,"updateOne",async(query,update)=>{
    if (query.publishingToken && query.publishingToken!==snapshot.publishingToken)
      return {modifiedCount:0};
    Object.assign(snapshot, update.$set);
    return {modifiedCount:1};
  });
  stub(PartyPost,"find",async()=>[...posts.values()].map(p=>({...p})));
  stub(PartyPost,"findOneAndUpdate",async(query,update)=>{
    if (!posts.has(query.key)) posts.set(query.key, {
      _id:"post-"+query.key,gameId:query.gameId,key:query.key,
      messageId:"",renderedVariant:"",renderedVersion:0,...update.$setOnInsert,
    });
    return {...posts.get(query.key)};
  });
  stub(PartyPost,"updateOne",async(query,update)=>{
    const key=query._id.replace("post-","");
    Object.assign(posts.get(key),update.$set);
    return {modifiedCount:1};
  });
  stub(PartyResponse,"find",()=>({lean:async()=>[
    {matchupIndex:0,kind:"answer",userId:a,text:"A funny answer"},
    {matchupIndex:0,kind:"answer",userId:b,text:"A different answer"},
    {matchupIndex:1,kind:"answer",userId:a,text:"Second A"},
    {matchupIndex:1,kind:"answer",userId:b,text:"Second B"},
    {matchupIndex:0,kind:"vote",userId:"spectator",targetId:a},
  ]}));
  const client={channels:{fetch:async id=>{assert.equal(id,channelId);return channel;}}};
  return {
    client,snapshot,posts,messages,history,
    setPhase(phase,batch=0) {snapshot.phase=phase;snapshot.batch=batch;snapshot.renderVersion++;snapshot.phaseEndsAt=new Date(Date.now()+20_000);},
    restore() {for(const [obj,key,val] of patches.reverse())obj[key]=val;},
    async publish() {await publishCourtGame(client,snapshot);},
  };
}

test("each question has its own permanent voting message; result edits only that question", async()=>{
  const x=fixture();
  try {
    await x.publish();
    const answer = x.posts.get("r1-answer");
    assert.ok(answer?.messageId);
    assert.ok(x.messages.get("lobby-1").content.includes("Lobby closed"));
    x.setPhase("voting",0);
    await x.publish();
    const first=x.posts.get("r1-question-0");
    assert.ok(first?.messageId);
    assert.notEqual(first.messageId,answer.messageId);
    assert.match(x.messages.get(first.messageId).content,/Vote for your favorite/);
    assert.match(x.messages.get(answer.messageId).content,/Entries closed/);

    x.setPhase("reveal",0);
    await x.publish();
    assert.equal(x.posts.get("r1-question-0").messageId,first.messageId);
    assert.match(x.messages.get(first.messageId).content,/A funny answer/);
    assert.match(x.messages.get(first.messageId).content,/1 vote, 1000 pts/);
    assert.match(x.messages.get(first.messageId).content,/0 votes, 0 pts/);
    assert.deepEqual(x.messages.get(first.messageId).components,[]);

    x.setPhase("voting",1);
    await x.publish();
    const second=x.posts.get("r1-question-1");
    assert.ok(second?.messageId);
    assert.notEqual(first.messageId,second.messageId);
    assert.ok(x.history.filter(row=>row[0]==="send").length===3);
    assert.match(x.messages.get(first.messageId).content,/pts/);
    assert.match(x.messages.get(second.messageId).content,/Question two/);
  } finally{x.restore();}
});

test("repeated reconciliation and restarts never send duplicate messages",async()=>{
  const x=fixture();
  try{
    x.setPhase("voting",0);
    await x.publish();
    const count=x.history.filter(row=>row[0]==="send").length;
    await x.publish();
    assert.equal(x.history.filter(row=>row[0]==="send").length,count);
    // Simulate process dying after Discord successfully sends the first vote,
    // but before its message ID is persisted in MongoDB.
    const first=x.posts.get("r1-question-0");
    const existing=first.messageId;
    first.messageId="";
    first.renderedVariant="";
    first.renderedVersion=0;
    await x.publish();
    assert.equal(first.messageId,existing);
    assert.equal(x.history.filter(row=>row[0]==="send").length,count);
  }finally{x.restore();}
});

test("completed votes and round standings remain visible after next round starts",async()=>{
  const x=fixture();
  try{
    x.setPhase("reveal",1);
    await x.publish();
    x.setPhase("intermission",1);
    await x.publish();
    const oldBreak=x.posts.get("r1-break");
    assert.ok(oldBreak?.messageId);
    assert.equal(x.messages.get(oldBreak.messageId).components[0].components[0].data.label,"Start Next Round");

    x.snapshot.round=2;
    x.snapshot.matchups=[
      {playerIds:[a,b],promptId:3,prompt:"Third question?"},
      {playerIds:[a,b],promptId:4,prompt:"Fourth question?"},
    ];
    x.snapshot.roundMatchups["2"]=x.snapshot.matchups;
    x.setPhase("answering",0);
    await x.publish();
    assert.ok(x.posts.get("r2-answer")?.messageId);
    assert.notEqual(x.posts.get("r1-break").messageId,x.posts.get("r2-answer").messageId);
    assert.deepEqual(x.messages.get(oldBreak.messageId).components,[]);
    assert.ok(x.posts.get("r1-question-0")?.messageId);
    assert.ok(x.posts.get("r1-question-1")?.messageId);
  }finally{x.restore();}
});
