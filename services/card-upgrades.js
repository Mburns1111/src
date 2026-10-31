import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import CardCopy from "../models/CardCopy.js";
import CardLifecycleEvent from "../models/CardLifecycleEvent.js";
import CardDefinition from "../models/CardDefinition.js";
import PetCatalog from "../models/PetCatalog.js";
import { allocateCardId } from "./card-identifiers.js";
import { findOwnedCardById } from "./card-owned-selection.js";

export const CARDS_PER_UPGRADE = 4;
const PENDING_TTL_MS = 90_000;
const pending = new Map();
const MAX_PENDING = 500;

export function inspectUpgradeCards(cards, ownerId) {
  if (!Array.isArray(cards) || cards.length !== CARDS_PER_UPGRADE) throw new Error("An upgrade requires four matching cards.");
  if (cards.some(c => !c || c.ownerDiscordUserId !== ownerId || c.state !== "owned")) {
    throw new Error("All four cards must still belong to you.");
  }
  if(cards.some(c=>c.locked===true))throw new Error("Locked cards cannot be upgraded. Use .unlock CARDID first.");
  const first = cards[0];
  if (cards.some(c => String(c.cardDefinitionId) !== String(first.cardDefinitionId))) {
    throw new Error("All four cards must be the same pet from the same release.");
  }
  if (cards.some(c => c.upgradeLevel !== first.upgradeLevel)) throw new Error("All four cards must have the same upgrade stage.");
  if (cards.some(c => !c.publicId)) throw new Error("Every card needs its five-character ID before upgrading.");
  if (!["normal", "neon"].includes(first.upgradeLevel)) throw new Error("Mega Neon cards cannot be upgraded further.");
  return first.upgradeLevel === "normal" ? "neon" : "mega";
}
export function selectUpgradeSet(cards, preferredId = null) {
  // Prefer untagged copies for automatic selection when available, but never
  // prohibit a tagged card: tags only protect against burning.
  const available = cards.filter(c => c?.state === "owned" && c.publicId && c.locked!==true);
  const sorted = [...available].sort((a, b) =>
    Number(Boolean(a.tag)) - Number(Boolean(b.tag)) ||
    String(a.createdAt || "").localeCompare(String(b.createdAt || "")) ||
    String(a.publicId).localeCompare(String(b.publicId)));
  const stages = preferredId ? [available.find(c => c.publicId === preferredId)?.upgradeLevel] : ["normal", "neon"];
  for (const stage of stages) {
    if (!["normal", "neon"].includes(stage)) continue;
    const matching = sorted.filter(c => c.upgradeLevel === stage);
    if (matching.length < CARDS_PER_UPGRADE) continue;
    const selected = preferredId
      ? [matching.find(c => c.publicId === preferredId), ...matching.filter(c => c.publicId !== preferredId)].slice(0, CARDS_PER_UPGRADE)
      : matching.slice(0, CARDS_PER_UPGRADE);
    if (selected.length === CARDS_PER_UPGRADE && selected.every(Boolean)) return selected;
  }
  return null;
}
// Four letters (case-insensitive) can identify a pet during upgrades too.
// Short names, e.g. Cat, still require the entire name.
const matchingPetName = text => {
  const value = String(text).trim();
  const escaped = value.replace(/[^\p{L}\p{N} ]/gu, "\\$&");
  return new RegExp("^" + escaped + (value.length < 4 ? "$" : ""), "i");
};

/**
 * Discord autocomplete lists only upgrade-eligible pets the member actually
 * owns. Each choice resolves to an owned card ID, so duplicate pet names
 * across releases/stages are unambiguous. Discord accepts at most 25 choices.
 */
export async function suggestOwnedCardUpgrades(ownerId, typed = "") {
  const query = String(typed || "").trim().slice(0, 100);
  const rows = await CardCopy.aggregate([
    { $match: { ownerDiscordUserId: ownerId, state: "owned",
      upgradeLevel: { $in: ["normal", "neon"] }, locked:{$ne:true}, publicId: { $type: "string" } } },
    { $sort: { createdAt: 1, _id: 1 } },
    { $group: {
      _id: { definition: "$cardDefinitionId", stage: "$upgradeLevel" },
      count: { $sum: 1 }, sampleId: { $first: "$publicId" },
    } },
    { $match: { count: { $gte: CARDS_PER_UPGRADE } } },
    { $lookup: { from: CardDefinition.collection.name, localField: "_id.definition", foreignField: "_id", as: "definition" } },
    { $unwind: "$definition" },
    { $lookup: { from: PetCatalog.collection.name, localField: "definition.petId", foreignField: "petId", as: "pet" } },
    { $unwind: { path: "$pet", preserveNullAndEmptyArrays: true } },
    { $project: {
      sampleId: 1, count: 1, stage: "$_id.stage",
      release: "$definition.releaseId",
      petName: { $ifNull: ["$pet.name", "$definition.petId"] },
    } },
    { $sort: { petName: 1, release: 1, stage: 1 } },
  ]);
  const term = query.toLocaleLowerCase();
  return rows.filter(row => !term ||
    String(row.petName).toLocaleLowerCase().includes(term) ||
    String(row.sampleId).toLocaleLowerCase().startsWith(term)
  ).slice(0, 25).map(row => ({
    name: `${row.petName} · ${row.count} ${row.stage === "neon" ? "Neon" : "Normal"} · ${row.release}`.slice(0, 100),
    value: row.sampleId,
  }));
}
async function findMatchingUpgradeCards(ownerId, reference) {
  const input = String(reference || "").trim();
  if (!input || input.length > 100) throw new Error("Enter a card ID or pet name (up to 100 characters).");
  // An owned public ID resolves to a precise release and upgrade stage.
  const matchingId = /^[0-9A-Za-z_-]{5}$/.test(input)
    ? await findOwnedCardById(ownerId, input)
    : null;
  if (matchingId) {
    const cards = await CardCopy.find({
      cardDefinitionId: matchingId.cardDefinitionId,
      ownerDiscordUserId: ownerId, state: "owned", upgradeLevel: matchingId.upgradeLevel,
    }).sort({ createdAt: 1, _id: 1 }).limit(250).lean();
    const selected = selectUpgradeSet(cards, matchingId.publicId);
    if (!selected) throw new Error("You need four owned copies of the same pet, release, and upgrade stage.");
    return selected;
  }
  if (/^[0-9A-Za-z_-]{5}$/.test(input)) {
    // A five-character pet name is still a valid name; try exact name lookup.
  }
  const pets = await PetCatalog.find({ name: matchingPetName(input) }).select("petId").limit(15).lean();
  if (!pets.length) throw new Error("No pet matches that name in the card catalog. Enter at least the first four letters.");
  const defs = await CardDefinition.find({ petId: { $in: pets.map(p => p.petId) } }).select("_id").limit(100).lean();
  const eligible = [];
  for (const def of defs) {
    const copies = await CardCopy.find({
      ownerDiscordUserId: ownerId, state: "owned", locked:{$ne:true},cardDefinitionId: def._id,
      upgradeLevel: { $in: ["normal", "neon"] },
    }).sort({ createdAt: 1, _id: 1 }).limit(250).lean();
    const selected = selectUpgradeSet(copies);
    if (selected) eligible.push(selected);
  }
  if (!eligible.length) throw new Error("You need four owned copies of that pet from the same release and stage.");
  if (eligible.length > 1) throw new Error("Several releases of that pet can be upgraded. Use one card ID to choose the release.");
  return eligible[0];
}
async function lookupCards(ids, ownerId, session = null) {
  const query = CardCopy.find({ publicId: { $in: ids }, ownerDiscordUserId: ownerId, state: "owned" });
  if (session) query.session(session);
  const cards = await query.lean();
  if (cards.length !== CARDS_PER_UPGRADE) throw new Error("One or more cards are missing or no longer owned.");
  return cards;
}
export async function prepareCardUpgrade({ ownerId, guildId, cardReference }) {
  const cards = await findMatchingUpgradeCards(ownerId, cardReference);
  const ids = cards.map(c => c.publicId);
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
        ownerDiscordUserId: ownerId, state: "owned",locked:{$ne:true},
        upgradeLevel: cards[0].upgradeLevel, cardDefinitionId: cards[0].cardDefinitionId,locked:{$ne:true},
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
