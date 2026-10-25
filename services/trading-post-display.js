import { AttachmentBuilder, EmbedBuilder } from "discord.js";

/**
 * Styled Trading Posts need exactly ONE embed. Related cards and inventory
 * links are available as clickable Markdown text beneath the preview.
 */
export function tradingPostCardPayload(cardImage, linkLines, components) {
  const lines = Array.isArray(linkLines) ? linkLines.filter(Boolean) : [];
  let content = lines.length ? "**Related listings & inventory**" : "";
  for (const line of lines) {
    if (content.length + line.length + 1 > 1900) break;
    content += "\n" + line;
  }
  return {
    content,
    embeds: [new EmbedBuilder().setColor(0x819287)
      .setImage("attachment://trading-post-card.png")],
    files: [new AttachmentBuilder(cardImage, { name: "trading-post-card.png" })],
    attachments: [],
    components,
    allowedMentions: { parse: [] },
  };
}
