import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import CardRelease from "../models/CardRelease.js";

const catalog = JSON.parse(readFileSync(new URL("../data/card-artwork-catalog.json", import.meta.url), "utf8"));

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
