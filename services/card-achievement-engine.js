import mongoose from "mongoose";
import CardAchievement from "../models/CardAchievement.js";
import CardCollector from "../models/CardCollector.js";
import CardCopy from "../models/CardCopy.js";
import CardDefinition from "../models/CardDefinition.js";
import CardRelease from "../models/CardRelease.js";
import PetCatalog from "../models/PetCatalog.js";
import {AchievementControl,AchievementEvent,CardAcquisition,AchievementDiscovery,AchievementReleaseFirst,CardBonusUse} from "../models/CardAchievementState.js";
import {CARD_ACHIEVEMENTS,SECRET_ACHIEVEMENTS,recurringAchievements,reviewedSets,rewardFor} from "./card-achievement-catalog.js";

// An explicit launch boundary excludes development history. Never infer it from a restart.
export function achievementStart(){
 const value=process.env.CARD_ACHIEVEMENTS_START_AT;
 if(!value)return null;
 const date=new Date(value);
 if(!Number.isFinite(date.getTime()))throw Error("CARD_ACHIEVEMENTS_START_AT must be an ISO date.");
 return date;
}
export function eligibleAchievementTime(at=new Date()){
 const start=achievementStart();return Boolean(start&&new Date(at)>=start);
}
export function eligiblePlayerDrop(drop){
 return drop?.mode==="player"&&!String(drop.releaseId).startsWith("test-")&&eligibleAchievementTime(drop.createdAt);
}
export async function initializeAchievements(){
 if(!achievementStart())return;
 for(const model of [CardAchievement,AchievementControl,AchievementEvent,CardAcquisition,AchievementDiscovery,AchievementReleaseFirst,CardBonusUse])await model.init();
 await AchievementControl.updateOne({_id:"clock"},{$setOnInsert:{sequence:0,startAt:achievementStart()}},{upsert:true});
 const clock=await AchievementControl.findById("clock").lean();
 if(+new Date(clock.startAt)!==+achievementStart())throw Error("Achievement launch boundary differs from the persisted start date.");
}
const distinct=(rows,key)=>new Set(rows.map(r=>String(r[key]))).size;
const maximumGroup=(rows,key)=>{
 const counts=new Map();for(const r of rows)counts.set(String(r[key]),(counts.get(String(r[key]))||0)+1);
 return Math.max(0,...counts.values());
};
export function buildAchievementProgress({events,acquisitions,owned,definitions,releases,pets}){
 const p={};
 for(const e of events){p[e.kind]=(p[e.kind]||0)+(e.count||1);for(const f of e.flags||[])p[f]=1;}
 const defs=new Map(definitions.map(d=>[String(d._id),d]));
 const cards=owned.map(c=>({...c,...defs.get(String(c.cardDefinitionId)),copyId:String(c._id),definitionId:String(c.cardDefinitionId)}));
 p.petTypes=distinct(acquisitions,"petId");p.rarities=distinct(acquisitions,"rarity");
 p.copies=maximumGroup(acquisitions,"definitionId");
 p.legendaryTypes=distinct(acquisitions.filter(c=>c.rarity==="Legendary"),"petId");
 const legends=acquisitions.filter(c=>c.rarity==="Legendary"&&c.fromPlayerDrop);
 p.legendaryGrabs=legends.length;p.legendaryCopies=maximumGroup(legends,"definitionId");
 p.recipients=distinct(events.filter(e=>e.kind==="gifts"&&e.partner),"partner");
 p.ownedPetTypes=distinct(cards,"petId");p.locked=cards.filter(c=>c.locked).length;
 p.neonRarities=distinct(cards.filter(c=>c.upgradeLevel==="neon"),"rarity");
 const stages=new Map();for(const c of cards){const s=stages.get(c.definitionId)||new Set();s.add(c.upgradeLevel);stages.set(c.definitionId,s);}
 p.tripleStages=[...stages.values()].some(s=>s.size===3)?1:0;
 const names=new Map(pets.map(p=>[p.petId,p.name]));
 p.alphabet=maximumGroup([...new Set(cards.map(c=>c.petId))].map(id=>({letter:(names.get(id)||id)[0]?.toLocaleLowerCase()})),"letter");
 p.vintage=cards.some(c=>releases.some(r=>r.releaseId===c.releaseId&&r.status==="retired"))?1:0;
 const days=new Map();for(const e of events){const s=days.get(e.day)||new Set();s.add(e.kind);days.set(e.day,s);}
 p.breakfast=[...days.values()].some(s=>["grabs","drops","trades"].every(k=>s.has(k)))?1:0;
 const {top20,top10}=reviewedSets(definitions);
 p.top20Acquired=acquisitions.some(c=>top20.has(c.definitionId))?1:0;
 p.top10Acquired=acquisitions.some(c=>top10.has(c.definitionId))?1:0;
 p.top20Owned=distinct(cards.filter(c=>top20.has(c.definitionId)),"petId");
 return p;
}
export async function achievementSnapshot(userId,session=null){
 // Queries deliberately sequential: the Mongo driver forbids parallel transaction operations.
 const events=await AchievementEvent.find({userId}).session(session).lean();
 const acquisitions=await CardAcquisition.find({userId}).session(session).lean();
 const owned=await CardCopy.find({ownerDiscordUserId:userId,state:"owned",achievementEligible:true}).session(session).lean();
 const definitions=await CardDefinition.find({releaseId:{$not:/^test-/}}).session(session).lean();
 const releases=await CardRelease.find({releaseId:{$not:/^test-/}}).session(session).lean();
 const pets=await PetCatalog.find({petId:{$in:[...new Set(definitions.map(d=>d.petId))]}}).select("petId name").session(session).lean();
 const snapshot={events,acquisitions,owned,definitions,releases,pets};
 return {...snapshot,progress:buildAchievementProgress(snapshot)};
}
export function achievementDefinitions(snapshot){
 const {progress,acquisitions,owned,releases}=snapshot;
 const out=[...CARD_ACHIEVEMENTS,...SECRET_ACHIEVEMENTS,...recurringAchievements(progress)];
 for(const release of releases){
  const roster=release.achievementRoster||[];
  const acquired=new Set(acquisitions.filter(c=>c.releaseId===release.releaseId).map(c=>c.definitionId));
  if(roster.length)out.push({key:"full-release-"+release.releaseId,name:"👑 Egg Completionist · "+release.name,
   description:"Acquire every design in the frozen "+release.name+" roster.",tier:"advanced",secret:false,
   goal:roster.length,current:roster.filter(id=>acquired.has(id)).length});
  for(const [i,s] of (release.achievementSecrets||[]).entries()){
   const eligible=s.activeOnly?release.status==="active":true;
   const ownedIds=new Set(owned.filter(c=>(s.metric!=="neonDesigns"||c.upgradeLevel==="neon")&&(s.metric!=="megaDesigns"||c.upgradeLevel==="mega")).map(c=>String(c.cardDefinitionId)));
   const available=s.metric==="acquiredDesigns"?acquired:ownedIds;
   out.push({key:"secret:"+release.releaseId+":"+s.key,name:s.name,description:s.description,tier:s.tier,secret:true,
    anonymousId:release.name+" · Secret "+String(i+1).padStart(2,"0"),
    archived:!eligible,goal:s.definitionIds.length||1,current:eligible?s.definitionIds.filter(id=>available.has(id)).length:0});
  }
 }
 return out.map(a=>({...a,current:a.current??progress[a.metric]??0}));
}
export async function grantAchievement({userId,definition,event,releaseId,session}){
 const key=definition.key;
 // Existing pre-launch badges are archival, not retroactive world firsts.
 const existing=await CardAchievement.findOne({discordUserId:userId,key}).session(session).lean();
 if(existing?.discoveryNumber||existing?.rewardGrantedAt)return null;
 if(existing)await CardAchievement.updateOne({_id:existing._id},{$set:{key:"legacy:"+key}},{session});
 const counter=await AchievementDiscovery.findOneAndUpdate({_id:key},{$inc:{value:1}},{upsert:true,new:true,session});
 let releaseFirst=false;
 if(releaseId&&definition.tier!=="basic"){
  const id=JSON.stringify([releaseId,key]);
  if(!await AchievementReleaseFirst.exists({_id:id}).session(session)){
   await AchievementReleaseFirst.create([{_id:id,userId,key,releaseId}],{session});releaseFirst=true;
  }
 }
 const reward=rewardFor(definition.tier,releaseFirst);
 const [row]=await CardAchievement.create([{
  discordUserId:userId,key,name:definition.name,description:definition.description,tier:definition.tier,
  secret:Boolean(definition.secret),anonymousId:definition.anonymousId,discoveryNumber:counter.value,
  unlockedAt:event.at,releaseId:releaseId||"",eventId:event._id,releaseFirst,
  rewardGrabs:reward.grabs,rewardDrops:reward.drops,rewardGrantedAt:event.at,
  channelId:event.channelId||"",guildId:event.guildId||"",
 }],{session});
 await CardCollector.updateOne({discordUserId:userId},{$inc:{bonusGrabs:reward.grabs,bonusDrops:reward.drops}},{session,upsert:true});
 return row;
}
// MUST run inside the gameplay transaction. A single control write serializes
// discovery allocation (including different collectors) before any reads.
export async function recordAchievementEvent(input,session){
 if(!eligibleAchievementTime(input.at||new Date())||input.test)return;
 if(!session)throw Error("Achievement events require the gameplay transaction.");
 const guard=await AchievementControl.updateOne({_id:"clock"},{$inc:{sequence:1}},{session});
 if(!guard.matchedCount)throw Error("Achievement storage has not been initialized.");
 const id=String(input.id)+":"+input.userId;
 if(await AchievementEvent.exists({_id:id}).session(session))return;
 const at=input.at||new Date();
 const defs=await CardDefinition.find({_id:{$in:(input.cards||[]).map(c=>c.cardDefinitionId)}}).session(session).lean();
 const byId=new Map(defs.map(d=>[String(d._id),d]));
 const cards=(input.cards||[]).filter(c=>c.achievementEligible&&byId.has(String(c.cardDefinitionId)));
 if(input.cards?.length&&!cards.length)return;
 if(input.kind==="drops"&&String(input.releaseId).startsWith("test-"))return;
 const flags=[...(input.flags||[])];
 if(input.kind==="burns"&&cards.some(c=>c.upgradeLevel==="mega"))flags.push("burnMega");
 if(input.kind==="gifts"&&maximumGroup(cards.map(c=>({d:String(c.cardDefinitionId)})),"d")>=2)flags.push("copycat");
 const event={_id:id,userId:input.userId,kind:input.kind,releaseId:input.releaseId||"",channelId:input.channelId||"",guildId:input.guildId||"",
  at,day:at.toISOString().slice(0,10),count:input.kind==="burns"?cards.length:1,partner:input.partner||"",flags};
 if(input.acquire){
  for(const c of cards){
   const d=byId.get(String(c.cardDefinitionId));
   await CardAcquisition.updateOne({userId:input.userId,copyId:String(c._id)},{$setOnInsert:{
    definitionId:String(d._id),releaseId:d.releaseId,petId:d.petId,rarity:d.rarity,
    fromPlayerDrop:input.kind==="grabs",acquiredAt:at,
   }},{upsert:true,session});
  }
 }
 if(input.kind==="trades"&&cards.length){
  const reviewed=await CardDefinition.find({releaseId:{$in:defs.map(d=>d.releaseId)}}).session(session).lean();
  if(cards.some(c=>reviewedSets(reviewed).top10.has(String(c.cardDefinitionId))))event.flags.push("highTrade");
 }
 await AchievementEvent.create([event],{session});
 const snapshot=await achievementSnapshot(input.userId,session);
 // General actions use one explicit season. Single-release card events use that active release.
 const cardReleases=[...new Set(cards.map(c=>byId.get(String(c.cardDefinitionId)).releaseId))];
 const candidate=input.releaseId||(cardReleases.length===1?cardReleases[0]:process.env.CARD_REWARD_SEASON_RELEASE);
 const releaseId=snapshot.releases.find(r=>r.releaseId===candidate&&r.status==="active")?.releaseId;
 for(const definition of achievementDefinitions(snapshot))if(definition.current>=definition.goal&&!definition.archived)
  await grantAchievement({userId:input.userId,definition,event,releaseId,session});
}

export async function recordPublishedDrop(drop,session){
 if(!eligiblePlayerDrop(drop))return;
 const flags=[];
 if(new Set(drop.slots.map(s=>String(s.cardDefinitionId))).size===1)flags.push("matchy");
 if(new Set(drop.slots.map(s=>s.rarity)).size===3)flags.push("tripleRarity");
 await recordAchievementEvent({id:"drop:"+drop._id,userId:drop.createdBy,kind:"drops",releaseId:drop.releaseId,
  at:drop.createdAt,guildId:drop.guildId,channelId:drop.channelId,flags},session);
}

// Atomic configuration: owner-authored secrets and completion roster freeze BEFORE activation.
export async function freezeAchievementRelease(releaseId,session){
 const release=await CardRelease.findOne({releaseId}).session(session);
 if(!release)throw Error("Release not found.");
 if(release.achievementRoster?.length)return;
 const defs=await CardDefinition.find({releaseId,enabled:true,artStatus:"approved"}).session(session).lean();
 const roster=defs.map(d=>String(d._id));
 const keys=new Set();
 for(const s of release.achievementSecrets||[]){
  if(keys.has(s.key)||!s.definitionIds.length||s.definitionIds.some(id=>!roster.includes(id)))throw Error("Release secrets need unique keys and approved roster designs.");
  keys.add(s.key);
 }
 release.achievementRoster=roster;await release.save({session});
}
