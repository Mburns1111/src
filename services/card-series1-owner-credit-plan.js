import { SERIES1_ARTIST_PETS } from "./card-series1-artist-pack.js";

const SERIES1_EXTERNAL_IDS = new Set(SERIES1_ARTIST_PETS.map(pet => pet.petId));
const EXPECTED_OWNER_CARDS = 88;
const EXPECTED_EXTERNAL_CARDS = 20;

/**
 * Calculates strictly-scoped attribution for the owner's existing Series 1 art.
 * No images, artist-supplied cards, approvals, activation, or artwork keys change.
 */
export function planSeries1OwnerArtCredit({ release, definitions, artworks, credit }) {
  const chosenCredit = String(credit ?? "").trim();
  if (release?.releaseId !== "s1-r1" || release.status !== "draft")
    throw Error("Credit preparation is limited to the real draft s1-r1 release.");
  if (!chosenCredit || chosenCredit.length > 100)
    throw Error("Supply your desired public artist credit, 1–100 characters.");
  const cards = definitions || [];
  if (cards.length !== 108 || new Set(cards.map(card => card.petId)).size !== 108)
    throw Error("Expected exactly 108 unique release definitions. No updates made.");
  const byPet = new Map(cards.map(card => [card.petId, card]));
  const external = [...SERIES1_EXTERNAL_IDS].map(petId => byPet.get(petId));
  if (external.length !== EXPECTED_EXTERNAL_CARDS || external.some(card => !card))
    throw Error("Expected all 20 imported artist pet definitions; no updates made.");
  const owner = cards.filter(card => !SERIES1_EXTERNAL_IDS.has(card.petId));
  if (owner.length !== EXPECTED_OWNER_CARDS)
    throw Error("Expected exactly 88 owner-drawn cards; no updates made.");
  const artByKey = new Map((artworks || []).map(art => [art.key, art]));
  const shared = [
    [release.cardBackgroundKey, "background"],
    [release.cardFrameKey, "frame"],
    ...Object.values(release.cardRarityFrameKeys || {}).map(key => [key, "frame"]),
    ...Object.values(release.cardStageOverlayKeys || {}).map(key => [key, "frame"]),
  ].filter(([key]) => Boolean(key));
  const distinctShared = new Map(shared.map(([key, kind]) => [key, kind]));
  if (distinctShared.size !== shared.length)
    throw Error("Duplicate shared artwork keys; review manually before crediting.");

  const cardsToUpdate = [];
  const assetsToUpdate = new Map();
  for (const card of owner) {
    if (card.enabled || !["pending", "missing"].includes(card.artStatus))
      throw Error("Owner card already enabled or approved: " + card.petId);
    if (!card.petArtworkKey || !card.petArtworkKey.startsWith("s1-r1-pet-"))
      throw Error("Unexpected pet artwork key: " + card.petId);
    const asset = artByKey.get(card.petArtworkKey);
    if (!asset || asset.kind !== "pet")
      throw Error("Missing pet artwork metadata for " + card.petId);
    if (String(card.artistUrl || card.artSourceUrl || asset.artistUrl || asset.sourceUrl || "").trim())
      throw Error("An owner card already has external-source metadata: " + card.petId);
    if (card.artistCredit && card.artistCredit !== chosenCredit)
      throw Error("Owner card already has a different artist credit: " + card.petId);
    if (asset.artistCredit && asset.artistCredit !== chosenCredit)
      throw Error("Owner asset already has a different artist credit: " + card.petId);
    if (asset.licenseReviewStatus !== "needs-review" &&
        !(asset.licenseReviewStatus === "approved" && asset.artistCredit === chosenCredit))
      throw Error("Owner artwork is not pending review: " + card.petId);
    if (!card.artistCredit) cardsToUpdate.push({ _id: card._id, petId: card.petId });
    if (!asset.artistCredit) assetsToUpdate.set(asset.key, asset);
  }
  for (const [key, kind] of distinctShared) {
    const asset = artByKey.get(key);
    if (!asset || asset.kind !== kind) throw Error("Missing shared " + kind + " artwork: " + key);
    if (asset.artistCredit && asset.artistCredit !== chosenCredit)
      throw Error("Shared artwork already has another artist credit: " + key);
    if (!asset.artistCredit && asset.licenseReviewStatus !== "needs-review")
      throw Error("Shared artwork cannot be re-attributed after review: " + key);
    if (!asset.artistCredit) assetsToUpdate.set(key, asset);
  }
  return {
    releaseId: "s1-r1",
    credit: chosenCredit,
    ownerCardCount: owner.length,
    importedExternalCount: external.length,
    sharedArtCount: distinctShared.size,
    cardsToUpdate,
    artworkToUpdate: [...assetsToUpdate.values()].map(art => ({
      _id: art._id, key: art.key, kind: art.kind,
    })),
  };
}
