import mongoose from "mongoose";
import CardCopy from "../models/CardCopy.js";
import PendingCardTagDeletion from "../models/PendingCardTagDeletion.js";
import { normalizeCardTag } from "./card-collection-summary.js";
import { normalizeCardReference, resolveCardId } from "./card-identifiers.js";

const MAX_BATCH = 20;

export function parseCardIds(input) {
  const ids = String(input ?? "").split(/[\s,;]+/).filter(Boolean);
  if (ids.length < 1 || ids.length > MAX_BATCH) {
    throw new Error("Enter 1–20 card IDs, separated by commas or spaces.");
  }
  if (ids.some(id => !/^(?:[0-9a-fA-F]{12}|[0-9a-fA-F]{24})$/.test(id))) {
    throw new Error("Every card ID must be 12 or 24 hexadecimal characters.");
  }
  if (new Set(ids.map(id => id.toLowerCase())).size !== ids.length) {
    throw new Error("Each card ID can appear only once.");
  }
  return ids.map(normalizeCardReference);
}

// Validate the ENTIRE batch first; don't partially apply user mistakes.
// Only tag is modified. Ownership, card state, rarity and upgrade level remain.
export async function updateMultipleOwnedCardTags({ discordUserId, cardIds, tag }) {
  const references = parseCardIds(cardIds);
  const ids = await Promise.all(references.map(resolveCardId));
  if (new Set(ids.map(String)).size !== ids.length) throw new Error("Each card ID can appear only once.");
  const normalized = tag === null ? "" : normalizeCardTag(tag);
  const owned = await CardCopy.countDocuments({
    _id: { $in: ids }, ownerDiscordUserId: discordUserId, state: "owned",
  });
  if (owned !== ids.length) {
    throw new Error("One or more IDs aren't cards you currently own. No tags were changed.");
  }
  const result = await CardCopy.updateMany({
    _id: { $in: ids }, ownerDiscordUserId: discordUserId, state: "owned",
  }, { $set: { tag: normalized } }, { runValidators: true });
  if (result.matchedCount !== ids.length) {
    throw new Error("Your collection changed while tagging; check the affected cards.");
  }
  return { selected: ids.length, changed: result.modifiedCount, tag: normalized };
}

export async function prepareTagDeletion({ discordUserId, tag, now = new Date() }) {
  const normalized = normalizeCardTag(tag);
  const expectedCount = await CardCopy.countDocuments({
    ownerDiscordUserId: discordUserId, state: "owned", tag: normalized,
  });
  if (!expectedCount) throw new Error("You have no owned cards with that exact tag.");
  const request = await PendingCardTagDeletion.create({
    discordUserId, tag: normalized, expectedCount,
    expiresAt: new Date(now.getTime() + 120000),
  });
  return { id: String(request._id), tag: normalized, count: expectedCount };
}

export async function confirmTagDeletion({ discordUserId, requestId, confirm, now = new Date() }) {
  if (!mongoose.isValidObjectId(requestId)) throw new Error("Invalid tag deletion request.");
  const session = await mongoose.startSession();
  try {
    let outcome;
    await session.withTransaction(async () => {
      const request = await PendingCardTagDeletion.findOne({
        _id: requestId, discordUserId, status: "pending",
        expiresAt: { $gt: now },
      }).session(session);
      if (!request) throw new Error("This confirmation is expired or already handled.");
      if (!confirm) {
        const changed = await PendingCardTagDeletion.updateOne(
          { _id: request._id, status: "pending" },
          { $set: { status: "cancelled" } }, { session });
        if (changed.modifiedCount !== 1) throw new Error("This confirmation has already been handled.");
        outcome = { cancelled: true, tag: request.tag, count: request.expectedCount };
        return;
      }
      const count = await CardCopy.countDocuments({
        ownerDiscordUserId: discordUserId, state: "owned", tag: request.tag,
      }).session(session);
      if (count !== request.expectedCount) {
        // Do not touch a different set of cards than the user approved.
        throw new Error(`The number of cards with tag "${request.tag}" changed from ${request.expectedCount} to ${count}. Run /cards delete-tag again to review the new count.`);
      }
      const changed = await PendingCardTagDeletion.updateOne(
        { _id: request._id, status: "pending" },
        { $set: { status: "confirmed" } }, { session });
      if (changed.modifiedCount !== 1) throw new Error("This confirmation has already been handled.");
      const result = await CardCopy.updateMany({
        ownerDiscordUserId: discordUserId, state: "owned", tag: request.tag,
      }, { $set: { tag: "" } }, { session, runValidators: true });
      if (result.modifiedCount !== request.expectedCount) {
        throw new Error("Cards changed during confirmation. No tags were removed; try again.");
      }
      outcome = { cancelled: false, tag: request.tag, count: result.modifiedCount };
    });
    return outcome;
  } finally {
    await session.endSession();
  }
}
