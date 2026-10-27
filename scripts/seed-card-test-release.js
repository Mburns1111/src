// Development-only sample release: 2 existing pets from each verified rarity.
// Dry-run by default. Never touches UserProfile, shop, points, or pet catalog records.
import "dotenv/config";
import mongoose from "mongoose";
import PetCatalog from "../models/PetCatalog.js";
import CardSeries from "../models/CardSeries.js";
import CardRelease from "../models/CardRelease.js";
import CardDefinition from "../models/CardDefinition.js";
import { DEFAULT_HATCH_ODDS } from "../services/card-hatch-engine.js";

const SERIES = "test-series-1";
const RELEASE = "test-s1-r1";
const apply = process.argv.includes("--apply");
if (process.argv.some(a => a.startsWith("--") && a !== "--apply")) {
  throw new Error("Supported arguments: --apply");
}
if (apply && (process.env.ENABLE_CARD_GAME_TEST !== "1" || process.env.CARD_GAME_TEST_SEED_APPROVED !== "YES")) {
  throw new Error("Test seed requires ENABLE_CARD_GAME_TEST=1 and CARD_GAME_TEST_SEED_APPROVED=YES");
}
if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI required");
await mongoose.connect(process.env.MONGODB_URI);
try {
  const rarities = ["Common", "Uncommon", "Rare", "Ultra-Rare", "Legendary"];
  const pets = [];
  for (const rarity of rarities) {
    const selected = await PetCatalog.find({
      rarity, rarityVerification: { $in: ["official-verified", "official-adjudicated"] },
    }).sort({ petId: 1 }).limit(2).select("petId name rarity").lean();
    if (selected.length < 2) throw new Error(`Not enough verified ${rarity} pets. Import the catalog first.`);
    pets.push(...selected);
  }
  const collisions = await Promise.all([
    CardSeries.exists({ seriesId: SERIES }),
    CardRelease.exists({ releaseId: RELEASE }),
    CardDefinition.exists({ releaseId: RELEASE }),
  ]);
  // Refuse overwrite / partial fixture reuse so a repeated apply can never modify previously issued cards.
  if (apply && collisions.some(Boolean)) {
    throw new Error("Test series/release already exists; seed will not overwrite existing records.");
  }
  const info = { mode: apply ? "apply" : "dry-run", seriesId: SERIES, releaseId: RELEASE,
    odds: DEFAULT_HATCH_ODDS, pets: pets.map(p => ({ petId: p.petId, name: p.name, rarity: p.rarity })),
    existingFixture: collisions.some(Boolean) };
  console.log(JSON.stringify(info, null, 2));
  if (!apply) {
    console.log("Dry-run only: no card collections were changed.");
  } else {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await CardSeries.create([{ seriesId: SERIES, name: "TEST Series 1", status: "active" }], { session });
        await CardRelease.create([{ releaseId: RELEASE, seriesId: SERIES, name: "TEST Release 1",
          eggName: "Test Egg (placeholder)", status: "active", hatchOdds: DEFAULT_HATCH_ODDS }], { session });
        await CardDefinition.create(pets.map(p => ({
          seriesId: SERIES, releaseId: RELEASE, petId: p.petId, rarity: p.rarity,
          artStatus: "test-placeholder", enabled: true, hatchWeight: 1,
          artUrl: "",
        })), { session });
      });
    } finally { await session.endSession(); }
    console.log("Created isolated TEST release (10 placeholder definitions). No cards issued.");
  }
} finally { await mongoose.disconnect(); }
