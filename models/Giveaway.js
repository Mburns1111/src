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
  mode: { type: String, enum: ["standard", "survival"], default: "standard" },
  speedSeconds: { type: Number, default: 3, min: 2, max: 5 },
  gameStartedAt: { type: Date, default: null },
  gameEndedAt: { type: Date, default: null },
  gameEvents: [{ victimId: String, actorId: String, description: String, remaining: Number }],
  nextEventIndex: { type: Number, default: 0 },
  nextEventAt: { type: Date, default: null },
  leaseUntil: { type: Date, default: null },
  leaseKey: { type: String, default: "" },
  eliminationMessages: [{ index: Number, messageId: String, sentAt: Date }],
  originalChampionId: { type: String, default: "" },
  status: { type: String, enum: ["publishing", "open", "running", "closing", "ended", "rerolling", "cancelled", "failed"], default: "publishing" },
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
giveawaySchema.index({ mode: 1, status: 1, nextEventAt: 1 });
giveawaySchema.index({ guildId: 1, messageId: 1 }, {
  unique: true, partialFilterExpression: { messageId: { $type: "string" } },
});
export default mongoose.models.Giveaway || mongoose.model("Giveaway", giveawaySchema);
