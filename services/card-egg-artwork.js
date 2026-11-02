import mongoose from "mongoose";
import { assertImageSafeToDecode } from "./image-dimensions.js";

// Resolve an existing image in the SAME MongoDB database. Never copy artwork
// into the source repository, issue a network URL, or use a member's other
// assets without an exact match.
export const EGG_ART_BUCKETS = Object.freeze([
  "cardEggArtwork", "artwork", "artworks", "cardArtwork", "cardArt", "assets", "fs", "profilePhotos",
]);
export const EGG_ART_MAX_BYTES = 12 * 1024 * 1024;
const allowedBucket = new Set(EGG_ART_BUCKETS);

function db() {
  if (!mongoose.connection.db) throw new Error("MongoDB connection required to load egg artwork");
  return mongoose.connection.db;
}

export async function findReleaseEggCandidates(releaseName = "Release 1") {
  const database = db();
  const token = String(releaseName).replace(/^TEST\s+/i, "").replace(/\s+Egg$/i, "").trim();
  if (!token || token.length > 70) throw new Error("Invalid release name");
  const filenamePattern = new RegExp(`^${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s*\\(\\d+\\))?\\.(?:png|jpe?g|webp)$`, "i");
  const matches = [];
  const collections = new Set((await database.listCollections({}, { nameOnly: true }).toArray()).map(x => x.name));
  for (const bucket of EGG_ART_BUCKETS) {
    if (!collections.has(`${bucket}.files`)) continue;
    const candidates = await database.collection(`${bucket}.files`)
      .find({ filename: { $regex: filenamePattern } }, { projection: { _id: 1, filename: 1, length: 1, contentType: 1, metadata: 1 } })
      .limit(12).toArray();
    for (const file of candidates) {
      matches.push({ bucket, id: String(file._id), filename: file.filename, bytes: file.length, contentType: file.contentType || file.metadata?.contentType || "" });
    }
  }
  return matches;
}

export async function loadStoredReleaseEggImage(release) {
  const explicitBucket = release.eggImageBucket;
  const explicitId = release.eggImageFileId;
  if (explicitId && explicitBucket) {
    if (!allowedBucket.has(explicitBucket) || !mongoose.isValidObjectId(explicitId)) {
      throw new Error("Release egg artwork reference is invalid");
    }
    return readStoredEggFile(explicitBucket, new mongoose.Types.ObjectId(String(explicitId)));
  }
  // Auto-discovery is safe ONLY when one exact release filename matches.
  const matches = await findReleaseEggCandidates(release.name);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    console.warn("[Cards] Multiple matching egg assets in MongoDB; configure eggImageFileId/eggImageBucket", matches.map(({bucket, filename})=>({bucket, filename})));
    return null;
  }
  return readStoredEggFile(matches[0].bucket, new mongoose.Types.ObjectId(matches[0].id));
}

export async function readStoredEggFile(bucketName, fileId) {
  if (!allowedBucket.has(bucketName)) throw new Error("Unsupported MongoDB artwork bucket");
  const database = db();
  const record = await database.collection(`${bucketName}.files`).findOne(
    { _id: fileId }, { projection: { filename: 1, length: 1, contentType: 1, metadata: 1 } },
  );
  if (!record) throw new Error("Release egg artwork no longer exists in MongoDB");
  if (!Number.isFinite(record.length) || record.length < 1 || record.length > EGG_ART_MAX_BYTES) {
    throw new Error("Release egg artwork is empty or exceeds the image size limit");
  }
  if (!/\.(png|jpe?g|webp)$/i.test(record.filename || "")) {
    throw new Error("Release egg artwork must be a PNG, JPG or WebP");
  }
  const stream = new mongoose.mongo.GridFSBucket(database, { bucketName }).openDownloadStream(fileId);
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > EGG_ART_MAX_BYTES) {
      stream.destroy();
      throw new Error("Release egg artwork exceeds the image size limit");
    }
    chunks.push(Buffer.from(chunk));
  }
  const image = Buffer.concat(chunks);
  assertImageSafeToDecode(image);
  return image;
}
