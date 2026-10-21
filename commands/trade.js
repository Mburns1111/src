import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import TradeListing from "../models/TradeListing.js";
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

export const data = new SlashCommandBuilder()
  .setName("new-vote")
  .setDescription("Post a trade for the server to vote on")
  .addStringOption((option) =>
    option
      .setName("title")
      .setDescription("Short title for your trade")
      .setRequired(true)
      .setMaxLength(100),
  )
  .addAttachmentOption((option) =>
    option
      .setName("picture")
      .setDescription("Add one picture of the trade")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("video_url")
      .setDescription("Optional link to a video of the trade")
      .setMaxLength(500),
  )
  .addAttachmentOption((option) =>
    option
      .setName("video")
      .setDescription("Optional uploaded video; use instead of a video link"),
  );

function getMapEntries(map) {
  if (map && typeof map.entries === "function") {
    return Array.from(map.entries());
  }
  return Object.entries(map ?? {});
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

function makeTradeEmbed(listing, firstImageName = listing.coverImageName) {
  const counts = getVoteCounts(listing);
  const embed = new EmbedBuilder()
    .setColor(0xe6a23c)
    .setTitle(listing.title)
    .setAuthor({ name: listing.ownerName })
    .addFields(
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
  if (firstImageName) embed.setImage(`attachment://${firstImageName}`);
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

export async function execute(interaction) {
  requireGuild(interaction);
  const title = interaction.options.getString("title", true).trim();
  const picture = interaction.options.getAttachment("picture", true);
  const video = interaction.options.getAttachment("video");
  const videoUrl = validateWebUrl(
    interaction.options.getString("video_url"),
    "Trade video",
  );
  if (video && videoUrl) {
    throw new UserFacingError(
      "Choose either an uploaded video or a video link, not both.",
    );
  }
  validateAttachments([picture], { imagesOnly: true });
  if (video) validateVideoAttachment(video);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channel = await getConfiguredTextChannel(
    interaction,
    "tradeVoteChannelId",
    "trade voting",
  );

  const listing = await TradeListing.create({
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
    ownerName: interaction.user.globalName ?? interaction.user.username,
    title,
    videoUrl,
  });
  let cleanup = async () => {};
  let post;
  try {
    const prepared = await prepareMediaFiles(
      video ? [picture, video] : [picture],
      `trade-${String(listing._id).slice(-8)}`,
    );
    cleanup = prepared.cleanup;
    listing.coverImageName = prepared.firstImageName ?? "";
    post = await channel.send({
      content: `Trade proposal from ${interaction.user.username}`,
      embeds: [makeTradeEmbed(listing, prepared.firstImageName)],
      components: makeVoteButtons(listing),
      files: prepared.files,
      allowedMentions: { parse: [] },
    });
    listing.postChannelId = post.channelId;
    listing.postMessageId = post.id;
    listing.mediaAttachments = getMessageMedia(post);
    await listing.save();
  } catch (error) {
    if (post) await post.delete().catch(() => {});
    await TradeListing.deleteOne({ _id: listing._id }).catch(() => {});
    throw error;
  } finally {
    await cleanup();
  }

  await interaction.editReply({
    content: `Your trade was posted for voting: ${post.url}`,
    allowedMentions: { parse: [] },
  });
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

  await interaction.message.edit({
    embeds: [makeTradeEmbed(updated)],
    components: makeVoteButtons(updated),
    attachments: interaction.message.attachments.map((attachment) => ({
      id: attachment.id,
    })),
    allowedMentions: { parse: [] },
  });
  await interaction.editReply({
    content: `Your ${dimension === "qualityVotes" ? "trade-quality" : "personal-choice"} vote was saved. You can change it by choosing another option in that row.`,
  });
}
