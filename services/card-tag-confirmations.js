import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import CardCopy from "../models/CardCopy.js";
import CardDefinition from "../models/CardDefinition.js";
import CardRelease from "../models/CardRelease.js";
import CardCollector from "../models/CardCollector.js";
import { selectOwnedTagTargets } from "./card-tag-targets.js";
import { findOwnedCardById } from "./card-owned-selection.js";
import { parseCardIds } from "./card-tag-management.js";
import { tagKey } from "./card-tag-catalog.js";

const TIMEOUT_MS = 2 * 60 * 1000;
const MAX_PENDING = 500;
const pending = new Map();

function cleanExpired(now) {
  for (const [id, entry] of pending) if (entry.expiresAt <= now) pending.delete(id);
  if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
}

export async function prepareCardTagConfirmation({ discordUserId, cardId, cardIds = null, tag }) {
  let targets;
  if (cardIds !== null) {
    const references = parseCardIds(cardIds);
    const copies = await Promise.all(references.map(reference => findOwnedCardById(discordUserId, reference)));
    if (copies.some(copy => !copy)) throw new Error("Some card IDs are not currently owned by you.");
    if (new Set(copies.map(copy => String(copy._id))).size !== copies.length)
      throw new Error("Each card ID can appear only once.");
    targets = { cards: copies, name: null, mode: "ids" };
  } else {
    targets = await selectOwnedTagTargets(discordUserId, cardId, { includeRelatedForId: true });
  }
  const nextTag = tag === null ? "" : tagKey(tag);
  const cards = targets.cards.map(card => ({
    id: String(card._id), publicId: card.publicId || "PENDING",
    definitionId: String(card.cardDefinitionId),
    upgradeLevel: card.upgradeLevel || "normal",
    oldTag: card.tag || "",
  }));
  if (!cards.length) throw new Error("You don't own any matching cards.");
  const affected = cards.filter(card => card.oldTag !== nextTag).length;
  if (nextTag === "" && !affected) throw new Error("None of these cards have tags to remove.");
  const defs = await CardDefinition.find({
    _id: { $in: [...new Set(cards.map(c => c.definitionId))] },
  }).select("_id releaseId").lean();
  const releaseIds = [...new Set(defs.map(d => d.releaseId))];
  const releases = await CardRelease.find({ releaseId: { $in: releaseIds } })
    .select("releaseId cardFrameKey").lean();
  const byDef = new Map(defs.map(d => [String(d._id), d.releaseId]));
  const byRelease = new Map(releases.map(r => [r.releaseId, r.cardFrameKey]));
  const enriched = cards.map(card => ({
    ...card, releaseId: byDef.get(card.definitionId) || "unknown",
    frame: byRelease.get(byDef.get(card.definitionId)) || "default",
  }));
  const now = Date.now();
  cleanExpired(now);
  const token = randomBytes(12).toString("hex");
  const entry = {
    token, ownerId: discordUserId, name: targets.name, mode: targets.mode,
    preferredId: targets.preferredId || null,
    cards: enriched, tag: nextTag, affected, expiresAt: now + TIMEOUT_MS,
    processing: false,
  };
  pending.set(token, entry);
  return entry;
}

export function getCardTagConfirmation(token, ownerId) {
  const entry = pending.get(token);
  if (!entry || entry.expiresAt <= Date.now()) {
    pending.delete(token);
    throw new Error("This confirmation expired. Run the tag or untag command again.");
  }
  if (entry.ownerId !== ownerId) throw new Error("Only the member who started this change can confirm it.");
  return entry;
}

export function cancelCardTagConfirmation(token, ownerId) {
  const entry = getCardTagConfirmation(token, ownerId);
  if (entry.processing) throw new Error("This request is already being processed.");
  pending.delete(token);
  return entry;
}

/** Recheck ownership and existing tags transactionally before applying a single
 * selected ID or all copies. A stale confirmation cannot overwrite new tags. */
export async function confirmCardTagChange({ token, ownerId, selectedId = null }) {
  const entry = getCardTagConfirmation(token, ownerId);
  if (entry.processing) throw new Error("This request is already being processed.");
  const chosen = selectedId === null ? entry.cards : entry.cards.filter(card => card.id === selectedId);
  if (!chosen.length || (selectedId !== null && chosen.length !== 1))
    throw new Error("That card was not included in the confirmation.");
  entry.processing = true;
  const session = await mongoose.startSession().catch(error => {
    entry.processing = false; throw error;
  });
  try {
    let changedCount = 0;
    await session.withTransaction(async () => {
      const ids = chosen.map(c => new mongoose.Types.ObjectId(c.id));
      const current = await CardCopy.find({
        _id: { $in: ids }, ownerDiscordUserId: ownerId, state: "owned",
      }).session(session).lean();
      const nowById = new Map(current.map(c => [String(c._id), c]));
      if (current.length !== chosen.length || chosen.some(c => {
        const actual = nowById.get(c.id);
        return !actual || (actual.tag || "") !== c.oldTag ||
          String(actual.cardDefinitionId) !== c.definitionId;
      })) throw new Error("One or more cards or tags changed. Please start a new confirmation.");
      const updated = await CardCopy.updateMany({
        _id: { $in: ids }, ownerDiscordUserId: ownerId, state: "owned",
      }, { $set: { tag: entry.tag } }, { session, runValidators: true });
      if (updated.matchedCount !== chosen.length) throw new Error("Some selected cards changed. No tags were updated.");
      changedCount = updated.modifiedCount;
      if (entry.tag) await CardCollector.updateOne(
        { discordUserId: ownerId },
        { $setOnInsert: { discordUserId: ownerId }, $addToSet: { tagNames: entry.tag } },
        { session, upsert: true },
      );
    });
    pending.delete(token);
    return { count: chosen.length, changed: changedCount, tag: entry.tag,
      name: entry.name, selectedId: selectedId && chosen[0].publicId };
  } finally {
    entry.processing = false;
    await session.endSession();
  }
}
