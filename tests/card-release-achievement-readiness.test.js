import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectReleaseAchievementReadiness,
} from "../services/card-release-achievement-readiness.js";

const start = "2026-11-12T00:00:00-05:00";
const definitions = Array.from({length:108}, (_,i) => ({
  _id:"pet-"+i, petId:"pet-"+i, enabled:true, artStatus:"approved", hatchWeight:1,
  valueReview:i<20?{valueScore:10+i,sourceName:"verified-reference",checkedAt:new Date("2026-11-01")}:{},
}));
const secrets = ["basic","basic","medium","medium","advanced","advanced"].map((tier,i) => ({
  key:"s"+i, name:"Never print this private secret "+i,
  description:"Private requirement for secret "+i, tier,
  metric:["acquiredDesigns","ownedDesigns","neonDesigns","megaDesigns"][i%4],
  definitionIds:["pet-"+i], activeOnly:true,
}));
const release = {
  releaseId:"s1-r1",status:"draft",
  achievementRoster:definitions.map(d=>d._id),achievementSecrets:secrets,
};
const inspect = overrides=>inspectReleaseAchievementReadiness({
  release, definitions, launchBoundary:start, ...overrides,
});

test("full 108-card Series 1 preflight accepts exact roster, six secrets, and reviewed values",()=>{
  const result=inspect();
  assert.deepEqual(result.problems,[]);
  assert.equal(result.enabledRosterCount,108);
  assert.equal(result.frozenRosterCount,108);
  assert.equal(result.reviewedValueCards,20);
  assert.equal(result.releaseSecrets,6);
  assert.equal(result.permanentSecrets,12);
  assert.equal(result.globalNamedAchievements,49);
  assert.ok(result.warnings.some(w=>w.includes("only reviewed cards")));
});

test("invalid or missing achievement launch boundary blocks activation",()=>{
  for(const value of [undefined,"tomorrow","2026-11-12","2026-11-12T00:00:00"]){
    assert.ok(inspect({launchBoundary:value}).problems.some(p=>p.includes("CARD_ACHIEVEMENTS_START_AT")));
  }
});

test("frozen roster must match approved release copy definitions exactly",()=>{
  assert.ok(inspect({release:{...release,achievementRoster:[]}}).problems.some(p=>p.includes("Frozen")));
  assert.ok(inspect({release:{...release,achievementRoster:[...release.achievementRoster.slice(1),"not-a-card"]}})
    .problems.some(p=>p.includes("differs")));
  assert.ok(inspect({definitions:definitions.map((d,i)=>i===1?{...d,enabled:false}:d)})
    .problems.some(p=>p.includes("108 enabled")));
});

test("unpublished secrets cannot leak into readiness output even if broken",()=>{
  const broken=[
    {...secrets[0],key:"bad key",definitionIds:[],activeOnly:"yes"},
    {...secrets[1],key:"bad key",metric:"timeOfDay"},
    ...secrets.slice(2),
  ];
  const result=inspect({secrets:broken});
  assert.ok(result.problems.some(p=>p.includes("secret #1")));
  assert.ok(result.problems.some(p=>p.includes("unique")));
  const publicText=JSON.stringify(result);
  for(const secret of broken){
    assert.equal(publicText.includes(secret.name),false);
    assert.equal(publicText.includes(secret.description),false);
  }
});

test("release authoring can validate secrets without launch clock or value reviews, but launch cannot",()=>{
  const unreviewed=definitions.map(d=>({...d,valueReview:{}}));
  const unpublished={...release,achievementRoster:[]};
  const authoring=inspect({release:unpublished,definitions:unreviewed,
    requireFrozen:false,checkLaunchBoundary:false,requireValueReviews:false,launchBoundary:undefined});
  assert.deepEqual(authoring.problems,[]);
  const launch=inspect({release:unpublished,definitions:unreviewed,launchBoundary:undefined});
  assert.ok(launch.problems.some(p=>p.includes("Reviewed-value")));
  assert.ok(launch.problems.some(p=>p.includes("Frozen")));
  assert.ok(launch.problems.some(p=>p.includes("CARD_ACHIEVEMENTS_START_AT")));
});

test("each Series 1 tier requires two secrets with real IDs; no secret names are printed",()=>{
  const broken=secrets.slice(0,5);
  const result=inspect({secrets:broken});
  assert.ok(result.problems.some(p=>p.includes("At least six")));
  assert.ok(result.problems.some(p=>p.includes("two advanced")));
  assert.ok(!JSON.stringify(result).includes(broken[0].name));
});
