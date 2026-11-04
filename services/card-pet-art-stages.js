// Pet artwork is a separate, optional override for each upgraded stage.
// It does NOT replace the release-wide Neon/Mega decoration overlays.
export const CARD_PET_ART_STAGES = Object.freeze(["normal", "neon", "mega"]);
export const CARD_ALTERNATE_ART_STAGES = Object.freeze(["neon", "mega"]);

export function selectedCardPetArt(definition, upgradeLevel = "normal") {
  const stage = CARD_PET_ART_STAGES.includes(upgradeLevel) ? upgradeLevel : "normal";
  const alternateKey = stage === "normal" ? "" :
    String(definition?.stagePetArtworkKeys?.[stage] || "").trim();
  return {
    key: alternateKey || String(definition?.petArtworkKey || "").trim(),
    override: Boolean(alternateKey),
    stage,
  };
}
