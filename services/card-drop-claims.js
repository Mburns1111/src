import mongoose from "mongoose";
import CardDrop from "../models/CardDrop.js";
import CardClaim from "../models/CardClaim.js";
import CardCopy from "../models/CardCopy.js";
import CardCollector from "../models/CardCollector.js";

export class CardClaimError extends Error {}
export async function claimCardFromDrop({ dropId, slot, guildId, discordUserId, now = new Date() }) {
  if (!mongoose.isValidObjectId(dropId) || !Number.isInteger(slot) || slot < 0 || slot > 2) {
    throw new CardClaimError("Invalid card selection.");
  }
  const session = await mongoose.startSession();
  try {
    let awarded;
    // Unique claim indexes and the per-slot compare-and-set guard races across workers.
    // Transactions ensure a claimed slot can never exist without its awarded card.
    await session.withTransaction(async () => {
      const drop = await CardDrop.findOne({
        _id: dropId, guildId, status: "open", expiresAt: { $gt: now },
        [`slots.${slot}.claimedBy`]: null,
      }).session(session);
      if (!drop) throw new CardClaimError("That card has already been taken or the drop has expired.");
      if (await CardClaim.exists({ dropId: drop._id, discordUserId }).session(session)) {
        throw new CardClaimError("You can grab only one card from this drop.");
      }
      const updated = await CardDrop.updateOne({
        _id: drop._id, [`slots.${slot}.claimedBy`]: null,
        status: "open", expiresAt: { $gt: now },
      }, { $set: { [`slots.${slot}.claimedBy`]: discordUserId } }, { session });
      if (updated.modifiedCount !== 1) throw new CardClaimError("Someone grabbed that card first.");
      await CardCollector.updateOne({ discordUserId }, { $setOnInsert: { discordUserId } }, { session, upsert: true });
      const copy = new CardCopy({
        cardDefinitionId: drop.slots[slot].cardDefinitionId,
        ownerDiscordUserId: discordUserId,
        originGuildId: guildId, upgradeLevel: "normal", state: "owned", source: "drop",
      });
      await copy.save({ session });
      await CardClaim.create([{ dropId: drop._id, slot, discordUserId, cardCopyId: copy._id }], { session, ordered: true });
      awarded = { copyId: String(copy._id), petId: drop.slots[slot].petId, rarity: drop.slots[slot].rarity };
    });
    return awarded;
  } catch (error) {
    if (error instanceof CardClaimError) throw error;
    if (error.code === 11000 || error.hasErrorLabel?.("TransientTransactionError")) {
      throw new CardClaimError("That card was just claimed, or you already grabbed one from this drop.");
    }
    throw error;
  } finally {
    await session.endSession();
  }
}
