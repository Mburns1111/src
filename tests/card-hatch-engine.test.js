import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HATCH_ODDS, hatchCard, revealDrop, validateHatchOdds } from "../services/card-hatch-engine.js";
import CardRelease from "../models/CardRelease.js";
import CardDefinition from "../models/CardDefinition.js";
import CardCollector from "../models/CardCollector.js";
import CardCopy from "../models/CardCopy.js";

const pool = [
  { petId: "dog", rarity: "Common", artStatus: "approved", enabled: true, hatchWeight: 2 },
  { petId: "cat", rarity: "Common", artStatus: "approved", enabled: true, hatchWeight: 1 },
  { petId: "dragon", rarity: "Legendary", artStatus: "approved", enabled: true, hatchWeight: 1 },
  { petId: "unapproved", rarity: "Legendary", artStatus: "missing", enabled: true, hatchWeight: 999 },
];

test("default hatch probabilities are 26/26/26/14/8", () => {
  assert.equal(Object.values(validateHatchOdds(DEFAULT_HATCH_ODDS)).reduce((a, b) => a + b), 100);
  assert.equal(DEFAULT_HATCH_ODDS.Legendary, 8);
  assert.equal(DEFAULT_HATCH_ODDS["Ultra-Rare"], 14);
});
test("weighted selection stays inside approved release pool", () => {
  assert.equal(hatchCard({ cards: pool, random: () => 0 }).card.petId, "dog");
  let calls = 0;
  assert.equal(hatchCard({ cards: pool, random: () => (++calls === 1 ? 0 : 0.8) }).card.petId, "cat");
  assert.equal(hatchCard({ cards: pool, random: () => 0.99 }).card.petId, "dragon");
});
test("three revealed cards are picked before claims; duplicates allowed", () => {
  assert.deepEqual(revealDrop({ cards: pool, random: () => 0, count: 3 }).map(x => x.card.petId), ["dog", "dog", "dog"]);
});
test("no artwork means no card can hatch", () => {
  assert.throws(() => hatchCard({ cards: [{ ...pool[0], artStatus: "pending" }] }), /no hatchable/i);
});
test("invalid probabilities and weights are rejected", () => {
  assert.throws(() => validateHatchOdds({ ...DEFAULT_HATCH_ODDS, Legendary: 9 }), /total 100/);
  assert.throws(() => hatchCard({ cards: [{ ...pool[0], hatchWeight: -3 }] }), /no hatchable|Invalid hatch weight/);
});
test("collectibles never share profile data or impose print caps", () => {
  assert.equal(CardCollector.schema.path("discordUserId").options.unique, true);
  assert.equal(CardCopy.schema.path("printLimit"), undefined);
  assert.equal(CardDefinition.schema.path("printLimit"), undefined);
  assert.ok(CardCopy.schema.path("ownerDiscordUserId"));
  assert.ok(CardRelease.schema.path("hatchOdds.Legendary"));
});
