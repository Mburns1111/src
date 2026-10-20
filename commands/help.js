import {
  ApplicationCommandOptionType,
  EmbedBuilder,
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

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Adopt Me Showcase & Marketplace — Help")
    .setDescription("Here’s what I can do in this server.")
    .addFields({
      name: "Features",
      value: [
        "• **Member profiles:** save an Adopt Me username, bio, trade interest, inventory video, and screenshot album. `/profile show` displays saved album images and uploaded videos inline.",
        "• **Inventory showcase:** album images and videos are archived in the configured inventory channel and their attachment details are saved with the profile. Use `/inventory-video` to upload a video file; external links depend on their host.",
        "• **House ads:** post a house with its price, estimated value, and media. Uploaded media is stored with the listing. Sellers or server managers can mark it sold to remove the ad.",
        "• **Trade voting:** use `/new-vote` to post an offer with optional media saved to the listing. Members can rate it Good, Bad, or Unsure and separately say Would make or Wouldn't make. The poster cannot vote on their own trade.",
        "• **Server setup:** admins with Manage Server can choose separate house, inventory, and trade-voting channels.",
      ].join("\n"),
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

  await interaction.reply({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
}
