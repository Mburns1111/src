import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  ModalBuilder, PermissionFlagsBits, SlashCommandBuilder,
  TextInputBuilder, TextInputStyle,
} from "discord.js";
import PartyGame from "../models/PartyGame.js";
import PartyResponse from "../models/PartyResponse.js";
import { getConfiguredTextChannelAndConfig } from "./shared.js";
import {
  beginCourtGame, advanceCourtGame, courtGameDisplay,
  publishCourtGame, partyButton,
} from "../services/party-court-engine.js";
import { COURT_MIN_PLAYERS, COURT_MAX_PLAYERS } from "../services/party-court-rules.js";

export const data = new SlashCommandBuilder()
  .setName("party").setDescription("Staff-hosted, text-based Party Games")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(c => c.setName("host").setDescription("Open a Court of Chaos lobby in the configured Party Games channel")
    .addStringOption(o => o.setName("category").setDescription("Prompt category")
      .addChoices(
        { name: "Mixed", value: "mixed" }, { name: "Silly & Random", value: "silly" },
        { name: "Roblox & Adopt Me", value: "roblox" }, { name: "Fantasy & Chaos", value: "fantasy" }))
    .addBooleanOption(o => o.setName("rewards").setDescription("Award AM Isa Points to eligible players (default: yes)")))
  .addSubcommand(c => c.setName("start").setDescription("Start the current lobby"))
  .addSubcommand(c => c.setName("status").setDescription("Show the active game's private staff status"))
  .addSubcommand(c => c.setName("pause").setDescription("Pause the game's timer"))
  .addSubcommand(c => c.setName("resume").setDescription("Resume a paused game"))
  .addSubcommand(c => c.setName("extend").setDescription("Add 30 seconds to the current phase"))
  .addSubcommand(c => c.setName("skip").setDescription("Advance immediately to the next phase"))
  .addSubcommand(c => c.setName("remove-answer").setDescription("Remove a player's answer from the current round")
    .addUserOption(o => o.setName("player").setDescription("Player whose submission should be removed").setRequired(true)))
  .addSubcommand(c => c.setName("end").setDescription("Cancel the active game without rewards"));

function staff(interaction) {
  return Boolean(interaction.guildId && interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}
function errorText(message) { return { content: message, allowedMentions: { parse: [] } }; }
function timeLeft(game) {
  return game.phaseEndsAt ? Math.max(0, game.phaseEndsAt.getTime() - Date.now()) : 0;
}
async function activeGame(guildId) {
  return PartyGame.findOne({ guildId, active: true });
}
function updateGameVersion(game, update, guard = {}) {
  return PartyGame.updateOne({ _id: game._id, phase: game.phase, phaseEndsAt: game.phaseEndsAt, ...guard },
    { $set: update, $inc: { renderVersion: 1 } });
}

export async function execute(interaction) {
  if (!staff(interaction)) return interaction.editReply(errorText("Only staff with Manage Server can host Party Games."));
  const op = interaction.options.getSubcommand();
  if (op === "host") {
    // The destination is saved by /setup channels, never inferred from the
    // command's current channel. In particular, never post into general chat.
    const { channel } = await getConfiguredTextChannelAndConfig(
      interaction, "partyGamesChannelId", "Party Games",
    );
    let game;
    try {
      game = await PartyGame.create({
        guildId: interaction.guildId, channelId: channel.id,
        hostId: interaction.user.id,
        category: interaction.options.getString("category") || "mixed",
        rewardsEnabled: interaction.options.getBoolean("rewards") !== false,
      });
    } catch (error) {
      if (Number(error?.code) === 11000)
        return interaction.editReply(errorText("This server already has an active party lobby or game. Use /party status."));
      throw error;
    }
    try {
      const message = await channel.send(await courtGameDisplay(game));
      await PartyGame.updateOne({ _id: game._id }, { $set: { messageId: message.id, renderedVersion: 1 } });
      return interaction.editReply(errorText("Court of Chaos lobby created: " + message.url + ". Members can now join!"));
    } catch (error) {
      await PartyGame.updateOne({ _id: game._id }, {
        $set: { active: false, phase: "cancelled", finishedAt: new Date() },
      });
      throw error;
    }
  }
  const game = await activeGame(interaction.guildId);
  if (!game) return interaction.editReply(errorText("There is no active Party Game in this server."));
  if (op === "status") return interaction.editReply(errorText(
    "**Court of Chaos** · " + game.phase +
    "\nRound: " + game.round + "/3 · Players: " + game.players.length +
    "\nPaused: " + (game.paused ? "yes" : "no") +
    "\nTime left: " + Math.ceil(timeLeft(game) / 1000) + "s" +
    "\nMessage: https://discord.com/channels/" + game.guildId + "/" + game.channelId + "/" + game.messageId));
  let changed = false;
  if (op === "start") {
    if (game.phase !== "lobby") return interaction.editReply(errorText("The lobby has already started."));
    if (game.players.length < COURT_MIN_PLAYERS)
      return interaction.editReply(errorText("At least one player must join before starting."));
    changed = await beginCourtGame(game);
  } else if (op === "pause") {
    if (game.paused || !["answering","voting","reveal","intermission"].includes(game.phase))
      return interaction.editReply(errorText("This game cannot be paused now."));
    changed = (await updateGameVersion(game, { paused: true, remainingMs: timeLeft(game) }, { paused: false })).modifiedCount > 0;
  } else if (op === "resume") {
    if (!game.paused) return interaction.editReply(errorText("This game is not paused."));
    changed = (await updateGameVersion(game, {
      paused: false, phaseEndsAt: new Date(Date.now() + Math.max(1000, game.remainingMs)), remainingMs: 0,
    }, { paused: true })).modifiedCount > 0;
  } else if (op === "extend") {
    if (!["answering","voting"].includes(game.phase))
      return interaction.editReply(errorText("Extend is available during answering and voting."));
    changed = (await updateGameVersion(game, game.paused
      ? { remainingMs: game.remainingMs + 30_000 }
      : { phaseEndsAt: new Date(game.phaseEndsAt.getTime() + 30_000) })).modifiedCount > 0;
  } else if (op === "skip") {
    if (game.paused) return interaction.editReply(errorText("Resume before skipping a phase."));
    changed = await advanceCourtGame(game, { force: true });
  } else if (op === "remove-answer") {
    if (!["answering","voting"].includes(game.phase))
      return interaction.editReply(errorText("Answers can only be removed before their verdict."));
    const user = interaction.options.getUser("player", true);
    const idx = game.matchups.findIndex(match => match.playerIds.includes(user.id));
    if (idx < 0) return interaction.editReply(errorText("That player is not in this round."));
    if (game.phase === "voting" && (idx < game.batch * 2 || idx >= (game.batch + 1) * 2))
      return interaction.editReply(errorText("That matchup has already been scored or is not yet open."));
    const updated = await PartyResponse.updateOne({
      gameId: game._id, round: game.round, matchupIndex: idx, kind: "answer", userId: user.id,
    }, { $set: { text: "" } });
    if (updated.matchedCount) {
      await PartyGame.updateOne({ _id: game._id }, { $inc: { renderVersion: 1 } });
      changed = true;
    }
  } else if (op === "end") {
    changed = (await PartyGame.updateOne({ _id: game._id, active: true }, {
      $set: { active: false, phase: "cancelled", finishedAt: new Date(), phaseEndsAt: null },
      $inc: { renderVersion: 1 },
    })).modifiedCount > 0;
  }
  // The command was already deferred in index.js. Confirm the action before
  // waiting on Discord message edits; the persistent sweeper retries failures.
  const reply = await interaction.editReply(errorText(changed ? "Party Game updated." : "The game changed while processing. Check /party status."));
  if (changed) void publishCourtGame(interaction.client, game)
    .catch(error => console.error("[Party] Message refresh pending reconciliation:", error));
  return reply;
}

function loadGame(interaction, id) {
  if (!/^[0-9a-f]{24}$/i.test(id) || !interaction.guildId) return null;
  return PartyGame.findOne({ _id: id, guildId: interaction.guildId });
}
function privateReply(interaction, msg) {
  return interaction.reply({ ...errorText(msg), flags: MessageFlags.Ephemeral });
}

export async function handlePartyInteraction(interaction) {
  if (!interaction.isButton() && !interaction.isModalSubmit())
    return;
  const [prefix, action, gameId, roundText, matchupText, candidateId] = interaction.customId.split(":");
  if (prefix !== "party") return;
  // Show modals without a database round-trip. All eligibility, round and
  // deadline checks are performed again on the actual modal submission.
  if (action === "answer") {
    if (!/^[0-9a-f]{24}$/i.test(gameId) ||
        !Number.isInteger(Number(roundText)) || Number(roundText) < 1 ||
        !Number.isInteger(Number(matchupText)) || Number(matchupText) < 0)
      return privateReply(interaction, "This answer button has expired. Open My Prompt again.");
    const modal = new ModalBuilder()
      .setCustomId("party:submit:" + gameId + ":" + roundText + ":" + matchupText)
      .setTitle("Court of Chaos — Your Answer");
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId("answer").setLabel("Your funniest answer (160 characters)")
      .setStyle(TextInputStyle.Paragraph).setMinLength(1).setMaxLength(160).setRequired(true)));
    return interaction.showModal(modal);
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const game = await loadGame(interaction, gameId);
  if (!game || !game.messageId) return interaction.editReply(errorText("This party game is unavailable."));
  if (action === "join") {
    if (game.phase !== "lobby") return interaction.editReply(errorText("The lobby has closed."));
    const result = await PartyGame.updateOne({
      _id: game._id, phase: "lobby", players: { $ne: interaction.user.id },
      "players.19": { $exists: false },
    }, { $addToSet: { players: interaction.user.id }, $inc: { renderVersion: 1 } });
    const reply = await interaction.editReply(errorText(result.modifiedCount ? "You joined Court of Chaos!" :
      game.players.includes(interaction.user.id) ? "You're already in the lobby." : "The lobby is closed or full."));
    if (result.modifiedCount) void publishCourtGame(interaction.client, game)
      .catch(error => console.error("[Party] Lobby refresh will retry:", error));
    return reply;
  }
  if (action === "leave") {
    const result = await PartyGame.updateOne({
      _id: game._id, phase: "lobby", players: interaction.user.id,
    }, { $pull: { players: interaction.user.id }, $inc: { renderVersion: 1 } });
    const reply = await interaction.editReply(errorText(result.modifiedCount ? "You left the lobby." : "You're not in the lobby."));
    if (result.modifiedCount) void publishCourtGame(interaction.client, game)
      .catch(error => console.error("[Party] Lobby refresh will retry:", error));
    return reply;
  }
  if (action === "prompt") {
    if (game.phase !== "answering" || game.paused || timeLeft(game) <= 0)
      return interaction.editReply(errorText("The answering phase isn't open."));
    const match = game.matchups.find(m => m.playerIds.includes(interaction.user.id));
    if (!match) return interaction.editReply(errorText("You're spectating. Players can only join before a game starts."));
    const idx = game.matchups.indexOf(match);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setCustomId(partyButton(game, "answer", game.round + ":" + idx))
      .setLabel("Submit or Edit Answer").setStyle(ButtonStyle.Primary));
    return interaction.editReply({
      content: "**Your private prompt:** " + match.prompt + "\nSubmit before the round ends.",
      components: [row], allowedMentions: { parse: [] },
    });
  }
  if (action === "submit") {
    const round = Number(roundText), idx = Number(matchupText);
    const match = game.matchups[idx];
    if (!game || game.phase !== "answering" || game.paused || timeLeft(game) <= 0 ||
        round !== game.round || !match?.playerIds.includes(interaction.user.id))
      return interaction.editReply(errorText("Your answer window has closed."));
    const answer = interaction.fields.getTextInputValue("answer").trim();
    if (!answer || answer.length > 160 || /https?:\/\/|discord\.gg\/|@everyone|@here/i.test(answer))
      return interaction.editReply(errorText("Use 1–160 characters with no links or mass mentions."));
    await PartyResponse.findOneAndUpdate({
      gameId: game._id, guildId: game.guildId, round, matchupIndex: idx,
      kind: "answer", userId: interaction.user.id,
    }, { $set: { text: answer } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    return interaction.editReply(errorText("Your answer is saved! You may edit it until the deadline."));
  }
  if (action === "vote") {
    const round = Number(roundText), idx = Number(matchupText);
    const match = game.matchups[idx];
    if (game.phase !== "voting" || game.paused || timeLeft(game) <= 0 ||
        round !== game.round || !match || idx < game.batch * 2 || idx >= (game.batch + 1) * 2)
      return interaction.editReply(errorText("Voting is no longer open for this matchup."));
    if (!match.playerIds.includes(candidateId) || match.playerIds.includes(interaction.user.id))
      return interaction.editReply(errorText("You can't vote for yourself or in your own matchup."));
    const hasAnswer = await PartyResponse.exists({
      gameId: game._id, round, matchupIndex: idx, kind: "answer",
      userId: candidateId, text: { $ne: "" },
    });
    if (!hasAnswer) return interaction.editReply(errorText("That answer is unavailable."));
    await PartyResponse.findOneAndUpdate({
      gameId: game._id, guildId: game.guildId, round, matchupIndex: idx,
      kind: "vote", userId: interaction.user.id,
    }, { $set: { targetId: candidateId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    return interaction.editReply(errorText("Vote recorded! You may change it until voting ends."));
  }
  return interaction.editReply(errorText("That Party Game action has expired."));
}
