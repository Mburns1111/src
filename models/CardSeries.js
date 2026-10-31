import mongoose from "mongoose";

const schema = new mongoose.Schema({
  seriesId: { type: String, required: true, unique: true, immutable: true },
  name: { type: String, required: true, trim: true },
  status: { type: String, enum: ["draft", "active", "retired"], default: "draft" },
}, { timestamps: true });

export default mongoose.models.CardSeries || mongoose.model("CardSeries", schema);
