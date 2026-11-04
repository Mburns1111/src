import { loadCardArtwork } from "./card-artwork-assets.js";
import { selectedCardPetArt } from "./card-pet-art-stages.js";

/**
 * Resolve a card's artwork at render time. Never change stored CardCopy identity
 * when an owner replaces provisional art on the same CardDefinition.
 * Missing optional layer keys are supported for legacy releases.
 */
export async function loadCardPresentationAssets({ definition, release, upgradeLevel = "normal" }) {
  const rarityKey = release?.cardRarityFrameKeys?.[definition?.rarity] || "";
  const stageKey = upgradeLevel === "neon" || upgradeLevel === "mega"
    ? release?.cardStageOverlayKeys?.[upgradeLevel] || "" : "";
  const selected = selectedCardPetArt(definition, upgradeLevel);
  const [pet, background, frame, rarityFrame, stageOverlay] = await Promise.all([
    loadCardArtwork(selected.key, "pet"),
    loadCardArtwork(release?.cardBackgroundKey, "background"),
    loadCardArtwork(release?.cardFrameKey, "frame"),
    loadCardArtwork(rarityKey, "frame"),
    loadCardArtwork(stageKey, "frame"),
  ]);
  return {
    petImageSource: pet?.bytes || null,
    displayArtistCredit: selected.override ? pet?.artwork?.artistCredit || "" : pet?.artwork?.artistCredit || definition?.artistCredit || "",
    backgroundImageSource: background?.bytes || null,
    frameImageSource: frame?.bytes || null,
    rarityFrameImageSource: rarityFrame?.bytes || null,
    stageOverlayImageSource: stageOverlay?.bytes || null,
  };
}
