import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import PointsSettings from "../models/PointsSettings.js";
import PointsLedger from "../models/PointsLedger.js";
import PointsWallet from "../models/PointsWallet.js";
import { grantPoints } from "../services/points-rewards.js";
import { backfillMilestones } from "../services/points-backfill.js";
import { POINTS_MILESTONES, POINTS_ACTIVITY_TARGETS, milestoneAwardAmount } from "../services/points-policy.js";
import { requireGuild } from "./shared.js";
import { UserFacingError } from "./errors.js";

const milestoneChoices = Object.entries(POINTS_MILESTONES)
  .map(([value, item]) => ({ name: item.label, value }));

export const data = new SlashCommandBuilder()
  .setName("points-admin")
  .setDescription("Manage and audit community Points earnings")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(c => c.setName("settings")
    .setDescription("Show achievement rewards and future activity targets"))
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
        `\n\n**Phase 2 earning targets (not active yet):** first 7 days up to ${POINTS_ACTIVITY_TARGETS.starterWeekActivityCap} activity Points; later weeks up to ${POINTS_ACTIVITY_TARGETS.laterWeeklyActivityCap}; verified invite ${POINTS_ACTIVITY_TARGETS.invitationReward} after 7 days (maximum 2/month).\nYour existing shop balance UI remains unchanged.`,
      allowedMentions: { parse: [] },
    });
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

  const user = interaction.options.getUser("member", true);
  if (user.bot) throw new UserFacingError("Bot accounts aren't eligible for community Points.");
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
