import test from "node:test";
import assert from "node:assert/strict";
import { planSeries1ArtworkReview } from "../services/card-series1-review-plan.js";
import { SERIES1_ARTIST_PETS } from "../services/card-series1-artist-pack.js";

const release = {
  releaseId:"s1-r1",status:"draft",
  cardBackgroundKey:"s1-r1-background",
  cardFrameKey:"s1-r1-outline",
  cardRarityFrameKeys: {
    Common:"s1-r1-common",Uncommon:"s1-r1-uncommon",
    Rare:"s1-r1-rare","Ultra-Rare":"s1-r1-ultrarare",
  },
  cardStageOverlayKeys: { neon:"s1-r1-neon", mega:"s1-r1-mega" },
};
const owned = Array.from({length:88},(_,i)=>({
  _id:"owner-"+i, petId:"own-"+i,petArtworkKey:"s1-r1-pet-own-"+i,
  artistCredit:"Lilly",artStatus:"pending",enabled:false,
}));
const guest = SERIES1_ARTIST_PETS.map((pet,i)=>({
  _id:"guest-"+i,petId:pet.petId,petArtworkKey:"s1-r1-pet-"+pet.petId,
  artistCredit:pet.artistCredit,artistUrl:pet.artistUrl,
  artStatus:"pending",enabled:false,
}));
const art = [
  ...owned.map(c=>({_id:c._id,key:c.petArtworkKey,kind:"pet",
    artistCredit:"Lilly",licenseReviewStatus:"needs-review"})),
  ...guest.map(c=>({_id:c._id,key:c.petArtworkKey,kind:"pet",
    artistCredit:c.artistCredit,artistUrl:c.artistUrl,licenseReviewStatus:"needs-review"})),
  ...[
    ["s1-r1-background","background"],
    ...["s1-r1-outline","s1-r1-common","s1-r1-uncommon",
      "s1-r1-rare","s1-r1-ultrarare","s1-r1-neon","s1-r1-mega"].map(key=>[key,"frame"]),
  ].map(([key,kind])=>({_id:key,key,kind,artistCredit:"Lilly",licenseReviewStatus:"needs-review"})),
];
const input = () => ({release,definitions:[...owned,...guest],artworks:art});

test("owner batch selects 88 pet cards and eight shared layers, never 20 guest images",()=>{
 const p=planSeries1ArtworkReview({...input(),scope:"owner"});
 assert.equal(p.selectedCards,88);
 assert.equal(p.totalArtwork,96);
 assert.equal(p.assetsToApprove.length,96);
 assert.equal(p.cardsToApprove.length,88);
 assert.equal(p.guestAssetsUntouched,20);
 assert.ok(p.assetsToApprove.every(a=>!guest.some(c=>c.petArtworkKey===a.key)));
});

test("guest artists are independently reviewed without touching each other or the owner's layers",()=>{
 const arial=planSeries1ArtworkReview({...input(),scope:"artist-arial"});
 const jovy=planSeries1ArtworkReview({...input(),scope:"artist-jovy"});
 assert.equal(arial.selectedCards,7);
 assert.equal(jovy.selectedCards,13);
 assert.equal(arial.totalArtwork,7);
 assert.equal(jovy.totalArtwork,13);
 assert.ok(arial.assetsToApprove.every(a=>guest.some(c=>c.petArtworkKey===a.key)));
 assert.ok(jovy.assetsToApprove.every(a=>guest.some(c=>c.petArtworkKey===a.key)));
 assert.equal(arial.guestAssetsUntouched,13);
 assert.equal(jovy.guestAssetsUntouched,7);
});

test("already approved assets and cards require no repeat changes",()=>{
 const data=input();
 data.definitions=data.definitions.map(x=>({...x,artStatus:"approved"}));
 data.artworks=data.artworks.map(x=>({...x,licenseReviewStatus:"approved"}));
 for(const scope of ["owner","artist-arial","artist-jovy"]){
  const p=planSeries1ArtworkReview({...data,scope});
  assert.equal(p.cardsToApprove.length,0);
  assert.equal(p.assetsToApprove.length,0);
 }
});

test("cannot replace permissions or relabel an artist in a batch",()=>{
 const data=input();
 data.artworks=data.artworks.map(x=>x.key===guest[0].petArtworkKey?{...x,artistCredit:"Wrong"}:x);
 assert.throws(()=>planSeries1ArtworkReview({...data,scope:"artist-arial"}),/mismatch/);
 const owners=input();
 owners.definitions=owners.definitions.map(x=>x.petId===owned[0].petId?{...x,artistUrl:"https://example.com"}:x);
 assert.throws(()=>planSeries1ArtworkReview({...owners,scope:"owner"}),/external/);
});

test("refuses missing artwork, extra pets, absent layers and active releases",()=>{
 assert.throws(()=>planSeries1ArtworkReview({...input(),scope:"owner",release:{...release,status:"active"}}),/draft/);
 assert.throws(()=>planSeries1ArtworkReview({...input(),scope:"owner",definitions:[...owned,...guest.slice(1)]}),/108/);
 assert.throws(()=>planSeries1ArtworkReview({...input(),scope:"owner",artworks:art.slice(0,-1)}),/Shared asset/);
 const bad=input();bad.definitions=bad.definitions.map(x=>x.petId===owned[0].petId?{...x,enabled:true}:x);
 assert.throws(()=>planSeries1ArtworkReview({...bad,scope:"owner"}),/enabled/);
});
