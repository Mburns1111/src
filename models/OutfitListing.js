import mongoose from "mongoose";
import mediaAssetSchema from "./MediaAsset.js";

const outfitListingSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    ownerId: { type: String, required: true },
    ownerName: { type: String, required: true },
    ownerRobloxUsername: { type: String, default: "" },
    title: { type: String, required: true, maxlength: 100 },
    description: { type: String, required: true, maxlength: 1000 },
    cost: { type: String, default: "", maxlength: 80 },
    videoUrl: { type: String, default: "" },
    mediaAttachments: { type: [mediaAssetSchema], default: [] },
    postChannelId: { type: String, default: "" },
    postMessageId: { type: String, default: "" },
    status: { type: String, enum: ["active", "sold"], default: "active" },
    soldAt: { type: Date, default: null },
    interestedUserIds: { type: [String], default: [] },
    notifyOnInterest: { type: Boolean, default: false },
  },
  { timestamps: true },
);

outfitListingSchema.index({ guildId: 1, ownerId: 1, createdAt: -1 });

export default mongoose.model("OutfitListing", outfitListingSchema);
