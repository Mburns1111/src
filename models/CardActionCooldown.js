import mongoose from "mongoose";

// Shared by all bot processes and Discord servers. One document per player,
// action, and scope. A drop uses the 'global' scope; a grab uses guild ID.
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  discordUserId: { type: String, required: true },
  action: { type: String, enum: ["drop", "grab"], required: true },
  scope: { type: String, required: true },
  availableAt: { type: Date, required: true },
  // Origin drop ID allows safe refunds for losing or displaced entrants.
  sourceId: { type: String, default: "" },
}, { timestamps: true });
schema.index({ discordUserId: 1, action: 1, scope: 1 }, { unique: true });
export default mongoose.models.CardActionCooldown || mongoose.model("CardActionCooldown", schema);
