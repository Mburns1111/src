import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { getConfiguredTextChannel } from "./shared.js";
import Giveaway from "../models/Giveaway.js";
import {
  GIVEAWAY_MAX_MINUTES, giveawayAnnouncement, joinGiveaway, leaveGiveaway,
  closeGiveaway, rerollGiveaway, publishGiveawayResult,
} from "../services/giveaways.js";
import {
  TRIAL_SPEED_CHOICES, DEFAULT_TRIAL_SPEED_SECONDS, MAX_TRIAL_SIGNUP_MINUTES,
  beginSurvivalTrial, cancelSurvivalTrial, publishSurvivalAnnouncement,
} from "../services/survival-giveaways.js";

export const data = new SlashCommandBuilder()
  .setName("giveaway").setDescription("Host giveaways that retain their winners and prize details")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(c => c.setName("start").setDescription("Post a new button-entry giveaway")
    .addStringOption(o => o.setName("title").setDescription("Giveaway title").setRequired(true).setMinLength(2).setMaxLength(100))
    .addStringOption(o => o.setName("prize").setDescription("Prize details, including multiple ranked prizes").setRequired(true).setMinLength(2).setMaxLength(1500))
    .addIntegerOption(o => o.setName("minutes").setDescription("How many minutes it stays open (up to 14 days)").setRequired(true).setMinValue(1).setMaxValue(GIVEAWAY_MAX_MINUTES))
    .addIntegerOption(o => o.setName("winners").setDescription("Number of winners (default 1)").setMinValue(1).setMaxValue(10))
    .addStringOption(o => o.setName("rules").setDescription("Optional requirements or entry instructions").setMaxLength(1200))
    .addRoleOption(o => o.setName("role").setDescription("Optional required role for members entering")))
  .addSubcommand(c => c.setName("end").setDescription("End a normal giveaway early and retain its results")
    .addStringOption(o => o.setName("id").setDescription("Giveaway ID or message link/ID").setRequired(true)))
  .addSubcommand(c => c.setName("reroll").setDescription("Replace one winner, preserving original and reroll history")
    .addStringOption(o => o.setName("id").setDescription("Giveaway ID or message link/ID").setRequired(true))
    .addIntegerOption(o => o.setName("winner").setDescription("Winner number to replace, starting with 1").setRequired(true).setMinValue(1).setMaxValue(10)))
  .addSubcommand(c => c.setName("list").setDescription("Show recent regular giveaways and saved IDs"))
  .addSubcommand(c => c.setName("entrants").setDescription("Privately list entrants of any giveaway or trial")
    .addStringOption(o => o.setName("id").setDescription("Giveaway or trial ID or message link").setRequired(true))
    .addIntegerOption(o => o.setName("page").setDescription("Page (25 entrants at a time)").setMinValue(1)));


export const trialData = new SlashCommandBuilder()
  .setName("trial").setDescription("The Court's Trials: elimination competitions")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(c => c.setName("start").setDescription("Open a live Court's Trial with one-by-one eliminations")
    .addStringOption(o => o.setName("title").setDescription("Trial title").setRequired(true).setMinLength(2).setMaxLength(100))
    .addStringOption(o => o.setName("prize").setDescription("Prize details (include ranked prizes if needed)").setRequired(true).setMinLength(2).setMaxLength(1500))
    .addIntegerOption(o => o.setName("pace").setDescription("Seconds between elimination posts (default 5)")
      .addChoices(...TRIAL_SPEED_CHOICES.map(value => ({ name: `${value} seconds`, value }))))
    .addIntegerOption(o => o.setName("signup_minutes").setDescription("Minutes to accept entries (default 15, max 1440)").setMinValue(1).setMaxValue(MAX_TRIAL_SIGNUP_MINUTES))
    .addIntegerOption(o => o.setName("winners").setDescription("Number of ranked prize winners (default 1)").setMinValue(1).setMaxValue(10))
    .addStringOption(o => o.setName("rules").setDescription("Optional requirements or entry instructions").setMaxLength(1200))
    .addRoleOption(o => o.setName("role").setDescription("Optional role required to enter")))
  .addSubcommand(c => c.setName("cancel").setDescription("Cancel a trial without awarding winners; retain its record")
    .addStringOption(o => o.setName("id").setDescription("Trial ID or original message link").setRequired(true)))
  .addSubcommand(c => c.setName("reroll").setDescription("Replace one winner, preserving original and reroll history")
    .addStringOption(o => o.setName("id").setDescription("Giveaway ID or message link/ID").setRequired(true))
    .addIntegerOption(o => o.setName("winner").setDescription("Winner number to replace, starting with 1").setRequired(true).setMinValue(1).setMaxValue(10)))
  .addSubcommand(c => c.setName("list").setDescription("Show recent Court's Trials and saved IDs"))
  .addSubcommand(c => c.setName("entrants").setDescription("Privately list registered Court's Trial contestants")
    .addStringOption(o => o.setName("id").setDescription("Trial ID or message link").setRequired(true))
    .addIntegerOption(o => o.setName("page").setDescription("Page (25 contestants at a time)").setMinValue(1)));

const linkTo = record => `https://discord.com/channels/${record.guildId}/${record.channelId}/${record.messageId}`;

export const ENTRANTS_PER_PAGE = 25;

// Staff-only command output. Mention formatting makes accounts easy to recognize
// without actually pinging the entrants. 25 rows fit safely within Discord's
// 2,000-character message limit, including ID codes.
export function formatGiveawayEntrants(record, requestedPage = 1) {
  const entrants = [...new Set(record.entrantIds || [])];
  const pages = Math.max(1, Math.ceil(entrants.length / ENTRANTS_PER_PAGE));
  const page = Number(requestedPage);
  if (!Number.isSafeInteger(page) || page < 1 || page > pages) {
    throw Error("Invalid entrant page. Use a page from 1 to " + pages + ".");
  }
  const title = String(record.title || "Untitled").replace(/[@\`*_~|<>]/g, "").slice(0, 100);
  const heading = record.mode === "survival" ? "Court's Trial contestants" : "Giveaway entrants";
  const beginning = (page - 1) * ENTRANTS_PER_PAGE;
  const names = entrants.slice(beginning, beginning + ENTRANTS_PER_PAGE)
    .map((id, i) => (beginning + i + 1) + ". <@" + id + "> (" + "\`" + id + "\`" + ")");
  return [
    "**" + heading + " — " + title + "**",
    "**Status:** " + record.status + " · **Total entered:** " + entrants.length + " · **Page:** " + page + "/" + pages,
    record.messageId ? "Original post: " + linkTo(record) : "",
    "",
    ...(names.length ? names : ["No members have entered."]),
    ...(pages > 1 ? ["", "Use the same command with \`page:" + Math.min(pages, page + 1) + "\` to see another page."] : []),
  ].filter((line, i) => line !== "" || i > 0).join("\n");
}


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
  const survivalCommand = interaction.commandName === "trial";
  try {
    if (operation === "start") {
      const survival = survivalCommand;
      const channel = await getConfiguredTextChannel(
        interaction,
        survival ? "survivalTrialChannelId" : "giveawayChannelId",
        survival ? "Court's Trial survival giveaway" : "standard giveaway",
      );
      const minutes = survival
        ? (interaction.options.getInteger("signup_minutes") || 15)
        : interaction.options.getInteger("minutes", true);
      const winnerCount = interaction.options.getInteger("winners") || 1;
      const record = await Giveaway.create({
        guildId: interaction.guildId, channelId: channel.id,
        creatorId: interaction.user.id,
        title: interaction.options.getString("title", true).trim(),
        prize: interaction.options.getString("prize", true).trim(),
        rules: interaction.options.getString("rules")?.trim() || "",
        requiredRoleId: interaction.options.getRole("role")?.id || "",
        winnerCount, endsAt: new Date(Date.now() + minutes * 60_000),
        mode: survival ? "survival" : "standard",
        speedSeconds: survival ? (interaction.options.getInteger("pace") || DEFAULT_TRIAL_SPEED_SECONDS) : DEFAULT_TRIAL_SPEED_SECONDS,
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
      return interaction.editReply(`🥀 ${survival ? "Survival trial" : "Giveaway"} posted: ${message.url}\nSaved giveaway ID: \`${record._id}\`\n${survival ? "Members join using the buttons; staff click Start Trial when ready." : "The announcement and results will stay visible after it ends."}`);
    }

    if (operation === "list") {
      const records = await Giveaway.find({
        guildId: interaction.guildId, status: { $ne: "failed" },
        mode: survivalCommand ? "survival" : { $ne: "survival" },
      })
        .sort({ createdAt: -1 }).limit(10).lean();
      return interaction.editReply({
        content: records.length
          ? (survivalCommand ? "**Recent Court's Trials**\n" : "**Recent Giveaways**\n") + records.map(record =>
              `• **${record.title.replace(/[@*_`~|<>]/g, "")}** · ${record.mode === "survival" ? "trial" : "standard"} · ${record.status} · \`${record._id}\` ${record.messageId ? linkTo(record) : "(pending)"}`).join("\n")
          : (survivalCommand ? "No Court's Trials have been created yet." : "No giveaways have been created yet."),
        allowedMentions: { parse: [] },
      });
    }
    const record = await findGiveaway(interaction.options.getString("id", true), interaction.guildId);
    if (!record) throw Error("Event not found in this server.");
    if (operation === "entrants") {
      if (survivalCommand && record.mode !== "survival") {
        throw Error("Use /giveaway entrants for regular giveaways.");
      }
      return interaction.editReply({
        content: formatGiveawayEntrants(record, interaction.options.getInteger("page") || 1),
        allowedMentions: { parse: [] },
      });
    }
    if (survivalCommand && record.mode !== "survival") {
      throw Error("This event is a regular giveaway. Use /giveaway instead.");
    }
    if (!survivalCommand && record.mode === "survival") {
      throw Error("This event is a Court's Trial. Use /trial instead.");
    }
    let updated;
    if (operation === "cancel") {
      if (!survivalCommand) throw Error("Use /trial cancel for an elimination trial.");
      updated = await cancelSurvivalTrial({ id: record._id, guildId: interaction.guildId });
      try {
        await publishSurvivalAnnouncement(interaction.client, updated);
      } catch (error) {
        console.error("[Trials] State saved but could not update announcement:", error);
        return interaction.editReply("The trial state was saved, but the announcement could not be updated. Check the bot permissions; the bot will retry the final result.");
      }
      return interaction.editReply({
        content: `🥀 Trial cancelled and archived in ${linkTo(updated)}`,
        allowedMentions: { parse: [] },
      });
    }
    if (operation === "end") {
      if (record.mode === "survival") throw Error("Use the Start Trial (Staff) button to begin a trial, or /trial cancel to stop it.");
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
  const match = /^giveaway:(enter|leave|count|launch):([0-9a-f]{24})$/.exec(interaction.customId);
  if (!match) return interaction.reply({ content: "Invalid giveaway button.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [, action, id] = match;
  try {
    const record = await Giveaway.findOne({ _id: id, guildId: interaction.guildId }).lean();
    if (!record || record.messageId !== interaction.message?.id || record.channelId !== interaction.channelId)
      return interaction.editReply("This giveaway announcement could not be verified.");
    if (action === "launch") {
      if (record.mode !== "survival") return interaction.editReply("This is not an elimination trial.");
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return interaction.editReply("Only staff with Manage Server permission can start a trial.");
      const started = await beginSurvivalTrial({ id, guildId: interaction.guildId });
      await publishSurvivalAnnouncement(interaction.client, started);
      return interaction.editReply("⚔️ The Court’s Trial has begun! Watch this channel for each elimination.");
    }
    if (action === "count") return interaction.editReply({
      content: `🥀 Current entries: **${record.entrantIds?.length || 0}** · Winners: **${record.winnerCount}**.`,
      allowedMentions: { parse: [] },
    });
    if (record.status !== "open" || new Date(record.endsAt) <= new Date())
      return interaction.editReply("This giveaway has ended; its results will stay on the original post.");
    if (action === "enter" && record.requiredRoleId) {
      const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
      if (!member?.roles?.cache?.has(record.requiredRoleId))
        return interaction.editReply(`You need the <@&${record.requiredRoleId}> role to join this giveaway.`);
    }
    const result = action === "enter"
      ? await joinGiveaway({ id, guildId: interaction.guildId, userId: interaction.user.id, mode: record.mode })
      : await leaveGiveaway({ id, guildId: interaction.guildId, userId: interaction.user.id });
    const message = ({
      joined: "🥀 You're entered! Good luck. You can leave before the deadline.",
      already: "You're already entered. Each member gets one entry.",
      full: "This trial has reached its 120-contestant limit.",
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
