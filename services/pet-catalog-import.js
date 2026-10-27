// Validation-only utility. No web scraping, network requests or database writes.
export const PET_RARITIES = Object.freeze([
  "Common", "Uncommon", "Rare", "Ultra-Rare", "Legendary", "Unknown",
]);

const rarityMap = new Map(PET_RARITIES.map(value => [value.toLowerCase().replace(/[^a-z]/g, ""), value]));
const availabilitySet = new Set(["unknown", "available", "limited", "unavailable"]);

export function petIdFromName(name) {
  return String(name || "").normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function preparePetCatalogRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Pet row must be an object");
  }
  const name = String(row.name ?? "").trim().replace(/\s+/g, " ");
  const petId = petIdFromName(row.petId || name);
  if (!name || !petId || name.length > 120) throw new Error("Invalid pet name");
  const rawRarity = String(row.rarity ?? "Unknown").toLowerCase().replace(/[^a-z]/g, "");
  const rarity = rarityMap.get(rawRarity);
  if (!rarity) throw new Error("Invalid rarity for " + name);
  const availability = String(row.availability ?? "unknown").trim().toLowerCase();
  if (!availabilitySet.has(availability)) throw new Error("Invalid availability for " + name);
  const rawYear = row.releaseYear == null || String(row.releaseYear).trim() === ""
    ? null : Number(row.releaseYear);
  if (rawYear !== null && (!Number.isInteger(rawYear) || rawYear < 2017 || rawYear > 2200)) {
    throw new Error("Invalid release year for " + name);
  }
  const sourceName = String(row.sourceName ?? "").trim();
  const sourceUrl = String(row.sourceUrl ?? "").trim();
  if (sourceUrl && !/^https:\/\/[^\s]+$/i.test(sourceUrl)) throw new Error("Invalid source URL for " + name);
  if (sourceUrl && !sourceName) throw new Error("Source name required for " + name);
  return {
    petId, name, rarity, availability, releaseYear: rawYear,
    releaseEvent: String(row.releaseEvent ?? "").trim(),
    originalObtainingMethod: String(row.originalObtainingMethod ?? "").trim(),
    sources: sourceName ? [{ name: sourceName, url: sourceUrl, checkedAt: new Date() }] : [],
    reviewStatus: "pending",
  };
}

export function preparePetCatalogImport(rows) {
  if (!Array.isArray(rows)) throw new Error("Expected an array of pet rows");
  const seen = new Set(), accepted = [], rejected = [];
  rows.forEach((row, index) => {
    try {
      const pet = preparePetCatalogRow(row);
      if (seen.has(pet.petId)) throw new Error("Duplicate pet ID in this import: " + pet.petId);
      seen.add(pet.petId);
      accepted.push(pet);
    } catch (error) {
      rejected.push({ row: index + 1, reason: error.message });
    }
  });
  return { accepted, rejected };
}

// Supports comma-separated fields, escaped quotes and multiline quoted cells.
export function parsePetCatalogCsv(csv) {
  if (typeof csv !== "string") throw new Error("CSV must be text");
  const lines = []; let cells = [], cell = "", inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (inQuotes && csv[i + 1] === '"') { cell += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      cells.push(cell); cell = "";
    } else if ((c === "\n" || c === "\r") && !inQuotes) {
      if (c === "\r" && csv[i + 1] === "\n") i++;
      cells.push(cell); cell = "";
      if (cells.some(v => v.trim())) lines.push(cells);
      cells = [];
    } else cell += c;
  }
  if (inQuotes) throw new Error("Unclosed CSV quote");
  cells.push(cell);
  if (cells.some(v => v.trim())) lines.push(cells);
  if (!lines.length) return [];
  const [header, ...rows] = lines;
  const keys = header.map(key => key.replace(/^\uFEFF/, "").trim());
  if (!keys.includes("name")) throw new Error("CSV requires a name column");
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate CSV header");
  return rows.map((values, idx) => {
    if (values.length !== keys.length) throw new Error("CSV column count mismatch at row " + (idx + 2));
    return Object.fromEntries(keys.map((key, i) => [key, values[i]]));
  });
}
