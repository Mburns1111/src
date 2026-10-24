import ParticipationSource from "../models/ParticipationSource.js";
import NativePollParticipation from "../models/NativePollParticipation.js";

const SNOWFLAKE = /^\d{17,21}$/;
const EVENTS = new Set(["MESSAGE_POLL_VOTE_ADD", "MESSAGE_POLL_VOTE_REMOVE"]);

// Raw Gateway poll events work even if the original poll is not cached (for
// example if it was posted before the test bot restarted). No message body
// access, Message Content intent or third-party poll interactions are needed.
export function parseNativePollEvent(packet) {
  if (!EVENTS.has(packet?.t)) return null;
  const data = packet.d;
  if (!data || ![data.guild_id, data.channel_id, data.message_id, data.user_id]
    .every(value => typeof value === "string" && SNOWFLAKE.test(value))) return null;
  const answerId = Number(data.answer_id);
  if (!Number.isInteger(answerId) || answerId < 1 || answerId > 10) return null;
  return {
    guildId: data.guild_id,
    channelId: data.channel_id,
    messageId: data.message_id,
    userId: data.user_id,
    answerId,
    added: packet.t === "MESSAGE_POLL_VOTE_ADD",
  };
}

export function parseGuildMessageLink(input, guildId) {
  if (typeof input !== "string") return null;
  const match = /^https?:\/\/(?:canary\.|ptb\.)?(?:discord(?:app)?\.com)\/channels\/(\d{17,21})\/(\d{17,21})\/(\d{17,21})(?:\/)?(?:\?.*)?$/.exec(input.trim());
  if (!match || (guildId && match[1] !== guildId)) return null;
  return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

export async function observeNativePollVote(parsed, {
  sources = ParticipationSource,
  participants = NativePollParticipation,
} = {}) {
  if (!parsed) return false;
  const key = { guildId: parsed.guildId, messageId: parsed.messageId };
  const userKey = { ...key, discordUserId: parsed.userId };
  const now = new Date();

  // Register the poll itself. Never overwrite a manual third-party source.
  await sources.updateOne(key, {
    $setOnInsert: {
      ...key, channelId: parsed.channelId, source: "discord-native-poll",
    },
    $set: { lastObservedAt: now },
  }, { upsert: true });

  if (parsed.added) {
    try {
      await participants.updateOne(userKey, {
        $setOnInsert: { ...userKey, channelId: parsed.channelId },
        $addToSet: { answerIds: parsed.answerId },
        $set: { lastEventAt: now },
      }, { upsert: true });
    } catch (error) {
      if (Number(error?.code) !== 11000) throw error;
      // Concurrent answers for a newly recorded multi-choice ballot may
      // race during upsert. The unique index prevents duplicates; retry.
      await participants.updateOne(userKey, {
        $addToSet: { answerIds: parsed.answerId },
        $set: { lastEventAt: now },
      });
    }
  } else {
    // Don't create an empty participant if the original vote was cast while
    // this bot was offline.
    await participants.updateOne(userKey, {
      $pull: { answerIds: parsed.answerId },
      $set: { lastEventAt: now },
    });
  }
  return true;
}

export function messageVisibility(message) {
  // Bot can fetch the message from this channel if this function is called.
  // Embeds/components of messages authored by other apps may be redacted by
  // the Message Content gateway permission; any public panel is not proof of
  // individual private votes or giveaway entries.
  return {
    authorId: message.author?.id || "",
    authorBot: Boolean(message.author?.bot),
    embedCount: message.embeds?.length ?? 0,
    componentCount: message.components?.length ?? 0,
    hasContent: Boolean(message.content),
    nativePollVisible: Boolean(message.poll),
  };
}
