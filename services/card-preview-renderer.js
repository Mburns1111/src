import { createCanvas } from "@napi-rs/canvas";
import { loadImageSource } from "./post-renderer.js";
import { upgradeLabel } from "./card-identifiers.js";

export const CARD_PREVIEW_SIZE = Object.freeze({ width: 900, height: 1260 });

// Canva template target: 900 x 1260 pixels (5:7 portrait).
// The artwork viewport is x=78, y=244, width=744, height=762.
// Dynamic text is drawn on top of the Canva-exportable background/frame later.
const RARITY_PALETTE = Object.freeze({
  Common: ["#93A69D", "#516D65"],
  Uncommon: ["#88C3A6", "#3C8A67"],
  Rare: ["#8CAEDB", "#3B659B"],
  "Ultra-Rare": ["#CDA4E6", "#8855B3"],
  Legendary: ["#E6D6F6", "#8661B7"], // soft amethyst instead of gold
});

function roundRect(ctx, x, y, w, h, r, color, strokeColor, strokeWidth = 1) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (color) { ctx.fillStyle = color; ctx.fill(); }
  if (strokeColor) { ctx.lineWidth = strokeWidth; ctx.strokeStyle = strokeColor; ctx.stroke(); }
}
function fitText(ctx, value, maxWidth, start, min = 22, family = "sans-serif") {
  let size = start;
  do {
    ctx.font = `700 ${size}px ${family}`;
    if (ctx.measureText(value).width <= maxWidth) break;
    size -= 2;
  } while (size > min);
  return size;
}
function centered(ctx, value, x, y, maxWidth, size, color, family = "sans-serif") {
  fitText(ctx, value, maxWidth, size, 23, family);
  ctx.textAlign = "center";
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}
function placeholderPet(ctx, name, x, y, w, h, accent) {
  // Clearly placeholder artwork. Never misrepresent it as the pet's actual art.
  const centerX = x + w / 2;
  const centerY = y + h * .43;
  ctx.save();
  ctx.fillStyle = accent + "24";
  ctx.beginPath(); ctx.ellipse(centerX, centerY, w * .38, h * .32, 0, 0, Math.PI * 2); ctx.fill();
  // Neutral pet-like silhouette: ears, head and body, intentionally generic.
  ctx.fillStyle = accent + "77";
  ctx.beginPath(); ctx.moveTo(centerX - 135, centerY - 105);
  ctx.lineTo(centerX - 125, centerY - 260); ctx.lineTo(centerX - 32, centerY - 170);
  ctx.lineTo(centerX + 32, centerY - 170); ctx.lineTo(centerX + 125, centerY - 260);
  ctx.lineTo(centerX + 135, centerY - 105); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(centerX, centerY - 105, 162, 142, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(centerX, centerY + 145, 188, 162, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffffffcc";
  roundRect(ctx, x + 48, y + h - 136, w - 96, 92, 24, "#ffffffd9");
  centered(ctx, "ARTWORK PLACEHOLDER", centerX, y + h - 101, w - 145, 29, "#55635F");
  ctx.font = "25px sans-serif"; ctx.fillStyle = "#65726D"; ctx.textAlign = "center";
  ctx.fillText("Replace with approved artist artwork", centerX, y + h - 63);
  ctx.restore();
}
function cover(ctx, image, x, y, w, h) {
  const scale = Math.max(w / image.width, h / image.height);
  const iw = image.width * scale, ih = image.height * scale;
  ctx.drawImage(image, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

export async function renderCollectibleCardPreview({
  petName, rarity, upgradeLevel = "normal", releaseName = "Release 1",
  seriesName = "Series 1", publicId = "PREVIEW", artistCredit = "", otherCollectorCount = 0,
  artUrl = "", artStatus = "missing",
} = {}) {
  const { width: W, height: H } = CARD_PREVIEW_SIZE;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const [light, accent] = RARITY_PALETTE[rarity] || RARITY_PALETTE.Common;
  const neon = upgradeLevel === "neon", mega = upgradeLevel === "mega";
  const rim = accent; // Keep rarity identity consistent for all upgrades.
  const stageGlow = mega ? "#DCA7FA" : neon ? "#71E6C5" : null;

  const outer = ctx.createLinearGradient(0, 0, W, H);
  outer.addColorStop(0, "#F8F4F1"); outer.addColorStop(1, "#E4EDE8");
  ctx.fillStyle = outer; ctx.fillRect(0, 0, W, H);
  // Subtle background motif leaves space for Canva replacement artwork.
  for (let i = 0; i < 10; i++) {
    ctx.strokeStyle = rim + "16"; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.ellipse(W/2, H/2, 210 + i*54, 320 + i*65, .12, 0, Math.PI*2); ctx.stroke();
  }
  // Keep the exterior light. A THIN stage-colored edge only appears on upgrades.
  roundRect(ctx, 32, 32, W-64, H-64, 43, "#FFFEFA", stageGlow || light, neon || mega ? 5 : 2);
  ctx.shadowBlur = 0;
  roundRect(ctx, 51, 51, W-102, H-102, 28, null, light, 3);
  if (neon || mega) {
    const band = ctx.createLinearGradient(50, 0, W-50, 0);
    band.addColorStop(0, mega ? "#F9ADCE" : "#81E6C4");
    band.addColorStop(.5, mega ? "#B9ACF7" : "#8BD8F9");
    band.addColorStop(1, mega ? "#F5D17A" : "#81E6C4");
    roundRect(ctx, 63, 61, W-126, 12, 6, band);
  }

  centered(ctx, String(petName || "Mystery Pet"), W/2, 157, W-130, 88, "#2E3937");
  centered(ctx, String(rarity || "Common").toUpperCase(), W/2, 206, W-190, 27, accent);

  const art = { x: 83, y: 242, w: 734, h: 748 };
  // Artwork has its own rounded rarity-colored frame, independent of stage glow.
  roundRect(ctx, art.x-10, art.y-10, art.w+20, art.h+20, 30, "#F3F7F3", accent, 10);
  roundRect(ctx, art.x-3, art.y-3, art.w+6, art.h+6, 24, null, light, 3);
  ctx.save(); ctx.beginPath(); ctx.roundRect(art.x, art.y, art.w, art.h, 20); ctx.clip();
  const backdrop = ctx.createLinearGradient(art.x, art.y, art.x + art.w, art.y + art.h);
  backdrop.addColorStop(0, "#FAF9F4");
  backdrop.addColorStop(1, light + "85");
  ctx.fillStyle = backdrop; ctx.fillRect(art.x, art.y, art.w, art.h);

  let image = null;
  if (artStatus === "approved" && artUrl) {
    try { image = await loadImageSource(artUrl); }
    catch (error) { console.warn("[Cards] Preview image unavailable:", error.message); }
  }
  if (image) cover(ctx, image, art.x, art.y, art.w, art.h);
  else placeholderPet(ctx, petName, art.x, art.y, art.w, art.h, accent);
  ctx.restore();

  // Put upgrade effects around the stage badge, not around the artwork or main frame.
  if (stageGlow) {
    ctx.save();
    ctx.shadowColor = stageGlow;
    ctx.shadowBlur = mega ? 36 : 27;
    roundRect(ctx, 104, 1005, 692, 67, 23, mega ? "#F3E2F6" : "#DEF8EF", stageGlow, 6);
    ctx.restore();
  } else {
    roundRect(ctx, 110, 1011, 680, 55, 18, "#EAF0EA", light, 2);
  }
  centered(ctx, upgradeLabel(upgradeLevel).toUpperCase(), W/2, 1049, 640, 28, "#3D5750");

  // Dedicated footer rows: don't let right-aligned collector text leak into artist credit.
  // Canva safe zone: x=88..812, bottom baseline <=1192.
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#62716B";
  ctx.font = "24px sans-serif";
  ctx.fillText(`${seriesName}  ·  ${releaseName}`, 88, 1117, 724);

  ctx.font = "bold 24px sans-serif";
  ctx.fillStyle = "#4C605A";
  ctx.fillText(`Other collectors: ${Math.max(0, Number(otherCollectorCount) || 0)}`, 88, 1154, 724);

  ctx.font = "23px sans-serif";
  ctx.fillStyle = "#62716B";
  ctx.fillText(artistCredit ? `Art: ${artistCredit}` : "Art credit: pending", 88, 1191, 515);

  ctx.textAlign = "right";
  ctx.fillStyle = "#384A44";
  ctx.font = "bold 30px monospace";
  ctx.fillText(publicId, 810, 1191, 165);
  ctx.restore();

  return canvas.toBuffer("image/png");
}
