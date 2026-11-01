import { COLOR_METADATA } from '../shared/constants.js';
import { getActiveFace } from '../shared/deck.js';

export function getCardLabel(face) {
  if (face.type === 'number') {
    return face.value.toString();
  }
  switch (face.type) {
    case 'skip': return 'SKIP';
    case 'reverse': return '⇄ REV';
    case 'draw1': return '+1';
    case 'draw2': return '+2';
    case 'draw4': return '+4';
    case 'draw5': return '+5';
    case 'flip': return '⟲ FLIP';
    case 'skip_everyone': return '⛔ ALL';
    case 'discard_all': return '⇊ DUMP';
    case 'wild': return 'WILD';
    case 'wild_draw2': return 'WILD +2';
    case 'wild_draw4': return 'WILD +4';
    case 'wild_reverse_draw4': return '⇄ +4';
    case 'wild_draw6': return 'WILD +6';
    case 'wild_draw10': return 'WILD +10';
    case 'wild_draw_color': return 'COLOR';
    case 'wild_color_roulette': return 'ROULETTE';
    default: return face.type.toUpperCase();
  }
}

export function renderCardHTML(card, options = {}) {
  const mode = options.mode || 'classic';
  const flipSide = options.flipSide || 'light';
  const mini = options.mini || false;

  const face = getActiveFace(card, mode, flipSide);
  const colorMeta = COLOR_METADATA[face.color] || COLOR_METADATA.wild;
  const label = getCardLabel(face);

  const isWild = face.color === 'wild';
  const bgStyle = isWild ? '' : `background-color: ${colorMeta.bgHex}; border-color: ${colorMeta.borderHex}; color: ${colorMeta.textHex};`;

  let centerContent = '';
  if (isWild) {
    const isDark = flipSide === 'dark';
    centerContent = `
      <div class="wild-quad-circle">
        <div class="quad-slice ${isDark ? 'quad-dark-1' : 'quad-1'}"></div>
        <div class="quad-slice ${isDark ? 'quad-dark-2' : 'quad-2'}"></div>
        <div class="quad-slice ${isDark ? 'quad-dark-3' : 'quad-3'}"></div>
        <div class="quad-slice ${isDark ? 'quad-dark-4' : 'quad-4'}"></div>
      </div>
      <div class="center-text-label" style="color: white; margin-top: 4px;">${label}</div>
    `;
  } else if (face.type === 'number') {
    centerContent = `
      <div class="center-val">${face.value}</div>
    `;
  } else {
    centerContent = `
      <div class="center-text-label">${label}</div>
    `;
  }

  const cornerValue = face.type === 'number' ? face.value : (label.startsWith('+') ? label : label.slice(0, 4));

  return `
    <div class="game-card ${mini ? 'mini' : ''} color-${face.color}" style="${bgStyle}">
      <!-- Top Left Corner -->
      <div class="card-corner top-left">
        <span class="corner-val">${cornerValue}</span>
        <span class="corner-symbol">${colorMeta.symbol}</span>
      </div>

      <!-- Center -->
      <div class="card-center">
        ${centerContent}
      </div>

      <!-- Accessibility Badge -->
      <div class="access-badge">
        ${colorMeta.symbol} ${colorMeta.name}
      </div>

      <!-- Bottom Right Corner -->
      <div class="card-corner bottom-right">
        <span class="corner-val">${cornerValue}</span>
        <span class="corner-symbol">${colorMeta.symbol}</span>
      </div>
    </div>
  `;
}

export function renderCardBackHTML(isDark = false, mini = false) {
  return `
    <div class="game-card back-face ${mini ? 'mini' : ''}">
      <div class="card-back-oval ${isDark ? 'dark-mode' : ''}">
        <span class="card-back-text">${isDark ? 'FLIP' : 'UNO'}</span>
      </div>
    </div>
  `;
}

