import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import CardTrade from "../models/CardTrade.js";
import CardCopy from "../models/CardCopy.js";
import CardCollector from "../models/CardCollector.js";
import { parseTradeCardIds, createCardTrade, setCardTradeOffer,
  reviewCardTrade, finalizeCardTrade, cardTradeDetails } from "../services/card-trades.js";
import { data } from "../commands/cards.js";
import { parseHatchemText, HATCHEM_HELP } from "../services/hatchem-text-commands.js";
import { tradeButtons, tradePanel } from "../commands/card-trade-ui.js";

const a="123456789012345678",b="234567890123456789",g="345678901234567890";
const id="507f1f77bcf86cd799439011";
const active=()=>({ _id:id, guildId:g,channelId:g,messageId:"456789012345678901",
  participants:[a,b],offers:[["Abc12"],["Def34"]],reviewedBy:[],finalBy:[],
  revision:0,status:"open",expiresAt:new Date(Date.now()+600_000) });

test("dot trade accepts a mention; slash trade requires a partner; burn remains unavailable",()=>{
  assert.deepEqual(parseHatchemText(".trade <@"+b+">"),{action:"trade",options:{member:"<@"+b+">"}});
  assert.equal(parseHatchemText(".trade").options.member,"");
  assert.match(HATCHEM_HELP,/\.trade @member/);
  const slash=data.toJSON().options.find(x=>x.name==="trade");
  assert.equal(slash.options[0].name,"member");
  assert.equal(slash.options[0].required,true);
});
test("trade ID lists have no arbitrary five-card cap",()=>{
  assert.deepEqual(parseTradeCardIds("Abc12, Def34\nGhi56"),["Abc12","Def34","Ghi56"]);
  assert.deepEqual(parseTradeCardIds(""),[]);
  assert.throws(()=>parseTradeCardIds("Abc12 Abc12"),/once/);
  assert.throws(()=>parseTradeCardIds("bad"),/five-character/);
  assert.equal(parseTradeCardIds("Abc12 Def34 Ghi56 Jkl78 Mno90 Pqr12").length,6);
});
test("trade keeps two separate offers, two reviews, two finals, and public controls",()=>{
  const schema=CardTrade.schema;
  assert.ok(schema.path("reviewedBy"));
  assert.ok(schema.path("finalBy"));
  assert.ok(schema.path("revision"));
  const t=active();
  assert.equal(tradeButtons(t)[0].components.length,5);
  assert.equal(tradeButtons({...t,status:"completed"}).length,0);
  assert.equal(tradeButtons({...t,reviewedBy:[a,b]})[0].components[3].data.disabled,true===false);
});
test("trade creation requires both collectors to explicitly register in the SAME guild",async()=>{
  const orig={exists:CardCollector.exists,create:CardTrade.create};
  try{
    let n=0;
    CardCollector.exists=async query=>{
      n++;assert.equal(query.registeredGuildIds,g);return query.discordUserId===a?{_id:"ok"}:null;
    };
    CardTrade.create=async()=>{throw Error("Must not create without both registrations");};
    await assert.rejects(()=>createCardTrade({guildId:g,channelId:g,inviterId:a,inviteeId:b}),/Both members/);
    assert.equal(n,2);
  }finally{CardCollector.exists=orig.exists;CardTrade.create=orig.create;}
});
test("modifying offers resets both approval stages and increments revision",async()=>{
  const orig={find:CardTrade.findById,update:CardTrade.findOneAndUpdate,byId:CardCopy.findOne};
  try{
    CardTrade.findById=()=>({lean:async()=>active()});
    CardCopy.findOne=query=>({lean:async()=>({publicId:query.publicId,ownerDiscordUserId:a,state:"owned"})});
    CardTrade.findOneAndUpdate=(where,updates)=> {
      assert.equal(where.revision,0);
      assert.deepEqual(updates.$set.reviewedBy,[]);
      assert.deepEqual(updates.$set.finalBy,[]);
      assert.deepEqual(updates.$set["offers.0"],["KxQOo"]);
      assert.equal(updates.$inc.revision,1);
      return {lean:async()=>({...active(),offers:[["KxQOo"],["Def34"]],revision:1})};
    };
    const changed=await setCardTradeOffer({tradeId:id,userId:a,guildId:g,rawIds:"KxQOo"});
    assert.deepEqual(changed.offers[0],["KxQOo"]);
  }finally{CardTrade.findById=orig.find;CardTrade.findOneAndUpdate=orig.update;CardCopy.findOne=orig.byId;}
});
test("first final confirmation cannot transfer any cards",async()=>{
 const originals={session:mongoose.startSession,trade:CardTrade.findById,update:CardTrade.updateOne,card:CardCopy.updateOne};
 try{
  mongoose.startSession=async()=>({withTransaction:fn=>fn(),endSession:async()=>{}});
  CardTrade.findById=()=>({session:async()=>({...active(),reviewedBy:[a,b]})});
  CardCopy.updateOne=()=>{throw Error("Not until both final confirmations");};
  CardTrade.updateOne=(query,update)=>{
    assert.equal(query.revision,0);assert.deepEqual(update.$addToSet,{finalBy:a});
    return {modifiedCount:1};
  };
  assert.deepEqual(await finalizeCardTrade({tradeId:id,userId:a,guildId:g}),{completed:false});
 }finally{mongoose.startSession=originals.session;CardTrade.findById=originals.trade;
  CardTrade.updateOne=originals.update;CardCopy.updateOne=originals.card;}
});
test("second final confirmation transfers each offer atomically, clears tags, completes once",async()=>{
 const orig={session:mongoose.startSession,trade:CardTrade.findById,update:CardTrade.updateOne,card:CardCopy.updateOne};
 try{
  mongoose.startSession=async()=>({withTransaction:fn=>fn(),endSession:async()=>{}});
  CardTrade.findById=()=>({session:async()=>({...active(),reviewedBy:[a,b],finalBy:[a]})});
  const swaps=[];
  CardCopy.updateOne=async(where,changes,opts)=>{
    assert.ok(opts.session);
    assert.equal(where.state,"owned");
    assert.equal(changes.$set.tag,"");
    swaps.push({from:where.ownerDiscordUserId,to:changes.$set.ownerDiscordUserId,id:where.publicId});
    return {modifiedCount:1};
  };
  CardTrade.updateOne=async(where,changes,opts)=>{
    assert.equal(swaps.length,2);
    assert.deepEqual(changes.$set.finalBy,[a,b]);
    assert.equal(changes.$set.status,"completed");
    return {modifiedCount:1};
  };
  assert.deepEqual(await finalizeCardTrade({tradeId:id,userId:b,guildId:g}),{completed:true});
  assert.deepEqual(swaps,[{from:a,to:b,id:"Abc12"},{from:b,to:a,id:"Def34"}]);
 }finally{mongoose.startSession=orig.session;CardTrade.findById=orig.trade;
  CardTrade.updateOne=orig.update;CardCopy.updateOne=orig.card;}
});
test("trade receipt treats absent scores as not reviewed rather than inventing numerical prices",async()=>{
 const orig={cards:CardCopy.find,defs:(await import("../models/CardDefinition.js")).default.find,
   pets:(await import("../models/PetCatalog.js")).default.find,
   releases:(await import("../models/CardRelease.js")).default.find};
 const CardDefinition=(await import("../models/CardDefinition.js")).default;
 const PetCatalog=(await import("../models/PetCatalog.js")).default;
 const CardRelease=(await import("../models/CardRelease.js")).default;
 try{
  CardCopy.find=()=>({select:()=>({lean:async()=>[
    {publicId:"Abc12",ownerDiscordUserId:a,state:"owned",cardDefinitionId:"def1",upgradeLevel:"neon",tag:"cute"},
    {publicId:"Def34",ownerDiscordUserId:b,state:"owned",cardDefinitionId:"def2",upgradeLevel:"normal",tag:""},
  ]})});
  CardDefinition.find=()=>({select:()=>({lean:async()=>[
    {_id:"def1",petId:"cow",releaseId:"r1",seriesId:"s1",rarity:"Rare",valueReview:{valueScore:2.5,sourceName:"Reviewed"}},
    {_id:"def2",petId:"cat",releaseId:"r1",seriesId:"s1",rarity:"Common",valueReview:{valueScore:null}},
  ]})});
  PetCatalog.find=()=>({select:()=>({lean:async()=>[
    {petId:"cow",name:"Cow"},{petId:"cat",name:"Cat"},
  ]})});
  CardRelease.find=()=>({select:()=>({lean:async()=>[{releaseId:"r1",cardFrameKey:"star"}]})});
  const d=await cardTradeDetails(active());
  assert.equal(d.sides[0][0].reviewedValue,2.5);
  assert.equal(d.sides[1][0].reviewedValue,null);
  const panel=await tradePanel(active());
  assert.match(panel.embeds[0].data.fields[0].value,/2\.5/);
  assert.match(panel.embeds[0].data.fields[1].value,/not reviewed/i);
  assert.match(panel.embeds[0].data.fields[0].value,/Neon/);
 }finally{CardCopy.find=orig.cards;CardDefinition.find=orig.defs;
   PetCatalog.find=orig.pets;CardRelease.find=orig.releases;}
});


test("no transfer can occur before both FIRST approvals",async()=>{
 const orig={session:mongoose.startSession,trade:CardTrade.findById,card:CardCopy.updateOne,update:CardTrade.updateOne};
 try{
  mongoose.startSession=async()=>({withTransaction:fn=>fn(),endSession:async()=>{}});
  CardTrade.findById=()=>({session:async()=>({...active(),reviewedBy:[a]})});
  CardCopy.updateOne=async()=>{throw Error("Must not move cards before both reviews");};
  CardTrade.updateOne=async()=>{throw Error("Must not mark trade completed");};
  await assert.rejects(()=>finalizeCardTrade({tradeId:id,userId:a,guildId:g}),/Both traders/);
 }finally{mongoose.startSession=orig.session;CardTrade.findById=orig.trade;
  CardCopy.updateOne=orig.card;CardTrade.updateOne=orig.update;}
});
test("a conflicting concurrent trade or spent card aborts before status completion",async()=>{
 const orig={session:mongoose.startSession,trade:CardTrade.findById,card:CardCopy.updateOne,update:CardTrade.updateOne};
 try{
  mongoose.startSession=async()=>({withTransaction:fn=>fn(),endSession:async()=>{}});
  CardTrade.findById=()=>({session:async()=>({...active(),reviewedBy:[a,b],finalBy:[a]})});
  CardCopy.updateOne=async()=>({modifiedCount:0});
  CardTrade.updateOne=async()=>{throw Error("Conflict must not complete trade");};
  await assert.rejects(()=>finalizeCardTrade({tradeId:id,userId:b,guildId:g}),/changed ownership/);
 }finally{mongoose.startSession=orig.session;CardTrade.findById=orig.trade;
  CardCopy.updateOne=orig.card;CardTrade.updateOne=orig.update;}
});
test("nonparticipant cannot review, edit, or cancel another member's trade",async()=>{
 const third="789012345678901234";
 const old=CardTrade.findById;
 try{
  CardTrade.findById=()=>({lean:async()=>active()});
  await assert.rejects(()=>reviewCardTrade({tradeId:id,userId:third,guildId:g}),/Only the two traders/);
  await assert.rejects(()=>setCardTradeOffer({tradeId:id,userId:third,guildId:g,rawIds:"Abc12"}),/Only the two traders/);
 }finally{CardTrade.findById=old;}
});
