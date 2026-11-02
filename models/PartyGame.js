import mongoose from "mongoose";

const matchupSchema = new mongoose.Schema({
  playerIds: { type: [String], required: true },
  promptId: { type: Number, required: true },
  prompt: { type: String, required: true },
}, { _id: false });

const partyGameSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  channelId: { type: String, required: true },
  messageId: { type: String, default: "" },
  hostId: { type: String, required: true },
  gameType: { type: String, default: "court" },
  category: { type: String, enum: ["mixed", "silly", "roblox", "fantasy"], default: "mixed" },
  rewardsEnabled: { type: Boolean, default: true },
  phase: { type: String, enum: ["lobby", "answering", "voting", "reveal", "intermission", "ended", "cancelled"], default: "lobby" },
  active: { type: Boolean, default: true },
  players: { type: [String], default: [] },
  round: { type: Number, default: 0 },
  batch: { type: Number, default: 0 },
  matchups: { type: [matchupSchema], default: [] },
  usedPromptIds: { type: [Number], default: [] },
  // Scores and answered counts are updated on an atomic phase transition, not per vote.
  scores: { type: mongoose.Schema.Types.Mixed, default: {} },
  answeredCounts: { type: mongoose.Schema.Types.Mixed, default: {} },
  completedRounds: { type: Number, default: 0 },
  phaseEndsAt: { type: Date, default: null },
  paused: { type: Boolean, default: false },
  remainingMs: { type: Number, default: 0 },
  renderVersion: { type: Number, default: 1 },
  renderedVersion: { type: Number, default: 0 },
  processingUntil: { type: Date, default: null },
  rewardSettledAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
}, { timestamps: true });

partyGameSchema.index({ guildId: 1, active: 1 }, {
  unique: true, partialFilterExpression: { active: true },
});
partyGameSchema.index({ active: 1, phaseEndsAt: 1 });
export default mongoose.models.PartyGame || mongoose.model("PartyGame", partyGameSchema);
