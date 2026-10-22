import mongoose from "mongoose";

const guildConfigSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true },
    // Retained for existing server configuration documents; new listings use dedicated channels.
    marketplaceChannelId: { type: String, default: "" },
    houseChannelId: { type: String, default: "" },
    inventoryChannelId: { type: String, default: "" },
    tradeVoteChannelId: { type: String, default: "" },
    commandChannelId: { type: String, default: "" },
    profileChannelId: { type: String, default: "" },
    tradingPostChannelId: { type: String, default: "" },
    tradingPostEntryChannelId: { type: String, default: "" },
    tradingPostEntryMessageId: { type: String, default: "" },
  },
  { timestamps: true },
);

export default mongoose.model("GuildConfig", guildConfigSchema);
