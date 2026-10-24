import mongoose from "mongoose";

// Repeatable earnings pool, separate from milestones and staff/manual awards.
// periodKey is anchored to the join instant for first seven days and otherwise
// follows the UTC Monday–Sunday week.
const schema = new mongoose.Schema({
  guildId: { type: String, required: true },
  discordUserId: { type: String, required: true },
  periodKey: { type: String, required: true },
  earned: { type: Number, default: 0, min: 0 },
}, { timestamps: true });
schema.index({ guildId: 1, discordUserId: 1, periodKey: 1 }, { unique: true });
export default mongoose.model("PointsActivityCounter", schema);
