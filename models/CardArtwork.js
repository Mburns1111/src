import mongoose from "mongoose";

// Image bytes live in the dedicated cardArtwork GridFS bucket, not Replit.
// Each key points to a single immutable uploaded asset; uploads never
// overwrite another artist's work or existing releases.
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, immutable: true },
  kind: { type: String, required: true, enum: ["pet", "background", "frame"] },
  fileId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, immutable: true },
  bucket: { type: String, required: true, default: "cardArtwork" },
  mime: { type: String, required: true },
  originalFilename: { type: String, required: true },
  byteLength: { type: Number, required: true },
  artistCredit: { type: String, default: "", maxlength: 100 },
  artistUrl: { type: String, default: "" },
  replacesKey: { type: String, default: "", index: true },
  revisionNote: { type: String, default: "", maxlength: 500 },
  licenseReviewStatus: { type: String, enum: ["needs-review", "approved", "rejected"], default: "needs-review" },
  uploadedBy: { type: String, required: true },
  reviewedBy: { type: String, default: "" },
  reviewedAt: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.models.CardArtwork || mongoose.model("CardArtwork", schema);
