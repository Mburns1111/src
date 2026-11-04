/**
 * Pure, read-only Hatchem release diagnostics. Never returns private secret
 * conditions or artwork bytes; safe to print in the owner's Replit shell.
 */
import { CARD_RARITIES, validateHatchOdds } from "./card-hatch-engine.js";
import { SERIES1_ARTIST_PETS } from "./card-series1-artist-pack.js";
import { selectedCardPetArt } from "./card-pet-art-stages.js";
import { validCardArtistUrl } from "./card-artist-links.js";

export function auditHatchemRelease({
  release, definitions, artwork, egg, expected = 110,
  achievementStartConfigured = false,
  guilds = [],
} = {}) {
  if (!release) throw Error("Release not found.");
  const cards = Array.isArray(definitions) ? definitions : [];
  const art = Array.isArray(artwork) ? artwork : [];
  const byKey = new Map(art.map(a => [a.key, a]));
  const expectedArtists = release.releaseId === "s1-r1"
    ? new Map(SERIES1_ARTIST_PETS.map(a => [a.petId, a])) : new Map();
  const rarityCounts = Object.fromEntries(CARD_RARITIES.map(r => [r, 0]));
  const artStatusCounts = { missing: 0, pending: 0, approved: 0, "test-placeholder": 0 };
  const artworkReviewCounts = { approved: 0, "needs-review": 0, rejected: 0, missing: 0 };
  const problems = [];
  let enabled = 0, hatchable = 0, missingCredits = 0, incompleteExternalLinks = 0;
  let customNeon = 0, customMega = 0;

  if (release.status !== "draft")
    problems.push("Release is not a draft; do not rerun activation.");
  if (cards.length !== expected)
    problems.push(`Release roster has ${cards.length} pets, expected ${expected}.`);
  try { validateHatchOdds(release.hatchOdds); }
  catch { problems.push("Hatch rarity odds are invalid or do not total 100%."); }
  const ids = new Set();
  for (const card of cards) {
    if (ids.has(card.petId)) problems.push("Duplicate pet definition: " + card.petId);
    ids.add(card.petId);
    if (rarityCounts[card.rarity] !== undefined) rarityCounts[card.rarity]++;
    if (artStatusCounts[card.artStatus] !== undefined) artStatusCounts[card.artStatus]++;
    if (card.enabled) enabled++;
    const base = byKey.get(card.petArtworkKey);
    const review = base ? base.licenseReviewStatus : "missing";
    if (artworkReviewCounts[review] !== undefined) artworkReviewCounts[review]++;
    if (!base || base.kind !== "pet") {
      problems.push("Missing original pet artwork: " + card.petId);
      continue;
    }
    if (!String(card.artistCredit || base.artistCredit || "").trim()) missingCredits++;
    const external = expectedArtists.get(card.petId);
    if (external) {
      const label = String(card.artistCredit || base.artistCredit || "").trim();
      const profile = validCardArtistUrl(card.artistUrl) || validCardArtistUrl(base.artistUrl);
      if (label !== external.artistCredit || !profile) incompleteExternalLinks++;
    }
    if (card.enabled && card.artStatus === "approved" &&
        base.licenseReviewStatus === "approved" &&
        Number(card.hatchWeight) > 0 && (card.artistCredit || base.artistCredit)) hatchable++;
    for (const stage of ["neon", "mega"]) {
      const { key, override } = selectedCardPetArt(card, stage);
      if (!override) continue;
      if (stage === "neon") customNeon++;
      else customMega++;
      const item = byKey.get(key);
      if (!item || item.kind !== "pet" || item.licenseReviewStatus !== "approved" ||
          !item.artistCredit) problems.push("Unapproved "+stage+" alternative: "+card.petId);
    }
  }
  if (missingCredits) problems.push(missingCredits+" pet cards have missing artist credit.");
  if (incompleteExternalLinks)
    problems.push(incompleteExternalLinks+" external-artist cards need corrected credit or clickable profile.");
  if (enabled !== expected) problems.push(`Only ${enabled}/${expected} cards are enabled.`);
  if (hatchable !== expected) problems.push(`Only ${hatchable}/${expected} cards have approved, enabled, hatchable artwork.`);
  const shared = [
    [release.cardBackgroundKey, "background"],
    [release.cardFrameKey, "frame"],
    ...Object.values(release.cardRarityFrameKeys || {}).map(x => [x, "frame"]),
    ...Object.values(release.cardStageOverlayKeys || {}).map(x => [x, "frame"]),
  ];
  for (const [key, kind] of shared) {
    if (!key) continue;
    const item = byKey.get(key);
    if (!item || item.kind !== kind || item.licenseReviewStatus !== "approved")
      problems.push("Shared "+kind+" artwork needs review: "+key);
  }
  if (!release.eggImageFileId || !egg || egg.licenseReviewStatus !== "approved" ||
      String(egg.fileId) !== String(release.eggImageFileId))
    problems.push("Official egg image is missing or lacks an approved source/license review.");
  const secrets = release.achievementSecrets || [];
  if (secrets.length < 6 || ["basic","medium","advanced"].some(
    tier => secrets.filter(s => s.tier === tier).length < 2))
    problems.push("Six owner-authored release secrets (2 each tier) are required.");
  if (!Array.isArray(release.achievementRoster) || release.achievementRoster.length !== expected)
    problems.push("Frozen achievement roster does not match planned release size.");
  if (!achievementStartConfigured)
    problems.push("CARD_ACHIEVEMENTS_START_AT not configured. Do not activate before selecting the launch boundary.");
  const configuredGuilds = guilds.filter(g => g.hatchemChannelId && g.cardRoleId).length;
  if (!configuredGuilds)
    problems.push("No server has both a Hatchem channel and Card role configured.");
  return {
    releaseId: release.releaseId,
    status: release.status,
    expectedCards: expected,
    cardCount: cards.length,
    enabled,
    hatchable,
    rarityCounts,
    cardArtStatuses: artStatusCounts,
    petArtworkReview: artworkReviewCounts,
    externalArtistCardsExpected: expectedArtists.size,
    incompleteExternalLinks,
    customNeon,
    customMega,
    eggApproved: Boolean(egg && egg.licenseReviewStatus === "approved" &&
      String(egg.fileId) === String(release.eggImageFileId)),
    privateSecretsConfigured: secrets.length,
    frozenAchievementDesignCount: release.achievementRoster?.length || 0,
    achievementStartConfigured,
    configuredHatchemGuilds: configuredGuilds,
    gate: problems.length ? "NOT READY" : "DATABASE GATES PASS — MANUAL DISCORD TESTS STILL REQUIRED",
    problems: [...new Set(problems)],
  };
}
