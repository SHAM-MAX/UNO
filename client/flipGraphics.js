const NUMBER_WORDS = {
  1: 'ONE', 2: 'TWO', 3: 'THREE', 4: 'FOUR', 5: 'FIVE',
  6: 'SIX', 7: 'SEVEN', 8: 'EIGHT', 9: 'NINE'
};

const LABELS = {
  skip: 'Skip',
  reverse: 'Reverse',
  draw1: 'Draw one',
  draw2: 'Draw two',
  draw5: 'Draw five',
  flip: 'Flip',
  skip_everyone: 'Skip everyone',
  wild: 'Wild',
  wild_draw2: 'Wild draw two',
  wild_draw4: 'Wild draw four',
  wild_draw_color: 'Wild draw color'
};

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function getFlipCardImagePath(card, face, side = 'light') {
  const f = face || card;
  if (!f) return '/assets/flip-cards/TOP_CARD.jpg';

  const isDark = side === 'dark';

  // Wild cards
  if (f.color === 'wild') {
    if (isDark) {
      if (f.type === 'wild_draw_color') {
        return '/assets/flip-cards/Orange_WILD_DRAW_COLOR.jpg';
      }
      return '/assets/flip-cards/DARK_WILD_CARD.jpg';
    } else {
      if (f.type === 'wild_draw2') {
        return '/assets/flip-cards/Blue_WILDTWO.jpg';
      }
      if (f.type === 'wild_draw4') {
        return '/assets/flip-cards/WILD_DRAW_FOUR.jpg';
      }
      return '/assets/flip-cards/WILD_CARD.jpg';
    }
  }

  const colorCap = capitalize(f.color);

  // Numbers
  if (f.type === 'number') {
    const word = NUMBER_WORDS[f.value];
    if (word) {
      return `/assets/flip-cards/${colorCap}_${word}.jpg`;
    }
  }

  // Light Actions
  if (f.type === 'draw1') return `/assets/flip-cards/${colorCap}_DRAW_ONE.jpg`;
  if (f.type === 'draw2') return `/assets/flip-cards/${colorCap}_DRAW_TWO.jpg`;
  if (f.type === 'skip') return `/assets/flip-cards/${colorCap}_SKIP.jpg`;
  if (f.type === 'reverse') return `/assets/flip-cards/${colorCap}_REVERSE.jpg`;
  if (f.type === 'flip') return `/assets/flip-cards/${colorCap}_FLIP.jpg`;

  // Dark Actions
  if (f.type === 'draw5') return `/assets/flip-cards/${colorCap}_DRAW_FIVE.jpg`;
  if (f.type === 'skip_everyone') return `/assets/flip-cards/${colorCap}_SKIP_EVERYONE.jpg`;

  return '/assets/flip-cards/TOP_CARD.jpg';
}

export function getFlipCardLabel(card, face, side = 'light') {
  const f = face || card;
  if (!f) return 'Card';
  const color = (f.color || '').toLowerCase();
  if (f.type === 'number') {
    return `${color} ${f.value} (${side} side)`;
  }
  const typeLabel = LABELS[f.type] || f.type || 'Card';
  return (color && color !== 'wild') ? `${color} ${typeLabel} (${side} side)` : `${typeLabel} (${side} side)`;
}

export function renderFlipFace(card, face, side = 'light', mini = false) {
  const imagePath = getFlipCardImagePath(card, face, side);
  const label = getFlipCardLabel(card, face, side);
  const isDark = side === 'dark';
  return `<img class="flip-card-image flip-face-image ${isDark ? 'flip-dark' : 'flip-light'}" src="${imagePath}" alt="${label}" title="${label}" draggable="false" data-side="${side}">`;
}

export function renderFlipBack(side = 'light', mini = false) {
  const isDark = side === 'dark';
  return `<img class="flip-card-image flip-back-image ${isDark ? 'flip-dark' : 'flip-light'}" src="/assets/flip-cards/TOP_CARD.jpg" alt="UNO Flip card back" title="UNO Flip card back" draggable="false">`;
}

