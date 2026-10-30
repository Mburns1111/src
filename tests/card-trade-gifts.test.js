import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import CardCollector from "../models/CardCollector.js";
import CardCopy from "../models/CardCopy.js";
import CardTrade from "../models/CardTrade.js";
import { data as cardCommand } from "../commands/cards.js";
import { parseHatchemText } from "../services/hatchem-text-commands.js";
import { parseTradeCardIds, resolveTradeOfferInput, reviewCardTrade, confirmCardGift } from "../services/card-trades.js";
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

test("gifts have only sender confirmation, while regular trades have named participant buttons",async()=>{
 const gift=t();
 const giftButtons=tradeButtons(gift);
 assert.equal(giftButtons[0].components.length,2);
 assert.match(giftButtons[0].components[0].data.label,/Confirm Gift/);
 assert.match(giftButtons[0].components[1].data.label,/Cancel Gift/);
 const normal={...gift,gift:false};
 assert.match(tradeButtons(normal)[0].components[0].data.label,/Lilly/);
 assert.match(tradeButtons(normal)[0].components[1].data.label,/Jentho/);
 const long={...gift,offers:[["Abc12","Def34","Ghi56","Jkl78","Mno90","Pqr12"],[]]};
 const pages=tradeButtons(long);
 assert.equal(pages.length,2);
 assert.match(pages[1].components[1].data.label,/Next/);
 const giftPanel=await tradePanel({...gift,offers:[[],[]]});
 assert.equal(giftPanel.embeds[0].data.fields.length,1);
 const normalPanel=await tradePanel({...normal,offers:[[],[]]});
 assert.equal(normalPanel.embeds[0].data.fields.length,2);
 assert.equal(normalPanel.embeds[0].data.fields[0].inline,true);
 assert.equal(normalPanel.embeds[0].data.fields[1].inline,true);
});

test("only the giver can confirm once and all gifted cards transfer atomically",async()=>{
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
  await assert.rejects(()=>confirmCardGift({tradeId:tid,userId:b,guildId:g}),/Only the sender/);
  assert.deepEqual(await confirmCardGift({tradeId:tid,userId:a,guildId:g}),{completed:true,count:1,recipientId:b});
  assert.deepEqual(changes,[{from:a,to:b,id:"Abc12"}]);
 }finally{mongoose.startSession=prev.session;CardTrade.findById=prev.trade;
   CardCopy.updateOne=prev.copy;CardTrade.updateOne=prev.update;}
});
