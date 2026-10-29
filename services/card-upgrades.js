import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import CardCopy from "../models/CardCopy.js";
import CardLifecycleEvent from "../models/CardLifecycleEvent.js";
import CardDefinition from "../models/CardDefinition.js";
import PetCatalog from "../models/PetCatalog.js";
import { allocateCardId, normalizeCardReference } from "./card-identifiers.js";

export const CARDS_PER_UPGRADE = 4;
const PENDING_TTL_MS = 90_000;
const pending = new Map();
const MAX_PENDING = 500;

export function inspectUpgradeCards(cards, ownerId) {
  if (!Array.isArray(cards) || cards.length !== CARDS_PER_UPGRADE) throw new Error("Choose exactly four card IDs.");
  if (cards.some(c => !c || c.ownerDiscordUserId !== ownerId || c.state !== "owned")) {
    throw new Error("All four cards must still belong to you.");
  }
  const first = cards[0];
  if (cards.some(c => String(c.cardDefinitionId) !== String(first.cardDefinitionId))) {
    throw new Error("All four cards must be the same pet from the same release.");
  }
  if (cards.some(c => c.upgradeLevel !== first.upgradeLevel)) throw new Error("All four cards must have the same upgrade stage.");
  if (cards.some(c => String(c.tag || "").trim())) throw new Error("Tagged cards are protected. Remove their tags before upgrading.");
  if (cards.some(c => !c.publicId)) throw new Error("Every card needs its five-character ID before upgrading.");
  if (!["normal", "neon"].includes(first.upgradeLevel)) throw new Error("Mega Neon cards cannot be upgraded further.");
  return first.upgradeLevel === "normal" ? "neon" : "mega";
}
export function normalizeUpgradeIds(input) {
  const ids = String(input || "").split(/[\s,]+/).map(x => x.trim()).filter(Boolean);
  if (ids.length !== CARDS_PER_UPGRADE) throw new Error("Enter exactly four five-character IDs, separated by commas.");
  const normalized = ids.map(normalizeCardReference);
  if (new Set(normalized).size !== CARDS_PER_UPGRADE) throw new Error("Enter four different cards; duplicate IDs are not allowed.");
  return normalized;
}
async function lookupCards(ids, ownerId, session = null) {
  const query = CardCopy.find({ publicId: { $in: ids }, ownerDiscordUserId: ownerId, state: "owned" });
  if (session) query.session(session);
  const cards = await query.lean();
  if (cards.length !== CARDS_PER_UPGRADE) throw new Error("One or more cards are missing or no longer owned.");
  return cards;
}
export async function prepareCardUpgrade({ ownerId, guildId, cardIds }) {
  const ids = normalizeUpgradeIds(cardIds);
  const cards = await lookupCards(ids, ownerId);
  const target = inspectUpgradeCards(cards, ownerId);
  const def = await CardDefinition.findById(cards[0].cardDefinitionId).select("petId releaseId").lean();
  if (!def) throw new Error("The card definition is missing.");
  const pet = await PetCatalog.findOne({ petId: def.petId }).select("name").lean();
  const now = Date.now();
  for (const [key, record] of pending) if (record.expiresAt <= now) pending.delete(key);
  if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
  const token = randomBytes(12).toString("hex");
  const operationKey = randomBytes(16).toString("hex");
  const entry = {
    token, operationKey, ownerId, guildId,
    ids, cardObjectIds: cards.map(c => String(c._id)),
    definitionId: String(cards[0].cardDefinitionId),
    target, petName: pet?.name || def.petId, releaseId: def.releaseId,
    expiresAt: now + PENDING_TTL_MS,
  };
  pending.set(token, entry);
  return entry;
}
export function getPendingUpgrade(token, ownerId) {
  const entry = pending.get(token);
  if (!entry || entry.expiresAt <= Date.now()) {
    pending.delete(token);
    throw new Error("That upgrade confirmation expired. Run /cards upgrade again.");
  }
  if (entry.ownerId !== ownerId) throw new Error("Only the member who requested this upgrade can confirm it.");
  return entry;
}
export function cancelCardUpgrade(token, ownerId) {
  getPendingUpgrade(token, ownerId);
  pending.delete(token);
}
export async function confirmCardUpgrade(token, ownerId, guildId) {
  const entry = getPendingUpgrade(token, ownerId);
  if (entry.guildId !== guildId) throw new Error("Upgrade must be confirmed in the original server.");
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      // A second confirmation cannot run the same operation twice.
      if (await CardLifecycleEvent.exists({ operationKey: entry.operationKey }).session(session)) {
        throw new Error("This upgrade has already been completed.");
      }
      const cards = await lookupCards(entry.ids, ownerId, session);
      if (cards.some(c => !entry.cardObjectIds.includes(String(c._id)))) throw new Error("The selected cards changed. Start a new upgrade.");
      const target = inspectUpgradeCards(cards, ownerId);
      if (target !== entry.target || String(cards[0].cardDefinitionId) !== entry.definitionId) {
        throw new Error("Cards changed since confirmation. Start a new upgrade.");
      }
      const now = new Date();
      const consumed = await CardCopy.updateMany({
        _id: { $in: cards.map(c => c._id) },
        ownerDiscordUserId: ownerId, state: "owned", tag: "",
        upgradeLevel: cards[0].upgradeLevel, cardDefinitionId: cards[0].cardDefinitionId,
      }, { $set: { state: "consumed", consumedAt: now } }, { session });
      if (consumed.modifiedCount !== CARDS_PER_UPGRADE) throw new Error("Upgrade cancelled: one or more cards changed.");
      const publicId = await allocateCardId(session);
      const [created] = await CardCopy.create([{
        publicId, cardDefinitionId: cards[0].cardDefinitionId,
        ownerDiscordUserId: ownerId, originGuildId: guildId,
        upgradeLevel: target, state: "owned", source: "upgrade",
        createdFrom: cards.map(c => c._id),
      }], { session });
      await CardLifecycleEvent.create([{
        operationKey: entry.operationKey, cardDefinitionId: cards[0].cardDefinitionId,
        actorDiscordUserId: ownerId, eventType: "upgrade", targetUpgradeLevel: target,
        consumedCardCopyIds: cards.map(c => c._id), resultCardCopyId: created._id,
      }], { session });
      result = { publicId, target, petName: entry.petName, consumedIds: entry.ids };
    });
    pending.delete(token);
    return result;
  } finally {
    await session.endSession();
  }
}
