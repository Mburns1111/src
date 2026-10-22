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
      title: { x: 340, y: 92, width: 790, height: 62 },
      subtitle: { x: 344, y: 157, width: 790, height: 38 },
      avatar: { x: 76, y: 84, width: 210, height: 210 },
      usernameLabel: { x: 76, y: 340, width: 230, height: 28 },
      username: { x: 76, y: 372, width: 230, height: 62 },
      tradeLabel: { x: 76, y: 463, width: 230, height: 28 },
      tradeStatus: { x: 76, y: 495, width: 230, height: 50 },
      bioLabel: { x: 344, y: 244, width: 790, height: 30 },
      bio: { x: 344, y: 282, width: 790, height: 205 },
      photo: { x: 344, y: 522, width: 790, height: 218 },
      footer: { x: 76, y: 686, width: 230, height: 42 },
    },
  },
};

export const DEFAULT_POST_STYLE = {
  background: '#F6F1E7',
  panel: '#FFFCF6',
  panelAlt: '#E6EEE5',
  accent: '#72947A',
  accentDark: '#365442',
  text: '#26382D',
  mutedText: '#68766B',
  frame: '#B7C9B3',
  fontFamily: 'sans-serif',
  titleFontFamily: 'serif',
};
