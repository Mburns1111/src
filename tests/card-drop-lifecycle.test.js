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

test("a selected card is only reserved, not presented as awarded", () => {
  const message = dropText({ status: "open", expiresAt: future, slots }, "Test 1");
  assert.match(message, /Reserved/);
  assert.doesNotMatch(message, /Drop Ended| · Claimed/);
});

test("even if all 3 cards are reserved, drop remains open until expiry", () => {
  const message = dropText({
    status: "open", expiresAt: future,
    slots: slots.map(s => ({ ...s, claimedBy: "user" })),
  }, "Test 1");
  assert.doesNotMatch(message, /Drop Ended/);
});

test("expired drop shows final claims and no new reservation state", () => {
  const message = dropText({ status: "closed", expiresAt: past, slots }, "Test 1");
  assert.match(message, /Drop Ended/);
  assert.match(message, /Claimed/);
  assert.match(message, /Unclaimed/);
  assert.doesNotMatch(message, /Reserved|Drop closes/);
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
