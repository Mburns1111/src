import test from "node:test";
import assert from "node:assert/strict";
import { auditHatchemRelease } from "../services/card-release-audit.js";

const release = {
  releaseId:"example-release",status:"draft",eggImageFileId:"egg-1",
  hatchOdds:{Common:26,Uncommon:26,Rare:26,"Ultra-Rare":14,Legendary:8},
  cardBackgroundKey:"bg",cardFrameKey:"frame",
  cardRarityFrameKeys:{Common:"common"},
  cardStageOverlayKeys:{neon:"neon-frame",mega:"mega-frame"},
  achievementRoster:["a","b"],
  achievementSecrets:[
    {tier:"basic"},{tier:"basic"},{tier:"medium"},{tier:"medium"},
    {tier:"advanced"},{tier:"advanced"},
  ],
};
const defs=[
  {petId:"a",rarity:"Common",petArtworkKey:"pet-a",artistCredit:"Lilly",
    artStatus:"approved",enabled:true,hatchWeight:1,stagePetArtworkKeys:{neon:"pet-a-neon"}},
  {petId:"b",rarity:"Legendary",petArtworkKey:"pet-b",artistCredit:"Lilly",
    artStatus:"approved",enabled:true,hatchWeight:1},
];
const assets=[
  ...["pet-a","pet-b","pet-a-neon"].map(key=>({
    key,kind:"pet",artistCredit:"Lilly",licenseReviewStatus:"approved",
  })),
  {key:"bg",kind:"background",licenseReviewStatus:"approved"},
  ...["frame","common","neon-frame","mega-frame"].map(key=>({
    key,kind:"frame",licenseReviewStatus:"approved",
  })),
];
const egg={fileId:"egg-1",licenseReviewStatus:"approved"};
const guilds=[{hatchemChannelId:"channel",cardRoleId:"role"}];

test("read-only audit passes complete mock release and retains optional stage-art counts",()=>{
 const out=auditHatchemRelease({
  release,definitions:defs,artwork:assets,egg,expected:2,
  achievementStartConfigured:true,guilds,
 });
 assert.deepEqual(out.problems,[]);
 assert.equal(out.hatchable,2);
 assert.equal(out.customNeon,1);
 assert.equal(out.customMega,0);
 assert.equal(out.gate,"DATABASE GATES PASS — MANUAL DISCORD TESTS STILL REQUIRED");
});

test("audit catches disabled artwork, missing egg review, missing launch boundary",()=>{
 const out=auditHatchemRelease({
  release,definitions:[{...defs[0],enabled:false,artStatus:"pending"},defs[1]],
  artwork:assets.filter(a=>a.key!=="pet-a-neon"),
  egg:{...egg,licenseReviewStatus:"needs-review"},
  expected:2,achievementStartConfigured:false,guilds:[],
 });
 assert.equal(out.gate,"NOT READY");
 assert.ok(out.problems.some(x=>x.includes("Only 1/2 cards")));
 assert.ok(out.problems.some(x=>x.includes("Unapproved neon")));
 assert.ok(out.problems.some(x=>x.includes("Official egg")));
 assert.ok(out.problems.some(x=>x.includes("CARD_ACHIEVEMENTS_START_AT")));
 assert.ok(out.problems.some(x=>x.includes("No server")));
});

test("original 88 self-made cards are never required to have external links",()=>{
 const out=auditHatchemRelease({
  release,definitions:defs,artwork:assets,egg,expected:2,
  achievementStartConfigured:true,guilds,
 });
 assert.equal(out.incompleteExternalLinks,0);
});

test("credited external artist from Series 1 must retain the assigned profile URL",()=>{
 const r={...release,releaseId:"s1-r1",achievementRoster:["lamb"]};
 const d={...defs[0],petId:"lamb",petArtworkKey:"s1-r1-pet-lamb-v1",
   artistCredit:"jovyisweird",artistUrl:"",stagePetArtworkKeys:{}};
 const a=[...assets,{key:d.petArtworkKey,kind:"pet",artistCredit:"jovyisweird",
   artistUrl:"",licenseReviewStatus:"approved"}];
 const out=auditHatchemRelease({
  release:r,definitions:[d],artwork:a,egg,expected:1,
  achievementStartConfigured:true,guilds,
 });
 assert.equal(out.incompleteExternalLinks,1);
 assert.ok(out.problems.some(x=>x.includes("external-artist cards")));
});
