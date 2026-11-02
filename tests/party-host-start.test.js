import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import PartyGame from "../models/PartyGame.js";
import GuildConfig from "../models/GuildConfig.js";
import { data, execute, handlePartyInteraction } from "../commands/party.js";
import { courtGameDisplay } from "../services/party-court-engine.js";

const gameId = "507f1f77bcf86cd799439011";
const guildId = "123456789012345678";
const hostId = "234567890123456789";
const otherAdminId = "345678901234567890";
const playerId = "456789012345678901";
function lobby(players = [playerId]) {
  return {
    _id: gameId, guildId, channelId: "567890123456789012",
    messageId: "678901234567890123", hostId,
    gameType: "court", phase: "lobby", active: true,
    players, round: 0, category: "mixed", batch: 0,
    matchups: [], usedPromptIds: [], phaseEndsAt: null,
    renderVersion: 1, renderedVersion: 1,
  };
}
function permitted() { return { has: flag => flag === PermissionFlagsBits.ManageGuild }; }
function fakeButton(game, userId, isAdmin = true) {
  const replies = [];
  return {
    guildId, customId: "party:start:" + game._id,
    isButton: () => true, isModalSubmit: () => false,
    user: { id: userId },
    memberPermissions: isAdmin ? permitted() : { has: () => false },
    deferReply: async () => {}, editReply: async reply => { replies.push(reply); },
    replies, client: {},
  };
}
function fakeSlash(userId, selected = "court") {
  const replies = [];
  return {
    guildId, user: { id: userId }, memberPermissions: permitted(),
    options: {
      getSubcommand: () => "start",
      getString: (name, required) => {
        assert.equal(name, "game"); assert.equal(required, undefined);
        return selected;
      },
    },
    editReply: async reply => { replies.push(reply); },
    replies, client: {},
  };
}
async function withLobby(game, handler) {
  const saved = [];
  for (const [key, replacement] of [
    ["findOne", async () => game],
    ["updateOne", async (filter, update) => {
      writes.push({ filter, update }); return { modifiedCount: 1 };
    }],
    ["findOneAndUpdate", async () => null],
  ]) { saved.push([key, PartyGame[key]]); PartyGame[key] = replacement; }
  const writes = [];
  try { await handler(writes); await Promise.resolve(); }
  finally { for (const [key, value] of saved.reverse()) PartyGame[key] = value; }
}

test("party start slash command provides a game field with an explicit private picker fallback", () => {
  const start = data.toJSON().options.find(x => x.name === "start");
  const option = start.options.find(x => x.name === "game");
  assert.notEqual(option.required, true);
  assert.equal(option.type, 3);
  assert.equal(option.choices.length, 1);
  assert.equal(option.choices[0].name, "Court of Chaos");
  assert.equal(option.choices[0].value, "court");
});

test("lobby displays Join, Leave and Start Party for the original host", async () => {
  const view = await courtGameDisplay(lobby());
  assert.deepEqual(view.components[0].components.map(x => x.data.label),
    ["Join", "Leave", "Start Party"]);
  assert.ok(view.components[0].components[2].data.custom_id === "party:start:" + gameId);
  assert.match(view.content, new RegExp(hostId));
  assert.match(view.content, /Only the host can start/);
});

test("lobby button refuses another admin and regular members without changing game", async () => {
  const game = lobby();
  await withLobby(game, async writes => {
    for (const [id, admin] of [[otherAdminId, true], [playerId, false]]) {
      const interaction = fakeButton(game, id, admin);
      await handlePartyInteraction(interaction);
      assert.match(interaction.replies[0].content, /Only the admin who hosted/);
    }
    assert.equal(writes.length, 0);
  });
});

test("host button starts a nonempty lobby exactly once and acknowledges privately", async () => {
  const game = lobby();
  await withLobby(game, async writes => {
    const interaction = fakeButton(game, hostId);
    await handlePartyInteraction(interaction);
    assert.match(interaction.replies[0].content, /Court of Chaos started/);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].filter.phase, "lobby");
    assert.equal(writes[0].update.$set.phase, "answering");
    assert.equal(writes[0].update.$set.round, 1);
    assert.equal(writes[0].update.$set.matchups.length, 2);
  });
});

test("host button rejects an empty lobby and an already-started lobby", async () => {
  for (const game of [lobby([]), { ...lobby(), phase: "answering" }]) {
    await withLobby(game, async writes => {
      const interaction = fakeButton(game, hostId);
      await handlePartyInteraction(interaction);
      assert.match(interaction.replies[0].content, game.players.length ? /already started/ : /At least one player/);
      assert.equal(writes.length, 0);
    });
  }
});

test("/party start game:Court of Chaos opens signup without starting Round 1", async () => {
  const originalFind = GuildConfig.findOne;
  const originalCreate = PartyGame.create;
  const originalUpdate = PartyGame.updateOne;
  const created = [], updates = [], posts = [];
  const channelId = "567890123456789012";
  try {
    GuildConfig.findOne = async () => ({ partyGamesChannelId: channelId });
    PartyGame.create = async doc => {
      created.push(doc);
      return { ...lobby([]), ...doc, phase: "lobby", players: [] };
    };
    PartyGame.updateOne = async (filter, update) => {
      updates.push({ filter, update });
      return { modifiedCount: 1 };
    };
    const interaction = fakeSlash(hostId);
    interaction.guild = { channels: { fetch: async id => {
      assert.equal(id, channelId);
      return {
        id, isTextBased: () => true,
        send: async payload => {
          posts.push(payload);
          return { id: "999999999999999999", url: "https://discord.com/channels/example/lobby" };
        },
      };
    } } };
    await execute(interaction);
    assert.equal(created.length, 1);
    assert.equal(created[0].gameType, "court");
    assert.equal(created[0].hostId, hostId);
    assert.equal(created[0].channelId, channelId);
    assert.deepEqual(created[0].players, [], "Signup begins with an empty player list.");
    assert.equal(created[0].phase, "lobby", "Slash start must NOT launch Round 1.");
    assert.equal(created[0].round, 0);
    assert.equal(created[0].phaseEndsAt, null, "Signup has no countdown or automatic expiry.");
    assert.equal(posts.length, 1);
    assert.match(posts[0].content, /Lobby/);
    assert.deepEqual(posts[0].components[0].components.map(x => x.data.label),
      ["Join", "Leave", "Start Party"]);
    assert.equal(updates.length, 1);
    assert.deepEqual(Object.keys(updates[0].update.$set).sort(), ["messageId", "renderedVersion"]);
    assert.match(interaction.replies[0].content, /Signup lobby created/i);
    assert.match(interaction.replies[0].content, /Members can Join or Leave/);
    assert.doesNotMatch(interaction.replies[0].content, /Round 1 is open/);
  } finally {
    GuildConfig.findOne = originalFind;
    PartyGame.create = originalCreate;
    PartyGame.updateOne = originalUpdate;
  }
});

test("/party start with unsupported game does not create or launch a lobby", async () => {
  const originalCreate = PartyGame.create;
  const originalFind = GuildConfig.findOne;
  try {
    PartyGame.create = async () => assert.fail("No lobby should be created");
    GuildConfig.findOne = async () => assert.fail("No lookup should be needed");
    const interaction = fakeSlash(hostId, "unavailable");
    await execute(interaction);
    assert.match(interaction.replies[0].content, /not available yet/);
  } finally {
    PartyGame.create = originalCreate;
    GuildConfig.findOne = originalFind;
  }
});

test("/party start without game opens a private selector before creating any lobby", async () => {
  const originalCreate = PartyGame.create;
  const originalFind = GuildConfig.findOne;
  try {
    PartyGame.create = async () => assert.fail("No lobby before game selection");
    GuildConfig.findOne = async () => assert.fail("No configuration lookup before selection");
    const interaction = fakeSlash(hostId, null);
    await execute(interaction);
    const view = interaction.replies[0];
    assert.match(view.content, /Choose your Party Game/);
    assert.match(view.content, /will NOT start until/);
    assert.equal(view.components.length, 1);
    const menu = view.components[0].components[0].toJSON();
    assert.equal(menu.type, 3);
    assert.equal(menu.options.length, 1);
    assert.equal(menu.options[0].label, "Court of Chaos");
    assert.equal(menu.options[0].value, "court");
    assert.ok(menu.custom_id.startsWith("party:pick:" + hostId + ":"));
  } finally {
    PartyGame.create = originalCreate;
    GuildConfig.findOne = originalFind;
  }
});

test("/party host without game cannot silently pick Court of Chaos", async () => {
  const originalCreate = PartyGame.create;
  try {
    PartyGame.create = async () => assert.fail("Must choose a game first");
    const interaction = fakeSlash(hostId, null);
    interaction.options = {
      getSubcommand: () => "host",
      getString: () => null,
      getBoolean: () => null,
    };
    await execute(interaction);
    assert.match(interaction.replies[0].content, /Choose your Party Game/);
    assert.equal(interaction.replies[0].components[0].components[0].toJSON().options[0].value, "court");
  } finally {
    PartyGame.create = originalCreate;
  }
});

test("picker selection by its creator opens the signup lobby, not Round 1", async () => {
  const originalFind = GuildConfig.findOne;
  const originalCreate = PartyGame.create;
  const originalUpdate = PartyGame.updateOne;
  const sent = [], created = [], responses = [];
  try {
    GuildConfig.findOne = async () => ({ partyGamesChannelId: "567890123456789012" });
    PartyGame.create = async doc => {
      created.push(doc);
      return { ...lobby([]), ...doc, _id: gameId, players: [], phase: "lobby" };
    };
    PartyGame.updateOne = async (_filter, update) => {
      assert.deepEqual(Object.keys(update.$set).sort(), ["messageId", "renderedVersion"]);
      return { modifiedCount: 1 };
    };
    await handlePartyInteraction({
      guildId,
      customId: "party:pick:" + hostId + ":silly:0",
      user: { id: hostId },
      memberPermissions: permitted(),
      isButton: () => false, isModalSubmit: () => false, isStringSelectMenu: () => true,
      values: ["court"],
      deferReply: async () => {},
      editReply: async value => responses.push(value),
      guild: { channels: { fetch: async () => ({
        id: "567890123456789012", isTextBased: () => true,
        send: async payload => {
          sent.push(payload);
          return { id: "999999999999999999", url: "https://discord.com/channels/example/signup" };
        },
      }) } },
    });
    assert.equal(created.length, 1);
    assert.equal(created[0].category, "silly");
    assert.equal(created[0].rewardsEnabled, false);
    assert.deepEqual(created[0].players, []);
    assert.equal(created[0].phase, "lobby");
    assert.equal(created[0].phaseEndsAt, null);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].components[0].components.map(x => x.data.label),
      ["Join", "Leave", "Start Party"]);
    assert.match(responses[0].content, /Game selected: Court of Chaos/);
  } finally {
    GuildConfig.findOne = originalFind;
    PartyGame.create = originalCreate;
    PartyGame.updateOne = originalUpdate;
  }
});

test("another member cannot use the creator's game selector", async () => {
  const originalCreate = PartyGame.create;
  const responses = [];
  try {
    PartyGame.create = async () => assert.fail("Another member cannot create through old picker");
    await handlePartyInteraction({
      guildId, customId: "party:pick:" + hostId + ":mixed:1",
      user: { id: otherAdminId }, memberPermissions: permitted(),
      isButton: () => false, isModalSubmit: () => false, isStringSelectMenu: () => true,
      values: ["court"], deferReply: async () => {},
      editReply: async value => responses.push(value),
    });
    assert.match(responses[0].content, /Only the staff member who opened/);
  } finally {
    PartyGame.create = originalCreate;
  }
});
