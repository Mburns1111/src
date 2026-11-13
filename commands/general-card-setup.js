import mongoose from "mongoose";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder,
  ChannelType, MessageFlags, PermissionFlagsBits, RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import {preferSetupButtons} from "../services/setup-button-preferences.js";
import {retireGuidedControls} from "../services/retire-guided-controls.js";
import { HATCHEM_GUIDE } from "../services/hatchem-text-commands.js";
import { hatchemTutorialEntryRow } from "./card-tutorial-ui.js";
import { ensureProfileEntry } from "./profile.js";
import { ensureHouseEntry } from "./house.js";
import { ensureOutfitEntry } from "./outfit.js";
import { ensureInventoryEntry } from "./inventory-video.js";
import { ensureTradeVoteEntry } from "./trade.js";
import { ensureTradingPostEntry } from "./trading-post.js";
import { ensureShopEntry } from "./shop.js";

// Same guided conversation pattern as regular, activity and Trial setup.
// No stored configuration is changed until the final Save button.
const sessions = new Map();
const SESSION_MS = 30 * 60_000;
const GENERAL_STEPS = [
  ["commandChannelId", "Bot commands", true],
  ["profileChannelId", "Member profiles", false],
  ["houseChannelId", "House listings", false],
  ["outfitChannelId", "Outfit listings", false],
  ["inventoryChannelId", "Inventory showcase", false],
  ["tradingPostChannelId", "Trading Posts", false],
  ["tradeVoteChannelId", "Trade voting", false],
  ["shopChannelId", "Points & customization shop", false],
  ["partyGamesChannelId", "Party games", false],
];
const CARD_STEPS = [
  ["hatchemChannelId", "Hatchem card-game channel", true],
  ["cardRoleId", "Collector registration role", true],
  ["hatchemAutoDropsEnabled", "Wild activity eggs", false],
];
export const generalSetupFields = GENERAL_STEPS.map(step => step[0]);
export const cardSetupFields = CARD_STEPS.map(step => step[0]);
const stepsFor = mode => mode === "general" ? GENERAL_STEPS : CARD_STEPS;
const sessionKey = (guild, member) => guild + ":" + member;
const shown = id => id ? "<#" + id + ">" : "Disabled / skipped";
const label = (item, value) => item[0] === "cardRoleId"
  ? (value ? "<@&" + value + ">" : "Not configured")
  : item[0] === "hatchemAutoDropsEnabled"
    ? (value === false ? "Disabled" : "Enabled") : shown(value);
const row = (session, values) => new ActionRowBuilder().addComponents(values.map(
  ([name, action, style = ButtonStyle.Secondary]) => new ButtonBuilder()
    .setCustomId("guildconfig:" + session.id + ":" + action)
    .setLabel(name).setStyle(style),
));
const selectedCustomId = (session, action) => "guildconfig:" + session.id + ":" + action;

export function guidedGuildSetupSummary(mode, settings) {
  const first = mode === "general" ? "**General Setup — Review**" : "**Hatchem Card Game Setup — Review**";
  const lines = [first];
  for (const step of stepsFor(mode))
    lines.push("**" + step[1] + ":** " + label(step, settings[step[0]]));
  if (mode === "general") {
    lines.push("", "**Commands channel is mandatory.** Every other feature can be skipped or disabled.",
      "A skipped feature will not have a configured post channel. Previously published posts and stored member data are not deleted.",
      "Giveaways, activity giveaways, Court's Trials and Hatchem are configured with their **own** guided setup commands.");
  } else {
    lines.push("", "Only members who explicitly register receive the chosen Collector role.",
      "Wild egg chances use the existing global rules; disabling this option leaves manual card drops available.",
      "Card collecting and typed commands require the Hatchem channel, Collector role, and the bot's separately enabled card-game mode.");
  }
  lines.push("", "*Nothing is saved until you select Save Setup.*");
  return lines.join("\n");
}

function layout(session) {
  const list = stepsFor(session.mode);
  const editing = session.editing;
  const currentStep = list[session.index];
  const prefix = "**" + (session.mode === "general" ? "General" : "Hatchem Card Game") +
    " Setup** · <@" + session.owner + ">\n";
  const controls = [];
  if (session.review) {
    const summary = guidedGuildSetupSummary(session.mode, session.settings);
    controls.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(selectedCustomId(session, "edit"))
        .setPlaceholder("Edit a setup setting")
        .addOptions(list.map(([field, title]) => ({ label: title, value: field })))));
    controls.push(row(session, [["Preview settings", "preview"]]));
    controls.push(row(session, [["Save Setup", "save", ButtonStyle.Success],
      ["Cancel", "cancel", ButtonStyle.Danger]]));
    return { content: prefix + summary, components: preferSetupButtons(controls), allowedMentions: { parse: [] } };
  }
  const [field, name, required] = currentStep;
  let description = "**" + (editing ? "Editing " + name : "Step " + (session.index + 1) + " of " + list.length + " · " + name) + "**\n";
  description += "Current: " + label(currentStep, session.settings[field]) + "\n";
  if (field === "commandChannelId")
    description += "Choose a **private staff-only Bot Commands channel** for setup, administration and general bot management. Hide this channel from @everyone. **Required** even if you only use giveaways or Hatchem.";
  else if (field === "cardRoleId")
    description += "Choose a non-administrator Collector role. The bot must have Manage Roles and its highest role must be above this role. Members only receive it when they register.";
  else if (field === "hatchemAutoDropsEnabled")
    description += "Allow automatic wild eggs from qualifying server activity? The existing fixed activity thresholds are unchanged. You can turn this off and still use manual .drop.";
  else if (field === "hatchemChannelId")
    description += "Choose Hatchem's dedicated text-command and egg channel. Cards will not operate in other channels.";
  else
    description += "Choose a public channel for this feature, or **Skip / disable** to leave it off. Optional features never prevent setup completion.";
  if (field === "hatchemAutoDropsEnabled") {
    controls.push(row(session, [["Enable wild eggs", "enable"],
      ["Disable wild eggs", "disable"], ["Keep current", "keep"]]));
  } else if (field === "cardRoleId") {
    controls.push(new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId(selectedCustomId(session, "role"))
        .setPlaceholder("Select Collector role").setMinValues(1).setMaxValues(1)));
    if (session.settings[field]) controls.push(row(session, [["Keep current role", "keep"]]));
  } else {
    controls.push(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId(selectedCustomId(session, "channel"))
        .setPlaceholder("Select " + name).setMinValues(1).setMaxValues(1)
        .addChannelTypes(ChannelType.GuildText)));
    if (session.settings[field]) controls.push(row(session, [["Keep current channel", "keep"]]));
  }
  if (!required) controls.push(row(session, [["Skip / disable this feature", "skip"]]));
  controls.push(row(session, [["Back", "back"], ["Cancel setup", "cancel", ButtonStyle.Danger]]));
  return { content: prefix + description, components: preferSetupButtons(controls), allowedMentions: { parse: [] } };
}

async function show(session) {
  session.expiresAt = Date.now() + SESSION_MS;
  const previous=session.promptMessage;
  const message = await session.channel.send(layout(session));
  session.messageId = message.id;
  session.promptMessage=message;
  await retireGuidedControls(previous,session.channel);
}
async function next(session) {
  if (session.editing) {
    session.editing = false;
    session.review = true;
  } else if (session.index >= stepsFor(session.mode).length - 1) {
    session.review = true;
  } else session.index++;
  await show(session);
}
async function validateChannel(session, id, {requirePrivate=false}={}) {
  const channel = await session.guild.channels.fetch(id).catch(() => null);
  if (!channel?.isTextBased?.() || !channel?.send || !channel?.permissionsFor)
    throw Error("The selected channel cannot receive bot messages.");
  if(requirePrivate && channel.permissionsFor(session.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel))
    throw Error("The Bot Commands channel must be hidden from @everyone.");
  const bot = await session.guild.members.fetchMe();
  const perms = channel.permissionsFor(bot);
  for (const flag of [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])
    if (!perms?.has(flag)) throw Error("Bot needs View Channel, Send Messages and Embed Links in <#" + id + ">.");
  return channel;
}
async function validateRole(session, roleId) {
  const role = await session.guild.roles.fetch(roleId).catch(() => null);
  if (!role || role.id === session.guild.id || role.managed ||
      role.permissions.has(PermissionFlagsBits.Administrator))
    throw Error("Choose an existing normal role without Administrator permissions.");
  const bot = await session.guild.members.fetchMe();
  if (!bot.permissions.has(PermissionFlagsBits.ManageRoles) ||
      role.position >= bot.roles.highest.position)
    throw Error("Give the bot Manage Roles and move its role above the Collector role.");
  return role;
}

async function saveGeneral(session) {
  const s = session.settings;
  if (!s.commandChannelId) throw Error("Choose the required commands channel.");
  const channels = {};
  for (const [field] of GENERAL_STEPS) {
    if (s[field]) channels[field] = await validateChannel(session, s[field],{requirePrivate:field==="commandChannelId"});
  }
  // Validate first. Preserve existing posts, IDs, ownership and history. The
  // channel fields alone decide which features can create new content.
  const previous = await GuildConfig.findOne({ guildId: session.guild.id }).lean();
  if (s.shopChannelId && previous?.shopChannelId !== s.shopChannelId)
    await ensureShopEntry(session.guild, channels.shopChannelId);
  await GuildConfig.findOneAndUpdate({ guildId: session.guild.id },
    { $set: { ...s, initialSetupCompletedAt: previous?.initialSetupCompletedAt || new Date() } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
  const ensure = [
    ["profileChannelId", ensureProfileEntry],
    ["houseChannelId", ensureHouseEntry],
    ["outfitChannelId", ensureOutfitEntry],
    ["inventoryChannelId", ensureInventoryEntry],
    ["tradeVoteChannelId", ensureTradeVoteEntry],
    ["tradingPostChannelId", ensureTradingPostEntry],
  ];
  // Refresh or create entry buttons only for channels the administrator enabled
  // or moved. Old posts are never deleted when Skip is selected.
  for (const [field, fn] of ensure) {
    if (s[field] && s[field] !== previous?.[field]) {
      try { await fn(session.guild, channels[field]); }
      catch (error) { console.error("[General Setup] Entry panel failed for " + field, error); }
    }
  }
}

async function saveCards(session) {
  const s = session.settings;
  if (!s.hatchemChannelId || !s.cardRoleId)
    throw Error("Choose the Hatchem channel and Collector role.");
  if (!session.original?.commandChannelId)
    throw Error("Run /setup general first to assign the required commands channel.");
  const channel = await validateChannel(session, s.hatchemChannelId);
  await validateRole(session, s.cardRoleId);
  // The guide is created before saving enabled status; failed channel writes
  // must never leave the card game appearing fully configured.
  let guide = session.original?.hatchemChannelId === channel.id &&
    session.original?.hatchemGuideMessageId
      ? await channel.messages.fetch(session.original.hatchemGuideMessageId).catch(() => null) : null;
  if (guide?.author?.id !== session.guild.client.user?.id) guide = null;
  if (guide) await guide.edit({
    content: HATCHEM_GUIDE, components: [hatchemTutorialEntryRow()],
    allowedMentions: { parse: [] },
  });
  else guide = await channel.send({
    content: HATCHEM_GUIDE, components: [hatchemTutorialEntryRow()],
    allowedMentions: { parse: [] },
  });
  await GuildConfig.findOneAndUpdate({ guildId: session.guild.id }, { $set: {
    hatchemChannelId: s.hatchemChannelId,
    cardRoleId: s.cardRoleId,
    hatchemAutoDropsEnabled: s.hatchemAutoDropsEnabled !== false,
    hatchemGuideMessageId: guide.id,
    cardSetupCompletedAt: new Date(),
  } }, { upsert: true, new: true, runValidators: true });
}

async function process(session, action, value) {
  if (action === "cancel") {
    sessions.delete(session.key);
    await session.channel.send("Setup cancelled. Nothing was changed.");
    await retireGuidedControls(session.promptMessage,session.channel);
    return;
  }
  const list = stepsFor(session.mode);
  if (session.review) {
    if (action === "preview") {
      await session.channel.send({ content: "👁️ **Setup preview — no changes saved**\n" +
        guidedGuildSetupSummary(session.mode, session.settings),
        allowedMentions: { parse: [] } });
      return;
    }
    if (action === "edit") {
      const index = list.findIndex(step => step[0] === value);
      if (index < 0) throw Error("Choose a valid setting.");
      session.index = index;
      session.editing = true;
      session.review = false;
      return show(session);
    }
    if (action !== "save") throw Error("Choose Save, Preview or Edit.");
    if (session.mode === "general") await saveGeneral(session);
    else await saveCards(session);
    sessions.delete(session.key);
    await session.channel.send({ content:
      "**" + (session.mode === "general" ? "General" : "Hatchem Card Game") +
      " setup saved.**\n" + (session.mode === "general"
        ? "Unselected features were skipped. Run /setup giveaways, /setup activity-giveaways, /setup trials or /setup cards to enable only the extra modules you want."
        : "Registered members may use cards in <#" + session.settings.hatchemChannelId + ">; the card-game mode must also be enabled in bot settings."),
      allowedMentions: { parse: [] } });
    await retireGuidedControls(session.promptMessage,session.channel);
    return;
  }
  if (action === "back") {
    if (session.editing) {
      session.editing = false;
      session.review = true;
    } else session.index = Math.max(0, session.index - 1);
    return show(session);
  }
  const [field, , required] = list[session.index];
  if (action === "keep") {
    if (required && !session.settings[field])
      throw Error("Select a channel or role first; this step cannot be skipped.");
    return next(session);
  }
  if (action === "skip") {
    if (required) throw Error("This step is required.");
    session.settings[field] = field === "hatchemAutoDropsEnabled" ? false : "";
    return next(session);
  }
  if (field === "hatchemAutoDropsEnabled" && ["enable", "disable"].includes(action)) {
    session.settings[field] = action === "enable";
    return next(session);
  }
  if (field === "cardRoleId" && action === "role") {
    await validateRole(session, value);
    session.settings[field] = value;
    return next(session);
  }
  if (field !== "cardRoleId" && field !== "hatchemAutoDropsEnabled" && action === "channel") {
    await validateChannel(session, value);
    session.settings[field] = value;
    return next(session);
  }
  throw Error("That action isn't available for this step.");
}

export async function startGuidedGuildSetup(interaction, mode = "general") {
  if (!interaction.guildId || !interaction.guild)
    throw Error("Run setup in a server.");
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    throw Error("Manage Server permission is required.");
  const config = await GuildConfig.findOne({ guildId: interaction.guildId }).lean();
  if (config?.commandChannelId && config.commandChannelId !== interaction.channelId)
    throw Error("Run setup in <#" + config.commandChannelId + ">.");
  if (mode === "cards" && !config?.commandChannelId)
    throw Error("Start with /setup general to choose a commands channel, then run /setup cards.");
  const key = sessionKey(interaction.guildId, interaction.user.id);
  if (sessions.get(key)?.expiresAt > Date.now())
    return interaction.editReply("A setup wizard is already running for you.");
  const settings = Object.fromEntries(stepsFor(mode).map(([field]) => [
    field, field === "hatchemAutoDropsEnabled"
      ? config?.[field] !== false : (config?.[field] || ""),
  ]));
  const session = {
    key, id: new mongoose.Types.ObjectId().toString(),
    mode, owner: interaction.user.id, guild: interaction.guild,
    channel: interaction.channel, settings, original: config,
    index: 0, review: false, editing: false,
  };
  sessions.set(key, session);
  await show(session);
  return interaction.editReply((mode === "general" ? "General" : "Hatchem") +
    " setup started in this channel. Follow the steps and save at the end.");
}

export async function handleGuidedGuildSetupInteraction(interaction) {
  const match = /^guildconfig:([0-9a-f]{24}):(.+)$/.exec(interaction.customId);
  const session = match && sessions.get(sessionKey(interaction.guildId, interaction.user.id));
  if (!session || session.id !== match[1] || session.expiresAt < Date.now() ||
      session.messageId !== interaction.message?.id)
    return interaction.reply({ content: "That setup prompt is no longer active or belongs to someone else.",
      flags: MessageFlags.Ephemeral });
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return interaction.reply({ content: "Manage Server permission is required.",
      flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const action = match[2];
    const value = ["channel", "role", "edit"].includes(action) ? interaction.values?.[0] : null;
    await process(session, action, value);
    return interaction.editReply("Setup step updated.");
  } catch (error) {
    return interaction.editReply("Couldn't update setup: " + (error.message || error));
  }
}
