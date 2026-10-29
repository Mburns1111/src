// Read-only diagnostic. Inspects already-stored image metadata without
// downloading files, copying assets or changing card/release records.
import "dotenv/config";
import mongoose from "mongoose";
import CardRelease from "../models/CardRelease.js";
import { findReleaseEggCandidates, EGG_ART_BUCKETS } from "../services/card-egg-artwork.js";
if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI required");
await mongoose.connect(process.env.MONGODB_URI);
try {
  const releaseId = process.argv[2] || "test-s1-r1";
  if (!/^[-a-zA-Z0-9]{1,80}$/.test(releaseId)) throw new Error("Invalid release ID");
  const release = await CardRelease.findOne({ releaseId }).lean();
  if (!release) throw new Error("Release not found: " + releaseId);
  const candidates = await findReleaseEggCandidates(release.name);
  console.log(JSON.stringify({
    releaseId, releaseName: release.name,
    linkedMongoArtwork: release.eggImageFileId ? {
      bucket: release.eggImageBucket, fileId: String(release.eggImageFileId),
    } : null,
    configuredUrl: Boolean(release.eggImageUrl),
    eligibleGridFSBuckets: EGG_ART_BUCKETS,
    matchingStoredArtwork: candidates,
    automaticMatch: candidates.length === 1,
    requiresManualSelection: candidates.length > 1,
    note: candidates.length === 0
      ? "No exact file name match in supported GridFS buckets. Artwork might be in another MongoDB collection or named differently."
      : "No image bytes read and no MongoDB writes performed.",
  }, null, 2));
} finally { await mongoose.disconnect(); }
