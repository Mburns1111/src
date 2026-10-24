import mongoose from "mongoose";

// Immutable signed Points movements: positive earnings/refunds and negative
// spending. Unique per-event keys prevent duplicate credits or charges.
const pointsLedgerSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  discordUserId: { type: String, required: true },
  eventKey: { type: String, required: true },
  kind: { type: String, required: true }, // message/voice/poll/manual/milestone, spend, refund
  amount: { type: Number, required: true, validate: {
    validator: value => Number.isSafeInteger(value) && value !== 0,
    message: "Points movements must be nonzero signed integers",
  } },
  description: { type: String, required: true },
  sourceId: { type: String, default: "" },
  actorId: { type: String, default: "" },
  // New spending domains use sourceType: shop, event, auction, etc.
  // Older credit records retain their current positive amounts and null fields.
  sourceType: { type: String, default: "" },
  balanceAfter: { type: Number, default: null },
  items: [{ category: { type: String }, id: { type: String }, price: { type: Number } }],
  relatedEventKey: { type: String, default: "" },
}, { timestamps: true });
pointsLedgerSchema.index({ guildId: 1, discordUserId: 1, eventKey: 1 }, { unique: true });
pointsLedgerSchema.index({ guildId: 1, discordUserId: 1, createdAt: -1 });
// Cross-member time-window summaries/exports and filtered reward-type audits.
// These avoid scanning all years of ledger receipts at 700+ members.
pointsLedgerSchema.index({ guildId: 1, createdAt: -1 });
pointsLedgerSchema.index({ guildId: 1, kind: 1, createdAt: -1 });
export default mongoose.model("PointsLedger", pointsLedgerSchema);
