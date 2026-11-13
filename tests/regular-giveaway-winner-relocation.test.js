import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import Giveaway from "../models/Giveaway.js";
import {publishGiveawayResult} from "../services/giveaways.js";

const guildId="123456789012345678";
const sourceId="234567890123456789",winnerChannelId="345678901234567890";
const oldId="456789012345678901",newId="567890123456789012";
const creatorId="678901234567890123",winnerId="789012345678901234";
const giveawayId="507f1f77bcf86cd799439010";

function fixture(overrides={}){
 return {
  _id:giveawayId,guildId,mode:"standard",status:"ended",
  creatorId,title:"Court prize",prize:"Pet prize",
  entrantIds:[winnerId],winnerIds:[winnerId],winnerCount:1,
  claimWindowHours:12,claimStartedAt:new Date(),winnerAssignedAt:[new Date()],
  endsAt:new Date(),channelId:sourceId,messageId:oldId,
  resultChannelId:winnerChannelId,renderVersion:1,renderedAt:null,
  publicListingRemovedAt:null,claimResolvedSlots:[],rerollHistory:[],
  bannerNameKey:"",...overrides,
 };
}
async function harness(overrides={}){
 const original={config:GuildConfig.findOne,update:Giveaway.updateOne};
 let stored=fixture(overrides), deletionFails=false,sendFails=false;
 const calls={sent:[],edits:[],deleted:[],updates:[]};
 const published=[];
 const originalMessage={id:oldId,author:{id:"bot"},
   embeds:[{footer:{text:"Giveaway ID: "+giveawayId}}],
   edit:async payload=>calls.edits.push(["source",payload]),
   delete:async()=>{
     if(deletionFails)throw Error("Temporary delete failure");
     calls.deleted.push("source");
   }};
 const destinationMessage={
   id:newId,author:{id:"bot"},embeds:[{footer:{text:"Giveaway ID: "+giveawayId}}],
   edit:async payload=>calls.edits.push(["winner",payload]),
   delete:async()=>calls.deleted.push("winner")
 };
 const source={
   id:sourceId,messages:{fetch:async arg=>
     typeof arg==="string"?(calls.deleted.includes("source")?null:originalMessage):[]},
 };
 const destination={
   id:winnerChannelId,
   messages:{fetch:async arg=>
     typeof arg==="object"?published:[...published].find(m=>m.id===arg)||null},
   send:async payload=>{
     if(sendFails)throw Error("Cannot send to winners");
     calls.sent.push(payload);
     published.push(destinationMessage);
     return destinationMessage;
   }
 };
 const client={user:{id:"bot"},channels:{fetch:async id=>
   id===sourceId?source:id===winnerChannelId?destination:null}};
 const config={giveawayDefaultBannerNameKey:"",activityGiveawayWinnersChannelId:winnerChannelId};
 GuildConfig.findOne=()=>({
   then:(resolve,reject)=>Promise.resolve(config).then(resolve,reject),
   select:()=>({lean:async()=>config})
 });
 Giveaway.updateOne=async(query,update)=>{
   calls.updates.push({query,update});
   if(query.channelId && (stored.channelId!==query.channelId||stored.messageId!==query.messageId))
     return {matchedCount:0};
   if(query.listMessageId && stored.listMessageId!==query.listMessageId)
     return {matchedCount:0};
   Object.assign(stored,update.$set||{});
   return {matchedCount:1,modifiedCount:1};
 };
 return {
   client,calls,config,published,getStored:()=>({...stored}),
   setStored:values=>Object.assign(stored,values),
   setDeleteFails:value=>{deletionFails=value;},
   setSendFails:value=>{sendFails=value;},
   restore:()=>{GuildConfig.findOne=original.config;Giveaway.updateOne=original.update;}
 };
}

test("a regular giveaway transfers one winner result, deletes old list post and retains live claim button",async()=>{
 const h=await harness();
 try{
  assert.equal(await publishGiveawayResult(h.client,h.getStored()),true);
  const r=h.getStored();
  assert.equal(r.channelId,winnerChannelId);
  assert.equal(r.messageId,newId);
  assert.equal(r.resultChannelId,winnerChannelId);
  assert.equal(r.listChannelId,"");
  assert.equal(r.listMessageId,"");
  assert.equal(h.calls.sent.length,1);
  assert.deepEqual(h.calls.deleted,["source"]);
  const sent=h.calls.sent[0];
  assert.match(sent.embeds[0].toJSON().description,/Winners \/ Results/);
  assert.ok(sent.components.flatMap(row=>row.components)
    .some(button=>button.toJSON().custom_id==="giveaway:claim:"+giveawayId));
  assert.deepEqual(sent.allowedMentions,{parse:[]});
  assert.ok(r.renderedAt instanceof Date);
  h.setStored({renderVersion:2,renderedAt:null});
  await publishGiveawayResult(h.client,h.getStored());
  assert.equal(h.calls.sent.length,1,"rerolls must update the existing Winners message");
  assert.deepEqual(h.calls.deleted,["source"]);
 }finally{h.restore();}
});

test("a failed source deletion resumes on the same winner post after restart",async()=>{
 const h=await harness();
 try{
  h.setDeleteFails(true);
  await assert.rejects(()=>publishGiveawayResult(h.client,h.getStored()),/Temporary delete/);
  assert.equal(h.getStored().channelId,winnerChannelId);
  assert.equal(h.getStored().listChannelId,sourceId);
  assert.equal(h.getStored().listMessageId,oldId);
  assert.equal(h.getStored().renderedAt,null);
  h.setDeleteFails(false);
  await publishGiveawayResult(h.client,h.getStored());
  assert.equal(h.calls.sent.length,1);
  assert.deepEqual(h.calls.deleted,["source"]);
  assert.equal(h.getStored().listMessageId,"");
  assert.ok(h.getStored().renderedAt instanceof Date);
 }finally{h.restore();}
});

test("the bot recovers a winner result posted before the MongoDB transfer update",async()=>{
 const h=await harness();
 try{
  h.setSendFails(false);
  let attempts=0;
  const oldUpdate=Giveaway.updateOne;
  Giveaway.updateOne=async(q,u)=>{
    if(q.channelId&&attempts++===0)throw Error("MongoDB temporary outage");
    return oldUpdate(q,u);
  };
  await assert.rejects(()=>publishGiveawayResult(h.client,h.getStored()),/MongoDB temporary outage/);
  assert.equal(h.calls.sent.length,1);
  assert.equal(h.getStored().channelId,sourceId);
  await publishGiveawayResult(h.client,h.getStored());
  assert.equal(h.calls.sent.length,1,"a repost after failure must be discovered by Giveaway ID");
  assert.equal(h.getStored().channelId,winnerChannelId);
 }finally{h.restore();}
});

test("legacy servers without a winners channel still edit the original giveaway in place",async()=>{
 const h=await harness({resultChannelId:""});
 try{
  h.config.activityGiveawayWinnersChannelId="";
  await publishGiveawayResult(h.client,h.getStored());
  assert.equal(h.calls.sent.length,0);
  assert.equal(h.getStored().channelId,sourceId);
  assert.equal(h.calls.edits[0][0],"source");
  assert.equal(h.calls.deleted.length,0);
 }finally{h.restore();}
});

test("a failed result send preserves the original list post for a retry",async()=>{
 const h=await harness();
 try{
  h.setSendFails(true);
  await assert.rejects(()=>publishGiveawayResult(h.client,h.getStored()),/Cannot send/);
  assert.equal(h.getStored().channelId,sourceId);
  assert.equal(h.getStored().messageId,oldId);
  assert.equal(h.calls.deleted.length,0);
  assert.equal(h.getStored().renderedAt,null);
 }finally{h.restore();}
});
