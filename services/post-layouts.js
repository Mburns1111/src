
/**
 * Canvas layout definitions. Keep coordinates here rather than scattering them
 * through the renderer so cosmetic changes do not require layout rewrites.
 */
export const POST_LAYOUTS = {
  profile: {
    width: 1200,
    height: 800,
    safePadding: 48,
    regions: {
      title: { x: 344, y: 80, width: 810, height: 90 },
      subtitle: { x: 348, y: 176, width: 810, height: 60 },

      avatar: { x: 66, y: 74, width: 230, height: 230 },

      usernameLabel: { x: 60, y: 324, width: 250, height: 50 },
      username: { x: 60, y: 378, width: 250, height: 100 },
      robloxLine: { x: 348, y: 239, width: 810, height: 48 },
      rolesLabel: { x: 60, y: 318, width: 250, height: 38 },
      rolesRows: [
        { x: 60, y: 356, width: 250, height: 32 },
        { x: 60, y: 394, width: 250, height: 32 },
        { x: 60, y: 432, width: 250, height: 32 },
      ],

      tradeLabel: { x: 60, y: 486, width: 250, height: 50 },
      tradeStatus: { x: 60, y: 538, width: 250, height: 100 },

      bioLabel: { x: 348, y: 302, width: 810, height: 42 },
      bio: { x: 348, y: 351, width: 810, height: 126 },

      // Larger photo area.
      photo: { x: 348, y: 492, width: 810, height: 248 },

      footer: { x: 60, y: 686, width: 250, height: 42 },
    },
  },
};

export const DEFAULT_POST_STYLE = {
  // Medium gray exterior.
  background: '#969B98',

  // Soft gray main card instead of bright cream.
  panel: '#D2D5D1',

  // Darker gray-green secondary panels.
  panelAlt: '#B5BCB6',

  // Muted sage accents.
  accent: '#708779',
  accentDark: '#354B3E',

  // Readable dark text.
  text: '#29312C',
  mutedText: '#566159',

  // Subdued border.
  frame: '#89958C',

  // Shared geometry for every basic post; optional shop frames will be separate overlays.
  cornerRadius: 38,
  innerCornerRadius: 27,
  panelRadius: 26,
  imageRadius: 18,
  outerInset: 20,
  innerInset: 30,
  borderWidth: 5,
  innerBorderWidth: 2,
  accentStripeWidth: 12,

  fontFamily: 'sans-serif',
  titleFontFamily: 'serif',
};
