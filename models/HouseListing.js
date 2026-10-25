import mongoose from "mongoose";
import mediaAssetSchema from "./MediaAsset.js";

const houseListingSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    ownerId: { type: String, required: true },
    ownerName: { type: String, required: true },
    ownerRobloxUsername: { type: String, default: "" },
    title: { type: String, required: true, maxlength: 100 },
    description: { type: String, required: true, maxlength: 1000 },
    askingPrice: { type: String, required: true, maxlength: 80 },
    estimatedValue: { type: String, required: true, maxlength: 80 },
    videoUrl: { type: String, default: "" },
    mediaAttachments: { type: [mediaAssetSchema], default: [] },
    // Independent look: copied from profile once on creation, then edited per post.
    postAppearance: { type: mongoose.Schema.Types.Mixed, default: null },
    galleryPageIndex: { type: Number, default: 0 },
    postChannelId: { type: String, default: "" },
    postMessageId: { type: String, default: "" },
    status: { type: String, enum: ["active", "sold"], default: "active" },
    soldAt: { type: Date, default: null },
    interestedUserIds: { type: [String], default: [] },
    notifyOnInterest: { type: Boolean, default: false },
  },
  { timestamps: true },
);

houseListingSchema.index({ guildId: 1, ownerId: 1, createdAt: -1 });

export default mongoose.model("HouseListing", houseListingSchema);
