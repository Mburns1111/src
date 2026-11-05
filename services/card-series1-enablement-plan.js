import { CARD_RARITIES, validateHatchOdds } from "./card-hatch-engine.js";
import { SERIES1_ARTIST_PETS } from "./card-series1-artist-pack.js";

const expectedByRarity = Object.freeze({
  Common: 13, Uncommon: 18, Rare: 26, "Ultra-Rare": 28, Legendary: 23,
});
const expectedGuestByPet = new Map(SERIES1_ARTIST_PETS.map(p => [p.petId, p]));

/**
 * Pure safety gate for the finalized 108-card draft. It does not mutate
 * cards, release settings, images, odds, ownership, or achievements.
 */
export function planSeries1CardEnablement({ release, definitions = [], artwork = [] } = {}) {
  if (release?.releaseId !== "s1-r1" || release.status !== "draft")
    throw Error("Only official draft s1-r1 can be enabled in this batch.");
  if (definitions.length !== 108 || new Set(definitions.map(d => d.petId)).size !== 108)
    throw Error("The release must contain exactly 108 unique card definitions.");
  if (definitions.some(d => ["hedgehog", "vampire-dragon"].includes(d.petId)))
    throw Error("Hedgehog and Vampire Dragon are intentionally excluded from Series 1.");
  const byPet = new Map(definitions.map(d => [d.petId, d]));
  if (SERIES1_ARTIST_PETS.some(p => !byPet.has(p.petId)))
    throw Error("The 20 approved guest-art cards must all remain in the release.");
  const groups = Object.fromEntries(CARD_RARITIES.map(r => [r, 0]));
  const assets = new Map(artwork.map(a => [a.key, a]));
  const toEnable = [];
  let ownerCards = 0, alreadyEnabled = 0;
  validateHatchOdds(release.hatchOdds);
  for (const card of definitions) {
    if (!(card.rarity in groups)) throw Error("Unexpected rarity on " + card.petId);
    groups[card.rarity]++;
    const guest = expectedGuestByPet.get(card.petId);
    if (guest) {
      if (card.artistCredit !== guest.artistCredit || card.artistUrl !== guest.artistUrl)
        throw Error("Guest artist attribution mismatch on " + card.petId);
    } else {
      ownerCards++;
      if (card.artistCredit !== "Lilly" || card.artistUrl || card.artSourceUrl)
        throw Error("Owner illustration attribution mismatch on " + card.petId);
    }
    if (card.artStatus !== "approved" || !card.petArtworkKey || !Number.isFinite(card.hatchWeight) ||
        card.hatchWeight <= 0)
      throw Error("Card is not fully approved with positive hatch weight: " + card.petId);
    const image = assets.get(card.petArtworkKey);
    if (!image || image.kind !== "pet" || image.licenseReviewStatus !== "approved" ||
        image.artistCredit !== card.artistCredit)
      throw Error("Approved artwork metadata missing or mismatched: " + card.petId);
    if (guest && image.artistUrl !== guest.artistUrl)
      throw Error("Guest asset artist link mismatch: " + card.petId);
    for (const stage of ["neon", "mega"]) {
      const key = card.stagePetArtworkKeys?.[stage];
      if (!key) continue;
      const alt = assets.get(key);
      if (!alt || alt.kind !== "pet" || alt.licenseReviewStatus !== "approved" || !alt.artistCredit)
        throw Error("Unapproved optional " + stage + " illustration for " + card.petId);
    }
    if (card.enabled) alreadyEnabled++;
    else toEnable.push({ _id: card._id, petId: card.petId });
  }
  for (const rarity of CARD_RARITIES)
    if (groups[rarity] !== expectedByRarity[rarity])
      throw Error("Series 1 rarity roster was changed: " + rarity);
  if (ownerCards !== 88 || definitions.length - ownerCards !== 20)
    throw Error("Incorrect balance of owner and guest-art cards.");
  const shared = [
    [release.cardBackgroundKey, "background"],
    [release.cardFrameKey, "frame"],
    ...Object.values(release.cardRarityFrameKeys || {}).map(key => [key, "frame"]),
    ...Object.values(release.cardStageOverlayKeys || {}).map(key => [key, "frame"]),
  ].filter(([key]) => Boolean(key));
  if (shared.length !== 8 || new Set(shared.map(([key]) => key)).size !== 8)
    throw Error("The eight official shared layer assignments have changed.");
  for (const [key, kind] of shared) {
    const image = assets.get(key);
    if (!image || image.kind !== kind || image.licenseReviewStatus !== "approved" ||
        image.artistCredit !== "Lilly")
      throw Error("Shared artwork is not approved for use: " + key);
  }
  return {
    releaseId: release.releaseId,
    cardCount: definitions.length,
    rarityCounts: groups,
    ownerCards,
    guestCards: definitions.length - ownerCards,
    alreadyEnabled,
    cardsToEnable: toEnable,
    sharedLayers: shared.length,
  };
}
