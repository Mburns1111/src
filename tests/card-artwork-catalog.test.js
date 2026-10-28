import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import CardRelease from "../models/CardRelease.js";

const catalog = JSON.parse(readFileSync(new URL("../data/card-artwork-catalog.json", import.meta.url), "utf8"));
const softlambkinResearch = JSON.parse(readFileSync(new URL("../data/artist-research-softlambkin.json", import.meta.url), "utf8"));
const upperTradeResearch = JSON.parse(readFileSync(new URL("../data/artist-research-upper-trade-7110.json", import.meta.url), "utf8"));
const jovyResearch = JSON.parse(readFileSync(new URL("../data/artist-research-informalprinciple834.json", import.meta.url), "utf8"));

test("every artwork has a unique ID and links only to known artists", () => {
  assert.equal(catalog.schemaVersion, 2);
  const artistIds = catalog.artists.map(artist => artist.artistId);
  const artworkIds = catalog.artworks.map(art => art.artworkId);
  assert.equal(new Set(artistIds).size, artistIds.length);
  assert.equal(new Set(artworkIds).size, artworkIds.length);
  for (const art of catalog.artworks) {
    assert.ok(art.artworkId);
    assert.ok(art.creditText);
    assert.ok(Array.isArray(art.artistIds) && art.artistIds.length > 0);
    art.artistIds.forEach(id => assert.ok(artistIds.includes(id), `Unknown artist: ${id}`));
    assert.ok(art.source.name);
    assert.ok(art.source.imageId || art.source.imagePageUrl || art.file.localPath);
    assert.ok(["needs-review", "approved", "rejected"].includes(art.license.reviewStatus));
    assert.ok(Array.isArray(art.releaseIds));
    if (art.artworkType === "edited-composite") {
      assert.ok(Array.isArray(art.contributions) && art.contributions.length >= 2);
      for (const contribution of art.contributions) {
        assert.ok(art.artistIds.includes(contribution.artistId));
        assert.ok(contribution.role);
      }
    }
  }
});

test("the egg drop image records the provided stux/Pixabay attribution", () => {
  const art = catalog.artworks.find(entry => entry.artworkId === "egg-drop-001");
  const artist = catalog.artists.find(entry => entry.artistId === "pixabay-stux");
  assert.equal(art.kind, "egg-drop");
  assert.equal(artist.displayName, "stux");
  assert.equal(artist.profileUrl, "https://pixabay.com/users/stux-12364/");
  assert.equal(art.source.name, "Pixabay");
  assert.equal(art.source.imageId, "1255730");
  assert.equal(art.creditText, "Edited for AM Isa using artwork by stux from Pixabay.");
  assert.equal(art.artworkType, "edited-composite");
  assert.equal(art.sourceScope, "incorporated-artwork-only");
  assert.ok(art.artistIds.includes("pixabay-stux"));
  assert.ok(art.artistIds.includes("am-isa-project-owner"));
  assert.deepEqual(art.contributions.map(x => x.role), ["composition-and-editing", "incorporated-source-artwork"]);
  assert.equal(art.contributions[1].artistId, "pixabay-stux");
  assert.equal(art.license.reviewStatus, "needs-review");
  assert.deepEqual(art.releaseIds, ["release-1"]);
});

test("Release 1 has precisely one egg type and all release artwork references resolve", () => {
  assert.equal(catalog.releases.find(r => r.releaseId === "release-1").eggArtworkIds.length, 1);
  assert.deepEqual(catalog.releases.find(r => r.releaseId === "release-1").eggArtworkIds, ["egg-drop-001"]);
  const releases = new Map(catalog.releases.map(release => [release.releaseId, release]));
  assert.equal(releases.size, catalog.releases.length);
  const artworks = new Map(catalog.artworks.map(art => [art.artworkId, art]));
  for (const release of releases.values()) {
    assert.equal(new Set(release.eggArtworkIds).size, release.eggArtworkIds.length);
    for (const artId of release.eggArtworkIds) {
      assert.ok(artworks.has(artId), `Unknown egg artwork: ${artId}`);
      assert.ok(artworks.get(artId).releaseIds.includes(release.releaseId));
    }
  }
  for (const art of artworks.values()) {
    for (const releaseId of art.releaseIds) {
      assert.ok(releases.has(releaseId));
      assert.ok(releases.get(releaseId).eggArtworkIds.includes(art.artworkId));
    }
  }
});

test("egg release schema can reference an artwork without changing its image URL", () => {
  assert.ok(CardRelease.schema.path("eggArtworkId"));
  assert.ok(CardRelease.schema.path("eggImageUrl"));
  const release = new CardRelease({ releaseId: "test-release", seriesId: "test-series", name: "Test", eggName: "Test Egg" });
  assert.equal(release.eggArtworkId, "");
  assert.equal(release.eggImageUrl, "");
});

test("softlambkin artwork research preserves source links without publishing unreviewed art", () => {
  const artist = catalog.artists.find(a => a.artistId === "reddit-softlambkin");
  assert.ok(artist);
  assert.equal(artist.researchCatalogPath, "data/artist-research-softlambkin.json");
  assert.equal(softlambkinResearch.artistId, artist.artistId);
  assert.equal(softlambkinResearch.confirmedDrawings.length, 3);
  assert.deepEqual(
    [...new Set(softlambkinResearch.confirmedDrawings.flatMap(d => d.series1Matches))].sort(),
    ["Cute-A-Cabra", "Turtle", "Wolf"]
  );
  const ids = new Set();
  for (const entry of [...softlambkinResearch.confirmedDrawings, ...softlambkinResearch.completedButUnidentified]) {
    assert.ok(!ids.has(entry.researchId));
    ids.add(entry.researchId);
    assert.ok(entry.originalArtistReply.startsWith(softlambkinResearch.sourceThreadUrl.replace("/adopt_me_fanart_c/", "/comment/")));
  }
  const artistAssets = catalog.artworks.filter(a => a.artistIds.includes("reddit-softlambkin"));
  assert.equal(artistAssets.length, 1);
  assert.equal(artistAssets[0].kind, "general-artwork");
  assert.equal(artistAssets[0].petCardEligible, false);
  assert.deepEqual(artistAssets[0].releaseIds, []);
  assert.equal(artistAssets[0].license.reviewStatus, "needs-review");
});

test("submitted Reddit image URLs preserve provenance and verified/tentative identification", () => {
  const submitted = softlambkinResearch.submittedImageReview.images;
  assert.equal(submitted.length, 10);
  assert.equal(new Set(submitted.map(x => x.redditImageId)).size, 10);
  assert.equal(submitted.filter(x => x.postedBy === "softlambkin").length, 9);
  assert.equal(submitted.filter(x => x.postedBy !== "softlambkin").length, 1);
  const otherArtistImage = submitted.find(x => x.redditImageId === "zw2w9yz23lkg1");
  assert.equal(otherArtistImage.postedBy, "PhoenixTheTortoise");
  assert.equal(otherArtistImage.reviewStatus, "source-pet-reference-not-artist-illustration");
  assert.equal(otherArtistImage.petSpecies, "Turtle");
  assert.equal(softlambkinResearch.submittedImageReview.images.filter(x => x.petSpecies === "Strawberry Shortcake Bat Dragon").length, 2);
  assert.equal(softlambkinResearch.submittedImageReview.images.find(x => x.redditImageId === "ovz9uv3uykkg1").petSpecies, "Bunny Swirl");
  for (const image of submitted) {
    assert.ok(image.imageUrl.includes(image.redditImageId));
    assert.ok(image.speciesConfidence);
    assert.ok(image.reviewStatus);
    if (image.speciesConfidence === "tentative") {
      assert.equal(image.petSpecies, null, "Tentative image identities must not be accepted as confirmed");
      assert.ok(image.candidateSpecies.length >= 1);
    }
    if (image.petSpecies) assert.ok(["high"].includes(image.speciesConfidence));
  }
});

test("owner-reviewed pet identities and general-artwork exclusions stay distinct", () => {
  const images = new Map(softlambkinResearch.submittedImageReview.images.map(x => [x.redditImageId, x]));
  const expected = [
    ["ikg3l74flkkg1", "Arctic Fox", true, "owner-confirmed"],
    ["oup3bl978kkg1", "Canadian Goose", false, "owner-confirmed"],
    ["mnmid66l4kkg1", "Happy Duckling", true, "owner-selected-card-representation"],
    ["c28dvwz60kkg1", "Unicorn", true, "owner-confirmed"],
  ];
  for (const [id, petSpecies, series1Match, basis] of expected) {
    const item = images.get(id);
    assert.ok(item);
    assert.equal(item.petSpecies, petSpecies);
    assert.equal(item.series1Match, series1Match);
    assert.equal(item.speciesDecisionBasis, basis);
    assert.deepEqual(item.candidateSpecies, []);
  }
  const group = images.get("xdlpsxxahlkg1");
  assert.equal(group.petSpecies, null);
  assert.equal(group.excludeFromPetCards, true);
  assert.equal(group.artUsage, "general-artwork-unassigned");
  const general = catalog.artworks.find(art => art.artworkId === group.generalArtworkId);
  assert.ok(general);
  assert.equal(general.source.imageId, group.redditImageId);
  assert.equal(general.kind, "general-artwork");
  assert.equal(general.petCardEligible, false);
  assert.equal(general.petId, null);
  assert.equal(general.usageStatus, "reserved-for-future-general-use");
  assert.deepEqual(general.releaseIds, []);
  assert.equal(catalog.releases.find(release => release.releaseId === "release-1").eggArtworkIds.length, 1);
  assert.ok(!catalog.releases[0].eggArtworkIds.includes(general.artworkId));
});

test("owner-skipped Glum-Factor3313 artwork is excluded from candidates", () => {
  const skippedId = "urkhhed6ujkg1";
  const img = softlambkinResearch.submittedImageReview.images.find(x => x.redditImageId === skippedId);
  assert.ok(img);
  assert.equal(img.reviewStatus, "skipped-by-project-owner");
  assert.equal(img.excludeFromPetCards, true);
  assert.equal(img.artUsage, "excluded");
  assert.equal(img.petSpecies, null);
  assert.equal(img.series1Match, false);
  assert.ok(softlambkinResearch.ownerDecisions.skippedArtworks.some(x => x.redditImageId === skippedId));
  assert.equal(softlambkinResearch.completedButUnidentified.length, 0);
  assert.equal(catalog.artworks.some(x => x.source?.imageId === skippedId), false);
});

test("Upper-Trade-7110's permission and art are tracked without publication approval", () => {
  const artist = catalog.artists.find(x => x.artistId === "reddit-upper-trade-7110");
  assert.ok(artist);
  assert.equal(artist.displayName, "Upper-Trade-7110");
  assert.equal(artist.platform, "Reddit");
  assert.equal(artist.permission.status, "reported-by-project-owner");
  assert.equal(catalog.artworks.filter(x => x.artistIds.includes(artist.artistId)).length, 4);
});

test("Upper-Trade-7110 artwork sources are deduplicated and tracked as candidates", () => {
  const sourceImages = upperTradeResearch.imageSources;
  assert.equal(sourceImages.length, 4);
  assert.equal(new Set(sourceImages.map(x => x.redditMediaId)).size, 4);
  assert.equal(new Set(sourceImages.map(x => x.artworkId)).size, 4);
  assert.equal(upperTradeResearch.uploadedPhotoReferences.length, 4);
  const ids = ["8vey8mer4hhh1", "z7qc4ner4hhh1", "vvhp1rer4hhh1", "bhippqer4hhh1"];
  assert.deepEqual(sourceImages.map(x => x.redditMediaId), ids);
  for (const image of sourceImages) {
    const artwork = catalog.artworks.find(x => x.artworkId === image.artworkId);
    assert.ok(artwork);
    assert.deepEqual(artwork.artistIds, ["reddit-upper-trade-7110"]);
    assert.equal(artwork.source.imageId, image.redditMediaId);
    assert.equal(artwork.source.providedAttributionUrl, image.previewUrl);
    assert.equal(artwork.license.reviewStatus, "needs-review");
    assert.deepEqual(artwork.releaseIds, []);
    assert.deepEqual(artwork.series1PetMatches, image.series1Matches);
    assert.equal(artwork.imageStatus, "source-reference-needs-crop-and-review");
  }
  const hedgehog = catalog.artworks.find(x => x.artworkId === "uppertrade-hedgehog-001");
  assert.deepEqual(hedgehog.series1PetMatches, ["Hedgehog"]);
  assert.equal(catalog.artworks.filter(x => x.source.imageId === "bhippqer4hhh1").length, 1);
  const firstPhoto = upperTradeResearch.uploadedPhotoReferences.find(x => x.uploadName === "image(20261028-214740).png");
  assert.equal(firstPhoto.confirmedPetSpecies, null);
  assert.equal(catalog.releases.find(x => x.releaseId === "release-1").eggArtworkIds.length, 1);
});

test("jovyisweird's permission is recorded under their Reddit username", () => {
  const artist = catalog.artists.find(x => x.artistId === "reddit-informalprinciple834");
  assert.ok(artist);
  assert.equal(artist.displayName, "jovyisweird");
  assert.equal(artist.platformUsername, "InformalPrinciple834");
  assert.equal(artist.profileUrl, "https://www.reddit.com/user/InformalPrinciple834/");
  assert.equal(artist.permission.status, "reported-by-project-owner");
  assert.equal(catalog.artworks.filter(x => x.artistIds.includes(artist.artistId)).length, 18);
});

test("jovyisweird uploaded artwork index has complete credits and distinct entries", () => {
  assert.equal(jovyResearch.artistId, "reddit-informalprinciple834");
  assert.equal(jovyResearch.images.length, 18);
  assert.equal(new Set(jovyResearch.images.map(x => x.artworkId)).size, 18);
  assert.equal(new Set(jovyResearch.images.map(x => x.submittedFileName)).size, 18);
  for (const image of jovyResearch.images) {
    const art = catalog.artworks.find(a => a.artworkId === image.artworkId);
    assert.ok(art, `Unregistered artwork: ${image.artworkId}`);
    assert.deepEqual(art.artistIds, ["reddit-informalprinciple834"]);
    assert.ok(art.creditText.includes("jovyisweird"));
    assert.equal(art.uploadReference.fileName, image.submittedFileName);
    assert.equal(art.uploadReference.storedInRepository, false);
    assert.equal(art.file.localPath, null);
    assert.equal(art.license.reviewStatus, "needs-review");
    assert.deepEqual(art.releaseIds, []);
    assert.deepEqual(art.series1PetMatches, image.series1Match ? [image.identifiedSubject] : []);
  }
  assert.deepEqual(
    jovyResearch.images.filter(x => x.series1Match).map(x => x.identifiedSubject).sort(),
    ["Lamb", "Lion", "Otter", "Owl", "Unicorn"]
  );
  assert.equal(jovyResearch.images.filter(x => x.originalRedditPostUrl !== null).length, 14);
  const owl = jovyResearch.images.find(x => x.identifiedSubject === "Owl");
  const cupidOwl = jovyResearch.images.find(x => x.identifiedSubject === "Cupid Owl");
  assert.equal(owl.series1Match, true);
  assert.equal(cupidOwl.series1Match, false);
  assert.equal(jovyResearch.images.find(x => x.identifiedSubject.includes("Mecha Rabbit")).series1Match, false);
  assert.equal(jovyResearch.images.find(x => x.identifiedSubject.includes("Unidentified")).series1Match, null);
  assert.deepEqual(catalog.releases.find(x => x.releaseId === "release-1").eggArtworkIds, ["egg-drop-001"]);
});

test("owner-confirmed jovy Vampire Dragon is attributed and not in Series 1", () => {
  const id = "jovy-vampire-dragon-redesign-001";
  const art = catalog.artworks.find(x => x.artworkId === id);
  assert.ok(art);
  assert.deepEqual(art.artistIds, ["reddit-informalprinciple834"]);
  assert.equal(art.source.imagePageUrl, "https://www.reddit.com/r/AdoptMeRBX/comments/18kzu0h/my_vampire_dragon_redesign_fanart/");
  assert.deepEqual(art.depictedPets, ["Vampire Dragon"]);
  assert.deepEqual(art.series1PetMatches, []);
  assert.equal(art.license.reviewStatus, "needs-review");
  assert.deepEqual(art.releaseIds, []);
  assert.ok(jovyResearch.images.some(x => x.artworkId === id && x.identificationBasis === "direct-project-owner-confirmation"));
  assert.ok(!catalog.attributionPending.some(x => x.candidateId === "pending-vampire-dragon-redesign-001"));
  assert.ok(!jovyResearch.unverifiedAttributionLeads.some(x => x.petSpecies === "Vampire Dragon"));
});

test("3yberpunks8 Princess Mare permission is recorded for the specific artwork", () => {
  const artist = catalog.artists.find(x => x.artistId === "reddit-3yberpunks8");
  assert.ok(artist);
  assert.equal(artist.displayName, "3yberpunks8");
  assert.equal(artist.permission.status, "reported-by-project-owner");
  assert.ok(artist.permission.scope.includes("Princess Mare"));
  const art = catalog.artworks.find(x => x.artworkId === "3yberpunks8-princess-mare-001");
  assert.ok(art);
  assert.deepEqual(art.artistIds, [artist.artistId]);
  assert.equal(art.source.imagePageUrl, "https://www.reddit.com/r/AdoptMeRBX/comments/1w7vzbv/princess_mare_fanart/");
  assert.deepEqual(art.depictedPets, ["Princess Mare"]);
  assert.deepEqual(art.series1PetMatches, []);
  assert.deepEqual(art.releaseIds, []);
  assert.equal(art.license.reviewStatus, "needs-review");
  assert.equal(art.uploadReference.storedInRepository, false);
  assert.deepEqual(catalog.releases.find(x => x.releaseId === "release-1").eggArtworkIds, ["egg-drop-001"]);
});
