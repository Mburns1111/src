import test from "node:test";
import assert from "node:assert/strict";
import { parseCardIds } from "../services/card-tag-management.js";
import { data } from "../commands/cards.js";
import CardCopy from "../models/CardCopy.js";
import PendingCardTagDeletion from "../models/PendingCardTagDeletion.js";

test("bulk tag commands accept a required ID list and delete-tag requires tag", () => {
  const commands = data.toJSON().options;
  for (const sub of ["tag-multiple", "untag-multiple"]) {
    const cmd = commands.find(o => o.name === sub);
    assert.ok(cmd);
    assert.equal(cmd.options.find(o => o.name === "card_ids").required, true);
  }
  const deletion = commands.find(o => o.name === "delete-tag");
  assert.equal(deletion.options.find(o => o.name === "tag").required, true);
});
test("bulk ID parsing enforces unique, well-formed IDs and a limit of 20", () => {
  const a = "507f1f77bcf86cd799439011";
  const b = "507f1f77bcf86cd799439012";
  assert.deepEqual(parseCardIds(a + ", " + b).map(String), [a, b]);
  assert.deepEqual(parseCardIds(a.slice(-12) + ", " + b.slice(-12)), [a.slice(-12), b.slice(-12)]);
  assert.throws(() => parseCardIds(a + " " + a), /only once/);
  assert.throws(() => parseCardIds("cat"), /12 or 24/);
  assert.throws(() => parseCardIds(Array.from({ length: 21 }, (_, i) => i.toString(16).padStart(24, "0")).join(",")), /1–20/);
});
test("tag deletion confirmation tracks owner, label, count, expiry, status", () => {
  for (const name of ["discordUserId", "tag", "expectedCount", "expiresAt", "status"]) {
    assert.ok(PendingCardTagDeletion.schema.path(name));
  }
  assert.ok(CardCopy.schema.path("tag"));
  assert.equal(CardCopy.schema.path("printLimit"), undefined);
});
