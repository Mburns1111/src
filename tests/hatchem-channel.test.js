import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import { parseHatchemText, HATCHEM_GUIDE } from "../services/hatchem-text-commands.js";
import { data as setup } from "../commands/setup.js";
import {cardSetupFields} from "../commands/general-card-setup.js";

test("Hatchem has dedicated configured channel in server setup", () => {
  assert.ok(GuildConfig.schema.path("hatchemChannelId"));
  const names=setup.toJSON().options.map(x=>x.name);
  assert.ok(names.includes("cards"),"/setup cards replaces legacy Hatchem channel setup");
  assert.ok(!names.includes("channels"));
  assert.ok(cardSetupFields.includes("hatchemChannelId"));
  assert.ok(cardSetupFields.includes("cardRoleId"));
  assert.match(HATCHEM_GUIDE, /Hatchem/);
});

test("live Hatchem guide uses grouped, readable and Discord-sized command instructions", () => {
  assert.ok(HATCHEM_GUIDE.length <= 2000, "Discord content limit");
  assert.match(HATCHEM_GUIDE, /Start playing/);
  assert.match(HATCHEM_GUIDE, /Eggs & Collecting/);
  assert.match(HATCHEM_GUIDE, /Upgrades & Organizing/);
  assert.match(HATCHEM_GUIDE, /Trading, Extras & Rewards/);
  assert.ok(HATCHEM_GUIDE.includes("`.register`"));
  assert.ok(HATCHEM_GUIDE.includes("`.tutorial`"));
  assert.ok(HATCHEM_GUIDE.includes("`.help`"));
  assert.match(HATCHEM_GUIDE, /`Abc12`/);
  assert.match(HATCHEM_GUIDE, /10 Points/);
  assert.match(HATCHEM_GUIDE, /20 Points/);
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
