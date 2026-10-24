import mongoose from "mongoose";

// Tracks the permanent shop DM and any unfinished temporary appearance editor.
// Unsaved drafts and the shop mix-and-match preview survive restarts.
const memberDmPanelSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  botUserId: { type: String, required: true },
  discordUserId: { type: String, required: true },
  kind: { type: String, required: true, enum: ["shop", "appearance"] },
  channelId: { type: String, required: true },
  messageId: { type: String, required: true },
  token: { type: String, default: "" },
  appearanceDraft: { type: mongoose.Schema.Types.Mixed, default: null },
  appearancePage: { type: String, default: "colors" },
  selectedSticker: { type: Number, default: 0 },
  appearanceOptionPages: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  // Unpurchased try-on selections for the permanent shop (one per category).
  // Kept independently of the editable/saved member profile.
  shopPreviewMix: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  // View state of the live Mix & Match try-on, independent of equipped styles.
  shopMixCategory: { type: String, default: "backgrounds" },
  shopMixOptionPage: { type: Number, default: 0 },
  shopMixReturnCategory: { type: String, default: "backgrounds" },
  shopMixReturnIndex: { type: Number, default: 0 },
  // HEX being reviewed before a paid purchase, scoped to this member's shop DM.
  shopPendingCustom: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

memberDmPanelSchema.index(
  { botUserId: 1, guildId: 1, discordUserId: 1, kind: 1 },
  { unique: true },
);

export default mongoose.model("MemberDmPanel", memberDmPanelSchema);
