const LABELS = {
  skip: 'Skip',
  reverse: 'Reverse',
  draw2: 'Draw two',
  wild: 'Wild',
  wild_draw4: 'Wild draw four'
};

export function getClassicCardImagePath(card, face) {
  const f = face || card;
  if (!f) return '/assets/classic-cards-svg/back.svg';

  if (f.color === 'wild') {
    if (f.type === 'wild_draw4') return '/assets/classic-cards-svg/wild-draw4.svg';
    return '/assets/classic-cards-svg/wild.svg';
  }

  const color = (f.color || '').toLowerCase();
  if (f.type === 'number') {
    return `/assets/classic-cards-svg/${color}-${f.value}.svg`;
  }
  if (f.type === 'skip') return `/assets/classic-cards-svg/${color}-skip.svg`;
  if (f.type === 'reverse') return `/assets/classic-cards-svg/${color}-reverse.svg`;
  if (f.type === 'draw2') return `/assets/classic-cards-svg/${color}-draw2.svg`;

  return '/assets/classic-cards-svg/wild.svg';
}

export function getClassicCardLabel(card, face) {
  const f = face || card;
  if (!f) return 'Card';
  const color = (f.color || '').toLowerCase();
  if (f.type === 'number') {
    return `${color} ${f.value}`;
  }
  const typeLabel = LABELS[f.type] || f.type || 'Card';
  return (color && color !== 'wild') ? `${color} ${typeLabel}` : typeLabel;
}

export function renderClassicFace(card, face, mini = false) {
  const imagePath = getClassicCardImagePath(card, face);
  const label = getClassicCardLabel(card, face);
  return `<img class="classic-card-image classic-face-image" src="${imagePath}" alt="${label}" title="${label}" draggable="false">`;
}

export function renderClassicBack(mini = false) {
  return '<img class="classic-card-image classic-back-image" src="/assets/classic-cards-svg/back.svg" alt="Classic UNO card back" title="Classic UNO card back" draggable="false">';
}

