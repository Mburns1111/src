import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import { requireGuild } from "./shared.js";
import { UserFacingError } from "./errors.js";

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Configure the server's house, inventory, and voting channels")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((command) =>
    command
      .setName("channels")
      .setDescription("Choose separate channels for houses, inventory, and trade votes")
      .addChannelOption((option) =>
        option
          .setName("house_listings")
          .setDescription("Channel for house ads")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("inventory_showcase")
          .setDescription("Channel for member inventory albums and video links")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("trade_voting")
          .setDescription("Dedicated channel for trade posts and votes")
          .addChannelTypes(ChannelType.GuildText),
      ),
  );

export async function execute(interaction) {
  requireGuild(interaction);
  const houseListings = interaction.options.getChannel("house_listings");
  const inventoryShowcase = interaction.options.getChannel("inventory_showcase");
  const tradeVoting = interaction.options.getChannel("trade_voting");

  if (!houseListings && !inventoryShowcase && !tradeVoting) {
    throw new UserFacingError("Choose at least one channel to configure.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const updates = {};
  if (houseListings) updates.houseChannelId = houseListings.id;
  if (inventoryShowcase) updates.inventoryChannelId = inventoryShowcase.id;
  if (tradeVoting) updates.tradeVoteChannelId = tradeVoting.id;

  await GuildConfig.findOneAndUpdate(
    { guildId: interaction.guildId },
    { $set: updates },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  const configured = [];
  if (houseListings) configured.push(`House listings: ${houseListings}`);
  if (inventoryShowcase) configured.push(`Inventory showcase: ${inventoryShowcase}`);
  if (tradeVoting) configured.push(`Trade voting: ${tradeVoting}`);

  await interaction.editReply({
    content: `Channel settings saved.\n${configured.join("\n")}`,
    allowedMentions: { parse: [] },
  });
}
