import test from "node:test";
import assert from "node:assert/strict";
import { newListingEditorToken, isListingEditorToken } from "../services/listing-editor-token.js";

test("new Trading Post editor controls use 12 hexadecimal characters", () => {
  const token = newListingEditorToken();
  assert.match(token, /^[0-9a-f]{12}$/);
  assert.equal(isListingEditorToken(token), true);
  const id = `listing:dm:select:${token}:background`;
  assert.equal(isListingEditorToken(id.split(":")[3]), true);
});

test("existing UUID-derived sessions keep working after a bot update", () => {
  const legacyToken = "4be83c91-6af";
  assert.equal(isListingEditorToken(legacyToken), true);
  for (const kind of ["select", "button", "modal"]) {
    const customId = `listing:dm:${kind}:${legacyToken}:confirm`;
    assert.equal(isListingEditorToken(customId.split(":")[3]), true);
  }
});

test("malformed, oversized, and injected editor tokens are rejected", () => {
  for (const invalid of [undefined, null, "", "not-a-token", "ab34", "x".repeat(12),
    "4be83c91--af", "4be83c91-6af:confirm", "9".repeat(13), "9".repeat(32)]) {
    assert.equal(isListingEditorToken(invalid), false);
  }
});
