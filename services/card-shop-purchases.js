import mongoose from "mongoose";
import CardCollector from "../models/CardCollector.js";
import PointsLedger from "../models/PointsLedger.js";
import { PointsSpendError, spendEventKey, spendPointsInSession } from "./points-spending.js";

// Card extras are global to the collector; Points are charged to the guild wallet
// where the player opens the shop. Purchases never touch appearance ownership.
export const CARD_EXTRA_ITEMS = Object.freeze({
  grab: Object.freeze({ field: "bonusGrabs", price: 10, label: "Extra Grab" }),
  drop: Object.freeze({ field: "bonusDrops", price: 20, label: "Extra Drop" }),
});
export const CARD_EXTRA_QUANTITIES = Object.freeze([1, 5]);

export function cardExtraPrice(kind, quantity) {
  const item = CARD_EXTRA_ITEMS[kind];
  if (!item || !CARD_EXTRA_QUANTITIES.includes(quantity))
    throw new PointsSpendError("invalid", "That card-shop item or quantity is unavailable.");
  return item.price * quantity;
}

export async function purchaseCardExtras({ guildId, userId, kind, quantity, interactionId }) {
  const amount = cardExtraPrice(kind, quantity);
  if (!/^\d{17,20}$/.test(String(guildId)) ||
      !/^\d{17,20}$/.test(String(userId)) ||
      !/^\d{17,20}$/.test(String(interactionId))) {
    throw new PointsSpendError("invalid", "This card purchase could not be verified.");
  }
  const item = CARD_EXTRA_ITEMS[kind];
  const eventKey = spendEventKey("card_extras", interactionId);
  const selector = { guildId, discordUserId: userId, eventKey };
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      // Same wallet, signed Points ledger and transaction semantics as the
      // appearance shop; awarding the extras is in the SAME transaction.
      const payment = await spendPointsInSession({
        guildId, userId, amount, eventKey,
        description: `Hatchem ${item.label} ×${quantity}`,
        sourceType: "card_extras", sourceId: kind,
        items: [{ category: "card_consumable", id: kind, price: amount }],
        session,
      });
      const granted = await CardCollector.updateOne({
        discordUserId: userId, registeredAt: { $ne: null },
        registeredGuildIds: guildId,
      }, { $inc: { [item.field]: quantity } }, { session });
      if (granted.matchedCount !== 1)
        throw new PointsSpendError("unregistered", "Register for Hatchem before purchasing extras.");
      return { kind, quantity, amount, balanceAfter: payment.balanceAfter, alreadyProcessed: false };
    });
  } catch (error) {
    // A retried Discord interaction cannot deduct Points or grant extras twice.
    if (error instanceof PointsSpendError && error.code === "duplicate" ||
        Number(error?.code) === 11000) {
      if (await PointsLedger.exists(selector))
        return { kind, quantity, amount, alreadyProcessed: true };
    }
    throw error;
  } finally {
    await session.endSession();
  }
}
