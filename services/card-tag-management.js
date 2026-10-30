import mongoose from "mongoose";
import CardCopy from "../models/CardCopy.js";
import PendingCardTagDeletion from "../models/PendingCardTagDeletion.js";
import CardCollector from "../models/CardCollector.js";
import { tagKey, requireSavedCardTag, listCollectorTags, matchingTagRegex } from "./card-tag-catalog.js";
import { normalizeCardReference } from "./card-identifiers.js";
import { findOwnedCardById } from "./card-owned-selection.js";

const MAX_BATCH = 20;

export function parseCardIds(input) {
  const ids = String(input ?? "").split(/[\s,;]+/).filter(Boolean);
  if (ids.length < 1 || ids.length > MAX_BATCH) {
    throw new Error("Enter 1–20 five-character card IDs, separated by commas or spaces.");
  }
  if (ids.some(id => !/^[0-9A-Za-z_-]{5}$/.test(id))) {
    throw new Error("Every card ID must be exactly five characters (letters, numbers, - or _).");
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error("Each card ID can appear only once.");
  }
  return ids.map(normalizeCardReference);
}

// Validate the ENTIRE batch first; don't partially apply user mistakes.
// Only tag is modified. Ownership, card state, rarity and upgrade level remain.
export async function updateMultipleOwnedCardTags({ discordUserId, cardIds, tag }) {
  const references = parseCardIds(cardIds);
  const ids = await Promise.all(references.map(async reference => {
    const card = await findOwnedCardById(discordUserId, reference);
    if (!card) throw new Error("One or more card IDs are not in your collection. No tags were changed.");
    return card._id;
  }));
  if (new Set(ids.map(String)).size !== ids.length) throw new Error("Each card ID can appear only once.");
  const normalized = tag === null ? "" : await requireSavedCardTag(discordUserId, tag);
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
  const normalized = tagKey(tag);
  const saved = await listCollectorTags(discordUserId);
  const legacyCount = await CardCopy.countDocuments({ownerDiscordUserId:discordUserId,state:"owned",tag:matchingTagRegex(normalized)});
  if (!saved.includes(normalized) && legacyCount === 0) throw new Error("You have no saved or assigned tag with that name.");
  const expectedCount = await CardCopy.countDocuments({
    ownerDiscordUserId: discordUserId, state: "owned", tag: matchingTagRegex(normalized),
  });
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
        ownerDiscordUserId: discordUserId, state: "owned", tag: matchingTagRegex(request.tag),
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
      await CardCollector.updateOne({ discordUserId },
        { $pull: { tagNames: tagKey(request.tag), createdTagNames: tagKey(request.tag) } }, { session });
      outcome = { cancelled: false, tag: request.tag, count: result.modifiedCount };
    });
    return outcome;
  } finally {
    await session.endSession();
  }
}
