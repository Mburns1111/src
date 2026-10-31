import mongoose from "mongoose";

const schema = new mongoose.Schema({
  discordUserId: { type: String, required: true, unique: true, immutable: true },
  // Empty tags are saved globally for the collector, even before assignment.
  tagNames: { type: [String], default: [] },
  // Only .create-tag adds to this list. Legacy .tag used to create names
  // implicitly, so tagNames alone is NOT proof that a player created a tag.
  createdTagNames: { type: [String], default: [] },
  // Added ONLY when a member explicitly runs .register (or /cards register).
  // Old test collectors with cards are not silently registered.
  registeredAt: { type: Date, default: null },
  registeredGuildIds: { type: [String], default: [] },
  bonusGrabs: {type:Number,default:0,min:0},
  bonusDrops: {type:Number,default:0,min:0},
  dust: {
    Common: { type: Number, default: 0, min: 0 },
    Uncommon: { type: Number, default: 0, min: 0 },
    Rare: { type: Number, default: 0, min: 0 },
    "Ultra-Rare": { type: Number, default: 0, min: 0 },
    Legendary: { type: Number, default: 0, min: 0 },
  },
}, { timestamps: true });
export default mongoose.models.CardCollector || mongoose.model("CardCollector", schema);
