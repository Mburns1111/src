import { recordAchievementEvent, eligiblePlayerDrop } from "./card-achievement-engine.js";
import { randomInt } from "node:crypto";
import mongoose from "mongoose";
import CardDrop from "../models/CardDrop.js";
import CardClaim from "../models/CardClaim.js";
import CardCopy from "../models/CardCopy.js";
import CardCollector from "../models/CardCollector.js";
import { allocateCardId } from "./card-identifiers.js";
import { releaseCardActionCooldown } from "./card-action-cooldowns.js";

export class CardClaimError extends Error {}

// An entrant may enter ONE card in a drop. The drop creator receives priority:
// choosing a card clears competing entries for that slot and refunds their
// opportunity, so those people can enter another available slot instead.
// All changes are atomic on the single CardDrop document.
export async function reserveCardFromDrop({ dropId, slot, guildId, discordUserId, now = new Date() }) {
  if (!mongoose.isValidObjectId(dropId) || ![0, 1, 2].includes(slot) || !guildId || !discordUserId) {
    throw new CardClaimError("Invalid card selection.");
  }
  const base = { _id: dropId, guildId, status: "open", expiresAt: { $gt: now } };
  const current = await CardDrop.findOne(base).lean();
  if (!current) throw new CardClaimError("This drop has ended.");
  const creator = current.createdBy === discordUserId;
  // Old reservations are still honored on drops created before this feature.
  if (current.slots.some(s => s.claimedBy === discordUserId || s.entrants?.includes(discordUserId))) {
    throw new CardClaimError("You have already entered a card in this drop.");
  }
  if (current.slots[slot].claimedBy || current.slots[slot].winnerId) {
    throw new CardClaimError("The drop creator has already chosen this card.");
  }
  const noOtherEntry = {
    slots: {
      $not: {
        $elemMatch: {
          $or: [
            { claimedBy: discordUserId },
            { entrants: discordUserId },
          ],
        },
      },
    },
  };
  let updated;
  if (creator) {
    // Match the original current candidate list to prevent a concurrent guest
    // entry being silently lost; retry after a conflict.
    for (let retry = 0; retry < 4; retry += 1) {
      const latest = retry ? await CardDrop.findOne(base).lean() : current;
      if (!latest) break;
      if (latest.slots.some(s => s.claimedBy === discordUserId || s.entrants?.includes(discordUserId))) {
        throw new CardClaimError("You have already chosen a card in this drop.");
      }
      if (latest.slots[slot].claimedBy || latest.slots[slot].winnerId) throw new CardClaimError("That card is already reserved.");
      const previous = latest.slots[slot].entrants || [];
      updated = await CardDrop.findOneAndUpdate({
        ...base, ...noOtherEntry,
        [`slots.${slot}.claimedBy`]: null,
        [`slots.${slot}.winnerId`]: null,
        [`slots.${slot}.entrants`]: previous,
      }, {
        $set: {
          [`slots.${slot}.entrants`]: [discordUserId],
          [`slots.${slot}.winnerId`]: discordUserId,
        },
      }, { returnDocument: "after" }).lean();
      if (updated) {
        return {
          petId: updated.slots[slot].petId, rarity: updated.slots[slot].rarity,
          creatorPriority: true, refundedEntrants: previous.length,
          displacedUserIds: previous.filter(id => id !== discordUserId),
        };
      }
    }
  } else {
    updated = await CardDrop.findOneAndUpdate({
      ...base, ...noOtherEntry,
      [`slots.${slot}.claimedBy`]: null,
      [`slots.${slot}.winnerId`]: null,
    }, { $addToSet: { [`slots.${slot}.entrants`]: discordUserId } },
    { returnDocument: "after" }).lean();
    if (updated) {
      return { petId: updated.slots[slot].petId, rarity: updated.slots[slot].rarity, creatorPriority: false };
    }
  }
  const latest = await CardDrop.findById(dropId).lean();
  if (latest?.slots.some(s => s.entrants?.includes(discordUserId) || s.claimedBy === discordUserId)) {
    throw new CardClaimError("You have already entered a card in this drop.");
  }
  throw new CardClaimError("That card was locked by the drop creator or the drop ended.");
}

export function selectDropWinner(slot, creatorId, randomIndex = count => randomInt(count)) {
  if (slot.claimedBy) return slot.claimedBy; // grandfather existing reservations
  if (slot.winnerId) return slot.winnerId;
  const entrants = [...new Set(slot.entrants || [])];
  if (entrants.includes(creatorId)) return creatorId;
  return entrants.length ? entrants[randomIndex(entrants.length)] : null;
}

// The winner is chosen only at expiry, then awarded atomically with the card.
// All retries honor the already committed CardClaim and the settled timestamp.
export async function settleReservedCard({ dropId, slot, now = new Date() }) {
  const session = await mongoose.startSession();
  try {
    let outcome = "pending";
    await session.withTransaction(async () => {
      const drop = await CardDrop.findOne({
        _id: dropId, status: "closed", expiresAt: { $lte: now },
      }).session(session);
      if (!drop) return;
      const entry = drop.slots[slot];
      if (!entry || entry.settledAt) { outcome = "already-settled"; return; }
      const winner = selectDropWinner(entry, drop.createdBy);
      if (!winner) { outcome = "no-entries"; return; }
      const oldClaim = await CardClaim.findOne({ dropId: drop._id, slot }).session(session);
      if (!oldClaim) {
        await CardCollector.updateOne(
          { discordUserId: winner },
          { $setOnInsert: { discordUserId: winner } }, { upsert: true, session },
        );
        const publicId = await allocateCardId(session);
        const copy = new CardCopy({
          publicId, cardDefinitionId: entry.cardDefinitionId,
          achievementEligible: eligiblePlayerDrop(drop),
          ownerDiscordUserId: winner, originGuildId: drop.guildId,
          upgradeLevel: "normal", state: "owned", source: "drop",
        });
        await copy.save({ session });
        await CardClaim.create([{
          dropId: drop._id, slot, discordUserId: winner, cardCopyId: copy._id,
        }], { session, ordered: true });
      }
      if (!oldClaim && eligiblePlayerDrop(drop)) {
        const claim = await CardClaim.findOne({dropId:drop._id,slot}).session(session);
        const awarded = await CardCopy.findById(claim.cardCopyId).session(session);
        await recordAchievementEvent({id:"grab:"+drop._id+":"+slot,userId:winner,kind:"grabs",cards:[awarded],acquire:true,
          releaseId:drop.releaseId,guildId:drop.guildId,channelId:drop.channelId},session);
      }
      const updated = await CardDrop.updateOne({
        _id: drop._id, [`slots.${slot}.settledAt`]: null,
      }, { $set: {
        [`slots.${slot}.settledAt`]: now,
        [`slots.${slot}.winnerId`]: oldClaim?.discordUserId || winner,
      } }, { session });
      if (!updated.modifiedCount) throw new Error("Drop award settlement conflict.");
      outcome = oldClaim ? "already-awarded" : "awarded";
    });
    return outcome;
  } finally {
    await session.endSession();
  }
}

export async function settleClosedCardDrop(drop) {
  if (drop.status !== "closed" || new Date(drop.expiresAt) > new Date()) return;
  for (let slot = 0; slot < drop.slots.length; slot += 1) {
    if (drop.slots[slot].claimedBy || drop.slots[slot].winnerId || drop.slots[slot].entrants?.length) {
      if (!drop.slots[slot].settledAt) await settleReservedCard({ dropId: drop._id, slot });
    }
  }
}


// Keep a draw fair: the cooldown becomes permanent only for winners.
// Losing entrants receive their five-minute grab opportunity back. The
// sourceDropId check prevents a retry from erasing a newer entry's cooldown.
export async function refundLosingCardGrabCooldowns(drop) {
  if (drop.mode !== "player" || drop.grabRefundedAt) return;
  const fresh = await CardDrop.findById(drop._id).lean();
  if (!fresh || fresh.status !== "closed" || fresh.grabRefundedAt) return;
  if (fresh.slots.some(slot =>
    (slot.entrants?.length || slot.winnerId || slot.claimedBy) && !slot.settledAt
  )) return;
  const losers = new Set();
  for (const slot of fresh.slots) {
    const winner = slot.winnerId || slot.claimedBy;
    for (const id of slot.entrants || []) if (id !== winner) losers.add(id);
  }
  for (const id of losers) {
    await releaseCardActionCooldown({
      action: "grab", discordUserId: id, guildId: fresh.guildId,
      sourceId: String(fresh._id),
    });
  }
  await CardDrop.updateOne(
    { _id: fresh._id, status: "closed", grabRefundedAt: null },
    { $set: { grabRefundedAt: new Date() } },
  );
}
