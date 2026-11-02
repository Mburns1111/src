import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import PartyGame from "../models/PartyGame.js";
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
        assert.equal(name, "game"); assert.equal(required, true);
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

test("party start slash command requires game selection, currently Court of Chaos", () => {
  const start = data.toJSON().options.find(x => x.name === "start");
  const option = start.options.find(x => x.name === "game");
  assert.equal(option.required, true);
  assert.equal(option.type, 3);
  assert.deepEqual(option.choices, [{ name: "Court of Chaos", value: "court" }]);
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

test("slash start also limits starting to the lobby creator", async () => {
  const game = lobby();
  await withLobby(game, async writes => {
    const other = fakeSlash(otherAdminId);
    await execute(other);
    assert.match(other.replies[0].content, /Only the admin who hosted/);
    assert.equal(writes.length, 0);

    const wrongGame = fakeSlash(hostId, "another-game");
    await execute(wrongGame);
    assert.match(wrongGame.replies[0].content, /Select Court of Chaos/);
    assert.equal(writes.length, 0);

    const host = fakeSlash(hostId);
    await execute(host);
    assert.match(host.replies[0].content, /Court of Chaos started/);
    assert.equal(writes.length, 1);
  });
});
