export const CLASSIC_COLORS = ['red', 'yellow', 'green', 'blue'];
export const FLIP_DARK_COLORS = ['teal', 'orange', 'pink', 'purple'];

// Accessibility color palettes (hex colors with high contrast text and distinct shape symbols)
export const COLOR_METADATA = {
  red: {
    name: 'Red',
    bgHex: '#DC2626',
    borderHex: '#991B1B',
    textHex: '#FFFFFF',
    badgeHex: '#7F1D1D',
    symbol: '◆', // Diamond
    symbolName: 'Diamond',
  },
  yellow: {
    name: 'Yellow',
    bgHex: '#EAB308',
    borderHex: '#CA8A04',
    textHex: '#1F2937',
    badgeHex: '#713F12',
    symbol: '★', // Star
    symbolName: 'Star',
  },
  green: {
    name: 'Green',
    bgHex: '#16A34A',
    borderHex: '#15803D',
    textHex: '#FFFFFF',
    badgeHex: '#14532D',
    symbol: '▲', // Triangle
    symbolName: 'Triangle',
  },
  blue: {
    name: 'Blue',
    bgHex: '#2563EB',
    borderHex: '#1D4ED8',
    textHex: '#FFFFFF',
    badgeHex: '#1E3A8A',
    symbol: '●', // Circle
    symbolName: 'Circle',
  },
  teal: {
    name: 'Teal',
    bgHex: '#0D9488',
    borderHex: '#0F766E',
    textHex: '#FFFFFF',
    badgeHex: '#134E4A',
    symbol: '⬟', // Pentagon
    symbolName: 'Pentagon',
  },
  orange: {
    name: 'Orange',
    bgHex: '#EA580C',
    borderHex: '#C2410C',
    textHex: '#FFFFFF',
    badgeHex: '#7C2D12',
    symbol: '☼', // Sun
    symbolName: 'Sun',
  },
  pink: {
    name: 'Pink',
    bgHex: '#DB2777',
    borderHex: '#BE185D',
    textHex: '#FFFFFF',
    badgeHex: '#831843',
    symbol: '✚', // Cross
    symbolName: 'Cross',
  },
  purple: {
    name: 'Purple',
    bgHex: '#7C3AED',
    borderHex: '#6D28D9',
    textHex: '#FFFFFF',
    badgeHex: '#4C1D95',
    symbol: '☾', // Moon
    symbolName: 'Moon',
  },
  wild: {
    name: 'Wild',
    bgHex: '#1E293B',
    borderHex: '#0F172A',
    textHex: '#FFFFFF',
    badgeHex: '#000000',
    symbol: '✦', // Sparkle
    symbolName: 'Multicolor',
  },
};

export const MODE_TITLES = {
  classic: 'Classic UNO',
  flip: 'UNO Flip',
  no_mercy: "Show 'em No Mercy",
};

export const MODE_DESCRIPTIONS = {
  classic: 'The beloved classic card game. Match colors & numbers, play Skips, Reverses, and Draw Twos. First to empty hand wins!',
  flip: 'Double-sided cards with Light and Dark sides! Flip cards flip every hand, the draw pile, and the discard pile with vicious dark penalties (+5, Skip Everyone, Draw Color).',
  no_mercy: 'Extreme chaos! Stack draw penalties (+2, +4, +6, +10), draw until playable, 7-Swap, 0-Pass, and 25-card Mercy knockout!',
};

export const NO_MERCY_MAX_CARDS = 25;

