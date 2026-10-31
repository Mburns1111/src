import test from "node:test";
import assert from "node:assert/strict";
import CardCopy from "../models/CardCopy.js";
import CardClaim from "../models/CardClaim.js";
import CardTrade from "../models/CardTrade.js";
import CardCollector from "../models/CardCollector.js";
import CardLifecycleEvent from "../models/CardLifecycleEvent.js";
import CardAchievement from "../models/CardAchievement.js";
import PetCatalog from "../models/PetCatalog.js";
import CardDefinition from "../models/CardDefinition.js";
import CardRelease from "../models/CardRelease.js";
import { data,ownerCardOptions } from "../commands/cards.js";
import { parseHatchemText } from "../services/hatchem-text-commands.js";
import { calculateDustUpgrade,DUST_UPGRADE_COSTS } from "../services/card-dust-upgrades.js";
import { setCardLock } from "../services/card-locks.js";
import { getCardTradeHistory,formatTradeHistory,formatTradeHistoryItem } from "../services/card-trade-history.js";
import { getAchievementProgress,CARD_ACHIEVEMENTS,formatCardAchievements } from "../services/card-achievements.js";
import { suggestShowCards } from "../services/card-show.js";
import { selectUpgradeSet } from "../services/card-upgrades.js";

const user="123456789012345678",partner="234567890123456789";

test("all new commands are in public test-guild slash definition under Discord's option limit",()=>{
 const commands=data.toJSON().options;
 const names=commands.map(c=>c.name);
 assert.ok(names.length<=25);
 for(const name of ["show","dustupgrade","lock","unlock","history","achievements"])
  assert.ok(names.includes(name),name);
 assert.ok(!names.includes("test-drop"),"test-drop must remain owner-only");
 assert.ok(ownerCardOptions.toJSON().options.find(c=>c.name==="test-drop"));
 assert.equal(commands.find(c=>c.name==="show").options[0].autocomplete,true);
 assert.equal(commands.find(c=>c.name==="dustupgrade").options[0].autocomplete,true);
 for(const text of [".show Abyssinian Cat",".history",".achievements",".lock Abc12",
   ".unlock Abc12",".dustupgrade Abc12",".upgrade Abc12 dust"])
   assert.ok(parseHatchemText(text),text);
 assert.equal(parseHatchemText(".upgrade Abc12 dust").options.use_dust,true);
});

test("dust assisted upgrades need at least one real copy and scale by rarity/stage",()=>{
 assert.deepEqual(DUST_UPGRADE_COSTS,{Common:5,Uncommon:6,Rare:7,"Ultra-Rare":8,Legendary:10});
 assert.deepEqual(calculateDustUpgrade({rarity:"Rare",stage:"normal",cardCount:3}),
  {missing:1,cost:7,target:"neon"});
 assert.deepEqual(calculateDustUpgrade({rarity:"Legendary",stage:"neon",cardCount:2}),
  {missing:2,cost:100,target:"mega"});
 for(const n of [0,4,-1])assert.throws(
  ()=>calculateDustUpgrade({rarity:"Common",stage:"normal",cardCount:n}),/1–3/);
 assert.throws(()=>calculateDustUpgrade({rarity:"Rare",stage:"mega",cardCount:2}),/Only Normal/);
});

test("card locks persist on copies and exclude locked copies from ordinary upgrades",()=>{
 assert.ok(CardCopy.schema.path("locked"));
 const cards=[0,1,2,3].map(i=>({
  _id:String(i),publicId:"A000"+i,ownerDiscordUserId:user,state:"owned",
  upgradeLevel:"normal",cardDefinitionId:"d",locked:i===0,tag:"",
 }));
 assert.equal(selectUpgradeSet(cards),null,"cannot consume the locked fourth card");
 const normal=cards.map(c=>({...c,locked:false}));
 assert.equal(selectUpgradeSet(normal).length,4);
});

test("locking a card changes only the owned copy; unlocking never changes ownership",async()=>{
 const original={findOne:CardCopy.findOne,update:CardCopy.updateOne};
 try {
  CardCopy.findOne=()=>({lean:async()=>({
    _id:"source",publicId:"Abc12",ownerDiscordUserId:user,state:"owned",locked:false,
  })});
  CardCopy.updateOne=async(query,change)=>{
    assert.equal(query.ownerDiscordUserId,user);
    assert.equal(query.state,"owned");
    assert.equal(query.publicId,undefined);
    assert.deepEqual(change.$set,{locked:true});
    return {modifiedCount:1};
  };
  const result=await setCardLock({ownerId:user,cardId:"Abc12",locked:true});
  assert.deepEqual(result,{publicId:"Abc12",locked:true,unchanged:false});
 }finally{CardCopy.findOne=original.findOne;CardCopy.updateOne=original.update;}
});

test("trade history preserves precise sent and received IDs and gift direction",async()=>{
 const trade={
   _id:"507f1f77bcf86cd799439011",participants:[user,partner],offers:[["Abc12"],["Def34"]],
   gift:false,status:"completed",completedAt:new Date("2026-10-30T18:00:00Z"),
 };
 const gift={...trade,gift:true,offers:[["Abc12"],[]]};
 assert.deepEqual(formatTradeHistoryItem(gift,user).sent,["Abc12"]);
 assert.equal(formatTradeHistoryItem(gift,user).kind,"Gift sent");
 assert.equal(formatTradeHistoryItem(gift,partner).kind,"Gift received");
 assert.equal(formatTradeHistoryItem(trade,partner).received[0],"Abc12");
 assert.throws(()=>formatTradeHistoryItem(trade,"outsider"),/another player's/);
 const original=CardTrade.find;
 try{
  CardTrade.find=query=>{
    assert.equal(query.participants,user);
    assert.equal(query.status,"completed");
    return {select:()=>({sort:()=>({limit:()=>({lean:async()=>[trade,gift]})})})};
  };
  const rows=await getCardTradeHistory(user);
  assert.equal(rows.length,2);
  assert.match(formatTradeHistory(rows),/Gift sent/);
  assert.match(formatTradeHistory(rows),/Def34/);
 }finally{CardTrade.find=original;}
});

test("achievements derive progress from actual completed records without granting points",async()=>{
 const original={claim:CardClaim.countDocuments,trade:CardTrade.countDocuments,
   lifecycle:CardLifecycleEvent.countDocuments};
 try {
  CardClaim.countDocuments=async()=>12;
  CardTrade.countDocuments=async query=>query.gift?2:5;
  CardLifecycleEvent.countDocuments=async query=>query.eventType==="burn"?1:
    query.targetUpgradeLevel==="mega"?0:2;
  const progress=await getAchievementProgress(user);
  assert.deepEqual(progress,{grabs:12,gifts:2,trades:5,burns:1,neons:2,megas:0});
  assert.ok(CARD_ACHIEVEMENTS.some(a=>a.key==="first-neon"));
  assert.match(formatCardAchievements(CARD_ACHIEVEMENTS.map(a=>({
    ...a,current:progress[a.metric],earned:progress[a.metric]>=a.goal,
  }))),/Neon Alchemist/);
 }finally{
  CardClaim.countDocuments=original.claim;
  CardTrade.countDocuments=original.trade;
  CardLifecycleEvent.countDocuments=original.lifecycle;
 }
});

test("show-card autocomplete suggests released pet definitions by partial pet name",async()=>{
 const original={pet:PetCatalog.find,definition:CardDefinition.find,release:CardRelease.find};
 try{
  PetCatalog.find=query=>{
    assert.ok(query.name instanceof RegExp);
    return {select:()=>({limit:()=>({lean:async()=>[{petId:"cat",name:"Abyssinian Cat"}]})})};
  };
  CardRelease.find=()=>({select:()=>({lean:async()=>[{releaseId:"test-s1-r1"}]})});
  CardDefinition.find=query=>{
    assert.equal(query.enabled,true);
    assert.deepEqual(query.releaseId.$in,["test-s1-r1"]);
    return {select:()=>({limit:()=>({lean:async()=>[{
    _id:"507f1f77bcf86cd799439011",petId:"cat",rarity:"Rare",releaseId:"test-s1-r1",
  }]})})};
  };
  const choices=await suggestShowCards("aby");
  assert.equal(choices.length,1);
  assert.match(choices[0].name,/Abyssinian Cat/);
  assert.equal(choices[0].value,"507f1f77bcf86cd799439011");
 }finally{PetCatalog.find=original.pet;CardDefinition.find=original.definition;CardRelease.find=original.release;}
});
