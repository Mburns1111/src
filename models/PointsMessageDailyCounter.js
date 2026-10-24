import mongoose from "mongoose";

// Per-UTC-day earning throttle: at most ten rewarded messages per member.
const schema = new mongoose.Schema({
  guildId: { type: String, required: true },
  discordUserId: { type: String, required: true },
  dayUtc: { type: String, required: true },
  messagesRewarded: { type: Number, default: 0, min: 0 },
}, { timestamps: true });
schema.index({ guildId: 1, discordUserId: 1, dayUtc: 1 }, { unique: true });
export default mongoose.model("PointsMessageDailyCounter", schema);
