import { AttachmentBuilder } from "discord.js";

/**
 * Trading Post artwork is a regular uploaded PNG, not a Discord embed.
 * Always include embeds: [] so editing an old styled/legacy card removes
 * its previous embeds. attachments: [] replaces the old image on refresh.
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
    embeds: [],
    files: [new AttachmentBuilder(cardImage, { name: "trading-post-card.png" })],
    attachments: [],
    components,
    allowedMentions: { parse: [] },
  };
}

/**
 * Private previews use the same attachment display. They keep the editable
 * controls and are updated in-place when a style changes.
 */
export function tradingPostPreviewPayload(previewImage, content, components) {
  return {
    content,
    embeds: [],
    files: [new AttachmentBuilder(previewImage, { name: "trading-post-preview.png" })],
    attachments: [],
    components,
    allowedMentions: { parse: [] },
  };
}
