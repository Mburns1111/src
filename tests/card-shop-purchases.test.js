import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import CardCollector from "../models/CardCollector.js";
import PointsWallet from "../models/PointsWallet.js";
import PointsLedger from "../models/PointsLedger.js";
import { data as cards } from "../commands/cards.js";
import { parseHatchemText } from "../services/hatchem-text-commands.js";
import { CARD_EXTRA_ITEMS, cardExtraPrice, purchaseCardExtras } from "../services/card-shop-purchases.js";
import { cardShopButtons } from "../commands/card-shop-ui.js";

const guildId="234567890123456789",userId="123456789012345678", interactionId="345678901234567890";
const patch=(changes,owner,key,replacement)=>{changes.push([owner,key,owner[key]]);owner[key]=replacement;};
const restore=changes=>{for(const [owner,key,original] of changes.reverse())owner[key]=original;};

test("Hatchem shop uses 10/20 Points, supports one and five, and fits Discord command cap",()=>{
 assert.deepEqual(Object.keys(CARD_EXTRA_ITEMS),["grab","drop"]);
 assert.equal(cardExtraPrice("grab",1),10);
 assert.equal(cardExtraPrice("drop",1),20);
 assert.equal(cardExtraPrice("grab",5),50);
 assert.equal(cardExtraPrice("drop",5),100);
 assert.throws(()=>cardExtraPrice("grab",0));
 assert.throws(()=>cardExtraPrice("drop",100));
 assert.equal(parseHatchemText(".shop").action,"shop");
 const names=cards.toJSON().options.map(o=>o.name);
 assert.ok(names.includes("shop"));
 assert.ok(names.length<=25);
 const components=cardShopButtons(guildId,userId,25)[0].toJSON().components;
 assert.equal(components.length,5);
 assert.equal(components[0].disabled,false);
 assert.equal(components[1].disabled,true);
 assert.equal(components[2].disabled,false);
 assert.equal(components[3].disabled,true);
 assert.match(components[0].custom_id,/cards:shop:buy:grab:1/);
});

test("buying Extra Grabs debits the existing guild Points wallet and grants global extras atomically",async()=>{
 const original=[], session={withTransaction:fn=>fn(),endSession:async()=>{}};
 let current=70,grant=0,receipts=0;
 try{
  patch(original,mongoose,"startSession",async()=>session);
  patch(original,PointsLedger,"exists",()=>({session:async()=>false}));
  patch(original,PointsLedger,"create",async([receipt],options)=>{
   assert.equal(options.session,session);
   assert.equal(receipt.amount,-50);
   assert.equal(receipt.kind,"spend");
   assert.equal(receipt.sourceType,"card_extras");
   assert.equal(receipt.items[0].id,"grab");
   assert.equal(receipt.eventKey,"spend:card_extras:"+interactionId);
   receipts++;return [receipt];
  });
  patch(original,PointsWallet,"findOneAndUpdate",async(query,change,options)=>{
   assert.equal(query.guildId,guildId);
   assert.equal(query.discordUserId,userId);
   assert.equal(query.balance.$gte,50);
   assert.equal(options.session,session);
   current+=change.$inc.balance;
   return {balance:current};
  });
  patch(original,CardCollector,"updateOne",async(query,change,options)=>{
   assert.equal(query.discordUserId,userId);
   assert.equal(query.registeredGuildIds,guildId);
   assert.equal(options.session,session);
   grant+=change.$inc.bonusGrabs;
   return {matchedCount:1,modifiedCount:1};
  });
  const result=await purchaseCardExtras({guildId,userId,kind:"grab",quantity:5,interactionId});
  assert.equal(current,20);
  assert.equal(grant,5);
  assert.equal(receipts,1);
  assert.deepEqual(result,{kind:"grab",quantity:5,amount:50,balanceAfter:20,alreadyProcessed:false});
 }finally{restore(original);}
});

test("insufficient wallet blocks extra grants and duplicate interaction IDs are recognized",async()=>{
 const original=[],session={withTransaction:fn=>fn(),endSession:async()=>{}};
 let isDuplicate=false,grants=0;
 try{
  patch(original,mongoose,"startSession",async()=>session);
  patch(original,PointsLedger,"exists",()=>({session:async()=>isDuplicate}));
  patch(original,PointsWallet,"findOneAndUpdate",async()=>null);
  patch(original,CardCollector,"updateOne",async()=>{grants++;return {matchedCount:1};});
  await assert.rejects(()=>purchaseCardExtras({guildId,userId,kind:"drop",quantity:1,interactionId}),
   error=>error.code==="insufficient");
  assert.equal(grants,0);
  isDuplicate=true;
  assert.deepEqual(await purchaseCardExtras({guildId,userId,kind:"drop",quantity:1,interactionId}),
   {kind:"drop",quantity:1,amount:20,alreadyProcessed:true});
  assert.equal(grants,0);
 }finally{restore(original);}
});
