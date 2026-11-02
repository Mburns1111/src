import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import { parseHatchemText, HATCHEM_GUIDE } from "../services/hatchem-text-commands.js";
import { data as setup } from "../commands/setup.js";

test("Hatchem has dedicated configured channel in server setup", () => {
  assert.ok(GuildConfig.schema.path("hatchemChannelId"));
  const channels = setup.toJSON().options.find(option => option.name === "channels");
  assert.ok(channels.options.some(option => option.name === "hatchem"));
  assert.match(HATCHEM_GUIDE, /Hatchem/);
});

test("Hatchem parses only leading recognized commands with typed arguments", () => {
  assert.equal(parseHatchemText("hello there"), null);
  assert.equal(parseHatchemText("I want to upgrade"), null);
  assert.equal(parseHatchemText("upgrade Doggy"), null);
  assert.equal(parseHatchemText("/upgrade Doggy"), null);
  assert.equal(parseHatchemText("drop"), null);
  assert.equal(parseHatchemText("collection"), null);
  assert.equal(parseHatchemText(".upgrade Doggy").options.card, "Doggy");
  assert.equal(parseHatchemText(".DROP").action, "drop");
  assert.deepEqual(parseHatchemText(".drop").options, {});
  assert.equal(parseHatchemText(".cooldowns").action, "cooldowns");
  assert.equal(parseHatchemText(".collection <@123456789012345678>").options.member, "<@123456789012345678>");
  assert.deepEqual(parseHatchemText('.tag "Favorite" ABCd1').options, { tag: "Favorite", card_id: "ABCd1" });
  assert.deepEqual(parseHatchemText('.tag "Favorite" ABCd1 Def45').options,
    { tag: "Favorite", card_ids: "ABCd1 Def45" });
  assert.equal(parseHatchemText(".tag Favorites").options.tag, "Favorites");
  assert.equal(parseHatchemText(".stats ABCd1").options.card_id, "ABCd1");
  assert.equal(parseHatchemText(".trade").action, "trade");
  assert.equal(parseHatchemText(".burn").action, "burn");
});

test("only assigned Hatchem channel invokes typed handler; card slash commands use it too", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  assert.match(source, /message\.channelId === config\.hatchemChannelId/);
  assert.match(source, /message\.content\.startsWith\("\."\)/);
  assert.match(source, /runHatchemText\(message, parsed\)/);
  assert.match(source, /interaction\.channelId !== hatchemConfig\.hatchemChannelId/);
});
