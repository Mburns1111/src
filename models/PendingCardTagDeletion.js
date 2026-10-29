import mongoose from "mongoose";

// A short-lived, single-use confirmation. No card ownership or inventory data
// is stored here; the tag is only an organizational label.
const schema = new mongoose.Schema({
  discordUserId: { type: String, required: true },
  tag: { type: String, required: true, maxlength: 32 },
  expectedCount: { type: Number, required: true, min: 0 },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ["pending", "confirmed", "cancelled"], default: "pending" },
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.models.PendingCardTagDeletion || mongoose.model("PendingCardTagDeletion", schema);
