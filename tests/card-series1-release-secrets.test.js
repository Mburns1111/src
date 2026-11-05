import test from "node:test";
import assert from "node:assert/strict";
import {compilePrivateReleaseSecrets} from "../services/card-release-secret-authoring.js";
import {achievementDefinitions} from "../services/card-achievement-engine.js";
import {CARD_ACHIEVEMENTS,SECRET_ACHIEVEMENTS} from "../services/card-achievement-catalog.js";

const ids=[
 "pet-01","pet-02","pet-03","pet-04","pet-05","pet-06",
 "pet-07","pet-08","pet-09","pet-10","pet-11",
 "pet-12","pet-13","pet-14"
];
const definitions=ids.map((petId,i)=>({
 _id:"definition-"+(i+1),releaseId:"s1-r1",petId,enabled:true,
 artStatus:"approved",hatchWeight:1,
}));
const secret=(i,tier,metric,petIds,activeOnly=false)=>({
 key:"private-"+i,name:"Unpublished challenge "+i,description:"Unpublished trigger "+i,
 tier,metric,petIds,activeOnly,
});
const privateConfig={
 releaseId:"s1-r1",
 secrets:[
  secret(1,"basic","ownedDesigns",["pet-01","pet-02"]),
  secret(2,"basic","acquiredDesigns",["pet-03","pet-04"]),
  secret(3,"medium","ownedDesigns",["pet-05","pet-06","pet-07"]),
  secret(4,"medium","acquiredDesigns",["pet-08","pet-09","pet-10","pet-11"]),
  secret(5,"advanced","neonDesigns",["pet-12","pet-13"]),
  secret(6,"advanced","megaDesigns",["pet-14"]),
 ],
};

test("private config resolves all six tiered Series 1 challenges by approved pet IDs",()=>{
 const result=compilePrivateReleaseSecrets(privateConfig,definitions);
 assert.equal(result.secrets.length,6);
 assert.deepEqual(result.secrets.map(s=>s.tier),["basic","basic","medium","medium","advanced","advanced"]);
 assert.equal(result.secrets[0].definitionIds.length,2);
 assert.equal(result.secrets[3].definitionIds.length,4);
 assert.equal(result.secrets[4].definitionIds.length,2);
 assert.equal(result.secrets[5].definitionIds.length,1);
 assert.ok(result.secrets.every(s=>!Object.hasOwn(s,"petIds")));
 assert.deepEqual(result.secrets[0].definitionIds,["definition-1","definition-2"]);
 assert.equal(CARD_ACHIEVEMENTS.length,37);
 assert.equal(SECRET_ACHIEVEMENTS.length,12);
});
test("unknown pet and incomplete combination cannot be configured",()=>{
 const invalid={...privateConfig,secrets:privateConfig.secrets.map((s,i)=>
  i===3?{...s,petIds:["pet-08","missing-pet"]}:s)};
 assert.throws(()=>compilePrivateReleaseSecrets(invalid,definitions),/secret #4 references pet/);
 const incomplete={...privateConfig,secrets:privateConfig.secrets.map((s,i)=>
  i===5?{...s,petIds:[]}:s)};
 assert.throws(()=>compilePrivateReleaseSecrets(incomplete,definitions),/secret #6 must list/);
});
test("duplicate cards, unapproved pet art and test-release definitions are rejected",()=>{
 const bad={...privateConfig,secrets:[{...privateConfig.secrets[0],petIds:["pet-01","pet-01"]},...privateConfig.secrets.slice(1)]};
 assert.throws(()=>compilePrivateReleaseSecrets(bad,definitions),/secret #1 must list/);
 const unapproved=definitions.map(d=>d.petId==="pet-01"?{...d,artStatus:"pending"}:d);
 assert.throws(()=>compilePrivateReleaseSecrets(privateConfig,unapproved),/secret #1 references pet/);
 const fromTest=definitions.map(d=>d.petId==="pet-01"?{...d,releaseId:"test-s1-r1"}:d);
 assert.throws(()=>compilePrivateReleaseSecrets(privateConfig,fromTest),/secret #1 references pet/);
});
test("private error reports do not leak secret titles, pets or combinations",()=>{
 const broken={...privateConfig,secrets:privateConfig.secrets.map((s,i)=>
  i===4?{...s,petIds:["PET-NOT-YET-ASSIGNED"]}:s)};
 let message="";
 try{compilePrivateReleaseSecrets(broken,definitions);}catch(error){message=error.message;}
 assert.ok(message.includes("secret #5"));
 assert.ok(!message.includes("PET-NOT-YET-ASSIGNED"));
 for(const secret of broken.secrets){
  assert.ok(!message.includes(secret.name));
  assert.ok(!message.includes(secret.description));
 }
});
test("all six requirements honor owned vs acquired vs Neon vs Mega, including after retirement",()=>{
 const compiled=compilePrivateReleaseSecrets(privateConfig,definitions);
 const release={releaseId:"s1-r1",name:"Series 1",status:"active",
  achievementRoster:definitions.map(d=>d._id),achievementSecrets:compiled.secrets};
 const snapshot={
  progress:{},events:[],definitions,releases:[release],pets:[],
  acquisitions:[],owned:[],
 };
 let entries=achievementDefinitions(snapshot);
 assert.equal(entries.filter(a=>a.secret&&a.key.startsWith("secret:s1-r1:")).length,6);
 assert.ok(entries.filter(a=>a.key.startsWith("secret:s1-r1:")).every(a=>a.current===0));
 snapshot.owned=[
  ...["pet-01","pet-02","pet-05","pet-06","pet-07"].map((petId,i)=>({
   cardDefinitionId:definitions.find(d=>d.petId===petId)._id,upgradeLevel:"normal",_id:"normal-"+i
  })),
  ...["pet-12","pet-13"].map((petId,i)=>({
   cardDefinitionId:definitions.find(d=>d.petId===petId)._id,upgradeLevel:"neon",_id:"neon-"+i
  })),
  {cardDefinitionId:definitions.find(d=>d.petId==="pet-14")._id,
    upgradeLevel:"mega",_id:"mega-1"},
 ];
 snapshot.acquisitions=["pet-03","pet-04","pet-08","pet-09","pet-10","pet-11"]
  .map(petId=>({
   definitionId:definitions.find(d=>d.petId===petId)._id,releaseId:"s1-r1"
  }));
 entries=achievementDefinitions(snapshot);
 assert.ok(compiled.secrets.every(s=>entries.find(a=>a.key==="secret:s1-r1:"+s.key).current===
    s.definitionIds.length));
 snapshot.owned=snapshot.owned.filter(c=>c.upgradeLevel!=="mega");
 entries=achievementDefinitions(snapshot);
 assert.equal(entries.find(a=>a.key==="secret:s1-r1:private-6").current,0);
 snapshot.releases[0].status="retired";
 entries=achievementDefinitions(snapshot);
 assert.equal(entries.find(a=>a.key==="secret:s1-r1:private-6").archived,false);
 snapshot.releases[0].status="draft";
 entries=achievementDefinitions(snapshot);
 assert.ok(entries.filter(a=>a.key.startsWith("secret:s1-r1:")).every(a=>a.archived));
 assert.equal(entries.find(a=>a.key==="full-release-s1-r1"),undefined);
});
test("active-only secret locks after retirement without revoking a prior earned badge",()=>{
 const compiled=compilePrivateReleaseSecrets(privateConfig,definitions);
 const snapshot={progress:{},events:[],acquisitions:[],owned:[],definitions,pets:[],
  releases:[{releaseId:"s1-r1",name:"Series 1",status:"retired",
    achievementRoster:definitions.map(d=>d._id),
    achievementSecrets:compiled.secrets.map((s,i)=>i===0?{...s,activeOnly:true}:s)}]};
 const secrets=achievementDefinitions(snapshot);
 assert.equal(secrets.find(a=>a.key==="secret:s1-r1:private-1").archived,true);
 assert.equal(secrets.find(a=>a.key==="secret:s1-r1:private-2").archived,false);
});
