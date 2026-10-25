import mongoose from "mongoose";

const profileAlbumUploadLockSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  ownerId: { type: String, required: true },
  token: { type: String, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

profileAlbumUploadLockSchema.index({ guildId: 1, ownerId: 1 }, { unique: true });
// Expired leases are also re-acquired atomically; TTL is only for tidiness.
profileAlbumUploadLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("ProfileAlbumUploadLock", profileAlbumUploadLockSchema);
