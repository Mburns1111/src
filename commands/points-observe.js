import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { requireGuild } from "./shared.js";
import { UserFacingError } from "./errors.js";
import ParticipationSource from "../models/ParticipationSource.js";
import NativePollParticipation from "../models/NativePollParticipation.js";
import PointsLedger from "../models/PointsLedger.js";
import { awardObservedPollVoters, pollEventKey, POLL_POINTS_PER_POLL } from "../services/poll-rewards.js";
import { messageVisibility, parseGuildMessageLink, publicEmbedDiagnostic, syncNativePoll } from "../services/participation-observer.js";
import { shouldRequestMessageContent } from "../services/observation-intents.js";

const arcloChoices = [
  { name: "Arclo poll", value: "arclo-poll" },
  { name: "Arclo giveaway", value: "arclo-giveaway" },
  { name: "Arclo results / participants panel", value: "arclo-panel" },
];
const sourceNames = {
  "discord-native-poll": "Native Discord poll",
  "arclo-poll": "Arclo poll",
  "arclo-giveaway": "Arclo giveaway",
  "arclo-panel": "Arclo results panel",
};

export const data = new SlashCommandBuilder()
  .setName("points-observe")
  .setDescription("Test Discord native poll tracking and visibility of Arclo posts")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(command => command.setName("inspect")
    .setDescription("Test what AM Isa can actually read at a Discord message link")
    .addStringOption(option => option.setName("link").setRequired(true)
      .setDescription("Discord link to the poll, giveaway, or results-panel message")))
  .addSubcommand(command => command.setName("register")
    .setDescription("Register one existing Arclo poll or giveaway for observation only")
    .addStringOption(option => option.setName("type").setRequired(true)
      .setDescription("Type of Arclo message").addChoices(...arcloChoices))
    .addStringOption(option => option.setName("link").setRequired(true)
      .setDescription("Discord link to the Arclo-authored message")))
  .addSubcommand(command => command.setName("voters")
    .setDescription("Show individual current voters and Points status for a native Discord poll")
    .addStringOption(option => option.setName("link").setRequired(true)
      .setDescription("Discord message link to the native poll")))
  .addSubcommand(command => command.setName("sync")
    .setDescription("Fetch current native Discord poll voters, including missed/restarted votes")
    .addStringOption(option => option.setName("link").setRequired(true)
      .setDescription("Discord message link to the native poll")))
  .addSubcommand(command => command.setName("report")
    .setDescription("Show tracked observations for one native or Arclo message")
    .addStringOption(option => option.setName("link").setRequired(true)
      .setDescription("Discord link to the tracked poll or giveaway")))
  .addSubcommand(command => command.setName("list")
    .setDescription("Show the latest registered polls and giveaways"));

function linkTo(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

async function findMessage(interaction, url) {
  const parsed = parseGuildMessageLink(url, interaction.guildId);
  if (!parsed) throw new UserFacingError(
    "Please paste a Discord message link from this server, not an Arclo dashboard URL.");
  const channel = await interaction.guild.channels.fetch(parsed.channelId).catch(() => null);
  if (!channel?.messages || typeof channel.messages.fetch !== "function") {
    throw new UserFacingError("AM Isa cannot view this channel. Give the test bot View Channel and Read Message History.");
  }
  let message;
  try {
    message = await channel.messages.fetch(parsed.messageId);
  } catch (error) {
    if ([10008, 50001, 50013].includes(Number(error?.code))) {
      throw new UserFacingError(
        "AM Isa could not read that message. A role allowing access to Arclo's web dashboard does not automatically grant Discord message access. Ephemeral results panels cannot be fetched by another bot.",
      );
    }
    throw error;
  }
  return { parsed, message };
}

export async function execute(interaction) {
  requireGuild(interaction);
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new UserFacingError("Only members with Manage Server may inspect poll and giveaway tracking.");
  }
  const command = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  if (command === "list") {
    const docs = await ParticipationSource.find({ guildId })
      .sort({ updatedAt: -1 }).limit(12).lean();
    await interaction.editReply({
      content: docs.length
        ? "**Poll and giveaway observations (no Points awarded)**\n" +
          docs.map(entry => `• **${sourceNames[entry.source]}:** ${linkTo(guildId, entry.channelId, entry.messageId)}`).join("\n")
        : "No observed polls or registered Arclo messages yet. Native Discord poll votes start tracking once this test bot is running. You can manually register an Arclo message.",
      allowedMentions: { parse: [] },
    });
    return;
  }

  const link = interaction.options.getString("link", true);
  if (command === "report") {
    const parsed = parseGuildMessageLink(link, guildId);
    if (!parsed) throw new UserFacingError("Use a Discord message link from this server.");
    const entry = await ParticipationSource.findOne({
      guildId, messageId: parsed.messageId, channelId: parsed.channelId,
    }).lean();
    if (!entry) throw new UserFacingError(
      "No observation exists yet. For a native Discord poll use /points-observe sync with this message link; for Arclo use register.");
    let result = `**${sourceNames[entry.source]}**\n${linkTo(guildId, entry.channelId, entry.messageId)}\n`;
    if (entry.source === "discord-native-poll") {
      const members = await NativePollParticipation.countDocuments({
        guildId, messageId: entry.messageId, "answerIds.0": { $exists: true },
      });
      result += `**Currently observed voters:** ${members} unique members\n` +
        "One member choosing multiple answers still counts as one participant. " +
        "Only events received while the test bot was running are tracked; missed votes are not reconstructed.";
    } else {
      result += "**Individual participant verification:** Not available through Discord bot-to-bot interactions.\n" +
        "The Arclo message is registered, but its private Join/Vote button clicks and dashboard participant list are not accessible to AM Isa.";
    }
    await interaction.editReply({ content: result +
      "\n\n**Observation only:** 0 Points have been awarded.", allowedMentions: { parse: [] } });
    return;
  }

  if (command === "voters") {
    const parsed = parseGuildMessageLink(link, guildId);
    if (!parsed) throw new UserFacingError("Paste a Discord message link from this server.");
    const source = await ParticipationSource.findOne({
      guildId, messageId: parsed.messageId, channelId: parsed.channelId,
      source: "discord-native-poll",
    }).lean();
    if (!source) throw new UserFacingError("No observation yet. Use /points-observe sync first.");
    const voters = await NativePollParticipation.find({
      guildId, messageId: parsed.messageId, "answerIds.0": { $exists: true },
    }).select("discordUserId answerIds").sort({ discordUserId: 1 }).limit(31).lean();
    const shown = voters.slice(0, 30);
    const receipts = await PointsLedger.find({
      guildId, eventKey: pollEventKey(parsed.messageId),
      discordUserId: { $in: shown.map(v => v.discordUserId) },
    }).select("discordUserId amount").lean();
    const awarded = new Set(receipts.map(v => v.discordUserId));
    const lines = shown.map(v =>
      `• <@${v.discordUserId}> — Voted${awarded.has(v.discordUserId) ? ` · +${POLL_POINTS_PER_POLL} Points awarded` : " · No reward recorded"}`);
    await interaction.editReply({ content:
      `**Native poll participants**\n${linkTo(guildId, parsed.channelId, parsed.messageId)}\n` +
      `Rewards: **${source.rewardEnabled ? "Enabled" : "Not approved / disabled"}**\n` +
      `**Current voters shown: ${shown.length}${voters.length > 30 ? " (first 30 only)" : ""}**\n` +
      (lines.length ? lines.join("\n") : "No active votes recorded.") +
      "\n\nRemoving a vote removes a member from this current-voter list but doesn't refund an award already earned.",
      allowedMentions: { parse: [] },
    });
    return;
  }

  const { parsed, message } = await findMessage(interaction, link);
  if (command === "sync") {
    if (!message.poll) throw new UserFacingError(
      "That message does not contain a visible native Discord poll. Arclo polls are not supported by this command.");
    let result;
    try {
      result = await syncNativePoll(message);
    } catch (error) {
      if (/not a readable native Discord|no readable answers|exceeds the safe voter sync limit/.test(error.message)) {
        throw new UserFacingError(error.message);
      }
      console.error("[Points observe] Native poll voter sync failed:", error);
      throw new UserFacingError(
        "Discord could not provide the poll voter list. Check AM Isa's View Channel/Read Message History permissions and test bot logs. No Points were awarded.");
    }
    // A staff-requested sync can recover missed payouts, but only after an
    // explicit poll approval. All credits use the exact same idempotent ledger
    // key as live vote events and respect the per-member 15-Point weekly cap.
    let payout;
    try {
      payout = await awardObservedPollVoters({
        guildId, channelId: parsed.channelId, messageId: parsed.messageId,
        guild: interaction.guild,
      });
    } catch (error) {
      console.error("[Points observe] Poll sync succeeded but rewards require review:", error);
      payout = { approved: true, failed: true };
    }
    await interaction.editReply({
      content: `**Native Discord poll synced**\n${linkTo(guildId, parsed.channelId, parsed.messageId)}\n` +
        `**Currently observed voters: ${result.voters} unique members** across ${result.answers} answers.\n` +
        `Fetched ${result.pages} voter page(s) directly from Discord. Re-running sync updates the current count after a removed vote.\n\n` +
        (payout.failed
          ? "**Rewards:** Some eligible credits need review; check test bot logs."
          : payout.approved
            ? `**Rewards:** +${payout.points} Points newly awarded to ${payout.credited} member(s); ${payout.skipped} skipped (already rewarded or capped).`
            : "**Rewards:** This poll is not approved, so no Points were awarded."),
      allowedMentions: { parse: [] },
    });
    return;
  }
  const details = messageVisibility(message);
  if (command === "inspect") {
    // Reveal a short view of PUBLIC embed structure, not private Arclo
    // interactions. This is visible only to the invoking server manager.
    const embedDetails = publicEmbedDiagnostic(message);
    const embedSummary = embedDetails.length
      ? "\n\n**Visible embed details (public message):**\n" +
        embedDetails.map(item =>
          `• Embed ${item.number}: ${item.title || "Untitled"}` +
          (item.description ? `\n  Preview: ${item.description}` : "") +
          `\n  Fields: ${item.fieldCount}` +
          (item.fieldLabels.length ? ` (${item.fieldLabels.join(", ")})` : "") +
          ` · Member mentions: ${item.mentionCount}`
        ).join("\n")
      : "";
    await interaction.editReply({
      content: `**AM Isa can read this Discord message's metadata**\n` +
        `Message: ${linkTo(guildId, parsed.channelId, parsed.messageId)}\n` +
        `Author: <@${details.authorId}> (${details.authorBot ? "bot" : "member"})\n` +
        `Embeds visible: ${details.embedCount} · Components visible: ${details.componentCount} · Text visible: ${details.hasContent ? "yes" : "no"} · Native poll object: ${details.nativePollVisible ? "yes" : "no"}\n\n` +
        embedSummary + "\n\n" +
        `**Message Content diagnostic requested:** ${shouldRequestMessageContent() ? "YES (check that the Discord Developer Portal toggle is enabled)" : "NO — set ENABLE_MESSAGE_CONTENT_INTENT=1 and enable the intent in the test app's Developer Portal"}\n\n` +
        "**Caution:** Being able to fetch a message does not prove AM Isa can see private giveaway entries, Arclo poll voters, or an ephemeral results panel. The Message Content privileged intent can expose public messages and their buttons, but cannot retrieve interactions sent to Arclo.",
      allowedMentions: { parse: [] },
    });
    return;
  }

  const type = interaction.options.getString("type", true);
  if (!arcloChoices.some(choice => choice.value === type)) {
    throw new UserFacingError("Unknown Arclo observation type.");
  }
  if (!details.authorBot || details.authorId === interaction.client.user.id) {
    throw new UserFacingError("Arclo messages must be authored by another bot, not a member or AM Isa.");
  }
  const previous = await ParticipationSource.findOne({
    guildId, source: { $in: arcloChoices.map(choice => choice.value) },
  }).lean();
  if (previous && previous.sourceBotId !== details.authorId) {
    throw new UserFacingError("This message belongs to a different bot than your previously registered Arclo messages. Check the source.");
  }
  const existing = await ParticipationSource.findOne({
    guildId, messageId: parsed.messageId,
  }).lean();
  if (existing && (existing.source === "discord-native-poll" ||
      existing.sourceBotId !== details.authorId || existing.source !== type)) {
    throw new UserFacingError("This message is already tracked as a different type or source.");
  }
  await ParticipationSource.updateOne(
    { guildId, messageId: parsed.messageId },
    { $setOnInsert: {
      guildId, channelId: parsed.channelId, messageId: parsed.messageId,
      source: type, sourceBotId: details.authorId, registeredBy: interaction.user.id,
    }, $set: { lastObservedAt: new Date() } },
    { upsert: true },
  );
  await interaction.editReply({
    content: `Registered **${sourceNames[type]}** for observation:\n` +
      linkTo(guildId, parsed.channelId, parsed.messageId) +
      `\nArclo source bot ID: ${details.authorId}.\n\n` +
      "**This does not verify individual votes or giveaway entries and will not award Points.** " +
      "Use /points-observe inspect to compare visibility, and /points-observe report to review what is verified.",
    allowedMentions: { parse: [] },
  });
}
