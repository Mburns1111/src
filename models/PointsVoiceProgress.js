import mongoose from "mongoose";

// Accumulate eligible one-minute voice intervals; deduplicate each minute across
// restarts and never count offline time.
const schema = new mongoose.Schema({
  guildId: { type: String, required: true },
  discordUserId: { type: String, required: true },
  periodKey: { type: String, required: true },
  eligibleMinutes: { type: Number, default: 0, min: 0 },
  lastMinuteStamp: { type: Number, default: 0 },
  lastSettledBlock: { type: Number, default: 0 },
}, { timestamps: true });
schema.index({ guildId: 1, discordUserId: 1, periodKey: 1 }, { unique: true });
export default mongoose.model("PointsVoiceProgress", schema);
