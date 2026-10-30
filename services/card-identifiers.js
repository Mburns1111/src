import CardCopy from "../models/CardCopy.js";
import CardNumberSequence from "../models/CardNumberSequence.js";

// Newly minted IDs are five letters/digits ONLY. Existing five-character
// IDs containing - or _ remain valid forever; do not migrate or rename them.
// 62^5 = 916,132,832 possible new IDs.
// MongoDB _id stays the canonical hidden reference for ownership and art rendering.
export const CARD_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const CARD_ID_LENGTH = 5;
export const CARD_ID_CAPACITY = CARD_ID_ALPHABET.length ** CARD_ID_LENGTH;
export const CARD_NUMBER_SEQUENCE_KEY = "global-card-copy-v2-alphanumeric";

export function encodeCardNumber(number) {
  if (!Number.isSafeInteger(number) || number < 1 || number >= CARD_ID_CAPACITY) {
    throw new Error("The five-character card ID space is exhausted.");
  }
  // Reversible permutation across this base-62 ID space. 131071 is coprime to 62.
  // Keeps numbers unique while making adjacent awards look different.
  let n = (number * 131071 + 347842123) % CARD_ID_CAPACITY;
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
  // V2 uses a separate counter. Check ALL historical copies because legacy
  // base-64 IDs may overlap with new alphanumeric outputs. IDs are never reused.
  for (let attempt = 0; attempt < 64; attempt++) {
    const counter = await CardNumberSequence.findOneAndUpdate(
      { _id: CARD_NUMBER_SEQUENCE_KEY },
      { $inc: { value: 1 } },
      { upsert: true, new: true, session, setDefaultsOnInsert: true },
    );
    const candidate = encodeCardNumber(counter.value);
    const existing = await CardCopy.exists({ publicId: candidate }).session(session);
    if (!existing) return candidate;
  }
  throw new Error("Could not generate a new unique five-character card ID. Retry.");
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
