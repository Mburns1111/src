import mongoose from "mongoose";

// One cooldown record per guild member. Store only a hash, not message text.
const schema = new mongoose.Schema({
  guildId: { type: String, required: true },
  discordUserId: { type: String, required: true },
  lastRewardAt: { type: Date, default: () => new Date(0) },
  lastHash: { type: String, default: "" },
}, { timestamps: true });
schema.index({ guildId: 1, discordUserId: 1 }, { unique: true });
export default mongoose.model("PointsActivityMessageState", schema);
