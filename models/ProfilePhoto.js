import mongoose from "mongoose";

const profilePhotoSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    ownerId: { type: String, required: true },
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
);

profilePhotoSchema.index({ guildId: 1, ownerId: 1, createdAt: -1 });

export default mongoose.model("ProfilePhoto", profilePhotoSchema);
