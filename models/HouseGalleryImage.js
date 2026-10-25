import mongoose from "mongoose";
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
export default mongoose.model("HouseGalleryImage", schema);
