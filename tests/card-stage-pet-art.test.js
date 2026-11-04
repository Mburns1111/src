import test from "node:test";
import assert from "node:assert/strict";
import CardDefinition from "../models/CardDefinition.js";
import { data as ownerCommands, cardsReleaseCommand } from "../commands/cards-owner.js";
import { selectedCardPetArt, CARD_ALTERNATE_ART_STAGES } from "../services/card-pet-art-stages.js";
import { cardArtistDestination } from "../services/card-artist-links.js";

const def = {
  petArtworkKey: "s1-r1-pet-lamb-v1",
  artistCredit: "jovyisweird",
  artistUrl: "https://www.reddit.com/user/InformalPrinciple834/",
  artSourceUrl: "https://www.reddit.com/r/AdoptMeRBX/comments/normal/",
  stagePetArtworkKeys: {
    neon: "s1-r1-pet-lamb-neon-v1",
    mega: "s1-r1-pet-lamb-mega-v1",
  },
};

test("normal, Neon and Mega can all use different illustration assets", () => {
  assert.deepEqual(selectedCardPetArt(def, "normal"), {
    key: "s1-r1-pet-lamb-v1", override: false, stage: "normal",
  });
  assert.deepEqual(selectedCardPetArt(def, "neon"), {
    key: "s1-r1-pet-lamb-neon-v1", override: true, stage: "neon",
  });
  assert.deepEqual(selectedCardPetArt(def, "mega"), {
    key: "s1-r1-pet-lamb-mega-v1", override: true, stage: "mega",
  });
  assert.deepEqual(CARD_ALTERNATE_ART_STAGES, ["neon", "mega"]);
});

test("missing Neon/Mega illustrations fall back to normal art without needing a migration", () => {
  const oldCard = { petArtworkKey: "old-card" };
  for (const stage of ["normal", "neon", "mega"]) {
    assert.equal(selectedCardPetArt(oldCard, stage).key, "old-card");
    assert.equal(selectedCardPetArt(oldCard, stage).override, false);
  }
  const neonOnly = { petArtworkKey: "base", stagePetArtworkKeys: { neon: "alternate" } };
  assert.equal(selectedCardPetArt(neonOnly, "neon").key, "alternate");
  assert.equal(selectedCardPetArt(neonOnly, "mega").key, "base");
  assert.equal(selectedCardPetArt(neonOnly, "normal").key, "base");
});

test("stage-illustration fields are optional and separate from the shared stage overlays", () => {
  assert.ok(CardDefinition.schema.path("petArtworkKey"));
  assert.ok(CardDefinition.schema.path("stagePetArtworkKeys.neon"));
  assert.ok(CardDefinition.schema.path("stagePetArtworkKeys.mega"));
  assert.equal(CardDefinition.schema.path("stagePetArtworkKeys.neon").options.default, "");
  assert.equal(CardDefinition.schema.path("stagePetArtworkKeys.mega").options.default, "");
  const copy = new CardDefinition({ releaseId: "s1-r1", seriesId: "s1", petId: "lamb", rarity: "Ultra-Rare" });
  assert.equal(copy.stagePetArtworkKeys.neon, "");
  assert.equal(copy.stagePetArtworkKeys.mega, "");
});

test("a different Neon artist is linked and credited, never the normal artist", () => {
  const neonArtist = {
    artistCredit: "Neon Artist",
    artistUrl: "https://www.example.org/neon-artist",
    sourceUrl: "https://www.example.org/neon-artwork",
  };
  const destination = cardArtistDestination(def, neonArtist, { alternate: true });
  assert.equal(destination.url, neonArtist.sourceUrl);
  assert.equal(destination.credit, "Neon Artist");
  assert.equal(destination.isOriginal, true);
  assert.notEqual(destination.url, def.artSourceUrl);
  // New art with no URL may still be shown with a credit; do not
  // falsely link that artist to the older image's author.
  assert.equal(cardArtistDestination(def, { artistCredit: "Neon Artist" }, { alternate: true }), null);
});

test("owner can choose an approved stage illustration or clear it back to Normal", () => {
  const cmds = ownerCommands.toJSON().options;
  const assigned = cmds.find(c => c.name === "set-stage-art");
  const cleared = cmds.find(c => c.name === "clear-stage-art");
  assert.ok(assigned);
  assert.ok(cleared);
  assert.deepEqual(assigned.options.find(o => o.name === "stage").choices.map(o => o.value), ["neon","mega"]);
  assert.ok(assigned.options.find(o => o.name === "key").required);
  assert.ok(cleared.options.find(o => o.name === "pet").required);
  const publicReleaseControls = cardsReleaseCommand.options.map(o => o.name);
  assert.ok(publicReleaseControls.includes("set-stage-art"));
  assert.ok(publicReleaseControls.includes("clear-stage-art"));
});
