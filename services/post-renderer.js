
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_POST_STYLE, POST_LAYOUTS } from './post-layouts.js';
import { APPEARANCE_CATALOG, appearanceCatalogItem, resolveAppearance } from './post-appearance.js';
import { registerAppearanceFonts, withUnicodeFallback } from './font-library.js';
import { frameArtworkSvg } from './frame-artwork.js';
import { drawStickerArtwork } from './sticker-artwork.js';
import { readDiscordAttachment } from './media-transfer.js';
import { assertImageSafeToDecode } from './image-dimensions.js';

// Register a Unicode symbol font for decorative display names.
// Downloaded once per process, with graceful fallback when offline.
let symbolFontPromise;
async function ensureSymbolFont() {
  if (!symbolFontPromise) {
    symbolFontPromise = (async () => {
      try {
        const url = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssymbols2/NotoSansSymbols2-Regular.ttf';
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const folder = join(tmpdir(), 'am-bot-fonts');
        await mkdir(folder, { recursive: true });
        const path = join(folder, 'NotoSansSymbols2-Regular.ttf');
        await writeFile(path, Buffer.from(await response.arrayBuffer()));
        if (!GlobalFonts.registerFromPath(path, 'AM Unicode Symbols')) {
          throw new Error('Font registration failed');
        }
      } catch (error) {
        console.warn('Optional decorative font unavailable:', error.message);
      }
    })();
  }
  return symbolFontPromise;
}

// A code-unit charAt(0) breaks surrogate-pair names (e.g. 𝓛 or emoji).
function firstDisplayGrapheme(value) {
  const parts = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(String(value || 'P').trim());
  return Array.from(parts, part => part.segment).find(part => part.trim()) || 'P';
}

const MAX_TEXT_LINES_DEFAULT = 6;

// Rendering an approved local vector overlay is much cheaper after the first
// request. Cache the decoded image across the public storefront, individual
// previews, Mix & Match, and the equipped profile card. No external requests.
const frameArtworkCache = new Map();
async function frameOverlayImage(frameId) {
  const item = APPEARANCE_CATALOG.frames[frameId];
  if (item?.kind !== 'artwork') return null;
  if (!frameArtworkCache.has(frameId)) {
    const task = loadImage(Buffer.from(frameArtworkSvg(item.artwork), 'utf8'))
      .catch(error => {
        frameArtworkCache.delete(frameId);
        console.warn('[post-renderer] Frame artwork unavailable:', frameId, error.message);
        return null;
      });
    frameArtworkCache.set(frameId, task);
  }
  return frameArtworkCache.get(frameId);
}

/** Fetch a remote image to a Buffer before passing it to canvas. */
export async function loadImageSource(source) {
  if (!source) return null;

  if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
    const bytes = Buffer.from(source);
    // Stored profile/gallery images can be small on disk but enormous once
    // decoded. Check the header before native Canvas allocates the bitmap.
    assertImageSafeToDecode(bytes);
    return loadImage(bytes);
  }

  if (typeof source === 'string') {
    if (/^https?:\/\//i.test(source)) {
      const bytes = await readDiscordAttachment(source, {
        maxBytes: 12 * 1024 * 1024,
        timeoutMs: 15_000,
      });
      assertImageSafeToDecode(bytes);
      return loadImage(bytes);
    }

    return loadImage(source);
  }

  if (source.url) return loadImageSource(source.url);
  if (source.buffer) return loadImageSource(source.buffer);

  throw new TypeError(
    'Image source must be a URL, path, Buffer, or { url } / { buffer }.'
  );
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

  const scale = Math.max(
    width / image.width,
    height / image.height
  );

  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sx = (image.width - sourceWidth) / 2;
  const sy = (image.height - sourceHeight) / 2;

  ctx.drawImage(
    image,
    sx,
    sy,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height
  );

  ctx.restore();
  return true;
}

function drawContain(ctx, image, x, y, width, height, radius = 0) {
  if (!image) return false;

  ctx.save();

  if (radius > 0) {
    roundedRect(ctx, x, y, width, height, radius);
    ctx.clip();
  }

  const scale = Math.min(
    width / image.width,
    height / image.height
  );

  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;

  ctx.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight
  );

  ctx.restore();
  return true;
}

function fitFontSize(ctx, text, maxWidth, startingSize, family, minSize = 14) {
  let size = startingSize;

  while (size > minSize) {
    ctx.font = `${size}px ${family}`;

    if (ctx.measureText(text).width <= maxWidth) {
      return size;
    }

    size -= 1;
  }

  return minSize;
}

function drawFittedLine(ctx, value, region, options = {}) {
  const { fontSize = 40, minFontSize = 20, family = 'sans-serif',
    weight = 'normal', color = '#26382D' } = options;
  let text = String(value ?? '').trim();
  if (!text) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let size = fontSize;
  while (size > minFontSize) {
    ctx.font = weight + ' ' + size + 'px ' + family;
    if (ctx.measureText(text).width <= region.width) break;
    size--;
  }
  ctx.font = weight + ' ' + size + 'px ' + family;
  if (ctx.measureText(text).width > region.width) {
    const chars = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment);
    while (chars.length && ctx.measureText(chars.join('') + '…').width > region.width) chars.pop();
    text = chars.join('') + '…';
  }
  ctx.fillText(text, region.x, region.y);
  ctx.restore();
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
    weight = 'normal',
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
    ctx.font = `${weight} ${size}px ${family}`;
    lines = wrapText(ctx, raw, region.width);

    if (
      lines.length <= maxLines &&
      lines.length * Math.round(lineHeight * size / fontSize) <= region.height
    ) {
      break;
    }

    size -= 1;
  }

  size = Math.max(size, minFontSize);
  ctx.font = `${weight} ${size}px ${family}`;
  lines = wrapText(ctx, raw, region.width);

  const lineStep = Math.round(lineHeight * size / fontSize);

  const visibleLines = lines.slice(
    0,
    Math.max(1, Math.floor(region.height / lineStep))
  );

  if (lines.length > visibleLines.length && visibleLines.length) {
    let last = visibleLines[visibleLines.length - 1];

    while (
      last &&
      ctx.measureText(`${last}…`).width > region.width
    ) {
      last = last.slice(0, -1);
    }

    visibleLines[visibleLines.length - 1] = `${last.trimEnd()}…`;
  }

  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';

  const x =
    align === 'center'
      ? region.x + region.width / 2
      : align === 'right'
        ? region.x + region.width
        : region.x;

  let y = region.y;

  if (verticalAlign === 'middle') {
    y += Math.max(
      0,
      (region.height - visibleLines.length * lineStep) / 2
    );
  }

  visibleLines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineStep, region.width);
  });
}

function drawLabel(ctx, text, region, style) {
  // Uppercase was fine for the original clean font, but obscures real cursive
  // handwriting. Use title case for purchased header fonts; fit long labels.
  drawFittedLine(ctx, style.customHeading ? text : text.toUpperCase(), region, {
    fontSize: 24,
    minFontSize: 16,
    family: style.labelFontFamily,
    weight: style.labelFontWeight,
    color: style.mutedText,
  });
}


function drawBackgroundPattern(ctx, width, height, appearance) {
  const choice = appearanceCatalogItem('backgrounds', appearance.background);
  if (choice.kind !== 'dots') return;
  ctx.save();
  ctx.fillStyle = choice.color;
  ctx.globalAlpha = 0.26;
  for (let y = 8; y < height; y += 26) {
    for (let x = 8; x < width; x += 26) {
      ctx.beginPath();
      ctx.arc(x + ((Math.floor(y / 26) % 2) * 13), y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Border ink adapts to solid/custom HEX backgrounds; this is especially
// useful with bought near-black and near-white colors. Image backgrounds get
// a bright border with a dark shadow, so there is still a visible outline.
function simpleFrameInk(appearance, style) {
  const bg = appearanceCatalogItem('backgrounds', appearance.background);
  if (bg?.kind === 'image') {
    return { color: 'rgba(255,255,255,0.94)', shadow: 'rgba(0,0,0,0.85)' };
  }
  const hex = bg?.color || style.background;
  const match = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!match) return { color: 'rgba(245,247,244,0.95)', shadow: 'rgba(0,0,0,0.8)' };
  const num = parseInt(match[1], 16);
  const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  const brightness = r * 0.2126 + g * 0.7152 + b * 0.0722;
  return brightness < 148
    ? { color: 'rgba(255,255,255,0.94)', shadow: 'rgba(0,0,0,0.45)' }
    : { color: 'rgba(32,41,37,0.85)', shadow: 'rgba(255,255,255,0.45)' };
}

function drawSimpleFrame(ctx, width, height, appearance, style) {
  const kind = APPEARANCE_CATALOG.frames[appearance.frame]?.kind;
  if (!['fineLine', 'boldOutline', 'dashedOutline', 'dottedOutline', 'cornerAccents'].includes(kind)) {
    return;
  }

  const ink = simpleFrameInk(appearance, style);
  ctx.save();
  ctx.strokeStyle = ink.color;
  ctx.shadowColor = ink.shadow;
  ctx.shadowBlur = 4;
  ctx.lineJoin = 'round';

  if (kind === 'cornerAccents') {
    const inset = 19;
    const length = Math.min(width, height) * 0.085;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    // Only the corners are decorated, leaving the card edges visually open.
    ctx.moveTo(inset + length, inset);
    ctx.lineTo(inset, inset);
    ctx.lineTo(inset, inset + length);
    ctx.moveTo(width - inset - length, inset);
    ctx.lineTo(width - inset, inset);
    ctx.lineTo(width - inset, inset + length);
    ctx.moveTo(inset, height - inset - length);
    ctx.lineTo(inset, height - inset);
    ctx.lineTo(inset + length, height - inset);
    ctx.moveTo(width - inset - length, height - inset);
    ctx.lineTo(width - inset, height - inset);
    ctx.lineTo(width - inset, height - inset - length);
    ctx.stroke();
  } else {
    const inset = kind === 'boldOutline' ? 17 : 15;
    ctx.lineWidth = kind === 'boldOutline' ? 9 : kind === 'fineLine' ? 3 : 4;
    if (kind === 'dashedOutline') ctx.setLineDash([17, 12]);
    if (kind === 'dottedOutline') {
      ctx.lineCap = 'round';
      ctx.setLineDash([0.5, 14]);
    }
    roundedRect(ctx, inset, inset, width - inset * 2, height - inset * 2, 37);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDecorations(ctx, width, height, appearance, style, stickerImages = new Map()) {
  // Sticker transforms are normalized, so layouts may have different dimensions.
  for (const sticker of appearance.stickers) {
    const size = Math.min(width, height) * 0.065 * sticker.scale;
    ctx.save();
    ctx.translate(sticker.x * width, sticker.y * height);
    ctx.rotate(sticker.rotation * Math.PI / 180);
    // An instance's colors are independent of any profile font/background
    // colors. Recoloring after purchase never needs an additional shop item.
    drawStickerArtwork(ctx, sticker, size);
    ctx.restore();
  }
  // The newer overlay has stronger, separated double lines. Keep the old
  // Canvas version ONLY as an offline fallback if vector decoding ever fails.
  if (appearance.frame === 'doubleLine' && !appearance.frameOverlayReady) {
    const frame = APPEARANCE_CATALOG.frames.doubleLine;
    ctx.save();
    ctx.strokeStyle = frame.color;
    ctx.lineWidth = 3;
    roundedRect(ctx, 12, 12, width - 24, height - 24, 43);
    ctx.stroke();
    roundedRect(ctx, 26, 26, width - 52, height - 52, 33);
    ctx.stroke();
    ctx.restore();
  }
  drawSimpleFrame(ctx, width, height, appearance, style);
}

function glassPanel(ctx, x, y, width, height, style, alternate = false) {
  ctx.save();
  ctx.globalAlpha = style.panelOpacity;
  fillRoundedRect(ctx, x, y, width, height, 24,
    alternate ? style.panelAlt : style.panel);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.62)';
  ctx.lineWidth = 2;
  roundedRect(ctx, x + 1, y + 1, width - 2, height - 2, 23);
  ctx.stroke();
  ctx.restore();
}


/**
 * Open-background profile: translucent panels hug text, while the avatar and
 * optional photo sit directly on the background. The original free card is
 * rendered by drawDefaultProfile and remains unchanged.
 */
function drawOpenProfile(ctx, data, images, style, layout, appearance, stickerImages) {
  const { width, height } = layout;
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, width, height);
  if (images.background) drawCover(ctx, images.background, 0, 0, width, height);
  else drawBackgroundPattern(ctx, width, height, appearance);

  // Small grouped panels; do not cover the unused background or photo region.
  // Default/matched palettes retain their original lighter right-side panels.
  // Purchased panel themes need the visibly tinted shade on BOTH sides:
  // the lighter shade blended into the background at the glass opacity.
  const selectedPanelTheme = appearance.panelColor !== 'match' &&
    Boolean(appearanceCatalogItem('panels', appearance.panelColor)?.palette);
  glassPanel(ctx, 335, 54, 831, 158, style, selectedPanelTheme);
  glassPanel(ctx, 44, 317, 272, 157, style, true);
  glassPanel(ctx, 44, 486, 272, 115, style, true);
  glassPanel(ctx, 335, 224, 831, 258, style, selectedPanelTheme);
  glassPanel(ctx, 44, 674, 272, 70, style, true);

  const avatar = { x: 66, y: 65, width: 228, height: 228 };
  const cx = avatar.x + avatar.width / 2, cy = avatar.y + avatar.height / 2;
  ctx.save();
  ctx.fillStyle = style.accent;
  ctx.beginPath();
  ctx.arc(cx, cy, avatar.width / 2 + 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, avatar.width / 2, 0, Math.PI * 2);
  ctx.clip();
  if (images.avatar) drawCover(ctx, images.avatar, avatar.x, avatar.y, avatar.width, avatar.height);
  else {
    ctx.fillStyle = style.panel;
    ctx.fillRect(avatar.x, avatar.y, avatar.width, avatar.height);
    ctx.fillStyle = style.accentDark;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 110px ' + style.titleFontFamily;
    ctx.fillText(firstDisplayGrapheme(data.displayName).toUpperCase(), cx, cy);
  }
  ctx.restore();

  drawFittedLine(ctx, String(data.displayName || 'Member') + "'s Profile",
    { x: 358, y: 72, width: 770 }, {
      fontSize: 57, minFontSize: 26,
      family: style.titleFontFamily,
       weight: style.titleFontWeight,
      color: style.accentDark,
    });
  // Discord username is already represented by the preferred display name
  // above. The reclaimed space goes to About Me instead.
  drawFittedLine(ctx, 'Roblox: ' + (data.robloxUsername || 'Not added yet'),
    { x: 358, y: 155, width: 770 }, {
      fontSize: 30, minFontSize: 20, family: style.fontFamily, weight: style.bodyFontWeight, color: style.mutedText,
    });

  drawLabel(ctx, 'Server roles', { x: 60, y: 331, width: 242, height: 34 }, style);
  const roles = Array.isArray(data.serverRoles) ? data.serverRoles : [];
  (roles.length ? roles.slice(0, 3) : ['No roles to display']).forEach((role, i) => {
    drawFittedLine(ctx, '• ' + role, { x: 60, y: 369 + i * 34, width: 242 }, {
      fontSize: 23, minFontSize: 17, family: style.fontFamily, weight: style.bodyFontWeight, color: style.text,
    });
  });

  drawLabel(ctx, 'Looking for trades', { x: 60, y: 500, width: 244, height: 34 }, style);
  drawFittedLine(ctx, data.lookingForTrades ? 'Yes' : 'No',
    { x: 60, y: 539, width: 240 }, {
      fontSize: 37, minFontSize: 30, family: style.fontFamily, weight: style.bodyFontWeight, color: style.accentDark,
    });

  drawLabel(ctx, 'About me', { x: 355, y: 238, width: 770, height: 35 }, style);
  drawWrappedText(ctx, data.bio || 'Add a bio to tell everyone a little about yourself.',
    { x: 355, y: 278, width: 785, height: 197 }, {
      fontSize: 33, minFontSize: 20, lineHeight: 39, maxLines: 8,
      family: style.fontFamily, weight: style.bodyFontWeight, color: style.text,
    });

  // A real photo has no backing panel; without one the background stays visible.
  if (images.photo) {
    drawContain(ctx, images.photo, 350, 495, 802, 245, style.imageRadius);
  }
  drawFittedLine(ctx, data.footer || 'Made for the community',
    { x: 60, y: 692, width: 242 }, {
      fontSize: 22, minFontSize: 16, family: style.fontFamily, weight: style.bodyFontWeight, color: style.mutedText,
    });

  // Decorations intentionally remain free to overlap text.
  drawDecorations(ctx, width, height, appearance, style, stickerImages);
}

function drawDefaultProfile(ctx, data, images, style, layout, appearance, stickerImages) {
  const r = layout.regions;
  const { width, height } = layout;

  // Background layer.
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, width, height);
  if (images.background) drawCover(ctx, images.background, 0, 0, width, height);
  else drawBackgroundPattern(ctx, width, height, appearance);

  if (!images.background) {
  ctx.fillStyle = style.panelAlt;

  ctx.beginPath();
  ctx.ellipse(
    width - 42,
    26,
    270,
    185,
    -0.22,
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(
    35,
    height - 10,
    210,
    130,
    -0.2,
    0,
    Math.PI * 2
  );
  ctx.fill();

  }

  // The free default keeps its familiar solid panels. Image backgrounds use
  // small content panels so the artwork remains visible between sections.
  if (!images.background) {
    fillRoundedRect(ctx, 20, 20, width - 40, height - 40, 38, style.panel);
    fillRoundedRect(ctx, 40, 40, 280, height - 80, style.panelRadius, style.panelAlt);
    fillRoundedRect(ctx, 328, 40, width - 348, height - 80, style.panelRadius, style.panel);
  } else {
    // Group related information instead of giving every line a separate box.
    glassPanel(ctx, 332, 58, 840, 155, style);
    glassPanel(ctx, 44, 310, 272, 166, style, true);
    glassPanel(ctx, 44, 486, 272, 112, style, true);
    glassPanel(ctx, 332, 224, 840, 260, style);
    glassPanel(ctx, 44, 676, 272, 65, style, true);
  }

  // Accent stripe and decorative marks.
  if (!images.background) fillRoundedRect(
    ctx,
    328,
    40,
    style.accentStripeWidth,
    height - 80,
    style.accentStripeWidth / 2,
    style.accent
  );

  ctx.fillStyle = style.frame;

  ctx.beginPath();
  ctx.arc(width - 84, 84, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(width - 112, 84, 5, 0, Math.PI * 2);
  ctx.fill();

  // Avatar image and ring.
  ctx.save();

  ctx.beginPath();
  ctx.arc(
    r.avatar.x + r.avatar.width / 2,
    r.avatar.y + r.avatar.height / 2,
    r.avatar.width / 2 + 7,
    0,
    Math.PI * 2
  );

  ctx.fillStyle = style.accent;
  ctx.fill();
  ctx.restore();

  if (images.avatar) {
    ctx.save();

    ctx.beginPath();
    ctx.arc(
      r.avatar.x + r.avatar.width / 2,
      r.avatar.y + r.avatar.height / 2,
      r.avatar.width / 2,
      0,
      Math.PI * 2
    );

    ctx.clip();

    drawCover(
      ctx,
      images.avatar,
      r.avatar.x,
      r.avatar.y,
      r.avatar.width,
      r.avatar.height
    );

    ctx.restore();
  } else {
    ctx.fillStyle = style.panel;

    ctx.beginPath();
    ctx.arc(
      r.avatar.x + r.avatar.width / 2,
      r.avatar.y + r.avatar.height / 2,
      r.avatar.width / 2,
      0,
      Math.PI * 2
    );
    ctx.fill();

    ctx.fillStyle = style.accentDark;
    ctx.font = `bold 144px ${style.titleFontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText(
      firstDisplayGrapheme(data.displayName).toUpperCase(),
      r.avatar.x + r.avatar.width / 2,
      r.avatar.y + r.avatar.height / 2
    );
  }

  // Preserve the member's exact decorative display name.
  const displayName = String(data.displayName || 'Member');

  // The profile header shows the preferred display name once.
  const title = `${displayName}'s Profile`;

  drawFittedLine(ctx, title, images.background
    ? { ...r.title, x: r.title.x + 10, y: r.title.y + 8, width: r.title.width - 34 }
    : r.title, {
    fontSize: images.background ? 57 : 66, minFontSize: 25,
    family: style.titleFontFamily,
    weight: style.titleFontWeight, color: style.accentDark,
  });

  // Show up to three current server roles in the space beneath the avatar.
  drawLabel(ctx, 'Server roles', r.rolesLabel, style);
  const roles = Array.isArray(data.serverRoles) ? data.serverRoles : [];
  if (!roles.length) {
    drawFittedLine(ctx, 'No roles to display', r.rolesRows[0], {
      fontSize: 23, minFontSize: 18, family: style.fontFamily, weight: style.bodyFontWeight,
      color: style.mutedText,
    });
  } else {
    const visible = roles.slice(0, 3);
    visible.forEach((role, index) => {
      const remaining = roles.length - 3;
      const text = index === 2 && remaining > 0
        ? role + ' (+' + remaining + ')'
        : role;
      drawFittedLine(ctx, '• ' + text, r.rolesRows[index], {
        fontSize: 24, minFontSize: 18, family: style.fontFamily, weight: style.bodyFontWeight,
        color: style.text,
      });
    });
  }

  // Trade status.
  drawLabel(ctx, 'Looking for trades', images.background
    ? { ...r.tradeLabel, y: r.tradeLabel.y + 7, x: r.tradeLabel.x + 6 }
    : r.tradeLabel, style);

  drawWrappedText(
    ctx,
    data.lookingForTrades ? 'Yes' : 'No',
    images.background ? { ...r.tradeStatus, x: r.tradeStatus.x + 6, y: r.tradeStatus.y - 4, height: 52 } : r.tradeStatus,
    {
      fontSize: 44,
      minFontSize: 34,
      family: style.fontFamily, weight: style.bodyFontWeight,
      color: style.accentDark,
      maxLines: 2,
    }
  );

  // Roblox username beneath the compact display-name header.
  drawFittedLine(ctx, 'Roblox: ' + (data.robloxUsername || 'Not added yet'), r.robloxLine, {
    fontSize: 38,
    minFontSize: 22,
    family: style.fontFamily, weight: style.bodyFontWeight,
    color: style.mutedText,
  });

  // Bio.
  drawLabel(ctx, 'About me', images.background
    ? { ...r.bioLabel, x: r.bioLabel.x + 10, y: r.bioLabel.y + 13 }
    : r.bioLabel, style);

  drawWrappedText(
    ctx,
    data.bio || 'Add a bio to tell everyone a little about yourself.',
    images.background ? { ...r.bio, x: r.bio.x + 10, y: r.bio.y + 12, width: r.bio.width - 24, height: r.bio.height - 12 } : r.bio,
    {
      fontSize: 36,
      minFontSize: 20,
      family: style.fontFamily, weight: style.bodyFontWeight,
      color: style.text,
      lineHeight: 43,
      maxLines: 8,
    }
  );

  // On image backgrounds the photo floats directly on the artwork.
  // With no photo, leave the background completely visible.
  if (!images.background) {
    // Optional profile or album photo.
    fillRoundedRect(
      ctx,
      r.photo.x,
      r.photo.y,
      r.photo.width,
      r.photo.height,
      style.imageRadius,
      style.panelAlt
    );
  
    if (images.photo) {
      drawContain(
        ctx,
        images.photo,
        r.photo.x,
        r.photo.y,
        r.photo.width,
        r.photo.height,
        style.imageRadius
      );
    } else {
      ctx.fillStyle = style.mutedText;
      ctx.font = `${style.bodyFontWeight} 40px ${style.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
  
      ctx.fillText(
        'PROFILE PHOTO / ALBUM IMAGE',
        r.photo.x + r.photo.width / 2,
        r.photo.y + r.photo.height / 2
      );
    }
  
    } else if (images.photo) {
    drawContain(ctx, images.photo, r.photo.x, r.photo.y,
      r.photo.width, r.photo.height, style.imageRadius);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 2;
    roundedRect(ctx, r.photo.x, r.photo.y, r.photo.width, r.photo.height, style.imageRadius);
    ctx.stroke();
    ctx.restore();
  }

  // Footer.
  drawWrappedText(
    ctx,
    data.footer || 'Made for the community',
    r.footer,
    {
      fontSize: 32,
      minFontSize: 26,
      family: style.fontFamily, weight: style.bodyFontWeight,
      color: style.mutedText,
      maxLines: 2,
    }
  );

  // Final frame layer.
  ctx.strokeStyle = style.frame;
  ctx.lineWidth = style.borderWidth;

  roundedRect(
    ctx,
    style.outerInset,
    style.outerInset,
    width - style.outerInset * 2,
    height - style.outerInset * 2,
    style.cornerRadius
  );

  ctx.stroke();

  ctx.strokeStyle = style.panelAlt;
  ctx.lineWidth = style.innerBorderWidth;

  roundedRect(
    ctx,
    style.innerInset,
    style.innerInset,
    width - style.innerInset * 2,
    height - style.innerInset * 2,
    style.innerCornerRadius
  );

  ctx.stroke();
  drawDecorations(ctx, width, height, appearance, style, stickerImages);
}

/**
 * The Trading Post uses the same owned layers as profiles, but its data has
 * dedicated regions. Existing Discord embeds remain below the image so
 * inventory/house/outfit links still work as actual clickable links.
 */
function drawTradingPost(ctx, data, images, style, layout, appearance, stickerImages) {
  const { width, height } = layout;
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, width, height);
  if (images.background) drawCover(ctx, images.background, 0, 0, width, height);
  else drawBackgroundPattern(ctx, width, height, appearance);

  glassPanel(ctx, 48, 48, 1104, 170, style);
  glassPanel(ctx, 48, 240, 542, 498, style, true);
  glassPanel(ctx, 610, 240, 542, 498, style);

  drawFittedLine(ctx, 'Trading Post', { x: 83, y: 77, width: 1028, height: 64 }, {
    fontSize: 58, minFontSize: 32, family: style.titleFontFamily,
    weight: style.titleFontWeight, color: style.text,
  });
  drawFittedLine(ctx, String(data.discordName || 'Member'), {
    x: 83, y: 149, width: 620, height: 42,
  }, {
    fontSize: 34, minFontSize: 20, family: style.fontFamily,
    weight: style.bodyFontWeight, color: style.text,
  });
  drawFittedLine(ctx, String(data.robloxName || 'Roblox username not added'), {
    x: 720, y: 159, width: 400, height: 32,
  }, {
    fontSize: 24, minFontSize: 16, family: style.fontFamily,
    weight: style.bodyFontWeight, color: style.mutedText,
  });

  drawLabel(ctx, 'Looking for', { x: 84, y: 279, width: 468, height: 39 }, style);
  drawWrappedText(ctx, data.lookingFor || 'Not specified', {
    x: 84, y: 343, width: 466, height: 346,
  }, {
    fontSize: 35, minFontSize: 21, family: style.fontFamily,
    weight: style.bodyFontWeight, color: style.text, maxLines: 9,
  });
  drawLabel(ctx, 'Willing to trade', { x: 648, y: 279, width: 464, height: 39 }, style);
  drawWrappedText(ctx, data.willingToTrade || 'Not specified', {
    x: 648, y: 343, width: 465, height: 346,
  }, {
    fontSize: 35, minFontSize: 21, family: style.fontFamily,
    weight: style.bodyFontWeight, color: style.text, maxLines: 9,
  });
  drawDecorations(ctx, width, height, appearance, style, stickerImages);
}

/**
 * Outfit image: the uploaded photo is the hero, while the other details
 * remain readable even when the member chooses bold decorative artwork.
 * The media gallery remains on the original Discord listing message.
 */
function drawOutfit(ctx, data, images, style, layout, appearance, stickerImages) {
  // One cohesive card. The photo changes when the user clicks Previous/Next,
  // while the member's purchased backgrounds, fonts, frame and stickers stay.
  const { width, height } = layout;
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, width, height);
  if (images.background) drawCover(ctx, images.background, 0, 0, width, height);
  else drawBackgroundPattern(ctx, width, height, appearance);

  glassPanel(ctx, 48, 40, 1104, 137, style);
  glassPanel(ctx, 48, 199, 648, 536, style, true);
  glassPanel(ctx, 716, 199, 436, 536, style);
  glassPanel(ctx, 48, 759, 1104, 54, style);

  drawFittedLine(ctx, data.title || "Outfit listing", {
    x: 85, y: 75, width: 1010, height: 66,
  }, {
    fontSize: 53, minFontSize: 27, family: style.titleFontFamily,
    weight: style.titleFontWeight, color: style.text,
  });
  drawFittedLine(ctx, data.seller || "Member", {
    x: 85, y: 147, width: 1000, height: 27,
  }, {
    fontSize: 23, minFontSize: 16, family: style.fontFamily,
    weight: style.bodyFontWeight, color: style.mutedText,
  });

  if (images.photo) {
    drawContain(ctx, images.photo, 73, 220, 598, 491, style.imageRadius);
  } else {
    drawFittedLine(ctx, "Outfit media", {
      x: 90, y: 387, width: 580, height: 48,
    }, {
      fontSize: 36, minFontSize: 22, family: style.titleFontFamily,
      weight: style.titleFontWeight, color: style.text,
    });
    drawWrappedText(ctx, "See the attached video or outfit link.", {
      x: 90, y: 455, width: 575, height: 78,
    }, {
      fontSize: 24, minFontSize: 17, family: style.fontFamily,
      weight: style.bodyFontWeight, color: style.mutedText, maxLines: 3,
    });
  }

  drawLabel(ctx, "Cost", { x: 749, y: 237, width: 355, height: 38 }, style);
  drawWrappedText(ctx, data.cost || "Not listed", {
    x: 749, y: 288, width: 353, height: 115,
  }, {
    fontSize: 34, minFontSize: 21, family: style.fontFamily,
    weight: style.bodyFontWeight, color: style.text, maxLines: 2,
  });
  drawLabel(ctx, "Outfit details", { x: 749, y: 418, width: 358, height: 38 }, style);
  drawWrappedText(ctx, data.description || "No description", {
    x: 749, y: 474, width: 355, height: 210,
  }, {
    fontSize: 27, minFontSize: 18, family: style.fontFamily,
    weight: style.bodyFontWeight, color: style.text, maxLines: 6,
  });

  const count = Number(data.galleryCount) || 0;
  const current = count ? (Number(data.galleryIndex) || 1) : 0;
  const footer = count ? `Photo ${current} / ${count}` : "Video / media listing";
  drawFittedLine(ctx, footer, {
    x: 86, y: 772, width: 995, height: 29,
  }, {
    fontSize: 23, minFontSize: 16, family: style.fontFamily,
    weight: style.bodyFontWeight, color: style.mutedText,
  });
  drawDecorations(ctx, width, height, appearance, style, stickerImages);
}


function drawHouse(ctx, data, images, style, layout, appearance, stickerImages) {
  // Compact house advertisement (1200 × 430). The playable House Tour remains
  // in a separate Discord message; shrinking this image must not change it.
  const { width, height } = layout;
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, width, height);
  if (images.background) drawCover(ctx, images.background, 0, 0, width, height);
  else drawBackgroundPattern(ctx, width, height, appearance);

  // Shallow title, wider photo-and-details row, and a slim gallery footer.
  // All regions end above y=420, leaving room for purchased outer frames.
  glassPanel(ctx, 42, 26, 1116, 86, style);
  glassPanel(ctx, 42, 126, 425, 243, style, true);
  glassPanel(ctx, 479, 126, 679, 243, style);
  glassPanel(ctx, 42, 380, 1116, 31, style);

  drawFittedLine(ctx, data.title || "House listing", {
    x: 74, y: 40, width: 1052, height: 45,
  }, { fontSize: 41, minFontSize: 24, family: style.titleFontFamily,
    weight: style.titleFontWeight, color: style.text });
  drawFittedLine(ctx, data.seller || "Member", {
    x: 76, y: 88, width: 1034, height: 21,
  }, { fontSize: 20, minFontSize: 14, family: style.fontFamily,
    weight: style.bodyFontWeight, color: style.mutedText });

  if (images.photo) {
    drawContain(ctx, images.photo, 56, 139, 397, 216, style.imageRadius);
  } else {
    drawFittedLine(ctx, "House Tour", {
      x: 78, y: 187, width: 345, height: 48,
    }, { fontSize: 40, minFontSize: 26, family: style.titleFontFamily,
      weight: style.titleFontWeight, color: style.text });
    drawWrappedText(ctx, "Watch the playable video beneath this listing.", {
      x: 78, y: 251, width: 345, height: 78,
    }, { fontSize: 24, minFontSize: 17, family: style.fontFamily,
      weight: style.bodyFontWeight, color: style.mutedText, maxLines: 3 });
  }

  // Price columns share the top of the details panel. This leaves the whole
  // lower portion for house description, rather than squeezing each value.
  drawLabel(ctx, "Asking price", { x: 506, y: 143, width: 278, height: 30 }, style);
  drawFittedLine(ctx, data.askingPrice || "Not listed", {
    x: 506, y: 176, width: 288, height: 42,
  }, { fontSize: 31, minFontSize: 17, family: style.fontFamily,
    weight: style.bodyFontWeight, color: style.text });
  drawLabel(ctx, "Estimated value", { x: 827, y: 143, width: 298, height: 30 }, style);
  drawFittedLine(ctx, data.estimatedValue || "Not listed", {
    x: 827, y: 176, width: 298, height: 42,
  }, { fontSize: 31, minFontSize: 17, family: style.fontFamily,
    weight: style.bodyFontWeight, color: style.text });

  drawLabel(ctx, "House details", { x: 506, y: 231, width: 599, height: 29 }, style);
  drawWrappedText(ctx, data.description || "No description", {
    x: 506, y: 269, width: 614, height: 87,
  }, { fontSize: 23, minFontSize: 16, family: style.fontFamily,
    weight: style.bodyFontWeight, color: style.text, maxLines: 3 });

  const count = Number(data.galleryCount) || 0;
  const index = count ? Number(data.galleryIndex) || 1 : 0;
  drawFittedLine(ctx, count ? `House photo ${index} / ${count}` : "House Tour", {
    x: 75, y: 384, width: 1040, height: 22,
  }, { fontSize: 19, minFontSize: 14, family: style.fontFamily,
    weight: style.bodyFontWeight, color: style.mutedText });

  drawDecorations(ctx, width, height, appearance, style, stickerImages);
}

/**
 * Render a post image as a PNG Buffer.
 *
 * @param {object} options
 * @param {'profile'|'tradingPost'|'outfit'|'house'} options.type Layout key.
 * @param {object} options.data Text/data fields for the selected layout.
 * @param {object} [options.images] Optional avatar/photo image sources.
 * @param {object} [options.style] Optional overrides for DEFAULT_POST_STYLE.
 * @param {object} [options.appearance] Catalog item IDs and sticker transforms.
 * @returns {Promise<Buffer>} PNG bytes suitable for Discord AttachmentBuilder.
 */
export async function renderPostImage({
  type = 'profile',
  data = {},
  images = {},
  style = {},
  appearance = {},
} = {}) {
  registerAppearanceFonts();
  await ensureSymbolFont();
  const layout = POST_LAYOUTS[type];

  if (!layout) {
    throw new Error(`Unknown post layout: ${type}`);
  }

  const resolvedAppearance = resolveAppearance(appearance);
  const headerFont = APPEARANCE_CATALOG.fonts[resolvedAppearance.headerFont];
  const bodyFont = APPEARANCE_CATALOG.fonts[resolvedAppearance.bodyFont];
  const backgroundItem = appearanceCatalogItem('backgrounds', resolvedAppearance.background);
  const selectedPanel = appearanceCatalogItem('panels', resolvedAppearance.panelColor);
  // Default lettering remains legible on both explicit dark panels and
  // panels matched to a dark background. Explicit text-color choices still win.
  const panelsAreDark = selectedPanel?.dark ||
    (resolvedAppearance.panelColor === 'match' && backgroundItem.dark);
  const colors = panelsAreDark && resolvedAppearance.fontColor === 'default'
    ? APPEARANCE_CATALOG.fontColors.white
    : appearanceCatalogItem('fontColors', resolvedAppearance.fontColor);
  // A purchased custom HEX choice intentionally overrides all text shades.
  // Default text alone auto-switches to white on dark panels.
  const matchedPalette = resolvedAppearance.panelColor === 'match'
    ? backgroundItem.palette || {}
    : selectedPanel?.palette || {};
  const resolvedStyle = {
    ...DEFAULT_POST_STYLE,
    ...style,
    fontFamily: withUnicodeFallback(bodyFont.family),
    bodyFontWeight: bodyFont.weight || 'normal',
    labelFontFamily: withUnicodeFallback(headerFont.family),
    labelFontWeight: headerFont.weight || 'normal',
    titleFontFamily: withUnicodeFallback(headerFont.titleFamily),
    titleFontWeight: headerFont.weight || 'normal',
    customHeading: resolvedAppearance.headerFont !== 'default',
    ...colors,
    ...matchedPalette,
    panelOpacity: resolvedAppearance.panelOpacity,
    ...(backgroundItem.kind === 'solid' && backgroundItem.color ? { background: backgroundItem.color } : {}),
  };

  const [avatar, photo, background] = await Promise.all([
    loadImageSource(images.avatar).catch((error) => {
      console.warn(
        `[post-renderer] Could not load avatar: ${error.message}`
      );
      return null;
    }),

    loadImageSource(images.photo).catch((error) => {
      console.warn(
        `[post-renderer] Could not load profile photo: ${error.message}`
      );
      return null;
    }),
    backgroundItem.kind === 'image'
      ? readFile(new URL('../' + backgroundItem.asset, import.meta.url))
          .then(bytes => loadImage(bytes))
          .catch(error => {
            console.warn('[post-renderer] Background unavailable:', error.message);
            return null;
          })
      : Promise.resolve(null),
  ]);

  // Custom sticker assets are curated local files (e.g. transparent PNGs).
  // Never load arbitrary user-provided paths or URLs from saved profiles.
  const stickerImages = new Map();
  await Promise.all(resolvedAppearance.stickers.map(async sticker => {
    const item = APPEARANCE_CATALOG.stickers[sticker.id];
    if (item?.kind !== 'image' || !item.asset || stickerImages.has(sticker.id)) return;
    try {
      const bytes = await readFile(new URL('../' + item.asset, import.meta.url));
      stickerImages.set(sticker.id, await loadImage(bytes));
    } catch (error) {
      console.warn('[post-renderer] Sticker unavailable:', sticker.id, error.message);
    }
  }));

  const canvas = createCanvas(layout.width, layout.height);
  const ctx = canvas.getContext('2d');
  const overlay = await frameOverlayImage(resolvedAppearance.frame);
  // Set before drawing so the legacy Double Line fallback does not duplicate
  // the much stronger new double-line overlay.
  resolvedAppearance.frameOverlayReady = Boolean(overlay);

  if (type === 'profile') {
    (resolvedAppearance.background === 'default' ? drawDefaultProfile : drawOpenProfile)(
      ctx,
      data,
      { avatar, photo, background },
      resolvedStyle,
      layout,
      resolvedAppearance,
      stickerImages
    );
  } else if (type === 'tradingPost') {
    drawTradingPost(ctx, data, { avatar, photo, background }, resolvedStyle,
      layout, resolvedAppearance, stickerImages);
  } else if (type === 'outfit') {
    drawOutfit(ctx, data, { photo, background }, resolvedStyle,
      layout, resolvedAppearance, stickerImages);
  } else if (type === 'house') {
    drawHouse(ctx, data, { photo, background }, resolvedStyle,
      layout, resolvedAppearance, stickerImages);
  } else {
    throw new Error(
      `Renderer implementation is missing for layout: ${type}`
    );
  }

  // Decorative frame draws LAST, on top of the profile/photo/stickers.
  // SVG is transparent except along the outer rim (1200×800 viewBox).
  if (overlay) ctx.drawImage(overlay, 0, 0, layout.width, layout.height);

  return canvas.toBuffer('image/png');
}
