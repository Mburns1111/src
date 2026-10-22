import mongoose from "mongoose";

const mediaAssetSchema = new mongoose.Schema(
  {
    attachmentId: { type: String, required: true },
    url: { type: String, required: true },
    name: { type: String, required: true },
    contentType: { type: String, default: "" },
    size: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

export default mediaAssetSchema;
// test