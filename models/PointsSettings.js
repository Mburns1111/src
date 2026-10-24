import mongoose from "mongoose";

const pointsSettingsSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  milestonesEnabled: { type: Boolean, default: true },
  milestoneAmounts: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
}, { timestamps: true });
export default mongoose.model("PointsSettings", pointsSettingsSchema);
