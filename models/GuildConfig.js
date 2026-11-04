import mongoose from "mongoose";

const guildConfigSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true },
    // Retained for existing server configuration documents; new listings use dedicated channels.
    marketplaceChannelId: { type: String, default: "" },
    houseChannelId: { type: String, default: "" },
    houseEntryChannelId: { type: String, default: "" },
    houseEntryMessageId: { type: String, default: "" },
    outfitChannelId: { type: String, default: "" },
    outfitEntryChannelId: { type: String, default: "" },
    outfitEntryMessageId: { type: String, default: "" },
    inventoryChannelId: { type: String, default: "" },
    inventoryEntryChannelId: { type: String, default: "" },
    inventoryEntryMessageId: { type: String, default: "" },
    giveawayChannelId: { type: String, default: "" },
    survivalTrialChannelId: { type: String, default: "" },
    giveawayPingRoleId: { type: String, default: "" },
    survivalTrialPingRoleId: { type: String, default: "" },
    tradeVoteChannelId: { type: String, default: "" },
    tradeVoteEntryChannelId: { type: String, default: "" },
    tradeVoteEntryMessageId: { type: String, default: "" },
    shopChannelId: { type: String, default: "" },
    shopMessageId: { type: String, default: "" },
    shopCategoryMessageIds: { type: Map, of: String, default: () => ({}) },
    commandChannelId: { type: String, default: "" },
    hatchemChannelId: { type: String, default: "" },
    partyGamesChannelId: { type: String, default: "" },
    // Legacy timed-drop due date; retained for existing MongoDB documents but
    // deliberately ignored. Wild eggs now come only from server activity.
    hatchemNextAutoDropAt: { type: Date, default: null },
    hatchemLastAutoDropAt: { type: Date, default: null },
    hatchemNextActivityDropAt: { type: Date, default: null },
    cardRoleId: { type: String, default: "" },
    hatchemGuideMessageId: { type: String, default: "" },
    profileChannelId: { type: String, default: "" },
    profileEntryChannelId: { type: String, default: "" },
    profileEntryMessageId: { type: String, default: "" },
    tradingPostChannelId: { type: String, default: "" },
    tradingPostEntryChannelId: { type: String, default: "" },
    tradingPostEntryMessageId: { type: String, default: "" },
  },
  { timestamps: true },
);

export default mongoose.model("GuildConfig", guildConfigSchema);
