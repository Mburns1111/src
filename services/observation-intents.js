// Access to guild message text, embeds and button components is sensitive.
// Opt in explicitly for diagnostics; Discord Developer Portal must also
// enable the privileged Message Content intent for the same application.
export function shouldRequestMessageContent(env = process.env) {
  return env.ENABLE_MESSAGE_CONTENT_INTENT === "1";
}
