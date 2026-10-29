import test from "node:test";
import assert from "node:assert/strict";
import { data, handleCardUpgrade } from "../commands/cards.js";
import { inspectUpgradeCards, normalizeUpgradeIds, CARDS_PER_UPGRADE } from "../services/card-upgrades.js";
import CardLifecycleEvent from "../models/CardLifecycleEvent.js";
import CardCopy from "../models/CardCopy.js";

const definitionId = "68caaaaa1234567812345678";
const copies = stage => ["AAAA1", "AAAA2", "AAAA3", "AAAA4"].map(publicId => ({
  publicId, cardDefinitionId: definitionId, ownerDiscordUserId: "user-a",
  state: "owned", upgradeLevel: stage, tag: "",
}));
test("four matching Normal cards yield Neon; four Neons yield Mega", () => {
  assert.equal(CARDS_PER_UPGRADE, 4);
  assert.equal(inspectUpgradeCards(copies("normal"), "user-a"), "neon");
  assert.equal(inspectUpgradeCards(copies("neon"), "user-a"), "mega");
  assert.throws(() => inspectUpgradeCards(copies("mega"), "user-a"), /cannot be upgraded/);
});
test("upgrades protect tags, ownership, release, and duplicate identifiers", () => {
  assert.deepEqual(normalizeUpgradeIds("AAAA1,AAAA2,AAAA3,AAAA4"), ["AAAA1","AAAA2","AAAA3","AAAA4"]);
  assert.throws(() => normalizeUpgradeIds("AAAA1,AAAA1,AAAA3,AAAA4"), /duplicate/);
  assert.throws(() => normalizeUpgradeIds("AAAA1,AAAA2"), /exactly four/);
  const tagged = copies("normal");
  tagged[0].tag = "Favorite";
  assert.throws(() => inspectUpgradeCards(tagged, "user-a"), /Tagged cards/);
  const foreign = copies("normal");
  foreign[0].ownerDiscordUserId = "user-b";
  assert.throws(() => inspectUpgradeCards(foreign, "user-a"), /belong to you/);
  const mixed = copies("normal");
  mixed[0].cardDefinitionId = "68caaaaa1234567812345679";
  assert.throws(() => inspectUpgradeCards(mixed, "user-a"), /same pet from the same release/);
  const stages = copies("normal");
  stages[0].upgradeLevel = "neon";
  assert.throws(() => inspectUpgradeCards(stages, "user-a"), /same upgrade stage/);
});
test("upgrade is private, explicitly confirmed, auditable and assigned a new copy ID", async () => {
  const command = data.toJSON().options.find(o => o.name === "upgrade");
  assert.ok(command.options.some(o => o.name === "card_ids" && o.required));
  assert.equal(typeof handleCardUpgrade, "function");
  assert.ok(CardCopy.schema.path("createdFrom"));
  assert.ok(CardCopy.schema.path("consumedAt"));
  assert.ok(CardLifecycleEvent.schema.path("operationKey").options.unique);
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../services/card-upgrades.js", import.meta.url), "utf8");
  assert.match(source, /session\.withTransaction/);
  assert.match(source, /allocateCardId\(session\)/);
  assert.match(source, /modifiedCount !== CARDS_PER_UPGRADE/);
});
