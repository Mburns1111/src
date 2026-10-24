import test from "node:test";
import assert from "node:assert/strict";
import { shouldRequestMessageContent } from "../services/observation-intents.js";

test("Arclo public message content diagnostic is off by default", () => {
  assert.equal(shouldRequestMessageContent({}), false);
  assert.equal(shouldRequestMessageContent({ ENABLE_MESSAGE_CONTENT_INTENT: "false" }), false);
  assert.equal(shouldRequestMessageContent({ ENABLE_MESSAGE_CONTENT_INTENT: "0" }), false);
  assert.equal(shouldRequestMessageContent({ ENABLE_MESSAGE_CONTENT_INTENT: "1" }), true);
});
