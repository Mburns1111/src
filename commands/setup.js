import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import { requireGuild } from "./shared.js";
import { UserFacingError } from "./errors.js";
import { ensureTradingPostEntry } from "./trading-post.js";

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Configure the server's command and showcase channels")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((command) =>
    command
      .setName("channels")
      .setDescription("Choose where commands and server posts should go")
      .addChannelOption((option) =>
        option
          .setName("commands")
          .setDescription("Channel where members can use bot slash commands")
          .addChannelTypes(ChannelType.GuildText),
      )
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
          .setName("profiles")
          .setDescription("Channel where member profile cards are kept")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("trade_voting")
          .setDescription("Dedicated channel for trade posts and votes")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("trading_post")
          .setDescription("Channel for permanent member Trading Post cards")
          .addChannelTypes(ChannelType.GuildText),
      ),
  );

export async function execute(interaction) {
  requireGuild(interaction);
  const commandsChannel = interaction.options.getChannel("commands");
  const houseListings = interaction.options.getChannel("house_listings");
  const inventoryShowcase = interaction.options.getChannel("inventory_showcase");
  const tradeVoting = interaction.options.getChannel("trade_voting");
  const profilesChannel = interaction.options.getChannel("profiles");
  const tradingPostChannel = interaction.options.getChannel("trading_post");

  if (
    !commandsChannel &&
    !houseListings &&
    !inventoryShowcase &&
    !tradeVoting &&
    !profilesChannel &&
    !tradingPostChannel
  ) {
    throw new UserFacingError("Choose at least one channel to configure.");
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  const updates = {};
  if (commandsChannel) updates.commandChannelId = commandsChannel.id;
  if (houseListings) updates.houseChannelId = houseListings.id;
  if (inventoryShowcase) updates.inventoryChannelId = inventoryShowcase.id;
  if (tradeVoting) updates.tradeVoteChannelId = tradeVoting.id;
  if (profilesChannel) updates.profileChannelId = profilesChannel.id;
  if (tradingPostChannel) updates.tradingPostChannelId = tradingPostChannel.id;

  await GuildConfig.findOneAndUpdate(
    { guildId: interaction.guildId },
    { $set: updates },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
  if (tradingPostChannel) {
    await ensureTradingPostEntry(interaction.guild, tradingPostChannel);
  }

  const configured = [];
  if (commandsChannel) configured.push(`Bot commands: ${commandsChannel}`);
  if (houseListings) configured.push(`House listings: ${houseListings}`);
  if (inventoryShowcase) configured.push(`Inventory showcase: ${inventoryShowcase}`);
  if (tradeVoting) configured.push(`Trade voting: ${tradeVoting}`);
  if (profilesChannel) configured.push(`Member profiles: ${profilesChannel}`);
  if (tradingPostChannel) {
    configured.push(`Trading Post cards and pinned create button: ${tradingPostChannel}`);
  }

  await interaction.editReply({
    content: `Channel settings saved.\n${configured.join("\n")}`,
    allowedMentions: { parse: [] },
  });
}
