import test from "node:test";
import assert from "node:assert/strict";
import { isCardGameOwner, assertCardGameOwner, CARD_OWNER_ENV_KEY } from "../services/card-owner-access.js";
import { CARD_DROP_COOLDOWN_MS, CARD_GRAB_COOLDOWN_MS, cardCooldownIdentity, cardCooldownDuration } from "../services/card-action-cooldowns.js";
import CardActionCooldown from "../models/CardActionCooldown.js";
import GuildConfig from "../models/GuildConfig.js";
import { data as cardsAdmin, execute as executeCardsAdmin } from "../commands/cards-admin.js";
import { data as cardsOwner, execute as executeCardsOwner } from "../commands/cards-owner.js";
import { execute as executeCards } from "../commands/cards.js";

const owner = "123456789012345678";
const other = "234567890123456789";
const guildA = "345678901234567890";
const guildB = "456789012345678901";

test("owner access requires an explicitly configured Discord ID and never grants server-admin bypass", () => {
  assert.equal(CARD_OWNER_ENV_KEY, "CARD_GAME_OWNER_DISCORD_ID");
  assert.equal(isCardGameOwner(owner, {}), false);
  assert.equal(isCardGameOwner(owner, { CARD_GAME_OWNER_DISCORD_ID: "unconfigured" }), false);
  assert.equal(isCardGameOwner(owner, { CARD_GAME_OWNER_DISCORD_ID: "123456789012345678" }), true);
  assert.equal(isCardGameOwner(other, { CARD_GAME_OWNER_DISCORD_ID: owner }), false);
  assert.throws(() => assertCardGameOwner(other, { CARD_GAME_OWNER_DISCORD_ID: owner }), /Only the card-game owner/);
});

test("all servers share one drop cooldown, but each server has its own grab cooldown", () => {
  const a = cardCooldownIdentity({ action: "drop", discordUserId: owner, guildId: guildA });
  const b = cardCooldownIdentity({ action: "drop", discordUserId: owner, guildId: guildB });
  assert.deepEqual(a, b);
  assert.equal(a.scope, "global");
  const c = cardCooldownIdentity({ action: "grab", discordUserId: owner, guildId: guildA });
  const d = cardCooldownIdentity({ action: "grab", discordUserId: owner, guildId: guildB });
  assert.notEqual(c._id, d._id);
  assert.equal(c.scope, guildA);
  assert.equal(d.scope, guildB);
  assert.equal(cardCooldownDuration("drop"), CARD_DROP_COOLDOWN_MS);
  assert.equal(CARD_DROP_COOLDOWN_MS, 900000);
  assert.equal(cardCooldownDuration("grab"), CARD_GRAB_COOLDOWN_MS);
  assert.equal(CARD_GRAB_COOLDOWN_MS, 300000);
  assert.throws(() => cardCooldownIdentity({ action: "grab", discordUserId: owner }), /server ID/);
  assert.ok(CardActionCooldown.schema.path("availableAt"));
});

test("server admins only get a local Card role setting", () => {
  assert.ok(GuildConfig.schema.path("cardRoleId"));
  const setup = cardsAdmin.toJSON();
  assert.equal(setup.name, "cards-admin");
  assert.deepEqual(setup.options.map(x => x.name), ["setup-role"]);
  assert.equal(setup.options[0].options[0].name, "role");
  const ownerCommand = cardsOwner.toJSON();
  assert.deepEqual(ownerCommand.options.map(x => x.name), ["releases", "inspect"]);
});

test("owner-only release inspection rejects non-owner before database access", async () => {
  const env = process.env.CARD_GAME_OWNER_DISCORD_ID;
  try {
    process.env.CARD_GAME_OWNER_DISCORD_ID = owner;
    let response = "";
    await executeCardsOwner({
      user: { id: other },
      options: { getSubcommand: () => "releases", getInteger: () => 1 },
      editReply: message => { response = message; },
    });
    assert.match(response, /Only the card-game owner/);
  } finally {
    if (env === undefined) delete process.env.CARD_GAME_OWNER_DISCORD_ID;
    else process.env.CARD_GAME_OWNER_DISCORD_ID = env;
  }
});

test("manager-only old test drop does not bypass the new owner's ID restriction", async () => {
  const env = process.env.CARD_GAME_OWNER_DISCORD_ID;
  const testFlag = process.env.ENABLE_CARD_GAME_TEST;
  try {
    process.env.CARD_GAME_OWNER_DISCORD_ID = owner;
    process.env.ENABLE_CARD_GAME_TEST = "1";
    let response = "";
    await executeCards({
      guildId: guildA, user: { id: other },
      memberPermissions: { has: () => true },
      options: { getSubcommand: () => "test-drop" },
      editReply: message => { response = message; },
    });
    assert.match(response, /Only the card-game owner/);
  } finally {
    if (env === undefined) delete process.env.CARD_GAME_OWNER_DISCORD_ID;
    else process.env.CARD_GAME_OWNER_DISCORD_ID = env;
    if (testFlag === undefined) delete process.env.ENABLE_CARD_GAME_TEST;
    else process.env.ENABLE_CARD_GAME_TEST = testFlag;
  }
});

test("card-admin role setup rejects users without Manage Server", async () => {
  let response = "";
  await executeCardsAdmin({
    guildId: guildA, guild: { id: guildA },
    memberPermissions: { has: () => false },
    editReply: message => { response = message; },
  });
  assert.match(response, /Only server managers/);
});
