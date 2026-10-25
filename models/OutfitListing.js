import mongoose from "mongoose";
import mediaAssetSchema from "./MediaAsset.js";

const outfitListingSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    ownerId: { type: String, required: true },
    // Audit only: importing admin is not the listing owner.
    importedById: { type: String, default: "" },
    ownerName: { type: String, required: true },
    ownerRobloxUsername: { type: String, default: "" },
    title: { type: String, required: true, maxlength: 100 },
    description: { type: String, required: true, maxlength: 1000 },
    cost: { type: String, default: "", maxlength: 80 },
    videoUrl: { type: String, default: "" },
    mediaAttachments: { type: [mediaAssetSchema], default: [] },
    // Independent look: copied from profile once on creation, then edited per post.
    postAppearance: { type: mongoose.Schema.Types.Mixed, default: null },
    postChannelId: { type: String, default: "" },
    postMessageId: { type: String, default: "" },
    // New posts begin in staging. Older records without this field are
    // treated as published so existing members' listings are unaffected.
    publicationState: { type: String, enum: ["staging", "published"], default: "published" },
    expectedPhotoCount: { type: Number, default: 0 },
    expectedVideoCount: { type: Number, default: 0 },
    // Styled PNG lives in a bot reply, preserving all ten gallery slots.
    styleCardMessageId: { type: String, default: "" },
    galleryMessageId: { type: String, default: "" },
    // Separate controls message follows the gallery below the styled banner.
    controlsMessageId: { type: String, default: "" },
    galleryPageIndex: { type: Number, default: 0 },
    // Missing is an archived record whose original Discord message was confirmed deleted.
    // Preserve the saved style and gallery rather than destroying member data.
    status: { type: String, enum: ["active", "sold", "missing"], default: "active" },
    missingAt: { type: Date, default: null },
    soldAt: { type: Date, default: null },
    interestedUserIds: { type: [String], default: [] },
    notifyOnInterest: { type: Boolean, default: false },
  },
  { timestamps: true },
);

outfitListingSchema.index({ guildId: 1, ownerId: 1, createdAt: -1 });

export default mongoose.model("OutfitListing", outfitListingSchema);
