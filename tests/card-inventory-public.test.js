import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import CardCollector from "../models/CardCollector.js";
import CardCopy from "../models/CardCopy.js";
import PointsWallet from "../models/PointsWallet.js";
import { data as cards } from "../commands/cards.js";
import { parseHatchemText, HATCHEM_GUIDE, HATCHEM_HELP } from "../services/hatchem-text-commands.js";
import { inventoryButtons, cardInventoryPayload, handleCardInventoryInteraction } from "../commands/card-inventory-ui.js";

const guildId = "234567890123456789", userId = "123456789012345678";
const prior = [];
function stub(object, name, replacement) {
  prior.push([object, name, object[name]]);
  object[name] = replacement;
}
function restore() {
  for (const [object, name, original] of prior.reverse()) object[name] = original;
}

test("Hatchem inventory is a public typed and slash command under the 25-option limit", () => {
  assert.deepEqual(parseHatchemText(".inventory"), { action: "inventory", options: {} });
  assert.deepEqual(parseHatchemText(".INVENTORY"), { action: "inventory", options: {} });
  assert.equal(parseHatchemText("inventory"), null);
  assert.match(HATCHEM_GUIDE, /\.inventory/);
  assert.match(HATCHEM_HELP, /\.inventory/);
  const options = cards.toJSON().options;
  assert.equal(options.length, 25);
  assert.ok(options.find(o => o.name === "inventory"), "slash /cards inventory must be registered");
  assert.ok(options.find(o => o.name === "tag").options.some(o => o.name === "card_ids"),
    "multiple-ID tagging remains available via /cards tag");
  assert.ok(options.find(o => o.name === "untag-multiple"));
  const routing = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  assert.match(routing, /\["collection", "inventory"\]\.includes/);
  assert.match(routing, /publicCardView \? \{\} : \{ flags: MessageFlags\.Ephemeral \}/);
  assert.match(routing, /handleCardInventoryInteraction\(interaction\)/);
});

test("public inventory shows exact global extra actions, owned stages, dust and the current server's Points", async () => {
  try {
    stub(CardCollector, "findOne", query => {
      assert.deepEqual(query, { discordUserId: userId });
      return { select: fields => {
        assert.match(fields, /bonusGrabs/);
        return { lean: async () => ({
          bonusGrabs: 4, bonusDrops: 2,
          dust: { Common: 3, Uncommon: 7, Rare: 11, "Ultra-Rare": 15, Legendary: 1 },
        }) };
      } };
    });
    stub(PointsWallet, "findOne", query => {
      assert.deepEqual(query, { guildId, discordUserId: userId }, "never use another server's Points");
      return { select: () => ({ lean: async () => ({ balance: 179 }) }) };
    });
    stub(CardCopy, "aggregate", async stages => {
      assert.deepEqual(stages[0], { $match: { ownerDiscordUserId: userId, state: "owned" } });
      return [{ _id: "normal", total: 12 }, { _id: "neon", total: 3 }, { _id: "mega", total: 1 }];
    });
    const result = await cardInventoryPayload({ guildId, userId, displayName: "❀ LILLY ❀" });
    assert.deepEqual(result.allowedMentions, { parse: [] }, "no surprise pings");
    assert.equal(result.embeds.length, 1);
    const embed = result.embeds[0].toJSON();
    assert.match(embed.title, /LILLY/);
    assert.match(embed.description, /123456789012345678/);
    assert.match(embed.fields[0].value, /Extra Grabs:\*\* 4/);
    assert.match(embed.fields[0].value, /Extra Drops:\*\* 2/);
    assert.match(embed.fields[1].value, /Total:\*\* 16/);
    assert.match(embed.fields[1].value, /Normal: 12 · Neon: 3 · Mega Neon: 1/);
    assert.match(embed.fields[2].value, /179/);
    assert.match(embed.fields[2].value, /Legendary Dust: 1/);
    assert.match(embed.footer.text, /global/);
    const buttons = result.components[0].toJSON().components;
    assert.deepEqual(buttons.map(b => b.label), ["Collection", "Achievements", "Hatchem Shop"]);
    assert.deepEqual(buttons.map(b => b.custom_id), [
      "cards:inventory:collection:" + guildId + ":" + userId,
      "cards:inventory:achievements:" + guildId + ":" + userId,
      "cards:inventory:shop:" + guildId + ":" + userId,
    ]);
  } finally { restore(); }
});

test("empty collection/dust and wallet show zeros, without fabricating claimed cards", async () => {
  try {
    stub(CardCollector, "findOne", () => ({ select: () => ({ lean: async () => null }) }));
    stub(PointsWallet, "findOne", () => ({ select: () => ({ lean: async () => null }) }));
    stub(CardCopy, "aggregate", async () => []);
    const result = await cardInventoryPayload({ guildId, userId, displayName: "@everyone **unsafe**" });
    const embed = result.embeds[0].toJSON();
    assert.doesNotMatch(embed.title, /@everyone|\*\*/);
    assert.match(embed.fields[0].value, /Extra Drops:\*\* 0/);
    assert.match(embed.fields[1].value, /Total:\*\* 0/);
    assert.match(embed.fields[2].value, /Common Dust: 0/);
    assert.match(embed.fields[2].value, /Points \(this server\):\*\* 0/);
  } finally { restore(); }
});

test("inventory buttons are owner-bound and reject cross-guild or tampered clicks", async () => {
  async function click(customId, actor) {
    const responses = [];
    await handleCardInventoryInteraction({
      isButton: () => true,
      customId, guildId,
      user: { id: actor },
      reply: async response => { responses.push(response); },
    });
    return responses;
  }
  const id = "cards:inventory:shop:" + guildId + ":" + userId;
  let replies = await click(id, "456789012345678901");
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /belongs to another collector/);
  assert.equal(replies[0].flags, 64);
  replies = await click("cards:inventory:shop:999999999999999999:" + userId, userId);
  assert.match(replies[0].content, /Invalid/);
  replies = await click("cards:inventory:steal:" + guildId + ":" + userId, userId);
  assert.match(replies[0].content, /Invalid/);
  assert.throws(() => inventoryButtons("guild", "user"), /Invalid|id/i, "invalid IDs must not produce buttons");
});
