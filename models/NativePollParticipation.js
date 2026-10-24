import mongoose from "mongoose";

// One current ballot per person per native Discord poll, even when selecting
// multiple answers. No member Points are awarded by this observer.
const schema = new mongoose.Schema({
  guildId: { type: String, required: true },
  channelId: { type: String, required: true },
  messageId: { type: String, required: true },
  discordUserId: { type: String, required: true },
  answerIds: { type: [Number], default: [] },
  lastEventAt: { type: Date, default: Date.now },
}, { timestamps: true });
schema.index({ guildId: 1, messageId: 1, discordUserId: 1 }, { unique: true });
schema.index({ guildId: 1, messageId: 1 });
export default mongoose.model("NativePollParticipation", schema);
