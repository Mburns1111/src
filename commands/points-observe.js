import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { requireGuild } from "./shared.js";
import { UserFacingError } from "./errors.js";
import ParticipationSource from "../models/ParticipationSource.js";
import NativePollParticipation from "../models/NativePollParticipation.js";
import { messageVisibility, parseGuildMessageLink } from "../services/participation-observer.js";
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
      "That message has not been observed yet. Vote in a native poll after starting the test bot, or register an Arclo post first.");
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

  const { parsed, message } = await findMessage(interaction, link);
  const details = messageVisibility(message);
  if (command === "inspect") {
    await interaction.editReply({
      content: `**AM Isa can read this Discord message's metadata**\n` +
        `Message: ${linkTo(guildId, parsed.channelId, parsed.messageId)}\n` +
        `Author: <@${details.authorId}> (${details.authorBot ? "bot" : "member"})\n` +
        `Embeds visible: ${details.embedCount} · Components visible: ${details.componentCount} · Text visible: ${details.hasContent ? "yes" : "no"} · Native poll object: ${details.nativePollVisible ? "yes" : "no"}\n\n` +
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
