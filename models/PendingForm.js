import mongoose from "mongoose";

const pendingFormSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    ownerId: { type: String, required: true },
    channelId: { type: String, required: true },
    messageId: { type: String, required: true },
    type: { type: String, enum: ["house", "outfit", "trade"], required: true },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

pendingFormSchema.index(
  { guildId: 1, channelId: 1, messageId: 1 },
  { unique: true },
);

export default mongoose.model("PendingForm", pendingFormSchema);
