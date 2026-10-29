import mongoose from "mongoose";

const schema = new mongoose.Schema({
  discordUserId: { type: String, required: true, unique: true, immutable: true },
  // Empty tags are saved globally for the collector, even before assignment.
  tagNames: { type: [String], default: [] },
  dust: {
    Common: { type: Number, default: 0, min: 0 },
    Uncommon: { type: Number, default: 0, min: 0 },
    Rare: { type: Number, default: 0, min: 0 },
    "Ultra-Rare": { type: Number, default: 0, min: 0 },
    Legendary: { type: Number, default: 0, min: 0 },
  },
}, { timestamps: true });
export default mongoose.models.CardCollector || mongoose.model("CardCollector", schema);
