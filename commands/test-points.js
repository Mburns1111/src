import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import PointsWallet from "../models/PointsWallet.js";
import { requireGuild } from "./shared.js";
import { UserFacingError } from "./errors.js";

// Development-only testing helper. Remove before production deployment.
export const data = new SlashCommandBuilder()
  .setName("test-points")
  .setDescription("DEV ONLY: set a member's shop Points for testing")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addUserOption(option => option.setName("member").setDescription("Test member").setRequired(true))
  .addIntegerOption(option => option.setName("amount").setDescription("New test balance (0–100000)")
    .setMinValue(0).setMaxValue(100000).setRequired(true));

export async function execute(interaction) {
  requireGuild(interaction);
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new UserFacingError("Only server managers can set test Points.");
  }
  const member = interaction.options.getUser("member", true);
  const amount = interaction.options.getInteger("amount", true);
  const wallet = await PointsWallet.findOneAndUpdate(
    { guildId: interaction.guildId, discordUserId: member.id },
    { $set: { balance: amount } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
  await interaction.editReply({
    content: `Test balance for <@${member.id}> set to **${wallet.balance} Points**. This replaces the previous balance.`,
    allowedMentions: { parse: [] },
  });
}
