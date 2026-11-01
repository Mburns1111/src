import { createCanvas, loadImage } from "@napi-rs/canvas";

// The Cryptic Court: original vector artwork drawn at render time.
// Blackened castle stone, lancet windows, iron thorns and antique rose-gold.
// No clip-art flowers, external illustrations, or image generation API needed.
export const TRIAL_IMAGE_WIDTH = 1000;
export const TRIAL_IMAGE_HEIGHT = 520;

const INK = "#0e0c12";
const IVORY = "#eee1d5";
const GOLD = "#b29a79";
const ROSE = "#ac647e";
const ASH = "#bdb0aa";

function line(ctx, fromX, fromY, toX, toY, color = GOLD, width = 2) {
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function label(ctx, value, x, y, maxWidth, maxSize, color = IVORY, family = "Georgia, serif") {
  const str = String(value || "UNKNOWN COURTIER").replace(/[\r\n\t]/g, " ").slice(0, 75);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let size = maxSize;
  while (size > 16) {
    ctx.font = "bold " + size + "px " + family;
    if (ctx.measureText(str).width <= maxWidth) break;
    size -= 1;
  }
  ctx.fillStyle = color;
  ctx.shadowColor = INK;
  ctx.shadowBlur = 5;
  ctx.fillText(str, x, y, maxWidth);
  ctx.restore();
}

function diamond(ctx, x, y, radius = 7, color = GOLD) {
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + radius * 0.6, y);
  ctx.lineTo(x, y + radius);
  ctx.lineTo(x - radius * 0.6, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function crown(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3;
  ctx.fillStyle = "#241a22";
  ctx.beginPath();
  ctx.moveTo(-27, 16);
  ctx.lineTo(-34, -12);
  ctx.lineTo(-13, 0);
  ctx.lineTo(0, -22);
  ctx.lineTo(13, 0);
  ctx.lineTo(34, -12);
  ctx.lineTo(27, 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  line(ctx, -27, 20, 27, 20, GOLD, 3);
  for (const [px,py] of [[-34,-12],[0,-22],[34,-12]]) diamond(ctx, px, py, 5, ROSE);
  ctx.restore();
}

function pathArch(ctx, x, y, width, height) {
  // Tall pointed Gothic doorway. The two curves meet at one sharp crown.
  const shoulder = y + width * 0.38;
  ctx.beginPath();
  ctx.moveTo(x, y + height);
  ctx.lineTo(x, shoulder);
  ctx.bezierCurveTo(x + 2, y + width * 0.20, x + width * 0.25, y + width * 0.09,
    x + width / 2, y);
  ctx.bezierCurveTo(x + width * 0.75, y + width * 0.09, x + width - 2, y + width * 0.20,
    x + width, shoulder);
  ctx.lineTo(x + width, y + height);
  ctx.closePath();
}

function darkStone(ctx) {
  const w = TRIAL_IMAGE_WIDTH, h = TRIAL_IMAGE_HEIGHT;
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#111016");
  grad.addColorStop(0.5, "#2a1b29");
  grad.addColorStop(1, "#100e17");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Very subdued stone coursing and a dark architectural arcade.
  ctx.strokeStyle = "rgba(193,164,153,.065)";
  ctx.lineWidth = 1;
  for (let y = 52; y < h; y += 57) {
    line(ctx, 0, y, w, y, "rgba(194,163,158,.06)", 1);
    for (let x = ((Math.floor(y / 57) % 2) ? 47 : 0); x < w; x += 136)
      line(ctx, x, y, x, y + 57, "rgba(194,163,158,.05)", 1);
  }
  for (const [x, width] of [[-120, 310], [810, 310]]) {
    pathArch(ctx, x, 55, width, 480);
    ctx.fillStyle = "rgba(5,5,11,.22)";
    ctx.fill();
    ctx.strokeStyle = "rgba(165,115,130,.13)";
    ctx.lineWidth = 7;
    ctx.stroke();
  }
  const shade = ctx.createRadialGradient(w / 2, 230, 0, w / 2, 260, 720);
  shade.addColorStop(0, "rgba(101,48,73,.24)");
  shade.addColorStop(.6, "rgba(29,19,32,.05)");
  shade.addColorStop(1, "rgba(0,0,0,.55)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
}

// Thorn branches are sharp, tapered and botanical rather than five-petal
// icon flowers; they stay faint enough to be background details at 400px.
function ironThorns(ctx, startX, startY, direction = 1) {
  ctx.save();
  ctx.translate(startX, startY);
  ctx.scale(direction, 1);
  ctx.strokeStyle = "rgba(161,103,120,.75)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(55, -44, 102, -57, 177, -54);
  ctx.stroke();
  for (const [px,py,rot] of [[29,-22,-.65],[62,-39,.85],[103,-51,-.95],[143,-57,.7]]) {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(9, -23);
    ctx.lineTo(8, 1);
    ctx.closePath();
    ctx.fillStyle = "#8c4e66";
    ctx.fill();
    ctx.restore();
  }
  // A narrow leaf, never a round flower.
  ctx.fillStyle = "rgba(114,86,97,.8)";
  ctx.beginPath();
  ctx.moveTo(86, -46);
  ctx.quadraticCurveTo(92, -81, 115, -75);
  ctx.quadraticCurveTo(113, -49, 86, -46);
  ctx.fill();
  ctx.restore();
}

function border(ctx) {
  const w = TRIAL_IMAGE_WIDTH, h = TRIAL_IMAGE_HEIGHT;
  ctx.fillStyle = "rgba(4,4,8,.5)";
  ctx.fillRect(0, 0, w, 110);
  ctx.fillRect(0, 484, w, h - 484);
  ctx.strokeStyle = "#65515b";
  ctx.lineWidth = 9;
  ctx.strokeRect(15, 15, w - 30, h - 30);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, w - 48, h - 48);
  ctx.strokeStyle = "#653d50";
  ctx.lineWidth = 2;
  ctx.strokeRect(32, 32, w - 64, h - 64);

  // Ironwork corners: simple engraved lines, not stickers.
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    ctx.save();
    ctx.translate(sx === 1 ? 44 : w - 44, sy === 1 ? 44 : h - 44);
    ctx.scale(sx, sy);
    line(ctx, 0, 0, 77, 0, ROSE, 3);
    line(ctx, 0, 0, 0, 72, ROSE, 3);
    diamond(ctx, 84, 0, 5);
    diamond(ctx, 0, 80, 5);
    ctx.restore();
  }
  ironThorns(ctx, 50, 445, 1);
  ironThorns(ctx, w - 50, 445, -1);

  crown(ctx, 500, 62, 0.65);
  line(ctx, 310, 70, 463, 70, "#66515b", 2);
  line(ctx, 537, 70, 690, 70, "#66515b", 2);
  label(ctx, "THE CRYPTIC COURT", 500, 105, 610, 35, IVORY);
}

function coverImage(ctx, image, x, y, w, h) {
  const scale = Math.max(w / image.width, h / image.height);
  const imgW = image.width * scale, imgH = image.height * scale;
  ctx.drawImage(image, x + (w - imgW)/2, y + (h - imgH)/2, imgW, imgH);
}

function portraitArch(ctx, image, x, y, width, height, { fallen = false } = {}) {
  // Cast-iron and antique-gold doorway, with a photo clipped to the same arch.
  ctx.save();
  ctx.shadowBlur = 22;
  ctx.shadowColor = "#000000";
  pathArch(ctx, x - 12, y - 12, width + 24, height + 24);
  ctx.fillStyle = "#080911";
  ctx.fill();
  ctx.restore();

  pathArch(ctx, x - 10, y - 10, width + 20, height + 20);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 6;
  ctx.stroke();
  pathArch(ctx, x - 5, y - 5, width + 10, height + 10);
  ctx.strokeStyle = fallen ? "#86445b" : "#9b7882";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.save();
  pathArch(ctx, x, y, width, height);
  ctx.clip();
  if (image) coverImage(ctx, image, x, y, width, height);
  else {
    const fill = ctx.createLinearGradient(x, y, x + width, y + height);
    fill.addColorStop(0, "#65505b");
    fill.addColorStop(1, "#1c1a25");
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, width, height);
    // Gothic placeholder silhouette: head + shoulders, not an emoji.
    ctx.fillStyle = "rgba(9,10,19,.75)";
    ctx.beginPath();
    ctx.arc(x + width/2, y + height*.43, width*.16, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + width/2, y + height*.95, width*.36, height*.34, 0, 0, Math.PI*2);
    ctx.fill();
  }
  const shadow = ctx.createLinearGradient(x, y + height*.54, x, y + height);
  shadow.addColorStop(0, "rgba(9,7,13,0)");
  shadow.addColorStop(1, "rgba(6,5,10,.65)");
  ctx.fillStyle = shadow;
  ctx.fillRect(x, y, width, height);
  ctx.restore();

  pathArch(ctx, x, y, width, height);
  ctx.strokeStyle = "#2a1a25";
  ctx.lineWidth = 5;
  ctx.stroke();
  // Vertical iron mullions flanking the portrait.
  line(ctx, x - 17, y + 102, x - 17, y + height + 7, "#563f4d", 3);
  line(ctx, x + width + 17, y + 102, x + width + 17, y + height + 7, "#563f4d", 3);
  diamond(ctx, x + width/2, y - 18, 7, ROSE);
}

function namePlate(ctx, name, centerX, topY, width, { fallen = false } = {}) {
  ctx.fillStyle = "rgba(8,8,14,.94)";
  ctx.fillRect(centerX - width/2, topY, width, 53);
  line(ctx, centerX - width/2, topY + 3, centerX + width/2, topY + 3, GOLD, 2);
  line(ctx, centerX - width/2, topY + 50, centerX + width/2, topY + 50, "#735361", 1);
  diamond(ctx, centerX - width/2 + 14, topY + 27, 6, ROSE);
  diamond(ctx, centerX + width/2 - 14, topY + 27, 6, ROSE);
  label(ctx, name, centerX, topY + 38, width - 55, 33, fallen ? "#eed5d9" : IVORY);
}

function soloScene(ctx, participants) {
  // Oversize portrait (more than 1/3 of the image) and a bold, readable decree.
  portraitArch(ctx, participants.victim?.image, 80, 145, 365, 288, { fallen: true });
  namePlate(ctx, participants.victim?.name || "Unknown Courtier", 262, 436, 380, { fallen: true });

  const textX = 718;
  diamond(ctx, textX, 182, 9, ROSE);
  label(ctx, "THE ROYAL VERDICT", textX, 224, 485, 27, ASH);
  line(ctx, 535, 244, 900, 244, "#9e7984", 2);
  label(ctx, "FALLEN", textX, 331, 475, 79, "#ead0d6");
  label(ctx, "ONE CANDLE EXTINGUISHED", textX, 388, 460, 22, GOLD);
  line(ctx, 535, 407, 900, 407, "#9e7984", 2);
  diamond(ctx, textX, 426, 7, ROSE);
}

function duelScene(ctx, participants) {
  const left = 80, right = 647, y = 150, archW = 273, archH = 269;
  portraitArch(ctx, participants.actor?.image, left, y, archW, archH);
  portraitArch(ctx, participants.victim?.image, right, y, archW, archH, { fallen: true });

  label(ctx, "SURVIVED", left + archW/2, 144, 310, 24, GOLD);
  label(ctx, "ELIMINATED", right + archW/2, 144, 310, 24, "#d797a9");

  // A narrow wrought-iron blade is the centre divider, not a playful VS badge.
  const blade = ctx.createLinearGradient(470, 0, 530, 0);
  blade.addColorStop(0, "#4c4149");
  blade.addColorStop(.5, "#c7b5a0");
  blade.addColorStop(1, "#4c4149");
  ctx.fillStyle = blade;
  ctx.beginPath();
  ctx.moveTo(500, 153);
  ctx.lineTo(508, 186);
  ctx.lineTo(508, 369);
  ctx.lineTo(500, 399);
  ctx.lineTo(492, 369);
  ctx.lineTo(492, 186);
  ctx.closePath();
  ctx.fill();
  line(ctx, 480, 187, 520, 187, GOLD, 7);
  diamond(ctx, 500, 166, 11, ROSE);
  ctx.fillStyle = "#170f1a";
  ctx.fillRect(451, 242, 98, 75);
  ctx.strokeStyle = "#af8b8d";
  ctx.lineWidth = 2;
  ctx.strokeRect(453, 244, 94, 71);
  label(ctx, "VS", 500, 298, 87, 56, IVORY);

  namePlate(ctx, participants.actor?.name || "Court Challenger", left + archW/2, 436, 316);
  namePlate(ctx, participants.victim?.name || "Fallen Courtier", right + archW/2, 436, 316, { fallen: true });
}

export function renderTrialEventPortrait(event, participants = {}) {
  const canvas = createCanvas(TRIAL_IMAGE_WIDTH, TRIAL_IMAGE_HEIGHT);
  const ctx = canvas.getContext("2d");
  darkStone(ctx);
  border(ctx);
  if (event.actorId) duelScene(ctx, participants);
  else soloScene(ctx, participants);
  return canvas.toBuffer("image/png");
}

async function discordParticipant(client, id) {
  const user = await client.users?.fetch?.(id).catch(() => null);
  if (!user) return { name: "Courtier " + String(id).slice(-4), image: null };
  const name = user.globalName || user.username || "Courtier " + String(id).slice(-4);
  let image = null;
  try {
    const url = user.displayAvatarURL({ extension: "png", size: 256, forceStatic: true });
    const response = await fetch(url, { signal: AbortSignal.timeout(5500) });
    if (!response.ok) throw Error("Avatar download failed");
    const array = await response.arrayBuffer();
    if (array.byteLength > 2_000_000) throw Error("Avatar exceeds size limit");
    image = await loadImage(Buffer.from(array));
  } catch {
    // Use a silhouette if an avatar is missing or inaccessible.
  }
  return { name, image };
}

export async function buildTrialEventPortrait(client, event) {
  const [victim, actor] = await Promise.all([
    discordParticipant(client, event.victimId),
    event.actorId ? discordParticipant(client, event.actorId) : Promise.resolve(null),
  ]);
  return renderTrialEventPortrait(event, { victim, actor });
}
