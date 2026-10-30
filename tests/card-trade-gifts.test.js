import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import CardCollector from "../models/CardCollector.js";
import CardCopy from "../models/CardCopy.js";
import CardTrade from "../models/CardTrade.js";
import { data as cardCommand } from "../commands/cards.js";
import { parseHatchemText } from "../services/hatchem-text-commands.js";
import { parseTradeCardIds, resolveTradeOfferInput, reviewCardTrade, finalizeCardTrade } from "../services/card-trades.js";
import { tradeButtons, tradePanel } from "../commands/card-trade-ui.js";

const a="123456789012345678",b="234567890123456789",g="345678901234567890";
const tid="507f1f77bcf86cd799439011";
const t=()=>({_id:tid,guildId:g,channelId:g,messageId:"678901234567890123",
 participants:[a,b],participantNames:["Lilly","Jentho"],gift:true,offers:[["Abc12"],[]],
 reviewedBy:[],finalBy:[],revision:0,status:"open",viewPage:0,
 expiresAt:new Date(Date.now()+600_000)});

test(".give accepts IDs and tag selectors; /cards give requires a member and cards",()=>{
 assert.deepEqual(parseHatchemText(".give <@"+b+"> Abc12 Def34"),
   {action:"give",options:{member:"<@"+b+">",cards:"Abc12 Def34"}});
 assert.deepEqual(parseHatchemText(".give <@"+b+"> tag:Very Cute"),
   {action:"give",options:{member:"<@"+b+">",cards:"tag:Very Cute"}});
 const give=cardCommand.toJSON().options.find(x=>x.name==="give");
 assert.ok(give);
 assert.deepEqual(give.options.map(x=>x.name),["member","cards"]);
 assert.ok(give.options.every(x=>x.required));
 assert.equal(parseTradeCardIds("Abc12 Def34 Ghi56 Jkl78 Mno90 Pqr12").length,6);
});

test("only created tag names can select whole groups for trade/gift",async()=>{
 const prev={collector:CardCollector.findOne,copies:CardCopy.find};
 try{
  CardCollector.findOne=()=>({select:()=>({lean:async()=>({createdTagNames:["cute"]})})});
  CardCopy.find=query=>{
   assert.equal(query.ownerDiscordUserId,a);
   assert.equal(query.tag.$regex,"^cute$");
   return {select:()=>({lean:async()=>[{publicId:"Abc12"},{publicId:"Def34"}]})};
  };
  assert.deepEqual(await resolveTradeOfferInput(a,"tag:CuTe"),["Abc12","Def34"]);
  for (const name of ["notcreated","noooo","unknown","surprise"])
   await assert.rejects(()=>resolveTradeOfferInput(a,"tag:"+name),/Create that tag first/);
  assert.deepEqual(await resolveTradeOfferInput(a,"+ Ghi56",["Abc12"]),["Abc12","Ghi56"]);
 }finally{CardCollector.findOne=prev.collector;CardCopy.find=prev.copies;}
});

test("both trade buttons use players' names and longer offers have pages",async()=>{
 const buttons=tradeButtons(t());
 assert.match(buttons[0].components[0].data.label,/Lilly/);
 assert.match(buttons[0].components[1].data.label,/Jentho/);
 const long={...t(),offers:[["Abc12","Def34","Ghi56","Jkl78","Mno90","Pqr12"],[]]};
 const pages=tradeButtons(long);
 assert.equal(pages.length,2);
 assert.match(pages[1].components[1].data.label,/Next/);
 const panel=await tradePanel({...t(),offers:[[],[]]});
 assert.equal(panel.embeds[0].data.fields.length,2);
 assert.equal(panel.embeds[0].data.fields[0].inline,true);
 assert.equal(panel.embeds[0].data.fields[1].inline,true);
});

test("a one-sided gift can finish with both final approvals and no unoffered card transfer",async()=>{
 const prev={session:mongoose.startSession,trade:CardTrade.findById,copy:CardCopy.updateOne,update:CardTrade.updateOne};
 try{
  mongoose.startSession=async()=>({withTransaction:fn=>fn(),endSession:async()=>{}});
  CardTrade.findById=()=>({session:async()=>({...t(),reviewedBy:[a,b],finalBy:[a]})});
  const changes=[];
  CardCopy.updateOne=async (query,change)=>{
    changes.push({from:query.ownerDiscordUserId,to:change.$set.ownerDiscordUserId,id:query.publicId});
    return {modifiedCount:1};
  };
  CardTrade.updateOne=async (_q,change)=>{
    assert.equal(change.$set.status,"completed");return {modifiedCount:1};
  };
  assert.deepEqual(await finalizeCardTrade({tradeId:tid,userId:b,guildId:g}),{completed:true});
  assert.deepEqual(changes,[{from:a,to:b,id:"Abc12"}]);
 }finally{mongoose.startSession=prev.session;CardTrade.findById=prev.trade;
   CardCopy.updateOne=prev.copy;CardTrade.updateOne=prev.update;}
});
