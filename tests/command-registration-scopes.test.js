import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planCommandScopes } from "../services/command-registration-scopes.js";

const normal = [{ name: "setup" }, { name: "party" }, { name: "profile" }];
const cards = [{ name: "cards" }, { name: "cards-owner" }];
const guild = "123456789012345678";

test("test server sees normal commands globally and card testing only in guild", () => {
  const { globalCommands, guildCommands } = planCommandScopes({
    commonCommands: normal,
    globalCardCommands: [],
    testGuildCardCommands: cards,
    guildId: guild, testMode: true,
  });
  assert.deepEqual(globalCommands, normal);
  assert.deepEqual(guildCommands, cards);
  assert.equal(new Set([...globalCommands, ...guildCommands].map(c => c.name)).size, 5);
});

test("guild command PUT is empty to remove old duplicate commands when cards are disabled", () => {
  const { globalCommands, guildCommands } = planCommandScopes({
    commonCommands: normal, guildId: guild,
  });
  assert.deepEqual(globalCommands, normal);
  assert.deepEqual(guildCommands, []);
});

test("production keeps live commands global and clears guild-only registrations", () => {
  const { globalCommands, guildCommands } = planCommandScopes({
    commonCommands: normal, globalCardCommands: cards, guildId: guild,
  });
  assert.deepEqual(globalCommands, [...normal, ...cards]);
  assert.deepEqual(guildCommands, []);
});

test("no guild ID means no guild registration endpoint", () => {
  const result = planCommandScopes({ commonCommands: normal });
  assert.equal(result.guildCommands, null);
});

test("never allow duplicate slash command names within or across scopes", () => {
  assert.throws(() => planCommandScopes({
    commonCommands: [{ name: "party" }, { name: "party" }],
  }), /Duplicate global command: party/);
  assert.throws(() => planCommandScopes({
    commonCommands: normal, testGuildCardCommands: [{ name: "party" }],
    guildId: guild, testMode: true,
  }), /cannot be registered globally and in a guild/);
});

test("registration script synchronizes only the planned guild-specific commands", () => {
  const registration = readFileSync(new URL("../register-commands.js", import.meta.url), "utf8");
  assert.match(registration, /planCommandScopes\(/);
  assert.match(registration, /body: guildCommands/);
  assert.doesNotMatch(registration, /\[\.\.\.commands,\s*\.\.\.testGuildCardCommands\]/);
});
