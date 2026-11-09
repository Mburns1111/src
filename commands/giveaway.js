import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { getConfiguredTextChannelAndConfig } from "./shared.js";
import Giveaway from "../models/Giveaway.js";

import { submitGiveawayTicket } from "../services/giveaway-ticket-claims.js";
import { winnerClaimDeadline, winnerHasClaim, DEFAULT_CLAIM_HOURS } from "../services/giveaway-claims.js";
import { startActivityWizard } from "./activity-wizard.js";
import GiveawayWatchRule, { watchNameKey } from "../models/GiveawayWatchRule.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import {addGiveawayPlanCommands,executeGiveawayPlanAdmin,PLAN_OPERATIONS} from "./giveaway-plans.js";
import {addGiveawayBannerCommands,executeGiveawayBannerAdmin,BANNER_OPERATIONS} from "./giveaway-banners.js";
import {ensureBannerRegistered} from "../services/giveaway-banners.js";
import {ensureGiveawayStaffRecord,requirePrivateGiveawayStaffChannel} from "../services/giveaway-staff-records.js";
import {canManageGiveaways,giveawayManagerPermissionMessage} from "../services/giveaway-manager-permissions.js";
import {regularGiveawayNotificationRoleIds} from "../services/giveaway-notification-roles.js";
import {publishActivityOneOffListing} from "../services/giveaway-directory.js";
import {
  GIVEAWAY_MAX_MINUTES, giveawayAnnouncement, joinGiveaway, leaveGiveaway,
  closeGiveaway, rerollGiveaway, publishGiveawayResult, giveawayAnnouncementWithBanner,
} from "../services/giveaways.js";
import {
  TRIAL_SPEED_CHOICES, DEFAULT_TRIAL_SPEED_SECONDS, MAX_TRIAL_SIGNUP_MINUTES,
  beginSurvivalTrial, cancelSurvivalTrial, publishSurvivalAnnouncement,
} from "../services/survival-giveaways.js";

export const data = new SlashCommandBuilder()
  .setName("giveaway").setDescription("Host giveaways that retain their winners and prize details")
  .addSubcommand(c => c.setName("start").setDescription("Post a new button-entry giveaway")
    .addStringOption(o => o.setName("title").setDescription("Giveaway title").setRequired(true).setMinLength(2).setMaxLength(100))
    .addStringOption(o => o.setName("prize").setDescription("Prize details, including multiple ranked prizes").setRequired(true).setMinLength(2).setMaxLength(1500))
    .addIntegerOption(o => o.setName("minutes").setDescription("How many minutes it stays open (up to 14 days)").setRequired(true).setMinValue(1).setMaxValue(GIVEAWAY_MAX_MINUTES))
    .addStringOption(o => o.setName("description").setDescription("Optional custom giveaway description").setMaxLength(1000))
    .addIntegerOption(o => o.setName("winners").setDescription("Number of winners (default 1)").setMinValue(1).setMaxValue(10))
    .addStringOption(o => o.setName("rules").setDescription("Optional requirements or entry instructions").setMaxLength(1200))
    .addRoleOption(o => o.setName("role").setDescription("Override the default required role"))
    .addBooleanOption(o => o.setName("no_required_role").setDescription("Allow entry without a required role"))
    .addBooleanOption(o => o.setName("show_role_help").setDescription("Show instructions on where to get the required role"))
    .addIntegerOption(o => o.setName("claim_hours").setDescription("Hours winners have to claim after results (default 12, max 720)").setMinValue(1).setMaxValue(720))
    .addStringOption(o => o.setName("claim_instructions").setDescription("Optional custom prize collection instructions").setMaxLength(1000))
    .addStringOption(o => o.setName("banner").setDescription("Optional registered banner image name").setMaxLength(60)))
  .addSubcommand(c => c.setName("activity").setDescription("Create an activity giveaway with guided questions in the current allowed channel"))
  .addSubcommand(c => c.setName("watch-save").setDescription("Save a named channel watched daily or Wednesday–Wednesday")
    .addStringOption(o => o.setName("name").setDescription("Example: QOTD, Suggestions, Art").setRequired(true).setMinLength(1).setMaxLength(60))
    .addChannelOption(o => o.setName("channel").setDescription("Channel whose messages count").setRequired(true))
    .addIntegerOption(o => o.setName("min_chars").setDescription("Minimum characters per qualifying message (default 1)").setMinValue(0).setMaxValue(2000))
    .addIntegerOption(o => o.setName("messages").setDescription("Total qualifying messages required during this daily/weekly period").setMinValue(1).setMaxValue(10000))
    .addIntegerOption(o => o.setName("per_day").setDescription("Optional extra minimum messages per active day (default 1)").setMinValue(1).setMaxValue(50))
    .addIntegerOption(o => o.setName("days").setDescription("Required active days: 1 for daily, up to 7 weekly").setMinValue(1).setMaxValue(7))
    .addStringOption(o => o.setName("period").setDescription("Daily: prior calendar day; Weekly: prior Wednesday–Wednesday")
      .addChoices({name:"Daily — previous calendar day",value:"daily"},
        {name:"Weekly — Wednesday to Wednesday",value:"weekly"}))
    .addUserOption(o => o.setName("mention_member").setDescription("Require an explicit @mention of this member"))
    .addStringOption(o => o.setName("phrase").setDescription("Exact spelling and word order required; capitalization ignored").setMinLength(1).setMaxLength(120))
    .addBooleanOption(o => o.setName("clear_mention").setDescription("Stop requiring a member mention"))
    .addBooleanOption(o => o.setName("clear_phrase").setDescription("Stop requiring a phrase")))
  .addSubcommand(c => c.setName("watch-list").setDescription("Review saved named activity channel rules"))
  .addSubcommand(c => c.setName("watch-delete").setDescription("Remove a named watched channel rule")
    .addStringOption(o => o.setName("name").setDescription("Saved rule name").setRequired(true)))
  .addSubcommand(c => c.setName("edit-prize").setDescription("Update a giveaway's prize before winners are drawn")
    .addStringOption(o => o.setName("id").setDescription("Giveaway ID or existing message link").setRequired(true))
    .addStringOption(o => o.setName("prize").setDescription("Updated prize details").setRequired(true).setMinLength(2).setMaxLength(1500)))
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
addGiveawayBannerCommands(data);

export const trialData = new SlashCommandBuilder()
  .setName("trial").setDescription("The Court's Trials: elimination competitions")
  .addSubcommand(c => c.setName("start").setDescription("Open a live Court's Trial with one-by-one eliminations")
    .addStringOption(o => o.setName("title").setDescription("Trial title").setRequired(true).setMinLength(2).setMaxLength(100))
    .addStringOption(o => o.setName("prize").setDescription("Prize details (include ranked prizes if needed)").setRequired(true).setMinLength(2).setMaxLength(1500))
    .addStringOption(o => o.setName("description").setDescription("Optional custom trial description").setMaxLength(1000))
    .addIntegerOption(o => o.setName("pace").setDescription("Seconds between elimination posts (default 5)")
      .addChoices(...TRIAL_SPEED_CHOICES.map(value => ({ name: `${value} seconds`, value }))))
    .addIntegerOption(o => o.setName("signup_minutes").setDescription("Minutes to accept entries (default 15, max 1440)").setMinValue(1).setMaxValue(MAX_TRIAL_SIGNUP_MINUTES))
    .addIntegerOption(o => o.setName("winners").setDescription("Number of ranked prize winners (default 1)").setMinValue(1).setMaxValue(10))
    .addStringOption(o => o.setName("rules").setDescription("Optional requirements or entry instructions").setMaxLength(1200))
    .addRoleOption(o => o.setName("role").setDescription("Override the default required role"))
    .addBooleanOption(o => o.setName("no_required_role").setDescription("Do not require an eligibility role for this Trial"))
    .addBooleanOption(o => o.setName("show_role_help").setDescription("Override whether role instructions are shown"))
    .addStringOption(o => o.setName("banner").setDescription("Override the saved default Trial banner").setMaxLength(60))
    .addIntegerOption(o => o.setName("rerolls").setDescription("Override automatic rerolls (0–10)").setMinValue(0).setMaxValue(10))
    .addBooleanOption(o => o.setName("disable_auto_rerolls").setDescription("Turn off automatic unclaimed-prize rerolls"))
    .addIntegerOption(o => o.setName("claim_minutes").setDescription("Minutes winners have to claim after trial ends (default 12 hours)").setMinValue(1).setMaxValue(43200))
    .addStringOption(o => o.setName("claim_instructions").setDescription("Optional custom prize collection instructions").setMaxLength(1000)))
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
  if (!interaction.guild || !interaction.guildId || !await canManageGiveaways(interaction))
    return interaction.editReply(giveawayManagerPermissionMessage);
  const operation = interaction.options.getSubcommand();
  const survivalCommand = interaction.commandName === "trial";
  try {
    if (!survivalCommand && PLAN_OPERATIONS.has(operation))
      return await executeGiveawayPlanAdmin(interaction);
    if (!survivalCommand && BANNER_OPERATIONS.has(operation))
      return await executeGiveawayBannerAdmin(interaction);
    if (operation === "watch-save") {
      const name=interaction.options.getString("name",true).trim();
      if (watchNameKey(name)==="general") throw Error("The name general is reserved for server-wide activity.");
      const channel=interaction.options.getChannel("channel",true);
      if (!channel?.isTextBased?.() || !channel.messages?.fetch) throw Error("Choose a text channel whose messages the bot can read.");
      const nameKey=watchNameKey(name);
      const existing=await GiveawayWatchRule.findOne({guildId:interaction.guildId,nameKey}).lean();
      const activityPeriod=interaction.options.getString("period") || existing?.activityPeriod || "weekly";
      const minimumChars=interaction.options.getInteger("min_chars") ?? existing?.minimumChars ?? 1;
      const totalInput=interaction.options.getInteger("messages");
      const minimumTotalMessages=totalInput ?? existing?.minimumTotalMessages ?? 1;
      const minimumMessages=interaction.options.getInteger("per_day") ?? existing?.minimumMessages ?? 1;
      const activeDays=interaction.options.getInteger("days") ??
        (activityPeriod==="daily" || totalInput!==null ? 1 : existing?.activeDays??1);
      if(activityPeriod==="daily" && activeDays!==1)
        throw Error("Daily watches check one calendar day; set days:1. Weekly watches can require multiple days.");
      const mentionUser=interaction.options.getUser("mention_member");
      const phraseInput=interaction.options.getString("phrase");
      const clearMention=interaction.options.getBoolean("clear_mention")===true;
      const clearPhrase=interaction.options.getBoolean("clear_phrase")===true;
      if((mentionUser && clearMention)||(phraseInput && clearPhrase))
        throw Error("Choose either a new member/phrase or the corresponding clear option.");
      if(mentionUser?.bot) throw Error("The mentioned target must be a real server member.");
      const requiredMentionUserId=clearMention?"":(mentionUser?.id || existing?.requiredMentionUserId || "");
      const requiredPhrase=clearPhrase?"":(phraseInput?.trim().replace(/\s+/g," ") || existing?.requiredPhrase || "");
      // Increment only when message-matching conditions changed. Previously
      // matched messages are not reused under an incompatible challenge.
      const criteriaChanged=!existing || existing.channelId!==channel.id ||
        existing.minimumChars!==minimumChars ||
        (existing.requiredMentionUserId||"")!==requiredMentionUserId ||
        (existing.requiredPhrase||"")!==requiredPhrase;
      await GiveawayWatchRule.findOneAndUpdate(
        {guildId:interaction.guildId,nameKey},
        {$set:{name,channelId:channel.id,minimumChars,minimumMessages,activeDays,
          activityPeriod,requiredMentionUserId,requiredPhrase,minimumTotalMessages},
         ...(criteriaChanged?{$inc:{criteriaVersion:1}}:{})},
        {upsert:true,new:true,runValidators:true});
      const matching=[requiredMentionUserId?`explicitly mention <@${requiredMentionUserId}>`:null,
        requiredPhrase?`include exact phrase "${requiredPhrase.replace(/[@`*_~|<>]/g,"")}" (correct spelling and word order; case-insensitive)`:null].filter(Boolean);
      const details=[`${minimumTotalMessages} qualifying messages total in the ${activityPeriod} activity window`,
        `${minimumChars}+ characters each`,
        minimumMessages>1?`${minimumMessages} messages per active day`:null,
        activeDays>1?`${activeDays} different days`:null,
        ...matching].filter(Boolean);
      return interaction.editReply({content:`Saved **${name}** for <#${channel.id}> (${activityPeriod}): ${details.join(" · ")}. Other watches are unchanged.`,
        allowedMentions:{parse:[]}});
    }
    if (operation === "watch-list") {
      const rules=await GiveawayWatchRule.find({guildId:interaction.guildId}).sort({nameKey:1}).limit(30).lean();
      const lines=rules.map(rule=>`• **${String(rule.name).replace(/[@*_~|<>]/g,"")}** · <#${rule.channelId}> · ${rule.minimumTotalMessages||1} total msg · ${rule.activityPeriod||"weekly"} · ${rule.minimumChars}+ chars${rule.activeDays>1?` · ${rule.activeDays} active days`:""}${rule.minimumMessages>1?` · ${rule.minimumMessages}/day`:""}${rule.requiredMentionUserId?` · tag <@${rule.requiredMentionUserId}>`:""}${rule.requiredPhrase?` · phrase "${String(rule.requiredPhrase).replace(/[@*_~|<>]/g,"").slice(0,35)}"`:""}`);
      return interaction.editReply({content:rules.length
        ? ("**Saved watched channels**\n"+lines.join("\n")).slice(0,1900)
        : "No saved watches yet. Use /giveaway watch-save to create one.",allowedMentions:{parse:[]}});
    }
    if (operation === "watch-delete") {
      const name=interaction.options.getString("name",true);
      const inUse=await GiveawayPlan.exists({guildId:interaction.guildId,watchNameKey:watchNameKey(name),status:{$in:["active","paused"]}});
      if(inUse)throw Error("An active giveaway plan uses this watched channel. Pause or edit that plan first.");
      const result=await GiveawayWatchRule.deleteOne({guildId:interaction.guildId,nameKey:watchNameKey(name)});
      return interaction.editReply(result.deletedCount?"Watched channel rule removed. Existing giveaway records are unchanged.":"No rule exists under that name.");
    }
    if (operation === "activity") return await startActivityWizard(interaction);
    if (operation === "start") {
      const survival = survivalCommand;
      const { channel, config } = await getConfiguredTextChannelAndConfig(
        interaction,
        survival ? "survivalTrialChannelId" : "giveawayChannelId",
        survival ? "Court's Trial survival giveaway" : "standard giveaway",
      );
      await requirePrivateGiveawayStaffChannel(interaction.guild,config);
      const pingRoleIds = survival
        ? [...new Set(config?.trialNotificationRoleIds?.length
          ? config.trialNotificationRoleIds
          : (config?.survivalTrialPingRoleId ? [config.survivalTrialPingRoleId] : []))].slice(0, 10)
        : regularGiveawayNotificationRoleIds(config);
      const pingRoleId = pingRoleIds[0] || "";
      const bannerNameKey = await ensureBannerRegistered(interaction.guildId,
        interaction.options.getString("banner") ||
          (survival ? config?.trialDefaultBannerNameKey : ""));
      const minutes = survival
        ? (interaction.options.getInteger("signup_minutes") || 15)
        : interaction.options.getInteger("minutes", true);
      const winnerCount = interaction.options.getInteger("winners") || 1;
      const record = await Giveaway.create({
        guildId: interaction.guildId, channelId: channel.id,bannerNameKey,
        creatorId: interaction.user.id,
        title: interaction.options.getString("title", true).trim(),
        prize: interaction.options.getString("prize", true).trim(),
        description: interaction.options.getString("description")?.trim() || "",
        rules: interaction.options.getString("rules")?.trim() || "",
        claimWindowHours: survival ? null
          : (interaction.options.getInteger("claim_hours") ?? config?.activityClaimWindowHours ?? DEFAULT_CLAIM_HOURS),
        claimWindowMinutes: survival
          ? (interaction.options.getInteger("claim_minutes") ?? config?.trialClaimWindowMinutes ?? 720) : null,
        autoRerollClaims: survival
          ? interaction.options.getBoolean?.("disable_auto_rerolls") !== true : true,
        trialTicketClaimsEnabled: survival,
        maxAutoRerolls: survival
          ? (interaction.options.getInteger("rerolls") ?? config?.trialMaxAutoRerolls ?? 2)
          : (config?.activityMaxAutoRerolls ?? 2),
        claimInstructions: interaction.options.getString("claim_instructions")?.trim() ||
          (survival ? config?.trialClaimInstructions : config?.activityClaimInstructions) || "",
        requiredRoleId: interaction.options.getBoolean?.("no_required_role") === true ? "" :
          (interaction.options.getRole("role")?.id ||
            (survival ? config?.trialDefaultRequiredRoleId : config?.giveawayDefaultRequiredRoleId) || ""),
        requiredRoleInstructions: (survival ? config?.trialRoleInstructions : config?.giveawayRoleInstructions) || "",
        showRequiredRoleInstructions: interaction.options.getBoolean?.("show_role_help") ??
          (survival ? config?.trialShowRoleInstructions !== false : config?.giveawayShowRoleInstructions !== false),
        announcementPingRoleId: pingRoleId,
        announcementPingRoleIds: pingRoleIds,
        winnerCount, endsAt: new Date(Date.now() + minutes * 60_000),
        mode: survival ? "survival" : "standard",
        speedSeconds: survival ? (interaction.options.getInteger("pace") || DEFAULT_TRIAL_SPEED_SECONDS) : DEFAULT_TRIAL_SPEED_SECONDS,
        status: "publishing",
      });
      let message;
      try {
        const announcement = await giveawayAnnouncementWithBanner({ ...record.toObject(), status: "open" });
        // Only the creation message may ping the assigned notification role.
        // All later edits/results use no allowed mentions and never ping again.
        if (pingRoleIds.length) {
          announcement.content = pingRoleIds.map(id => `<@&${id}>`).join(" ");
          announcement.allowedMentions = { parse: [], roles: pingRoleIds };
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
      try{await ensureGiveawayStaffRecord(interaction.client,{...record.toObject(),status:"open",messageId:message.id});}
      catch(error){console.error("[Giveaways] Staff record on creation failed:",error);}
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
              `• **${record.title.replace(/[@*_`~|<>]/g, "")}** · ${record.mode === "survival" ? "trial" : record.mode} · ${record.status} · \`${record._id}\` ${record.messageId ? linkTo(record) : "(pending)"}`).join("\n")
          : (survivalCommand ? "No Court's Trials have been created yet." : "No giveaways have been created yet."),
        allowedMentions: { parse: [] },
      });
    }
    const record = await findGiveaway(interaction.options.getString("id", true), interaction.guildId);
    if (!record) throw Error("Event not found in this server.");
    if (operation === "edit-prize") {
      if (record.mode==="survival" || !["draft","open"].includes(record.status))
        throw Error("This prize can only be updated before the giveaway's drawing.");
      const prize=interaction.options.getString("prize",true).trim();
      const edited=await Giveaway.findOneAndUpdate({_id:record._id,guildId:interaction.guildId,status:{$in:["draft","open"]}},
        {$set:{prize,renderedAt:null},$inc:{renderVersion:1}},{returnDocument:"after"}).lean();
      if (!edited)throw Error("The giveaway was already drawn. Its historical prize is unchanged.");
      if (edited.messageId)await publishGiveawayResult(interaction.client,edited);
      return interaction.editReply("Giveaway prize updated. Existing entries and past drawings were not changed.");
    }
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
      if(record.guidedSeries) throw Error("This activity draws at the configured time and follows its manual approval setting.");
      if (record.mode === "survival") throw Error("Use the Start Trial (Staff) button to begin a trial, or /trial cancel to stop it.");
      if (record.status === "publishing" || record.status === "failed") throw Error("This giveaway was never published.");
      updated = await closeGiveaway({ id: record._id, guildId: interaction.guildId, client: interaction.client });
      if (updated?.status === "rerolling") throw Error("Wait for the current reroll to finish.");
    } else if (operation === "reroll") {
      updated = await rerollGiveaway({
        id: record._id, guildId: interaction.guildId, staffId: interaction.user.id,
        slot: interaction.options.getInteger("winner", true) - 1, client: interaction.client,
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
    const validSignupPost = record?.messageId === interaction.message?.id && record?.channelId === interaction.channelId;
    const validTrialVerdict = action === "claim" && record?.mode === "survival" &&
      record?.finaleMessageId === interaction.message?.id && record?.channelId === interaction.channelId;
    if (!record || (!["confirm","cancel"].includes(action) && !validSignupPost && !validTrialVerdict))
      return action==="claim"
        ? interaction.reply({content:"This giveaway announcement could not be verified.",flags:MessageFlags.Ephemeral})
        : interaction.editReply("This giveaway announcement could not be verified.");
    if (action === "claim") {
      if (record.status!=="ended" || (record.mode === "survival" && !record.trialTicketClaimsEnabled) ||
          !(record.winnerIds || []).includes(interaction.user.id))
        return interaction.reply({content:"Only current winners can file ticket claims after the drawing.",flags:MessageFlags.Ephemeral});
      const slot=record.winnerIds.indexOf(interaction.user.id);
      if (winnerHasClaim(record,slot))
        return interaction.reply({content:"You already filed a claim. Ask staff to correct it if necessary.",flags:MessageFlags.Ephemeral});
      const deadline=winnerClaimDeadline(record,slot);
      if (deadline && deadline<=new Date()) return interaction.reply({content:"Your ticket claim deadline has passed.",flags:MessageFlags.Ephemeral});
      if ((record.claimResolvedSlots || []).includes(slot)) return interaction.reply({content:"This winning place has expired.",flags:MessageFlags.Ephemeral});
      return interaction.showModal(new ModalBuilder().setCustomId(`giveaway:ticket:${id}`).setTitle("Enter Ticket Claim info")
        .addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("ticket_number").setLabel("Ticket number").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("ticket_url").setLabel("Discord ticket message link").setPlaceholder("https://discord.com/channels/...").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(500)),
        ));
    }
    if (action === "confirm" || action === "cancel") {
      if (record.mode !== "activity" || record.status !== "draft" || record.creatorId !== interaction.user.id ||
          !await canManageGiveaways(interaction))
        return interaction.editReply("This preview is unavailable or belongs to another authorized giveaway manager.");
      const updated = await Giveaway.findOneAndUpdate({_id:id,guildId:interaction.guildId,status:"draft",creatorId:interaction.user.id},
        {$set:{status:action==="confirm"?"open":"cancelled"}},{returnDocument:"after"}).lean();
      if (!updated) return interaction.editReply("Already handled.");
      if(action==="confirm"){
        try {await publishActivityOneOffListing(interaction.client,updated);}
        catch(error){console.error("[Giveaways] Scheduled activity listing will retry:",error);}
      }
      return interaction.editReply({content:action==="confirm"
        ? `Surprise giveaway scheduled with **${updated.entrantIds.length}** locked entries. Announcement: <t:${Math.floor(new Date(updated.endsAt).getTime()/1000)}:F>. ID: \`${id}\``
        : "Cancelled. Nothing was posted.",components:[]});
    }
    if (action === "launch") {
      if (record.mode !== "survival") return interaction.editReply("This is not an elimination trial.");
      if (!await canManageGiveaways(interaction))
        return interaction.editReply(giveawayManagerPermissionMessage);
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
        return interaction.editReply(`You need the <@&${record.requiredRoleId}> role to join this giveaway.${record.showRequiredRoleInstructions!==false&&record.requiredRoleInstructions?"\n**Where to get it:** "+record.requiredRoleInstructions:""}`);
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
    try { await ensureGiveawayStaffRecord(interaction.client, updated); }
    catch(error) { console.error("[Giveaways] Ticket saved; staff record will be reconciled later:",error); }
    return interaction.editReply("Claim submitted successfully.");
  } catch(error) {
    return interaction.editReply(error.message||"Unable to record your ticket claim.");
  }
}
