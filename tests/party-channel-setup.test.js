import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import PartyGame from "../models/PartyGame.js";
import { data as setupCommand, execute as saveChannels } from "../commands/setup.js";
import {generalSetupFields} from "../commands/general-card-setup.js";
import { data as partyCommand, execute as runParty, handlePartyInteraction } from "../commands/party.js";

const guildId = "123456789012345678";
const channelId = "234567890123456789";
const invokingId = "345678901234567890";
const gameId = "507f1f77bcf86cd799439011";
const staffId = "456789012345678901";
function stub(changes, obj, key, replacement) {
  changes.push([obj, key, obj[key]]);
  obj[key] = replacement;
}
function restore(changes) {
  for (const [obj, key, previous] of changes.reverse()) obj[key] = previous;
}

test("Party Games setup defines an independent text-channel setting", () => {
  const subcommands=setupCommand.toJSON().options.map(x=>x.name);
  assert.ok(subcommands.includes("general"));
  assert.ok(!subcommands.includes("channels"));
  assert.ok(generalSetupFields.includes("partyGamesChannelId"),"/setup general configures Party Games");
  assert.ok(GuildConfig.schema.path("partyGamesChannelId"));
  const host = partyCommand.toJSON().options.find(opt => opt.name === "host");
  assert.ok(host && !host.options.some(opt => opt.name === "channel"),
    "Staff must not override the dedicated channel for each new lobby");
});

test("setup saves Party Games channel without modifying other channels", async () => {
  const changes = [], updates = [], replies = [];
  try {
    stub(changes, GuildConfig, "findOneAndUpdate", async (filter, update) => {
      updates.push({ filter, update });
    });
    await saveChannels({
      inGuild: () => true,
      guildId,
      options: {
        getSubcommand:()=> "channels",
        getChannel: name => name === "party_games" ? {
          id: channelId, toString: () => "<#" + channelId + ">",
        } : null,
        getRole: () => null,
        getBoolean: () => null,
      },
      deferred: true, replied: false,
      editReply: async x => { replies.push(x); },
    });
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0], {
      filter: { guildId },
      update: { $set: { partyGamesChannelId: channelId } },
    });
    assert.match(replies[0].content, /Party Games/);
  } finally { restore(changes); }
});

function hostInteraction() {
  const replies = [];
  return {
    guildId, channelId: invokingId,
    guild: {
      channels: { fetch: async id => id === channelId ? {
        id, isTextBased: () => true,
        send: async payload => {
          hostInteraction.sent.push({ id, payload });
          return { id: "999999999999999999", url: "https://discord.com/channels/example/party" };
        },
      } : null },
    },
    user: { id: staffId },
    memberPermissions: { has: bit => bit === PermissionFlagsBits.ManageGuild },
    options: {
      getSubcommand: () => "host",
      getString: name => name === "game" ? "court" : null,
      getBoolean: () => null,
    },
    channel: { send: async () => { assert.fail("Never publish into the invoking channel."); } },
    editReply: async payload => { replies.push(payload); },
    replies,
  };
}
hostInteraction.sent = [];

test("hosting publishes lobby only in the assigned Party Games channel", async () => {
  const changes = [], created = [], edits = [];
  try {
    hostInteraction.sent.length = 0;
    stub(changes, GuildConfig, "findOne", async () => ({ partyGamesChannelId: channelId }));
    stub(changes, PartyGame, "create", async doc => {
      created.push(doc);
      return { ...doc, _id: gameId, players: [], phase: "lobby" };
    });
    stub(changes, PartyGame, "updateOne", async (...args) => {
      edits.push(args);
      return { modifiedCount: 1 };
    });
    const interaction = hostInteraction();
    await runParty(interaction);
    assert.equal(created.length, 1);
    assert.equal(created[0].channelId, channelId);
    assert.equal(hostInteraction.sent.length, 1);
    assert.equal(hostInteraction.sent[0].id, channelId);
    assert.equal(edits.length, 1);
    assert.match(interaction.replies[0].content, /lobby created/i);
  } finally { restore(changes); }
});

test("hosting without setup fails helpfully and never posts elsewhere", async () => {
  const changes = [];
  try {
    stub(changes, GuildConfig, "findOne", async () => null);
    stub(changes, PartyGame, "create", async () => assert.fail("No lobby may be created without a channel"));
    await assert.rejects(() => runParty(hostInteraction()), /configure the Party Games channel/i);
  } finally { restore(changes); }
});

test("answer button shows modal immediately without any database read", async () => {
  const changes = [];
  try {
    stub(changes, PartyGame, "findOne", () => assert.fail("Modal acknowledgement must not wait for MongoDB"));
    const modals = [];
    await handlePartyInteraction({
      isButton: () => true,
      isModalSubmit: () => false,
      customId: "party:answer:" + gameId + ":1:0",
      showModal: async modal => { modals.push(modal.toJSON()); },
    });
    assert.equal(modals.length, 1);
    assert.equal(modals[0].custom_id, "party:submit:" + gameId + ":1:0");
  } finally { restore(changes); }
});
