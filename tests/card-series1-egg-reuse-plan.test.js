import test from "node:test";
import assert from "node:assert/strict";
import CardEggArtwork from "../models/CardEggArtwork.js";
import { planSeries1TestEggReuse } from "../services/card-series1-egg-reuse-plan.js";

const fileId="507f1f77bcf86cd799439011";
const sourceRelease={
 releaseId:"test-s1-r1",eggImageFileId:fileId,eggImageBucket:"cardEggArtwork",
};
const targetRelease={
 releaseId:"s1-r1",status:"draft",eggImageFileId:null,eggImageUrl:"",eggArtworkId:"",
};
const sourceArtwork={
 releaseId:"test-s1-r1",fileId,bucket:"cardEggArtwork",
 artworkId:"egg-drop-001",licenseReviewStatus:"needs-review",
 originalFilename:"Release 1.png",contentType:"image/png",byteLength:25000,
 creatorName:"AM Isa project owner",
 sourceArtist:"stux",sourcePlatform:"Pixabay",sourceAssetId:"1255730",
 sourceArtistUrl:"https://pixabay.com/users/stux-12364/",
 creditText:"Edited for AM Isa using artwork by stux from Pixabay.",
};
const input=()=>({sourceRelease,targetRelease,sourceArtwork,targetArtwork:null});
test("previews exact previously stored TEST banner without adopting its license approval",()=>{
 const p=planSeries1TestEggReuse(input());
 assert.equal(p.sourceArtworkId,"egg-drop-001");
 assert.equal(p.targetLicenseReview,"needs-review");
 assert.equal(p.sourceCredit,undefined);
 assert.equal(p.creditText,sourceArtwork.creditText);
 assert.equal(p.bytes,25000);
});
test("approved source still requires independent official review",()=>{
 const p=planSeries1TestEggReuse({
   ...input(),sourceArtwork:{...sourceArtwork,licenseReviewStatus:"approved"},
 });
 assert.equal(p.targetLicenseReview,"needs-review");
});
test("rejects missing or mismatched TEST release image references",()=>{
 assert.throws(()=>planSeries1TestEggReuse({...input(),sourceArtwork:null}),/source test-release/i);
 assert.throws(()=>planSeries1TestEggReuse({
   ...input(),sourceRelease:{...sourceRelease,eggImageFileId:"another-file"},
 }),/saved image reference/);
 assert.throws(()=>planSeries1TestEggReuse({
   ...input(),sourceArtwork:{...sourceArtwork,bucket:"assets"},
 }),/expected verified MongoDB bucket/);
});
test("rejects rejected images and prior official artworks",()=>{
 assert.throws(()=>planSeries1TestEggReuse({
   ...input(),sourceArtwork:{...sourceArtwork,licenseReviewStatus:"rejected"},
 }),/Rejected/);
 assert.throws(()=>planSeries1TestEggReuse({
   ...input(),targetArtwork:{releaseId:"s1-r1"},
 }),/already has egg artwork/);
 assert.throws(()=>planSeries1TestEggReuse({
   ...input(),targetRelease:{...targetRelease,status:"active"},
 }),/official draft/);
});
test("records independent provenance fields for the copied official record",()=>{
 assert.ok(CardEggArtwork.schema.path("reusedFromReleaseId"));
 assert.ok(CardEggArtwork.schema.path("reusedFromArtworkId"));
 assert.equal(CardEggArtwork.schema.path("licenseReviewStatus").options.default,"needs-review");
 assert.equal(CardEggArtwork.schema.path("fileId").options.unique,true);
});
