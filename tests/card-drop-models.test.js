import test from "node:test";
import assert from "node:assert/strict";
import CardDrop from "../models/CardDrop.js";
import CardClaim from "../models/CardClaim.js";
import CardCopy from "../models/CardCopy.js";
test("drop records preserve pre-rolled three-card reveal and expiry", () => {
  assert.ok(CardDrop.schema.path("slots"));
  assert.ok(CardDrop.schema.path("expiresAt"));
  assert.ok(CardDrop.schema.path("guildId"));
});
test("claims uniquely protect drop slots and members", () => {
  const keys = CardClaim.schema.indexes().map(([key, opts]) => [key, opts.unique]);
  assert.ok(keys.some(([key, unique]) => unique && key.dropId === 1 && key.slot === 1));
  assert.ok(keys.some(([key, unique]) => unique && key.dropId === 1 && key.discordUserId === 1));
});
test("cards track origin and are not print limited", () => {
  assert.ok(CardCopy.schema.path("originGuildId"));
  assert.equal(CardCopy.schema.path("printLimit"), undefined);
});
