import mongoose from "mongoose";

const guildConfigSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true },
    // Retained for existing server configuration documents; new listings use dedicated channels.
    marketplaceChannelId: { type: String, default: "" },
    houseChannelId: { type: String, default: "" },
    inventoryChannelId: { type: String, default: "" },
    tradeVoteChannelId: { type: String, default: "" },
  },
  { timestamps: true },
);

export default mongoose.model("GuildConfig", guildConfigSchema);
