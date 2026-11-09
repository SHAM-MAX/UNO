import { renderNoMercyFace, renderNoMercyBack, noMercyFaceKey, getNoMercyCardLabel, getNoMercyCardImagePath } from './noMercyGraphics.js';
import { renderClassicFace, renderClassicBack, getClassicCardLabel, getClassicCardImagePath } from './classicGraphics.js';
import { renderFlipFace, renderFlipBack, getFlipCardLabel, getFlipCardImagePath } from './flipGraphics.js';
import { getActiveFace } from '../shared/deck.js';

export {
  renderNoMercyFace,
  renderNoMercyBack,
  noMercyFaceKey,
  getNoMercyCardLabel,
  getNoMercyCardImagePath,
  renderClassicFace,
  renderClassicBack,
  getClassicCardLabel,
  getClassicCardImagePath,
  renderFlipFace,
  renderFlipBack,
  getFlipCardLabel,
  getFlipCardImagePath
};

// Legacy helper for backwards compatibility with classic sprite references
const CLASSIC_COLOR_INDEX = { red: 0, yellow: 1, green: 2, blue: 3 };
const CLASSIC_ZERO_COLUMNS = { blue: 0, red: 1, yellow: 2, green: 3 };

export function classicSheetFace(card, face) {
  const serial = Number(card?.id?.match(/^c-(\d+)$/)?.[1]);
  if (!Number.isInteger(serial) || serial < 1 || serial > 108) return null;
  const f = face || card;
  if (!f) return null;

  if (f.color === 'wild') {
    const first = f.type === 'wild_draw4' ? 105 : 101;
    if (f.type !== 'wild' && f.type !== 'wild_draw4') return null;
    return { row: 8, col: (f.type === 'wild_draw4' ? 8 : 4) + ((serial - first) % 4) };
  }

  const colorIndex = CLASSIC_COLOR_INDEX[f.color];
  if (colorIndex === undefined) return null;
  const colorStart = colorIndex * 25;
  const local = serial - 1 - colorStart;

  if (f.type === 'number' && f.value === 0) {
    const zeroCol = CLASSIC_ZERO_COLUMNS[f.color];
    return zeroCol !== undefined ? { row: 8, col: zeroCol } : null;
  }
  if (f.type === 'number' && f.value >= 1 && f.value <= 9) {
    const copy = local - (1 + (f.value - 1) * 2);
    return { row: colorIndex + copy * 4, col: f.value - 1 };
  }

  const actionColumns = { skip: [19, 9], reverse: [21, 10], draw2: [23, 11] };
  const action = actionColumns[f.type];
  if (!action) return null;
  return { row: colorIndex + (local - action[0]) * 4, col: action[1] };
}

export function getCardLabel(face, mode = 'classic', flipSide = 'light') {
  if (!face) return 'Card';
  if (mode === 'no_mercy') return getNoMercyCardLabel(face, face);
  if (mode === 'flip') return getFlipCardLabel(face, face, flipSide);
  return getClassicCardLabel(face, face);
}

export function renderCardHTML(card, options = {}) {
  const mode = options.mode || 'classic';
  const flipSide = options.flipSide || 'light';
  const mini = Boolean(options.mini);
  const face = getActiveFace(card, mode, flipSide);

  // 1. NO MERCY MODE: Dedicated authentic WebP card system
  if (mode === 'no_mercy') {
    const key = noMercyFaceKey(face);
    const label = getNoMercyCardLabel(card, face);
    return `<div class="game-card nm-card nm-image-card nm-vector-card ${mini ? 'mini' : ''}" data-face="${key}" role="img" aria-label="${label}" title="${label}">
      ${renderNoMercyFace(card, face, mini)}
    </div>`;
  }

  // 2. UNO FLIP MODE: Dedicated dual-sided Light/Dark authentic card system
  if (mode === 'flip') {
    const isDark = flipSide === 'dark';
    const label = getFlipCardLabel(card, face, flipSide);
    return `<div class="game-card flip-card flip-image-card ${isDark ? 'flip-dark' : 'flip-light'} ${mini ? 'mini' : ''}" role="img" aria-label="${label}" title="${label}" data-side="${flipSide}">
      ${renderFlipFace(card, face, flipSide, mini)}
    </div>`;
  }

  // 3. CLASSIC UNO MODE: Dedicated authentic vector SVG card system
  const label = getClassicCardLabel(card, face);
  return `<div class="game-card classic-card classic-image-card ${mini ? 'mini' : ''}" role="img" aria-label="${label}" title="${label}">
    ${renderClassicFace(card, face, mini)}
  </div>`;
}

export function renderCardBackHTML(isDark = false, mini = false, mode = 'classic') {
  if (mode === 'no_mercy') {
    return `<div class="game-card nm-card nm-image-card nm-image-back nm-vector-card ${mini ? 'mini' : ''}" role="img" aria-label="No Mercy card back" title="No Mercy card back">
      ${renderNoMercyBack(mini)}
    </div>`;
  }
  if (mode === 'flip') {
    return `<div class="game-card flip-card flip-image-card flip-image-back ${isDark ? 'flip-dark' : 'flip-light'} ${mini ? 'mini' : ''}" role="img" aria-label="UNO Flip card back" title="UNO Flip card back">
      ${renderFlipBack(isDark ? 'dark' : 'light', mini)}
    </div>`;
  }
  return `<div class="game-card classic-card classic-image-card classic-image-back ${mini ? 'mini' : ''}" role="img" aria-label="Classic UNO card back" title="Classic UNO card back">
    ${renderClassicBack(mini)}
  </div>`;
}
