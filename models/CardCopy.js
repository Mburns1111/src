import mongoose from "mongoose";

const schema = new mongoose.Schema({
  cardDefinitionId: { type: mongoose.Schema.Types.ObjectId, ref: "CardDefinition", required: true },
  ownerDiscordUserId: { type: String, required: true },
  originGuildId: { type: String, required: true },
  publicId: { type: String, match: /^[0-9A-Za-z_-]{5}$/ },
  upgradeLevel: { type: String, enum: ["normal", "neon", "mega"], default: "normal" },
  state: { type: String, enum: ["owned", "consumed", "burned"], default: "owned" },
  source: { type: String, enum: ["drop", "upgrade", "admin"], default: "drop" },
  consumedAt: { type: Date, default: null },
  tag: { type: String, default: "", maxlength: 32, trim: true },
  locked: { type: Boolean, default: false },
  createdFrom: { type: [mongoose.Schema.Types.ObjectId], default: [] },
}, { timestamps: true });
schema.index({ ownerDiscordUserId: 1, state: 1, cardDefinitionId: 1 });
schema.index({ originGuildId: 1, cardDefinitionId: 1 });
schema.index({ publicId: 1 }, { unique: true, partialFilterExpression: { publicId: { $type: "string" } } });
export default mongoose.models.CardCopy || mongoose.model("CardCopy", schema);
