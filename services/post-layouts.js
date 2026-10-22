
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

      tradeLabel: { x: 60, y: 486, width: 250, height: 50 },
      tradeStatus: { x: 60, y: 538, width: 250, height: 100 },

      bioLabel: { x: 348, y: 240, width: 810, height: 50 },
      bio: { x: 348, y: 290, width: 810, height: 190 },

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

  fontFamily: 'sans-serif',
  titleFontFamily: 'serif',
};
