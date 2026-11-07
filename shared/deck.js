import { CLASSIC_COLORS, FLIP_DARK_COLORS } from './constants.js';

export function getActiveFace(card, mode = 'classic', flipSide = 'light') {
  if (mode === 'flip') {
    if (flipSide === 'dark' && card.dark) {
      return card.dark;
    }
    if (card.light) {
      return card.light;
    }
  }
  return {
    color: card.color || 'wild',
    type: card.type || 'number',
    value: card.value,
  };
}

export function shuffleDeck(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createClassicDeck() {
  const deck = [];
  let idCounter = 1;

  for (const color of CLASSIC_COLORS) {
    // 1x '0'
    deck.push({ id: `c-${idCounter++}`, color, type: 'number', value: 0 });

    // 2x '1' through '9'
    for (let val = 1; val <= 9; val++) {
      deck.push({ id: `c-${idCounter++}`, color, type: 'number', value: val });
      deck.push({ id: `c-${idCounter++}`, color, type: 'number', value: val });
    }

    // 2x 'skip'
    deck.push({ id: `c-${idCounter++}`, color, type: 'skip' });
    deck.push({ id: `c-${idCounter++}`, color, type: 'skip' });

    // 2x 'reverse'
    deck.push({ id: `c-${idCounter++}`, color, type: 'reverse' });
    deck.push({ id: `c-${idCounter++}`, color, type: 'reverse' });

    // 2x 'draw2'
    deck.push({ id: `c-${idCounter++}`, color, type: 'draw2' });
    deck.push({ id: `c-${idCounter++}`, color, type: 'draw2' });
  }

  // 4x 'wild'
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `c-${idCounter++}`, color: 'wild', type: 'wild' });
  }

  // 4x 'wild_draw4'
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `c-${idCounter++}`, color: 'wild', type: 'wild_draw4' });
  }

  return deck; // 108 cards
}

export function createFlipDeck() {
  const lightFaces = [];
  const darkFaces = [];

  // Generate 112 Light Faces
  for (const color of CLASSIC_COLORS) {
    // 2x each '1'..'9' (no '0' in Flip)
    for (let val = 1; val <= 9; val++) {
      lightFaces.push({ color, type: 'number', value: val });
      lightFaces.push({ color, type: 'number', value: val });
    }
    // 2x draw1
    lightFaces.push({ color, type: 'draw1' });
    lightFaces.push({ color, type: 'draw1' });
    // 2x skip
    lightFaces.push({ color, type: 'skip' });
    lightFaces.push({ color, type: 'skip' });
    // 2x reverse
    lightFaces.push({ color, type: 'reverse' });
    lightFaces.push({ color, type: 'reverse' });
    // 2x flip
    lightFaces.push({ color, type: 'flip' });
    lightFaces.push({ color, type: 'flip' });
  }
  // 4x wild
  for (let i = 0; i < 4; i++) {
    lightFaces.push({ color: 'wild', type: 'wild' });
  }
  // 4x wild_draw2
  for (let i = 0; i < 4; i++) {
    lightFaces.push({ color: 'wild', type: 'wild_draw2' });
  }

  // Generate 112 Dark Faces
  for (const color of FLIP_DARK_COLORS) {
    // 2x each '1'..'9'
    for (let val = 1; val <= 9; val++) {
      darkFaces.push({ color, type: 'number', value: val });
      darkFaces.push({ color, type: 'number', value: val });
    }
    // 2x draw5
    darkFaces.push({ color, type: 'draw5' });
    darkFaces.push({ color, type: 'draw5' });
    // 2x skip_everyone
    darkFaces.push({ color, type: 'skip_everyone' });
    darkFaces.push({ color, type: 'skip_everyone' });
    // 2x reverse
    darkFaces.push({ color, type: 'reverse' });
    darkFaces.push({ color, type: 'reverse' });
    // 2x flip
    darkFaces.push({ color, type: 'flip' });
    darkFaces.push({ color, type: 'flip' });
  }
  // 4x wild
  for (let i = 0; i < 4; i++) {
    darkFaces.push({ color: 'wild', type: 'wild' });
  }
  // 4x wild_draw_color
  for (let i = 0; i < 4; i++) {
    darkFaces.push({ color: 'wild', type: 'wild_draw_color' });
  }

  // Shuffle dark faces for diverse pairing
  const shuffledDark = shuffleDeck(darkFaces);

  const deck = [];
  for (let i = 0; i < lightFaces.length; i++) {
    deck.push({
      id: `f-${i + 1}`,
      light: lightFaces[i],
      dark: shuffledDark[i],
    });
  }

  return deck; // 112 cards
}

export function createNoMercyDeck() {
  const deck = [];
  const add = (color, type, copies, value) => {
    for (let i = 0; i < copies; i++) deck.push({ id: `nm-${deck.length + 1}`, color, type, ...(value === undefined ? {} : { value }) });
  };
  for (const color of CLASSIC_COLORS) {
    for (let value = 0; value <= 9; value++) add(color, 'number', 2, value);
    for (const type of ['skip', 'reverse', 'draw2', 'discard_all']) add(color, type, 3);
    for (const type of ['draw4', 'skip_everyone']) add(color, type, 2);
  }
  add('wild', 'wild_reverse_draw4', 8);
  add('wild', 'wild_color_roulette', 8);
  add('wild', 'wild_draw6', 4);
  add('wild', 'wild_draw10', 4);
  return deck;
}

export function createDeckForMode(mode = 'classic') {
  switch (mode) {
    case 'flip':
      return createFlipDeck();
    case 'no_mercy':
      return createNoMercyDeck();
    case 'classic':
    default:
      return createClassicDeck();
  }
}

