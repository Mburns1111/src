import mongoose from "mongoose";

// One record per player per matchup and action, with unique keys so Discord
// retries or rapid clicks update a response rather than create extra votes.
const partyResponseSchema = new mongoose.Schema({
  gameId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "PartyGame" },
  guildId: { type: String, required: true },
  round: { type: Number, required: true },
  matchupIndex: { type: Number, required: true },
  userId: { type: String, required: true },
  kind: { type: String, required: true, enum: ["answer", "vote"] },
  text: { type: String, default: "" },
  targetId: { type: String, default: "" },
}, { timestamps: true });

partyResponseSchema.index(
  { gameId: 1, round: 1, matchupIndex: 1, kind: 1, userId: 1 },
  { unique: true },
);
partyResponseSchema.index({ gameId: 1, round: 1, kind: 1 });
export default mongoose.models.PartyResponse || mongoose.model("PartyResponse", partyResponseSchema);
