import mongoose from "mongoose";

const pointsWalletSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  discordUserId: { type: String, required: true },
  balance: { type: Number, default: 0, min: 0 },
}, { timestamps: true });
pointsWalletSchema.index({ guildId: 1, discordUserId: 1 }, { unique: true });
export default mongoose.model("PointsWallet", pointsWalletSchema);
