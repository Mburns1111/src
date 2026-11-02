// Generate or verify an internal staff-only catalogue preview without networking or DB access.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPetCatalogPreview, renderPetCatalogPreviewCsv, renderPetCatalogPreviewMarkdown } from "../services/pet-catalog-preview.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = name => JSON.parse(readFileSync(resolve(root, "data", name), "utf8"));
const preview = buildPetCatalogPreview(
  readJson("pet-catalog-matched-candidates.json"),
  readJson("pet-catalog-unmatched-review.json"),
  readJson("pet-catalog-curated-verification.json"),
  readJson("pet-catalog-exception-decisions.json"),
  readJson("pet-catalog-verification-report.json"),
);
const outputs = [
  ["data/pet-catalog-preview.json", JSON.stringify(preview, null, 2) + "\n"],
  ["data/pet-catalog-preview.csv", renderPetCatalogPreviewCsv(preview)],
  ["docs/pet-catalog-preview.md", renderPetCatalogPreviewMarkdown(preview)],
];
const checkOnly = process.argv.includes("--check");
for (const [file, content] of outputs) {
  const path = resolve(root, file);
  if (checkOnly) {
    if (readFileSync(path, "utf8") !== content) {
      throw new Error("Catalogue staff preview is out of date: " + file + ". Regenerate with npm run pet-catalog:preview");
    }
  } else {
    writeFileSync(path, content);
  }
}
console.log(JSON.stringify(preview.summary, null, 2));
console.log(checkOnly ? "Preview outputs match source evidence." : "Generated staff preview files (NO IMPORT, NO APPROVAL).");
