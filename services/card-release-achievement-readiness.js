import { CARD_ACHIEVEMENTS, SECRET_ACHIEVEMENTS } from "./card-achievement-catalog.js";

const TIERS = ["basic", "medium", "advanced"];
const METRICS = ["acquiredDesigns", "ownedDesigns", "neonDesigns", "megaDesigns"];
// Stable anonymous slots; exact titles, pet solutions and triggers stay private.
export const SERIES1_REQUIRED_SECRET_KEYS = Object.freeze(
  Array.from({length:6},(_,i)=>"s1-secret-"+String(i+1).padStart(2,"0")),
);
const id = value => String(value ?? "");
const isTimestamp = value => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(new Date(value).getTime());

/**
 * Pure release-achievement preflight. Secret details are never returned in
 * diagnostics: admins can safely run the audit in a shared console.
 *
 * During initial secret authoring, use requireFrozen:false and
 * checkLaunchBoundary:false. Activation always requires both.
 */
export function inspectReleaseAchievementReadiness({
  release, definitions = [], secrets = release?.achievementSecrets || [],
  requireFrozen = true, checkLaunchBoundary = true, requireValueReviews = true,
  launchBoundary = process.env.CARD_ACHIEVEMENTS_START_AT,
} = {}) {
  const problems = [];
  const warnings = [];
  const actual = definitions.filter(d => d.enabled && d.artStatus === "approved" && Number(d.hatchWeight) > 0);
  const availableIds = new Set(actual.map(d => id(d._id)));
  const roster = Array.isArray(release?.achievementRoster) ? release.achievementRoster.map(id) : [];
  if (!release?.releaseId || release?.status !== "draft")
    problems.push("Achievement configuration requires an official draft release.");
  if (release?.releaseId?.startsWith("test-"))
    problems.push("Test release achievements cannot be configured for official launch.");
  if (!actual.length)
    problems.push("No enabled, approved card definitions to freeze for achievements.");
  if (release?.releaseId === "s1-r1" && (definitions.length !== 108 || actual.length !== 108))
    problems.push("Series 1 achievement roster must contain exactly 108 enabled and approved cards.");
  if (requireFrozen && !roster.length)
    problems.push("Frozen achievement completion roster is missing.");
  if (roster.length &&
      (new Set(roster).size !== roster.length || roster.length !== availableIds.size ||
       roster.some(value => !availableIds.has(value))))
    problems.push("Frozen achievement completion roster differs from the enabled release cards.");
  if (!Array.isArray(secrets) || secrets.length < 6)
    problems.push("At least six owner-authored release secrets are required.");
  const keys = new Set();
  const tiers = { basic: 0, medium: 0, advanced: 0 };
  for (const [index, secret] of (Array.isArray(secrets) ? secrets : []).entries()) {
    const key = id(secret?.key).trim();
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(key) || keys.has(key))
      problems.push("Release secret #" + (index + 1) + " needs a unique, stable key.");
    keys.add(key);
    if (!id(secret?.name).trim() || !id(secret?.description).trim())
      problems.push("Release secret #" + (index + 1) + " needs its private name and full explanation.");
    if (!TIERS.includes(secret?.tier))
      problems.push("Release secret #" + (index + 1) + " has an unsupported reward tier.");
    else tiers[secret.tier]++;
    if (!METRICS.includes(secret?.metric))
      problems.push("Release secret #" + (index + 1) + " has an unsupported progress metric.");
    const required = secret?.definitionIds;
    if (!Array.isArray(required) || !required.length ||
        new Set(required.map(id)).size !== required.length ||
        required.some(value => !availableIds.has(id(value))))
      problems.push("Release secret #" + (index + 1) + " must reference distinct, approved release-card IDs.");
    if (typeof secret?.activeOnly !== "boolean")
      problems.push("Release secret #" + (index + 1) + " must explicitly declare its availability policy.");
  }
  for (const tier of TIERS)
    if (tiers[tier] < 2) problems.push("Release needs at least two " + tier + " secrets.");
  if (release?.releaseId === "s1-r1" &&
      SERIES1_REQUIRED_SECRET_KEYS.some(key => !keys.has(key)))
    problems.push("Series 1 must retain all six approved anonymous secret slots.");
  const reviewed = actual.filter(d =>
    Number.isFinite(d.valueReview?.valueScore) &&
    id(d.valueReview?.sourceName).trim() &&
    d.valueReview?.checkedAt &&
    Number.isFinite(new Date(d.valueReview.checkedAt).getTime()));
  if (requireValueReviews && release?.releaseId === "s1-r1" && reviewed.length < 20)
    problems.push("Reviewed-value achievements need at least 20 source-dated value reviews in Series 1.");
  if (reviewed.length < actual.length)
    warnings.push("Some approved cards lack reviewed-value metadata; value-ranking achievements cover only reviewed cards.");
  if (checkLaunchBoundary && !isTimestamp(launchBoundary))
    problems.push("CARD_ACHIEVEMENTS_START_AT must be set to an explicit ISO timestamp with timezone before activation.");
  return {
    globalNamedAchievements: CARD_ACHIEVEMENTS.length + SECRET_ACHIEVEMENTS.length,
    permanentSecrets: SECRET_ACHIEVEMENTS.length,
    releaseSecrets: Array.isArray(secrets) ? secrets.length : 0,
    frozenRosterCount: roster.length,
    enabledRosterCount: actual.length,
    reviewedValueCards: reviewed.length,
    problems: [...new Set(problems)],
    warnings,
  };
}
