import PointsWallet from "../models/PointsWallet.js";
import PointsLedger from "../models/PointsLedger.js";

// A reusable transaction primitive for the shop and future community features.
// Call ONLY within an existing MongoDB withTransaction() callback, alongside
// the entitlement/entry being purchased. Never debit a wallet separately from
// the receipt and the purchased asset.
export class PointsSpendError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PointsSpendError";
    this.code = code;
  }
}

export function validateSpendDetails({ guildId, userId, amount, eventKey,
  description, sourceType, sourceId = "", items = [] }) {
  if (typeof guildId !== "string" || !guildId ||
      typeof userId !== "string" || !userId ||
      !Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000 ||
      typeof eventKey !== "string" || !eventKey || eventKey.length > 200 ||
      typeof description !== "string" || !description.trim() || description.length > 240 ||
      typeof sourceType !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(sourceType) ||
      typeof sourceId !== "string" || sourceId.length > 200 ||
      !Array.isArray(items) || items.length > 50 ||
      items.some(item => typeof item?.category !== "string" ||
        typeof item?.id !== "string" || item.id.length > 128 ||
        !Number.isSafeInteger(item.price) || item.price < 0)) {
    throw new PointsSpendError("invalid", "Invalid Points spending details.");
  }
}

export function spendEventKey(sourceType, reference) {
  if (typeof reference !== "string" || !reference || reference.length > 160) {
    throw new PointsSpendError("invalid", "A stable spending reference is required.");
  }
  if (typeof sourceType !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(sourceType)) {
    throw new PointsSpendError("invalid", "A valid spending source is required.");
  }
  return `spend:${sourceType}:${reference}`;
}

export async function spendPointsInSession({
  guildId, userId, amount, eventKey, description, sourceType,
  sourceId = "", actorId = "", items = [], session,
  Wallet = PointsWallet, Ledger = PointsLedger,
}) {
  validateSpendDetails({ guildId, userId, amount, eventKey, description,
    sourceType, sourceId, items });
  if (!session) throw new PointsSpendError("invalid", "Spending requires an active database transaction.");
  const selector = { guildId, discordUserId: userId, eventKey };
  if (await Ledger.exists(selector).session(session)) {
    throw new PointsSpendError("duplicate", "This purchase has already been recorded.");
  }
  const debited = await Wallet.findOneAndUpdate({
    guildId, discordUserId: userId, balance: { $gte: amount },
  }, { $inc: { balance: -amount } }, { session, returnDocument: "after" });
  if (!debited) {
    throw new PointsSpendError("insufficient", "You don't have enough Points yet.");
  }
  await Ledger.create([{
    ...selector, kind: "spend", amount: -amount,
    description: description.trim(), sourceType,
    sourceId, actorId, balanceAfter: debited.balance,
    items,
  }], { session });
  return { spent: amount, balanceAfter: debited.balance };
}
