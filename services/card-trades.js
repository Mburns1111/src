import mongoose from "mongoose";
import CardTrade from "../models/CardTrade.js";
import CardCopy from "../models/CardCopy.js";
import CardDefinition from "../models/CardDefinition.js";
import CardRelease from "../models/CardRelease.js";
import PetCatalog from "../models/PetCatalog.js";
import { findOwnedCardById } from "./card-owned-selection.js";
import { isRegisteredCardCollector } from "./card-collector-registration.js";

export const TRADE_DISPLAY_PAGE_SIZE = 4;
export const TRADE_LIFETIME_MS = 10 * 60 * 1000;
const ID_PATTERN = /^[0-9A-Za-z_-]{5}$/;

export function parseTradeCardIds(text) {
  const input = String(text || "").trim();
  if (!input) return [];
  const ids = input.split(/[\s,;]+/).filter(Boolean);

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

export async function createCardTrade({ guildId, channelId, inviterId, inviteeId, participantNames = [], gift = false }) {
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
    offers: [[], []], participantNames, gift, expiresAt: new Date(Date.now() + TRADE_LIFETIME_MS),
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
    .select("publicId ownerDiscordUserId state cardDefinitionId upgradeLevel tag locked source originGuildId").lean();
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
        eligible: Boolean(card && card.locked !== true && card.state === "owned" &&
          card.ownerDiscordUserId === trade.participants[side] && def),
      };
    })),
  };
}


// Saved tags occupy one line: tag:cute, #cute, tag:Very Cute.
// A leading + appends to the offer to bypass Discord's modal length limit.
export async function resolveTradeOfferInput(ownerId, text, currentIds = []) {
  const input = String(text || "").trim();
  const append = input.startsWith("+");
  const lines = (append ? input.slice(1) : input).split(/\r?\n/);
  const ids = append ? [...currentIds] : [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(?:tag:|#)/i.test(trimmed)) {
      const tag = trimmed.replace(/^(?:tag:|#)/i, "").trim().toLocaleLowerCase();
      if (!tag) throw new Error("A tag name is required after tag: or #.");
      const collector = await (await import("../models/CardCollector.js")).default.findOne({
        discordUserId: ownerId,
      }).select("createdTagNames").lean();
      if (!(collector?.createdTagNames || []).some(t=>t.toLocaleLowerCase()===tag))
        throw new Error("Create that tag first using .create-tag " + tag);
      const owned = await CardCopy.find({
        ownerDiscordUserId: ownerId, state: "owned",
        tag: { $regex: "^" + tag + "$", $options:"i" },
      }).select("publicId").lean();
      if (!owned.length) throw new Error("No owned cards have tag " + tag + ".");
      ids.push(...owned.map(c=>c.publicId));
    } else {
      ids.push(...parseTradeCardIds(trimmed));
    }
  }
  if (new Set(ids).size !== ids.length) {
    if (!append) throw new Error("The offer contains duplicate card IDs.");
    return [...new Set(ids)];
  }
  return ids;
}

export async function moveCardTradePage({tradeId,userId,guildId,direction}) {
  const trade=assertOpen(await readCardTrade(tradeId),userId);
  if (trade.guildId!==guildId) throw new Error("Wrong server.");
  const max=Math.max(0,Math.ceil(Math.max(...trade.offers.map(x=>x.length)) / TRADE_DISPLAY_PAGE_SIZE)-1);
  const page=Math.max(0,Math.min(max,(trade.viewPage||0)+direction));
  const changed=await CardTrade.findOneAndUpdate({
    _id:trade._id, status:"open", revision:trade.revision,
  },{$set:{viewPage:page}},{new:true}).lean();
  if(!changed) throw new Error("Offer changed; reopen the trade panel.");
  return changed;
}

async function ownedIdsForTrade(ownerId, requested) {
  const selected = await Promise.all(requested.map(id => findOwnedCardById(ownerId, id)));
  if (selected.some(c => !c)) throw new Error("One or more cards are not owned by you.");
  if (selected.some(c=>c.locked)) throw new Error("A selected card is locked. Use .unlock CARDID first.");
  const actualIds = selected.map(c => c.publicId);
  if (new Set(actualIds).size !== actualIds.length)
    throw new Error("Your offer contains a duplicate card ID.");
  return actualIds;
}

export async function setCardTradeOffer({ tradeId, userId, guildId, rawIds }) {
  const trade = assertOpen(await readCardTrade(tradeId), userId);
  const input = await resolveTradeOfferInput(userId,rawIds,trade.offers[trade.participants.indexOf(userId)]);
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
    $set: { ["offers." + side]: ids, reviewedBy: [], finalBy: [], viewPage:0 },
    $inc: { revision: 1 },
  }, { new: true, runValidators: true }).lean();
  if (!result) throw new Error("The trade changed while you edited. Open Add/Edit again.");
  return result;
}

export async function reviewCardTrade({ tradeId, userId, guildId }) {
  const trade = assertOpen(await readCardTrade(tradeId), userId);
  if (trade.guildId !== guildId) throw new Error("Wrong server.");
  if (trade.gift) throw new Error("Gifts are confirmed by the sender only.");
  if (trade.offers.every(side => !side?.length))
    throw new Error("At least one player must offer a card before reviewing.");
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
/**
 * A gift is a unilateral, giver-initiated action. Only the giver confirms,
 * once. The recipient never receives an actionable confirmation control.
 * The same MongoDB transaction/ownership checks as ordinary trading apply.
 */
export async function confirmCardGift({ tradeId, userId, guildId }) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const gift = await CardTrade.findById(tradeId).session(session);
      assertOpen(gift, userId);
      if (!gift.gift || gift.guildId !== guildId ||
          gift.participants[0] !== userId)
        throw new Error("Only the sender can confirm this gift.");
      if (!gift.offers?.[0]?.length || gift.offers?.[1]?.length)
        throw new Error("A gift must contain cards from only the sender.");
      // Check ownership and move each unique card ID inside a single transaction.
      const ids = gift.offers[0];
      if (new Set(ids).size !== ids.length)
        throw new Error("The gift contains a duplicated card ID.");
      for (const publicId of ids) {
        const updated = await CardCopy.updateOne({
          publicId, ownerDiscordUserId:userId, state:"owned", locked:{$ne:true},
        }, { $set:{
          ownerDiscordUserId:gift.participants[1], tag:"",
        } }, { session });
        if (updated.modifiedCount !== 1)
          throw new Error("One or more gift cards are no longer yours. No cards were sent.");
      }
      const done = await CardTrade.updateOne({
        _id:gift._id, status:"open", revision:gift.revision,
        expiresAt:{ $gt:new Date() },
      }, { $set:{
        status:"completed", reviewedBy:[userId], finalBy:[userId], completedAt:new Date(),
      }, $inc:{ revision:1 } }, {session});
      if (done.modifiedCount !== 1)
        throw new Error("The gift changed before it could complete. No cards were sent.");
      return { completed:true, count:ids.length, recipientId:gift.participants[1] };
    });
  } finally {
    await session.endSession();
  }
}

export async function finalizeCardTrade({ tradeId, userId, guildId }) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const trade = await CardTrade.findById(tradeId).session(session);
      assertOpen(trade, userId);
      if (trade.guildId !== guildId) throw new Error("Wrong server.");
      if (trade.gift) throw new Error("A gift needs only the sender confirmation.");
      if (trade.reviewedBy.length !== 2 ||
          !trade.participants.every(id => trade.reviewedBy.includes(id)))
        throw new Error("Both traders must complete the first review.");
      if (trade.offers.every(side => !side?.length))
        throw new Error("At least one side must offer cards.");
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
            publicId, ownerDiscordUserId: trade.participants[side], state: "owned", locked:{$ne:true},
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
