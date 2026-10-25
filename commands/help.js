import {
  ApplicationCommandOptionType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { requireGuild } from "./shared.js";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show what this bot does and its commands in this server");

function formatCommand(command) {
  const lines = [
    `• \`/${command.name}\` — ${command.description || "Bot command"}`,
  ];

  for (const option of command.options ?? []) {
    if (option.type === ApplicationCommandOptionType.Subcommand) {
      lines.push(
        `  \`/${command.name} ${option.name}\` — ${option.description || "Subcommand"}`,
      );
      continue;
    }

    if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
      for (const subcommand of option.options ?? []) {
        if (subcommand.type !== ApplicationCommandOptionType.Subcommand) continue;
        lines.push(
          `  \`/${command.name} ${option.name} ${subcommand.name}\` — ${subcommand.description || "Subcommand"}`,
        );
      }
    }
  }

  return lines.join("\n");
}

function splitIntoFields(lines, maxLength = 950) {
  const fields = [];
  let current = "";

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLength && current) {
      fields.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) fields.push(current);
  return fields;
}

export async function execute(interaction) {
  requireGuild(interaction);
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Adopt Me Showcase & Marketplace — Help")
    .setDescription("Here’s what I can do in this server.");

  const featureLines = [
    "• **Profiles:** Use the button in the profiles channel to create or update your profile. Your profile card is kept there; use its buttons to edit details, add photos, or add an inventory video. Run `/profile` to get the card link; add a user to view their profile.",
    "• **Inventory videos:** Use the button in the inventory channel to upload a video or add a video link. Videos over 8 MB are compressed automatically. Uploads must be under 100 MB. You can also add a video link from your profile card.",
    "• **House ads:** Use the button in the house channel to start a private listing form. Tap its button to fill in your details. Use **Interested** to show interest, and the owner can turn **Interest DMs** on or off for each listing. Upload photos/videos when creating the listing, and use **Mark sold** when it sells. `/house` is also available.",
    "• **Outfit listings:** Use the button in the outfit channel to start a private listing form. Add an optional cost, outfit pictures/video, and remove the listing when it is no longer available. Members can show interest, and the owner can turn on DMs per listing. Active outfit listings appear on your profile and Trading Post card. `/outfit` is also available.",
    "• **Trade votes:** Use the button in the trade channel to start a private form. Tap its button within 1 minute to add one picture and, if you want, one video link or upload. Everyone can vote on the finished post. `/new-vote` is also available.",
    "• **Trading Post:** Use the pinned button in the Trading Post channel to create or update one permanent card. Other members can mark interest; you can opt in to receive DMs. Your profile card links to your Trading Post when you have one.",
    "• **Server setup:** An admin should use `/setup channels` to choose the profiles, house listing, outfit listing, inventory, trade voting, and Trading Post channels. This adds the buttons members can use instead of slash commands. Use `/profile-refresh` to regenerate all existing profile and Trading Post cards plus active house, outfit, and trade posts, or `/profile-cleanup` to remove cards for members who have left; their saved profile data is retained.",
  ];
  splitIntoFields(featureLines).forEach((value, index, fields) => {
    embed.addFields({
      name: fields.length > 1 ? `Features (${index + 1}/${fields.length})` : "Features",
      value,
    });
  });

  try {
    const [globalCommands, guildCommands] = await Promise.all([
      interaction.client.application.commands.fetch(),
      interaction.guild.commands.fetch(),
    ]);
    const commands = new Map();
    for (const command of globalCommands.values()) {
      commands.set(command.name, command);
    }
    // A server-specific command with the same name takes precedence over a global one.
    for (const command of guildCommands.values()) {
      commands.set(command.name, command);
    }

    const lines = [...commands.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap((command) => formatCommand(command).split("\n"));
    if (lines.length) {
      splitIntoFields(lines).forEach((value, index, fields) => {
        embed.addFields({
          name: fields.length > 1
            ? `Bot commands in this server (${index + 1}/${fields.length})`
            : "Bot commands in this server",
          value,
        });
      });
    } else {
      embed.addFields({
        name: "Bot commands in this server",
        value: "No registered application commands were found.",
      });
    }
  } catch (error) {
    console.error("Could not fetch registered server commands for /help:", error);
    embed.addFields({
      name: "Bot commands in this server",
      value: "I couldn't fetch the registered command list right now. Try `/help` again shortly.",
    });
  }

  await interaction.editReply({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
}
