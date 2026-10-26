import mongoose from "mongoose";

// One factual pet record per Adopt Me pet. Card editions, art and print
// supplies are modeled separately when the collectible-card game is built.
const sourceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  url: { type: String, default: "" },
  checkedAt: { type: Date, default: null },
  role: { type: String, enum: ["candidate-dataset", "official-manual-review"], default: "candidate-dataset" },
  fields: { type: [String], default: [] },
  verifiedManually: { type: Boolean, default: false },
}, { _id: false });

const schema = new mongoose.Schema({
  petId: { type: String, required: true, unique: true, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  rarity: {
    type: String,
    enum: ["Common", "Uncommon", "Rare", "Ultra-Rare", "Legendary", "Unknown"],
    default: "Unknown",
  },
  releaseEvent: { type: String, default: "" },
  releaseYear: { type: Number, default: null, min: 2017, max: 2200 },
  originalObtainingMethod: { type: String, default: "" },
  availability: {
    type: String,
    enum: ["unknown", "available", "limited", "unavailable"],
    default: "unknown",
  },
  sources: { type: [sourceSchema], default: [] },
  rarityVerification: { type: String, enum: ["official-verified", "official-adjudicated", "identity-only"], default: "identity-only" },
  reviewStatus: {
    type: String,
    enum: ["pending", "approved", "needs-review"],
    default: "pending",
  },
  notes: { type: String, default: "" },
}, { timestamps: true });

schema.index({ name: 1 });
schema.index({ reviewStatus: 1, rarity: 1 });

export default mongoose.models.PetCatalog || mongoose.model("PetCatalog", schema);
