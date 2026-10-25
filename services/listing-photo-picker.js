import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import { UserFacingError } from "../commands/errors.js";

// Discord string-select menus allow at most 25 items per menu.
// House and outfit listing uploads are ordinarily far below this threshold.
export const MAX_GALLERY_PICKER_OPTIONS = 25;

export function photoPickerResponse(type, listing, count, postMessageId) {
  if (!["house", "outfit"].includes(type) ||
      !/^[0-9a-f]{24}$/i.test(String(listing?._id ?? "")) ||
      !/^\d{17,20}$/.test(String(postMessageId ?? "")) ||
      !Number.isSafeInteger(count) || count < 2) {
    throw new UserFacingError("This photo gallery is no longer available.");
  }
  const current = Math.max(0, Math.min(count - 1, Number(listing.galleryPageIndex) || 0));
  // Keep a 25-photo window containing the current page for historical
  // galleries larger than Discord's menu limit; Previous/Next still works.
  const start = count <= MAX_GALLERY_PICKER_OPTIONS
    ? 0 : Math.min(Math.max(0, current - 12), count - MAX_GALLERY_PICKER_OPTIONS);
  const limit = Math.min(MAX_GALLERY_PICKER_OPTIONS, count);
  const options = Array.from({ length: limit }, (_, offset) => ({
    label: \`Photo \${start + offset + 1}\`,
    value: String(start + offset),
    default: start + offset === current,
  }));
  return {
    content: \`Choose a \${type} photo to show on the public listing.\` +
      (count > limit
        ? \` Showing photos \${start + 1}–\${start + limit} of \${count}. Use Previous/Next to reach another range.\`
        : ""),
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(\`\${type}:photo-select:\${listing._id}:\${postMessageId}\`)
          .setPlaceholder("Jump directly to a photo…")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(options),
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

export function selectedGalleryPage(interaction, count) {
  const value = interaction.values?.[0];
  if (!/^(0|[1-9]\d*)$/.test(value ?? "")) {
    throw new UserFacingError("Choose a valid photo number from the menu.");
  }
  const page = Number(value);
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(count) ||
      page < 0 || page >= count) {
    throw new UserFacingError("That photo is no longer available. Open Choose photo again.");
  }
  return page;
}
