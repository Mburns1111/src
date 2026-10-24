import { STICKER_CATALOG, stickerDefaults } from "./sticker-catalog.js";

// All artwork is drawn locally at any scale; no pre-colored PNGs or external
// assets. Member-set HEX colors are validated before reaching this renderer.
function inkFor(hex) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
  const lightness = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return lightness < 0.23 ? "#F9F7F3" : "#333039";
}

function starPath(ctx, points, outer, inner, start = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = start + i * Math.PI / points;
    const r = i % 2 ? inner : outer;
    if (!i) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}

function shape(ctx, fill, stroke, width = 3) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

export function drawStickerArtwork(ctx, input, size) {
  const item = STICKER_CATALOG[input?.id];
  if (!item) return false;
  const sticker = { ...stickerDefaults(input.id), ...input };
  const main = sticker.color;
  const accent = item.colors === 2 ? sticker.accentColor : null;
  const stroke = sticker.outline === "none" ? null :
    sticker.outline === "black" ? "#181820" :
      sticker.outline === "white" ? "#FFFFFF" : inkFor(main);
  const S = Math.max(1, size / 100);

  ctx.save();
  ctx.scale(S, S);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  switch (sticker.id) {
    case "heart":
      ctx.beginPath();
      ctx.moveTo(0, 42);
      ctx.bezierCurveTo(-14, 29, -46, 8, -46, -18);
      ctx.bezierCurveTo(-46, -47, -13, -49, 0, -27);
      ctx.bezierCurveTo(13, -49, 46, -47, 46, -18);
      ctx.bezierCurveTo(46, 8, 14, 29, 0, 42);
      ctx.closePath();
      shape(ctx, main, stroke, 3.7);
      break;
    case "star":
      starPath(ctx, 5, 44, 20);
      shape(ctx, main, stroke, 3.4);
      break;
    case "flower": // Daisy: old Flower sticker ID remains valid
      for (let i = 0; i < 8; i++) {
        ctx.save();
        ctx.rotate(i * Math.PI / 4);
        ctx.beginPath();
        ctx.ellipse(0, -27, 13.5, 22, 0, 0, Math.PI * 2);
        shape(ctx, main, stroke, 2.4);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      shape(ctx, accent, stroke, 2.5);
      break;
    case "crescent":
      // Use a genuine filled crescent path (not an eraser or a background-colored
      // cutout), so it works with patterned, translucent, and photo backgrounds.
      ctx.beginPath();
      ctx.moveTo(6, -46);
      ctx.bezierCurveTo(-48, -43, -56, 28, -7, 45);
      ctx.bezierCurveTo(18, 52, 42, 39, 47, 16);
      ctx.bezierCurveTo(24, 27, -10, 16, -10, -12);
      ctx.bezierCurveTo(-10, -31, -2, -40, 6, -46);
      ctx.closePath();
      shape(ctx, main, stroke, 3.2);
      break;
    case "sparkle":
      starPath(ctx, 4, 46, 10);
      shape(ctx, main, stroke, 3.3);
      ctx.save();
      ctx.translate(35, -28);
      starPath(ctx, 4, 12, 3);
      shape(ctx, main, stroke, 2.6);
      ctx.restore();
      ctx.save();
      ctx.translate(-38, 25);
      starPath(ctx, 4, 8, 2);
      shape(ctx, main, stroke, 2.6);
      ctx.restore();
      break;
    case "spookyBat":
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(-13, -25);
      ctx.lineTo(-15, -12);
      ctx.bezierCurveTo(-28, -30, -43, -29, -50, -20);
      ctx.bezierCurveTo(-40, -13, -39, -1, -42, 14);
      ctx.bezierCurveTo(-25, 5, -19, 22, -16, 31);
      ctx.bezierCurveTo(-9, 22, -5, 25, 0, 37);
      ctx.bezierCurveTo(5, 25, 9, 22, 16, 31);
      ctx.bezierCurveTo(19, 22, 25, 5, 42, 14);
      ctx.bezierCurveTo(39, -1, 40, -13, 50, -20);
      ctx.bezierCurveTo(43, -29, 28, -30, 15, -12);
      ctx.lineTo(13, -25);
      ctx.closePath();
      shape(ctx, main, stroke, 3.2);
      break;
    case "littleGhost":
      ctx.beginPath();
      ctx.moveTo(-39, 37);
      ctx.lineTo(-39, -5);
      ctx.bezierCurveTo(-39, -57, 39, -57, 39, -5);
      ctx.lineTo(39, 37);
      ctx.quadraticCurveTo(29, 48, 20, 34);
      ctx.quadraticCurveTo(10, 52, 0, 35);
      ctx.quadraticCurveTo(-11, 52, -21, 34);
      ctx.quadraticCurveTo(-32, 50, -39, 37);
      ctx.closePath();
      shape(ctx, main, stroke, 3.2);
      ctx.fillStyle = accent;
      for (const x of [-13, 13]) {
        ctx.beginPath();
        ctx.ellipse(x, -10, 5, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.ellipse(0, 12, 5.5, 7.5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "pumpkinPatch":
      // Orange outer pumpkin lobes share the member's main color. The stem
      // and leaf use the independently recolorable accent.
      for (const [x, w] of [[-25, 23], [25, 23], [0, 30]]) {
        ctx.beginPath();
        ctx.ellipse(x, 7, w, 34, 0, 0, Math.PI * 2);
        shape(ctx, main, stroke, 2.5);
      }
      ctx.beginPath();
      ctx.moveTo(-5, -25);
      ctx.lineTo(-5, -42);
      ctx.quadraticCurveTo(5, -51, 11, -39);
      ctx.lineTo(7, -24);
      ctx.closePath();
      shape(ctx, accent, stroke, 2.5);
      ctx.beginPath();
      ctx.moveTo(5, -35);
      ctx.quadraticCurveTo(22, -52, 38, -36);
      ctx.quadraticCurveTo(25, -24, 5, -35);
      shape(ctx, accent, stroke, 2);
      break;
    default:
      ctx.restore();
      return false;
  }
  ctx.restore();
  return true;
}
