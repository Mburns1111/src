import test from "node:test";
import assert from "node:assert/strict";
import { planSeries1ArtistFiles, SERIES1_ARTIST_PETS } from "../services/card-series1-artist-pack.js";

const allFilenames = SERIES1_ARTIST_PETS.map(item => item.name + ".png");

test("artist artwork import has 20 explicitly credited pets, no shared layers", () => {
  assert.equal(SERIES1_ARTIST_PETS.length, 20);
  const result = planSeries1ArtistFiles(allFilenames);
  assert.equal(result.length, 20);
  assert.equal(new Set(result.map(item => item.petId)).size, 20);
  assert.deepEqual([...new Set(result.map(item => item.artistCredit))].sort(),
    ["jovyisweird", "αriαℓ"].sort());
  assert.equal(result.find(item => item.petId === "lamb")?.artistCredit, "jovyisweird");
  assert.equal(result.find(item => item.petId === "arctic-fox")?.artistCredit, "αriαℓ");
});

test("legacy Sheep and misspelled artic fox file names match the correct pets", () => {
  const filenames = allFilenames.map(name =>
    name === "Lamb.png" ? "Sheep.png" :
      name === "Arctic Fox.png" ? "artic fox.png" : name);
  const result = planSeries1ArtistFiles(filenames);
  assert.equal(result.find(item => item.petId === "lamb")?.filename, "Sheep.png");
  assert.equal(result.find(item => item.petId === "arctic-fox")?.filename, "artic fox.png");
});

test("art importer rejects both original and corrected Lamb files at once", () => {
  assert.throws(() => planSeries1ArtistFiles([...allFilenames, "Sheep.png"]), /Two PNGs refer to the same pet/);
});

test("art importer rejects missing pet PNG and unexpected shared frame assets", () => {
  assert.throws(() => planSeries1ArtistFiles(allFilenames.filter(name => name !== "Owl.png")), /missing Owl/);
  assert.throws(() => planSeries1ArtistFiles([...allFilenames, "common-basic.png"]), /Unexpected artist PNG/);
});
