import mongoose from "mongoose";

// Atomic MongoDB counter. Its numeric value is internal and never user-facing.
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  value: { type: Number, required: true, min: 0 },
}, { versionKey: false });
export default mongoose.models.CardNumberSequence || mongoose.model("CardNumberSequence", schema);
