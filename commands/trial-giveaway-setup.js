import mongoose from "mongoose";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder,
  ChannelType, MessageFlags, PermissionFlagsBits, RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import {sharedGiveawayPingRoleId,sharedGiveawayNotificationFields} from "../services/giveaway-notification-roles.js";
import GiveawayBanner, { bannerNameKey } from "../models/GiveawayBanner.js";
import { attachGiveawayBanner, ensureBannerRegistered } from "../services/giveaway-banners.js";
import {registeredSetupBanners,bannerCatalogText,setupBannerOptions,registerSetupBanner} from "../services/giveaway-banner-setup.js";
import { survivalFinalePayload } from "../services/survival-giveaways.js";
import { DEFAULT_CLAIM_INSTRUCTIONS, MAX_TRIAL_CLAIM_MINUTES } from "../services/giveaway-claims.js";

// Keep this editor independent from the regular/activity giveaway editor. Trial
// defaults must never silently rewrite active or scheduled standard giveaways.
const sessions = new Map();
const SESSION_MS = 30 * 60_000;
const STEPS = [
  "channel", "staff", "managerRole", "requiredRole", "roleHelp", "roleHelpVisible",
  "instructions", "minutes", "rerolls", "roles", "banner", "review",
];
const STEP_NAMES = {
  channel: "Court's Trial channel", staff: "Private staff controls",
  managerRole: "Giveaway Manager role",
  requiredRole: "Default required role", roleHelp: "How to obtain the role",
  roleHelpVisible: "Show role instructions", instructions: "Claim instructions",
  minutes: "Winner claim deadline", rerolls: "Automatic rerolls",
  roles: "Shared giveaway ping role", banner: "Default banner", review: "Review & save",
};
const key = (guildId, userId) => guildId + ":" + userId;
const shown = id => id ? "<#" + id + ">" : "Not selected";
const roleShown = id => id ? "<@&" + id + ">" : "None";
const button = (session, label, action, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId("trialconfig:" + session.id + ":" + action)
    .setLabel(label).setStyle(style);
const buttons = (session, items) => new ActionRowBuilder()
  .addComponents(items.map(([label, action, style]) => button(session, label, action, style)));
const selectId = (session, action) => "trialconfig:" + session.id + ":" + action;

export function trialSetupSummary(settings) {
  return [
    "**The Court's Trial — Setup Review**",
    "⚔️ **Signup and eliminations:** " + shown(settings.survivalTrialChannelId),
    "🔒 **Private staff controls:** " + shown(settings.activityGiveawayReviewChannelId),
    "🔑 **Giveaway Manager role:** " + roleShown(settings.giveawayManagerRoleId),
    "🎟️ **Default required role:** " + roleShown(settings.trialDefaultRequiredRoleId),
    "👁️ **Display role instructions:** " + (settings.trialShowRoleInstructions !== false ? "Yes" : "No"),
    "**Where to get that role:** " + (settings.trialRoleInstructions || "Not set"),
    "📝 **Current prize-claim instructions (" + (settings.trialClaimInstructions?"Saved Trial custom":"Built-in default") + "):**",
    (settings.trialClaimInstructions || DEFAULT_CLAIM_INSTRUCTIONS),
    "⏰ **Claim deadline:** " + settings.trialClaimWindowMinutes + " minutes after the verdict",
    "🔁 **Automatic unclaimed-prize rerolls:** " + settings.trialMaxAutoRerolls + " per winning place",
    "🔔 **Shared giveaway ping role (all giveaways and Trials):** " +
      roleShown(sharedGiveawayPingRoleId(settings)),
    "🖼️ **Default banner:** " + (settings.trialDefaultBannerNameKey || "None"),
    "",
    "**Changes apply only to new Trials.** Existing entrants, winners, claim deadlines and historical Trial records are not changed.",
    "The Royal Verdict stays in the Trial channel. Claims and ticket links are saved privately for staff; no prize is delivered automatically.",
  ].join("\n");
}

export function trialSetupPreview(settings, { userId = "123456789012345678", banner = null, now = new Date() } = {}) {
  const record = {
    _id: "PREVIEW", mode: "survival", status: "ended",
    title: "Example Court's Trial", prize: "Example prize",
    description: "Preview only", creatorId: userId, originalChampionId: userId,
    winnerIds: [userId], entrantIds: [userId, "234567890123456789"],
    winnerCount: 1, gameEvents: [{}], nextEventIndex: 1,
    claimStartedAt: now, winnerAssignedAt: [now], gameEndedAt: now,
    claimWindowMinutes: settings.trialClaimWindowMinutes,
    claimInstructions: settings.trialClaimInstructions,
    autoRerollClaims: true, trialTicketClaimsEnabled: true,
    maxAutoRerolls: settings.trialMaxAutoRerolls,
  };
  const payload = survivalFinalePayload(record, { entered: 1, won: 1 });
  payload.content = "👁️ **Royal Verdict Preview** — No Trial has been created.";
  payload.embeds[0].setFooter({ text: "PREVIEW ONLY · No Trial created or changed" });
  for (const row of payload.components || [])
    for (const control of row.components) control.setDisabled(true);
  return attachGiveawayBanner(payload, banner);
}

function layout(session,banners=[]) {
  const s = session.settings, step = session.step;
  const index = STEPS.indexOf(step);
  const label=STEP_NAMES[step]||(step==="bannerText"?"Saved banner name":
    step==="bannerUpload"?"Upload new banner":step);
  const intro = "**⚔️ Court's Trial setup** · <@" + session.owner + ">\n" +
    "**" + (session.fromReview ? "Editing " + label :
      index>=0?"Step " + (index + 1) + " of " + STEPS.length + " · " + label:
        "Banner · "+label) + "**\n";
  const components = [];
  let content = "";
  if (step === "channel" || step === "staff") {
    const staff = step === "staff";
    content = staff
      ? "Select the **private staff channel** for live Trials, winner claims and administrative controls. This channel is shared with regular and activity giveaway staff records. It must be hidden from @everyone."
      : "Select the channel where Court's Trial signups, eliminations and the final Royal Verdict are published. It must be different from regular and activity giveaway channels.";
    const id = s[staff ? "activityGiveawayReviewChannelId" : "survivalTrialChannelId"];
    content += "\n**Current:** " + shown(id);
    components.push(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId(selectId(session, "chooseChannel"))
        .setPlaceholder(staff ? "Private staff channel" : "Court's Trial channel")
        .setMinValues(1).setMaxValues(1).addChannelTypes(
          ...(staff ? [ChannelType.GuildText] :
            [ChannelType.GuildText, ChannelType.GuildAnnouncement]),
        )));
    if (id) components.push(buttons(session, [["Keep selected channel", "keep"]]));
  } else if (step === "managerRole") {
    content = "Choose an optional **Giveaway Manager role**. It grants permission for /giveaway, /giveaway-role, /trial and their staff controls without Manage Server. It does not permit /setup or unrelated admin commands. Only staff with Manage Server may assign or clear this role.\n**Current:** " +
      roleShown(s.giveawayManagerRoleId);
    components.push(new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId(selectId(session, "chooseManagerRole"))
        .setPlaceholder("Giveaway Manager role").setMinValues(1).setMaxValues(1)));
    components.push(buttons(session, [["No manager role", "clearManagerRole"], ["Keep current", "keep"]]));
  } else if (step === "requiredRole") {
    content = "Choose the default role members must have to join a Trial. Each Trial may override or remove this requirement.\n**Current:** " + roleShown(s.trialDefaultRequiredRoleId);
    components.push(new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId(selectId(session, "chooseRequiredRole"))
        .setPlaceholder("Choose required role").setMinValues(1).setMaxValues(1)));
    components.push(buttons(session, [["No required role", "clearRequiredRole"], ["Keep current", "keep"]]));
  } else if (step === "roleHelp") {
    content = "Save where members can obtain the required role. Channel links are allowed.\n**Current:** " + (s.trialRoleInstructions || "Not set");
    components.push(buttons(session, [["Write instructions", "writeRoleHelp"], ["Clear", "clearRoleHelp"], ["Keep", "keep"]]));
  } else if (step === "roleHelpVisible") {
    content = "Should members see these role-acquisition instructions when they are not eligible? The role itself remains required.\n**Current:** " +
      (s.trialShowRoleInstructions ? "Show" : "Hide");
    components.push(buttons(session, [["Show", "showHelp"], ["Hide", "hideHelp"], ["Keep", "keep"]]));
  } else if (step === "instructions") {
    content = "Set the saved default prize-claim instructions for Court's Trials.\n"+
      "**Current ("+(s.trialClaimInstructions?"Saved Trial custom":"Built-in default")+"):**\n"+
      (s.trialClaimInstructions || DEFAULT_CLAIM_INSTRUCTIONS)+
      "\nThe bot separately requires a ticket number and Discord message link before the claim deadline, or the prize is forfeited.\n"+
      "Choose **Write / Edit Trial Instructions** to type your text, then Save Trial Setup on the final review.";
    components.push(buttons(session, [["Use Built-in Default", "clearInstructions"],
      ["Write / Edit Trial Instructions", "writeInstructions"], ["Keep Saved", "keep"]]));
  } else if (step === "minutes") {
    content = "How long does each winner have to submit the ticket number and message link after the Royal Verdict? The old Trial interface uses **minutes**.\n**Current:** " +
      s.trialClaimWindowMinutes + " minutes (1–43,200 allowed).";
    components.push(buttons(session, [
      ["15 min", "minutes15"], ["60 min", "minutes60"], ["12 hours", "minutes720"],
      ["24 hours", "minutes1440"], ["Custom", "customMinutes"],
    ]));
    components.push(buttons(session, [["Keep", "keep"]]));
  } else if (step === "rerolls") {
    content = "How many times may the bot replace a winner who does not submit the ticket information before the deadline? **Default 2**. Setting 0 means a win is forfeited without replacement. Staff may still reroll manually.\n**Current:** " +
      s.trialMaxAutoRerolls;
    components.push(buttons(session, [0, 1, 2, 3, 5].map(n => [String(n) + " rerolls", "reroll" + n])));
    components.push(buttons(session, [["10 rerolls", "reroll10"], ["Keep", "keep"]]));
  } else if (step === "roles") {
    content = "Select **one shared giveaway ping role**. It gets mentioned when a regular giveaway, activity giveaway, or Court's Trial is first posted. It is separate from the Giveaway Manager role and the required entry role.\n**Current:** " +
      roleShown(sharedGiveawayPingRoleId(s));
    components.push(new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId(selectId(session, "chooseRoles"))
        .setPlaceholder("Shared giveaway ping role").setMinValues(1).setMaxValues(1)));
    components.push(buttons(session, [["No giveaway ping role", "clearRoles"], ["Keep", "keep"]]));
  } else if (step === "banner") {
    content = "Choose a default banner for new Trial signups and Royal Verdicts. It remains reusable for all giveaway types.\n**Current:** " +
      (s.trialDefaultBannerNameKey || "None") + "\n\n" + bannerCatalogText(banners);
    if(banners.length)components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(selectId(session,"selectSavedBanner"))
        .setPlaceholder("Choose a registered banner").addOptions(setupBannerOptions(banners))));
    components.push(buttons(session,[
      ...(banners.length?[["Type Banner Name","chooseBanner"]]:[]),
      ["Upload New Banner","uploadBanner",ButtonStyle.Primary],
      ["Clear Banner","clearBanner"],["Keep","keep"],
    ]));
  } else if (step === "bannerUpload") {
    content = "Upload a **PNG, JPG, WebP or GIF (maximum 4 MB)** in this same channel.\n" +
      "You may type the banner's name in the same message as the image. Without a caption, the filename becomes its name.\n" +
      "The image will be registered for future giveaways and selected for this Trial setup. Uploading under an existing name replaces that banner's image.";

  } else if (step === "review") {
    content = trialSetupSummary(s);
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(selectId(session, "edit"))
        .setPlaceholder("Edit a setup setting")
        .addOptions(STEPS.filter(x => x !== "review").map(x => ({ label: STEP_NAMES[x], value: x })))));
    components.push(buttons(session, [["Preview Royal Verdict", "preview"],
      ["Edit Claim Instructions", "editClaims"]]));
    components.push(buttons(session, [["Save Trial Setup", "save", ButtonStyle.Success],
      ["Cancel", "cancel", ButtonStyle.Danger]]));
  } else if (["roleHelpText", "instructionsText", "minutesText", "bannerText"].includes(step)) {
    content = {
      roleHelpText: "Reply in this command channel with up to 500 characters explaining how to obtain the required role.",
      instructionsText: "Reply here with custom claim instructions (1–1,000 characters). The bot adds the mandatory ticket and deadline warning.",
      minutesText: "Reply with a whole number from 1 through 43,200 minutes.",
      bannerText: "Reply with the exact saved banner name.\n\n"+bannerCatalogText(banners),
    }[step];
  }
  if (step !== "review") components.push(buttons(session, [["Back", "back"], ["Cancel setup", "cancel", ButtonStyle.Danger]]));
  return { content: intro + content, components, allowedMentions: { parse: [] } };
}

async function show(session, step) {
  session.step = step;
  session.expiresAt = Date.now() + SESSION_MS;
  const banners=["banner","bannerText"].includes(step)?
    await registeredSetupBanners(session.guild.id):[];
  const message = await session.channel.send(layout(session,banners));
  session.messageId = message.id;
}
async function advance(session) {
  if (session.fromReview) {
    session.fromReview = false;
    return show(session, "review");
  }
  const position = STEPS.indexOf(session.step);
  return show(session, STEPS[Math.min(position + 1, STEPS.length - 1)]);
}
async function validateChannels(session) {
  const s = session.settings;
  const ids = [s.survivalTrialChannelId, s.activityGiveawayReviewChannelId];
  if (ids.some(id => !id) || ids[0] === ids[1])
    throw Error("Select different public Trial and private staff channels.");
  const config = await GuildConfig.findOne({ guildId: session.guild.id }).lean();
  if ([config?.giveawayChannelId, config?.activityGiveawayListChannelId,
    config?.activityGiveawayWinnersChannelId].includes(ids[0]))
    throw Error("Court's Trials must use a different channel from regular or activity giveaways.");
  if ([config?.giveawayChannelId, config?.activityGiveawayListChannelId,
    config?.activityGiveawayWinnersChannelId].includes(ids[1]))
    throw Error("Staff controls need a private channel separate from the public giveaway channels.");
  for (const [index, id] of ids.entries()) {
    const channel = await session.guild.channels.fetch(id).catch(() => null);
    if (!channel?.send || !channel?.permissionsFor)
      throw Error("Cannot send messages in <#" + id + ">.");
    const perms = channel.permissionsFor(session.guild.members.me);
    for (const permission of [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])
      if (!perms?.has(permission))
        throw Error("Bot needs View Channel, Send Messages, Embed Links in <#" + id + ">.");
    if (index === 1 && channel.permissionsFor(session.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel))
      throw Error("The staff channel must be hidden from @everyone before saving.");
  }
}
async function process(session, action, value) {
  const s = session.settings;
  if (action === "cancel") {
    sessions.delete(session.key);
    await session.channel.send("Court's Trial setup cancelled. Nothing was saved.");
    return;
  }
  if (action === "back") {
    const previous = { roleHelpText: "roleHelp", instructionsText: "instructions",
      minutesText: "minutes", bannerText: "banner",bannerUpload:"banner" }[session.step];
    if(previous)return show(session,previous);
    if(session.fromReview){session.fromReview=false;return show(session,"review");}
    return show(session,STEPS[Math.max(0,STEPS.indexOf(session.step)-1)]);
  }
  if (session.step === "review") {
    if (action === "editClaims") {
      session.fromReview=true;
      return show(session,"instructions");
    }
    if (action === "preview") {
      const banner = s.trialDefaultBannerNameKey
        ? await GiveawayBanner.findOne({ guildId: session.guild.id,
          nameKey: bannerNameKey(s.trialDefaultBannerNameKey) }).lean() : null;
      if (s.trialDefaultBannerNameKey && !banner) throw Error("The saved banner is no longer available.");
      await session.channel.send(trialSetupPreview(s, { userId: session.owner, banner }));
      return;
    }
    if (action === "edit") {
      if (!STEPS.includes(value) || value === "review") throw Error("Choose a setup setting.");
      session.fromReview = true;
      return show(session, value);
    }
    if (action !== "save") throw Error("Choose Save, Preview, or Edit.");
    await validateChannels(session);
    const previous = await GuildConfig.findOne({ guildId: session.guild.id }).lean();
    await GuildConfig.findOneAndUpdate({ guildId: session.guild.id }, { $set: {
      ...s,
      ...sharedGiveawayNotificationFields(sharedGiveawayPingRoleId(s)),
      trialSetupCompletedAt: new Date(),
      initialSetupCompletedAt: previous?.initialSetupCompletedAt || new Date(),
      commandChannelId: previous?.commandChannelId || session.channel.id,
    } }, { upsert: true, new: true, runValidators: true });
    sessions.delete(session.key);
    await session.channel.send({
      content: "**Court's Trial setup saved.** New Trials will use these defaults; existing events, deadlines, prizes and history are unchanged.\n" +
        "Create a Trial with **/trial start** in the configured commands channel.",
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (action === "keep") return advance(session);
  if (session.step === "channel" || session.step === "staff") {
    if (action !== "chooseChannel") throw Error("Choose a channel from the selector.");
    s[session.step === "staff" ? "activityGiveawayReviewChannelId" : "survivalTrialChannelId"] = value;
    return advance(session);
  }
  if (session.step === "managerRole") {
    if (action === "clearManagerRole") s.giveawayManagerRoleId = "";
    else if (action === "chooseManagerRole") {
      const role = await session.guild.roles.fetch(value).catch(() => null);
      if (!role || role.id === session.guild.id || role.managed)
        throw Error("Choose a real, assignable server role for Giveaway Managers.");
      s.giveawayManagerRoleId = value;
    } else throw Error("Choose a Giveaway Manager role or None.");
    return advance(session);
  }
  if (session.step === "requiredRole") {
    if (action === "clearRequiredRole") s.trialDefaultRequiredRoleId = "";
    else if (action === "chooseRequiredRole") {
      const role = await session.guild.roles.fetch(value).catch(() => null);
      if (!role || role.id === session.guild.id) throw Error("Choose a real server role.");
      s.trialDefaultRequiredRoleId = value;
    } else throw Error("Choose a required role or None.");
    return advance(session);
  }
  if (session.step === "roleHelp") {
    if (action === "clearRoleHelp") { s.trialRoleInstructions = ""; return advance(session); }
    if (action === "writeRoleHelp") return show(session, "roleHelpText");
  }
  if (session.step === "roleHelpText" && action === "text") {
    if (!value || value.length > 500) throw Error("Use 1–500 characters.");
    s.trialRoleInstructions = value;
    return session.fromReview ? advance(session) : show(session, "roleHelpVisible");
  }
  if (session.step === "roleHelpVisible" && ["showHelp", "hideHelp"].includes(action)) {
    s.trialShowRoleInstructions = action === "showHelp";
    return advance(session);
  }
  if (session.step === "instructions") {
    if (action === "clearInstructions") { s.trialClaimInstructions = ""; return advance(session); }
    if (action === "writeInstructions") return show(session, "instructionsText");
  }
  if (session.step === "instructionsText" && action === "text") {
    if (!value || value.length > 1000) throw Error("Use 1–1,000 characters.");
    s.trialClaimInstructions = value;
    return session.fromReview ? advance(session) : show(session, "minutes");
  }
  if (session.step === "minutes") {
    if (action === "customMinutes") return show(session, "minutesText");
    if (/^minutes(15|60|720|1440)$/.test(action)) {
      s.trialClaimWindowMinutes = Number(action.slice(7));
      return advance(session);
    }
  }
  if (session.step === "minutesText" && action === "text") {
    if (!/^\d+$/.test(value) || +value < 1 || +value > MAX_TRIAL_CLAIM_MINUTES)
      throw Error("Enter 1–43,200 whole minutes.");
    s.trialClaimWindowMinutes = Number(value);
    return session.fromReview ? advance(session) : show(session, "rerolls");
  }
  if (session.step === "rerolls" && /^reroll(0|1|2|3|5|10)$/.test(action)) {
    s.trialMaxAutoRerolls = Number(action.slice(6));
    return advance(session);
  }
  if (session.step === "roles") {
    if (action === "clearRoles") {
      Object.assign(s,sharedGiveawayNotificationFields(""));
      return advance(session);
    }
    if (action === "chooseRoles") {
      if (!Array.isArray(value) || value.length !== 1)
        throw Error("Choose exactly one giveaway ping role.");
      const role=await session.guild.roles.fetch(value[0]).catch(()=>null);
      if(!role||role.id===session.guild.id)
        throw Error("Choose a real server role.");
      Object.assign(s,sharedGiveawayNotificationFields(role.id));
      return advance(session);
    }
  }
  if (session.step === "banner") {
    if (action === "clearBanner") { s.trialDefaultBannerNameKey = ""; return advance(session); }
    if (action === "selectSavedBanner") {
      s.trialDefaultBannerNameKey = await ensureBannerRegistered(session.guild.id,value);
      return advance(session);
    }
    if (action === "chooseBanner") return show(session,"bannerText");
    if (action === "uploadBanner") return show(session,"bannerUpload");
  }
  if (session.step === "bannerText" && action === "text") {
    s.trialDefaultBannerNameKey = await ensureBannerRegistered(session.guild.id, value);
    // bannerText is a substep, not an entry in STEPS: never advance from -1.
    session.step="banner";
    return advance(session);
  }
  if (session.step === "bannerUpload" && action === "upload") {
    s.trialDefaultBannerNameKey=await registerSetupBanner(session.guild.id,value);
    session.step="banner";
    return advance(session);
  }
  throw Error("This action isn't available at this step.");
}

export async function startTrialGiveawaySetup(interaction) {
  const config = await GuildConfig.findOne({ guildId: interaction.guildId }).lean();
  if (config?.commandChannelId && config.commandChannelId !== interaction.channelId)
    throw Error("Run /setup trials in <#" + config.commandChannelId + ">.");
  const sessionKey = key(interaction.guildId, interaction.user.id);
  if (sessions.get(sessionKey)?.expiresAt > Date.now())
    return interaction.editReply("Your Court's Trial setup is already active in this channel.");
  const s = {
    survivalTrialChannelId: config?.survivalTrialChannelId || "",
    activityGiveawayReviewChannelId: config?.activityGiveawayReviewChannelId || "",
    giveawayManagerRoleId: config?.giveawayManagerRoleId || "",
    trialDefaultRequiredRoleId: config?.trialDefaultRequiredRoleId ?? config?.giveawayDefaultRequiredRoleId ?? "",
    trialRoleInstructions: config?.trialRoleInstructions ?? config?.giveawayRoleInstructions ?? "",
    trialShowRoleInstructions: config?.trialShowRoleInstructions ?? config?.giveawayShowRoleInstructions ?? true,
    trialClaimInstructions: config?.trialClaimInstructions ?? config?.activityClaimInstructions ?? "",
    trialClaimWindowMinutes: config?.trialClaimWindowMinutes ?? 720,
    trialMaxAutoRerolls: config?.trialMaxAutoRerolls ?? 2,
    ...sharedGiveawayNotificationFields(sharedGiveawayPingRoleId(config)),
    trialDefaultBannerNameKey: config?.trialDefaultBannerNameKey || "",
  };
  const session = { id: new mongoose.Types.ObjectId().toString(), key: sessionKey,
    channel: interaction.channel, guild: interaction.guild, owner: interaction.user.id,
    fromReview: false, settings: s };
  sessions.set(sessionKey, session);
  await show(session, "channel");
  return interaction.editReply("Court's Trial setup opened in this commands channel. Complete the steps, preview, then save.");
}
export async function handleTrialGiveawaySetupInteraction(interaction) {
  const match = /^trialconfig:([0-9a-f]{24}):(.+)$/.exec(interaction.customId);
  const session = match && sessions.get(key(interaction.guildId, interaction.user.id));
  if (!session || session.id !== match[1] || session.expiresAt < Date.now() ||
      session.messageId !== interaction.message?.id)
    return interaction.reply({ content: "That Trial setup prompt has expired or belongs to someone else.", flags: MessageFlags.Ephemeral });
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return interaction.reply({ content: "Manage Server permission is required.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const action = match[2];
    const selected = ["chooseChannel", "chooseRequiredRole", "chooseManagerRole", "chooseRoles", "edit","selectSavedBanner"].includes(action)
      ? interaction.values : null;
    await process(session, action,
      ["chooseChannel", "chooseRequiredRole", "chooseManagerRole", "edit","selectSavedBanner"].includes(action) ? selected?.[0] : selected);
    return interaction.editReply("Setup step updated.");
  } catch (error) {
    return interaction.editReply("Couldn't update Trial setup: " + String(error.message || error));
  }
}
export function trialGiveawaySetupReply(message) {
  if (!message.guildId || message.author?.bot ||
      (!message.content && !message.attachments?.size)) return false;
  const session = sessions.get(key(message.guildId, message.author.id));
  if (!session || session.channel.id !== message.channelId || session.expiresAt < Date.now() ||
      !["roleHelpText", "instructionsText", "minutesText", "bannerText","bannerUpload"].includes(session.step))
    return false;
  void process(session,session.step==="bannerUpload"?"upload":"text",
    session.step==="bannerUpload"?message:String(message.content||"").trim()).catch(error =>
    session.channel.send({ content: "Trial setup error: " + String(error.message || error),
      allowedMentions: { parse: [] } }));
  return true;
}
