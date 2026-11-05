import mongoose from "mongoose";

const schema = new mongoose.Schema({
  seriesId: { type: String, required: true },
  releaseId: { type: String, required: true },
  petId: { type: String, required: true },
  rarity: { type: String, required: true, enum: ["Common", "Uncommon", "Rare", "Ultra-Rare", "Legendary"] },
  artStatus: { type: String, enum: ["missing", "pending", "approved", "test-placeholder"], default: "missing" },
  artUrl: { type: String, default: "" },
  petArtworkKey: { type: String, default: "" },
  // Optional illustration overrides. Existing copies always resolve these at render time;
  // no new card ID, hatch chance, or upgrade transaction is needed.
  stagePetArtworkKeys: {
    neon: { type: String, default: "" },
    mega: { type: String, default: "" },
  },
  artistCredit: { type: String, default: "", maxlength: 100 },
  artistUrl: { type: String, default: "" },
  artSourceUrl: { type: String, default: "", maxlength: 1800 },
  hatchWeight: { type: Number, default: 1, min: 0 },
  valueReview: {
    valueScore: { type: Number, default: null },
    sourceName: { type: String, default: "" },
    sourceUrl: { type: String, default: "" },
    checkedAt: { type: Date, default: null },
    reviewMethod: { type: String, default: "", maxlength: 300 },
    // Keep the two independent published sources used to review this score.
    // Legacy sourceName/sourceUrl remain the primary display fields.
    sources: { type: [new mongoose.Schema({
      name: { type: String, required: true, maxlength: 120 },
      url: { type: String, required: true, maxlength: 1800 },
    }, { _id: false })], default: [] },
  },
  enabled: { type: Boolean, default: false },
}, { timestamps: true });

schema.index({ releaseId: 1, petId: 1 }, { unique: true });
schema.index({ releaseId: 1, enabled: 1, artStatus: 1 });
export default mongoose.models.CardDefinition || mongoose.model("CardDefinition", schema);
