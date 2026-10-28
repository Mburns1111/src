import mongoose from "mongoose";
import CardCopy from "../models/CardCopy.js";

// 12 hex characters = 48 bits of the existing MongoDB ObjectId.
// Retain the full 24-character ID in storage, and reject ambiguous suffixes.
export const SHORT_CARD_ID_LENGTH = 12;

export function displayCardId(id) {
  const value = String(id ?? "").toLowerCase();
  if (!/^[0-9a-f]{24}$/.test(value)) throw new Error("Invalid card ID");
  return value.slice(-SHORT_CARD_ID_LENGTH);
}

export function normalizeCardReference(value) {
  const id = String(value ?? "").trim().toLowerCase();
  if (!/^(?:[0-9a-f]{12}|[0-9a-f]{24})$/.test(id)) {
    throw new Error("Enter a 12-character card ID (or its original 24-character ID).");
  }
  return id;
}

export async function resolveCardId(value) {
  const id = normalizeCardReference(value);
  if (id.length === 24) return new mongoose.Types.ObjectId(id);
  // Resolve against ALL card copies, not just this owner's, so future trading
  // and ownership changes cannot silently select a different card.
  const candidates = await CardCopy.aggregate([
    { $match: { $expr: {
      $eq: [{ $substrBytes: [{ $toString: "$_id" }, 12, 12] }, id],
    } } },
    { $limit: 2 },
    { $project: { _id: 1 } },
  ]);
  if (candidates.length === 0) throw new Error("No card matches that ID.");
  if (candidates.length > 1) {
    throw new Error("That shortened ID matches multiple cards. Use the full 24-character ID.");
  }
  return candidates[0]._id;
}

export function upgradeLabel(value) {
  if (value === "mega") return "Mega Neon";
  if (value === "neon") return "Neon";
  return "Normal";
}
