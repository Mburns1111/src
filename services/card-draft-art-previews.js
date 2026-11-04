import CardDefinition from "../models/CardDefinition.js";
import CardRelease from "../models/CardRelease.js";
import CardSeries from "../models/CardSeries.js";
import PetCatalog from "../models/PetCatalog.js";
import { loadCardPresentationAssets } from "./card-artwork-layer-loader.js";
import { loadStoredReleaseEggImage } from "./card-egg-artwork.js";
import { renderCollectibleCardPreview } from "./card-preview-renderer.js";
import { renderThreeCardDropImage } from "./card-drop-renderer.js";

const RARITY_ORDER = ["Common", "Ultra-Rare", "Legendary", "Uncommon", "Rare"];

/**
 * Deterministic owner previews favor cards with artwork already assigned and
 * show a range of rarities. Does not roll hatches, reserve supply or mint IDs.
 */
export function selectReleasePreviewCards(definitions, count = 3) {
  if (!Array.isArray(definitions) || !Number.isInteger(count) || count < 1)
    throw new Error("Invalid draft card preview selection.");
  const sorted = [...definitions].sort((a, b) =>
    Number(Boolean(b.petArtworkKey)) - Number(Boolean(a.petArtworkKey)) ||
    RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) ||
    String(a.petId).localeCompare(String(b.petId))
  );
  const chosen = [];
  const rarities = new Set();
  for (const definition of sorted) {
    if (chosen.length >= count) break;
    if (rarities.has(definition.rarity)) continue;
    chosen.push(definition);
    rarities.add(definition.rarity);
  }
  for (const definition of sorted) {
    if (chosen.length >= count) break;
    if (!chosen.includes(definition)) chosen.push(definition);
  }
  return chosen;
}

async function draftRelease(releaseId) {
  const release = await CardRelease.findOne({ releaseId: String(releaseId || "").trim() }).lean();
  if (!release) throw new Error("Release not found.");
  if (release.status !== "draft") throw new Error("The artwork preview is for draft releases only.");
  if (release.releaseId.startsWith("test-")) throw new Error("Choose the actual draft release, not the test fixture.");
  return release;
}

async function cardPresentation(release, definition, petNames, upgradeLevel = "normal") {
  const assets = await loadCardPresentationAssets({ definition, release, upgradeLevel });
  return {
    petName: petNames.get(definition.petId) || definition.petId,
    rarity: definition.rarity,
    artStatus: definition.artStatus,
    artistCredit: definition.artistCredit,
    artUrl: definition.artUrl,
    ...assets,
  };
}

/**
 * Read-only previews of REAL draft release artwork, never a simulated drop.
 * No CardCopy, CardDrop, CardClaim, cooldown, Points or achievement writes.
 */
export async function previewOfficialDraftCard({ releaseId, petId, upgradeLevel = "normal" }) {
  if (!["normal", "neon", "mega"].includes(upgradeLevel)) throw new Error("Invalid preview stage.");
  const release = await draftRelease(releaseId);
  const definition = await CardDefinition.findOne({
    releaseId: release.releaseId, petId: String(petId || "").trim(),
  }).lean();
  if (!definition) throw new Error("That pet is not assigned to this draft release.");
  const [pet, series] = await Promise.all([
    PetCatalog.findOne({ petId: definition.petId }).select("name").lean(),
    CardSeries.findOne({ seriesId: release.seriesId }).select("name").lean(),
  ]);
  const info = await cardPresentation(release, definition, new Map([[definition.petId, pet?.name || definition.petId]]), upgradeLevel);
  const png = await renderCollectibleCardPreview({
    ...info, releaseName: release.name, seriesName: series?.name || release.seriesId,
    upgradeLevel, dropMode: false,
  });
  return { png, petName: info.petName, releaseName: release.name, hasAssignedArt: Boolean(definition.petArtworkKey) };
}

export async function previewOfficialDraftDrop({ releaseId }) {
  const release = await draftRelease(releaseId);
  const definitions = await CardDefinition.find({ releaseId: release.releaseId }).lean();
  if (definitions.length < 3) throw new Error("Add at least three pets to this draft release to preview a three-card layout.");
  const chosen = selectReleasePreviewCards(definitions, 3);
  const [series, pets, eggImageSource] = await Promise.all([
    CardSeries.findOne({ seriesId: release.seriesId }).select("name").lean(),
    PetCatalog.find({ petId: { $in: chosen.map(c => c.petId) } }).select("petId name").lean(),
    release.eggImageFileId ? loadStoredReleaseEggImage(release) : Promise.resolve(null),
  ]);
  const names = new Map(pets.map(p => [p.petId, p.name]));
  const cards = await Promise.all(chosen.map(definition => cardPresentation(release, definition, names)));
  const png = await renderThreeCardDropImage({
    releaseName: release.name, seriesName: series?.name || release.seriesId,
    eggImageSource, cards,
  });
  return { png, petNames: cards.map(card => card.petName), releaseName: release.name };
}
