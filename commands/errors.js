export class UserFacingError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function getInteractionErrorMessage(error) {
  if (error instanceof UserFacingError) return error.message.slice(0, 1900);

  const rawCode = error?.code ?? error?.rawError?.code;
  const code = typeof rawCode === "number" || typeof rawCode === "string"
    ? Number(rawCode)
    : Number.NaN;
  if (code === 40005) {
    return "That upload is too large for Discord. Try a smaller file or use a video link.";
  }
  if (code === 50013 || code === 50001) {
    return "The bot is missing permission to do that. Ask a server admin to check its channel permissions.";
  }
  if (code === 10003 || code === 10008) {
    return "That channel or post is no longer available. Ask a server admin to check the bot's channel settings.";
  }
  if (error?.name === "ValidationError" || code === 11000) {
    return "I couldn't save that information. Check what you entered and try again.";
  }

  return "Something went wrong. Please try again in a moment. If it keeps happening, tell a server admin.";
}
