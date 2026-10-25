import { randomUUID } from "node:crypto";

// New IDs omit UUID separators; keep accepting 12-character legacy IDs of
// the form xxxxxxxx-xxx so already-open Discord editor buttons keep working.
export function newListingEditorToken() {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

export function isListingEditorToken(value) {
  return typeof value === "string" &&
    /^(?:[0-9a-f]{12}|[0-9a-f]{8}-[0-9a-f]{3})$/i.test(value);
}
