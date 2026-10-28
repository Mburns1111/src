import CardCopy from "../models/CardCopy.js";
import CardNumberSequence from "../models/CardNumberSequence.js";

// Five characters: numbers, upper/lower-case letters and Discord-safe symbols.
// 64^5 = 1,073,741,824 possible codes. IDs are case-sensitive and never reused.
// MongoDB _id stays the canonical hidden reference for ownership and art rendering.
export const CARD_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
export const CARD_ID_LENGTH = 5;
export const CARD_ID_CAPACITY = CARD_ID_ALPHABET.length ** CARD_ID_LENGTH;
export const CARD_NUMBER_SEQUENCE_KEY = "global-card-copy-v1";

export function encodeCardNumber(number) {
  if (!Number.isSafeInteger(number) || number < 1 || number >= CARD_ID_CAPACITY) {
    throw new Error("The five-character card ID space is exhausted.");
  }
  let n = number;
  let output = "";
  for (let i = 0; i < CARD_ID_LENGTH; i++) {
    output = CARD_ID_ALPHABET[n % CARD_ID_ALPHABET.length] + output;
    n = Math.floor(n / CARD_ID_ALPHABET.length);
  }
  return output;
}

export function normalizeCardReference(input) {
  const value = String(input ?? "").trim();
  if (!/^[0-9A-Za-z_-]{5}$/.test(value)) {
    throw new Error("Enter the five-character card ID shown in your collection (case-sensitive).");
  }
  return value;
}

export function displayCardId(card) {
  if (!card?.publicId) return "PENDING";
  return normalizeCardReference(card.publicId);
}

export async function allocateCardId(session) {
  const counter = await CardNumberSequence.findOneAndUpdate(
    { _id: CARD_NUMBER_SEQUENCE_KEY },
    { $inc: { value: 1 } },
    { upsert: true, new: true, session, setDefaultsOnInsert: true },
  );
  return encodeCardNumber(counter.value);
}

// Never infer a card ID from ObjectId bits, and never show ObjectIds in chat.
// Resolve against a globally unique indexed field, irrespective of owner.
export async function resolveCardId(reference) {
  const publicId = normalizeCardReference(reference);
  const card = await CardCopy.findOne({ publicId }).select("_id").lean();
  if (!card) throw new Error("No card matches that five-character ID.");
  return card._id;
}

export function upgradeLabel(value) {
  if (value === "mega") return "Mega Neon";
  if (value === "neon") return "Neon";
  return "Normal";
}
