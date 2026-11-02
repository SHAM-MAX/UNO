import { COLOR_METADATA } from '../shared/constants.js';
import { getActiveFace } from '../shared/deck.js';

const FACE_NAMES = {
  skip: 'Skip', reverse: 'Reverse', draw1: 'Draw one', draw2: 'Draw two',
  draw4: 'Draw four', draw5: 'Draw five', flip: 'Flip',
  skip_everyone: 'Skip everyone', discard_all: 'Discard all', wild: 'Wild',
  wild_draw2: 'Wild draw two', wild_draw4: 'Wild draw four',
  wild_reverse_draw4: 'Wild reverse draw four', wild_draw6: 'Wild draw six',
  wild_draw10: 'Wild draw ten', wild_draw_color: 'Wild draw color',
  wild_color_roulette: 'Wild color roulette',
};

const CLASSIC_COLOR_INDEX = { red: 0, yellow: 1, green: 2, blue: 3 };
const CLASSIC_ZERO_COLUMNS = { blue: 0, red: 1, yellow: 2, green: 3 };

function classicSheetFace(card, face) {
  const serial = Number(card.id?.match(/^c-(\d+)$/)?.[1]);
  if (!Number.isInteger(serial) || serial < 1 || serial > 108) return null;

  if (face.color === 'wild') {
    const first = face.type === 'wild_draw4' ? 105 : 101;
    if (face.type !== 'wild' && face.type !== 'wild_draw4') return null;
    return { row: 8, col: (face.type === 'wild_draw4' ? 8 : 4) + ((serial - first) % 4) };
  }

  const colorIndex = CLASSIC_COLOR_INDEX[face.color];
  if (colorIndex === undefined) return null;
  const colorStart = colorIndex * 25;
  const local = serial - 1 - colorStart;

  if (face.type === 'number' && face.value === 0) {
    const zeroCol = CLASSIC_ZERO_COLUMNS[face.color];
    return zeroCol !== undefined ? { row: 8, col: zeroCol } : null;
  }
  if (face.type === 'number' && face.value >= 1 && face.value <= 9) {
    const copy = local - (1 + (face.value - 1) * 2);
    return { row: colorIndex + copy * 4, col: face.value - 1 };
  }

  const actionColumns = { skip: [19, 9], reverse: [21, 10], draw2: [23, 11] };
  const action = actionColumns[face.type];
  if (!action) return null;
  return { row: colorIndex + (local - action[0]) * 4, col: action[1] };
}

export function getCardLabel(face) {
  return face.type === 'number' ? String(face.value) : (FACE_NAMES[face.type] || face.type);
}

function actionGlyph(type, mode) {
  const stroke = mode === 'no_mercy' ? '#101116' : 'currentColor';
  const common = `fill="none" stroke="${stroke}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"`;
  switch (type) {
    case 'draw1': return '+1';
    case 'draw2': return '+2';
    case 'draw4': return '+4';
    case 'draw5': return '+5';
    case 'skip': return `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="34" ${common}/><path d="M27 73 73 27" ${common}/></svg>`;
    case 'reverse': return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M24 35h51l-12-13M76 65H25l12 13" ${common}/><path d="M63 22 75 35 62 48M37 52 25 65l13 13" ${common}/></svg>`;
    case 'flip': return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M25 38a27 27 0 0 1 47-16l8 8M80 30V13M80 30H63M75 62a27 27 0 0 1-47 16l-8-8M20 70v17M20 70h17" ${common}/></svg>`;
    case 'skip_everyone': return `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="34" ${common}/><path d="M27 73 73 27M16 16l68 68" ${common}/></svg>`;
    case 'discard_all': return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M24 30h52M34 30V19h32v11M31 38l4 42h30l4-42M44 43v27M56 43v27" ${common}/></svg>`;
    default: return '';
  }
}

function wildMark(type) {
  const amount = ({ wild_draw2: '+2', wild_draw4: '+4', wild_reverse_draw4: '↻ +4', wild_draw6: '+6', wild_draw10: '+10', wild_draw_color: 'DRAW COLOR', wild_color_roulette: 'ROULETTE' })[type];
  return amount || 'WILD';
}

export function renderCardHTML(card, options = {}) {
  const mode = options.mode || 'classic';
  const flipSide = options.flipSide || 'light';
  const mini = Boolean(options.mini);
  const face = getActiveFace(card, mode, flipSide);
  const metadata = COLOR_METADATA[face.color] || COLOR_METADATA.wild;
  const isWild = face.color === 'wild';
  const isNumber = face.type === 'number';

  if (mode === 'classic') {
    const sprite = classicSheetFace(card, face);
    if (sprite && sprite.row >= 0 && sprite.row < 9 && sprite.col >= 0 && sprite.col < 12) {
      const description = `${getCardLabel(face)}${isWild ? '' : `, ${metadata.name}`}`;
      return `<div class="game-card classic-image-card ${mini ? 'mini' : ''}" role="img" aria-label="${description}" title="${description}"><img class="classic-face-image" src="/assets/classic-cards/r${sprite.row}-c${sprite.col}.png" alt="" draggable="false"></div>`;
    }
  }
  const modeClass = mode === 'flip' ? `flip-${flipSide}` : mode;
  const value = isNumber ? String(face.value) : wildMark(face.type);
  const action = isWild ? value : (isNumber ? value : actionGlyph(face.type, mode));
  const corner = isNumber ? value : (isWild ? value : ({ skip: '⊘', reverse: '↻', draw1: '+1', draw2: '+2', draw4: '+4', draw5: '+5', flip: '⇄', skip_everyone: '⦸', discard_all: 'ALL' })[face.type] || '•');
  const background = isWild ? '#171923' : metadata.bgHex;
  const foreground = face.color === 'yellow' || face.color === 'orange' ? '#171923' : '#fffdf5';
  const border = mode === 'flip' ? (flipSide === 'dark' ? '#101116' : '#fffdf5') : '#fffdf5';
  const wildPalette = mode === 'flip' && flipSide === 'dark'
    ? 'wild-pink wild-teal wild-orange wild-purple'
    : 'wild-red wild-yellow wild-green wild-blue';
  const wildSlices = isWild ? wildPalette.split(' ').map((slice) => `<span class="wild-slice ${slice}"></span>`).join('') : '';
  const faceArtwork = isWild
    ? `<div class="card-wild-center"><div class="wild-pie">${wildSlices}</div><span class="wild-main-label">${value}</span></div>`
    : isNumber
      ? `<span class="card-number">${value}</span>`
      : `<div class="card-action-center"><span class="action-mark">${action}</span><span class="action-caption">${getCardLabel(face)}</span></div>`;
  const nmStyle = mode === 'no_mercy' ? 'nm-card' : '';
  const colorShape = metadata.symbol || '';
  const sideName = mode === 'flip' ? ` ${flipSide} side` : '';

  return `<div class="game-card ${modeClass} ${nmStyle} ${mini ? 'mini' : ''} ${isWild ? 'wild-card' : ''} ${isNumber ? 'number-card' : 'action-card'}" style="--face-bg:${background};--face-fg:${foreground};--face-border:${border};--face-accent:${metadata.borderHex || '#f2bd32'}" role="img" aria-label="${getCardLabel(face)}${face.color === 'wild' ? '' : `, ${metadata.name}`}${sideName}">
    ${mode === 'no_mercy' ? '<span class="mercy-burst" aria-hidden="true"></span>' : ''}
    <span class="card-corner top-left"><b>${corner}</b><i>${colorShape}</i></span>
    <span class="card-center-oval" aria-hidden="true"></span>
    <span class="card-art">${faceArtwork}</span>
    <span class="card-corner bottom-right" aria-hidden="true"><b>${corner}</b><i>${colorShape}</i></span>
  </div>`;
}

export function renderCardBackHTML(isDark = false, mini = false, mode = 'classic') {
  if (mode === 'classic') {
    return `<div class="game-card classic-image-card classic-image-back ${mini ? 'mini' : ''}" aria-label="UNO card back" role="img"><img class="classic-back-image" src="/assets/uno-classic-back.png" alt="" draggable="false"></div>`;
  }
  return `<div class="game-card back-face ${isDark ? 'flip-back' : ''} ${mini ? 'mini' : ''}" aria-hidden="true"><div class="card-back-oval ${isDark ? 'dark-mode' : ''}"><span class="card-back-text">${isDark ? 'FLIP' : 'UNO'}</span></div></div>`;
}
