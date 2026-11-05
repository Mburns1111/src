import test from "node:test";
import assert from "node:assert/strict";
import { planSeries1OwnerArtCredit } from "../services/card-series1-owner-credit-plan.js";
import { SERIES1_ARTIST_PETS } from "../services/card-series1-artist-pack.js";

const release = {
  releaseId: "s1-r1", status: "draft",
  cardBackgroundKey: "s1-r1-bg",
  cardFrameKey: "s1-r1-frame",
  cardRarityFrameKeys: { Common: "s1-r1-rarity-common" },
  cardStageOverlayKeys: { neon: "s1-r1-neon", mega: "s1-r1-mega" },
};
const ownerCards = Array.from({ length: 88 }, (_, i) => ({
  _id: "owner"+i, petId: "owned-pet-"+i,
  petArtworkKey: "s1-r1-pet-owned-pet-"+i+"-v1",
  artistCredit: "", artStatus: "pending", enabled: false,
}));
const externalCards = SERIES1_ARTIST_PETS.map((pet, i) => ({
  _id: "guest"+i, petId: pet.petId,
  petArtworkKey: "s1-r1-pet-"+pet.petId+"-v1",
  artistCredit: pet.artistCredit,
  artistUrl: pet.artistUrl, artStatus: "pending", enabled: false,
}));
const baseArt = [
  ...ownerCards.map(card => ({
    _id: "asset-"+card._id, key: card.petArtworkKey,
    kind: "pet", artistCredit: "", licenseReviewStatus: "needs-review",
  })),
  ...externalCards.map(card => ({
    _id: "asset-"+card._id, key: card.petArtworkKey, kind: "pet",
    artistCredit: card.artistCredit, artistUrl: card.artistUrl,
    licenseReviewStatus: "needs-review",
  })),
  ...["s1-r1-bg","s1-r1-frame","s1-r1-rarity-common","s1-r1-neon","s1-r1-mega"].map(key => ({
    _id: "asset-"+key, key, kind: key.endsWith("bg") ? "background" : "frame",
    artistCredit: "", licenseReviewStatus: "needs-review",
  })),
];
const example = () => ({
  release, definitions: [...ownerCards, ...externalCards], artworks: baseArt, credit: "Lilly",
});

test("prepares only 88 owner pets and assigned shared layers, leaving 20 guest artists untouched", () => {
  const result = planSeries1OwnerArtCredit(example());
  assert.equal(result.ownerCardCount, 88);
  assert.equal(result.importedExternalCount, 20);
  assert.equal(result.cardsToUpdate.length, 88);
  assert.equal(result.artworkToUpdate.length, 93);
  assert.ok(result.artworkToUpdate.every(asset => !externalCards.some(card => card.petArtworkKey === asset.key)));
});

test("re-running with already correctly credited art has zero proposed changes", () => {
  const data = example();
  data.definitions = data.definitions.map(card =>
    card.petId.startsWith("owned-pet") ? { ...card, artistCredit: "Lilly" } : card);
  data.artworks = data.artworks.map(art =>
    art.artistCredit === "" ? { ...art, artistCredit: "Lilly" } : art);
  const result = planSeries1OwnerArtCredit(data);
  assert.equal(result.cardsToUpdate.length, 0);
  assert.equal(result.artworkToUpdate.length, 0);
});

test("never guesses credit if any owned artwork has existing external source information", () => {
  const data = example();
  data.artworks = data.artworks.map(art => art.key === ownerCards[0].petArtworkKey
    ? { ...art, artistUrl:"https://reddit.com/u/differentArtist" } : art);
  assert.throws(() => planSeries1OwnerArtCredit(data), /external-source metadata/);
});

test("refuses to overwrite already credited third-party artwork or published releases", () => {
  const data = example();
  data.definitions = data.definitions.map(card => card.petId===ownerCards[0].petId
    ? { ...card, artistCredit: "Someone Else" } : card);
  assert.throws(() => planSeries1OwnerArtCredit(data), /different artist credit/);
  assert.throws(() => planSeries1OwnerArtCredit({...example(),release:{...release,status:"active"}}),/real draft/);
});

test("refuses incomplete or changed 108-card roster and missing stage frame asset", () => {
  assert.throws(() => planSeries1OwnerArtCredit({
    ...example(),definitions:[...ownerCards,...externalCards.slice(1)],
  }),/exactly 108 unique/);
  assert.throws(() => planSeries1OwnerArtCredit({
    ...example(), artworks:baseArt.filter(a=>a.key!=="s1-r1-neon"),
  }),/Missing shared/);
});
