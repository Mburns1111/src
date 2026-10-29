import mongoose from "mongoose";

// Append-only audit records for completed future burn and upgrade operations.
// Recorded only in the same transaction that changes card ownership/state.
const schema = new mongoose.Schema({
  operationKey: { type: String, required: true, unique: true },
  cardDefinitionId: { type: mongoose.Schema.Types.ObjectId, ref: "CardDefinition", required: true, index: true },
  actorDiscordUserId: { type: String, required: true },
  eventType: { type: String, enum: ["burn", "upgrade"], required: true },
  targetUpgradeLevel: { type: String, enum: ["neon", "mega", null], default: null },
  consumedCardCopyIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  resultCardCopyId: { type: mongoose.Schema.Types.ObjectId, ref: "CardCopy", default: null },
}, { timestamps: true });
schema.index({ cardDefinitionId: 1, eventType: 1, createdAt: -1 });
export default mongoose.models.CardLifecycleEvent || mongoose.model("CardLifecycleEvent", schema);
