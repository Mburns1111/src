/**
 * Fixed, credit-aware allowlist for the owner's 20 supplied Series 1 artist PNGs.
 * No unrelated files or pre-existing pet cards may be modified by the importer.
 */
const JOVY = Object.freeze({
  credit: "jovyisweird",
  url: "https://www.reddit.com/user/InformalPrinciple834/",
});
const ARIAL = Object.freeze({
  credit: "αriαℓ",
  url: "https://www.reddit.com/user/softlambkin/",
});
export const SERIES1_ARTIST_PETS = Object.freeze([
  ["arctic-fox", "Arctic Fox", ARIAL],
  ["baku", "Baku", JOVY],
  ["candyfloss-chick", "Candyfloss Chick", JOVY],
  ["cute-a-cabra", "Cute-A-Cabra", ARIAL],
  ["dragonfly", "Dragonfly", JOVY],
  ["glacier-moth", "Glacier Moth", JOVY],
  ["happy-duckling", "Happy Duckling", ARIAL],
  ["hot-doggo", "Hot Doggo", JOVY],
  ["koi-carp", "Koi Carp", JOVY],
  ["leopard-shark", "Leopard Shark", JOVY],
  ["lion", "Lion", JOVY],
  ["otter", "Otter", JOVY],
  ["owl", "Owl", JOVY],
  ["shark-puppy", "Shark Puppy", JOVY],
  ["shark", "Shark", JOVY],
  ["lamb", "Lamb", JOVY],
  ["strawberry-shortcake-bat-dragon", "Strawberry Shortcake Bat Dragon", ARIAL],
  ["turtle", "Turtle", ARIAL],
  ["unicorn", "Unicorn", ARIAL],
  ["wolf", "Wolf", ARIAL],
].map(([petId, name, artist]) => Object.freeze({ petId, name, artistCredit: artist.credit, artistUrl: artist.url })));

export function planSeries1ArtistFiles(filenames) {
  const normalize = value => String(value).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
  const byStem = new Map(SERIES1_ARTIST_PETS.map(item => [normalize(item.name), item]));
  // Accept the already-uploaded archive or the owner's corrected renamed PNG.
  const aliases = new Map([["articfox", "arcticfox"], ["sheep", "lamb"]]);
  const matched = new Map();
  for (const filename of filenames) {
    if (!filename.toLowerCase().endsWith(".png")) continue;
    const rawStem = normalize(filename.replace(/\.png$/i, ""));
    const pet = byStem.get(aliases.get(rawStem) || rawStem);
    if (!pet) throw Error("Unexpected artist PNG; refusing to import: " + filename);
    if (matched.has(pet.petId)) throw Error("Two PNGs refer to the same pet: " + matched.get(pet.petId).filename + " / " + filename);
    matched.set(pet.petId, { ...pet, filename });
  }
  const missing = SERIES1_ARTIST_PETS.filter(item => !matched.has(item.petId)).map(item => item.name);
  if (missing.length) throw Error("Artist art pack is missing " + missing.join(", ") + ". No changes made.");
  return SERIES1_ARTIST_PETS.map(item => matched.get(item.petId));
}
