#!/usr/bin/env node
/**
 * Reuse the real TEST Release 1 egg banner as the official Series 1 banner.
 * Copies verified bytes within MongoDB's cardEggArtwork GridFS bucket;
 * never requires a Discord image reupload or rewrites the test release.
 *
 * Read-only inspection:
 *   node scripts/reuse-test-egg-for-series1.js
 * Copy bytes and create pending-review official record:
 *   node scripts/reuse-test-egg-for-series1.js --apply
 *
 * Separate owner-only /cards-release egg-review MUST still be completed.
 * This tool never approves artwork, enables cards or activates a release.
 */
import "dotenv/config";
import mongoose from "mongoose";
import CardRelease from "../models/CardRelease.js";
import CardEggArtwork from "../models/CardEggArtwork.js";
import { isCardGameTestMode } from "../services/card-game-mode.js";
import { CARD_EGG_BUCKET } from "../services/card-egg-artwork-upload.js";
import { readStoredEggFile } from "../services/card-egg-artwork.js";
import { planSeries1TestEggReuse } from "../services/card-series1-egg-reuse-plan.js";

const params = process.argv.slice(2);
if (params.some(param => param !== "--apply"))
  throw Error("Usage: node scripts/reuse-test-egg-for-series1.js [--apply]");
const apply = params.includes("--apply");
if (!isCardGameTestMode()) throw Error("Requires ENABLE_CARD_GAME_TEST=1 in the development environment.");
const ownerId = String(process.env.CARD_GAME_OWNER_DISCORD_ID || "");
if (apply && !/^\d{17,20}$/.test(ownerId))
  throw Error("CARD_GAME_OWNER_DISCORD_ID must be configured for --apply.");
if (!process.env.MONGODB_URI) throw Error("MONGODB_URI required.");

await mongoose.connect(process.env.MONGODB_URI);
try {
  const [sourceRelease, targetRelease, sourceArtwork, targetArtwork] = await Promise.all([
    CardRelease.findOne({releaseId:"test-s1-r1"}).lean(),
    CardRelease.findOne({releaseId:"s1-r1"}).lean(),
    CardEggArtwork.findOne({releaseId:"test-s1-r1"}).lean(),
    CardEggArtwork.findOne({releaseId:"s1-r1"}).lean(),
  ]);
  const plan = planSeries1TestEggReuse({
    sourceRelease, targetRelease, sourceArtwork, targetArtwork,
  });
  // Read exact source file and validate decoded dimensions/size even for dry run.
  // No image contents or MongoDB URI are printed.
  const bytes = await readStoredEggFile(
    CARD_EGG_BUCKET, new mongoose.Types.ObjectId(plan.sourceFileId));
  if (bytes.length !== plan.bytes)
    throw Error("Stored test image length differs from its source review record.");

  console.log(JSON.stringify({
    mode:apply?"APPLY":"DRY RUN",
    from:plan.sourceReleaseId,
    to:plan.targetReleaseId,
    artwork:plan.sourceFilename,
    imageBytes:plan.bytes,
    sourceCredit:plan.creditText,
    sourceArtist:plan.artist,
    sourcePlatform:plan.platform,
    sourceAssetId:plan.sourceId,
    testArtworkReview:plan.sourceLicenseReview,
    officialArtworkReview:"needs-review",
    copiedWithinSameDatabase:apply,
    testReleaseChanged:false,
    officialReleaseActivated:false,
    cardsEnabled:false,
  },null,2));

  if (!apply) {
    console.log("No changes made. Run with --apply only if this is the intended test banner.");
  } else {
    if (!await CardRelease.exists({
      releaseId:"s1-r1",status:"draft",
      eggImageFileId:null,eggImageUrl:"",
    }) || await CardEggArtwork.exists({releaseId:"s1-r1"}))
      throw Error("Official release already has artwork or is no longer an eligible draft.");

    const ext = plan.sourceFilename.split(".").at(-1).toLowerCase();
    const filename = "official-s1-r1-from-test." + ext;
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db,{
      bucketName:CARD_EGG_BUCKET,
    });
    const upload = bucket.openUploadStream(filename,{
      contentType:plan.contentType,
      metadata:{
        releaseId:"s1-r1",artworkId:"official-s1-r1",
        reusedFromReleaseId:"test-s1-r1",
        reusedFromArtworkId:plan.sourceArtworkId,
        contentType:plan.contentType,
      },
    });
    let finished=false, saved=false;
    try {
      await new Promise((resolve,reject)=>{
        upload.once("error",reject);
        upload.once("finish",resolve);
        upload.end(bytes);
      });
      finished=true;
      await CardEggArtwork.create({
        artworkId:"official-s1-r1",releaseId:"s1-r1",
        fileId:upload.id,bucket:CARD_EGG_BUCKET,
        originalFilename:plan.sourceFilename,
        contentType:plan.contentType,byteLength:bytes.length,
        creatorName:sourceArtwork.creatorName,
        sourceArtist:sourceArtwork.sourceArtist,
        sourcePlatform:sourceArtwork.sourcePlatform,
        sourceAssetId:sourceArtwork.sourceAssetId,
        sourceArtistUrl:sourceArtwork.sourceArtistUrl || "",
        creditText:sourceArtwork.creditText,
        reusedFromReleaseId:"test-s1-r1",
        reusedFromArtworkId:plan.sourceArtworkId,
        licenseReviewStatus:"needs-review",
        uploadedBy:ownerId,
      });
      saved=true;
      const result=await CardRelease.updateOne({
        releaseId:"s1-r1",status:"draft",
        eggImageFileId:null,eggImageUrl:"",eggArtworkId:"",
      },{$set:{
        eggImageFileId:upload.id,
        eggImageBucket:CARD_EGG_BUCKET,
        eggArtworkId:"official-s1-r1",
      }});
      if (result.modifiedCount!==1)
        throw Error("Official egg reference changed concurrently; copy not assigned.");
      console.log("Official Series 1 egg banner copied from TEST to its own pending-review record. Test release unchanged.");
      console.log("Next: approve this SOURCE/CREDIT separately using /cards-release egg-review (owner-only).");
    } catch(error) {
      if(saved) {
        try{await CardEggArtwork.deleteOne({releaseId:"s1-r1",fileId:upload.id,licenseReviewStatus:"needs-review"});}
        catch(cleanup){console.error("[Hatchem] Failed to clean copied metadata:",cleanup);}
      }
      if(finished) {
        try{await bucket.delete(upload.id);}
        catch(cleanup){console.error("[Hatchem] Failed to clean copied GridFS file:",cleanup);}
      } else {
        try{await upload.abort();}catch{/* already closed */}
      }
      throw error;
    }
  }
} finally {
  await mongoose.disconnect();
}
