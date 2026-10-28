import mongoose from "mongoose";
const slotSchema = new mongoose.Schema({
  cardDefinitionId: { type: mongoose.Schema.Types.ObjectId, ref: "CardDefinition", required: true },
  petId: { type: String, required: true },
  rarity: { type: String, required: true },
  claimedBy: { type: String, default: null },
  settledAt: { type: Date, default: null },
}, { _id: false });
const schema = new mongoose.Schema({
  guildId: { type: String, required: true },
  channelId: { type: String, required: true },
  messageId: { type: String, default: "" },
  releaseId: { type: String, required: true },
  createdBy: { type: String, required: true },
  slots: { type: [slotSchema], validate: v => v.length === 3 },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ["open", "closed"], default: "open" },
  displayClosedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ guildId: 1, status: 1, expiresAt: 1 });
export default mongoose.models.CardDrop || mongoose.model("CardDrop", schema);
