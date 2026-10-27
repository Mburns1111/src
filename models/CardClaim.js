import mongoose from "mongoose";
const schema = new mongoose.Schema({
  dropId: { type: mongoose.Schema.Types.ObjectId, ref: "CardDrop", required: true },
  slot: { type: Number, required: true, min: 0, max: 2 },
  discordUserId: { type: String, required: true },
  cardCopyId: { type: mongoose.Schema.Types.ObjectId, ref: "CardCopy", required: true },
}, { timestamps: true });
schema.index({ dropId: 1, slot: 1 }, { unique: true });
schema.index({ dropId: 1, discordUserId: 1 }, { unique: true });
export default mongoose.models.CardClaim || mongoose.model("CardClaim", schema);
