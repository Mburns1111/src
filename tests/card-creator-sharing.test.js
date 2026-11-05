import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import CardAchievement from "../models/CardAchievement.js";
import CardCollector from "../models/CardCollector.js";
import CardCopy from "../models/CardCopy.js";
import CardDefinition from "../models/CardDefinition.js";
import CardRelease from "../models/CardRelease.js";
import PetCatalog from "../models/PetCatalog.js";
import {
  AchievementControl,AchievementEvent,CardAcquisition,AchievementDiscovery,
  AchievementReleaseFirst,
} from "../models/CardAchievementState.js";
import {isSharedCardGameCreator} from "../services/card-owner-access.js";
import {grantAchievement,achievementSnapshot} from "../services/card-achievement-engine.js";
import {achievementPages,privateAchievementReceipt,secretHallOfFame} from "../services/card-achievements.js";
import {parseHatchemText} from "../services/hatchem-text-commands.js";
import {previewCreatorSharing,convertCreatorAchievementsToShared} from "../services/card-creator-sharing.js";

const creator="123456789012345678",memberA="222222222222222222",memberB="333333333333333333";
const q=value=>({session(){return this;},select(){return this;},sort(){return this;},lean:async()=>value});
const stub=(undo,obj,key,fn)=>{undo.push([obj,key,obj[key]]);obj[key]=fn;};
const restore=undo=>{for(const [obj,key,fn] of undo.reverse())obj[key]=fn;};
async function inProduction(callback){
 const keys=["CARD_GAME_OWNER_DISCORD_ID","ENABLE_CARD_GAME","ENABLE_CARD_GAME_TEST"];
 const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  process.env.CARD_GAME_OWNER_DISCORD_ID=creator;
  process.env.ENABLE_CARD_GAME="1";
  process.env.ENABLE_CARD_GAME_TEST="0";
  return await callback();
 }finally{
  for(const key of keys)if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];
 }
}

test("only the configured live creator shares badges, and the destructive command is retired",async()=>{
 await inProduction(async()=>{
  assert.equal(isSharedCardGameCreator(creator),true);
  assert.equal(isSharedCardGameCreator(memberA),false);
  assert.deepEqual(parseHatchemText(".creatorshare CONFIRM"),
    {action:"creatorshare",options:{mode:"CONFIRM"}});
  assert.equal(parseHatchemText(".creatorreset CONFIRM"),null);
  await assert.rejects(convertCreatorAchievementsToShared(memberA),/Only the configured live/);
  await assert.rejects(previewCreatorSharing(memberA),/Only the configured live/);
  process.env.ENABLE_CARD_GAME_TEST="1";
  assert.equal(isSharedCardGameCreator(creator),false);
 });
});

test("creator earns saved badges without discovery ranks, first-in-release tokens or new extras",async()=>{
 await inProduction(async()=>{
  const undo=[],saved=[];
  stub(undo,CardAchievement,"findOne",({discordUserId,key})=>q(saved.find(a=>a.discordUserId===discordUserId&&a.key===key)));
  stub(undo,CardAchievement,"create",async([row])=>{saved.push(row);return [row];});
  stub(undo,AchievementDiscovery,"findOneAndUpdate",()=>{throw Error("Creator must not reserve player discovery number.");});
  stub(undo,AchievementReleaseFirst,"exists",()=>{throw Error("Creator must not reserve first bonus.");});
  stub(undo,CardCollector,"updateOne",()=>{throw Error("Creator must not be given new bonuses.");});
  try{
   const definition={key:"first-neon",tier:"medium",name:"Neon",description:"Create a Neon.",secret:false};
   const event={_id:"creator-event",at:new Date("2026-11-05T18:00:00Z")};
   const entry=await grantAchievement({userId:creator,definition,event,releaseId:"s1-r1",session:{}});
   assert.equal(entry.creatorShared,true);
   assert.equal(entry.discoveryNumber,undefined);
   assert.equal(entry.releaseFirst,false);
   assert.equal(entry.rewardGrantedAt,null);
   assert.equal(entry.rewardGrabs,0);
   assert.equal(entry.rewardDrops,0);
   assert.equal(await grantAchievement({userId:creator,definition,event,releaseId:"s1-r1",session:{}}),null);
   const rows=[{...entry,earned:true,goal:1,current:1}];
   rows.wallet={bonusGrabs:3,bonusDrops:1};rows.sharedCreator=true;
   assert.match(achievementPages(rows)[0],/Creator · Shared/);
   assert.doesNotMatch(achievementPages(rows)[0],/Legacy badge|#undefined/);
   assert.match(privateAchievementReceipt(entry),/Creator · Shared/);
  }finally{restore(undo);}
 });
});

test("creator achievement snapshot reads saved progress and owned cards",async()=>{
 await inProduction(async()=>{
  const undo=[];
  stub(undo,AchievementEvent,"find",()=>q([{kind:"drops",count:1,day:"2026-11-05"}]));
  stub(undo,CardAcquisition,"find",()=>q([{petId:"dog",rarity:"Common",definitionId:"d",releaseId:"r"}]));
  stub(undo,CardCopy,"find",()=>q([{_id:"c",cardDefinitionId:"d",upgradeLevel:"normal"}]));
  stub(undo,CardDefinition,"find",()=>q([{_id:"d",petId:"dog",releaseId:"r",rarity:"Common"}]));
  stub(undo,CardRelease,"find",()=>q([{releaseId:"r",status:"active"}]));
  stub(undo,PetCatalog,"find",()=>q([{petId:"dog",name:"Dog"}]));
  try{
   const snap=await achievementSnapshot(creator);
   assert.equal(snap.progress.drops,1);
   assert.equal(snap.progress.petTypes,1);
   assert.equal(snap.progress.ownedPetTypes,1);
  }finally{restore(undo);}
 });
});

test("transactional creator conversion preserves both badges and histories, compacts player ranks, and transfers first bonus once",async()=>{
 await inProduction(async()=>{
  const undo=[],counterWrites=[],walletWrites=[],deletions=[];
  const oldAt=new Date("2026-11-05T18:00:00Z");
  const awards=[
   {_id:"creator1",discordUserId:creator,key:"first-neon",tier:"medium",releaseId:"s1-r1",
    discoveryNumber:1,releaseFirst:true,rewardGrabs:1,rewardDrops:1,rewardGrantedAt:oldAt,
    unlockedAt:oldAt,noticeAttemptedAt:oldAt},
   {_id:"creator2",discordUserId:creator,key:"first-hatch",tier:"basic",
    discoveryNumber:1,rewardGrabs:1,rewardDrops:0,rewardGrantedAt:oldAt,unlockedAt:oldAt,noticeAttemptedAt:oldAt},
   {_id:"a1",discordUserId:memberA,key:"first-neon",tier:"medium",releaseId:"s1-r1",
    discoveryNumber:2,releaseFirst:false,rewardGrabs:0,rewardDrops:1,rewardGrantedAt:oldAt,unlockedAt:new Date(+oldAt+1000)},
   {_id:"b1",discordUserId:memberB,key:"first-neon",tier:"medium",releaseId:"s1-r1",
    discoveryNumber:3,releaseFirst:false,rewardGrabs:0,rewardDrops:1,rewardGrantedAt:oldAt,unlockedAt:new Date(+oldAt+2000)},
  ];
  const firsts=[{_id:'["s1-r1","first-neon"]',userId:creator,key:"first-neon",releaseId:"s1-r1"}];
  stub(undo,mongoose,"startSession",async()=>({withTransaction:async fn=>fn(),endSession:async()=>{}}));
  stub(undo,AchievementControl,"updateOne",async()=>({matchedCount:1}));
  stub(undo,CardAchievement,"find",query=>{
   if(query.discordUserId===creator)return q(awards.filter(a=>a.discordUserId===creator).map(a=>({...a})));
   return q(awards.filter(a=>a.key===query.key&&a.discordUserId!==creator&&Number.isInteger(a.discoveryNumber))
     .sort((a,b)=>a.discoveryNumber-b.discoveryNumber).map(a=>({...a})));
  });
  stub(undo,CardAchievement,"findOne",query=>{
   const candidates=awards.filter(a=>a.key===query.key&&a.releaseId===query.releaseId&&a.discordUserId!==creator&&a.rewardGrantedAt)
    .sort((a,b)=>+a.unlockedAt-+b.unlockedAt);
   return q(candidates[0]?{...candidates[0]}:null);
  });
  stub(undo,CardAchievement,"updateMany",async(query,change)=>{
   const selected=awards.filter(a=>a.discordUserId===query.discordUserId&&
    (!query.rewardGrantedAt||a.rewardGrantedAt));
   for(const a of selected){
    if(change.$set)Object.assign(a,change.$set);
    if(change.$unset)for(const k of Object.keys(change.$unset))delete a[k];
   }
   return {modifiedCount:selected.length};
  });
  stub(undo,CardAchievement,"updateOne",async(query,change)=>{
   const a=awards.find(a=>a._id===query._id);
   if(!a||("discoveryNumber" in query&&a.discoveryNumber!==query.discoveryNumber)||("releaseFirst" in query&&a.releaseFirst===true))
    return {matchedCount:0};
   Object.assign(a,change.$set||{});
   for(const [k,n] of Object.entries(change.$inc||{}))a[k]=(a[k]||0)+n;
   return {matchedCount:1};
  });
  stub(undo,AchievementDiscovery,"updateOne",async(query,change)=>{counterWrites.push([query._id,change.$set.value]);});
  stub(undo,AchievementDiscovery,"deleteOne",async(query)=>{counterWrites.push([query._id,0]);});
  stub(undo,AchievementReleaseFirst,"find",query=>q(firsts.filter(a=>a.userId===query.userId).map(a=>({...a}))));
  stub(undo,AchievementReleaseFirst,"deleteOne",async query=>{
   const i=firsts.findIndex(a=>a._id===query._id&&a.userId===query.userId);
   if(i<0)throw Error("Wrong first-slot owner");deletions.push(query._id);firsts.splice(i,1);
  });
  stub(undo,AchievementReleaseFirst,"create",async([row])=>{firsts.push(row);});
  stub(undo,CardCollector,"updateOne",async(q,u)=>{walletWrites.push([q.discordUserId,u.$inc.bonusGrabs]);});
  try{
   const result=await convertCreatorAchievementsToShared(creator);
   assert.equal(result.badgesPreserved,2);
   assert.equal(result.creatorRanksReleased,2);
   assert.equal(result.playerRanksAdjusted,2);
   assert.equal(result.firstRewardsTransferred,1);
   assert.equal(result.firstSlotsOpened,0);
   assert.equal(awards.length,4);
   assert.equal(awards[0].creatorShared,true);
   assert.equal(awards[0].discoveryNumber,undefined);
   assert.equal(awards[0].releaseFirst,false);
   assert.equal(awards[0].rewardGrabs,1,"previous creator reward is preserved");
   assert.equal(awards[2].discoveryNumber,1);
   assert.equal(awards[3].discoveryNumber,2);
   assert.equal(awards[2].releaseFirst,true);
   assert.equal(awards[2].rewardGrabs,1);
   assert.deepEqual(walletWrites,[[memberA,1]]);
   assert.deepEqual(counterWrites,[["first-neon",2],["first-hatch",0]]);
   assert.deepEqual(firsts.map(x=>x.userId),[memberA]);
   assert.equal(deletions.length,1);
   const second=await convertCreatorAchievementsToShared(creator);
   assert.equal(second.creatorRanksReleased,0);
   assert.equal(second.firstRewardsTransferred,0);
   assert.deepEqual(walletWrites,[[memberA,1]],"second run never credits twice");
  }finally{restore(undo);}
 });
});

test("Hall of Fame query omits historical creator ranks in production",async()=>{
 await inProduction(async()=>{
  const undo=[];let filters;
  stub(undo,CardAchievement,"find",query=>{filters=query;return q([]);});
  try{
   await secretHallOfFame();
   assert.deepEqual(filters.discordUserId,{$ne:creator});
   assert.deepEqual(filters.creatorShared,{$ne:true});
  }finally{restore(undo);}
 });
});
