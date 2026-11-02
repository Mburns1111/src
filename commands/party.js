import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder,
  TextInputBuilder, TextInputStyle,
} from "discord.js";
import PartyGame from "../models/PartyGame.js";
import PartyResponse from "../models/PartyResponse.js";
import { getConfiguredTextChannelAndConfig } from "./shared.js";
import {
  beginCourtGame, advanceCourtGame, startNextCourtRound, courtGameDisplay,
  publishCourtGame, partyButton,
} from "../services/party-court-engine.js";
import { COURT_MIN_PLAYERS, safeCourtText } from "../services/party-court-rules.js";
import { trackCourtAnswerPanel, closeCourtAnswerPanels } from "../services/party-private-panels.js";

export const data = new SlashCommandBuilder()
  .setName("party").setDescription("Staff-hosted, text-based Party Games")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(c => c.setName("host").setDescription("Choose a Party Game and create its signup lobby")
    .addStringOption(o => o.setName("game").setDescription("Game to host (or choose in the private game menu)")
      .addChoices({ name: "Court of Chaos", value: "court" }))
    .addStringOption(o => o.setName("category").setDescription("Prompt category")
      .addChoices(
        { name: "Mixed", value: "mixed" }, { name: "Silly & Random", value: "silly" },
        { name: "Roblox & Adopt Me", value: "roblox" }, { name: "Fantasy & Chaos", value: "fantasy" }))
    .addBooleanOption(o => o.setName("rewards").setDescription("Award AM Isa Points to eligible players (default: yes)")))
  .addSubcommand(c => c.setName("start").setDescription("Choose a Party Game, then open player signup")
    .addStringOption(o => o.setName("game").setDescription("Game to play (or choose in the private game menu)")
      .addChoices({ name: "Court of Chaos", value: "court" })))
  .addSubcommand(c => c.setName("next").setDescription("Start the next round after the 10-second break"))
  .addSubcommand(c => c.setName("prize").setDescription("Set the first-place prize announcement (delivered manually)")
    .addStringOption(o => o.setName("message").setDescription("Example: Winner receives a Mystery Egg from staff")
      .setRequired(true).setMaxLength(300)))
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

// The lobby's Start Party button alone launches Round 1. The /party start
// slash command only creates a joinable lobby; it never starts the timer.
async function startHostedLobby(interaction, game, requestedType = "court") {
  if (!staff(interaction) || interaction.user.id !== game.hostId)
    return { started: false, message: "Only the admin who hosted this party can start it." };
  if (requestedType !== "court" || (game.gameType || "court") !== requestedType)
    return { started: false, message: "This lobby is for Court of Chaos. Select Court of Chaos to start it." };
  if (game.phase !== "lobby")
    return { started: false, message: "The lobby has already started or closed." };
  if (game.players.length < COURT_MIN_PLAYERS)
    return { started: false, message: "At least one player must join before starting." };
  const started = await beginCourtGame(game);
  return { started, message: started ? "Court of Chaos started! Round 1 is open." :
    "This lobby was already started or changed. Check /party status." };
}

async function createPartySignup(interaction, selectedGame, category = "mixed", rewardsEnabled = true) {
  if (selectedGame !== "court")
    return interaction.editReply(errorText("That party game is not available yet."));
  const { channel } = await getConfiguredTextChannelAndConfig(
    interaction, "partyGamesChannelId", "Party Games",
  );
  let game;
  try {
    game = await PartyGame.create({
      guildId: interaction.guildId, channelId: channel.id,
      hostId: interaction.user.id, gameType: selectedGame,
      phase: "lobby", round: 0, players: [], phaseEndsAt: null,
      category, rewardsEnabled,
    });
  } catch (error) {
    if (Number(error?.code) === 11000)
      return interaction.editReply(errorText(
        "This server already has an active party lobby or game. Use /party status."));
    throw error;
  }
  try {
    const message = await channel.send(await courtGameDisplay(game));
    await PartyGame.updateOne({ _id: game._id },
      { $set: { messageId: message.id, renderedVersion: 1 } });
    return interaction.editReply({
      ...errorText("**Game selected: Court of Chaos**\nSignup lobby created: " + message.url +
        "\nMembers can Join or Leave. When everyone is ready, the host presses Start Party."),
      components: [],
    });
  } catch (error) {
    await PartyGame.updateOne({ _id: game._id },
      { $set: { active: false, phase: "cancelled", finishedAt: new Date() } });
    throw error;
  }
}

function partyGamePicker(interaction, category, rewardsEnabled) {
  return {
    ...errorText("**Choose your Party Game**\nSelect the game below to open its signup lobby. " +
      "The game will NOT start until you press **Start Party** after players join."),
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(["party", "pick", interaction.user.id, category, rewardsEnabled ? "1" : "0"].join(":"))
        .setPlaceholder("Select a game to host")
        .addOptions({ label: "Court of Chaos", value: "court",
          description: "Two funny prompts per player, then vote on each matchup" }),
    )],
  };
}

export async function execute(interaction) {
  if (!staff(interaction)) return interaction.editReply(errorText("Only staff with Manage Server can host Party Games."));
  const op = interaction.options.getSubcommand();
  if (op === "host" || op === "start") {
    // A game must be chosen, either via the slash option or the explicit
    // private dropdown. /party host no longer silently assumes Court.
    const selectedGame = interaction.options.getString("game");
    const category = op === "host" ? interaction.options.getString("category") || "mixed" : "mixed";
    const rewardsEnabled = op === "host" ? interaction.options.getBoolean("rewards") !== false : true;
    if (!selectedGame)
      return interaction.editReply(partyGamePicker(interaction, category, rewardsEnabled));
    return createPartySignup(interaction, selectedGame, category, rewardsEnabled);
  }
  const game = await activeGame(interaction.guildId);
  if (!game) return interaction.editReply(errorText("There is no active Party Game in this server."));
  if (op === "prize") {
    if (interaction.user.id !== game.hostId)
      return interaction.editReply(errorText("Only the original party host can set its first-place prize."));
    if (game.phase === "ended" || game.phase === "cancelled")
      return interaction.editReply(errorText("This party has already finished."));
    const message = interaction.options.getString("message", true).trim();
    if (!message || message.length > 300 || /@everyone|@here/i.test(message) ||
        /https?:\/\/|discord\.gg\//i.test(message))
      return interaction.editReply(errorText("Enter 1–300 characters without links or mass mentions."));
    const changed = await PartyGame.updateOne({
      _id: game._id, active: true, hostId: interaction.user.id,
    }, { $set: { prizeMessage: message }, $inc: { renderVersion: 1 } });
    if (changed.modifiedCount) void publishCourtGame(interaction.client, game)
      .catch(error => console.error("[Party] Prize display refresh will retry:", error));
    return interaction.editReply(errorText(changed.modifiedCount
      ? "🏆 First-place prize message saved. The final results will display it; staff must deliver the prize manually."
      : "The party changed before the prize could be saved."));
  }
  if (op === "status") {
    const savedCount = game.phase === "answering" ?
      await PartyResponse.countDocuments({ gameId: game._id, round: game.round,
        kind: "answer", text: { $nin: ["", null] } }) : null;
    return interaction.editReply(errorText(
      "**Court of Chaos** · " + game.phase +
      "\nRound: " + game.round + "/3 · Players: " + game.players.length +
      (savedCount === null ? "" : "\nSaved submissions: " + savedCount + "/" + (game.players.length * 2)) +
      "\nPaused: " + (game.paused ? "yes" : "no") +
      "\nTime left: " + Math.ceil(timeLeft(game) / 1000) + "s" +
      "\nMessage: https://discord.com/channels/" + game.guildId + "/" + game.channelId + "/" + game.messageId));
  }
  let changed = false;
  if (op === "next") {
    if (game.phase !== "intermission")
      return interaction.editReply(errorText("The next round can only start after the current round finishes."));
    if (game.phaseEndsAt && game.phaseEndsAt.getTime() > Date.now())
      return interaction.editReply(errorText("The 10-second break is not over yet."));
    changed = await startNextCourtRound(game);
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
    if (game.phase === "intermission")
      return interaction.editReply(errorText("Use /party next or Start Next Round to begin the next round."));
    changed = await advanceCourtGame(game, { force: true });
  } else if (op === "remove-answer") {
    if (!["answering","voting"].includes(game.phase))
      return interaction.editReply(errorText("Answers can only be removed before their verdict."));
    const user = interaction.options.getUser("player", true);
    const idx = game.matchups.findIndex(match => match.playerIds.includes(user.id));
    if (idx < 0) return interaction.editReply(errorText("That player is not in this round."));
    if (game.phase === "voting" && idx !== game.batch)
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
  if (changed && op === "end") await closeCourtAnswerPanels(game._id, game.round);
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

// A modal opened from a button on a private prompt panel can UPDATE that
// panel instead of adding a second ephemeral "saved" reply. When the modal
// has no originating message (older Discord clients / direct modal tests),
// fall back to a regular private acknowledgement.
async function acknowledgePartyInteraction(interaction, action) {
  if (action === "submit" && interaction.isFromMessage?.() && interaction.deferUpdate) {
    await interaction.deferUpdate();
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

export async function privateCourtPromptPanel(game, userId, note = "") {
  const matches = game.matchups
    .map((match, idx) => ({ match, idx }))
    .filter(({ match }) => match.playerIds.includes(userId));
  if (!matches.length) return errorText(
    "You're spectating. Players can only join before a game starts.");
  const records = await PartyResponse.find({
    gameId: game._id, round: game.round, kind: "answer", userId,
  }).lean();
  const open = game.phase === "answering" && !game.paused && timeLeft(game) > 0;
  const lines = ["**Your two private prompts — Round " + game.round + "**"];
  if (note) lines.push(note);
  const buttons = [];
  for (const [number, { match, idx }] of matches.entries()) {
    const answer = records.find(a => a.matchupIndex === idx)?.text;
    lines.push("", "**Question " + (number + 1) + ":** " + safeCourtText(match.prompt),
      answer ? "✅ Your saved answer: " + safeCourtText(answer) : "⚠️ No answer saved yet.");
    if (open) buttons.push(new ButtonBuilder()
      .setCustomId(partyButton(game, "answer", game.round + ":" + idx))
      .setLabel((answer ? "Edit" : "Answer") + " Question " + (number + 1))
      .setStyle(answer ? ButtonStyle.Success : ButtonStyle.Primary));
  }
  lines.push(open
    ? "Answering closes " + "<t:" + Math.ceil(game.phaseEndsAt.getTime() / 1000) + ":R>."
    : "Entries are closed. These answers are shown for reference.");
  return {
    content: lines.join("\n"),
    components: buttons.length ? [new ActionRowBuilder().addComponents(...buttons)] : [],
    allowedMentions: { parse: [] },
  };
}

export async function handlePartyInteraction(interaction) {
  if (!interaction.isButton() && !interaction.isModalSubmit() &&
      !interaction.isStringSelectMenu()) return;
  const [prefix, action, gameId, roundText, matchupText, candidateId] = interaction.customId.split(":");
  if (prefix !== "party") return;
  if (action === "pick") {
    // Update the original private menu rather than leaving an active selector behind.
    await interaction.deferUpdate();
    if (!interaction.isStringSelectMenu() || !staff(interaction) ||
        interaction.user.id !== gameId)
      return interaction.editReply(errorText("Only the staff member who opened this game picker can select the game."));
    const selected = interaction.values?.[0];
    if (selected !== "court")
      return interaction.editReply(errorText("That party game is not available yet."));
    const category = ["mixed", "silly", "roblox", "fantasy"].includes(roundText) ? roundText : "mixed";
    return createPartySignup(interaction, selected, category, matchupText !== "0");
  }
  if (action === "join") {
    // A successful join is already visible in the updated public lobby embed.
    // Acknowledge the button silently without adding an ephemeral "You joined".
    await interaction.deferUpdate();
    const game = await loadGame(interaction, gameId);
    if (!game || !game.messageId || game.phase !== "lobby")
      return interaction.followUp({
        ...errorText("This signup lobby is no longer open."),
        flags: MessageFlags.Ephemeral,
      });
    const result = await PartyGame.updateOne({
      _id: game._id, phase: "lobby", players: { $ne: interaction.user.id },
      "players.19": { $exists: false },
    }, { $addToSet: { players: interaction.user.id }, $inc: { renderVersion: 1 } });
    if (!result.modifiedCount)
      return interaction.followUp({
        ...errorText(game.players.includes(interaction.user.id)
          ? "You're already in the lobby." : "The lobby is closed or full."),
        flags: MessageFlags.Ephemeral,
      });
    void publishCourtGame(interaction.client, game)
      .catch(error => console.error("[Party] Lobby refresh will retry:", error));
    return;
  }
  if (action === "start" || action === "next") {
    // Just update the public lobby/standings. There is no need for a
    // second private "Round started" message when the new round is visible.
    await interaction.deferUpdate();
    const game = await loadGame(interaction, gameId);
    let errorMessage = "";
    let started = false;
    if (!game?.messageId) errorMessage = "This party game is unavailable.";
    else if (!staff(interaction)) errorMessage = "Only staff can start a round.";
    else if (action === "start") {
      const result = await startHostedLobby(interaction, game);
      started = result.started;
      if (!started) errorMessage = result.message;
    } else if (game.phase !== "intermission" || Number(roundText) !== game.round) {
      errorMessage = "This next-round button is no longer active.";
    } else if (game.phaseEndsAt && game.phaseEndsAt.getTime() > Date.now()) {
      errorMessage = "The 10-second intermission is still running.";
    } else {
      started = await startNextCourtRound(game);
      if (!started) errorMessage = "The next round has already started or the game changed.";
    }
    if (!started) return interaction.followUp({
      ...errorText(errorMessage), flags: MessageFlags.Ephemeral,
    });
    void publishCourtGame(interaction.client, game)
      .catch(error => console.error("[Party] Round publication will retry:", error));
    return;
  }
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
  await acknowledgePartyInteraction(interaction, action);
  const game = await loadGame(interaction, gameId);
  if (!game || !game.messageId) return interaction.editReply(errorText("This party game is unavailable."));
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
    const reply = await interaction.editReply(await privateCourtPromptPanel(game, interaction.user.id));
    trackCourtAnswerPanel(game, interaction);
    return reply;
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
    // Confirm the database returned the stored value. Never tell a player
    // their submission was saved if the write did not succeed.
    const saved = await PartyResponse.findOneAndUpdate({
      gameId: game._id, guildId: game.guildId, round, matchupIndex: idx,
      kind: "answer", userId: interaction.user.id,
    }, { $set: { text: answer } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    if (!saved || saved.text !== answer) {
      console.error("[Party] Answer write was not confirmed", { gameId, round, idx });
      return interaction.editReply(errorText("⚠️ Your answer was NOT confirmed. Please try submitting it again."));
    }
    console.log("[Party] Answer saved", { gameId, round, idx });
    // One up-to-date private panel replaces two contradictory ephemeral
    // messages, showing BOTH answers and the remaining time.
    return interaction.editReply(await privateCourtPromptPanel(game, interaction.user.id,
      "✅ **Saved for Round " + round + "!** Question " +
      (game.matchups.filter(m => m.playerIds.includes(interaction.user.id))
        .findIndex(m => m === match) + 1) + " recorded."));
  }
  if (action === "vote") {
    const round = Number(roundText), idx = Number(matchupText);
    const match = game.matchups[idx];
    if (game.phase !== "voting" || game.paused || timeLeft(game) <= 0 ||
        round !== game.round || !match || idx !== game.batch)
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
