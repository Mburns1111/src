import mongoose from "mongoose";

// One collection per server/member. Ownership is shared across every post type.
// Purchase flows will grant stable catalog IDs using $addToSet.
const appearanceInventorySchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  discordUserId: { type: String, required: true },
  owned: {
    backgrounds: { type: [String], default: [] },
    panels: { type: [String], default: [] },
    frames: { type: [String], default: [] },
    fonts: { type: [String], default: [] },
    fontColors: { type: [String], default: [] },
    stickers: { type: [String], default: [] },
  },
}, { timestamps: true });
appearanceInventorySchema.index({ guildId: 1, discordUserId: 1 }, { unique: true });
export default mongoose.model("AppearanceInventory", appearanceInventorySchema);
