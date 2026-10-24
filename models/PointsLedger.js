import mongoose from "mongoose";

// Immutable, inspectable earning receipts; each external event or milestone
// has a stable key so retries, edits and restarts cannot create more Points.
const pointsLedgerSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  discordUserId: { type: String, required: true },
  eventKey: { type: String, required: true },
  kind: { type: String, required: true }, // milestone, manual, future activity
  amount: { type: Number, required: true, min: 0 },
  description: { type: String, required: true },
  sourceId: { type: String, default: "" },
  actorId: { type: String, default: "" },
}, { timestamps: true });
pointsLedgerSchema.index({ guildId: 1, discordUserId: 1, eventKey: 1 }, { unique: true });
pointsLedgerSchema.index({ guildId: 1, discordUserId: 1, createdAt: -1 });
// Cross-member time-window summaries/exports and filtered reward-type audits.
// These avoid scanning all years of ledger receipts at 700+ members.
pointsLedgerSchema.index({ guildId: 1, createdAt: -1 });
pointsLedgerSchema.index({ guildId: 1, kind: 1, createdAt: -1 });
export default mongoose.model("PointsLedger", pointsLedgerSchema);
