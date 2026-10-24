import mongoose from "mongoose";

// A shared per-member/week counter makes a poll cap atomic even when multiple
// different polls are voted on at the same moment.
const schema = new mongoose.Schema({
  guildId: { type: String, required: true },
  discordUserId: { type: String, required: true },
  weekStartUtc: { type: String, required: true },
  pollPoints: { type: Number, default: 0, min: 0 },
}, { timestamps: true });
schema.index({ guildId: 1, discordUserId: 1, weekStartUtc: 1 }, { unique: true });
export default mongoose.model("PointsWeeklyCounter", schema);
