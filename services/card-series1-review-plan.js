import { SERIES1_ARTIST_PETS } from "./card-series1-artist-pack.js";

const scopeEntries = Object.freeze({
  owner: { credit: "Lilly", count: 88 },
  "artist-arial": { credit: "αriαℓ", count: 7 },
  "artist-jovy": { credit: "jovyisweird", count: 13 },
});
const guestByPet = new Map(SERIES1_ARTIST_PETS.map(pet => [pet.petId, pet]));
const EXCLUDED_PETS = ["hedgehog", "vampire-dragon"];

/**
 * Strict 108-card review groups: the 88 owner drawings + 8 owner shared assets,
 * or one of the two independently permitted guest artist portfolios.
 * No image, card ownership, rarity, activation or hatch settings are changed.
 */
export function planSeries1ArtworkReview({ release, definitions, artworks, scope }) {
  const settings = scopeEntries[scope];
  if (!settings) throw Error("Choose --scope=owner, artist-arial or artist-jovy.");
  if (release?.releaseId !== "s1-r1" || release.status !== "draft")
    throw Error("Only the original draft Series 1 release can be reviewed in bulk.");
  const cards = definitions || [];
  const ids = cards.map(card => card.petId);
  if (cards.length !== 108 || new Set(ids).size !== 108 ||
      EXCLUDED_PETS.some(id => ids.includes(id)))
    throw Error("Series 1 roster is not the finalized 108 unique pets.");
  if (SERIES1_ARTIST_PETS.some(pet => !ids.includes(pet.petId)))
    throw Error("One or more guest-artist cards are missing from the 108-pet roster.");

  const owned = cards.filter(card => !guestByPet.has(card.petId));
  if (owned.length !== 88)
    throw Error("Expected exactly 88 owner-drawn pet cards.");
  const selected = scope === "owner"
    ? owned : cards.filter(card => guestByPet.get(card.petId)?.artistCredit === settings.credit);
  if (selected.length !== settings.count)
    throw Error("Artist group count does not match the imported release.");

  const byKey = new Map((artworks || []).map(a => [a.key, a]));
  const itemKeys = new Map();
  const reviewCards = [];
  for (const card of selected) {
    if (card.enabled || !["pending","approved"].includes(card.artStatus))
      throw Error("A selected card is enabled or has unexpected art status: " + card.petId);
    if (!card.petArtworkKey || !card.petArtworkKey.startsWith("s1-r1-pet-"))
      throw Error("Missing or unexpected pet illustration: " + card.petId);
    const art = byKey.get(card.petArtworkKey);
    if (!art || art.kind !== "pet" || art.artistCredit !== settings.credit ||
        card.artistCredit !== settings.credit)
      throw Error("Art credit or asset mismatch: " + card.petId);
    const guest = guestByPet.get(card.petId);
    if (scope === "owner") {
      if (card.artistUrl || card.artSourceUrl || art.artistUrl || art.sourceUrl)
        throw Error("Owner-drawn art has unexpected external artist/source link: " + card.petId);
    } else if (!guest || guest.artistUrl !== card.artistUrl ||
               guest.artistUrl !== art.artistUrl) {
      throw Error("Imported guest artist link mismatch: " + card.petId);
    }
    if (!["needs-review","approved"].includes(art.licenseReviewStatus) ||
        (card.artStatus === "approved" && art.licenseReviewStatus !== "approved"))
      throw Error("Artwork state not eligible for review: " + card.petId);
    itemKeys.set(art.key, art);
    if (card.artStatus !== "approved") reviewCards.push({ _id: card._id, petId: card.petId });
  }

  if (scope === "owner") {
    const shared = [
      [release.cardBackgroundKey, "background"],
      [release.cardFrameKey, "frame"],
      ...Object.values(release.cardRarityFrameKeys || {}).map(key => [key, "frame"]),
      ...Object.values(release.cardStageOverlayKeys || {}).map(key => [key, "frame"]),
    ].filter(([key]) => key);
    if (shared.length !== 8 || new Set(shared.map(x => x[0])).size !== 8)
      throw Error("Expected exactly eight independent shared background/frame assets.");
    for (const [key, kind] of shared) {
      const asset = byKey.get(key);
      if (!asset || asset.kind !== kind || asset.artistCredit !== settings.credit ||
          !["needs-review","approved"].includes(asset.licenseReviewStatus))
        throw Error("Shared asset is missing, miscredited or unreviewable: " + key);
      itemKeys.set(key, asset);
    }
  }

  const toApprove = [...itemKeys.values()]
    .filter(asset => asset.licenseReviewStatus === "needs-review")
    .map(asset => ({ _id: asset._id, key: asset.key, kind: asset.kind }));
  const count = scope === "owner" ? 96 : settings.count;
  if (itemKeys.size !== count)
    throw Error("Artwork key count does not match the exact review group.");
  return {
    releaseId:"s1-r1", scope, artistCredit:settings.credit,
    selectedCards:selected.length, totalArtwork:itemKeys.size,
    assetsToApprove:toApprove, cardsToApprove:reviewCards,
    guestAssetsUntouched:scope === "owner" ? 20 : 20 - settings.count,
  };
}
