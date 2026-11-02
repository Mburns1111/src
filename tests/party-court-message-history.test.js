import test from "node:test";
import assert from "node:assert/strict";
import PartyGame from "../models/PartyGame.js";
import PartyPost from "../models/PartyPost.js";
import PartyResponse from "../models/PartyResponse.js";
import { publishCourtGame, reconcileCourtGames } from "../services/party-court-engine.js";

const gameId = "507f1f77bcf86cd799439011";
const guildId = "123456789012345678";
const channelId = "234567890123456789";
const a = "345678901234567890", b = "456789012345678901";
const asEmbed = value => typeof value?.toJSON === "function" ? value.toJSON() : value;
function visible(message) {
  return [message?.content || "", ...(message?.embeds || []).map(e => {
    const data=asEmbed(e);
    return [data.title, data.description, ...(data.fields || []).flatMap(f=>[f.name,f.value])].join("\\n");
  })].join("\\n");
}
const original = [
  { playerIds: [a,b], promptId: 1, prompt: "Question one?" },
  { playerIds: [a,b], promptId: 2, prompt: "Question two?" },
];

function fixture({ hydrated = false } = {}) {
  const history = [];
  const posts = new Map();
  let nextMessage = 100;
  const messages = new Map();
  messages.set("lobby-1", {
    id:"lobby-1", content:"Join Court", embeds:[], author:{id:"bot"},
    edit:async function(payload) {this.content=payload.content;this.embeds=payload.embeds || [];this.components=payload.components;history.push(["edit",this.id,visible(this)]);},
  });
  const channel = {
    client:{user:{id:"bot"}},isTextBased:()=>true,
    messages:{fetch:async id => {
      if (typeof id === "object") return new Map(messages);
      if (!messages.has(id)) throw Object.assign(new Error("Unknown Message: "+id), {code:10008});
      return messages.get(id);
    }},
    send:async payload => {
      const id="msg-"+(++nextMessage);
      const message={id,content:payload.content,embeds:payload.embeds || [],author:{id:"bot"},
        components:payload.components,
        edit:async function(next) {this.content=next.content;this.embeds=next.embeds || [];this.components=next.components;history.push(["edit",id,visible(this)]);},
      };
      messages.set(id,message);
      history.push(["send",id,visible(message)]);
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
    return hydrated ? new PartyGame({ ...snapshot }) : { ...snapshot };
  });
  stub(PartyGame,"updateOne",async(query,update)=>{
    if (query.publishingToken && query.publishingToken!==snapshot.publishingToken)
      return {modifiedCount:0};
    Object.assign(snapshot, update.$set);
    for(const [field,amount] of Object.entries(update.$inc || {}))
      snapshot[field] = Number(snapshot[field] || 0) + amount;
    return {modifiedCount:1};
  });
  stub(PartyGame,"findById",async()=>hydrated ? new PartyGame({ ...snapshot }) : { ...snapshot });
  stub(PartyGame,"find",query=>({
    limit:async()=>query.active === true && snapshot.active ? [hydrated ? new PartyGame({ ...snapshot }) : {...snapshot}] : [],
  }));
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
  stub(PartyResponse,"find",()=>({
    lean:async()=>[
      {matchupIndex:0,kind:"answer",userId:a,text:"A funny answer"},
      {matchupIndex:0,kind:"answer",userId:b,text:"A different answer"},
      {matchupIndex:1,kind:"answer",userId:a,text:"Second A"},
      {matchupIndex:1,kind:"answer",userId:b,text:"Second B"},
      {matchupIndex:0,kind:"vote",userId:"spectator",targetId:a},
    ],
    select:()=>({lean:async()=>[
      {userId:a},{userId:a},{userId:b},{userId:b},
    ]}),
  }));
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
    assert.ok(visible(x.messages.get("lobby-1")).includes("Lobby closed"));
    x.setPhase("voting",0);
    await x.publish();
    const first=x.posts.get("r1-question-0");
    assert.ok(first?.messageId);
    assert.ok(first.openedAt instanceof Date);
    assert.ok(x.snapshot.phaseEndsAt.getTime() >= first.openedAt.getTime() + 30_000);
    assert.notEqual(first.messageId,answer.messageId);
    assert.match(visible(x.messages.get(first.messageId)),/Vote for your favorite/);
    assert.match(visible(x.messages.get(answer.messageId)),/Entries closed/);

    x.setPhase("reveal",0);
    await x.publish();
    assert.equal(x.posts.get("r1-question-0").messageId,first.messageId);
    assert.match(visible(x.messages.get(first.messageId)),/A funny answer/);
    assert.match(visible(x.messages.get(first.messageId)),/1 vote[\\s\\S]*1000 pts/);
    assert.match(visible(x.messages.get(first.messageId)),/0 votes[\\s\\S]*0 pts/);
    assert.deepEqual(x.messages.get(first.messageId).components,[]);

    x.setPhase("voting",1);
    await x.publish();
    const second=x.posts.get("r1-question-1");
    assert.ok(second?.messageId);
    assert.notEqual(first.messageId,second.messageId);
    assert.ok(x.history.filter(row=>row[0]==="send").length===3);
    assert.match(visible(x.messages.get(first.messageId)),/pts/);
    assert.match(visible(x.messages.get(second.messageId)),/Question two/);
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

test("reconciliation automatically posts question two after vote one and eight-second result", async()=>{
  const x=fixture();
  try {
    await x.publish();
    assert.equal(x.snapshot.phase,"answering");
    assert.ok(x.posts.get("r1-answer")?.messageId);
    // The entry window was visibly open for 90 seconds. Expiring it should
    // send the FIRST voting question, with its own full 30 seconds to vote.
    x.posts.get("r1-answer").openedAt=new Date(Date.now()-100_000);
    x.snapshot.phaseEndsAt=new Date(Date.now()-1000);
    await reconcileCourtGames(x.client);
    assert.equal(x.snapshot.phase,"voting");
    assert.equal(x.snapshot.batch,0);
    const first=x.posts.get("r1-question-0");
    assert.ok(first?.messageId);
    assert.ok(x.snapshot.phaseEndsAt.getTime() >= first.openedAt.getTime()+30_000);
    // Close first vote; result must replace the buttons on its own post.
    first.openedAt=new Date(Date.now()-40_000);
    x.snapshot.phaseEndsAt=new Date(Date.now()-1000);
    await reconcileCourtGames(x.client);
    assert.equal(x.snapshot.phase,"reveal");
    assert.equal(x.snapshot.batch,0);
    assert.equal(x.posts.get("r1-question-0").renderedVariant,"result");
    assert.deepEqual(x.messages.get(first.messageId).components,[]);
    // After 8 seconds of reveal, a different new message must contain
    // question two, and the first result is still readable.
    x.snapshot.phaseEndsAt=new Date(Date.now()-1000);
    await reconcileCourtGames(x.client);
    assert.equal(x.snapshot.phase,"voting");
    assert.equal(x.snapshot.batch,1);
    const second=x.posts.get("r1-question-1");
    assert.ok(second?.messageId);
    assert.notEqual(second.messageId,first.messageId);
    assert.match(visible(x.messages.get(second.messageId)),/Question two/);
    assert.match(visible(x.messages.get(first.messageId)),/1 vote[\\s\\S]*1000 pts/);
    // The second vote also completes, and the next stage is a staff
    // controlled break, never a silent next-round transition.
    second.openedAt=new Date(Date.now()-40_000);
    x.snapshot.phaseEndsAt=new Date(Date.now()-1000);
    await reconcileCourtGames(x.client);
    assert.equal(x.snapshot.phase,"reveal");
    assert.equal(x.snapshot.batch,1);
    x.snapshot.phaseEndsAt=new Date(Date.now()-1000);
    await reconcileCourtGames(x.client);
    assert.equal(x.snapshot.phase,"intermission");
    assert.ok(x.posts.get("r1-break")?.messageId);
    await reconcileCourtGames(x.client);
    assert.equal(x.snapshot.phase,"intermission");
  }finally{x.restore();}
});

test("deleted old voting message cannot prevent a new question from being sent", async()=>{
  const x=fixture();
  try{
    await x.publish();
    x.setPhase("voting",0);
    await x.publish();
    const first=x.posts.get("r1-question-0");
    x.setPhase("reveal",0);
    await x.publish();
    assert.equal(first.renderedVariant,"result");
    // Mimic an old result that was not marked finalized before Discord
    // deleted it. Subsequent publishes must still create the new question.
    x.messages.delete(first.messageId);
    first.renderedVariant="voting";
    x.setPhase("voting",1);
    await x.publish();
    assert.equal(x.snapshot.phase,"voting");
    assert.equal(first.renderedVariant,"missing");
    assert.ok(x.posts.get("r1-question-1")?.messageId);
    assert.match(visible(x.messages.get(x.posts.get("r1-question-1").messageId)),/Question two/);
  } finally{x.restore();}
});

test("a missing original lobby message cannot stall the answering stage", async()=>{
  const x=fixture();
  try {
    x.messages.delete("lobby-1");
    await x.publish();
    assert.equal(x.snapshot.lobbyArchived,true);
    assert.ok(x.posts.get("r1-answer")?.messageId);
  }finally{x.restore();}
});

test("Mongoose document fields survive historical reveal rebuilding after bot restart", async () => {
  // Prior tests returned plain JS objects, masking the real live crash:
  // {...mongooseDocument} does not copy players/matchups/scores from _doc.
  const x=fixture({hydrated:true});
  try {
    await x.publish();
    x.setPhase("voting",0);
    await x.publish();
    x.setPhase("reveal",0);
    await x.publish();
    assert.equal(x.posts.get("r1-question-0").renderedVariant,"result");
    const text=visible(x.messages.get(x.posts.get("r1-question-0").messageId));
    assert.match(text,/A funny answer/);
    assert.match(text,/A different answer/);
    assert.match(text,/1 vote[\\s\\S]*1000 pts/);
    assert.doesNotMatch(text,/undefined/);
    // A second sweep must work with another rehydrated document.
    await x.publish();
    assert.equal(x.history.filter(event=>event[0]==="send").length,2);
  }finally{x.restore();}
});

test("historical break rendering also retains Mongoose fields on Round 2",async()=>{
  const x=fixture({hydrated:true});
  try {
    await x.publish();
    x.setPhase("reveal",1);
    await x.publish();
    x.setPhase("intermission",1);
    await x.publish();
    const breakPost=x.posts.get("r1-break");
    assert.ok(breakPost?.messageId);
    x.snapshot.round=2;
    x.snapshot.matchups=[
      {playerIds:[a,b],promptId:3,prompt:"Round 2 first?"},
      {playerIds:[a,b],promptId:4,prompt:"Round 2 second?"},
    ];
    x.snapshot.roundMatchups["2"]=x.snapshot.matchups;
    x.setPhase("answering",0);
    await x.publish();
    assert.equal(x.posts.get("r1-break").renderedVariant,"completed");
    assert.ok(x.posts.get("r2-answer")?.messageId);
    assert.match(visible(x.messages.get(breakPost.messageId)),/Round 1 complete/);
  }finally{x.restore();}
});
