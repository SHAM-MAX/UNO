const COLORS = { red: '#ed252a', yellow: '#ffd326', green: '#15964b', blue: '#1686d0', wild: '#101012' };
const TYPES = new Set(['number', 'skip', 'reverse', 'draw2', 'draw4', 'discard_all', 'skip_everyone', 'wild_reverse_draw4', 'wild_draw6', 'wild_draw10', 'wild_color_roulette']);
const LABELS = {
  skip: 'Skip',
  reverse: 'Reverse',
  draw2: 'Draw two',
  draw4: 'Draw four',
  discard_all: 'Discard all',
  skip_everyone: 'Skip everyone',
  wild_reverse_draw4: 'Wild reverse draw four',
  wild_draw6: 'Wild draw six',
  wild_draw10: 'Wild draw ten',
  wild_color_roulette: 'Wild color roulette'
};

export function noMercyFaceKey(face) {
  if (!face || !TYPES.has(face.type) || !COLORS[face.color]) throw new Error('Unknown No Mercy card face');
  if (face.type === 'number' && (!Number.isInteger(face.value) || face.value < 0 || face.value > 9 || face.color === 'wild')) throw new Error('Invalid No Mercy number');
  if (face.type.startsWith('wild_') !== (face.color === 'wild')) throw new Error('Invalid No Mercy colour/type');
  return `${face.color}:${face.type}${face.type === 'number' ? `:${face.value}` : ''}`;
}

export function getNoMercyCardImagePath(card, face) {
  const c = card || {};
  const f = face || c;
  const type = f.type || c.type;
  const color = (f.color || c.color || 'wild').toLowerCase();
  const val = f.value !== undefined ? f.value : c.value;

  // Wild Cards
  if (type === 'wild_reverse_draw4' || type === 'wild_draw4') return '/assets/no-mercy-cards/wild_draw4.webp';
  if (type === 'wild_draw6') return '/assets/no-mercy-cards/wild_draw6.webp';
  if (type === 'wild_draw10') return '/assets/no-mercy-cards/wild_draw10.webp';
  if (type === 'wild_color_roulette' || type === 'wild_roulette') return '/assets/no-mercy-cards/wild_roulette.webp';

  // Number Cards
  if (type === 'number' && val !== undefined) {
    return `/assets/no-mercy-cards/${color}_${val}.webp`;
  }

  // Action Cards
  if (type === 'skip') return `/assets/no-mercy-cards/${color}_skip.webp`;
  if (type === 'skip_everyone' || type === 'skip_all') return `/assets/no-mercy-cards/${color}_skip_all.webp`;
  if (type === 'reverse') return `/assets/no-mercy-cards/${color}_reverse.webp`;
  if (type === 'draw2') return `/assets/no-mercy-cards/${color}_draw2.webp`;
  if (type === 'draw4') return `/assets/no-mercy-cards/${color}_draw4.webp`;
  if (type === 'discard_all') return `/assets/no-mercy-cards/${color}_discard_all.webp`;

  return null;
}

export function getNoMercyCardLabel(card, face) {
  const c = card || {};
  const f = face || c;
  const type = f.type || c.type;
  const color = (f.color || c.color || '').toLowerCase();
  const val = f.value !== undefined ? f.value : c.value;

  if (type === 'number' && val !== undefined) {
    return `${color} ${val}`;
  }
  const typeLabel = LABELS[type] || type || 'Card';
  return (color && color !== 'wild') ? `${color} ${typeLabel}` : typeLabel;
}

export function renderNoMercyFace(cardOrFace, explicitFace = null, mini = false) {
  const card = explicitFace ? cardOrFace : (cardOrFace?.id ? cardOrFace : null);
  const face = explicitFace || cardOrFace;
  const key = noMercyFaceKey(face);
  const imagePath = getNoMercyCardImagePath(card, face);
  const label = getNoMercyCardLabel(card, face);
  if (!imagePath) {
    return `<div class="nm-card-fallback" data-face="${key}">${label}</div>`;
  }
  return `<img class="nm-card-image nm-face-image nm-vector-face" src="${imagePath}" alt="${label}" title="${label}" draggable="false" data-face="${key}">`;
}

export function renderNoMercyBack(mini = false) {
  return '<img class="nm-card-image nm-back-image nm-vector-face" src="/assets/no-mercy-cards/card_back.webp" alt="No Mercy card back" title="No Mercy card back" draggable="false">';
}
