import test from "node:test";
import assert from "node:assert/strict";
import PetCatalog from "../models/PetCatalog.js";
import {
  petIdFromName, preparePetCatalogRow, preparePetCatalogImport, parsePetCatalogCsv,
} from "../services/pet-catalog-import.js";

test("pet catalogue is global and does not store card supply or images", () => {
  assert.equal(PetCatalog.schema.path("petId").options.unique, true);
  assert.equal(PetCatalog.schema.path("guildId"), undefined);
  assert.equal(PetCatalog.schema.path("totalCopies"), undefined);
  assert.equal(PetCatalog.schema.path("imageUrl"), undefined);
});

test("normalize pet name, rarity, release details and provenance", () => {
  const row = preparePetCatalogRow({
    name: "  Frost   Dragon ", rarity: "legendary", releaseYear: "2019",
    releaseEvent: "Winter 2019", sourceName: "Staff verified",
  });
  assert.equal(row.petId, "frost-dragon");
  assert.equal(row.rarity, "Legendary");
  assert.equal(row.releaseYear, 2019);
  assert.equal(row.reviewStatus, "pending");
  assert.equal(row.sources[0].name, "Staff verified");
  assert.equal(petIdFromName("Lunar White Tiger"), "lunar-white-tiger");
});

test("detect duplicates and invalid rows without dropping valid entries", () => {
  const result = preparePetCatalogImport([
    { name: "Cow", rarity: "Rare" },
    { name: "Cow", rarity: "Rare" },
    { name: "Test", rarity: "Mythic" },
    { name: "Cat", rarity: "Common" },
  ]);
  assert.equal(result.accepted.length, 2);
  assert.equal(result.rejected.length, 2);
  assert.match(result.rejected[0].reason, /Duplicate/);
});

test("CSV parsing handles quoted commas and escaped quotes", () => {
  const csv = 'name,rarity,releaseEvent\n"Example, Pet",Rare,"The ""Example"" Event"\nCat,Common,';
  const rows = parsePetCatalogCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Example, Pet");
  assert.equal(rows[0].releaseEvent, 'The "Example" Event');
  assert.equal(preparePetCatalogImport(rows).rejected.length, 0);
});

test("CSV rejects malformed records", () => {
  assert.throws(() => parsePetCatalogCsv('rarity\nRare'), /name/);
  assert.throws(() => parsePetCatalogCsv('name,rarity\nCat'), /column count/);
  assert.throws(() => parsePetCatalogCsv('name\n"Cat'), /Unclosed/);
});
