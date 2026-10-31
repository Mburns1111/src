import test from "node:test";
import assert from "node:assert/strict";
import CardDrop from "../models/CardDrop.js";
import { reserveCardFromDrop, selectDropWinner } from "../services/card-drop-claims.js";

test("new drop slots have separate entrant list and permanent selected winner", () => {
  assert.ok(CardDrop.schema.path("slots").schema.path("entrants"));
  assert.ok(CardDrop.schema.path("slots").schema.path("winnerId"));
  assert.equal(typeof reserveCardFromDrop, "function");
});

test("winner draw randomly selects among guests; creator has priority", () => {
  const guests = { entrants: ["guest-a", "guest-b", "guest-c"] };
  assert.equal(selectDropWinner(guests, "creator", () => 0), "guest-a");
  assert.equal(selectDropWinner(guests, "creator", () => 2), "guest-c");
  assert.equal(selectDropWinner({ entrants: ["guest-a", "creator", "guest-b"] }, "creator", () => 0), "creator");
  assert.equal(selectDropWinner({ entrants: ["creator"], winnerId: "creator" }, "creator"), "creator");
  assert.equal(selectDropWinner({ claimedBy: "legacy-user" }, "creator"), "legacy-user");
  assert.equal(selectDropWinner({ entrants: [] }, "creator"), null);
});
