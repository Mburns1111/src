import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import CardCopy from "../models/CardCopy.js";
import CardDefinition from "../models/CardDefinition.js";
import PetCatalog from "../models/PetCatalog.js";

export const COLLECTION_PAGE_SIZE = 8;
export const COLLECTION_RARITY_OPTIONS = ["all", "Common", "Uncommon", "Rare", "Ultra-Rare", "Legendary"];
export const COLLECTION_SORT_OPTIONS = ["newest", "oldest", "name", "rarity"];
const SESSION_TTL = 15 * 60 * 1000;
const MAX_SESSIONS = 500;
const sessions = new Map();

export function openCollectionSession(ownerId, collectionOwnerId = ownerId, collectionName = "Collection") {
  if (!ownerId || !collectionOwnerId) throw new Error("Collection user IDs are required.");
  const now = Date.now();
  for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id);
  if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  const id = randomBytes(8).toString("hex");
  sessions.set(id, { ownerId, collectionOwnerId, collectionName: String(collectionName).slice(0, 80), page: 0, rarity: "all", release: "all", tag: "", sort: "newest", expiresAt: now + SESSION_TTL });
  return id;
}
export function getCollectionSession(id, ownerId) {
  const session = sessions.get(id);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(id);
    throw new Error("This collection menu expired. Use /cards collection to open a fresh one.");
  }
  if (session.ownerId !== ownerId) throw new Error("This collection menu belongs to another member.");
  session.expiresAt = Date.now() + SESSION_TTL;
  return session;
}
export function updateCollectionSession(id, ownerId, update) {
  const session = getCollectionSession(id, ownerId);
  if (update.rarity !== undefined) {
    if (!COLLECTION_RARITY_OPTIONS.includes(update.rarity)) throw new Error("Invalid rarity filter.");
    session.rarity = update.rarity;
    session.page = 0;
  }
  if (update.sort !== undefined) {
    if (!COLLECTION_SORT_OPTIONS.includes(update.sort)) throw new Error("Invalid sort.");
    session.sort = update.sort;
    session.page = 0;
  }
  if (update.release !== undefined) {
    if (update.release !== "all" && !session.releaseOptions?.includes(update.release)) throw new Error("Invalid release filter.");
    session.release = update.release;
    session.page = 0;
  }
  if (update.tag !== undefined) {
    const tag = String(update.tag).trim().replace(/\s+/g, " ");
    if (tag.length > 32 || (tag && !/^[\p{L}\p{N} _-]+$/u.test(tag))) throw new Error("Enter a valid tag (up to 32 characters).");
    session.tag = tag;
    session.page = 0;
  }
  if (update.page !== undefined) {
    if (!Number.isSafeInteger(update.page) || update.page < 0) throw new Error("Invalid page.");
    session.page = update.page;
  }
  return session;
}
export function closeCollectionSession(id, ownerId) {
  getCollectionSession(id, ownerId);
  sessions.delete(id);
}

const definitionJoin = [
  { $lookup: { from: CardDefinition.collection.name, localField: "cardDefinitionId", foreignField: "_id", as: "definition" } },
  { $unwind: { path: "$definition", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: PetCatalog.collection.name, localField: "definition.petId", foreignField: "petId", as: "pet" } },
  { $unwind: { path: "$pet", preserveNullAndEmptyArrays: true } },
  { $addFields: {
    petName: { $ifNull: ["$pet.name", { $ifNull: ["$definition.petId", "Unknown pet"] }] },
    rarityName: { $ifNull: ["$definition.rarity", "Unknown"] },
    releaseName: { $ifNull: ["$definition.releaseId", "Unknown"] },
  } },
];

export async function getCollectionPage(ownerId, session) {
  const match = { ownerDiscordUserId: ownerId, state: "owned" };
  const filters = {};
  if (session.rarity !== "all") filters.rarityName = session.rarity;
  if (session.release !== "all") filters.releaseName = session.release;
  if (session.tag) filters.tag = { $regex: "^" + session.tag + "$", $options: "i" };
  const sort = session.sort === "oldest" ? { createdAt: 1, _id: 1 }
    : session.sort === "name" ? { petName: 1, createdAt: -1, _id: -1 }
    : session.sort === "rarity" ? { rarityRank: -1, petName: 1, _id: 1 }
    : { createdAt: -1, _id: -1 };
  const [result] = await CardCopy.aggregate([
    { $match: match },
    ...definitionJoin,
    { $addFields: { rarityRank: { $indexOfArray: [["Common", "Uncommon", "Rare", "Ultra-Rare", "Legendary"], "$rarityName"] } } },
    { $match: filters },
    { $facet: {
      total: [{ $count: "n" }],
      cards: [{ $sort: sort }, { $skip: session.page * COLLECTION_PAGE_SIZE }, { $limit: COLLECTION_PAGE_SIZE },
        { $project: { _id: 1, publicId: 1, petName: 1, rarityName: 1, releaseName: 1, upgradeLevel: 1, tag: 1 } }],
    } },
  ]);
  const total = result?.total?.[0]?.n || 0;
  const pages = Math.max(1, Math.ceil(total / COLLECTION_PAGE_SIZE));
  if (session.page >= pages) {
    session.page = pages - 1;
    return getCollectionPage(ownerId, session);
  }
  return { cards: result?.cards || [], total, page: session.page, pages };
}

export async function listCollectionReleases(ownerId) {
  const result = await CardCopy.aggregate([
    { $match: { ownerDiscordUserId: ownerId, state: "owned" } },
    { $lookup: { from: CardDefinition.collection.name, localField: "cardDefinitionId", foreignField: "_id", as: "d" } },
    { $unwind: "$d" },
    { $group: { _id: "$d.releaseId", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $limit: 25 },
  ]);
  return result.map(x => x._id).filter(x => typeof x === "string");
}


/** Only show rarities that the member actually owns, not every catalog rarity. */
export async function listCollectionRarities(ownerId) {
  const rows = await CardCopy.aggregate([
    { $match: { ownerDiscordUserId: ownerId, state: "owned" } },
    { $lookup: { from: CardDefinition.collection.name, localField: "cardDefinitionId", foreignField: "_id", as: "definition" } },
    { $unwind: "$definition" },
    { $group: { _id: "$definition.rarity" } },
  ]);
  const owned = new Set(rows.map(r => r._id));
  return COLLECTION_RARITY_OPTIONS.filter(r => r !== "all" && owned.has(r));
}

export async function listCollectionTags(ownerId) {
  const rows = await CardCopy.distinct("tag", {
    ownerDiscordUserId: ownerId, state: "owned", tag: { $type: "string", $ne: "" },
  });
  return rows.filter(t => typeof t === "string" && t.trim()).sort((a, b) => a.localeCompare(b));
}

export async function findOwnedCollectionCard(ownerId, copyId) {
  if (!mongoose.isValidObjectId(copyId)) throw new Error("Invalid card selection.");
  return CardCopy.findOne({ _id: copyId, ownerDiscordUserId: ownerId, state: "owned" }).lean();
}
