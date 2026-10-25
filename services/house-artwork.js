import { HOUSE_ART_NAME } from "./house-style.js";

/**
 * Discord may omit embed-backed image attachments from message.attachments.
 * Verify the image by its resulting embed URL instead; the URL can be an
 * attachment:// URI or a Discord CDN URL.
 */
export function houseArtworkIsEmbedded(message) {
  return (message?.embeds ?? []).some(embed => {
    const image = embed?.image ?? embed?.data?.image;
    const paths = [image?.url, image?.proxyURL, image?.proxy_url];
    return paths.some(raw => {
      if (typeof raw !== "string" || !raw) return false;
      try {
        const decoded = decodeURIComponent(raw);
        return decoded.includes(HOUSE_ART_NAME);
      } catch {
        return raw.includes(HOUSE_ART_NAME);
      }
    });
  });
}
