
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_POST_STYLE, POST_LAYOUTS } from './post-layouts.js';
import { APPEARANCE_CATALOG, appearanceCatalogItem, resolveAppearance } from './post-appearance.js';

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

      if (!response.ok) {
        throw new Error(`Image request failed (${response.status}).`);
      }

      return loadImage(Buffer.from(await response.arrayBuffer()));
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
  const { fontSize = 40, minFontSize = 20, family = 'sans-serif', color = '#26382D' } = options;
  let text = String(value ?? '').trim();
  if (!text) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let size = fontSize;
  while (size > minFontSize) {
    ctx.font = size + 'px ' + family;
    if (ctx.measureText(text).width <= region.width) break;
    size--;
  }
  ctx.font = size + 'px ' + family;
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

    if (
      lines.length <= maxLines &&
      lines.length * Math.round(lineHeight * size / fontSize) <= region.height
    ) {
      break;
    }

    size -= 1;
  }

  size = Math.max(size, minFontSize);
  ctx.font = `${size}px ${family}`;
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
  drawWrappedText(ctx, text.toUpperCase(), region, {
    fontSize: 24,
    minFontSize: 20,
    family: style.fontFamily,
    color: style.mutedText,
    maxLines: 1,
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

function drawDecorations(ctx, width, height, appearance, style, stickerImages = new Map()) {
  // Sticker transforms are normalized, so layouts may have different dimensions.
  for (const sticker of appearance.stickers) {
    const size = Math.min(width, height) * 0.065 * sticker.scale;
    ctx.save();
    ctx.translate(sticker.x * width, sticker.y * height);
    ctx.rotate(sticker.rotation * Math.PI / 180);
    ctx.fillStyle = style.accentDark;
    ctx.strokeStyle = style.accentDark;
    ctx.lineWidth = Math.max(2, size * 0.055);
    const item = APPEARANCE_CATALOG.stickers[sticker.id];
    if (item?.kind === 'image' && stickerImages.has(sticker.id)) {
      const image = stickerImages.get(sticker.id);
      const ratio = image.width / image.height;
      const imageWidth = ratio >= 1 ? size : size * ratio;
      const imageHeight = ratio >= 1 ? size / ratio : size;
      ctx.drawImage(image, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
    } else if (sticker.id === 'flower') {
      for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.rotate(i * Math.PI / 3);
        ctx.beginPath();
        ctx.ellipse(0, -size * 0.3, size * 0.16, size * 0.27, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = style.panel;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.13, 0, Math.PI * 2);
      ctx.fill();
    } else if (sticker.id === 'star') {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const radius = i % 2 ? size * 0.22 : size * 0.5;
        const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  if (appearance.frame === 'doubleLine') {
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
  glassPanel(ctx, 335, 54, 831, 240, style, selectedPanelTheme);
  glassPanel(ctx, 44, 317, 272, 157, style, true);
  glassPanel(ctx, 44, 486, 272, 115, style, true);
  glassPanel(ctx, 335, 308, 831, 174, style, selectedPanelTheme);
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
    ctx.fillText(String(data.displayName || 'P').charAt(0).toUpperCase(), cx, cy);
  }
  ctx.restore();

  drawFittedLine(ctx, String(data.displayName || 'Member') + "'s Profile",
    { x: 358, y: 72, width: 770 }, {
      fontSize: 57, minFontSize: 26,
      family: '"AM Unicode Symbols", ' + style.titleFontFamily,
      color: style.accentDark,
    });
  drawFittedLine(ctx, 'Discord: ' + (data.discordUsername || 'Member'),
    { x: 358, y: 170, width: 770 }, {
      fontSize: 36, minFontSize: 22, family: style.fontFamily, color: style.mutedText,
    });
  drawFittedLine(ctx, 'Roblox: ' + (data.robloxUsername || 'Not added yet'),
    { x: 358, y: 230, width: 770 }, {
      fontSize: 30, minFontSize: 20, family: style.fontFamily, color: style.mutedText,
    });

  drawLabel(ctx, 'Server roles', { x: 60, y: 331, width: 242, height: 34 }, style);
  const roles = Array.isArray(data.serverRoles) ? data.serverRoles : [];
  (roles.length ? roles.slice(0, 3) : ['No roles to display']).forEach((role, i) => {
    drawFittedLine(ctx, '• ' + role, { x: 60, y: 369 + i * 34, width: 242 }, {
      fontSize: 23, minFontSize: 17, family: style.fontFamily, color: style.text,
    });
  });

  drawLabel(ctx, 'Looking for trades', { x: 60, y: 500, width: 244, height: 34 }, style);
  drawFittedLine(ctx, data.lookingForTrades ? 'Yes' : 'No',
    { x: 60, y: 539, width: 240 }, {
      fontSize: 37, minFontSize: 30, family: style.fontFamily, color: style.accentDark,
    });

  drawLabel(ctx, 'About me', { x: 355, y: 323, width: 770, height: 35 }, style);
  drawWrappedText(ctx, data.bio || 'Add a bio to tell everyone a little about yourself.',
    { x: 355, y: 367, width: 785, height: 102 }, {
      fontSize: 34, minFontSize: 22, lineHeight: 42, maxLines: 3,
      family: style.fontFamily, color: style.text,
    });

  // A real photo has no backing panel; without one the background stays visible.
  if (images.photo) {
    drawContain(ctx, images.photo, 350, 495, 802, 245, style.imageRadius);
  }
  drawFittedLine(ctx, data.footer || 'Made for the community',
    { x: 60, y: 692, width: 242 }, {
      fontSize: 22, minFontSize: 16, family: style.fontFamily, color: style.mutedText,
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
    glassPanel(ctx, 332, 58, 840, 232, style);
    glassPanel(ctx, 44, 310, 272, 166, style, true);
    glassPanel(ctx, 44, 486, 272, 112, style, true);
    glassPanel(ctx, 332, 304, 840, 182, style);
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
      String(data.displayName || 'P').trim().charAt(0).toUpperCase(),
      r.avatar.x + r.avatar.width / 2,
      r.avatar.y + r.avatar.height / 2
    );
  }

  // Preserve the member's exact decorative display name.
  const displayName = String(data.displayName || 'Member');

  // Profile title and subtitle.
  const title = `${displayName}'s Profile`;

  drawFittedLine(ctx, title, images.background
    ? { ...r.title, x: r.title.x + 10, y: r.title.y + 8, width: r.title.width - 34 }
    : r.title, {
    fontSize: images.background ? 57 : 66, minFontSize: 25,
    family: '\"AM Unicode Symbols\", ' + style.titleFontFamily, color: style.accentDark,
  });

  drawWrappedText(
    ctx,
    data.discordUsername
      ? `Discord: ${data.discordUsername}`
      : 'Member showcase',
    r.subtitle,
    {
      fontSize: 44,
      minFontSize: 34,
      family: style.fontFamily,
      color: style.mutedText,
      maxLines: 1,
    }
  );

  // Show up to three current server roles in the space beneath the avatar.
  drawLabel(ctx, 'Server roles', r.rolesLabel, style);
  const roles = Array.isArray(data.serverRoles) ? data.serverRoles : [];
  if (!roles.length) {
    drawFittedLine(ctx, 'No roles to display', r.rolesRows[0], {
      fontSize: 23, minFontSize: 18, family: style.fontFamily,
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
        fontSize: 24, minFontSize: 18, family: style.fontFamily,
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
      family: style.fontFamily,
      color: style.accentDark,
      maxLines: 2,
    }
  );

  // Roblox username beneath the Discord username.
  drawFittedLine(ctx, 'Roblox: ' + (data.robloxUsername || 'Not added yet'), r.robloxLine, {
    fontSize: 38,
    minFontSize: 22,
    family: style.fontFamily,
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
      fontSize: 48,
      minFontSize: 34,
      family: style.fontFamily,
      color: style.text,
      lineHeight: 68,
      maxLines: 6,
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
      ctx.font = `40px ${style.fontFamily}`;
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
      family: style.fontFamily,
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
 * Render a post image as a PNG Buffer.
 *
 * @param {object} options
 * @param {'profile'} options.type Layout key.
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
  if (type === 'profile') await ensureSymbolFont();
  const layout = POST_LAYOUTS[type];

  if (!layout) {
    throw new Error(`Unknown post layout: ${type}`);
  }

  const resolvedAppearance = resolveAppearance(appearance);
  const font = APPEARANCE_CATALOG.fonts[resolvedAppearance.font];
  const backgroundItem = appearanceCatalogItem('backgrounds', resolvedAppearance.background);
  const selectedPanel = appearanceCatalogItem('panels', resolvedAppearance.panelColor);
  // Default lettering remains legible on both explicit dark panels and
  // panels matched to a dark background. Explicit text-color choices still win.
  const panelsAreDark = selectedPanel?.dark ||
    (resolvedAppearance.panelColor === 'match' && backgroundItem.dark);
  const colors = panelsAreDark && resolvedAppearance.fontColor === 'default'
    ? APPEARANCE_CATALOG.fontColors.white
    : APPEARANCE_CATALOG.fontColors[resolvedAppearance.fontColor];
  const matchedPalette = resolvedAppearance.panelColor === 'match'
    ? backgroundItem.palette || {}
    : selectedPanel?.palette || {};
  const resolvedStyle = {
    ...DEFAULT_POST_STYLE,
    ...style,
    fontFamily: font.family,
    titleFontFamily: font.titleFamily,
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
  } else {
    throw new Error(
      `Renderer implementation is missing for layout: ${type}`
    );
  }

  return canvas.toBuffer('image/png');
}
