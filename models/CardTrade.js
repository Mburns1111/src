import mongoose from "mongoose";

const schema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  channelId: { type: String, required: true },
  messageId: { type: String, default: "" },
  participants: { type: [String], required: true, validate: v => v.length === 2 && v[0] !== v[1] },
  // Offers contain PUBLIC five-character card IDs; actual ownership is
  // verified before changing an offer and again inside the transfer transaction.
  offers: { type: [[String]], default: () => [[], []] },
  reviewedBy: { type: [String], default: [] },
  finalBy: { type: [String], default: [] },
  revision: { type: Number, default: 0 },
  status: { type: String, enum: ["open", "completed", "cancelled", "expired"], default: "open", index: true },
  expiresAt: { type: Date, required: true },
  completedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ participants: 1, status: 1, expiresAt: 1 });
export default mongoose.models.CardTrade || mongoose.model("CardTrade", schema);
