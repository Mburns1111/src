import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import CardRelease from "../models/CardRelease.js";

const catalog = JSON.parse(readFileSync(new URL("../data/card-artwork-catalog.json", import.meta.url), "utf8"));

test("every artwork has a unique ID and links only to known artists", () => {
  assert.equal(catalog.schemaVersion, 1);
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
  assert.equal(art.creditText, "Image by stux from Pixabay");
  assert.equal(art.license.reviewStatus, "needs-review");
  assert.deepEqual(art.releaseIds, []);
});

test("egg release schema can reference an artwork without changing its image URL", () => {
  assert.ok(CardRelease.schema.path("eggArtworkId"));
  assert.ok(CardRelease.schema.path("eggImageUrl"));
  const release = new CardRelease({ releaseId: "test-release", seriesId: "test-series", name: "Test", eggName: "Test Egg" });
  assert.equal(release.eggArtworkId, "");
  assert.equal(release.eggImageUrl, "");
});
