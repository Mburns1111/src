import { MessageFlags } from "discord.js";
import { UserFacingError } from "./errors.js";

export async function handleListingInterest(
  interaction,
  { ListingModel, listingType, makeComponents },
) {
  const [, action, listingId] = interaction.customId.split(":");
  if (!["interest", "notify"].includes(action)) return false;

  if (!/^[a-f\d]{24}$/i.test(listingId ?? "")) {
    throw new UserFacingError(`That ${listingType} listing is not valid.`);
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const listing = await ListingModel.findOne({
    _id: listingId,
    guildId: interaction.guildId,
    status: "active",
    postChannelId: interaction.channelId,
    postMessageId: interaction.message.id,
  });
  if (!listing) {
    throw new UserFacingError(`This ${listingType} listing is no longer active.`);
  }

  if (action === "notify") {
    if (interaction.user.id !== listing.ownerId) {
      throw new UserFacingError("Only the listing owner can change their DM setting.");
    }
    const updated = await ListingModel.findOneAndUpdate(
      {
        _id: listing._id,
        guildId: interaction.guildId,
        ownerId: interaction.user.id,
        status: "active",
        postMessageId: interaction.message.id,
      },
      { $set: { notifyOnInterest: !listing.notifyOnInterest } },
      { returnDocument: "after", runValidators: true },
    );
    if (!updated) {
      throw new UserFacingError(`This ${listingType} listing is no longer active.`);
    }
    await interaction.message.edit({ components: makeComponents(updated) });
    await interaction.editReply({
      content: `Interest DMs are now ${updated.notifyOnInterest ? "on" : "off"} for this listing.`,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  if (interaction.user.id === listing.ownerId) {
    throw new UserFacingError("You can't mark yourself as interested in your own listing.");
  }

  const wasInterested = listing.interestedUserIds.includes(interaction.user.id);
  const updated = await ListingModel.findOneAndUpdate(
    {
      _id: listing._id,
      guildId: interaction.guildId,
      status: "active",
      postMessageId: interaction.message.id,
      interestedUserIds: wasInterested
        ? interaction.user.id
        : { $ne: interaction.user.id },
    },
    wasInterested
      ? { $pull: { interestedUserIds: interaction.user.id } }
      : { $addToSet: { interestedUserIds: interaction.user.id } },
    { returnDocument: "after", runValidators: true },
  );
  if (!updated) {
    throw new UserFacingError("Your interest changed at the same time. Please tap the button again.");
  }

  await interaction.message.edit({ components: makeComponents(updated) });
  let notificationMessage = "";
  if (!wasInterested && updated.notifyOnInterest) {
    try {
      const owner = await interaction.client.users.fetch(updated.ownerId);
      const message = [
        `${interaction.user.username} is interested in your ${listingType} listing "${updated.title}"`,
        `in ${interaction.guild.name}: ${interaction.message.url}`,
      ].join(" ");
      await owner.send({
        content: message,
        allowedMentions: { parse: [] },
      });
      notificationMessage = " The owner was notified by DM.";
    } catch (error) {
      console.error(
        `Could not DM the owner about interest in ${listingType} listing ${updated._id}:`,
        error,
      );
      notificationMessage = " Your interest was saved, but the owner could not be notified by DM.";
    }
  }
  const response = wasInterested
    ? `Your interest was removed. There are now ${updated.interestedUserIds.length} interested member(s).`
    : [
        `Your interest was added. There are now ${updated.interestedUserIds.length} interested member(s).`,
        notificationMessage,
      ].join("");
  await interaction.editReply({
    content: response,
    allowedMentions: { parse: [] },
  });
  return true;
}
