import mongoose from "mongoose";
import mediaAssetSchema from "./MediaAsset.js";

const tradeListingSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    ownerId: { type: String, required: true },
    ownerName: { type: String, required: true },
    title: { type: String, required: true, maxlength: 100 },
    videoUrl: { type: String, default: "" },
    coverImageName: { type: String, default: "" },
    mediaAttachments: { type: [mediaAssetSchema], default: [] },
    votes: {
      type: Map,
      of: Number,
      default: () => new Map(),
    },
    qualityVotes: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
    decisionVotes: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
    postChannelId: { type: String, default: "" },
    postMessageId: { type: String, default: "" },
    status: { type: String, enum: ["open", "closed"], default: "open" },
  },
  { timestamps: true },
);

tradeListingSchema.index({ guildId: 1, status: 1, createdAt: -1 });

export default mongoose.model("TradeListing", tradeListingSchema);
