import mongoose from "mongoose";

// Metadata about a poll/giveaway. Arclo messages can be observed, but the
// permissions of one bot do NOT expose private interactions on another bot.
const schema = new mongoose.Schema({
  guildId: { type: String, required: true },
  channelId: { type: String, required: true },
  messageId: { type: String, required: true },
  source: { type: String, enum: ["discord-native-poll", "arclo-poll", "arclo-giveaway", "arclo-panel"], required: true },
  sourceBotId: { type: String, default: "" },
  registeredBy: { type: String, default: "" },
  // Opt-in by a server manager: otherwise native polls are observation-only.
  rewardEnabled: { type: Boolean, default: false },
  rewardApprovedBy: { type: String, default: "" },
  rewardApprovedAt: { type: Date, default: null },
  lastObservedAt: { type: Date, default: Date.now },
}, { timestamps: true });
schema.index({ guildId: 1, messageId: 1 }, { unique: true });
export default mongoose.model("ParticipationSource", schema);
