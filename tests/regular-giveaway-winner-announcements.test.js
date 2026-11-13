import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import {giveawayAnnouncement,publishRegularWinnerAnnouncement} from "../services/giveaways.js";

const guildId="123456789012345678";
const regularChannelId="234567890123456789";
const winnerChannelId="345678901234567890";
const originalId="456789012345678901";
const firstWinner="567890123456789012";
const secondWinner="678901234567890123";

function harness(){
  const original={findOne:GuildConfig.findOne,updateOne:Giveaway.updateOne};
  const sent=[],edits=[],deleted=[],messages=new Map();
  let next=0;
  const record={
    _id:"507f1f77bcf86cd799439011",guildId,channelId:regularChannelId,
    messageId:originalId,mode:"standard",status:"ended",
    title:"Fox Giveaway",prize:"Pet",creatorId:"789012345678901234",
    endsAt:new Date("2026-11-13T13:00:00Z"),
    winnerIds:[firstWinner],claimResolvedSlots:[],entrantIds:[firstWinner,secondWinner],
    claimStartedAt:new Date("2026-11-13T13:00:00Z"),
    winnerAssignedAt:[new Date("2026-11-13T13:00:00Z")],
    claimWindowHours:24,winnerClaims:[],regularWinnerMessageId:"",
    regularWinnerNotifiedIds:[],publicListingRemovedAt:null,
  };
  const channel={
    id:winnerChannelId,
    messages:{fetch:async key=>{
      if(typeof key==="string"){
        const found=messages.get(key);
        if(!found||found.deleted)throw {code:10008};
        return found;
      }
      return {find:predicate=>[...messages.values()].reverse().find(m=>!m.deleted&&predicate(m))||null};
    }},
    send:async payload=>{
      const id=String(890000000000000000n+BigInt(++next));
      const message={
        id,author:{id:"bot"},content:payload.content,deleted:false,
        edit:async data=>{edits.push(data);message.content=data.content;return message;},
        delete:async()=>{deleted.push(id);message.deleted=true;},
      };
      sent.push(payload);messages.set(id,message);return message;
    }
  };
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({activityGiveawayWinnersChannelId:winnerChannelId})})});
  Giveaway.updateOne=async (_query,changes)=>{
    Object.assign(record,changes.$set);
    const ids=changes.$addToSet?.regularWinnerNotifiedIds?.$each||[];
    record.regularWinnerNotifiedIds=[...new Set([...record.regularWinnerNotifiedIds,...ids])];
    return {modifiedCount:1};
  };
  const client={user:{id:"bot"},channels:{fetch:async id=>{
    assert.equal(id,winnerChannelId);
    return channel;
  }}};
  const publish=()=>publishRegularWinnerAnnouncement(client,record,giveawayAnnouncement(record));
  const restore=()=>{GuildConfig.findOne=original.findOne;Giveaway.updateOne=original.updateOne;};
  return {record,sent,edits,deleted,messages,publish,restore};
}

test("regular winners are posted to the shared Activity Winners channel and explicitly pinged once",async()=>{
  const h=harness();
  try{
    assert.equal(await h.publish(),true);
    assert.equal(h.sent.length,1);
    assert.match(h.sent[0].content,/Regular Giveaway Results/);
    assert.match(h.sent[0].content,new RegExp("<@"+firstWinner+">"));
    assert.deepEqual(h.sent[0].allowedMentions,{parse:[],users:[firstWinner]});
    assert.match(h.sent[0].content,new RegExp(regularChannelId+"/"+originalId));
    assert.equal(h.record.regularWinnerNotifiedIds.includes(firstWinner),true);
    assert.ok(h.record.regularWinnerMessageId);
    await h.publish();
    assert.equal(h.sent.length,1,"reconciliation only edits the existing result");
    assert.equal(h.edits.length,1);
    assert.deepEqual(h.edits[0].allowedMentions,{parse:[]});
  }finally{h.restore();}
});

test("a reroll replaces the winners-channel post and notifies only the replacement",async()=>{
  const h=harness();
  try{
    await h.publish();
    const oldId=h.record.regularWinnerMessageId;
    h.record.winnerIds=[secondWinner];
    h.record.winnerAssignedAt=[new Date("2026-11-13T14:00:00Z")];
    await h.publish();
    assert.equal(h.sent.length,2);
    assert.deepEqual(h.sent[1].allowedMentions,{parse:[],users:[secondWinner]});
    assert.ok(h.sent[1].content.includes("<@"+secondWinner+">"));
    assert.equal(h.deleted.includes(oldId),true);
    await h.publish();
    assert.equal(h.sent.length,2,"later sweeps must not ping the reroll again");
  }finally{h.restore();}
});

test("a restart recovers a result posted before MongoDB saved its message ID",async()=>{
  const h=harness();
  try{
    await h.publish();
    h.record.regularWinnerMessageId="";
    h.record.regularWinnerNotifiedIds=[];
    await h.publish();
    assert.equal(h.sent.length,1,"identical recent post must be recovered, not sent twice");
    assert.deepEqual(h.record.regularWinnerNotifiedIds,[firstWinner]);
  }finally{h.restore();}
});

test("no-winner regular giveaways do not send secondary winner notifications",async()=>{
  const h=harness();
  try{
    h.record.winnerIds=[];
    assert.equal(await h.publish(),false);
    assert.equal(h.sent.length,0);
  }finally{h.restore();}
});
