import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import PointsSettings from "../models/PointsSettings.js";
import PointsLedger from "../models/PointsLedger.js";
import PointsWallet from "../models/PointsWallet.js";
import { grantPoints } from "../services/points-rewards.js";
import { backfillMilestones } from "../services/points-backfill.js";
import { POINTS_MILESTONES, POINTS_ACTIVITY_TARGETS, milestoneAwardAmount } from "../services/points-policy.js";
import { requireGuild } from "./shared.js";
import { BULK_REASON_CHOICES, parseBulkRecipients, bulkAwardDetails } from "../services/points-bulk.js";
import { parseGuildMessageLink, syncNativePoll } from "../services/participation-observer.js";
import { awardObservedPollVoters, POLL_POINTS_PER_POLL, POLL_WEEKLY_CAP } from "../services/poll-rewards.js";
import ParticipationSource from "../models/ParticipationSource.js";
import { scanAndAwardMessages, MESSAGE_SCAN_MAX_HOURS } from "../services/message-reward-scan.js";
import PointsActivityCounter from "../models/PointsActivityCounter.js";
import PointsVoiceProgress from "../models/PointsVoiceProgress.js";
import { activityPeriod, MESSAGE_BASE_POINTS, MESSAGE_COOLDOWN_MS,
  VOICE_BASE_POINTS, VOICE_INTERVAL_MINUTES } from "../services/activity-rewards.js";
import { UserFacingError } from "./errors.js";

const milestoneChoices = Object.entries(POINTS_MILESTONES)
  .map(([value, item]) => ({ name: item.label, value }));

export const data = new SlashCommandBuilder()
  .setName("points-admin")
  .setDescription("Manage and audit community Points earnings")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(c => c.setName("settings")
    .setDescription("Show milestone, poll, message, and voice earning settings"))
  .addSubcommand(c => c.setName("activity-toggle")
    .setDescription("Turn repeatable chat and voice Points on or off for this test server")
    .addStringOption(o => o.setName("source").setDescription("Which activity earns Points?")
      .setRequired(true).addChoices(
        { name: "Messages and Voice", value: "both" },
        { name: "Messages only", value: "messages" },
        { name: "Voice only", value: "voice" } ))
    .addBooleanOption(o => o.setName("enabled").setDescription("Allow activity Points from this source?")
      .setRequired(true)))
  .addSubcommand(c => c.setName("activity-status")
    .setDescription("Show a member's repeatable Points earned this period")
    .addUserOption(o => o.setName("member").setDescription("Member to check").setRequired(true)))
  .addSubcommand(c => c.setName("milestone")
    .setDescription("Adjust one milestone reward for this server")
    .addStringOption(o => o.setName("achievement").setDescription("One-time milestone")
      .setRequired(true).addChoices(...milestoneChoices))
    .addIntegerOption(o => o.setName("points").setDescription("0 disables this milestone")
      .setRequired(true).setMinValue(0).setMaxValue(500)))
  .addSubcommand(c => c.setName("toggle")
    .setDescription("Enable or pause milestone awards")
    .addBooleanOption(o => o.setName("enabled").setRequired(true)
      .setDescription("Automatically award milestones when eligible actions finish")))
  .addSubcommand(c => c.setName("grant")
    .setDescription("Manually reward a member for help or an event (audited)")
    .addUserOption(o => o.setName("member").setRequired(true)
      .setDescription("Member to reward"))
    .addIntegerOption(o => o.setName("points").setRequired(true)
      .setDescription("Points to give").setMinValue(1).setMaxValue(250))
    .addStringOption(o => o.setName("reason").setRequired(true)
      .setDescription("Short description for audit log").setMinLength(3).setMaxLength(140)))
  .addSubcommand(c => c.setName("grant-multiple")
    .setDescription("Credit several members for a giveaway, participation, or an event")
    .addStringOption(o => o.setName("members").setDescription("Up to 20 mentions or user IDs, separated by spaces/commas").setRequired(true).setMaxLength(2000))
    .addIntegerOption(o => o.setName("points").setDescription("Points for EACH member").setRequired(true).setMinValue(1).setMaxValue(250))
    .addStringOption(o => o.setName("reason").setDescription("Reason for the award").setRequired(true).addChoices(...BULK_REASON_CHOICES))
    .addStringOption(o => o.setName("note").setDescription("Optional detail (giveaway prize, event name)").setMaxLength(100))
    .addStringOption(o => o.setName("reference").setDescription("Optional event ID, e.g. halloween-giveaway; prevents repeat payments").setMinLength(3).setMaxLength(80)))
  .addSubcommand(c => c.setName("poll-approve")
    .setDescription("Approve a native Discord poll for automatic 5-Point voting rewards")
    .addStringOption(o => o.setName("link").setDescription("Discord native poll message link").setRequired(true)))
  .addSubcommand(c => c.setName("poll-disable")
    .setDescription("Stop further rewards from one approved native poll")
    .addStringOption(o => o.setName("link").setDescription("Discord native poll message link").setRequired(true)))
  .addSubcommand(c => c.setName("scan-messages")
    .setDescription("Preview or credit missed qualifying messages across readable server channels")
    .addIntegerOption(o => o.setName("hours")
      .setDescription("How far back to scan (default 24 hours, max 168)")
      .setMinValue(1).setMaxValue(MESSAGE_SCAN_MAX_HOURS))
    .addBooleanOption(o => o.setName("apply")
      .setDescription("Default false: preview only. True: actually credit members")))
  .addSubcommand(c => c.setName("history")
    .setDescription("See recent credits recorded for one member")
    .addUserOption(o => o.setName("member").setRequired(true)
      .setDescription("Member to inspect")))
  .addSubcommand(c => c.setName("backfill")
    .setDescription("Review or issue verified older first-time achievements for one member")
    .addUserOption(o => o.setName("member").setRequired(true)
      .setDescription("Existing member to review"))
    .addBooleanOption(o => o.setName("apply")
      .setDescription("Default false: preview only; true grants any unclaimed rewards")));

export async function execute(interaction) {
  requireGuild(interaction);
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new UserFacingError("Only members with Manage Server can administer Points.");
  }
  const guildId = interaction.guildId, actorId = interaction.user.id;
  const op = interaction.options.getSubcommand();
  if (op === "settings") {
    const settings = await PointsSettings.findOne({ guildId }).lean();
    const lines = Object.entries(POINTS_MILESTONES).map(([key, entry]) =>
      `• ${entry.label}: **${milestoneAwardAmount(settings, key)}** Points (${key})`);
    await interaction.editReply({
      content: `**Points milestones: ${settings?.milestonesEnabled === false ? "PAUSED" : "ENABLED"}**\n` +
        lines.join("\n") +
        `\n\n**Repeatable activity** (test opt-in): Messages **${settings?.messageRewardsEnabled ? "ON" : "OFF"}**, Voice **${settings?.voiceRewardsEnabled ? "ON" : "OFF"}**.\n**No overall daily, weekly, or first-week activity Points cap.** First 7 days after joining: **2×** chat/voice rewards. Members continue earning qualifying activity afterward.\nMessages: ${MESSAGE_BASE_POINTS} base Points, one eligible message every ${MESSAGE_COOLDOWN_MS / 60000} minutes, no daily or weekly Points cap. Voice: ${VOICE_BASE_POINTS} base Points each ${VOICE_INTERVAL_MINUTES} eligible minutes with at least two non-deafened humans.\nApproved native polls: ${POLL_POINTS_PER_POLL} Points, maximum ${POLL_WEEKLY_CAP} per UTC week (poll-specific anti-farming rule). No shared activity ceiling.\nVerified invites are still planned: ${POINTS_ACTIVITY_TARGETS.invitationReward} after 7 days (maximum 2/month). Manual grants and milestones are also uncapped.\nYour existing shop balance UI remains unchanged.`,
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (op === "scan-messages") {
    const hours = interaction.options.getInteger("hours") ?? 24;
    const apply = interaction.options.getBoolean("apply") ?? false;
    let result;
    try {
      result = await scanAndAwardMessages({
        guild: interaction.guild, manager: interaction.member,
        actorId, hours, apply,
      });
    } catch (error) {
      console.error("[Points] Staff message scan failed:", error);
      throw new UserFacingError(error.message || "Could not complete the server message scan.");
    }
    const lines = [
      `**${apply ? "Message rewards applied" : "Message rewards preview — no Points changed"}**`,
      `Window: last ${hours} hour(s), excluding the most recent 30 minutes to avoid overlapping live rewards.`,
      `Channels scanned: **${result.channels}** · inaccessible/unsupported: **${result.skippedInaccessible}**`,
      `Messages examined: **${result.totalFetched}**`,
      `Qualifying unpaid message rewards: **${result.candidates}**, across **${result.recipientCount}** members`,
      `Potential Points: **${result.plannedPoints}**`,
      ...(apply ? [
        `Actually credited: **${result.credited}** messages, **+${result.points} Points**`,
        `Failed credits: **${result.failed}** (check bot logs if nonzero)`,
      ] : ["No rewards were sent. Run again with apply: true after reviewing the preview."]),
      "Re-runs skip already-paid messages. No weekly message or voice cap applies.",
    ];
    await interaction.editReply({ content: lines.join("\n"), allowedMentions: { parse: [] } });
    return;
  }
  if (op === "activity-toggle") {
    const source = interaction.options.getString("source", true);
    const enabled = interaction.options.getBoolean("enabled", true);
    const fields = {};
    if (source === "both" || source === "messages") fields.messageRewardsEnabled = enabled;
    if (source === "both" || source === "voice") fields.voiceRewardsEnabled = enabled;
    await PointsSettings.updateOne({ guildId }, { $set: fields },
      { upsert: true, setDefaultsOnInsert: true });
    await interaction.editReply({ content:
      `**Activity Points ${enabled ? "enabled" : "paused"}** for **${source}**.\n` +
      "Only eligible human activity is rewarded. Messages require Message Content intent; voice requires two eligible members and excludes deafened users/AFK channels. Existing balances are unchanged." });
    return;
  }
  if (op === "activity-status") {
    const memberUser = interaction.options.getUser("member", true);
    const member = await interaction.guild.members.fetch(memberUser.id).catch(() => null);
    if (!member || member.user?.bot) throw new UserFacingError("Choose a current human server member.");
    const period = activityPeriod(member.joinedAt);
    const [counter, settings, voice] = await Promise.all([
      PointsActivityCounter.findOne({ guildId, discordUserId: member.id, periodKey: period.key }).lean(),
      PointsSettings.findOne({ guildId }).lean(),
      PointsVoiceProgress.findOne({ guildId, discordUserId: member.id, periodKey: period.key }).lean(),
    ]);
    const earned = counter?.earned ?? 0;
    await interaction.editReply({ content:
      `**Repeatable activity for <@${member.id}>**\n` +
      `Period: **${period.starter ? "First 7 days since joining" : "UTC Monday–Sunday week"}** · multiplier: **${period.multiplier}×** (chat/voice only)\n` +
      `Earned this period: **${earned} Points** · **No overall activity limit**\n` +
      `Qualified voice minutes this period: **${voice?.eligibleMinutes ?? 0}**\n` +
      `Messages: **${settings?.messageRewardsEnabled ? "ON" : "OFF"}** · Voice: **${settings?.voiceRewardsEnabled ? "ON" : "OFF"}**\n` +
      "This is a running total of poll, chat and voice earnings, not a limit. Approved poll rewards retain their separate weekly sublimit; milestones and staff grants are separate.",
      allowedMentions: { parse: [] } });
    return;
  }
  if (op === "milestone") {
    const milestone = interaction.options.getString("achievement", true);
    const points = interaction.options.getInteger("points", true);
    if (!POINTS_MILESTONES[milestone]) throw new UserFacingError("Unknown Points milestone.");
    await PointsSettings.updateOne({ guildId },
      { $set: { [`milestoneAmounts.${milestone}`]: points } },
      { upsert: true, setDefaultsOnInsert: true });
    await interaction.editReply({ content:
      `**${POINTS_MILESTONES[milestone].label}** now awards **${points} Points** for future unclaimed milestones.` });
    return;
  }
  if (op === "toggle") {
    const enabled = interaction.options.getBoolean("enabled", true);
    await PointsSettings.updateOne({ guildId },
      { $set: { milestonesEnabled: enabled } },
      { upsert: true, setDefaultsOnInsert: true });
    await interaction.editReply({ content: enabled
      ? "Milestone rewards are now enabled." : "Milestone rewards are paused. Existing Points are unchanged." });
    return;
  }

  if (op === "poll-approve" || op === "poll-disable") {
    const parsed = parseGuildMessageLink(interaction.options.getString("link", true), guildId);
    if (!parsed) throw new UserFacingError("Paste a Discord poll message link from this server.");
    const existing = await ParticipationSource.findOne({
      guildId, messageId: parsed.messageId,
    }).lean();
    if (existing && (existing.source !== "discord-native-poll" ||
        existing.channelId !== parsed.channelId)) {
      throw new UserFacingError("This link is already registered as a different type of event.");
    }
    if (op === "poll-disable") {
      if (!existing) throw new UserFacingError("That native poll hasn't been approved yet.");
      await ParticipationSource.updateOne({ guildId, messageId: parsed.messageId,
        source: "discord-native-poll" }, { $set: { rewardEnabled: false } });
      await interaction.editReply({ content:
        "Future Points rewards are disabled for this poll. Already earned Points remain unchanged." });
      return;
    }
    const channel = await interaction.guild.channels.fetch(parsed.channelId).catch(() => null);
    if (!channel?.messages?.fetch) throw new UserFacingError("AM Isa cannot read the poll channel.");
    const message = await channel.messages.fetch(parsed.messageId).catch(() => null);
    if (!message?.poll) throw new UserFacingError(
      "This message isn't a native Discord poll. Arclo polls cannot be approved for automatic Points.");
    await ParticipationSource.updateOne({ guildId, messageId: parsed.messageId,
      source: "discord-native-poll" }, {
      $setOnInsert: { guildId, messageId: parsed.messageId, channelId: parsed.channelId,
        source: "discord-native-poll" },
      $set: { rewardEnabled: true, rewardApprovedBy: actorId,
        rewardApprovedAt: new Date(), lastObservedAt: new Date() },
    }, { upsert: true });

    let summary = "Approved this native Discord poll for **5 Points per unique participant**, subject to the **15-Point weekly poll cap**. Re-votes cannot earn twice.";
    try {
      const scan = await syncNativePoll(message);
      const awards = await awardObservedPollVoters({
        guildId, messageId: parsed.messageId, channelId: parsed.channelId,
        guild: interaction.guild,
      });
      summary += `\nCurrent voters: ${scan.voters}. Newly awarded: ${awards.credited} member(s), +${awards.points} total Points. Skipped: ${awards.skipped} (already paid or at cap).`;
    } catch (error) {
      console.error("[Points] Poll approved, but initial voter payout requires review:", error);
      summary += "\nExisting voter sync/payout could not complete; approval remains active. You can retry with /points-observe sync.";
    }
    await interaction.editReply({ content: summary, allowedMentions: { parse: [] } });
    return;
  }
  if (op === "grant-multiple") {
    let userIds;
    let details;
    try {
      userIds = parseBulkRecipients(interaction.options.getString("members", true));
      details = bulkAwardDetails(
        interaction.options.getString("reason", true),
        interaction.options.getString("note") ?? "",
        interaction.options.getString("reference") ?? "");
    } catch (error) {
      throw new UserFacingError(error.message);
    }
    const amount = interaction.options.getInteger("points", true);
    // Validate all current server members BEFORE crediting any of them.
    const members = [];
    for (const id of userIds) {
      const member = await interaction.guild.members.fetch(id).catch(() => null);
      if (!member || member.user.bot) {
        throw new UserFacingError(`<@${id}> is not a current human member. No Points were issued.`);
      }
      members.push(member);
    }
    const eventKey = `manual-batch:${details.reference || interaction.id}`;
    let credited = 0, duplicate = 0, failed = 0;
    for (const member of members) {
      try {
        const award = await grantPoints({
          guildId, userId: member.id, eventKey, amount,
          kind: "manual", description: details.description,
          actorId, sourceId: details.reference || interaction.id,
        });
        if (award.credited) credited++;
        else duplicate++;
      } catch (error) {
        failed++;
        console.error(`[Points] Bulk grant failed for ${member.id}:`, error);
      }
    }
    await interaction.editReply({ content:
      `**${details.description}** — ${amount} Points per member\n` +
      `Credited: **${credited}** · Already credited: **${duplicate}** · Failed: **${failed}**\n` +
      `Total awarded now: **${credited * amount} Points**\n` +
      `Recipients: ${members.map(m => `<@${m.id}>`).join(", ")}\n` +
      `Event reference: \`${details.reference || interaction.id}\`\n` +
      (failed ? "**Some credits failed.** Retry the same command with the SAME reference to avoid paying successful recipients again." :
        "Every award is recorded in each member's Points history."),
      allowedMentions: { parse: [] },
    });
    return;
  }
  const user = interaction.options.getUser("member", true);
  if (user.bot) throw new UserFacingError("Bot accounts aren't eligible for community Points.");
  // Direct awards and applied backfills must target a current server member,
  // not a bot, arbitrary Discord ID, or someone who has already left.
  if (op === "grant" || (op === "backfill" &&
      interaction.options.getBoolean("apply") === true)) {
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member || member.user.bot) {
      throw new UserFacingError("Only current, non-bot server members can receive Points.");
    }
  }
  if (op === "grant") {
    const amount = interaction.options.getInteger("points", true);
    const reason = interaction.options.getString("reason", true).trim();
    const result = await grantPoints({
      guildId, userId: user.id, amount, eventKey: `manual:${interaction.id}`,
      kind: "manual", description: reason, actorId,
    });
    await interaction.editReply({ content: result.credited
      ? `Awarded **${amount} Points** to <@${user.id}> for **${reason}**. Saved in the Points ledger.`
      : "This manual award was already recorded; no additional Points were added.",
      allowedMentions: { users: [user.id] } });
    return;
  }
  if (op === "history") {
    const [events, wallet] = await Promise.all([
      PointsLedger.find({ guildId, discordUserId: user.id })
        .sort({ createdAt: -1 }).limit(10).lean(),
      PointsWallet.findOne({ guildId, discordUserId: user.id }).lean(),
    ]);
    const lines = events.map(event =>
      `• +${event.amount} Points · ${event.description} · <t:${Math.floor(new Date(event.createdAt).getTime() / 1000)}:d>`);
    await interaction.editReply({ content:
      `**Points history for <@${user.id}>** · Balance: **${wallet?.balance ?? 0}**\n` +
      (lines.length ? lines.join("\n") : "No award receipts recorded yet."),
      allowedMentions: { parse: [] } });
    return;
  }
  if (op === "backfill") {
    const apply = interaction.options.getBoolean("apply") ?? false;
    const scan = await backfillMilestones(guildId, user.id, { apply });
    const message = scan.labels.length ? scan.labels.map(x => `• ${x}`).join("\n")
      : "No additional qualifying milestones were found.";
    await interaction.editReply({ content:
      `**${apply ? "Backfill completed" : "Dry-run backfill"} — <@${user.id}>**\n` +
      message + (apply
        ? `\n**Credited: ${scan.count} milestone(s), +${scan.total} Points.**`
        : "\n**No Points changed.** Re-run with apply: true to credit any unclaimed achievements."),
      allowedMentions: { parse: [] } });
  }
}
