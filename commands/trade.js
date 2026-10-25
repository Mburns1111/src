import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import TradeListing from "../models/TradeListing.js";
import UserProfile from "../models/UserProfile.js";
import { awardMilestoneSafely } from "../services/points-rewards.js";
import {
  getConfiguredTextChannel,
  getMessageMedia,
  requireGuild,
  validateAttachments,
  validateVideoAttachment,
  validateWebUrl,
} from "./shared.js";
import { UserFacingError } from "./errors.js";
import { prepareMediaFiles } from "./video-compression.js";
import { ensureChannelEntry } from "./channel-entry.js";
import {
  clearPendingForm,
  trackPendingForm,
  addRemoveFormButton,
  claimPendingFormOperation,
  releasePendingFormOperation,
} from "./pending-forms.js";

export const data = new SlashCommandBuilder()
  .setName("new-vote")
  .setDescription("Open the form to post a trade for the server to vote on");

const activeTradeSubmissions = new Set();
const openedTradeForms = new Set();
const pendingTradeForms = new Map();
const creatingTradeForms = new Set();
export function forgetTradeForm(guildId, ownerId, messageId, channelId) {
  const key = `${guildId}:${ownerId}`;
  if (pendingTradeForms.get(key)?.messageId === messageId) pendingTradeForms.delete(key);
  openedTradeForms.delete(`${guildId}:${channelId}:${messageId}`);
}
const tradeFormLifetimeMs = 60_000;
const tradeModalLifetimeMs = 15 * 60_000;

export async function ensureTradeVoteEntry(
  guild,
  channel,
  { moveToBottom = false } = {},
) {
  return ensureChannelEntry(guild, channel, {
    channelField: "tradeVoteEntryChannelId",
    messageField: "tradeVoteEntryMessageId",
    customId: "trade:entry",
    label: "Create a trade vote",
    description: "Use the button to post a trade for the server to vote on.",
    moveToBottom,
  });
}

export async function handleTradeVoteEntryButton(interaction) {
  if (interaction.customId !== "trade:entry") return false;
  await execute(interaction);
  return true;
}

function makeCreateTradeButton(userId, expiresAt) {
  return addRemoveFormButton(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`trade:new:${userId}:${expiresAt}`)
      .setLabel("Create trade vote")
      .setStyle(ButtonStyle.Success),
  ), "trade", userId);
}

function makeCreateTradeModal(userId, message, expiresAt) {
  return new ModalBuilder()
    .setCustomId(
      `trade:create:${userId}:${message.channelId}:${message.id}:${expiresAt}`,
    )
    .setTitle("Post a trade for voting")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Trade title")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("title")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel("Add one picture (required)")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId("picture")
            .setMinValues(1)
            .setMaxValues(1),
        ),
      new LabelBuilder()
        .setLabel("Video link (optional)")
        .setDescription("Use this or upload a video below, not both.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("video_url")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(500)
            .setRequired(false),
        ),
      new LabelBuilder()
        .setLabel("Upload a video (optional)")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId("video")
            .setMinValues(0)
            .setMaxValues(1)
            .setRequired(false),
        ),
    );
}

function getMapEntries(map) {
  if (map && typeof map.entries === "function") {
    return Array.from(map.entries());
  }
  return Object.entries(map ?? {});
}

function isImageAttachment(attachment) {
  return attachment.contentType?.toLowerCase().startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|avif)$/i.test(attachment.name ?? "");
}

export function getVoteCounts(listing) {
  const qualityValues = getMapEntries(listing.qualityVotes).map(([, value]) => value);
  const decisions = new Map(
    getMapEntries(listing.votes).map(([userId, value]) => [
      userId,
      value === 1 ? "make" : "wont",
    ]),
  );
  for (const [userId, value] of getMapEntries(listing.decisionVotes)) {
    decisions.set(userId, value);
  }
  const decisionValues = Array.from(decisions.values());

  return {
    good: qualityValues.filter((value) => value === "good").length,
    bad: qualityValues.filter((value) => value === "bad").length,
    unsure: qualityValues.filter((value) => value === "unsure").length,
    wouldMake: decisionValues.filter((value) => value === "make").length,
    wouldntMake: decisionValues.filter((value) => value === "wont").length,
  };
}

function makeTradeEmbed(listing) {
  const counts = getVoteCounts(listing);
  const embed = new EmbedBuilder()
    .setColor(0xe6a23c)
    .setTitle(listing.title)
    .setAuthor({ name: listing.ownerName })
    .addFields(
      {
        name: "Roblox username",
        value: listing.ownerRobloxUsername || "Not added yet",
        inline: true,
      },
      {
        name: "Trade quality",
        value: `Good: ${counts.good} · Bad: ${counts.bad} · Unsure: ${counts.unsure}`,
      },
      {
        name: "Would you make this trade?",
        value: `Would make: ${counts.wouldMake} · Wouldn't make: ${counts.wouldntMake}`,
      },
    )
    .setFooter({ text: `Trade ${String(listing._id).slice(-8)}` })
    .setTimestamp(listing.createdAt);

  if (listing.videoUrl) {
    embed.addFields({ name: "Trade video", value: `[Watch video](${listing.videoUrl})` });
  }
  return embed;
}

function makeVoteButtons(listing) {
  const counts = getVoteCounts(listing);
  const id = String(listing._id);
  const qualityButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tradevote:q:good:${id}`)
      .setLabel(`Good (${counts.good})`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`tradevote:q:bad:${id}`)
      .setLabel(`Bad (${counts.bad})`)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`tradevote:q:unsure:${id}`)
      .setLabel(`Unsure (${counts.unsure})`)
      .setStyle(ButtonStyle.Secondary),
  );
  const decisionButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tradevote:d:make:${id}`)
      .setLabel(`Would make (${counts.wouldMake})`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`tradevote:d:wont:${id}`)
      .setLabel(`Wouldn't make (${counts.wouldntMake})`)
      .setStyle(ButtonStyle.Secondary),
  );
  return [qualityButtons, decisionButtons];
}

export async function refreshTradeListingPost(guild, listing) {
  const channel = await guild.channels.fetch(listing.postChannelId);
  if (!channel?.messages) {
    throw new Error(`Trade listing channel ${listing.postChannelId} is unavailable.`);
  }
  const message = await channel.messages.fetch(listing.postMessageId);
  const attachments = Array.from(message.attachments.values());
  await message.edit({
    content: `Trade proposal from ${listing.ownerName}`,
    embeds: [makeTradeEmbed(listing)],
    components: makeVoteButtons(listing),
    attachments: attachments.map(({ id }) => ({ id })),
    allowedMentions: { parse: [] },
  });
}

export async function execute(interaction) {
  requireGuild(interaction);
  const formKey = `${interaction.guildId}:${interaction.user.id}`;
  const pendingForm = pendingTradeForms.get(formKey);
  if (pendingForm || creatingTradeForms.has(formKey)) {
    const response = {
      content: pendingForm
        ? [
            `You already have a trade form waiting in <#${pendingForm.channelId}>.`,
            `Finish that one before starting another: ${pendingForm.url}`,
          ].join(" ")
        : "Your trade form is being created. Please wait a moment before trying again.",
      allowedMentions: { parse: [] },
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(response);
    } else {
      await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
    }
    return;
  }
  creatingTradeForms.add(formKey);
  try {
    const channel = await getConfiguredTextChannel(
      interaction,
      "tradeVoteChannelId",
      "trade voting",
    );
    const expiresAt = Date.now() + tradeFormLifetimeMs;
    const post = await channel.send({
      content: `Trade vote from ${interaction.user.username} — use the button within 1 minute to enter details.`,
      components: [makeCreateTradeButton(interaction.user.id, expiresAt)],
      allowedMentions: { parse: [] },
    });
    try {
      await trackPendingForm({
        guildId: interaction.guildId,
        ownerId: interaction.user.id,
        channelId: post.channelId,
        messageId: post.id,
        type: "trade",
        expiresAt,
      });
    } catch (error) {
      await post.delete().catch((cleanupError) => {
        console.error("Could not remove an untracked trade form post:", cleanupError);
      });
      throw error;
    }
    const submissionKey = `${interaction.guildId}:${post.channelId}:${post.id}`;
    pendingTradeForms.set(formKey, {
      channelId: post.channelId,
      messageId: post.id,
      url: post.url,
      expiresAt,
    });
    const timeout = setTimeout(async () => {
      if (openedTradeForms.has(submissionKey)) return;
      const currentPending = pendingTradeForms.get(formKey);
      if (currentPending?.messageId === post.id) {
        pendingTradeForms.delete(formKey);
      }
      try {
        const currentPost = await channel.messages.fetch(post.id);
        const currentButton = currentPost.components
          .flatMap((row) => row.components)
          .find(
            (component) =>
              component.customId === `trade:new:${interaction.user.id}:${expiresAt}`,
          );
        if (currentButton && !currentButton.disabled) {
          await currentPost.delete();
        }
        await clearPendingForm(interaction.guildId, post.channelId, post.id);
      } catch (error) {
        if (Number(error?.code) === 10008) {
          await clearPendingForm(interaction.guildId, post.channelId, post.id);
        } else {
          console.error("Could not delete expired trade form post:", error);
        }
      }
    }, tradeFormLifetimeMs);
    timeout.unref?.();
    await ensureTradeVoteEntry(interaction.guild, channel, {
      moveToBottom: true,
    });
    const response = {
      content: [
        `I added your trade vote form in ${channel}.`,
        `Use the button within 1 minute to enter details privately. Only you can use it. ${post.url}`,
      ].join(" "),
      components: [],
      allowedMentions: { parse: [] },
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(response);
    } else {
      await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
    }
  } finally {
    creatingTradeForms.delete(formKey);
  }
}

export async function handleTradeCreateButton(interaction) {
  const [, action, ownerId, expiresAtValue] = interaction.customId.split(":");
  const expiresAt = Number(expiresAtValue);
  if (action !== "new" || ownerId !== interaction.user.id) {
    throw new UserFacingError("That trade form is not yours to use.");
  }
  if (!Number.isSafeInteger(expiresAt) || Date.now() >= expiresAt) {
    throw new UserFacingError("This trade form expired. Run `/new-vote` to start again.");
  }
  const openedFormKey =
    `${interaction.guildId}:${interaction.message.channelId}:${interaction.message.id}`;
  openedTradeForms.add(openedFormKey);
  try {
    await interaction.showModal(
      makeCreateTradeModal(ownerId, interaction.message, expiresAt),
    );
  } catch (error) {
    openedTradeForms.delete(openedFormKey);
    throw error;
  }
  await interaction.message.edit({
    content: `Trade vote from ${interaction.user.username} — finish the form that just opened.`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`trade:new:${ownerId}:${expiresAt}`)
          .setLabel("Form opened")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      ),
    ],
  }).catch((error) => {
    console.error("Could not mark the opened trade form button as used:", error);
  });
  const formKey = `${interaction.guildId}:${ownerId}`;
  const timeout = setTimeout(async () => {
    if (
      pendingTradeForms.get(formKey)?.messageId !== interaction.message.id ||
      !openedTradeForms.has(openedFormKey) ||
      activeTradeSubmissions.has(openedFormKey)
    ) {
      return;
    }
    pendingTradeForms.delete(formKey);
    openedTradeForms.delete(openedFormKey);
    try {
      const post = await interaction.channel.messages.fetch(interaction.message.id);
      const button = post.components
        .flatMap((row) => row.components)
        .find((component) => component.customId === interaction.customId);
      if (button?.disabled) await post.delete();
      await clearPendingForm(interaction.guildId, interaction.channelId, interaction.message.id);
    } catch (error) {
      if (Number(error?.code) === 10008) {
        await clearPendingForm(interaction.guildId, interaction.channelId, interaction.message.id);
      } else {
        console.error("Could not delete abandoned trade form post:", error);
      }
    }
  }, tradeModalLifetimeMs);
  timeout.unref?.();
}

export async function handleTradeCreateModal(interaction) {
  const [, action, ownerId, channelId, messageId, expiresAtValue] =
    interaction.customId.split(":");
  const expiresAt = Number(expiresAtValue);
  if (
    action !== "create" ||
    ownerId !== interaction.user.id ||
    !/^\d{17,20}$/.test(channelId ?? "") ||
    !/^\d{17,20}$/.test(messageId ?? "") ||
    !Number.isSafeInteger(expiresAt)
  ) {
    throw new UserFacingError("That trade form is not yours to use.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const formKey = `${interaction.guildId}:${ownerId}`;
  const pendingForm = pendingTradeForms.get(formKey);
  if (pendingForm?.messageId !== messageId) {
    throw new UserFacingError("This trade form is no longer active. Run `/new-vote` to start a new one.");
  }
  const submissionKey = `${interaction.guildId}:${channelId}:${messageId}`;
  if (activeTradeSubmissions.has(submissionKey)) {
    throw new UserFacingError("This trade vote is already being submitted.");
  }
  if (!claimPendingFormOperation(interaction.guildId, channelId, messageId)) {
    throw new UserFacingError("This form is already being submitted or removed.");
  }
  activeTradeSubmissions.add(submissionKey);

  let post;
  let claimed = false;
  let published = false;
  try {
    const channel = await interaction.guild.channels.fetch(channelId);
    post = await channel?.messages?.fetch(messageId);
    const buttonId = `trade:new:${ownerId}:${expiresAt}`;
    const button = post?.components
      .flatMap((row) => row.components)
      .find((component) => component.customId === buttonId);
    if (!post || post.author?.id !== interaction.client.user.id || !button) {
      throw new UserFacingError("This trade vote form has expired or was already submitted.");
    }
    await post.edit({
      content: `Trade vote from ${interaction.user.username} — submitting...`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(buttonId)
            .setLabel("Submitting...")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        ),
      ],
    });
    claimed = true;

    const title = interaction.fields.getTextInputValue("title").trim();
    const picture = interaction.fields.getUploadedFiles("picture", true).first();
    const video = interaction.fields.getUploadedFiles("video")?.first();
    const videoUrl = validateWebUrl(
      interaction.fields.getTextInputValue("video_url").trim(),
      "Trade video",
    );
    if (video && videoUrl) {
      throw new UserFacingError(
        "Choose either an uploaded video or a video link, not both.",
      );
    }
    validateAttachments([picture], { imagesOnly: true });
    if (video) validateVideoAttachment(video);

    await publishTradeListing(interaction, { title, picture, video, videoUrl }, post);
    published = true;
    pendingTradeForms.delete(formKey);
    openedTradeForms.delete(submissionKey);
    await clearPendingForm(interaction.guildId, channelId, messageId);
  } catch (error) {
    if (post && claimed && !published) {
      const canRetry = Date.now() < expiresAt;
      if (!canRetry) {
        pendingTradeForms.delete(formKey);
        openedTradeForms.delete(submissionKey);
        await clearPendingForm(interaction.guildId, channelId, messageId);
      }
      await post.edit({
        content: canRetry
          ? `Trade vote from ${interaction.user.username} — finish your trade using the button below.`
          : `Trade vote form from ${interaction.user.username} expired. Run \`/new-vote\` to start again.`,
        components: canRetry
          ? [makeCreateTradeButton(ownerId, expiresAt)]
          : [],
        embeds: [],
        attachments: [],
      }).catch((restoreError) => {
        console.error("Could not restore the trade vote form post:", restoreError);
      });
    }
    throw error;
  } finally {
    activeTradeSubmissions.delete(submissionKey);
    releasePendingFormOperation(interaction.guildId, channelId, messageId);
  }

  await interaction.editReply({
    content: `Your trade was posted for voting: ${post.url}`,
    allowedMentions: { parse: [] },
  });
}

async function publishTradeListing(interaction, { title, picture, video, videoUrl }, post) {
  const [profile, member] = await Promise.all([
    UserProfile.findOne({
      guildId: interaction.guildId,
      discordUserId: interaction.user.id,
    }),
    interaction.guild.members.fetch(interaction.user.id),
  ]);
  const discordDisplayName = member.displayName;
  const listing = await TradeListing.create({
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
    ownerName: discordDisplayName,
    ownerRobloxUsername: profile?.adoptMeUsername ?? "",
    title,
    videoUrl,
    // The original bot-authored form is the final public post. Persist its
    // coordinates before publishing so a later metadata error cannot leave
    // a visible post with no corresponding database record.
    postChannelId: post.channelId,
    postMessageId: post.id,
  });
  let cleanup = async () => {};
  let published = false;
  try {
    const prepared = await prepareMediaFiles(
      video ? [picture, video] : [picture],
      `trade-${String(listing._id).slice(-8)}`,
    );
    cleanup = prepared.cleanup;
    listing.coverImageName = prepared.firstImageName ?? "";
    const updatedPost = await post.edit({
      content: `Trade proposal from ${discordDisplayName}`,
      embeds: [makeTradeEmbed(listing)],
      components: makeVoteButtons(listing),
      files: prepared.files,
      allowedMentions: { parse: [] },
    });
    published = true;
    listing.postChannelId = updatedPost.channelId;
    listing.postMessageId = updatedPost.id;
    listing.mediaAttachments = getMessageMedia(updatedPost);
    listing.coverImageName =
      listing.mediaAttachments.find(isImageAttachment)?.name ??
      listing.coverImageName;
    await listing.save();
  } catch (error) {
    if (!published) {
      await TradeListing.deleteOne({ _id: listing._id }).catch(cleanupError =>
        console.error("Could not remove unfinished trade listing:", cleanupError));
      throw error;
    }
    // The public post is already live. Never clear the record or restore a
    // create form over it simply because the optional metadata save failed.
    // The persisted channel/message IDs allow normal voting and later repair.
    console.error("[Trade] Public post saved; media metadata needs refresh:", error);
  } finally {
    await cleanup().catch(error => console.warn("[Trade] Temporary media cleanup failed:", error));
  }
  await awardMilestoneSafely(interaction.guildId, interaction.user.id,
    "tradeFirstListing", String(listing._id));
}

export async function handleVote(interaction) {
  if (!interaction.inGuild()) {
    throw new UserFacingError("Trade votes only work inside a server.");
  }

  const parts = interaction.customId.split(":");
  let dimension;
  let vote;
  let id;

  if (parts.length === 4 && parts[0] === "tradevote") {
    [, dimension, vote, id] = parts;
    if (dimension === "q") dimension = "qualityVotes";
    else if (dimension === "d") dimension = "decisionVotes";
    else dimension = null;

    const allowedVotes = {
      qualityVotes: ["good", "bad", "unsure"],
      decisionVotes: ["make", "wont"],
    };
    if (!dimension || !allowedVotes[dimension]?.includes(vote)) {
      throw new UserFacingError("That vote button is not valid.");
    }
  } else if (
    parts.length === 3 &&
    parts[0] === "tradevote" &&
    ["1", "-1"].includes(parts[1])
  ) {
    // Preserve older Interested/Not interested buttons as personal-choice votes.
    dimension = "decisionVotes";
    vote = parts[1] === "1" ? "make" : "wont";
    id = parts[2];
  } else {
    throw new UserFacingError("That vote button is not valid.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const listing = await TradeListing.findOne({
    _id: id,
    guildId: interaction.guildId,
    status: "open",
  });
  if (!listing || listing.postMessageId !== interaction.message.id) {
    throw new UserFacingError("This trade post is no longer active.");
  }
  if (listing.ownerId === interaction.user.id) {
    throw new UserFacingError("You cannot vote on your own trade post.");
  }

  const path = `${dimension}.${interaction.user.id}`;
  const result = await TradeListing.updateOne(
    { _id: id, guildId: interaction.guildId, status: "open" },
    { $set: { [path]: vote } },
  );
  if (!result.matchedCount) {
    throw new UserFacingError("This trade post is no longer active.");
  }

  const updated = await TradeListing.findById(id);
  if (!updated) throw new UserFacingError("This trade post is no longer active.");

  const message = await interaction.channel.messages.fetch(interaction.message.id);
  const currentImage = message.attachments.find(isImageAttachment);
  const savedImage = updated.mediaAttachments.find(isImageAttachment);
  const restoreImage = !currentImage && savedImage?.url;
  if (!currentImage && !restoreImage) {
    console.error(
      `Trade ${id} has no image attachment on its post or usable saved image metadata.`,
    );
  }
  const editedMessage = await message.edit({
    embeds: [makeTradeEmbed(updated)],
    components: makeVoteButtons(updated),
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
    })),
    files: restoreImage
      ? [{ attachment: savedImage.url, name: savedImage.name }]
      : [],
    allowedMentions: { parse: [] },
  });
  if (restoreImage) {
    updated.mediaAttachments = getMessageMedia(editedMessage);
    updated.coverImageName =
      updated.mediaAttachments.find(isImageAttachment)?.name ??
      updated.coverImageName;
    await updated.save();
  }
  await interaction.editReply({
    content: `Your ${dimension === "qualityVotes" ? "trade-quality" : "personal-choice"} vote was saved. You can change it by choosing another option in that row.`,
  });
}
