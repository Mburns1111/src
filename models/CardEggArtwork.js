import mongoose from "mongoose";

// Persistent metadata and attribution for egg banners. The image bytes live
// in the dedicated cardEggArtwork GridFS bucket of the SAME MongoDB database.
const schema = new mongoose.Schema({
  artworkId: { type: String, required: true, unique: true, immutable: true },
  releaseId: { type: String, required: true, unique: true, immutable: true },
  fileId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  bucket: { type: String, required: true, default: "cardEggArtwork" },
  originalFilename: { type: String, required: true },
  contentType: { type: String, required: true },
  byteLength: { type: Number, required: true, min: 1 },
  creditText: { type: String, required: true },
  creatorName: { type: String, required: true },
  sourceArtist: { type: String, required: true },
  sourcePlatform: { type: String, required: true },
  sourceAssetId: { type: String, required: true },
  sourceArtistUrl: { type: String, default: "" },
  licenseReviewStatus: { type: String, enum: ["needs-review", "approved", "rejected"], default: "needs-review" },
  uploadedBy: { type: String, required: true },
}, { timestamps: true });
export default mongoose.models.CardEggArtwork || mongoose.model("CardEggArtwork", schema);
