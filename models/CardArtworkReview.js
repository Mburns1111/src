import mongoose from "mongoose";

// Append-only moderation record: never lose the decision trail when a newer
// artwork revision replaces an earlier one in a TEST card assignment.
const schema = new mongoose.Schema({
  artworkKey: { type: String, required: true, index: true },
  action: { type: String, required: true, enum: ["approved", "rejected", "needs-review"] },
  previousStatus: { type: String, required: true },
  reviewerId: { type: String, required: true },
  note: { type: String, required: true, maxlength: 1000 },
}, { timestamps: true });

schema.index({ artworkKey: 1, createdAt: -1 });
export default mongoose.models.CardArtworkReview || mongoose.model("CardArtworkReview", schema);
