import HouseListing from "../models/HouseListing.js";
export async function checkHousePost(guild, listing) {
  if (!listing?.postChannelId || !listing?.postMessageId || listing.status !== "active") {
    return { state: "unavailable" };
  }
  let channel;
  try {
    channel = await guild.channels.fetch(listing.postChannelId);
    if (!channel?.messages?.fetch) return { state: "unavailable" };
    const message = await channel.messages.fetch(listing.postMessageId);
    if (message?.author?.id !== guild.client.user.id) return { state: "unavailable" };
    return { state: "present", message };
  } catch (error) {
    if (![10003, 10008].includes(Number(error?.code))) return { state: "unavailable", error };
    await HouseListing.updateOne({
      _id: listing._id, guildId: guild.id, status: "active",
      postMessageId: listing.postMessageId,
    }, { $set: { status: "missing", missingAt: new Date() } });
    return { state: "missing" };
  }
}
export async function findCustomizableHouses(guild, ownerId) {
  const candidates = await HouseListing.find({
    guildId: guild.id, ownerId, status: "active",
    postChannelId: { $ne: "" }, postMessageId: { $ne: "" },
  }).sort({ createdAt: -1, _id: -1 }).lean();
  const available = [];
  let unavailable = 0;
  for (const listing of candidates) {
    const result = await checkHousePost(guild, listing);
    if (result.state === "present") available.push(listing);
    else if (result.state === "unavailable") unavailable++;
  }
  return { available, unavailable };
}
