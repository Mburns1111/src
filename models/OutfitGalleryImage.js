import mongoose from "mongoose";

// One resized JPEG per page keeps the flipbook durable across Discord message
// edits, bot restarts and expired attachment URLs. No original upload is
// removed until all its images have been safely saved.
const schema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  listingId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  ownerId: { type: String, required: true },
  sourceId: { type: String, required: true },
  name: { type: String, default: "" },
  imageData: { type: Buffer, required: true },
  originalIndex: { type: Number, default: 0 },
}, { timestamps: true });
schema.index({ guildId: 1, listingId: 1, sourceId: 1 }, { unique: true });
schema.index({ guildId: 1, listingId: 1, originalIndex: 1, _id: 1 });
export default mongoose.model("OutfitGalleryImage", schema);
