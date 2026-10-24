import { createCanvas, loadImage } from "@napi-rs/canvas";
import { APPEARANCE_CATALOG } from "./post-appearance.js";
import { CLASSIC_SHOP_ITEMS } from "./shop-presentation.js";
import { registerAppearanceFonts } from "./font-library.js";
import { STICKER_CATALOG, stickerDefaults } from "./sticker-catalog.js";
import { drawStickerArtwork } from "./sticker-artwork.js";
import { frameArtworkSvg } from "./frame-artwork.js";
import { DEFAULT_POST_STYLE } from "./post-layouts.js";

const INK = "#27352F";
const MUTED = "#617067";
const PAPER = "#F5F6F3";

function sheet(width, height, heading, subtitle) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#DCE8DD";
  ctx.fillRect(0, 0, width, 11);
  ctx.fillStyle = INK;
  ctx.font = "bold 52px sans-serif";
  ctx.fillText(heading, 38, 82, width - 76);
  ctx.font = "27px sans-serif";
  ctx.fillStyle = MUTED;
  ctx.fillText(subtitle, 40, 126, width - 80);
  return { canvas, ctx };
}

function line(ctx, y, width = 1200) {
  ctx.strokeStyle = "#DBE2DA";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(40, y);
  ctx.lineTo(width - 40, y);
  ctx.stroke();
}

// Draw the same rounded outer/inner rails used for the free standard frame,
// but without the profile photo, panels or text beneath them.
function standardFrameCornerArtwork() {
  const canvas = createCanvas(1200, 800);
  const ctx = canvas.getContext("2d");
  const cornerRail = (inset, radius, color, width) => {
    ctx.beginPath();
    ctx.moveTo(inset, 800);
    ctx.lineTo(inset, inset + radius);
    ctx.quadraticCurveTo(inset, inset, inset + radius, inset);
    ctx.lineTo(1200, inset);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  cornerRail(DEFAULT_POST_STYLE.outerInset, DEFAULT_POST_STYLE.cornerRadius,
    DEFAULT_POST_STYLE.frame, DEFAULT_POST_STYLE.borderWidth);
  cornerRail(DEFAULT_POST_STYLE.innerInset, DEFAULT_POST_STYLE.innerCornerRadius,
    DEFAULT_POST_STYLE.panelAlt, DEFAULT_POST_STYLE.innerBorderWidth);
  return canvas;
}

export async function classicFrameArtwork(item) {
  const frame = APPEARANCE_CATALOG.frames[item.id];
  const svg = frame?.kind === "artwork" ? frameArtworkSvg(frame.artwork) : null;
  return svg ? loadImage(Buffer.from(svg, "utf8"))
    : standardFrameCornerArtwork();
}

// One large, clean gallery of the TOP-LEFT frame corners only. The actual
// transparent frame SVG overlays are cropped before enlargement; full profile
// cards (and their distracting text/avatars) are intentionally not rendered.
// Crops gently overlap, giving each distinct corner room to be inspected.
export async function renderClassicFrameSheet(items) {
  const ordered = CLASSIC_SHOP_ITEMS.frames
    .map(id => items.find(item => item.id === id)).filter(Boolean);
  const canvas = createCanvas(1200, 1415);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = INK;
  ctx.font = "bold 53px sans-serif";
  ctx.fillText("CLASSIC FRAMES", 42, 85);
  ctx.font = "27px sans-serif";
  ctx.fillStyle = MUTED;
  ctx.fillText("Zoomed-in top-left corners · compare each frame at a glance", 44, 131, 1100);

  const cropWidth = 330, cropHeight = 255;
  const shownWidth = 550, shownHeight = 425;
  const columnX = [40, 554];  // 36px horizontal overlap
  const rowY = [165, 555, 945]; // 35px vertical overlap
  for (const [i, item] of ordered.entries()) {
    const x = columnX[i % 2];
    const y = rowY[Math.floor(i / 2)];
    const artwork = await classicFrameArtwork(item);
    ctx.drawImage(artwork, 0, 0, cropWidth, cropHeight,
      x, y, shownWidth, shownHeight);

    // Labels sit inside the open white part of the enlarged corner.
    ctx.fillStyle = INK;
    ctx.font = "bold 32px sans-serif";
    ctx.fillText(item.name, x + 170, y + 270, 365);
    ctx.font = "26px sans-serif";
    ctx.fillStyle = MUTED;
    ctx.fillText(item.included ? "Free · Included" : `${item.price} Points`,
      x + 171, y + 313, 355);
  }
  return canvas.toBuffer("image/png");
}

export function renderClassicFontSheet(items) {
  registerAppearanceFonts();
  const ordered = CLASSIC_SHOP_ITEMS.fonts
    .map(id => items.find(item => item.id === id)).filter(Boolean);
  const { canvas, ctx } = sheet(1200, 166 + ordered.length * 178,
    "CLASSIC FONTS", "Heading and profile-text samples · all on one sheet");
  for (const [i, item] of ordered.entries()) {
    const y = 160 + i * 178;
    if (i) line(ctx, y - 12);
    const font = APPEARANCE_CATALOG.fonts[item.id];
    const title = item.id === "default" ? "Standard Clean" : item.name;
    ctx.fillStyle = MUTED;
    ctx.font = "bold 25px sans-serif";
    ctx.fillText(`${title}  ·  ${item.included ? "Included" : `${item.price} Points`}`, 43, y + 20, 1120);
    ctx.fillStyle = INK;
    ctx.font = `${font.weight || "normal"} 52px ${font.titleFamily}`;
    ctx.fillText("A Little Bit of Magic", 43, y + 89, 1120);
    ctx.font = `${font.weight || "normal"} 34px ${font.family}`;
    ctx.fillText("The quick brown fox jumps over the lazy dog.", 43, y + 137, 1120);
  }
  return canvas.toBuffer("image/png");
}

export function renderClassicStickerSheet(items) {
  const ordered = CLASSIC_SHOP_ITEMS.stickers
    .map(id => items.find(item => item.id === id)).filter(Boolean);
  const columns = 3;
  const rows = Math.ceil(ordered.length / columns);
  const { canvas, ctx } = sheet(1200, 160 + rows * 306,
    "CLASSIC STICKERS", "Design gallery · colors and placement can be customized after purchase");
  for (const [i, item] of ordered.entries()) {
    const x = 38 + (i % columns) * 394;
    const y = 153 + Math.floor(i / columns) * 306;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x, y, 369, 276);
    ctx.strokeStyle = "#DEE4DE";
    ctx.strokeRect(x, y, 369, 276);
    ctx.save();
    ctx.translate(x + 184, y + 101);
    drawStickerArtwork(ctx, stickerDefaults(item.id), 137);
    ctx.restore();
    ctx.fillStyle = INK;
    ctx.font = "bold 30px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(STICKER_CATALOG[item.id]?.name || item.name, x + 184, y + 212, 336);
    ctx.fillStyle = MUTED;
    ctx.font = "24px sans-serif";
    ctx.fillText(`${item.price} Points`, x + 184, y + 251);
    ctx.textAlign = "left";
  }
  return canvas.toBuffer("image/png");
}

export function renderClassicTextColorSheet() {
  const choices = [
    { id: "default", name: "Default · Included", sampleBackground: "#FFFFFF" },
    { id: "black", name: "Black · Included", sampleBackground: "#FFFFFF" },
    { id: "white", name: "White · Included", sampleBackground: "#3F5150" },
  ];
  const { canvas, ctx } = sheet(1200, 160 + choices.length * 184 + 106,
    "CLASSIC TEXT COLORS", "Preview the same lettering in the available classic colors");
  for (const [i, item] of choices.entries()) {
    const y = 151 + i * 184;
    ctx.fillStyle = item.sampleBackground;
    ctx.fillRect(38, y, 1124, 162);
    ctx.fillStyle = APPEARANCE_CATALOG.fontColors[item.id].text;
    ctx.font = "bold 39px sans-serif";
    ctx.fillText(item.name, 62, y + 58, 1074);
    ctx.font = "30px sans-serif";
    ctx.fillText("Your story deserves to shine.", 63, y + 112, 1074);
  }
  ctx.fillStyle = MUTED;
  ctx.font = "bold 31px sans-serif";
  ctx.fillText("Custom HEX · Choose your own text color in the shop", 50,
    169 + choices.length * 184 + 64, 1100);
  return canvas.toBuffer("image/png");
}
