import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import CardRelease from "../models/CardRelease.js";

const catalog = JSON.parse(readFileSync(new URL("../data/card-artwork-catalog.json", import.meta.url), "utf8"));
const softlambkinResearch = JSON.parse(readFileSync(new URL("../data/artist-research-softlambkin.json", import.meta.url), "utf8"));

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
  assert.equal(catalog.artworks.filter(a => a.artistIds.includes("reddit-softlambkin")).length, 0, "Research references must not auto-publish artwork");
});

test("submitted Reddit image URLs preserve author attribution and do not invent species", () => {
  const submitted = softlambkinResearch.submittedImageReview.images;
  assert.equal(submitted.length, 10);
  assert.equal(new Set(submitted.map(x => x.redditImageId)).size, 10);
  assert.equal(submitted.filter(x => x.postedBy === "softlambkin").length, 9);
  assert.equal(submitted.filter(x => x.postedBy !== "softlambkin").length, 1);
  const otherArtistImage = submitted.find(x => x.redditImageId === "zw2w9yz23lkg1");
  assert.equal(otherArtistImage.postedBy, "PhoenixTheTortoise");
  assert.equal(otherArtistImage.reviewStatus, "other-artist-do-not-credit-softlambkin");
  for (const image of submitted) {
    assert.ok(image.imageUrl.includes(image.redditImageId));
    assert.equal(image.petSpecies, null, "Do not infer species from inaccessible image");
    assert.ok(image.reviewStatus.includes("identification") || image.reviewStatus.includes("other-artist"));
  }
});
