import { STANDARD_BACKGROUND_ID, STANDARD_PANEL_ID, STANDARD_PANEL_OPACITY } from "../services/classic-colors.js";
import mongoose from "mongoose";
import mediaAssetSchema from "./MediaAsset.js";

const albumPostSchema = new mongoose.Schema(
  {
    channelId: { type: String, required: true },
    messageId: { type: String, required: true },
    attachments: { type: [mediaAssetSchema], default: [] },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userProfileSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    discordUserId: { type: String, required: true },
    discordUsername: { type: String, required: true },
    displayName: { type: String, required: true },
    adoptMeUsername: { type: String, default: "" },
    bio: { type: String, default: "" },
    profileAppearance: { type: mongoose.Schema.Types.Mixed, default: () => ({ background: STANDARD_BACKGROUND_ID, panelColor: STANDARD_PANEL_ID, panelOpacity: STANDARD_PANEL_OPACITY }) },
    lookingForTrades: { type: Boolean, default: false },
    inventoryVideoUrl: { type: String, default: "" },
    inventoryVideoAsset: { type: mediaAssetSchema, default: null },
    inventoryVideoPostChannelId: { type: String, default: "" },
    inventoryVideoPostMessageId: { type: String, default: "" },
    profileCardChannelId: { type: String, default: "" },
    profileCardMessageId: { type: String, default: "" },
    profileDetailsMessageId: { type: String, default: "" },
    albumPosts: { type: [albumPostSchema], default: [] },
  },
  { timestamps: true },
);

userProfileSchema.index({ guildId: 1, discordUserId: 1 }, { unique: true });

export default mongoose.model("UserProfile", userProfileSchema);
