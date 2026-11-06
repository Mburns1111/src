import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { getConfiguredTextChannelAndConfig } from "./shared.js";
import Giveaway from "../models/Giveaway.js";
import { submitGiveawayTicket } from "../services/giveaway-ticket-claims.js";
import { winnerClaimDeadline, winnerHasClaim } from "../services/giveaway-claims.js";
import { qualifyingActivity, completedActivityWeek } from "../services/giveaway-activity-counter.js";
import GiveawayWatchRule, { watchNameKey } from "../models/GiveawayWatchRule.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import {addGiveawayPlanCommands,executeGiveawayPlanAdmin,PLAN_OPERATIONS} from "./giveaway-plans.js";
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
    .addRoleOption(o => o.setName("role").setDescription("Optional required role for members entering"))
    .addIntegerOption(o => o.setName("claim_hours").setDescription("Hours winners have to claim after results (max 720)").setMinValue(1).setMaxValue(720))
    .addStringOption(o => o.setName("claim_instructions").setDescription("Optional extra ticket or prize collection instructions").setMaxLength(400)))
  .addSubcommand(c => c.setName("activity").setDescription("Schedule a surprise giveaway from completed weekly activity")
    .addStringOption(o => o.setName("title").setDescription("Title").setRequired(true))
    .addStringOption(o => o.setName("prize").setDescription("Prize").setRequired(true))
    .addStringOption(o => o.setName("type").setDescription("Activity scope").setRequired(true).addChoices({name:"General server",value:"general"},{name:"Selected channels",value:"channels"}))
    .addIntegerOption(o => o.setName("minutes").setDescription("Minutes until winners announced").setRequired(true).setMinValue(1).setMaxValue(GIVEAWAY_MAX_MINUTES))
    .addIntegerOption(o => o.setName("minimum").setDescription("Messages required per active day (default 1)").setMinValue(1))
    .addIntegerOption(o => o.setName("days").setDescription("Distinct active days required (default 1, e.g. 3)").setMinValue(1).setMaxValue(7))
    .addIntegerOption(o => o.setName("winners").setDescription("Winners").setMinValue(1).setMaxValue(10))
    .addStringOption(o => o.setName("watch").setDescription("Saved named watched-channel rule (optional)"))
    .addIntegerOption(o => o.setName("min_chars").setDescription("Minimum characters per message").setMinValue(0).setMaxValue(2000))
    .addIntegerOption(o => o.setName("claim_hours").setDescription("Hours to file ticket claim (default 48)").setMinValue(1).setMaxValue(720))
    .addChannelOption(o => o.setName("channel_1").setDescription("Channel 1"))
    .addChannelOption(o => o.setName("channel_2").setDescription("Channel 2"))
    .addChannelOption(o => o.setName("channel_3").setDescription("Channel 3"))
    .addChannelOption(o => o.setName("channel_4").setDescription("Channel 4"))
    .addChannelOption(o => o.setName("channel_5").setDescription("Channel 5")))
  .addSubcommand(c => c.setName("watch-save").setDescription("Save or update one named watched channel for weekly activity")
    .addStringOption(o => o.setName("name").setDescription("Example: QOTD, Suggestions, Art").setRequired(true).setMinLength(1).setMaxLength(60))
    .addChannelOption(o => o.setName("channel").setDescription("Channel whose messages count").setRequired(true))
    .addIntegerOption(o => o.setName("min_chars").setDescription("Minimum characters per qualifying message (default 1)").setMinValue(0).setMaxValue(2000))
    .addIntegerOption(o => o.setName("messages").setDescription("Messages needed per active day (default 1)").setMinValue(1).setMaxValue(50))
    .addIntegerOption(o => o.setName("days").setDescription("Distinct active days each Wed–Wed week (default 3)").setMinValue(1).setMaxValue(7)))
  .addSubcommand(c => c.setName("watch-list").setDescription("Review saved named activity channel rules"))
  .addSubcommand(c => c.setName("watch-delete").setDescription("Remove a named watched channel rule")
    .addStringOption(o => o.setName("name").setDescription("Saved rule name").setRequired(true)))
  .addSubcommand(c => c.setName("end").setDescription("End a normal giveaway early and retain its results")
    .addStringOption(o => o.setName("id").setDescription("Giveaway ID or message link/ID").setRequired(true)))
  .addSubcommand(c => c.setName("reroll").setDescription("Replace one winner, preserving original and reroll history")
    .addStringOption(o => o.setName("id").setDescription("Giveaway ID or message link/ID").setRequired(true))
    .addIntegerOption(o => o.setName("winner").setDescription("Winner number to replace, starting with 1").setRequired(true).setMinValue(1).setMaxValue(10)))
  .addSubcommand(c => c.setName("list").setDescription("Show recent regular giveaways and saved IDs"))
  .addSubcommand(c => c.setName("entrants").setDescription("Privately list entrants of any giveaway or trial")
    .addStringOption(o => o.setName("id").setDescription("Giveaway or trial ID or message link").setRequired(true))
    .addIntegerOption(o => o.setName("page").setDescription("Page (25 entrants at a time)").setMinValue(1)));


addGiveawayPlanCommands(data);

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
    .addRoleOption(o => o.setName("role").setDescription("Optional role required to enter"))
    .addIntegerOption(o => o.setName("claim_minutes").setDescription("Minutes winners have to claim after trial ends (max 43200)").setMinValue(1).setMaxValue(43200))
    .addStringOption(o => o.setName("claim_instructions").setDescription("Optional extra ticket or prize collection instructions").setMaxLength(400)))
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
    if (!survivalCommand && PLAN_OPERATIONS.has(operation))
      return await executeGiveawayPlanAdmin(interaction);
    if (operation === "watch-save") {
      const name=interaction.options.getString("name",true).trim();
      if (watchNameKey(name)==="general") throw Error("The name general is reserved for server-wide activity.");
      const channel=interaction.options.getChannel("channel",true);
      if (!channel?.isTextBased?.() || !channel.messages?.fetch) throw Error("Choose a text channel whose messages the bot can read.");
      const minimumChars=interaction.options.getInteger("min_chars") ?? 1;
      const minimumMessages=interaction.options.getInteger("messages") ?? 1;
      const activeDays=interaction.options.getInteger("days") ?? 3;
      await GiveawayWatchRule.findOneAndUpdate(
        {guildId:interaction.guildId,nameKey:watchNameKey(name)},
        {$set:{name,channelId:channel.id,minimumChars,minimumMessages,activeDays}},
        {upsert:true,new:true,runValidators:true});
      return interaction.editReply(`Saved **${name}** for <#${channel.id}>: ${minimumMessages} message(s) of ${minimumChars}+ characters on ${activeDays} different days per Wednesday–Wednesday week. Use watch-save again to edit it; other saved channels are unaffected.`);
    }
    if (operation === "watch-list") {
      const rules=await GiveawayWatchRule.find({guildId:interaction.guildId}).sort({nameKey:1}).limit(40).lean();
      return interaction.editReply({content:rules.length
        ? "**Saved watched channels**\n"+rules.map(rule=>`• **${rule.name}** · <#${rule.channelId}> · ${rule.minimumMessages} message(s) / ${rule.activeDays} days · ${rule.minimumChars}+ chars`).join("\n")
        : "No saved watches yet. Use /giveaway watch-save to create one.",allowedMentions:{parse:[]}});
    }
    if (operation === "watch-delete") {
      const name=interaction.options.getString("name",true);
      const inUse=await GiveawayPlan.exists({guildId:interaction.guildId,watchNameKey:watchNameKey(name),status:"active"});
      if(inUse)throw Error("An active giveaway plan uses this watched channel. Pause or edit that plan first.");
      const result=await GiveawayWatchRule.deleteOne({guildId:interaction.guildId,nameKey:watchNameKey(name)});
      return interaction.editReply(result.deletedCount?"Watched channel rule removed. Existing giveaway records are unchanged.":"No rule exists under that name.");
    }
    if (operation === "activity") {
      const { channel } = await getConfiguredTextChannelAndConfig(interaction, "giveawayChannelId", "giveaway");
      const watch=interaction.options.getString("watch");
      const saved=watch?await GiveawayWatchRule.findOne({guildId:interaction.guildId,nameKey:watchNameKey(watch)}).lean():null;
      if(watch && !saved)throw Error("Saved watched channel not found. Use watch-list.");
      const type = saved?"channels":interaction.options.getString("type", true);
      const channels = saved?[{id:saved.channelId}]:[1,2,3,4,5].map(n => interaction.options.getChannel("channel_"+n)).filter(Boolean);
      if (type === "channels" && !channels.length) throw Error("Choose at least one channel.");
      const checkedAt = new Date(), week = completedActivityWeek(checkedAt);
      const startAt = new Date(week + "T12:00:00Z");
      const minimum = interaction.options.getInteger("minimum") ?? saved?.minimumMessages ?? 1;
      const days = interaction.options.getInteger("days") ?? saved?.activeDays ?? 1;
      const minimumChars=interaction.options.getInteger("min_chars") ?? saved?.minimumChars ?? 1;
      const channelIds = [...new Set(channels.map(c=>c.id))];
      const entrantIds = await qualifyingActivity({guildId:interaction.guildId,type,channelIds,minimum,days,minimumChars,week});
      const scan = {entrantIds,channelIds};
      if (!scan.entrantIds.length) throw Error("Nobody qualified; giveaway was not created.");
      const endsAt = new Date(Date.now() + interaction.options.getInteger("minutes",true)*60000);
      const record = await Giveaway.create({
        guildId:interaction.guildId, channelId:channel.id, creatorId:interaction.user.id,
        title:interaction.options.getString("title",true), prize:interaction.options.getString("prize",true),
        winnerCount:interaction.options.getInteger("winners") || 1, endsAt, mode:"activity",
        status:"publishing", entrantIds:scan.entrantIds, activityType:type,
        activityChannelIds:scan.channelIds, activityMinimum:minimum, activityDays:days,activityMinChars:minimumChars,
        claimWindowHours:interaction.options.getInteger("claim_hours")??48,autoRerollClaims:true,
        activityStartAt:startAt, activityCheckedAt:checkedAt,
      });
      await Giveaway.updateOne({_id:record._id},{$set:{status:"draft"}});
      return interaction.editReply({
        content:`**Private activity giveaway preview**\nWeek: ${week} (Wednesday–Wednesday, Eastern)\nQualified: **${scan.entrantIds.length}**\nRequirement: ${minimum} message(s) of ${minimumChars}+ characters on ${days} different days\nAnnouncement: <t:${Math.floor(endsAt.getTime()/1000)}:F>\nConfirm to lock entries. Nothing will be posted until winners are drawn.`,
        components:[new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`giveaway:confirm:${record._id}`).setLabel("Confirm & schedule").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`giveaway:cancel:${record._id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
        )],allowedMentions:{parse:[]},
      });
    }
    if (operation === "start") {
      const survival = survivalCommand;
      const { channel, config } = await getConfiguredTextChannelAndConfig(
        interaction,
        survival ? "survivalTrialChannelId" : "giveawayChannelId",
        survival ? "Court's Trial survival giveaway" : "standard giveaway",
      );
      const pingRoleId = survival ? config?.survivalTrialPingRoleId : config?.giveawayPingRoleId;
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
        claimWindowHours: survival ? null : (interaction.options.getInteger("claim_hours") || null),
        autoRerollClaims: !survival && Boolean(interaction.options.getInteger("claim_hours")),
        claimWindowMinutes: survival ? (interaction.options.getInteger("claim_minutes") || null) : null,
        claimInstructions: interaction.options.getString("claim_instructions")?.trim() || "",
        requiredRoleId: interaction.options.getRole("role")?.id || "",
        announcementPingRoleId: pingRoleId || "",
        winnerCount, endsAt: new Date(Date.now() + minutes * 60_000),
        mode: survival ? "survival" : "standard",
        speedSeconds: survival ? (interaction.options.getInteger("pace") || DEFAULT_TRIAL_SPEED_SECONDS) : DEFAULT_TRIAL_SPEED_SECONDS,
        status: "publishing",
      });
      let message;
      try {
        const announcement = giveawayAnnouncement({ ...record.toObject(), status: "open" });
        // Only the creation message may ping the assigned notification role.
        // All later edits/results use no allowed mentions and never ping again.
        if (pingRoleId) {
          announcement.content = `<@&${pingRoleId}>`;
          announcement.allowedMentions = { parse: [], roles: [pingRoleId] };
        }
        message = await channel.send(announcement);
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
      updated = await closeGiveaway({ id: record._id, guildId: interaction.guildId, client: interaction.client });
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
  const match = /^giveaway:(enter|leave|count|launch|confirm|cancel|claim):([0-9a-f]{24})$/.exec(interaction.customId);
  if (!match) return interaction.reply({ content: "Invalid giveaway button.", flags: MessageFlags.Ephemeral });
  const [, action, id] = match;
  if (action!=="claim") await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const record = await Giveaway.findOne({ _id: id, guildId: interaction.guildId }).lean();
    if (!record || (!["confirm","cancel"].includes(action) && (record.messageId !== interaction.message?.id || record.channelId !== interaction.channelId)))
      return action==="claim"
        ? interaction.reply({content:"This giveaway announcement could not be verified.",flags:MessageFlags.Ephemeral})
        : interaction.editReply("This giveaway announcement could not be verified.");
    if (action === "claim") {
      if (record.mode==="survival" || record.status!=="ended" || !(record.winnerIds || []).includes(interaction.user.id))
        return interaction.reply({content:"Only current winners can file ticket claims after the drawing.",flags:MessageFlags.Ephemeral});
      const slot=record.winnerIds.indexOf(interaction.user.id);
      if (winnerHasClaim(record,slot))
        return interaction.reply({content:"You already filed a claim. Ask staff to correct it if necessary.",flags:MessageFlags.Ephemeral});
      const deadline=winnerClaimDeadline(record,slot);
      if (deadline && deadline<=new Date()) return interaction.reply({content:"Your ticket claim deadline has passed.",flags:MessageFlags.Ephemeral});
      if ((record.claimResolvedSlots || []).includes(slot)) return interaction.reply({content:"This winning place has expired.",flags:MessageFlags.Ephemeral});
      return interaction.showModal(new ModalBuilder().setCustomId(`giveaway:ticket:${id}`).setTitle("File your giveaway claim")
        .addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("ticket_number").setLabel("Your ticket number").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("ticket_url").setLabel("Link to your ticket").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(500)),
        ));
    }
    if (action === "confirm" || action === "cancel") {
      if (record.mode !== "activity" || record.status !== "draft" || record.creatorId !== interaction.user.id ||
          !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return interaction.editReply("This preview is unavailable or belongs to another staff member.");
      const updated = await Giveaway.findOneAndUpdate({_id:id,guildId:interaction.guildId,status:"draft",creatorId:interaction.user.id},
        {$set:{status:action==="confirm"?"open":"cancelled"}},{returnDocument:"after"}).lean();
      if (!updated) return interaction.editReply("Already handled.");
      return interaction.editReply({content:action==="confirm"
        ? `Surprise giveaway scheduled with **${updated.entrantIds.length}** locked entries. Announcement: <t:${Math.floor(new Date(updated.endsAt).getTime()/1000)}:F>. ID: \`${id}\``
        : "Cancelled. Nothing was posted.",components:[]});
    }
    if (action === "launch") {
      if (record.mode !== "survival") return interaction.editReply("This is not an elimination trial.");
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return interaction.editReply("Only staff with Manage Server permission can start a trial.");
      // Show actionable errors on the actual button rather than a generic
      // "couldn't update your entry" message intended for regular entrants.
      if (record.status !== "open") {
        const statusText = record.status === "preparing" || record.status === "running"
          ? "This trial is already starting or running. Watch for elimination posts."
          : "This trial is already finished, cancelled, or unavailable. Start a new trial with /trial start.";
        return interaction.editReply(statusText);
      }
      if ((record.entrantIds?.length || 0) < 2)
        return interaction.editReply("At least two members must join before you can start the trial.");
      let started;
      try {
        started = await beginSurvivalTrial({ id, guildId: interaction.guildId });
      } catch (error) {
        console.error("[Trials] Start button could not begin trial:", error);
        return interaction.editReply("The trial could not start: " + (error.message || "Please retry."));
      }
      try {
        await publishSurvivalAnnouncement(interaction.client, started);
      } catch (error) {
        // State is already running in Mongo; don't tell staff that the entire
        // trial failed just because the signup message could not be edited.
        console.error("[Trials] Trial started, but announcement update failed:", error);
        return interaction.editReply("⚔️ The trial **started and was saved**, but I couldn't refresh its signup post. Eliminations will continue here. Check my channel permissions.");
      }
      return interaction.editReply("⚔️ The Court’s Trial has begun! Watch this channel for each elimination.");
    }
    if (record.mode === "activity" && action !== "count") return interaction.editReply("Entries are locked for activity giveaways.");
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
    console.error("[Giveaways] Button action failed:", error);
    if (action==="claim" && !interaction.replied && !interaction.deferred)
      return interaction.reply({content:"I couldn't open your ticket form. Please try again.",flags:MessageFlags.Ephemeral});
    return interaction.editReply(action === "launch"
      ? "I couldn't start the trial. Check the Replit console for [Trials] or [Giveaways] errors."
      : "I couldn't update your entry. Please try again.");
  }
}

export async function handleGiveawayClaimModal(interaction) {
  const match=/^giveaway:ticket:([0-9a-f]{24})$/.exec(interaction.customId);
  if (!match || !interaction.guildId || interaction.user.bot)
    return interaction.reply({content:"Invalid ticket claim.",flags:MessageFlags.Ephemeral});
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  try {
    const updated=await submitGiveawayTicket({
      id:match[1],guildId:interaction.guildId,userId:interaction.user.id,
      ticketNumber:interaction.fields.getTextInputValue("ticket_number"),
      ticketUrl:interaction.fields.getTextInputValue("ticket_url"),
    });
    try { await publishGiveawayResult(interaction.client,updated); }
    catch(error) { console.error("[Giveaways] Ticket saved but announcement refresh failed:",error); }
    return interaction.editReply("Your ticket claim was saved. The giveaway announcement will show your ticket details.");
  } catch(error) {
    return interaction.editReply(error.message||"Unable to record your ticket claim.");
  }
}
