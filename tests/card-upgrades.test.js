import test from "node:test";
import assert from "node:assert/strict";
import { data, handleCardUpgrade } from "../commands/cards.js";
import { inspectUpgradeCards, selectUpgradeSet, suggestOwnedCardUpgrades, CARDS_PER_UPGRADE } from "../services/card-upgrades.js";
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
test("upgrade selection accepts tagged cards and prioritizes untagged copies", () => {
  const four = copies("normal");
  four[0].tag = "Favorite";
  assert.equal(inspectUpgradeCards(four, "user-a"), "neon");
  const fifth = { ...four[0], publicId: "AAAA5", tag: "" };
  const selected = selectUpgradeSet([...four, fifth]);
  assert.equal(selected.length, 4);
  assert.ok(!selected.some(c => c.publicId === "AAAA1"));
  assert.ok(selectUpgradeSet([...four, fifth], "AAAA1").some(c => c.publicId === "AAAA1"));
  assert.equal(selectUpgradeSet(four.slice(0, 3)), null);
});
test("upgrade protections still enforce ownership, release and stage", () => {
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
  assert.ok(command.options.some(o => o.name === "card" && o.required));
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

test("upgrade autocomplete is attached to the single card field and uses owned-only candidates", async () => {
  const upgrade = data.toJSON().options.find(o => o.name === "upgrade");
  const field = upgrade.options.find(o => o.name === "card");
  assert.equal(field.autocomplete, true);
  assert.equal(typeof suggestOwnedCardUpgrades, "function");
  const { readFileSync } = await import("node:fs");
  const service = readFileSync(new URL("../services/card-upgrades.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  assert.match(service, /ownerDiscordUserId: ownerId, state: "owned"/);
  assert.match(service, /count: \{ \$gte: CARDS_PER_UPGRADE \}/);
  assert.match(service, /\.slice\(0, 25\)/);
  assert.match(index, /interaction\.isAutocomplete\(\)/);
  assert.match(index, /await autocompleteCards\(interaction\)/);
});

test("completed upgrades announce the newly rendered card publicly while confirmation stays private", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../commands/cards.js", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("export async function handleCardUpgrade"), source.indexOf("export async function handleCardGrab"));
  assert.match(handler, /await confirmCardUpgrade\(token, interaction\.user\.id, interaction\.guildId\)/);
  assert.match(handler, /renderCollectibleCardPreview\(/);
  assert.match(handler, /interaction\.channel\.send\(/);
  assert.match(handler, /new AttachmentBuilder\(image, \{ name: "upgraded-card\.png" \}\)/);
  assert.match(handler, /allowedMentions: \{ users: \[interaction\.user\.id\], parse: \[\] \}/);
  assert.match(handler, /Upgrade completed but public image failed/);
  assert.match(handler, /interaction\.editReply\(/);
});
