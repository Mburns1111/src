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
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Adopt Me Showcase & Marketplace — Help")
    .setDescription("Here’s what I can do in this server.");

  const featureLines = [
    "• **Profiles:** Run `/profile` and choose a button to view or edit your card, add photos, or add an inventory video. Use the arrows to browse photos. Add a user to `/profile` to view their card.",
    "• **Inventory videos:** Upload a video with `/inventory-video`. Videos over 8 MB are compressed automatically. Uploads must be under 100 MB. You can also add a video link to your profile.",
    "• **House ads:** Post your house details and an optional video link. Use **Add pictures/video** on your ad to add photos or a video later. Videos over 8 MB are compressed; uploads must be under 100 MB. Use **Mark sold** when your house is sold.",
    "• **Trade votes:** Post one required picture and, if you want, a video link or an uploaded video. Pick one video option, not both. The server can vote on the trade.",
    "• **Server setup:** Server admins can choose where bot commands, house ads, inventory posts, and trade votes go.",
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
