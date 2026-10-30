import mongoose from "mongoose";
import CardTrade from "../models/CardTrade.js";
import CardCopy from "../models/CardCopy.js";
import CardDefinition from "../models/CardDefinition.js";
import CardRelease from "../models/CardRelease.js";
import PetCatalog from "../models/PetCatalog.js";
import { findOwnedCardById } from "./card-owned-selection.js";
import { isRegisteredCardCollector } from "./card-collector-registration.js";

export const MAX_TRADE_CARDS = 5;
export const TRADE_LIFETIME_MS = 10 * 60 * 1000;
const ID_PATTERN = /^[0-9A-Za-z_-]{5}$/;

export function parseTradeCardIds(text) {
  const input = String(text || "").trim();
  if (!input) return [];
  const ids = input.split(/[\s,;]+/).filter(Boolean);
  if (ids.length > MAX_TRADE_CARDS) throw new Error("You can offer at most five cards at once.");
  if (!ids.every(id => ID_PATTERN.test(id)))
    throw new Error("Enter only five-character card IDs, separated by spaces or commas.");
  if (new Set(ids).size !== ids.length) throw new Error("A card ID may only appear once in an offer.");
  return ids;
}

function assertOpen(trade, userId = null) {
  if (!trade || trade.status !== "open") throw new Error("This trade is no longer open.");
  if (new Date(trade.expiresAt) <= new Date()) throw new Error("This trade expired. Start a new trade.");
  if (userId && !trade.participants.includes(userId)) throw new Error("Only the two traders can use these controls.");
  return trade;
}

export async function createCardTrade({ guildId, channelId, inviterId, inviteeId }) {
  if (!guildId || !channelId || !inviterId || !inviteeId ||
      inviterId === inviteeId) throw new Error("Choose another member to trade with.");
  const [inviterReady, inviteeReady] = await Promise.all([
    isRegisteredCardCollector(inviterId, guildId),
    isRegisteredCardCollector(inviteeId, guildId),
  ]);
  if (!inviterReady || !inviteeReady)
    throw new Error("Both members must use .register in this server before trading.");
  return CardTrade.create({
    guildId, channelId, participants: [inviterId, inviteeId],
    offers: [[], []], expiresAt: new Date(Date.now() + TRADE_LIFETIME_MS),
  });
}

export async function readCardTrade(tradeId) {
  if (!mongoose.isValidObjectId(tradeId)) throw new Error("Invalid trade ID.");
  const trade = await CardTrade.findById(tradeId).lean();
  if (!trade) throw new Error("Trade not found.");
  return trade;
}

export async function updateCardTradeMessageId(tradeId, messageId) {
  return CardTrade.updateOne({ _id: tradeId, status: "open", messageId: "" }, {
    $set: { messageId: String(messageId) },
  });
}

export async function cardTradeDetails(trade) {
  const ids = [...new Set((trade.offers || []).flat())];
  if (!ids.length) return { sides: [[], []] };
  const cards = await CardCopy.find({ publicId: { $in: ids } })
    .select("publicId ownerDiscordUserId state cardDefinitionId upgradeLevel tag source originGuildId").lean();
  const byId = new Map(cards.map(c => [c.publicId, c]));
  const defs = await CardDefinition.find({
    _id: { $in: cards.map(c => c.cardDefinitionId) },
  }).select("_id petId releaseId seriesId rarity valueReview artistCredit").lean();
  const defById = new Map(defs.map(d => [String(d._id), d]));
  const pets = await PetCatalog.find({ petId: { $in: defs.map(d => d.petId) } })
    .select("petId name").lean();
  const nameById = new Map(pets.map(p => [p.petId, p.name]));
  const releases = await CardRelease.find({ releaseId: { $in: defs.map(d => d.releaseId) } })
    .select("releaseId cardFrameKey").lean();
  const frames = new Map(releases.map(r => [r.releaseId, r.cardFrameKey]));
  return {
    sides: [0, 1].map(side => (trade.offers[side] || []).map(id => {
      const card = byId.get(id);
      const def = card && defById.get(String(card.cardDefinitionId));
      const score = def?.valueReview?.valueScore;
      return {
        id, name: (def && nameById.get(def.petId)) || def?.petId || "Unknown pet",
        rarity: def?.rarity || "Unknown",
        stage: card?.upgradeLevel || "unknown",
        seriesId: def?.seriesId || "?",
        releaseId: def?.releaseId || "?",
        reviewedValue: typeof score === "number" && Number.isFinite(score) ? score : null,
        valueSource: def?.valueReview?.sourceName || "",
        frame: (def && frames.get(def.releaseId)) || "default",
        tag: card?.tag || "",
        artist: def?.artistCredit || "",
        originGuildId: card?.originGuildId || "",
        source: card?.source || "",
        eligible: Boolean(card && card.state === "owned" &&
          card.ownerDiscordUserId === trade.participants[side] && def),
      };
    })),
  };
}

async function ownedIdsForTrade(ownerId, requested) {
  const selected = await Promise.all(requested.map(id => findOwnedCardById(ownerId, id)));
  if (selected.some(c => !c)) throw new Error("One or more cards are not owned by you.");
  const actualIds = selected.map(c => c.publicId);
  if (new Set(actualIds).size !== actualIds.length)
    throw new Error("Your offer contains a duplicate card ID.");
  return actualIds;
}

export async function setCardTradeOffer({ tradeId, userId, guildId, rawIds }) {
  const input = parseTradeCardIds(rawIds);
  const trade = assertOpen(await readCardTrade(tradeId), userId);
  if (trade.guildId !== guildId) throw new Error("Use this trade in its original server.");
  const side = trade.participants.indexOf(userId);
  const ids = await ownedIdsForTrade(userId, input);
  if (ids.some(id => trade.offers[1-side].includes(id)))
    throw new Error("A card may not be offered by both sides.");
  if (JSON.stringify(ids) === JSON.stringify(trade.offers[side])) return trade;
  const result = await CardTrade.findOneAndUpdate({
    _id: trade._id, status: "open", revision: trade.revision,
    expiresAt: { $gt: new Date() },
  }, {
    $set: { ["offers." + side]: ids, reviewedBy: [], finalBy: [] },
    $inc: { revision: 1 },
  }, { new: true, runValidators: true }).lean();
  if (!result) throw new Error("The trade changed while you edited. Open Add/Edit again.");
  return result;
}

export async function reviewCardTrade({ tradeId, userId, guildId }) {
  const trade = assertOpen(await readCardTrade(tradeId), userId);
  if (trade.guildId !== guildId) throw new Error("Wrong server.");
  if (trade.offers.some(side => !side?.length))
    throw new Error("Both traders must offer at least one card before reviewing.");
  const details = await cardTradeDetails(trade);
  if (details.sides.some(side => side.some(card => !card.eligible)))
    throw new Error("An offered card is no longer owned by its trader. Edit the offers first.");
  if (trade.reviewedBy.includes(userId)) return trade;
  const result = await CardTrade.findOneAndUpdate({
    _id: trade._id, revision: trade.revision, status: "open",
    expiresAt: { $gt: new Date() },
  }, {
    $addToSet: { reviewedBy: userId },
    $inc: { revision: 1 },
  }, { new: true }).lean();
  if (!result) throw new Error("The trade changed. Review its newest offers again.");
  return result;
}

export async function cancelCardTrade({ tradeId, userId, guildId }) {
  const trade = assertOpen(await readCardTrade(tradeId), userId);
  if (trade.guildId !== guildId) throw new Error("Wrong server.");
  const result = await CardTrade.findOneAndUpdate({
    _id: trade._id, status: "open", revision: trade.revision,
  }, { $set: { status: "cancelled" }, $inc: { revision: 1 } },
  { new: true }).lean();
  if (!result) throw new Error("Trade changed; try again.");
  return result;
}

/**
 * Second-level confirmation. MongoDB transaction guarantees either BOTH
 * ownership transfers succeed or neither does. A trade cannot complete twice.
 * The version check plus per-card owner/state predicates protect against
 * edits, burn/upgrade, and trades for the same card across other servers.
 */
export async function finalizeCardTrade({ tradeId, userId, guildId }) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const trade = await CardTrade.findById(tradeId).session(session);
      assertOpen(trade, userId);
      if (trade.guildId !== guildId) throw new Error("Wrong server.");
      if (trade.reviewedBy.length !== 2 ||
          !trade.participants.every(id => trade.reviewedBy.includes(id)))
        throw new Error("Both traders must complete the first review.");
      if (trade.offers.some(side => !side?.length))
        throw new Error("Both sides must offer cards.");
      if (trade.finalBy.includes(userId))
        throw new Error("You already completed final confirmation.");
      const finalBy = [...trade.finalBy, userId];
      if (finalBy.length < 2) {
        const result = await CardTrade.updateOne({
          _id: trade._id, revision: trade.revision, status: "open",
          expiresAt: { $gt: new Date() },
        }, { $addToSet: { finalBy: userId }, $inc: { revision: 1 } }, { session });
        if (result.modifiedCount !== 1) throw new Error("The trade changed; please confirm again.");
        return { completed: false };
      }
      for (let side = 0; side < 2; side++) {
        for (const publicId of trade.offers[side]) {
          const result = await CardCopy.updateOne({
            publicId, ownerDiscordUserId: trade.participants[side], state: "owned",
          }, {
            $set: { ownerDiscordUserId: trade.participants[1-side], tag: "" },
          }, { session });
          if (result.modifiedCount !== 1)
            throw new Error("One of the offered cards changed ownership. The trade was not completed.");
        }
      }
      const result = await CardTrade.updateOne({
        _id: trade._id, status: "open", revision: trade.revision,
        expiresAt: { $gt: new Date() },
      }, { $set: {
        status: "completed", finalBy, completedAt: new Date(),
      }, $inc: { revision: 1 } }, { session });
      if (result.modifiedCount !== 1)
        throw new Error("The trade changed before completion. No cards moved.");
      return { completed: true };
    });
  } finally {
    await session.endSession();
  }
}
