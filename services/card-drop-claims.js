import mongoose from "mongoose";
import CardDrop from "../models/CardDrop.js";
import CardClaim from "../models/CardClaim.js";
import CardCopy from "../models/CardCopy.js";
import CardCollector from "../models/CardCollector.js";

export class CardClaimError extends Error {}

// Reserving a visible card is NOT awarding it. The user receives the card
// only when the timed grab window ends and settlement completes.
export async function reserveCardFromDrop({ dropId, slot, guildId, discordUserId, now = new Date() }) {
  if (!mongoose.isValidObjectId(dropId) || ![0, 1, 2].includes(slot) || !guildId || !discordUserId) {
    throw new CardClaimError("Invalid card selection.");
  }
  const reserved = await CardDrop.findOneAndUpdate({
    _id: dropId, guildId, status: "open", expiresAt: { $gt: now },
    [`slots.${slot}.claimedBy`]: null,
    // One atomic update enforces both one slot per member and one member per slot.
    slots: { $not: { $elemMatch: { claimedBy: discordUserId } } },
  }, { $set: { [`slots.${slot}.claimedBy`]: discordUserId } },
  { returnDocument: "after" }).lean();
  if (!reserved) {
    const existing = await CardDrop.findOne({ _id: dropId, guildId }).lean();
    if (existing?.slots.some(s => s.claimedBy === discordUserId)) {
      throw new CardClaimError("You can reserve only one card from this drop.");
    }
    throw new CardClaimError("That card has already been reserved or the drop has ended.");
  }
  return { petId: reserved.slots[slot].petId, rarity: reserved.slots[slot].rarity };
}

// Idempotent: a prior claim (including copies awarded by the earlier test
// prototype) is never minted again. Each claimed slot is settled once.
export async function settleReservedCard({ dropId, slot, now = new Date() }) {
  const session = await mongoose.startSession();
  try {
    let outcome = "pending";
    await session.withTransaction(async () => {
      const drop = await CardDrop.findOne({
        _id: dropId, status: "closed", expiresAt: { $lte: now },
      }).session(session);
      if (!drop) return;
      const reservation = drop.slots[slot];
      if (!reservation?.claimedBy || reservation.settledAt) {
        outcome = "already-settled";
        return;
      }
      const oldClaim = await CardClaim.findOne({ dropId: drop._id, slot }).session(session);
      if (!oldClaim) {
        await CardCollector.updateOne(
          { discordUserId: reservation.claimedBy },
          { $setOnInsert: { discordUserId: reservation.claimedBy } },
          { upsert: true, session },
        );
        const copy = new CardCopy({
          cardDefinitionId: reservation.cardDefinitionId,
          ownerDiscordUserId: reservation.claimedBy,
          originGuildId: drop.guildId,
          upgradeLevel: "normal", state: "owned", source: "drop",
        });
        await copy.save({ session });
        await CardClaim.create([{
          dropId: drop._id, slot, discordUserId: reservation.claimedBy,
          cardCopyId: copy._id,
        }], { session, ordered: true });
      }
      const updated = await CardDrop.updateOne({
        _id: drop._id,
        [`slots.${slot}.claimedBy`]: reservation.claimedBy,
        [`slots.${slot}.settledAt`]: null,
      }, { $set: { [`slots.${slot}.settledAt`]: now } }, { session });
      if (!updated.modifiedCount) throw new Error("Card reservation settlement conflict");
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
    if (drop.slots[slot].claimedBy && !drop.slots[slot].settledAt) {
      await settleReservedCard({ dropId: drop._id, slot });
    }
  }
}
