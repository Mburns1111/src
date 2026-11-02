import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import { configureAutomaticDrops } from "../services/card-automatic-drops.js";

export const data = new SlashCommandBuilder()
  .setName("cards-admin")
  .setDescription("Server-only Hatchem configuration")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(command => command.setName("setup-role")
    .setDescription("Set the Card role for this server; no release controls")
    .addRoleOption(option => option.setName("role")
      .setDescription("Role registered collectors will receive").setRequired(true)))
  .addSubcommand(command => command.setName("auto-drops")
    .setDescription("Enable or disable random and activity-triggered eggs")
    .addBooleanOption(option => option.setName("enabled").setDescription("Post automatic eggs").setRequired(true)));

export async function execute(interaction) {
  if (!interaction.guildId || !interaction.guild) return interaction.editReply("Use this command inside a server.");
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.editReply("Only server managers can configure Hatchem in this server.");
  }
  if (interaction.options.getSubcommand() === "auto-drops") {
    try {
      const result = await configureAutomaticDrops({
        guildId: interaction.guildId,
        enabled: interaction.options.getBoolean("enabled", true),

      });
      return interaction.editReply(result.enabled
        ? "Automatic Hatchem eggs enabled: **randomly every 45–75 minutes**, plus a chance of bonus eggs during active conversations. Next timed egg: <t:" + Math.ceil(result.nextAt.getTime()/1000) + ":R>. Player drop cooldowns are unaffected."
        : "Automatic Hatchem eggs disabled for this server. Player-created drops are unaffected.");
    } catch(error) { return interaction.editReply(error.message); }
  }
  if (interaction.options.getSubcommand() !== "setup-role") return interaction.editReply("Unknown Card setup action.");
  const role = interaction.options.getRole("role", true);
  if (role.id === interaction.guildId || role.managed ||
      role.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.editReply("Choose a normal server role, not @everyone, an integration-managed role, or a role with Administrator permissions.");
  }
  const botMember = interaction.guild.members.me ||
    await interaction.guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles) ||
      role.position >= botMember.roles.highest.position) {
    return interaction.editReply("Move the bot's role above the Card role and give it Manage Roles first.");
  }
  await GuildConfig.findOneAndUpdate({ guildId: interaction.guildId },
    { $set: { cardRoleId: role.id } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true });
  return interaction.editReply({
    content: `Saved ${role} as this server's Card role. Members receive this role only when they explicitly use .register in this server. This does not change global egg releases.`,
    allowedMentions: { parse: [] },
  });
}
