import test from "node:test";
import assert from "node:assert/strict";
import {
  handleProfileEntryButton,
  handleProfilePhotoActionButton,
  handleProfileCardButton,
} from "../commands/profile.js";

const ownerId = "123456789012345678";
function makeInteraction(customId, userId = ownerId) {
  const actions = [];
  const interaction = {
    customId,
    user: { id: userId, username: "Tester", globalName: "Tester" },
    guildId: "234567890123456789",
    channelId: "345678901234567890",
    message: { id: "456789012345678901" },
    deferred: false,
    deferReply: async payload => { interaction.deferred = true; actions.push({ type: "defer", payload }); },
    editReply: async payload => actions.push({ type: "edit", payload }),
    reply: async payload => actions.push({ type: "reply", payload }),
    showModal: async modal => actions.push({ type: "modal", payload: modal.toJSON() }),
    update: async payload => actions.push({ type: "update", payload }),
    actions,
  };
  return interaction;
}

test("photo menu opens from the permanent entry without database round trips", async () => {
  const i = makeInteraction("profile:entry:photos");
  assert.equal(await handleProfileEntryButton(i), true);
  assert.deepEqual(i.actions.map(a => a.type), ["defer", "edit"]);
  assert.equal(i.actions[1].payload.components[0].components.length, 3);
});

test("photo menu opens from a profile card without fetching or rendering the card", async () => {
  const i = makeInteraction(`profile:card:photos:${ownerId}`);
  await handleProfileCardButton(i);
  assert.deepEqual(i.actions.map(a => a.type), ["defer", "edit"]);
});

test("add and remove modal buttons respond immediately without album DB reads", async () => {
  for (const [operation, expectedId, inputId] of [
    ["add", `profile:photos:${ownerId}`, "images"],
    ["remove", `profile:remove-photos:${ownerId}`, "photo_numbers"],
  ]) {
    const i = makeInteraction("profile:photos-action:" + operation + ":" + ownerId);
    await handleProfilePhotoActionButton(i);
    assert.deepEqual(i.actions.map(a => a.type), ["modal"]);
    assert.equal(i.actions[0].payload.custom_id, expectedId);
    assert.equal(i.actions[0].payload.components[0].component.custom_id, inputId);
  }
});

test("one member cannot open another member's photo controls", async () => {
  const i = makeInteraction(`profile:photos-action:remove:${ownerId}`,
    "999999999999999999");
  await assert.rejects(handleProfilePhotoActionButton(i), /Only the profile owner/);
  assert.deepEqual(i.actions, []);
});

test("profile menu photo click acknowledges immediately before editing private controls", async () => {
  const i = makeInteraction(`profile:menu:photos:${ownerId}`);
  const { handleProfileMenuButton } = await import("../commands/profile.js");
  await handleProfileMenuButton(i);
  assert.deepEqual(i.actions.map(a => a.type), ["defer", "edit"]);
  assert.ok(i.actions[0].payload.flags);
  assert.equal(i.actions[1].payload.components[0].components.length, 3);
});
