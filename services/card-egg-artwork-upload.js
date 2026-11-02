import mongoose from "mongoose";
import CardRelease from "../models/CardRelease.js";
import CardEggArtwork from "../models/CardEggArtwork.js";
import { readDiscordAttachment } from "./media-transfer.js";
import { assertImageSafeToDecode } from "./image-dimensions.js";
import { EGG_ART_MAX_BYTES } from "./card-egg-artwork.js";

export const CARD_EGG_BUCKET = "cardEggArtwork";
export const TEST_EGG_SOURCE = Object.freeze({
  artworkId: "egg-drop-001",
  creatorName: "AM Isa project owner",
  sourceArtist: "stux",
  sourcePlatform: "Pixabay",
  sourceAssetId: "1255730",
  sourceArtistUrl: "https://pixabay.com/users/stux-12364/",
  creditText: "Edited for AM Isa using artwork by stux from Pixabay.",
  licenseReviewStatus: "needs-review",
});

function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { mime: "image/png", ext: "png" };
  if (bytes.subarray(0, 3).equals(Buffer.from([255,216,255]))) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  throw new Error("Upload a PNG, JPG, or WebP image.");
}

/** Upload exactly once for TEST Release 1. Does not modify cards or other media. */
export async function storeTestEggArtwork({ releaseId, attachment, uploadedBy }) {
  if (releaseId !== "test-s1-r1") throw new Error("Only the isolated TEST Release 1 is enabled for artwork uploads.");
  if (!attachment?.url || !attachment?.name) throw new Error("A Discord image attachment is required.");
  if (attachment.size > EGG_ART_MAX_BYTES) throw new Error("The artwork exceeds the 12 MB upload limit.");
  const release = await CardRelease.findOne({ releaseId });
  if (!release) throw new Error("Test release not found.");
  if (release.eggImageFileId || release.eggImageUrl || await CardEggArtwork.exists({ releaseId })) {
    throw new Error("This release already has stored egg artwork. It was not overwritten.");
  }
  const bytes = await readDiscordAttachment(attachment.url, { maxBytes: EGG_ART_MAX_BYTES });
  assertImageSafeToDecode(bytes);
  const { mime, ext } = imageType(bytes);
  const database = mongoose.connection.db;
  const bucket = new mongoose.mongo.GridFSBucket(database, { bucketName: CARD_EGG_BUCKET });
  const filename = `${TEST_EGG_SOURCE.artworkId}.${ext}`;
  const upload = bucket.openUploadStream(filename, {
    metadata: { releaseId, artworkId: TEST_EGG_SOURCE.artworkId, contentType: mime },
    contentType: mime,
  });
  let uploaded = false;
  try {
    await new Promise((resolve, reject) => {
      upload.once("error", reject);
      upload.once("finish", resolve);
      upload.end(bytes);
    });
    uploaded = true;
    const record = await CardEggArtwork.create({
      ...TEST_EGG_SOURCE,
      releaseId,
      fileId: upload.id,
      bucket: CARD_EGG_BUCKET,
      originalFilename: String(attachment.name).slice(0, 255),
      contentType: mime,
      byteLength: bytes.length,
      uploadedBy,
    });
    try {
      const result = await CardRelease.updateOne({
        _id: release._id, eggImageFileId: null, eggImageUrl: "",
      }, { $set: { eggImageFileId: upload.id, eggImageBucket: CARD_EGG_BUCKET, eggArtworkId: TEST_EGG_SOURCE.artworkId } });
      if (result.modifiedCount !== 1) throw new Error("Release artwork was linked concurrently. No changes were retained.");
    } catch (error) {
      await CardEggArtwork.deleteOne({ _id: record._id });
      throw error;
    }
    return { artworkId: TEST_EGG_SOURCE.artworkId, releaseId, filename, bytes: bytes.length,
      creditText: TEST_EGG_SOURCE.creditText, reviewStatus: TEST_EGG_SOURCE.licenseReviewStatus };
  } catch (error) {
    if (uploaded) {
      try { await bucket.delete(upload.id); } catch (cleanup) { console.error("[Cards] Egg art orphan cleanup failed:", cleanup); }
    } else {
      try { await upload.abort(); } catch { /* already failed */ }
    }
    throw error;
  }
}


// Official egg banners are stored separately from TEST egg fixtures.
// Attribution is supplied by the owner and remains under review until approved.
export async function storeOfficialEggArtwork({
  releaseId, attachment, uploadedBy, artist, platform, sourceId, creditText,
}) {
  if (!releaseId || String(releaseId).startsWith("test-")) throw Error("Choose a real draft release, not a test fixture.");
  const release = await CardRelease.findOne({ releaseId, status: "draft" });
  if (!release) throw Error("Official egg artwork can only be added to an existing draft release.");
  const attribution = [artist,platform,sourceId,creditText].map(v=>String(v||"").trim());
  if (attribution.some(v=>!v || v.length>250)) throw Error("Provide the artist, source platform, source ID and credit text (each up to 250 characters).");
  if (!attachment?.url || !attachment?.name) throw Error("Attach a PNG, JPG or WebP image.");
  if (attachment.size > EGG_ART_MAX_BYTES) throw Error("Egg artwork exceeds 12 MB.");
  if (release.eggImageFileId || release.eggImageUrl || await CardEggArtwork.exists({ releaseId }))
    throw Error("This release already has egg artwork; existing assets cannot be overwritten.");
  const bytes = await readDiscordAttachment(attachment.url, { maxBytes: EGG_ART_MAX_BYTES });
  assertImageSafeToDecode(bytes);
  const {mime,ext} = imageType(bytes);
  if (!mongoose.connection.db) throw Error("MongoDB must be connected.");
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db,{bucketName:CARD_EGG_BUCKET});
  const artworkId = "official-"+releaseId;
  const upload = bucket.openUploadStream(artworkId+"."+ext,{
    contentType:mime,metadata:{releaseId,artworkId,contentType:mime},
  });
  let uploaded = false;
  try {
    await new Promise((resolve,reject)=>{
      upload.once("error",reject);upload.once("finish",resolve);upload.end(bytes);
    });
    uploaded=true;
    const record=await CardEggArtwork.create({
      artworkId,releaseId,fileId:upload.id,bucket:CARD_EGG_BUCKET,
      originalFilename:String(attachment.name).slice(0,255),
      contentType:mime,byteLength:bytes.length,
      creatorName:attribution[0],sourceArtist:attribution[0],
      sourcePlatform:attribution[1],sourceAssetId:attribution[2],
      creditText:attribution[3],licenseReviewStatus:"needs-review",uploadedBy,
    });
    try {
      const updated=await CardRelease.updateOne({
        _id:release._id,status:"draft",eggImageFileId:null,eggImageUrl:"",
      },{$set:{eggImageFileId:upload.id,eggImageBucket:CARD_EGG_BUCKET,eggArtworkId:artworkId}});
      if(updated.modifiedCount!==1)throw Error("Egg artwork link changed during upload.");
    }catch(error){
      await CardEggArtwork.deleteOne({_id:record._id});
      throw error;
    }
    return {releaseId,artworkId,reviewStatus:"needs-review"};
  }catch(error){
    if(uploaded){try{await bucket.delete(upload.id)}catch(cleanup){console.error("[Hatchem] Failed to clean egg art:",cleanup)}}
    else{try{await upload.abort()}catch{/* already failed */}}
    throw error;
  }
}

export async function reviewOfficialEggArtwork({ releaseId, reviewerId, note }) {
  const explanation=String(note||"").trim();
  if(explanation.length<10||explanation.length>1000)
    throw Error("Provide a permission/source review note between 10 and 1000 characters.");
  const release=await CardRelease.findOne({releaseId,status:"draft"}).lean();
  if(!release||String(releaseId).startsWith("test-"))throw Error("Only official draft egg art may be approved.");
  const updated=await CardEggArtwork.findOneAndUpdate({
    releaseId,licenseReviewStatus:"needs-review",
  },{$set:{licenseReviewStatus:"approved",reviewedBy:reviewerId,
    reviewedAt:new Date(),reviewNote:explanation}},{new:true}).lean();
  if(!updated)throw Error("No pending artwork was found for this draft release.");
  return {releaseId,status:"approved",creditText:updated.creditText};
}
