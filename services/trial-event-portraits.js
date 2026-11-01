import { createCanvas, loadImage } from "@napi-rs/canvas";

// Original in-bot artwork: dark gothic velvet, rose-pink filigree and thorns.
// These images are generated for every elimination; no external art assets.
export const TRIAL_IMAGE_WIDTH = 1000;
export const TRIAL_IMAGE_HEIGHT = 520;

function roundedRect(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function framedText(ctx, text, x, y, maxWidth, maxSize = 28) {
  const clean = String(text || "Unknown Courtier").replace(/[\r\n\t]/g, " ").slice(0, 65);
  let size = maxSize;
  do {
    ctx.font = "bold " + size + "px sans-serif";
    if (ctx.measureText(clean).width <= maxWidth || size <= 15) break;
    size -= 1;
  } while (size > 15);
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff0f6";
  ctx.shadowBlur = 7;
  ctx.shadowColor = "#170812";
  ctx.fillText(clean, x, y, maxWidth);
  ctx.shadowBlur = 0;
}

function thorn(ctx, x, y, a, size = 13) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(size / 2, -size * 0.35, size, -size * 0.95);
  ctx.quadraticCurveTo(size * 0.22, -size * 0.4, 0, 0);
  ctx.fillStyle = "#d896b7";
  ctx.fill();
  ctx.restore();
}

function rose(ctx, x, y, radius = 20) {
  ctx.save();
  ctx.translate(x, y);
  for (let p = 0; p < 5; p++) {
    ctx.save();
    ctx.rotate(p * Math.PI * 2 / 5);
    const petal = ctx.createLinearGradient(0, -radius, 0, radius);
    petal.addColorStop(0, "#f2b8ce");
    petal.addColorStop(1, "#934367");
    ctx.fillStyle = petal;
    ctx.beginPath();
    ctx.ellipse(0, -radius * 0.46, radius * 0.53, radius * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = "#6e284e";
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f8cadd";
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.2, -Math.PI * .4, Math.PI * 1.5);
  ctx.stroke();
  ctx.restore();
}

function floweringVine(ctx, left, y, direction = 1) {
  ctx.save();
  ctx.translate(left, y);
  ctx.scale(direction, 1);
  ctx.strokeStyle = "#b67a9a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(56, -36, 142, -25, 228, -3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(64, -22);
  ctx.quadraticCurveTo(75, -70, 110, -56);
  ctx.moveTo(145, -19);
  ctx.quadraticCurveTo(157, 22, 185, 24);
  ctx.stroke();
  for (const [x, by, angle] of [[35,-12,-1.3],[91,-28,1.7],[150,-13,-1.2],[194,-3,1.2]]) {
    thorn(ctx, x, by, angle, 16);
  }
  rose(ctx, 103, -53, 13);
  rose(ctx, 187, 24, 10);
  ctx.restore();
}

function gothicBackdrop(ctx, w, h) {
  const fill = ctx.createLinearGradient(0, 0, w, h);
  fill.addColorStop(0, "#1e1021");
  fill.addColorStop(0.47, "#432039");
  fill.addColorStop(1, "#170b1b");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w/2, h/2, 20, w/2, h/2, 530);
  glow.addColorStop(0, "rgba(213,116,166,0.26)");
  glow.addColorStop(1, "rgba(20,5,21,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Fine inner/outer pink borders, pointed gothic arch and corner roses.
  ctx.strokeStyle = "#c38aa5";
  ctx.lineWidth = 6;
  roundedRect(ctx, 14, 14, w - 28, h - 28, 22);
  ctx.stroke();
  ctx.strokeStyle = "#efc6d7";
  ctx.lineWidth = 1.5;
  roundedRect(ctx, 28, 28, w - 56, h - 56, 16);
  ctx.stroke();

  ctx.strokeStyle = "rgba(238,166,199,0.19)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(355, 470);
  ctx.lineTo(355, 165);
  ctx.quadraticCurveTo(355, 104, w / 2, 70);
  ctx.quadraticCurveTo(645, 104, 645, 165);
  ctx.lineTo(645, 470);
  ctx.stroke();
  floweringVine(ctx, 43, 478, 1);
  floweringVine(ctx, w - 43, 478, -1);
  rose(ctx, 53, 53, 16);
  rose(ctx, w - 53, 53, 16);
  thorn(ctx, 45, 220, 0.25, 19);
  thorn(ctx, w - 45, 220, 2.8, 19);
}

function avatarMedallion(ctx, image, x, y, size, label, name) {
  const centerX = x + size / 2, centerY = y + size / 2;
  // Medallion shadow, outer gold/pink ring and inset image or fallback.
  ctx.save();
  ctx.shadowBlur = 24;
  ctx.shadowColor = "rgba(3, 0, 8, 0.75)";
  ctx.fillStyle = "#110b19";
  ctx.beginPath();
  ctx.arc(centerX, centerY, size / 2 + 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#e5b8ca";
  ctx.beginPath();
  ctx.arc(centerX, centerY, size / 2 + 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#763b5e";
  ctx.beginPath();
  ctx.arc(centerX, centerY, size / 2 + 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (image) {
    const scale = Math.max(size / image.width, size / image.height);
    const sw = image.width * scale, sh = image.height * scale;
    ctx.drawImage(image, centerX - sw / 2, centerY - sh / 2, sw, sh);
  } else {
    const grad = ctx.createLinearGradient(x, y, x+size, y+size);
    grad.addColorStop(0, "#9e577a");
    grad.addColorStop(1, "#48213f");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = "#f7d4e2";
    ctx.font = "bold 100px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("♛", centerX, centerY + 36);
  }
  ctx.restore();

  // The medallion name plate and status banner are readable in small Discord embeds.
  ctx.fillStyle = "rgba(23, 10, 25, 0.87)";
  roundedRect(ctx, centerX - 166, y + size + 24, 332, 54, 12);
  ctx.fill();
  ctx.strokeStyle = "#d6a0bd";
  ctx.lineWidth = 1.5;
  roundedRect(ctx, centerX - 166, y + size + 24, 332, 54, 12);
  ctx.stroke();
  framedText(ctx, name, centerX, y + size + 60, 310, 27);
  ctx.font = "bold 19px sans-serif";
  ctx.fillStyle = "#f2b8d4";
  ctx.textAlign = "center";
  ctx.fillText(label, centerX, y - 32);
}

function centerEmblem(ctx, duel) {
  ctx.save();
  ctx.translate(500, 252);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "rgba(29, 8, 29, 0.96)";
  ctx.strokeStyle = "#ddaac3";
  ctx.lineWidth = 4;
  ctx.fillRect(-62, -62, 124, 124);
  ctx.strokeRect(-62, -62, 124, 124);
  ctx.restore();
  ctx.font = duel ? "bold 67px sans-serif" : "bold 59px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff0f7";
  ctx.shadowColor = "#170816";
  ctx.shadowBlur = 12;
  ctx.fillText(duel ? "VS" : "✦", 500, 273);
  ctx.shadowBlur = 0;
}

export function renderTrialEventPortrait(event, participants = {}) {
  const w = TRIAL_IMAGE_WIDTH, h = TRIAL_IMAGE_HEIGHT;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  gothicBackdrop(ctx, w, h);
  const duel = Boolean(event.actorId);

  ctx.font = "bold 27px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#f0bfd1";
  ctx.fillText(duel ? "♛  A DUEL BEFORE THE COURT  ♛" : "♛  THE COURT HAS CLAIMED ANOTHER  ♛", w/2, 71);

  if (duel) {
    avatarMedallion(ctx, participants.actor?.image, 120, 151, 214,
      "THE CHALLENGER", participants.actor?.name || "Court Challenger");
    avatarMedallion(ctx, participants.victim?.image, 666, 151, 214,
      "THE FALLEN", participants.victim?.name || "Court Contestant");
    centerEmblem(ctx, true);
    ctx.textAlign = "center";
    ctx.font = "italic 19px sans-serif";
    ctx.fillStyle = "#e9b8cc";
    ctx.fillText("BLOOD • ROSES • THE ROYAL VERDICT", 500, 473);
  } else {
    // Solo demise deliberately has one larger portrait, keeping the same
    // visual rhythm and ornate border as the duel card.
    avatarMedallion(ctx, participants.victim?.image, 389, 142, 222,
      "BANISHED FROM THE COURT", participants.victim?.name || "Fallen Courtier");
    rose(ctx, 290, 245, 29);
    rose(ctx, 710, 245, 29);
    ctx.font = "italic 21px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#e9b8cc";
    ctx.fillText("ONE MORE CANDLE EXTINGUISHED", 500, 471);
  }
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
    // Keep the event visual with a royal silhouette when a Discord avatar is
    // missing, rate-limited or inaccessible. The match still proceeds.
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
