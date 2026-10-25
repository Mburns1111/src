import {
  ActionRowBuilder, ApplicationCommandOptionType, ButtonBuilder,
  ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder,
} from "discord.js";
import { requireGuild } from "./shared.js";
import { UserFacingError } from "./errors.js";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Browse a private guide to the bot's features and commands");

export const HELP_TOPICS = Object.freeze([
  { id: "home", label: "Start here" },
  { id: "listings", label: "Listings" },
  { id: "shop", label: "Shop" },
  { id: "points", label: "Points" },
  { id: "commands", label: "Commands" },
]);

// Keep information about the actual saved bot behavior, not future features.
// Every help section is read-only; it never modifies profiles, listings or media.
const TOPIC_CONTENT = Object.freeze({
  home: {
    title: "AM Isa — Getting started",
    description: "Choose a topic below. This guide is private; other members cannot see which topic you open.",
    fields: [
      ["Your profile", "Use the button in the profile channel to create or edit your card, or run **/profile** to open it. You can view another member's profile using the /profile user option."],
      ["Inventory", "Use the inventory-channel button to add your inventory video. Profile cards also have an option to add or link inventory media."],
      ["Find a listing", "Open the house or outfit channel and use **My house listings** or **My outfit listings** to see private links to your active posts. Browse someone else's public listing directly in its channel."],
      ["Need another feature?", "Use the **Listings**, **Shop**, **Points**, or **Commands** buttons below. Your existing gallery photos and native videos are not changed by using this guide."],
    ],
  },
  listings: {
    title: "AM Isa — Houses, outfits & trades",
    description: "Create listings from the permanent channel buttons; manage each listing on its original post.",
    fields: [
      ["Create a listing", "Choose **Start a house listing** or **Start an outfit listing** in its channel. Finish the private form and upload photos/videos during creation. The **/house** and **/outfit** commands are also available."],
      ["Find your active posts", "Use **My house listings** or **My outfit listings**. A private, paginated list links directly to your active published posts."],
      ["Browse gallery photos", "Use **Previous**, **Next**, or **Choose photo** on a public listing. Choose photo opens a private numbered menu but updates the shared public card. Videos remain playable above the styled card."],
      ["Interest and seller controls", "Members can select **Interested**. Owners can toggle **Interest DMs**, mark a house sold, or remove an outfit listing on its public post."],
      ["Trade votes and Trading Post", "The trade-vote channel button creates a trade vote. The Trading Post channel button creates or updates your permanent trading card. See the related controls in those channels."],
    ],
  },
  shop: {
    title: "AM Isa — Shop & customization",
    description: "Browse appearance options privately and preview choices before buying.",
    fields: [
      ["Open the shop", "Use the shop-channel button or **/shop browse**. Open a category and use its directory to jump to an item instead of browsing one by one."],
      ["Try an appearance", "Preview supported backgrounds, panels, fonts, colors, frames, and stickers. Review the Points price before purchasing. Shop previews do not equip or purchase items automatically."],
      ["Customize your posts", "Use the customization controls on your profile or from the listing-style editor for a house or outfit. Saved listing appearances can differ from your profile."],
      ["Check your balance", "Use **/shop balance** to check your Points privately."],
    ],
  },
  points: {
    title: "AM Isa — Points",
    description: "Points can be spent on appearance items in the shop.",
    fields: [
      ["Balance", "Run **/shop balance** or open the shop to see your balance privately."],
      ["Earning Points", "Server events, eligible participation, milestones, and other activities may award Points when enabled by server staff. Availability depends on this server's settings."],
      ["Spending Points", "Choose an item in the shop, check its price, and confirm the purchase. Browsing or previewing an item does not charge Points."],
      ["Questions about a reward?", "Ask a server manager about the server's Points settings. Staff can review and manage awards with administrator commands."],
    ],
  },
  commands: {
    title: "AM Isa — Registered commands",
    description: "The commands below are read from Discord for this server. Some options are restricted to administrators.",
    fields: [
      ["Server tools", "Administrators can use **/setup channels** to configure entry channels. Maintenance commands such as **/profile-refresh** and **/profile-cleanup** are intended for server managers."],
    ],
  },
});

function formatCommand(command) {
  const lines = ["• /" + command.name + " — " + (command.description || "Bot command")];
  for (const option of command.options ?? []) {
    if (option.type === ApplicationCommandOptionType.Subcommand) {
      lines.push("  /" + command.name + " " + option.name + " — " +
        (option.description || "Subcommand"));
    } else if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
      for (const sub of option.options ?? []) {
        if (sub.type !== ApplicationCommandOptionType.Subcommand) continue;
        lines.push("  /" + command.name + " " + option.name + " " + sub.name +
          " — " + (sub.description || "Subcommand"));
      }
    }
  }
  return lines.join("\n");
}

function splitIntoFields(lines, maxLength = 950) {
  const fields = [];
  let current = "";
  for (const line of lines) {
    const next = current ? current + "\n" + line : line;
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

/** Pure presentation helper for tests. No database or Discord calls. */
export function helpTopicPayload(topicId, ownerId, commandLines = []) {
  if (!TOPIC_CONTENT[topicId] || !/^\d{17,20}$/.test(String(ownerId ?? ""))) {
    throw new UserFacingError("That help menu is no longer available. Run /help again.");
  }
  const topic = TOPIC_CONTENT[topicId];
  const embed = new EmbedBuilder().setColor(0x5865f2)
    .setTitle(topic.title).setDescription(topic.description);
  for (const [name, value] of topic.fields) embed.addFields({ name, value });

  if (topicId === "commands") {
    if (commandLines.length) {
      const sections = splitIntoFields(commandLines);
      sections.slice(0, 20).forEach((value, index) => embed.addFields({
        name: sections.length > 1
          ? "Bot commands (" + (index + 1) + "/" + sections.length + ")"
          : "Bot commands",
        value,
      }));
    } else {
      embed.addFields({ name: "Bot commands", value: "No command list was available. Try again shortly." });
    }
  }
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      HELP_TOPICS.map(item => new ButtonBuilder()
        .setCustomId("help:topic:" + item.id + ":" + ownerId)
        .setLabel(item.label)
        .setStyle(item.id === topicId ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(item.id === topicId)),
    )],
    allowedMentions: { parse: [] },
  };
}

async function currentServerCommands(interaction) {
  try {
    const [globalCommands, guildCommands] = await Promise.all([
      interaction.client.application.commands.fetch(),
      interaction.guild.commands.fetch(),
    ]);
    const byName = new Map();
    for (const command of globalCommands.values()) byName.set(command.name, command);
    for (const command of guildCommands.values()) byName.set(command.name, command);
    return [...byName.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap(command => formatCommand(command).split("\n"));
  } catch (error) {
    console.warn("Could not fetch registered commands for /help:", error);
    return ["I couldn't load the registered command list. Please try this topic again."];
  }
}

async function showHelpTopic(interaction, topic, ownerId) {
  const lines = topic === "commands" ? await currentServerCommands(interaction) : [];
  await interaction.editReply(helpTopicPayload(topic, ownerId, lines));
}

export async function execute(interaction) {
  requireGuild(interaction);
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  await showHelpTopic(interaction, "home", interaction.user.id);
}

export async function handleHelpTopicButton(interaction) {
  const segments = String(interaction.customId ?? "").split(":");
  if (segments.length !== 4 || segments[0] !== "help" ||
      segments[1] !== "topic" || !TOPIC_CONTENT[segments[2]] ||
      segments[3] !== interaction.user.id) {
    throw new UserFacingError("That help menu belongs to another member or has expired. Run /help again.");
  }
  requireGuild(interaction);
  await interaction.deferUpdate();
  await showHelpTopic(interaction, segments[2], interaction.user.id);
  return true;
}
