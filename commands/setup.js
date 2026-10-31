import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import { HATCHEM_GUIDE } from "../services/hatchem-text-commands.js";
import { requireGuild } from "./shared.js";
import { UserFacingError } from "./errors.js";
import { ensureHouseEntry } from "./house.js";
import { ensureOutfitEntry } from "./outfit.js";
import { ensureInventoryEntry } from "./inventory-video.js";
import { ensureProfileEntry } from "./profile.js";
import { ensureTradeVoteEntry } from "./trade.js";
import { ensureTradingPostEntry } from "./trading-post.js";
import { ensureShopEntry } from "./shop.js";

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
          .setName("outfit_listings")
          .setDescription("Channel for outfit listings")
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
      )
      .addChannelOption((option) =>
        option
          .setName("hatchem")
          .setDescription("Hatchem collectible-card game channel")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("shop")
          .setDescription("Channel for the permanent shop catalog")
          .addChannelTypes(ChannelType.GuildText),
      ),
  );

export async function execute(interaction) {
  requireGuild(interaction);
  const commandsChannel = interaction.options.getChannel("commands");
  const houseListings = interaction.options.getChannel("house_listings");
  const outfitListings = interaction.options.getChannel("outfit_listings");
  const inventoryShowcase = interaction.options.getChannel("inventory_showcase");
  const tradeVoting = interaction.options.getChannel("trade_voting");
  const profilesChannel = interaction.options.getChannel("profiles");
  const tradingPostChannel = interaction.options.getChannel("trading_post");
  const shopChannel = interaction.options.getChannel("shop");
  const hatchemChannel = interaction.options.getChannel("hatchem");

  if (
    !commandsChannel &&
    !houseListings &&
    !outfitListings &&
    !inventoryShowcase &&
    !tradeVoting &&
    !profilesChannel &&
    !tradingPostChannel &&
    !shopChannel &&
    !hatchemChannel
  ) {
    throw new UserFacingError("Choose at least one channel to configure.");
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  const updates = {};
  if (commandsChannel) updates.commandChannelId = commandsChannel.id;
  if (houseListings) updates.houseChannelId = houseListings.id;
  if (outfitListings) updates.outfitChannelId = outfitListings.id;
  if (inventoryShowcase) updates.inventoryChannelId = inventoryShowcase.id;
  if (tradeVoting) updates.tradeVoteChannelId = tradeVoting.id;
  if (profilesChannel) updates.profileChannelId = profilesChannel.id;
  if (tradingPostChannel) updates.tradingPostChannelId = tradingPostChannel.id;
  if (hatchemChannel) updates.hatchemChannelId = hatchemChannel.id;

  // Ensure the shop before updating channel settings so its existing message IDs
  // are checked against the previous channel when a shop is moved.
  if (shopChannel) await ensureShopEntry(interaction.guild, shopChannel);
  const previousHatchem = hatchemChannel
    ? await GuildConfig.findOne({ guildId: interaction.guildId }).select("hatchemChannelId hatchemGuideMessageId").lean()
    : null;

  await GuildConfig.findOneAndUpdate(
    { guildId: interaction.guildId },
    { $set: updates },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
  if (houseListings) await ensureHouseEntry(interaction.guild, houseListings);
  if (outfitListings) await ensureOutfitEntry(interaction.guild, outfitListings);
  if (inventoryShowcase) await ensureInventoryEntry(interaction.guild, inventoryShowcase);
  if (profilesChannel) await ensureProfileEntry(interaction.guild, profilesChannel);
  if (tradeVoting) await ensureTradeVoteEntry(interaction.guild, tradeVoting);
  if (tradingPostChannel) {
    await ensureTradingPostEntry(interaction.guild, tradingPostChannel);
  }

  if (hatchemChannel) {
    let guide = null;
    if (previousHatchem?.hatchemChannelId === hatchemChannel.id && previousHatchem.hatchemGuideMessageId) {
      guide = await hatchemChannel.messages.fetch(previousHatchem.hatchemGuideMessageId).catch(() => null);
      if (guide?.author?.id !== interaction.client.user.id) guide = null;
    }
    if (guide) await guide.edit({ content: HATCHEM_GUIDE, allowedMentions: { parse: [] } });
    else {
      guide = await hatchemChannel.send({ content: HATCHEM_GUIDE, allowedMentions: { parse: [] } });
      await GuildConfig.updateOne({ guildId: interaction.guildId },
        { $set: { hatchemGuideMessageId: guide.id } });
    }
  }

  const configured = [];
  if (commandsChannel) configured.push(`Bot commands: ${commandsChannel}`);
  if (houseListings) {
    configured.push(`House listings and create button: ${houseListings}`);
  }
  if (outfitListings) {
    configured.push(`Outfit listings and create button: ${outfitListings}`);
  }
  if (inventoryShowcase) {
    configured.push(`Inventory showcase and video button: ${inventoryShowcase}`);
  }
  if (tradeVoting) configured.push(`Trade voting and create button: ${tradeVoting}`);
  if (profilesChannel) {
    configured.push(`Member profiles and profile button: ${profilesChannel}`);
  }
  if (tradingPostChannel) {
    configured.push(`Trading Post cards and pinned create button: ${tradingPostChannel}`);
  }
  if (shopChannel) {
    configured.push(`Shop catalog and Points button: ${shopChannel}`);
  }
  if (hatchemChannel) configured.push(`Hatchem card-game commands: ${hatchemChannel}`);

  await interaction.editReply({
    content: `Channel settings saved.\n${configured.join("\n")}`,
    allowedMentions: { parse: [] },
  });
}
