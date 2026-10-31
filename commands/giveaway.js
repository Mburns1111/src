import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import Giveaway from "../models/Giveaway.js";
import {
  GIVEAWAY_MAX_MINUTES, giveawayAnnouncement, joinGiveaway, leaveGiveaway,
  closeGiveaway, rerollGiveaway, publishGiveawayResult,
} from "../services/giveaways.js";

export const data = new SlashCommandBuilder()
  .setName("giveaway").setDescription("Host giveaways that retain their winners and prize details")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(c => c.setName("start").setDescription("Post a new button-entry giveaway")
    .addStringOption(o => o.setName("title").setDescription("Giveaway title").setRequired(true).setMinLength(2).setMaxLength(100))
    .addStringOption(o => o.setName("prize").setDescription("Prize details, including multiple ranked prizes").setRequired(true).setMinLength(2).setMaxLength(1500))
    .addIntegerOption(o => o.setName("minutes").setDescription("How many minutes it stays open (up to 14 days)").setRequired(true).setMinValue(1).setMaxValue(GIVEAWAY_MAX_MINUTES))
    .addIntegerOption(o => o.setName("winners").setDescription("Number of winners (default 1)").setMinValue(1).setMaxValue(10))
    .addStringOption(o => o.setName("rules").setDescription("Optional requirements or entry instructions").setMaxLength(1200))
    .addChannelOption(o => o.setName("channel").setDescription("Where to post (default: this channel)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption(o => o.setName("role").setDescription("Optional required role for members entering")))
  .addSubcommand(c => c.setName("end").setDescription("End a giveaway early and retain its results")
    .addStringOption(o => o.setName("id").setDescription("Giveaway ID or message link/ID").setRequired(true)))
  .addSubcommand(c => c.setName("reroll").setDescription("Replace one winner, preserving original and reroll history")
    .addStringOption(o => o.setName("id").setDescription("Giveaway ID or message link/ID").setRequired(true))
    .addIntegerOption(o => o.setName("winner").setDescription("Winner number to replace, starting with 1").setRequired(true).setMinValue(1).setMaxValue(10)))
  .addSubcommand(c => c.setName("list").setDescription("Show recent giveaways and their saved IDs"));

const linkTo = record => `https://discord.com/channels/${record.guildId}/${record.channelId}/${record.messageId}`;

async function findGiveaway(reference, guildId) {
  const ref = String(reference || "").trim();
  let id = null, messageId = null;
  if (/^[0-9a-f]{24}$/i.test(ref)) id = ref;
  else if (/^\d{17,20}$/.test(ref)) messageId = ref;
  else {
    const match = /^https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})(?:\/)?(?:\?.*)?$/.exec(ref);
    if (!match || match[1] !== guildId) throw Error("Use a giveaway ID or a giveaway message link from this server.");
    messageId = match[3];
  }
  return Giveaway.findOne({ guildId, ...(id ? { _id: id } : { messageId }) }).lean();
}

export async function execute(interaction) {
  if (!interaction.guild || !interaction.guildId ||
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return interaction.editReply("Only members with Manage Server can manage giveaways.");
  const operation = interaction.options.getSubcommand();
  try {
    if (operation === "start") {
      const channel = interaction.options.getChannel("channel") || interaction.channel;
      if (!channel || typeof channel.send !== "function" || channel.guildId !== interaction.guildId)
        throw Error("Choose a writable server text channel to publish the giveaway.");
      const minutes = interaction.options.getInteger("minutes", true);
      const winnerCount = interaction.options.getInteger("winners") || 1;
      const record = await Giveaway.create({
        guildId: interaction.guildId, channelId: channel.id,
        creatorId: interaction.user.id,
        title: interaction.options.getString("title", true).trim(),
        prize: interaction.options.getString("prize", true).trim(),
        rules: interaction.options.getString("rules")?.trim() || "",
        requiredRoleId: interaction.options.getRole("role")?.id || "",
        winnerCount, endsAt: new Date(Date.now() + minutes * 60_000),
        status: "publishing",
      });
      let message;
      try {
        message = await channel.send(giveawayAnnouncement({ ...record.toObject(), status: "open" }));
        await Giveaway.updateOne(
          { _id: record._id, status: "publishing" },
          { $set: { status: "open", messageId: message.id } },
        );
      } catch (error) {
        await Giveaway.updateOne({ _id: record._id }, { $set: { status: "failed" } }).catch(() => {});
        if (message) await message.delete().catch(() => {});
        throw error;
      }
      return interaction.editReply(`🥀 Giveaway posted: ${message.url}\nSaved giveaway ID: \`${record._id}\`\nThe announcement and results will stay visible after it ends.`);
    }

    if (operation === "list") {
      const records = await Giveaway.find({ guildId: interaction.guildId, status: { $ne: "failed" } })
        .sort({ createdAt: -1 }).limit(10).lean();
      return interaction.editReply({
        content: records.length
          ? "**Recent Giveaways**\n" + records.map(record =>
              `• **${record.title.replace(/[@*_`~|<>]/g, "")}** · ${record.status} · \`${record._id}\` ${record.messageId ? linkTo(record) : "(pending)"}`).join("\n")
          : "No giveaways have been created yet.",
        allowedMentions: { parse: [] },
      });
    }
    const record = await findGiveaway(interaction.options.getString("id", true), interaction.guildId);
    if (!record) throw Error("Giveaway not found in this server.");
    let updated;
    if (operation === "end") {
      if (record.status === "publishing" || record.status === "failed") throw Error("This giveaway was never published.");
      updated = await closeGiveaway({ id: record._id, guildId: interaction.guildId });
      if (updated?.status === "rerolling") throw Error("Wait for the current reroll to finish.");
    } else if (operation === "reroll") {
      updated = await rerollGiveaway({
        id: record._id, guildId: interaction.guildId, staffId: interaction.user.id,
        slot: interaction.options.getInteger("winner", true) - 1,
      });
    } else throw Error("Unknown giveaway action.");
    if (!updated || updated.status !== "ended") throw Error("Giveaway is being finalized; please check again.");
    try {
      await publishGiveawayResult(interaction.client, updated);
      return interaction.editReply({
        content: `Giveaway results saved and the original announcement updated: ${linkTo(updated)}`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error("[Giveaways] Results saved but message edit failed:", error);
      return interaction.editReply("The results were **saved in the database**, but I couldn't update the public post. Check my channel permissions; the bot will retry on its next cleanup pass.");
    }
  } catch (error) {
    console.error("[Giveaways] Staff command failed:", error);
    return interaction.editReply({ content: error.message || "Giveaway action failed.", allowedMentions: { parse: [] } });
  }
}

export async function handleGiveawayButton(interaction) {
  if (!interaction.guildId || !interaction.guild || interaction.user.bot)
    return interaction.reply({ content: "Giveaway entries are only available to server members.", flags: MessageFlags.Ephemeral });
  const match = /^giveaway:(enter|leave):([0-9a-f]{24})$/.exec(interaction.customId);
  if (!match) return interaction.reply({ content: "Invalid giveaway button.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [, action, id] = match;
  try {
    const record = await Giveaway.findOne({ _id: id, guildId: interaction.guildId }).lean();
    if (!record || record.messageId !== interaction.message?.id || record.channelId !== interaction.channelId)
      return interaction.editReply("This giveaway announcement could not be verified.");
    if (record.status !== "open" || new Date(record.endsAt) <= new Date())
      return interaction.editReply("This giveaway has ended; its results will stay on the original post.");
    if (action === "enter" && record.requiredRoleId) {
      const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
      if (!member?.roles?.cache?.has(record.requiredRoleId))
        return interaction.editReply(`You need the <@&${record.requiredRoleId}> role to join this giveaway.`);
    }
    const result = action === "enter"
      ? await joinGiveaway({ id, guildId: interaction.guildId, userId: interaction.user.id })
      : await leaveGiveaway({ id, guildId: interaction.guildId, userId: interaction.user.id });
    const message = ({
      joined: "🥀 You're entered! Good luck. You can leave before the deadline.",
      already: "You're already entered. Each member gets one entry.",
      left: "Your giveaway entry has been removed.",
      "not-entered": "You weren't entered in this giveaway.",
      ended: "This giveaway has ended. Check the original post for results.",
      unavailable: "Your entry could not be updated right now. Please try again.",
    })[result] || "Please try again.";
    return interaction.editReply({ content: message, allowedMentions: { parse: [] } });
  } catch (error) {
    console.error("[Giveaways] Entry button failed:", error);
    return interaction.editReply("I couldn't update your entry. Please try again.");
  }
}
