import mongoose from "mongoose";

// Named, editable activity qualification rules: one watched channel per saved rule.
const schema = new mongoose.Schema({
  guildId: { type: String, required: true },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  nameKey: { type: String, required: true },
  channelId: { type: String, required: true },
  minimumChars: { type: Number, default: 1, min: 0, max: 2000 },
  minimumMessages: { type: Number, default: 1, min: 1, max: 50 },
  activeDays: { type: Number, default: 3, min: 1, max: 7 },
  activityPeriod: { type: String, enum: ["daily","weekly"], default: "weekly" },
}, { timestamps: true });
schema.index({ guildId: 1, nameKey: 1 }, { unique: true });
export const watchNameKey = value => String(value || "").trim().toLocaleLowerCase("en-US");
export default mongoose.models.GiveawayWatchRule || mongoose.model("GiveawayWatchRule",schema);
