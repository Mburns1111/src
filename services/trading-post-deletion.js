import TradingPost from "../models/TradingPost.js";

const missing = error => [10003, 10008].includes(Number(error?.code ?? error?.rawError?.code));

/** Finish a durable, owner-requested deletion; never delete another author's message. */
export async function finalizeTradingPostDeletion(guild, post, { PostModel = TradingPost, knownMessage = null } = {}) {
  if (!post?.deletePending) throw new Error("Trading Post deletion must be reserved first.");
  try {
    let message = knownMessage;
    if (!message && post.postChannelId && post.postMessageId) {
      const channel = await guild.channels.fetch(post.postChannelId);
      message = await channel?.messages?.fetch(post.postMessageId);
    }
    if (message) {
      if (message.author?.id !== guild.client.user.id) {
        throw new Error("Trading Post message belongs to another author; refusing to delete.");
      }
      await message.delete();
    }
  } catch (error) {
    if (!missing(error)) throw error;
  }
  // If this fails, the record remains marked for the next startup.
  await PostModel.deleteOne({
    _id: post._id, guildId: guild.id, ownerId: post.ownerId, deletePending: true,
  });
  return { deleted: true };
}

export async function resumePendingTradingPostDeletes(guild, { PostModel = TradingPost } = {}) {
  const posts = await PostModel.find({ guildId: guild.id, deletePending: true }).lean();
  const result = { checked: posts.length, completed: 0, failed: 0 };
  for (const post of posts) {
    try {
      await finalizeTradingPostDeletion(guild, post, { PostModel });
      result.completed++;
    } catch (error) {
      result.failed++;
      console.warn(`[Trading Post] Deletion of ${post.ownerId} remains pending:`, error);
    }
  }
  return result;
}
