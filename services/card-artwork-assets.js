import mongoose from "mongoose";
import CardArtwork from "../models/CardArtwork.js";
import CardArtworkReview from "../models/CardArtworkReview.js";
import { readDiscordAttachment } from "./media-transfer.js";
import { assertImageSafeToDecode } from "./image-dimensions.js";

export const CARD_ARTWORK_BUCKET = "cardArtwork";
export const CARD_ARTWORK_MAX_BYTES = 12 * 1024 * 1024;
export const CARD_ARTWORK_KINDS = Object.freeze(["pet", "background", "frame"]);

export function validateCardArtworkKey(key) {
  const normalized = String(key || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(normalized)) {
    throw new Error("Artwork key must be 3–64 lowercase letters, numbers, hyphens or underscores.");
  }
  return normalized;
}
function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { mime: "image/png", ext: "png" };
  if (bytes.subarray(0, 3).equals(Buffer.from([255,216,255]))) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  throw new Error("Only PNG, JPG and WebP artwork is supported.");
}
export async function uploadCardArtwork({ key, kind, attachment, artistCredit = "", uploadedBy, replacesKey = "", revisionNote = "" }) {
  const artworkKey = validateCardArtworkKey(key);
  if (!CARD_ARTWORK_KINDS.includes(kind)) throw new Error("Invalid card artwork layer type.");
  if (!attachment?.url || !attachment?.name) throw new Error("Attach a PNG, JPG or WebP image.");
  if (attachment.size > CARD_ARTWORK_MAX_BYTES) throw new Error("Artwork exceeds 12 MB.");
  if (kind === "pet" && !String(artistCredit).trim()) throw new Error("Pet artwork requires an artist credit.");
  if (await CardArtwork.exists({ key: artworkKey })) throw new Error("This artwork key already exists. Use a new key; existing artwork is never overwritten.");
  let predecessor = null;
  if (replacesKey) {
    const previous = validateCardArtworkKey(replacesKey);
    if (previous === artworkKey) throw new Error("A revision needs a new artwork key.");
    predecessor = await CardArtwork.findOne({ key: previous }).lean();
    if (!predecessor) throw new Error("Original artwork revision does not exist.");
    if (predecessor.kind !== kind) throw new Error("A revision must have the same layer type.");
    if (!String(revisionNote).trim()) throw new Error("Explain what changed in this revision.");
  }
  const bytes = await readDiscordAttachment(attachment.url, { maxBytes: CARD_ARTWORK_MAX_BYTES });
  const dimensions = assertImageSafeToDecode(bytes);
  const { mime, ext } = imageType(bytes);
  if ((kind === "background" || kind === "frame") &&
      (!dimensions || dimensions.width !== 900 || dimensions.height !== 1260)) {
    throw new Error("Card backgrounds and frames must be exactly 900 × 1260 pixels. Export at the artist template size.");
  }
  if (kind === "frame" && mime !== "image/png" && mime !== "image/webp") throw new Error("Frame overlays must be PNG or WebP with transparency.");
  if (!mongoose.connection.db) throw new Error("MongoDB must be connected.");
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: CARD_ARTWORK_BUCKET });
  const upload = bucket.openUploadStream(`${artworkKey}.${ext}`, { contentType: mime, metadata: { key: artworkKey, kind } });
  let finished = false;
  try {
    await new Promise((resolve, reject) => {
      upload.once("error", reject);
      upload.once("finish", resolve);
      upload.end(bytes);
    });
    finished = true;
    await CardArtwork.create({
      key: artworkKey, kind, fileId: upload.id, bucket: CARD_ARTWORK_BUCKET,
      mime, originalFilename: String(attachment.name).slice(0, 255),
      byteLength: bytes.length, artistCredit: String(artistCredit).trim(),
      uploadedBy, licenseReviewStatus: "needs-review",
      replacesKey: predecessor?.key || "", revisionNote: String(revisionNote).trim().slice(0, 500),
    });
    return { key: artworkKey, kind, bytes: bytes.length };
  } catch (error) {
    if (finished) {
      try { await bucket.delete(upload.id); } catch (cleanup) { console.error("[Cards] Artwork cleanup failed:", cleanup); }
    } else {
      try { await upload.abort(); } catch { /* stream already failed */ }
    }
    throw error;
  }
}
export async function loadCardArtwork(key, expectedKind) {
  if (!key) return null;
  const artwork = await CardArtwork.findOne({ key, kind: expectedKind }).lean();
  if (!artwork) throw new Error(`Missing ${expectedKind} artwork: ${key}`);
  if (artwork.bucket !== CARD_ARTWORK_BUCKET || !mongoose.isValidObjectId(artwork.fileId)) throw new Error("Invalid artwork storage reference.");
  if (artwork.byteLength < 1 || artwork.byteLength > CARD_ARTWORK_MAX_BYTES) throw new Error("Invalid stored artwork size.");
  const stream = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: CARD_ARTWORK_BUCKET })
    .openDownloadStream(artwork.fileId);
  const chunks = [];
  let length = 0;
  for await (const chunk of stream) {
    length += chunk.length;
    if (length > CARD_ARTWORK_MAX_BYTES) { stream.destroy(); throw new Error("Stored artwork too large."); }
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  assertImageSafeToDecode(bytes);
  return { bytes, artwork };
}

/** Managers only. Limited, newest-first results to avoid huge Discord messages. */
export async function browseCardArtwork({ kind, status, page = 1 } = {}) {
  if (kind && !CARD_ARTWORK_KINDS.includes(kind)) throw new Error("Invalid artwork kind.");
  if (status && !["needs-review", "approved", "rejected"].includes(status)) throw new Error("Invalid artwork status.");
  const number = Number(page);
  if (!Number.isSafeInteger(number) || number < 1 || number > 1000) throw new Error("Page must be 1–1000.");
  const query = { ...(kind ? { kind } : {}), ...(status ? { licenseReviewStatus: status } : {}) };
  const [total, items] = await Promise.all([
    CardArtwork.countDocuments(query),
    CardArtwork.find(query).sort({ createdAt: -1, _id: -1 })
      .skip((number - 1) * 8).limit(8).select("key kind artistCredit replacesKey licenseReviewStatus createdAt").lean(),
  ]);
  return { total, page: number, pages: Math.max(1, Math.ceil(total / 8)), items };
}

export async function getCardArtworkDetails(key) {
  const normalized = validateCardArtworkKey(key);
  const [artwork, history, revisions] = await Promise.all([
    CardArtwork.findOne({ key: normalized }).lean(),
    CardArtworkReview.find({ artworkKey: normalized }).sort({ createdAt: -1 }).limit(8).lean(),
    CardArtwork.find({ replacesKey: normalized }).select("key createdAt").sort({ createdAt: -1 }).limit(8).lean(),
  ]);
  if (!artwork) throw new Error("Artwork key was not found.");
  return { artwork, history, revisions };
}

/** Records status decisions, without silently modifying any card definitions. */
export async function reviewCardArtwork({ key, decision, note, reviewerId }) {
  const normalized = validateCardArtworkKey(key);
  if (!["approved", "rejected", "needs-review"].includes(decision)) throw new Error("Invalid artwork decision.");
  const explanation = String(note || "").trim();
  if (explanation.length < 5 || explanation.length > 1000) throw new Error("Provide a review note between 5 and 1000 characters, including permission/source evidence for approvals.");
  if (!reviewerId) throw new Error("Reviewer ID is required.");
  const previous = await CardArtwork.findOne({ key: normalized }).lean();
  if (!previous) throw new Error("Artwork not found.");
  if (decision === "approved" && !previous.artistCredit) throw new Error("Artist credit is required before approval.");
  if (previous.licenseReviewStatus === decision) throw new Error("Artwork already has that status. No duplicate review was recorded.");
  const updated = await CardArtwork.updateOne(
    { _id: previous._id, licenseReviewStatus: previous.licenseReviewStatus },
    { $set: { licenseReviewStatus: decision, reviewedBy: reviewerId, reviewedAt: new Date() } },
  );
  if (updated.modifiedCount !== 1) throw new Error("Artwork changed during review; please try again.");
  try {
    await CardArtworkReview.create({
      artworkKey: normalized, action: decision, previousStatus: previous.licenseReviewStatus,
      reviewerId, note: explanation,
    });
  } catch (error) {
    // If audit logging fails, roll back the state rather than approve silently.
    await CardArtwork.updateOne(
      { _id: previous._id, licenseReviewStatus: decision, reviewedBy: reviewerId },
      { $set: {
        licenseReviewStatus: previous.licenseReviewStatus,
        reviewedBy: previous.reviewedBy || "",
        reviewedAt: previous.reviewedAt || null,
      } },
    );
    throw error;
  }
  return { key: normalized, previousStatus: previous.licenseReviewStatus, status: decision };
}
