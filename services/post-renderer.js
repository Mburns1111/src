import { createCanvas, loadImage } from '@napi-rs/canvas';
import { DEFAULT_POST_STYLE, POST_LAYOUTS } from './post-layouts.js';

const MAX_TEXT_LINES_DEFAULT = 6;

/** Fetch a remote image to a Buffer before passing it to canvas. */
async function loadImageSource(source) {
  if (!source) return null;
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
    return loadImage(source);
  }
  if (typeof source === 'string') {
    if (/^https?:\/\//i.test(source)) {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
      return loadImage(Buffer.from(await response.arrayBuffer()));
    }
    return loadImage(source);
  }
  if (source.url) return loadImageSource(source.url);
  if (source.buffer) return loadImageSource(source.buffer);
  throw new TypeError('Image source must be a URL, path, Buffer, or { url } / { buffer }.');
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fillRoundedRect(ctx, x, y, width, height, radius, color) {
  roundedRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawCover(ctx, image, x, y, width, height, radius = 0) {
  if (!image) return false;
  ctx.save();
  if (radius > 0) {
    roundedRect(ctx, x, y, width, height, radius);
    ctx.clip();
  }
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sx = (image.width - sourceWidth) / 2;
  const sy = (image.height - sourceHeight) / 2;
  ctx.drawImage(image, sx, sy, sourceWidth, sourceHeight, x, y, width, height);
  ctx.restore();
  return true;
}

function fitFontSize(ctx, text, maxWidth, startingSize, family, minSize = 14) {
  let size = startingSize;
  while (size > minSize) {
    ctx.font = `${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 1;
  }
  return minSize;
}

function wrapText(ctx, text, maxWidth) {
  const paragraphs = String(text ?? '').split(/\r?\n/);
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawWrappedText(ctx, text, region, options = {}) {
  const {
    fontSize = 24,
    minFontSize = 16,
    family = 'sans-serif',
    color = '#26382D',
    lineHeight = Math.round(fontSize * 1.35),
    maxLines = MAX_TEXT_LINES_DEFAULT,
    align = 'left',
    verticalAlign = 'top',
  } = options;

  const raw = String(text ?? '').trim();
  if (!raw) return;

  let size = fontSize;
  let lines;
  while (size >= minFontSize) {
    ctx.font = `${size}px ${family}`;
    lines = wrapText(ctx, raw, region.width);
    if (lines.length <= maxLines && lines.length * Math.round(size * 1.35) <= region.height) break;
    size -= 1;
  }
  size = Math.max(size, minFontSize);
  ctx.font = `${size}px ${family}`;
  lines = wrapText(ctx, raw, region.width);
  const lineStep = Math.round(size * 1.35);
  const visibleLines = lines.slice(0, Math.max(1, Math.floor(region.height / lineStep)));
  if (lines.length > visibleLines.length && visibleLines.length) {
    let last = visibleLines[visibleLines.length - 1];
    while (last && ctx.measureText(`${last}…`).width > region.width) last = last.slice(0, -1);
    visibleLines[visibleLines.length - 1] = `${last.trimEnd()}…`;
  }

  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const x = align === 'center' ? region.x + region.width / 2 : align === 'right' ? region.x + region.width : region.x;
  let y = region.y;
  if (verticalAlign === 'middle') {
    y += Math.max(0, (region.height - visibleLines.length * lineStep) / 2);
  }
  visibleLines.forEach((line, index) => ctx.fillText(line, x, y + index * lineStep, region.width));
}

function drawLabel(ctx, text, region, style) {
  drawWrappedText(ctx, text.toUpperCase(), region, {
    fontSize: 18,
    minFontSize: 15,
    family: style.fontFamily,
    color: style.mutedText,
    maxLines: 1,
  });
}

function drawDefaultProfile(ctx, data, images, style, layout) {
  const r = layout.regions;
  const { width, height } = layout;

  // Background layer
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = style.panelAlt;
  ctx.beginPath();
  ctx.ellipse(width - 42, 26, 270, 185, -0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(35, height - 10, 210, 130, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // Main card and content panels
  fillRoundedRect(ctx, 32, 32, width - 64, height - 64, 34, style.panel);
  fillRoundedRect(ctx, 56, 56, 260, height - 112, 26, style.panelAlt);
  fillRoundedRect(ctx, 324, 56, width - 380, height - 112, 26, '#FFFFFF');

  // Accent stripe and small decorative marks
  fillRoundedRect(ctx, 324, 56, 12, height - 112, 6, style.accent);
  ctx.fillStyle = style.frame;
  ctx.beginPath();
  ctx.arc(width - 84, 84, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(width - 112, 84, 5, 0, Math.PI * 2);
  ctx.fill();

  // Avatar image with a clean ring. Avatar is optional, so render a placeholder.
  ctx.save();
  ctx.beginPath();
  ctx.arc(r.avatar.x + r.avatar.width / 2, r.avatar.y + r.avatar.height / 2, r.avatar.width / 2 + 7, 0, Math.PI * 2);
  ctx.fillStyle = style.accent;
  ctx.fill();
  ctx.restore();
  if (images.avatar) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(r.avatar.x + r.avatar.width / 2, r.avatar.y + r.avatar.height / 2, r.avatar.width / 2, 0, Math.PI * 2);
    ctx.clip();
    drawCover(ctx, images.avatar, r.avatar.x, r.avatar.y, r.avatar.width, r.avatar.height);
    ctx.restore();
  } else {
    ctx.fillStyle = style.panel;
    ctx.beginPath();
    ctx.arc(r.avatar.x + r.avatar.width / 2, r.avatar.y + r.avatar.height / 2, r.avatar.width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = style.accentDark;
    ctx.font = `bold 72px ${style.titleFontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(data.displayName || 'P').trim().charAt(0).toUpperCase(), r.avatar.x + r.avatar.width / 2, r.avatar.y + r.avatar.height / 2);
  }

  // Profile text
  const title = `${data.displayName || 'Member'}'s Profile`;
  const titleSize = fitFontSize(ctx, title, r.title.width, 46, style.titleFontFamily, 30);
  drawWrappedText(ctx, title, r.title, {
    fontSize: titleSize,
    minFontSize: 30,
    family: style.titleFontFamily,
    color: style.accentDark,
    maxLines: 1,
  });
  drawWrappedText(ctx, data.discordUsername ? `Discord: ${data.discordUsername}` : 'Member showcase', r.subtitle, {
    fontSize: 22,
    minFontSize: 17,
    family: style.fontFamily,
    color: style.mutedText,
    maxLines: 1,
  });

  drawLabel(ctx, 'Roblox username', r.usernameLabel, style);
  drawWrappedText(ctx, data.robloxUsername || 'Not added yet', r.username, {
    fontSize: 25, minFontSize: 18, family: style.fontFamily, color: style.text, maxLines: 2,
  });
  drawLabel(ctx, 'Looking for trades', r.tradeLabel, style);
  drawWrappedText(ctx, data.lookingForTrades ? 'Yes, interested!' : 'Not currently', r.tradeStatus, {
    fontSize: 22, minFontSize: 17, family: style.fontFamily, color: style.accentDark, maxLines: 2,
  });
  drawLabel(ctx, 'About me', r.bioLabel, style);
  drawWrappedText(ctx, data.bio || 'Add a bio to tell everyone a little about yourself.', r.bio, {
    fontSize: 24, minFontSize: 17, family: style.fontFamily, color: style.text, lineHeight: 34, maxLines: 6,
  });

  // Optional selected profile/album photo. A placeholder keeps the template balanced.
  fillRoundedRect(ctx, r.photo.x, r.photo.y, r.photo.width, r.photo.height, 18, style.panelAlt);
  if (images.photo) {
    drawCover(ctx, images.photo, r.photo.x, r.photo.y, r.photo.width, r.photo.height, 18);
  } else {
    ctx.fillStyle = style.mutedText;
    ctx.font = `20px ${style.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PROFILE PHOTO / ALBUM IMAGE', r.photo.x + r.photo.width / 2, r.photo.y + r.photo.height / 2);
  }

  drawWrappedText(ctx, data.footer || 'Made for the community', r.footer, {
    fontSize: 16, minFontSize: 13, family: style.fontFamily, color: style.mutedText, maxLines: 2,
  });

  // Frame is its own final layer so its color can be changed without moving content.
  ctx.strokeStyle = style.frame;
  ctx.lineWidth = 5;
  roundedRect(ctx, 32, 32, width - 64, height - 64, 34);
  ctx.stroke();
  ctx.strokeStyle = style.panelAlt;
  ctx.lineWidth = 2;
  roundedRect(ctx, 42, 42, width - 84, height - 84, 27);
  ctx.stroke();
}

/**
 * Render a post image as a PNG Buffer.
 *
 * @param {object} options
 * @param {'profile'} options.type Layout key. More layouts can be added to POST_LAYOUTS.
 * @param {object} options.data Text/data fields for the selected layout.
 * @param {object} [options.images] Optional avatar/photo image sources (URL, path, Buffer).
 * @param {object} [options.style] Optional overrides for DEFAULT_POST_STYLE.
 * @returns {Promise<Buffer>} PNG bytes suitable for Discord AttachmentBuilder.
 */
export async function renderPostImage({ type = 'profile', data = {}, images = {}, style = {} } = {}) {
  const layout = POST_LAYOUTS[type];
  if (!layout) throw new Error(`Unknown post layout: ${type}`);

  const resolvedStyle = { ...DEFAULT_POST_STYLE, ...style };
  const [avatar, photo] = await Promise.all([
    loadImageSource(images.avatar).catch((error) => {
      console.warn(`[post-renderer] Could not load avatar: ${error.message}`);
      return null;
    }),
    loadImageSource(images.photo).catch((error) => {
      console.warn(`[post-renderer] Could not load profile photo: ${error.message}`);
      return null;
    }),
  ]);

  const canvas = createCanvas(layout.width, layout.height);
  const ctx = canvas.getContext('2d');

  if (type === 'profile') drawDefaultProfile(ctx, data, { avatar, photo }, resolvedStyle, layout);
  else throw new Error(`Renderer implementation is missing for layout: ${type}`);

  return canvas.toBuffer('image/png');
}
