import CardCopy from "../models/CardCopy.js";
import CardDefinition from "../models/CardDefinition.js";
import PetCatalog from "../models/PetCatalog.js";

export const escapePetNameSearch = value =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function petNameSearchPattern(reference) {
  const text = String(reference || "").trim();
  if (!text || text.length > 120) throw new Error("Enter a card ID or pet name.");
  // Short pet names like Cat and Dog must be exact; four or more characters
  // may be a case-insensitive beginning of the pet's name.
  return new RegExp("^" + escapePetNameSearch(text) + (text.length < 4 ? "$" : ""), "i");
}

/**
 * Resolve a player-facing card ID against the owner's collection.
 * IDs remain case-sensitive internally; a non-exact input only succeeds
 * when its case-insensitive spelling identifies one owned copy.
 */
export async function findOwnedCardById(ownerId, reference) {
  const input = String(reference || "").trim();
  if (!/^[0-9A-Za-z_-]{5}$/.test(input)) throw new Error("Enter a five-character card ID.");
  const base = { ownerDiscordUserId: ownerId, state: "owned" };
  const exact = await CardCopy.findOne({ ...base, publicId: input }).lean();
  if (exact) return exact;
  const similar = await CardCopy.find({
    ...base, publicId: new RegExp("^" + escapePetNameSearch(input) + "$", "i"),
  }).limit(2).lean();
  if (similar.length > 1) {
    throw new Error("More than one of your card IDs has those letters. Use the exact capitalization shown in your collection.");
  }
  return similar[0] || null;
}

/**
 * Pick an OWNED card. With no reference, prefer the newest owned card (including
 * upgrades), never a historic grab that may have been consumed or traded.
 * A pet prefix chooses the newest owned copy of that specific pet. If the
 * prefix describes two different owned pets, require a longer name or ID.
 */
export async function findOwnedCardForCommand(ownerId, reference = null) {
  const base = { ownerDiscordUserId: ownerId, state: "owned" };
  const input = String(reference || "").trim();
  if (!input) {
    const newest = await CardCopy.findOne(base).sort({ createdAt: -1, _id: -1 }).lean();
    if (!newest) throw new Error("You don't own any cards yet. Grab a card first.");
    return newest;
  }
  if (/^[0-9A-Za-z_-]{5}$/.test(input)) {
    const match = await findOwnedCardById(ownerId, input);
    if (match) return match;
  }
  const pets = await PetCatalog.find({ name: petNameSearchPattern(input) })
    .select("petId name").limit(200).lean();
  if (!pets.length) throw new Error("No pet matches that name. Enter at least the first four letters, or a card ID.");
  const definitions = await CardDefinition.find({
    petId: { $in: pets.map(p => p.petId) },
  }).select("_id petId").lean();
  if (!definitions.length) throw new Error("You don't own a card matching that pet name.");
  const ids = await CardCopy.distinct("cardDefinitionId", {
    ...base, cardDefinitionId: { $in: definitions.map(d => d._id) },
  });
  const owned = new Set(ids.map(String));
  const matches = definitions.filter(d => owned.has(String(d._id)));
  if (!matches.length) throw new Error("You don't own a card matching that pet name.");
  const petIds = [...new Set(matches.map(d => d.petId))];
  if (petIds.length > 1) {
    const names = petIds.slice(0, 5).map(id => pets.find(p => p.petId === id)?.name || id);
    throw new Error(`That name matches several pets you own: ${names.join(", ")}. Use more letters or a five-character card ID.`);
  }
  const newest = await CardCopy.findOne({
    ...base, cardDefinitionId: { $in: matches.map(d => d._id) },
  }).sort({ createdAt: -1, _id: -1 }).lean();
  if (!newest) throw new Error("That card is no longer owned by you.");
  return newest;
}
