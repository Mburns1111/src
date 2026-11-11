import test from "node:test";
import assert from "node:assert/strict";
import { allowedCommandChannels, commandChannelRestriction } from "../services/command-channel-routing.js";

const commands = "123456789012345678";
const staffRecords = "234567890123456789";
const trials = "345678901234567890";
const other = "456789012345678901";
const shop = "567890123456789012";
const hatchem = "678901234567890123";
const config = {
  commandChannelId: commands,
  activityGiveawayReviewChannelId: staffRecords,
  survivalTrialChannelId: trials,
  shopChannelId: shop,
  hatchemChannelId: hatchem,
};

test("public help is unrestricted in server channels", () => {
  assert.deepEqual(allowedCommandChannels("help", config), []);
  for (const channel of [commands, other, shop, hatchem])
    assert.equal(commandChannelRestriction("help", channel, config), null);
});

test("shop browse lives in configured shop channel rather than private commands channel", () => {
  assert.deepEqual(allowedCommandChannels("shop", config), [shop]);
  assert.equal(commandChannelRestriction("shop", shop, config), null);
  assert.match(commandChannelRestriction("shop", commands, config), new RegExp(shop));
  assert.match(commandChannelRestriction("shop", other, {}), /not configured/);
});

test("Hatchem public slash commands are limited to the configured Hatchem channel", () => {
  assert.deepEqual(allowedCommandChannels("cards", config), [hatchem]);
  assert.equal(commandChannelRestriction("cards", hatchem, config), null);
  assert.match(commandChannelRestriction("cards", other, config), new RegExp(hatchem));
});

test("all staff and owner slash commands use private commands channel", () => {
  for (const name of ["setup", "admin-import", "points-admin", "points-observe",
    "profile-cleanup", "profile-refresh", "cards-admin", "cards-owner",
    "cards-release", "party", "giveaway", "giveaway-role", "trial", "test-points"]) {
    assert.deepEqual(allowedCommandChannels(name, config), [commands]);
    assert.equal(commandChannelRestriction(name, commands, config), null);
    assert.match(commandChannelRestriction(name, other, config), new RegExp(commands));
    assert.match(commandChannelRestriction(name, staffRecords, config), new RegExp(commands));
    assert.match(commandChannelRestriction(name, trials, config), new RegExp(commands));
  }
});

test("initial setup remains possible before a commands channel has been configured", () => {
  assert.equal(commandChannelRestriction("setup", other, {}), null);
  assert.equal(commandChannelRestriction("giveaway", other, {}), null);
});
