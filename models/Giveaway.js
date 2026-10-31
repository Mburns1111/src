import mongoose from "mongoose";

// Permanent giveaway records: public posts are edited in place, never deleted
// during settlement or rerolls. Entrants live on the giveaway document so an
// atomic $addToSet can prevent duplicate clicks while closure locks entries.
const giveawaySchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  channelId: { type: String, required: true },
  messageId: { type: String, default: null },
  creatorId: { type: String, required: true },
  title: { type: String, required: true },
  prize: { type: String, required: true },
  rules: { type: String, default: "" },
  requiredRoleId: { type: String, default: "" },
  winnerCount: { type: Number, required: true, min: 1, max: 10 },
  endsAt: { type: Date, required: true },
  status: { type: String, enum: ["publishing", "open", "closing", "ended", "rerolling", "failed"], default: "publishing" },
  entrantIds: { type: [String], default: [] },
  winnerIds: { type: [String], default: [] },
  rerollHistory: [{
    slot: Number, previousId: String, replacementId: String,
    staffId: String, at: Date,
  }],
  pendingRerollSlot: { type: Number, default: null },
  pendingRerollStaffId: { type: String, default: "" },
  renderedAt: { type: Date, default: null },
  renderVersion: { type: Number, default: 0 },
}, { timestamps: true });

giveawaySchema.index({ guildId: 1, status: 1, endsAt: 1 });
giveawaySchema.index({ guildId: 1, messageId: 1 }, {
  unique: true, partialFilterExpression: { messageId: { $type: "string" } },
});
export default mongoose.models.Giveaway || mongoose.model("Giveaway", giveawaySchema);
