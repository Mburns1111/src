import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderCollectibleCardPreview, CARD_PREVIEW_SIZE } from "./card-preview-renderer.js";
import { loadImageSource } from "./post-renderer.js";

// The release banner is not part of any individual card. It is a distinct
// horizontal strip above the three-card composite.
export const CARD_DROP_IMAGE_SIZE = Object.freeze({ width: 1920, height: 1510 });
const MARGIN = 46;
const BANNER = { x: MARGIN, y: 36, w: 1828, h: 600 };
const CARD_WIDTH = 548;
const CARD_HEIGHT = Math.round(CARD_WIDTH * CARD_PREVIEW_SIZE.height / CARD_PREVIEW_SIZE.width);
const CARD_TOP = 670;
const CARD_LEFTS = [86, 686, 1286];

function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function fit(ctx, value, maxWidth, size, min = 27) {
  let fontSize = size;
  while (fontSize > min) {
    ctx.font = `bold ${fontSize}px sans-serif`;
    if (ctx.measureText(value).width <= maxWidth) break;
    fontSize -= 2;
  }
  return fontSize;
}
// The egg banner is an independent image. Do not crop its eggs or title.
function contain(ctx, image, x, y, w, h) {
  const scale = Math.min(w / image.width, h / image.height);
  const iw = image.width * scale, ih = image.height * scale;
  ctx.drawImage(image, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

function cover(ctx, image, x, y, w, h) {
  const scale = Math.max(w / image.width, h / image.height);
  const iw = image.width * scale, ih = image.height * scale;
  ctx.drawImage(image, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

export async function renderThreeCardDropImage({
  releaseName = "Release 1",
  seriesName = "Series 1",
  eggImageUrl = "",
  cards,
} = {}) {
  if (!Array.isArray(cards) || cards.length !== 3) {
    throw new Error("A collectible drop must contain exactly three cards.");
  }
  // Approved artist artwork must always display a credit in the drop.
  // Placeholder illustrations may display a clearly labeled placeholder credit.
  for (const card of cards) {
    if (card.artStatus === "approved" && !String(card.artistCredit || "").trim()) {
      throw new Error(`Artist credit is required before approved card art can drop: ${card.petName || "unknown pet"}`);
    }
  }
  const { width: W, height: H } = CARD_DROP_IMAGE_SIZE;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FAF6FC";
  ctx.fillRect(0, 0, W, H);

  // Release banner remains separate from the card graphics.
  ctx.save();
  rounded(ctx, BANNER.x, BANNER.y, BANNER.w, BANNER.h, 30);
  ctx.clip();
  const gradient = ctx.createLinearGradient(0, BANNER.y, W, BANNER.y + BANNER.h);
  gradient.addColorStop(0, "#E9D7F0");
  gradient.addColorStop(.5, "#FFFFFF");
  gradient.addColorStop(1, "#E7D8EE");
  ctx.fillStyle = gradient;
  ctx.fillRect(BANNER.x, BANNER.y, BANNER.w, BANNER.h);
  let image;
  if (eggImageUrl) {
    try { image = await loadImageSource(eggImageUrl); }
    catch (error) { console.warn("[Cards] Egg banner unavailable:", error.message); }
  }
  if (image) {
    contain(ctx, image, BANNER.x, BANNER.y, BANNER.w, BANNER.h);
  } else {
    // A deliberate text-only banner fallback, not an invented egg illustration.
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    fit(ctx, `${releaseName} Egg`, BANNER.w - 100, 102);
    ctx.fillStyle = "#76548B";
    ctx.fillText(`${releaseName} Egg`, W / 2, BANNER.y + BANNER.h / 2);
  }
  ctx.restore();

  const images = await Promise.all(cards.map(async card => loadImage(await renderCollectibleCardPreview({
    petName: card.petName,
    rarity: card.rarity,
    upgradeLevel: "normal",
    releaseName,
    seriesName,
    artStatus: card.artStatus,
    artUrl: card.artUrl,
    artistCredit: card.artistCredit,
    dropMode: true,
  }))));
  for (let i = 0; i < 3; i++) {
    const x = CARD_LEFTS[i];
    ctx.drawImage(images[i], x, CARD_TOP, CARD_WIDTH, CARD_HEIGHT);
    // Position numbers correspond exactly with Grab #1/#2/#3.
    ctx.save();
    ctx.fillStyle = "#FFFFFF";
    ctx.strokeStyle = "#8661B7";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x + CARD_WIDTH / 2, CARD_TOP + CARD_HEIGHT + 28, 28, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#56446D";
    ctx.font = "bold 31px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), x + CARD_WIDTH / 2, CARD_TOP + CARD_HEIGHT + 28);
    ctx.restore();
  }
  return canvas.toBuffer("image/png");
}
