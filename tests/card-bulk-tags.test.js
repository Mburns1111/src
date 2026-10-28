import test from "node:test";
import assert from "node:assert/strict";
import { parseCardIds } from "../services/card-tag-management.js";
import { data } from "../commands/cards.js";
import CardCopy from "../models/CardCopy.js";
import PendingCardTagDeletion from "../models/PendingCardTagDeletion.js";

test("bulk tag commands accept required ID list and delete-tag requires tag", () => {
  const commands = data.toJSON().options;
  for (const sub of ["tag-multiple", "untag-multiple"]) {
    const cmd = commands.find(o => o.name === sub);
    assert.ok(cmd);
    assert.equal(cmd.options.find(o => o.name === "card_ids").required, true);
  }
  const deletion = commands.find(o => o.name === "delete-tag");
  assert.equal(deletion.options.find(o => o.name === "tag").required, true);
});
test("bulk five-character IDs are case-sensitive, unique and capped at 20", () => {
  assert.deepEqual(parseCardIds("A7_kQ, z-9B1"), ["A7_kQ", "z-9B1"]);
  assert.deepEqual(parseCardIds("Aa123 aA123"), ["Aa123", "aA123"]);
  assert.throws(() => parseCardIds("Aa123,Aa123"), /only once/);
  assert.throws(() => parseCardIds("cat"), /five characters/);
  assert.throws(() => parseCardIds(Array.from({length:21},(_,i)=>`A${String(i).padStart(4,"0")}`).join(",")), /1–20/);
});
test("tag deletion confirmation tracks owner, label, count, expiry, status", () => {
  for (const name of ["discordUserId", "tag", "expectedCount", "expiresAt", "status"]) {
    assert.ok(PendingCardTagDeletion.schema.path(name));
  }
  assert.ok(CardCopy.schema.path("tag"));
  assert.ok(CardCopy.schema.path("publicId"));
});
