import mongoose from "mongoose";

const tradingPostSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    ownerId: { type: String, required: true },
    discordName: { type: String, required: true },
    robloxName: { type: String, default: "" },
    lookingFor: { type: String, default: "", maxlength: 1000 },
    willingToTrade: { type: String, default: "", maxlength: 1000 },
    notifyOnInterest: { type: Boolean, default: false },
    interestedUserIds: { type: [String], default: [] },
    postChannelId: { type: String, default: "" },
    postMessageId: { type: String, default: "" },
  },
  { timestamps: true },
);

tradingPostSchema.index({ guildId: 1, ownerId: 1 }, { unique: true });

export default mongoose.model("TradingPost", tradingPostSchema);
