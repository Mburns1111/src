import { createCanvas } from "@napi-rs/canvas";
import { APPEARANCE_CATALOG } from "./post-appearance.js";
import { classicFrameArtwork } from "./shop-showcase-sheets.js";
import { registerAppearanceFonts } from "./font-library.js";
import { stickerDefaults } from "./sticker-catalog.js";
import { drawStickerArtwork } from "./sticker-artwork.js";

// One compact reference image for a selected Classic item, used in BOTH
// the item's detail screen and its purchase confirmation. Full personalized
// images are still available from "My Preview" and "Preview Multiple".
const thumbnailCache = new Map();
export async function classicItemThumbnail(item) {
  const key = `${item.category}:${item.id}`;
  if (!thumbnailCache.has(key)) {
    const pending = makeThumbnail(item);
    thumbnailCache.set(key, pending);
    pending.catch(() => thumbnailCache.delete(key));
  }
  return thumbnailCache.get(key);
}

async function makeThumbnail(item) {
  const canvas = createCanvas(760, 300);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#28362D";

  if (item.category === "backgrounds" || item.category === "panels") {
    const color = item.category === "backgrounds"
      ? APPEARANCE_CATALOG.backgrounds[item.id]?.color
      : APPEARANCE_CATALOG.panels[item.id]?.palette?.panel;
    if (!color) return null;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 760, 300);
    const dark = Number.parseInt(color.slice(1, 3), 16) * .2126 +
      Number.parseInt(color.slice(3, 5), 16) * .7152 +
      Number.parseInt(color.slice(5, 7), 16) * .0722 < 145;
    ctx.fillStyle = dark ? "#FFFFFF" : "#202820";
    ctx.font = "bold 42px sans-serif";
    ctx.fillText(item.name, 35, 130, 700);
    ctx.font = "32px sans-serif";
    ctx.fillText(color.toUpperCase(), 36, 193, 700);
  } else if (item.category === "frames") {
    const artwork = await classicFrameArtwork(item);
    // Show the actual top-left frame corner up close, not a tiny full card.
    ctx.drawImage(artwork, 0, 0, 345, 262, 8, 5, 455, 290);
    ctx.fillStyle = "#27352F";
    ctx.font = "bold 35px sans-serif";
    ctx.fillText(item.name, 480, 136, 265);
    ctx.font = "25px sans-serif";
    ctx.fillStyle = "#637268";
    ctx.fillText("Top-left corner", 482, 187);
  } else if (item.category === "fonts") {
    registerAppearanceFonts();
    const font = APPEARANCE_CATALOG.fonts[item.id];
    ctx.fillStyle = "#27352F";
    ctx.font = "bold 30px sans-serif";
    ctx.fillText(item.name, 32, 58, 696);
    ctx.font = `${font.weight || "normal"} 51px ${font.titleFamily}`;
    ctx.fillText("A Little Bit of Magic", 32, 143, 695);
    ctx.font = `${font.weight || "normal"} 32px ${font.family}`;
    ctx.fillText("Your profile, your story.", 33, 222, 690);
  } else if (item.category === "stickers") {
    ctx.save();
    ctx.translate(180, 145);
    drawStickerArtwork(ctx, stickerDefaults(item.id), 118);
    ctx.restore();
    ctx.fillStyle = "#27352F";
    ctx.font = "bold 43px sans-serif";
    ctx.fillText(item.name, 340, 143, 394);
    ctx.font = "26px sans-serif";
    ctx.fillStyle = "#637268";
    ctx.fillText("Classic sticker", 342, 190);
  } else if (item.category === "fontColors") {
    const color = APPEARANCE_CATALOG.fontColors[item.id]?.text;
    if (!color) return null;
    ctx.fillStyle = item.id === "white" ? "#40534C" : "#F2F5F1";
    ctx.fillRect(0, 0, 760, 300);
    ctx.fillStyle = color;
    ctx.font = "bold 52px sans-serif";
    ctx.fillText("Your story shines", 31, 139, 690);
    ctx.font = "31px sans-serif";
    ctx.fillText(item.name, 32, 212, 690);
  } else {
    return null;
  }
  return canvas.toBuffer("image/png");
}
