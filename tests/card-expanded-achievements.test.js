import test from "node:test";
import assert from "node:assert/strict";
import {CARD_ACHIEVEMENTS,SECRET_ACHIEVEMENTS,recurringAchievements,rewardFor,reviewedSets} from "../services/card-achievement-catalog.js";
import {buildAchievementProgress,achievementDefinitions,eligiblePlayerDrop,grantAchievement} from "../services/card-achievement-engine.js";
import {achievementPages,privateAchievementReceipt,publicSecretReceipt} from "../services/card-achievements.js";
import CardAchievement from "../models/CardAchievement.js";
import CardCollector from "../models/CardCollector.js";
import {AchievementDiscovery,AchievementReleaseFirst} from "../models/CardAchievementState.js";
import {parseHatchemText,runHatchemText} from "../services/hatchem-text-commands.js";

const snapshot=()=>({events:[],acquisitions:[],owned:[],definitions:[],releases:[],pets:[]});
test("50 named definitions including dynamic completion; twelve private secrets",()=>{
 assert.equal(CARD_ACHIEVEMENTS.length+SECRET_ACHIEVEMENTS.length+1,50);
 assert.equal(SECRET_ACHIEVEMENTS.length,12);
 assert.equal(new Set([...CARD_ACHIEVEMENTS,...SECRET_ACHIEVEMENTS].map(a=>a.key)).size,49);
 assert.ok(SECRET_ACHIEVEMENTS.every(a=>a.secret&&a.anonymousId&&!a.anonymousId.includes(a.name)));
});
test("tier and release-first awards never give basic an extra grab",()=>{
 assert.deepEqual(rewardFor("basic",true),{grabs:1,drops:0});
 assert.deepEqual(rewardFor("medium",true),{grabs:1,drops:1});
 assert.deepEqual(rewardFor("advanced",true),{grabs:3,drops:1});
 assert.deepEqual(rewardFor("advanced"),{grabs:2,drops:1});
});
test("milestones continue forever and tiers change at 200 and 500",()=>{
 const rows=recurringAchievements({grabs:1050,drops:200});
 for(const [key,tier] of [["grab-150","basic"],["grab-200","medium"],["grab-500","advanced"],["grab-1050","advanced"]])
  assert.equal(rows.find(a=>a.key===key).tier,tier);
 assert.ok(rows.some(a=>a.key==="grab-1100"));assert.ok(rows.some(a=>a.key==="drop-250"));
});
test("test eggs and prelaunch player drops cannot earn achievements",()=>{
 const previous=process.env.CARD_ACHIEVEMENTS_START_AT;
 try{process.env.CARD_ACHIEVEMENTS_START_AT="2026-11-01T00:00:00Z";
  const drop={mode:"player",releaseId:"r1",createdAt:new Date("2026-11-02")};
  assert.equal(eligiblePlayerDrop(drop),true);
  assert.equal(eligiblePlayerDrop({...drop,mode:"test"}),false);
  assert.equal(eligiblePlayerDrop({...drop,releaseId:"test-r1"}),false);
  assert.equal(eligiblePlayerDrop({...drop,createdAt:new Date("2026-10-01")}),false);
 }finally{if(previous===undefined)delete process.env.CARD_ACHIEVEMENTS_START_AT;else process.env.CARD_ACHIEVEMENTS_START_AT=previous;}
});
test("lifetime acquisitions survive burned/transferred cards; current goals do not",()=>{
 const s=snapshot();
 s.acquisitions=Array.from({length:10},(_,i)=>({copyId:String(i),definitionId:"d",petId:"cat",releaseId:"r",rarity:"Legendary",fromPlayerDrop:true}));
 s.events=[{kind:"burns",count:3,day:"2026-11-01"}];
 const p=buildAchievementProgress(s);
 assert.equal(p.copies,10);assert.equal(p.legendaryGrabs,10);assert.equal(p.ownedPetTypes,0);assert.equal(p.burns,3);
});
test("full breakfast requires the same UTC day and actual winning grabs",()=>{
 const s=snapshot();s.events=["grabs","drops","trades"].map(kind=>({kind,day:"2026-11-01"}));
 assert.equal(buildAchievementProgress(s).breakfast,1);
 s.events[2].day="2026-11-02";assert.equal(buildAchievementProgress(s).breakfast,0);
});
test("reviewed value needs 20 reviewed definitions and threshold ties qualify",()=>{
 const defs=Array.from({length:20},(_,i)=>({_id:String(i),releaseId:"r",valueReview:{valueScore:i<5?100:1,checkedAt:new Date(),sourceName:"review"}}));
 assert.equal(reviewedSets(defs.slice(0,19)).top20.size,0);
 assert.equal(reviewedSets(defs).top10.size,5);
 defs.forEach(d=>d.valueReview.checkedAt=null);assert.equal(reviewedSets(defs).top20.size,0);
});
test("completion uses frozen roster; release secrets honor availability",()=>{
 const s=snapshot();s.progress={};s.acquisitions=[{releaseId:"r",definitionId:"d"}];
 s.releases=[{releaseId:"r",name:"Egg",status:"retired",achievementRoster:["d"],achievementSecrets:[{key:"x",name:"Hidden",description:"Private",tier:"basic",metric:"acquiredDesigns",definitionIds:["d"],activeOnly:true}]}];
 const rows=achievementDefinitions(s);
 assert.equal(rows.find(a=>a.key==="full-release-r").current,1);
 assert.equal(rows.find(a=>a.key==="secret:r:x").archived,true);
 s.releases[0].achievementSecrets[0].activeOnly=false;
 assert.equal(achievementDefinitions(s).find(a=>a.key==="secret:r:x").current,1);
});
test("secret UI never reveals undiscovered names/conditions and stays within message limits",()=>{
 const rows=[...CARD_ACHIEVEMENTS,...SECRET_ACHIEVEMENTS].map(a=>({...a,earned:false,current:0}));
 const text=achievementPages(rows).join("\n");
 for(const secret of SECRET_ACHIEVEMENTS){assert.ok(!text.includes(secret.name));assert.ok(!text.includes(secret.description));}
 assert.match(text,/0\/12 discovered/);assert.ok(achievementPages(rows).every(p=>p.length<=2000));
 rows.find(a=>a.secret).earned=true;
 assert.ok(achievementPages(rows).join("\n").includes(SECRET_ACHIEVEMENTS[0].name));
});
test("public receipts reveal only anonymous rank; private receipts include precise award",()=>{
 const a={name:"Hidden Solution",description:"Secret condition",discordUserId:"123",anonymousId:"Permanent · Secret 01",discoveryNumber:18,rewardGrabs:1,rewardDrops:1,releaseFirst:true,releaseId:"r2"};
 const pub=publicSecretReceipt(a);assert.ok(!pub.includes(a.name));assert.ok(!pub.includes(a.description));assert.ok(!pub.includes("Rewards"));assert.match(pub,/#18/);
 assert.match(privateAchievementReceipt(a),/Hidden Solution/);assert.match(privateAchievementReceipt(a),/\+1 Extra Grabs/);
});
test("achievement pagination and Hall of Fame aliases parse without leaking secret IDs",()=>{
 assert.deepEqual(parseHatchemText(".achievements 3"),{action:"achievements",options:{page:3,view:"mine"}});
 assert.deepEqual(parseHatchemText(".hof 2"),{action:"achievements",options:{page:2,view:"hall"}});
});
test("durable grant gives independent ordinals, one release-first reward, and ignores duplicates",async()=>{
 const originals=[];const stub=(obj,key,fn)=>{originals.push([obj,key,obj[key]]);obj[key]=fn;};
 const saved=[],first=new Set(),counters=new Map(),wallets=new Map(),session={};
 const q=value=>({session:()=>({lean:async()=>value})});
 stub(CardAchievement,"findOne",query=>q(saved.find(r=>r.discordUserId===query.discordUserId&&r.key===query.key)));
 stub(AchievementDiscovery,"findOneAndUpdate",async(q,u,o)=>{assert.equal(o.session,session);const n=(counters.get(q._id)||0)+1;counters.set(q._id,n);return {value:n};});
 stub(AchievementReleaseFirst,"exists",q=>({session:async()=>first.has(q._id)}));
 stub(AchievementReleaseFirst,"create",async([row],o)=>{assert.equal(o.session,session);first.add(row._id);});
 stub(CardAchievement,"create",async([row],o)=>{assert.equal(o.session,session);saved.push(row);return [row];});
 stub(CardCollector,"updateOne",async(q,u,o)=>{assert.equal(o.session,session);const w=wallets.get(q.discordUserId)||{grabs:0,drops:0};w.grabs+=u.$inc.bonusGrabs;w.drops+=u.$inc.bonusDrops;wallets.set(q.discordUserId,w);});
 try{
  const definition={key:"a",name:"Award",description:"Goal",tier:"medium"};const event={_id:"e",at:new Date()};
  const grant=(userId,releaseId)=>grantAchievement({userId,releaseId,definition,event,session});
  assert.equal((await grant("u1","r1")).discoveryNumber,1);
  assert.equal((await grant("u2","r1")).discoveryNumber,2);
  assert.equal(await grant("u1","r2"),null);
  assert.equal((await grant("u3","r2")).discoveryNumber,3);
  assert.deepEqual(wallets.get("u1"),{grabs:1,drops:1});
  assert.deepEqual(wallets.get("u2"),{grabs:0,drops:1});
  assert.deepEqual(wallets.get("u3"),{grabs:1,drops:1});
 }finally{for(const [o,k,v] of originals)o[k]=v;}
});
