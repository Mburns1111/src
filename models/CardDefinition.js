import mongoose from "mongoose";

const schema = new mongoose.Schema({
  seriesId: { type: String, required: true },
  releaseId: { type: String, required: true },
  petId: { type: String, required: true },
  rarity: { type: String, required: true, enum: ["Common", "Uncommon", "Rare", "Ultra-Rare", "Legendary"] },
  artStatus: { type: String, enum: ["missing", "pending", "approved", "test-placeholder"], default: "missing" },
  artUrl: { type: String, default: "" },
  petArtworkKey: { type: String, default: "" },
  artistCredit: { type: String, default: "", maxlength: 100 },
  artistUrl: { type: String, default: "" },
  hatchWeight: { type: Number, default: 1, min: 0 },
  valueReview: {
    valueScore: { type: Number, default: null },
    sourceName: { type: String, default: "" },
    sourceUrl: { type: String, default: "" },
    checkedAt: { type: Date, default: null },
  },
  enabled: { type: Boolean, default: false },
}, { timestamps: true });

schema.index({ releaseId: 1, petId: 1 }, { unique: true });
schema.index({ releaseId: 1, enabled: 1, artStatus: 1 });
export default mongoose.models.CardDefinition || mongoose.model("CardDefinition", schema);
