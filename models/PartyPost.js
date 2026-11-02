import mongoose from "mongoose";

// One durable public Discord message for each stage of a Court game.
// A unique game/key prevents repeat posting during reconciliation.
const partyPostSchema = new mongoose.Schema({
  gameId: { type: mongoose.Schema.Types.ObjectId, ref: "PartyGame", required: true },
  guildId: { type: String, required: true },
  channelId: { type: String, required: true },
  key: { type: String, required: true },
  messageId: { type: String, default: "" },
  renderedVariant: { type: String, default: "" },
  renderedVersion: { type: Number, default: 0 },
}, { timestamps: true });

partyPostSchema.index({ gameId: 1, key: 1 }, { unique: true });
export default mongoose.models.PartyPost || mongoose.model("PartyPost", partyPostSchema);
