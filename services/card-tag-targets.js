import CardCopy from "../models/CardCopy.js";
import CardDefinition from "../models/CardDefinition.js";
import PetCatalog from "../models/PetCatalog.js";
import { findOwnedCardById, findOwnedCardForCommand } from "./card-owned-selection.js";

/**
 * No reference: one newest owned copy.
 * Five-character owned card ID: exactly one copy.
 * Pet name/prefix (including names containing spaces): every owned copy of
 * that pet, across releases and upgrade stages, never another pet.
 */
export async function selectOwnedTagTargets(discordUserId, reference) {
  const input = String(reference || "").trim();
  if (!input) {
    const copy = await findOwnedCardForCommand(discordUserId);
    return { cards: [copy], mode: "newest", name: null };
  }
  if (/^[0-9A-Za-z_-]{5}$/.test(input)) {
    const copy = await findOwnedCardById(discordUserId, input);
    if (copy) return { cards: [copy], mode: "id", name: null };
  }
  const newest = await findOwnedCardForCommand(discordUserId, input);
  const definition = await CardDefinition.findById(newest.cardDefinitionId).select("petId").lean();
  if (!definition) throw new Error("The selected pet's definition no longer exists.");
  const [allDefinitions, pet] = await Promise.all([
    CardDefinition.find({ petId: definition.petId }).select("_id").lean(),
    PetCatalog.findOne({ petId: definition.petId }).select("name").lean(),
  ]);
  const cards = await CardCopy.find({
    ownerDiscordUserId: discordUserId,
    state: "owned",
    cardDefinitionId: { $in: allDefinitions.map(d => d._id) },
  }).lean();
  if (!cards.length) throw new Error("No matching cards are currently owned.");
  return { cards, mode: "pet", name: pet?.name || definition.petId };
}
