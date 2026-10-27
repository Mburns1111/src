import mongoose from "mongoose";

const schema = new mongoose.Schema({
  cardDefinitionId: { type: mongoose.Schema.Types.ObjectId, ref: "CardDefinition", required: true },
  ownerDiscordUserId: { type: String, required: true },
  originGuildId: { type: String, required: true },
  upgradeLevel: { type: String, enum: ["normal", "neon", "mega"], default: "normal" },
  state: { type: String, enum: ["owned", "consumed", "burned"], default: "owned" },
  source: { type: String, enum: ["drop", "upgrade", "admin"], default: "drop" },
  consumedAt: { type: Date, default: null },
  createdFrom: { type: [mongoose.Schema.Types.ObjectId], default: [] },
}, { timestamps: true });
schema.index({ ownerDiscordUserId: 1, state: 1, cardDefinitionId: 1 });
schema.index({ originGuildId: 1, cardDefinitionId: 1 });
export default mongoose.models.CardCopy || mongoose.model("CardCopy", schema);
