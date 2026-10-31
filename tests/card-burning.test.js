import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import CardCopy from "../models/CardCopy.js";
import CardCollector from "../models/CardCollector.js";
import CardDefinition from "../models/CardDefinition.js";
import CardLifecycleEvent from "../models/CardLifecycleEvent.js";
import PetCatalog from "../models/PetCatalog.js";
import { data as cardsCommand } from "../commands/cards.js";
import { parseHatchemText, HATCHEM_HELP } from "../services/hatchem-text-commands.js";
import {
  parseBurnCardReferences, calculateBurnDust, getCardDustBalance, isBurnableCardTag,
  prepareCardBurn, confirmCardBurn, cancelCardBurn, getPendingCardBurn,
} from "../services/card-burns.js";
import { cardBurnPreview, formatDustRewards, dustBalanceText } from "../commands/card-burn-ui.js";

const user="123456789012345678", guild="234567890123456789";
const defId=new mongoose.Types.ObjectId("68caaaaa1234567812345678");
const makeCopy=(id,index,rarity="Rare",upgradeLevel="normal",tag="")=>({
  _id:new mongoose.Types.ObjectId("68caaaaa1234567812345"+String(index).padStart(3,"0")),
  publicId:id,cardDefinitionId:defId,ownerDiscordUserId:user,state:"owned",
  rarity,upgradeLevel,tag,
});

test("members have .burn and .dust commands, slash burn ID autocomplete and safe confirmation",()=>{
 assert.deepEqual(parseHatchemText(".burn KxQOo Abc12"),
   {action:"burn",options:{card_ids:"KxQOo Abc12"}});
 assert.deepEqual(parseHatchemText(".dust"),{action:"dust",options:{}});
 assert.match(HATCHEM_HELP,/\.burn CARDID/);
 const burn=cardsCommand.toJSON().options.find(o=>o.name==="burn");
 assert.ok(burn);
 assert.equal(burn.options[0].name,"card_ids");
 assert.equal(burn.options[0].autocomplete,true);
 assert.ok(cardsCommand.toJSON().options.some(o=>o.name==="dust"));

});

test("burn reference parser only accepts unique five-character card IDs",()=>{
 assert.deepEqual(parseBurnCardReferences("K-Q0i, abc12\nAB_99"),["K-Q0i","abc12","AB_99"]);
 assert.throws(()=>parseBurnCardReferences(""),/Use .burn/);
 assert.throws(()=>parseBurnCardReferences("KxQOo KxQOo"),/twice/);
 assert.throws(()=>parseBurnCardReferences("Abyssinian Cat"),/five-character/);
 assert.deepEqual(parseBurnCardReferences("tag:burn"),["tag:burn"]);
 assert.deepEqual(parseBurnCardReferences("TAG:BURN"),["tag:burn"]);
 for(const other of ["tag:cute","tag:favorites","tag:Burn Later","tag:burned","tag:burn Abc12","Abc12 tag:burn"])
  assert.throws(()=>parseBurnCardReferences(other),/Only tag:burn|on its own/);
 assert.throws(()=>parseBurnCardReferences(Array(51).fill("AAAA1").join(" ")),/up to 50/);
});

test("reward amounts are provisional, proportional to rarity and upgrade stage",()=>{
 const cards=[
  {rarity:"Common",upgradeLevel:"normal"},
  {rarity:"Common",upgradeLevel:"neon"},
  {rarity:"Rare",upgradeLevel:"mega"},
  {rarity:"Legendary",upgradeLevel:"normal"},
 ];
 assert.deepEqual(calculateBurnDust(cards),{"Common":6,"Rare":19,"Legendary":1});
 assert.throws(()=>calculateBurnDust([{rarity:"Mythic",upgradeLevel:"normal"}]),/Cannot determine/);
 assert.equal(formatDustRewards({Rare:4,Common:1}),"4 Rare Dust · 1 Common Dust");
});

test("dust balance displays every rarity and defaults to zero",async()=>{
 const original=CardCollector.findOne;
 try{
  CardCollector.findOne=()=>({select:()=>({lean:async()=>({dust:{Rare:9,"Ultra-Rare":2}})})});
  const wallet=await getCardDustBalance(user);
  assert.deepEqual(wallet,{Common:0,Uncommon:0,Rare:9,"Ultra-Rare":2,Legendary:0});
  assert.match(dustBalanceText(wallet),/Rare:\*\* 9/);
  assert.match(dustBalanceText(wallet),/Legendary:\*\* 0/);
 }finally{CardCollector.findOne=original;}
});

test("burn preview displays IDs and dust amounts and always requires confirmation",()=>{
 const item=makeCopy("Abc12",1);
 const req={token:"testtoken",cards:[{...item,name:"Cat",releaseId:"test-s1-r1",definitionId:String(defId)}],dust:{Rare:1}};
 const view=cardBurnPreview(req);
 assert.match(view.embeds[0].data.title,/Burn Cards/);
 assert.match(view.embeds[0].data.description,/permanently destroyed/);
 assert.match(view.embeds[0].data.description,/Only the burn tag/);
 assert.equal(view.components[0].components.length,2);
 assert.match(view.components[0].components[0].data.label,/Burn 1 Card/);
 assert.match(view.components[0].components[1].data.label,/Keep Cards/);
});

test("a large burn preview lists every selected ID, not just the first 12 pet names",()=>{
  const cards=Array.from({length:20},(_,i)=>({
    name:"Cat",publicId:"A"+String(i).padStart(4,"0"),
    rarity:"Common",upgradeLevel:"normal",
  }));
  const preview=cardBurnPreview({token:"long",cards,dust:{Common:20}});
  const ids=preview.embeds[0].data.fields.find(f=>f.name==="All selected card IDs");
  assert.ok(ids);
  for(const card of cards)assert.ok(ids.value.includes(card.publicId));
});

test("tagged cards cannot enter a burn confirmation; their ID is still owned",async()=>{
 const original=CardCopy.findOne;
 try {
  CardCopy.findOne=query=>({lean:async()=>makeCopy("Abc12",1,"Rare","normal","favorites")});
  await assert.rejects(()=>prepareCardBurn({ownerId:user,guildId:guild,cardReferences:"Abc12"}),/Tagged cards are protected/);
 }finally{CardCopy.findOne=original;}
});

test("prepare and cancel a burn does not change ownership, dust or card counts",async()=>{
 const orig={findOne:CardCopy.findOne,defs:CardDefinition.find,pets:PetCatalog.find};
 try{
  CardCopy.findOne=query=>({lean:async()=>query.publicId==="Abc12"?makeCopy("Abc12",1):null});
  CardDefinition.find=()=>({select:()=>({lean:async()=>[{
    _id:defId,petId:"cat",rarity:"Rare",releaseId:"r1",
  }]})});
  PetCatalog.find=()=>({select:()=>({lean:async()=>[{petId:"cat",name:"Cat"}]})});
  const request=await prepareCardBurn({ownerId:user,guildId:guild,cardReferences:"Abc12"});
  assert.equal(request.cards.length,1);
  assert.deepEqual(request.dust,{Rare:1});
  assert.throws(()=>getPendingCardBurn(request.token,"someoneelse",guild),/Only the collector/);
  cancelCardBurn(request.token,user,guild);
  assert.throws(()=>getPendingCardBurn(request.token,user,guild),/expired/);
 } finally {
  CardCopy.findOne=orig.findOne;CardDefinition.find=orig.defs;PetCatalog.find=orig.pets;
 }
});

test("burn transaction moves cards to burned, credits dust once, and records one event per copy",async()=>{
 const originals={
  start:mongoose.startSession,findOne:CardCopy.findOne,
  defs:CardDefinition.find,pets:PetCatalog.find,
  find:CardCopy.find, update:CardCopy.updateMany,
  eventFind:CardLifecycleEvent.exists,eventCreate:CardLifecycleEvent.create,
  collectorUpdate:CardCollector.updateOne,
 };
 try {
  CardCopy.findOne=query=>({lean:async()=>{
    return query.publicId==="Abc12"?makeCopy("Abc12",1):query.publicId==="Def34"?makeCopy("Def34",2):null;
  }});
  CardDefinition.find=()=>({select:()=>({lean:async()=>[{
    _id:defId,petId:"cat",rarity:"Rare",releaseId:"r1",
  }]})});
  PetCatalog.find=()=>({select:()=>({lean:async()=>[{petId:"cat",name:"Cat"}]})});
  const request=await prepareCardBurn({ownerId:user,guildId:guild,cardReferences:"Abc12 Def34"});
  assert.deepEqual(request.dust,{Rare:2});
  const session={withTransaction:fn=>fn(),endSession:async()=>{}};
  mongoose.startSession=async()=>session;
  CardLifecycleEvent.exists=()=>({session:async()=>null});
  CardCopy.find=()=>({session:()=>({lean:async()=>[makeCopy("Abc12",1),makeCopy("Def34",2)]})});
  let updates=0, credit=0, events=0;
  CardCopy.updateMany=async(query,change,opts)=>{
    assert.equal(opts.session,session);
    assert.equal(change.$set.state,"burned");
    assert.equal(query.ownerDiscordUserId,user);
    assert.deepEqual(query.tag.$in.slice(0,2),["",null]);
    assert.match("BURN",query.tag.$in[2]);
    assert.doesNotMatch("cute",query.tag.$in[2]);
    updates++;return {modifiedCount:2};
  };
  CardCollector.updateOne=async(query,change,opts)=>{
    assert.equal(query.discordUserId,user);
    assert.equal(opts.session,session);
    assert.deepEqual(change.$inc,{"dust.Rare":2});
    credit++;return {matchedCount:1};
  };
  CardLifecycleEvent.create=async(entries,opts)=>{
    assert.equal(opts.session,session);
    assert.equal(entries.length,2);
    assert.equal(entries[0].eventType,"burn");
    assert.equal(entries[1].eventType,"burn");
    assert.notEqual(entries[0].operationKey,entries[1].operationKey);
    events=entries.length;
  };
  const result=await confirmCardBurn(request.token,user,guild);
  assert.deepEqual(result.dust,{Rare:2});
  assert.equal(result.count,2);
  assert.equal(updates,1);assert.equal(credit,1);assert.equal(events,2);
  await assert.rejects(async()=>confirmCardBurn(request.token,user,guild),/expired/);
  assert.equal(credit,1,"double-click must not award extra dust");
 } finally {
  mongoose.startSession=originals.start;CardCopy.findOne=originals.findOne;
  CardDefinition.find=originals.defs;PetCatalog.find=originals.pets;
  CardCopy.find=originals.find;CardCopy.updateMany=originals.update;
  CardLifecycleEvent.exists=originals.eventFind;CardLifecycleEvent.create=originals.eventCreate;
  CardCollector.updateOne=originals.collectorUpdate;
 }
});


test("trading a card or adding a tag after preview blocks the whole burn before dust credit",async()=>{
 const orig={
   start:mongoose.startSession, findOne:CardCopy.findOne,defs:CardDefinition.find,
   pets:PetCatalog.find,find:CardCopy.find,update:CardCopy.updateMany,
   wallet:CardCollector.updateOne,event:CardLifecycleEvent.exists,
 };
 try {
   CardCopy.findOne=query=>({lean:async()=>makeCopy("Abc12",1)});
   CardDefinition.find=()=>({select:()=>({lean:async()=>[
     {_id:defId,petId:"cat",rarity:"Rare",releaseId:"r1"},
   ]})});
   PetCatalog.find=()=>({select:()=>({lean:async()=>[{petId:"cat",name:"Cat"}]})});
   const pending=await prepareCardBurn({ownerId:user,guildId:guild,cardReferences:"Abc12"});
   mongoose.startSession=async()=>({withTransaction:fn=>fn(),endSession:async()=>{}});
   CardLifecycleEvent.exists=()=>({session:async()=>null});
   let spent=0;
   CardCopy.updateMany=async()=>{spent++;throw Error("Card state must be checked first");};
   CardCollector.updateOne=async()=>{spent++;throw Error("Must not grant dust");};
   CardCopy.find=()=>({session:()=>({lean:async()=>[
     {...makeCopy("Abc12",1),ownerDiscordUserId:"another-user"},
   ]})});
   await assert.rejects(()=>confirmCardBurn(pending.token,user,guild),/no longer owned|Nothing was burned/);
   assert.equal(spent,0);
   CardCopy.find=()=>({session:()=>({lean:async()=>[
     {...makeCopy("Abc12",1),tag:"favorites"},
   ]})});
   await assert.rejects(()=>confirmCardBurn(pending.token,user,guild),/now tagged/);
   assert.equal(spent,0);
   cancelCardBurn(pending.token,user,guild);
 } finally {
   mongoose.startSession=orig.start;CardCopy.findOne=orig.findOne;
   CardDefinition.find=orig.defs;PetCatalog.find=orig.pets;
   CardCopy.find=orig.find;CardCopy.updateMany=orig.update;
   CardCollector.updateOne=orig.wallet;CardLifecycleEvent.exists=orig.event;
 }
});


test("only the exact burn tag is burnable; other tags remain protective",()=>{
 for(const tag of ["","  ","burn","BURN","Burn",null,undefined])assert.equal(isBurnableCardTag(tag),true);
 for(const tag of ["favorites","cute","burned","burn later","unburn"])assert.equal(isBurnableCardTag(tag),false);
});

test(".burn tag:burn selects exactly the owner's created-tagged cards, including old ID symbols",async()=>{
 const originals={collector:CardCollector.findOne,find:CardCopy.find,findOne:CardCopy.findOne,defs:CardDefinition.find,pets:PetCatalog.find};
 try{
  CardCollector.findOne=()=>({select:()=>({lean:async()=>({createdTagNames:["Burn"]})})});
  CardCopy.find=query=>{
    assert.equal(query.ownerDiscordUserId,user);
    assert.equal(query.state,"owned");
    assert.match("BURN",query.tag);
    assert.doesNotMatch("favorites",query.tag);
    return {select:()=>({lean:async()=>[{publicId:"Abc12"},{publicId:"K-Q0i"}]})};
  };
  CardCopy.findOne=query=>({lean:async()=>{
    if(query.publicId==="Abc12")return makeCopy("Abc12",1,"Rare","normal","burn");
    if(query.publicId==="K-Q0i")return makeCopy("K-Q0i",2,"Rare","neon","BURN");
    return null;
  }});
  CardDefinition.find=()=>({select:()=>({lean:async()=>[{
   _id:defId,petId:"cat",rarity:"Rare",releaseId:"r1",
  }]})});
  PetCatalog.find=()=>({select:()=>({lean:async()=>[{petId:"cat",name:"Cat"}]})});
  const pending=await prepareCardBurn({ownerId:user,guildId:guild,cardReferences:"TAG:BURN"});
  assert.deepEqual(pending.cards.map(c=>c.publicId),["Abc12","K-Q0i"]);
  assert.deepEqual(pending.dust,{Rare:6});
  assert.equal(pending.cards[1].tag,"burn");
  cancelCardBurn(pending.token,user,guild);
 }finally{
  CardCollector.findOne=originals.collector;CardCopy.find=originals.find;CardCopy.findOne=originals.findOne;
  CardDefinition.find=originals.defs;PetCatalog.find=originals.pets;
 }
});

test("burn tag group selection refuses uncreated or empty selections",async()=>{
 const originals={collector:CardCollector.findOne,find:CardCopy.find};
 try{
  CardCollector.findOne=()=>({select:()=>({lean:async()=>({createdTagNames:["favorites"]})})});
  CardCopy.find=()=>{throw Error("Must not read cards for an uncreated tag");};
  await assert.rejects(()=>prepareCardBurn({ownerId:user,guildId:guild,cardReferences:"tag:burn"}),/createtag burn/);
  CardCollector.findOne=()=>({select:()=>({lean:async()=>({createdTagNames:["burn"]})})});
  CardCopy.find=()=>({select:()=>({lean:async()=>[]})});
  await assert.rejects(()=>prepareCardBurn({ownerId:user,guildId:guild,cardReferences:"tag:burn"}),/No owned cards/);
 }finally{CardCollector.findOne=originals.collector;CardCopy.find=originals.find;}
});

test("burning a burn-tagged card succeeds transactionally without requiring an untag",async()=>{
 const originals={start:mongoose.startSession,copy:CardCopy.findOne,defs:CardDefinition.find,pets:PetCatalog.find,
  find:CardCopy.find,update:CardCopy.updateMany,collector:CardCollector.updateOne,
  eventFind:CardLifecycleEvent.exists,eventCreate:CardLifecycleEvent.create};
 try{
  const copy=makeCopy("Abc12",1,"Legendary","mega","burn");
  CardCopy.findOne=()=>({lean:async()=>copy});
  CardDefinition.find=()=>({select:()=>({lean:async()=>[{
   _id:defId,petId:"cat",rarity:"Legendary",releaseId:"r1",
  }]})});
  PetCatalog.find=()=>({select:()=>({lean:async()=>[{petId:"cat",name:"Cat"}]})});
  const pending=await prepareCardBurn({ownerId:user,guildId:guild,cardReferences:"Abc12"});
  assert.deepEqual(pending.dust,{Legendary:19});
  const sess={withTransaction:fn=>fn(),endSession:async()=>{}};
  mongoose.startSession=async()=>sess;
  CardCopy.find=()=>({session:()=>({lean:async()=>[copy]})});
  CardLifecycleEvent.exists=()=>({session:async()=>null});
  let modified=0;
  CardCopy.updateMany=async(query)=> {
    assert.match("Burn",query.tag.$in[2]);
    assert.doesNotMatch("cute",query.tag.$in[2]);
    modified++;return {modifiedCount:1};
  };
  CardCollector.updateOne=async(_query,update)=> {
    assert.deepEqual(update.$inc,{"dust.Legendary":19});
    return {matchedCount:1};
  };
  CardLifecycleEvent.create=async(entries)=>{assert.equal(entries.length,1);};
  const result=await confirmCardBurn(pending.token,user,guild);
  assert.equal(result.count,1);
  assert.equal(modified,1);
 }finally{
  mongoose.startSession=originals.start;CardCopy.findOne=originals.copy;CardDefinition.find=originals.defs;
  PetCatalog.find=originals.pets;CardCopy.find=originals.find;CardCopy.updateMany=originals.update;
  CardCollector.updateOne=originals.collector;CardLifecycleEvent.exists=originals.eventFind;
  CardLifecycleEvent.create=originals.eventCreate;
 }
});
