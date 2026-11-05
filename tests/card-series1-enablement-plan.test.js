import test from "node:test";
import assert from "node:assert/strict";
import { planSeries1CardEnablement } from "../services/card-series1-enablement-plan.js";
import { SERIES1_ARTIST_PETS } from "../services/card-series1-artist-pack.js";
const counts={Common:13,Uncommon:18,Rare:26,"Ultra-Rare":28,Legendary:23};
const rarityList=Object.entries(counts).flatMap(([rarity,n])=>Array(n).fill(rarity));
const owner=Array.from({length:88},(_,i)=>({
  _id:"o"+i,petId:"owner-pet-"+i,
  petArtworkKey:"s1-r1-pet-owner-pet-"+i,
  artistCredit:"Lilly",artistUrl:"",artSourceUrl:"",
  artStatus:"approved",enabled:false,hatchWeight:1,rarity:rarityList[i],
}));
const guest=SERIES1_ARTIST_PETS.map((pet,i)=>({
  _id:"g"+i,petId:pet.petId,
  petArtworkKey:"s1-r1-pet-"+pet.petId,
  artistCredit:pet.artistCredit,artistUrl:pet.artistUrl,artStatus:"approved",
  enabled:false,hatchWeight:1,rarity:rarityList[88+i],
}));
const release={
  releaseId:"s1-r1",status:"draft",
  hatchOdds:{Common:26,Uncommon:26,Rare:26,"Ultra-Rare":14,Legendary:8},
  cardBackgroundKey:"s1-r1-background",
  cardFrameKey:"s1-r1-outline",
  cardRarityFrameKeys:{
    Common:"s1-r1-common",Uncommon:"s1-r1-uncommon",
    Rare:"s1-r1-rare","Ultra-Rare":"s1-r1-ultrarare",
  },
  cardStageOverlayKeys:{neon:"s1-r1-neon",mega:"s1-r1-mega"},
};
const artwork=[
 ...[...owner,...guest].map(c=>({
   key:c.petArtworkKey,kind:"pet",artistCredit:c.artistCredit,
   artistUrl:c.artistUrl||"",licenseReviewStatus:"approved",
 })),
 ...[
  ["s1-r1-background","background"],
  ...["s1-r1-outline","s1-r1-common","s1-r1-uncommon",
    "s1-r1-rare","s1-r1-ultrarare","s1-r1-neon","s1-r1-mega"].map(key=>[key,"frame"]),
 ].map(([key,kind])=>({key,kind,artistCredit:"Lilly",licenseReviewStatus:"approved"})),
];
const input=()=>({release,definitions:[...owner,...guest],artwork});

test("strict plan includes exactly 108 approved designs across all five rare tiers",()=>{
 const p=planSeries1CardEnablement(input());
 assert.equal(p.cardCount,108);
 assert.equal(p.cardsToEnable.length,108);
 assert.equal(p.ownerCards,88);
 assert.equal(p.guestCards,20);
 assert.equal(p.sharedLayers,8);
 assert.deepEqual(p.rarityCounts,counts);
});
test("already-enabled approved cards are not altered on retry",()=>{
 const data=input();
 data.definitions=data.definitions.map((d,i)=>i<10?{...d,enabled:true}:d);
 const p=planSeries1CardEnablement(data);
 assert.equal(p.alreadyEnabled,10);
 assert.equal(p.cardsToEnable.length,98);
});
test("cannot enable missing, unapproved or zero-weight cards",()=>{
 const data=input();
 data.artwork=data.artwork.filter(a=>a.key!==owner[0].petArtworkKey);
 assert.throws(()=>planSeries1CardEnablement(data),/Approved artwork metadata/);
 const b=input();
 b.definitions=b.definitions.map(d=>d.petId===owner[0].petId?{...d,artStatus:"pending"}:d);
 assert.throws(()=>planSeries1CardEnablement(b),/not fully approved/);
 const c=input();
 c.definitions=c.definitions.map(d=>d.petId===guest[0].petId?{...d,hatchWeight:0}:d);
 assert.throws(()=>planSeries1CardEnablement(c),/positive hatch weight/);
});
test("cannot enable a changed rarity distribution or a substituted guest artist",()=>{
 const data=input();
 data.definitions=data.definitions.map(d=>d.petId===owner[0].petId?{...d,rarity:"Legendary"}:d);
 assert.throws(()=>planSeries1CardEnablement(data),/rarity roster/);
 const b=input();
 b.definitions=b.definitions.map(d=>d.petId===guest[0].petId?{...d,artistUrl:"https://wrong.example"}:d);
 assert.throws(()=>planSeries1CardEnablement(b),/Guest artist attribution/);
});
test("cannot change active release or ignore shared asset approvals",()=>{
 const data=input();
 assert.throws(()=>planSeries1CardEnablement({...data,release:{...release,status:"active"}}),/draft/);
 data.artwork=data.artwork.map(a=>a.key==="s1-r1-neon"?{...a,licenseReviewStatus:"needs-review"}:a);
 assert.throws(()=>planSeries1CardEnablement(data),/Shared artwork/);
});
