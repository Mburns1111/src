import mongoose from "mongoose";

const pointsSettingsSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  milestonesEnabled: { type: Boolean, default: true },
  // Explicit opt-in. Never silently start rewarding chat/voice on existing servers.
  messageRewardsEnabled: { type: Boolean, default: false },
  voiceRewardsEnabled: { type: Boolean, default: false },
  // Applies only to staff historical scans, not live message earning.
  messageScanExcludedChannelIds: { type: [String], default: () => [] },
  milestoneAmounts: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
}, { timestamps: true });
export default mongoose.model("PointsSettings", pointsSettingsSchema);
