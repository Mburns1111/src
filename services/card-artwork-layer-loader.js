import { loadCardArtwork } from "./card-artwork-assets.js";

/**
 * Resolve a card's artwork at render time. Never change stored CardCopy identity
 * when an owner replaces provisional art on the same CardDefinition.
 * Missing optional layer keys are supported for legacy releases.
 */
export async function loadCardPresentationAssets({ definition, release, upgradeLevel = "normal" }) {
  const rarityKey = release?.cardRarityFrameKeys?.[definition?.rarity] || "";
  const stageKey = upgradeLevel === "neon" || upgradeLevel === "mega"
    ? release?.cardStageOverlayKeys?.[upgradeLevel] || "" : "";
  const [pet, background, frame, rarityFrame, stageOverlay] = await Promise.all([
    loadCardArtwork(definition?.petArtworkKey, "pet"),
    loadCardArtwork(release?.cardBackgroundKey, "background"),
    loadCardArtwork(release?.cardFrameKey, "frame"),
    loadCardArtwork(rarityKey, "frame"),
    loadCardArtwork(stageKey, "frame"),
  ]);
  return {
    petImageSource: pet?.bytes || null,
    backgroundImageSource: background?.bytes || null,
    frameImageSource: frame?.bytes || null,
    rarityFrameImageSource: rarityFrame?.bytes || null,
    stageOverlayImageSource: stageOverlay?.bytes || null,
  };
}
