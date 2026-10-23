import mongoose from "mongoose";

// One reusable DM message per server, member, and feature. Also stores the
// unsaved appearance draft so editing can continue after a bot restart.
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
}, { timestamps: true });

memberDmPanelSchema.index(
  { botUserId: 1, guildId: 1, discordUserId: 1, kind: 1 },
  { unique: true },
);

export default mongoose.model("MemberDmPanel", memberDmPanelSchema);
