import test from "node:test";
import assert from "node:assert/strict";
import { outfitActionComponents, outfitActionsPayload, ensureOutfitControls } from "../services/outfit-controls.js";
import OutfitListing from "../models/OutfitListing.js";

const listing = {
  _id: "a".repeat(24),
  guildId: "123456789012345678",
  ownerId: "123456789012345678",
  postChannelId: "123456789012345678",
  postMessageId: "123456789012345679",
  controlsMessageId: "",
  status: "active",
  title: "Three picture outfit",
  interestedUserIds: [],
  notifyOnInterest: false,
};

test("outfit action message contains seller buttons but no image/gallery embeds", () => {
  const payload = outfitActionsPayload(listing);
  assert.equal(payload.components.length, 2);
  const components = payload.components.flatMap(row => row.toJSON().components);
  assert.deepEqual(components.map(item => item.label), [
    "Remove listing", "Interested (0)", "Interest DMs: Off",
  ]);
  assert.ok(components.every(item => item.custom_id.startsWith("outfit:")));
  assert.match(payload.content, /Outfit actions/);
  assert.equal(payload.embeds, undefined);
  assert.equal(payload.files, undefined);
});

test("refreshing action controls uses same component IDs and reflects interested count", () => {
  const initial = outfitActionComponents(listing);
  const updated = outfitActionComponents({
    ...listing,
    interestedUserIds: ["1111", "2222"],
    notifyOnInterest: true,
  });
  assert.equal(initial[0].toJSON().components[1].label, "Interested (0)");
  assert.equal(updated[0].toJSON().components[1].label, "Interested (2)");
  assert.equal(updated[1].toJSON().components[0].label, "Interest DMs: On");
  assert.equal(initial[0].toJSON().components[0].custom_id,
    updated[0].toJSON().components[0].custom_id);
});

test("controls are sent only after caller finishes posting gallery, and stay idempotent", async () => {
  const record = { ...listing };
  let sendCalls = 0;
  let editCalls = 0;
  const posted = {
    id: "222222222222222222",
    author: { id: "333333333333333333" },
    edit: async payload => { editCalls += 1; assert.equal(payload.components.length, 2); return posted; },
  };
  const channel = {
    messages: { fetch: async id => {
      assert.equal(id, posted.id);
      return posted;
    }},
    send: async payload => {
      sendCalls += 1;
      assert.equal(payload.components.length, 2);
      assert.equal(payload.reply.messageReference, record.postMessageId);
      return posted;
    },
  };
  const guild = { id: record.guildId, client: { user: { id: posted.author.id } } };
  const original = OutfitListing.updateOne;
  OutfitListing.updateOne = async (_, patch) => {
    assert.equal(patch.$set.controlsMessageId, posted.id);
    return { matchedCount: 1 };
  };
  try {
    await ensureOutfitControls(guild, record, { channel });
    await ensureOutfitControls(guild, record, { channel });
    assert.equal(sendCalls, 1, "do not create duplicate action messages");
    assert.equal(editCalls, 1, "refresh existing controls in place");
    assert.equal(record.controlsMessageId, posted.id);
  } finally {
    OutfitListing.updateOne = original;
  }
});
