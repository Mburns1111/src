import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import CardDrop from "../models/CardDrop.js";
import { dropText } from "../commands/cards.js";
import { reserveCardFromDrop, CardClaimError } from "../services/card-drop-claims.js";

const future = new Date(Date.now() + 60000);
const past = new Date(Date.now() - 60000);
const slots = [
  { petId: "ant", rarity: "Common", claimedBy: "101", settledAt: null },
  { petId: "cat", rarity: "Common", claimedBy: null, settledAt: null },
  { petId: "dog", rarity: "Common", claimedBy: null, settledAt: null },
];

test("open drop has only one clean hatched heading, even after reservations", () => {
  const message = dropText({ status: "open", expiresAt: future, slots }, "Test 1");
  assert.equal(message, "🥚 **Test 1 Egg — Hatched!**");
  assert.doesNotMatch(message, /Reserved|Pick one|Drop closes|Amber|Claimed/);
});

test("all three reservations do not end the drop before expiry", () => {
  const message = dropText({ status: "open", expiresAt: future,
    slots: slots.map(s => ({ ...s, claimedBy: "user" })) }, "Test 1");
  assert.equal(message, "🥚 **Test 1 Egg — Hatched!**");
});

test("closed drop has only its final one-line heading", () => {
  const message = dropText({ status: "closed", expiresAt: past, slots }, "Test 1");
  assert.equal(message, "🥚 **Test 1 Egg — Drop Ended**");
  assert.doesNotMatch(message, /Claimed|Unclaimed|Reserved|Drop closes/);
});

test("drop slots retain a separate settlement timestamp", () => {
  assert.ok(CardDrop.schema.path("slots").schema.path("settledAt"));
});

test("invalid reservation is rejected without a MongoDB connection", async () => {
  await assert.rejects(
    reserveCardFromDrop({ dropId: new mongoose.Types.ObjectId().toString(), slot: 3, guildId: "123", discordUserId: "111" }),
    CardClaimError,
  );
});
