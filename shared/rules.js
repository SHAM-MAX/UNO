import { getActiveFace } from './deck.js';
import { NO_MERCY_MAX_CARDS } from './constants.js';

export function defaultHouseRules(mode = 'classic') {
  const common = {
    missedUnoPenalty: 2,
    startingHandSize: 7,
    turnDuration: 30,
  };

  if (mode === 'no_mercy') {
    return {
      ...common,
      stackingAllowed: true,
      drawUntilPlayable: true,
      sevenZeroSwap: true,
      mercyKnockout: true,
      mercyKnockoutLimit: NO_MERCY_MAX_CARDS,
    };
  }

  if (mode === 'flip') {
    return {
      ...common,
      stackingAllowed: false,
      drawUntilPlayable: false,
    };
  }

  // Classic
  return {
    ...common,
    stackingAllowed: false,
    drawUntilPlayable: false,
    sevenZeroSwap: false,
    wildDraw4Challenge: true,
  };
}

export function getCardDrawPenalty(card, mode = 'classic', flipSide = 'light') {
  const face = getActiveFace(card, mode, flipSide);
  switch (face.type) {
    case 'draw1':
      return 1;
    case 'draw2':
    case 'wild_draw2':
      return 2;
    case 'draw4':
    case 'wild_draw4':
    case 'wild_reverse_draw4':
      return 4;
    case 'draw5':
      return 5;
    case 'wild_draw6':
      return 6;
    case 'wild_draw10':
      return 10;
    default:
      return 0;
  }
}

export function canStackCard(card, mode, flipSide, currentPenalty, topCard, houseRules = {}) {
  if (currentPenalty <= 0) return false;

  const cardPenalty = getCardDrawPenalty(card, mode, flipSide);
  if (cardPenalty <= 0) return false;

  if (mode === 'no_mercy') {
    if (houseRules.stackingAllowed === false) return false;
    // In No Mercy, a draw card can be played on an active draw penalty if its draw value is EQUAL TO OR HIGHER
    // than the last draw card that initiated or added to the penalty.
    const lastPenalty = topCard ? getCardDrawPenalty(topCard, mode, flipSide) : 0;
    return cardPenalty >= lastPenalty;
  }

  if (houseRules.stackingAllowed) {
    // In Classic house rules: Draw 2 on Draw 2; Wild Draw 4 on Wild Draw 4. In Flip: Draw 1 on Draw 1; Draw 5 on Draw 5
    if (!topCard) return false;
    const topFace = getActiveFace(topCard, mode, flipSide);
    const cardFace = getActiveFace(card, mode, flipSide);
    return cardFace.type === topFace.type;
  }

  return false;
}

export function isCardPlayable(
  card,
  topCard,
  activeColor,
  mode = 'classic',
  flipSide = 'light',
  pendingDrawPenalty = 0,
  houseRules = {}
) {
  if (!topCard) return true;

  // If a draw penalty is pending and stacking is allowed:
  if (pendingDrawPenalty > 0) {
    const isStackingAllowed = mode === 'no_mercy'
      ? houseRules.stackingAllowed !== false
      : Boolean(houseRules.stackingAllowed);

    if (isStackingAllowed) {
      return canStackCard(card, mode, flipSide, pendingDrawPenalty, topCard, houseRules);
    }
    // If stacking is not allowed, no card can be played; player must draw
    return false;
  }

  const cardFace = getActiveFace(card, mode, flipSide);
  const topFace = getActiveFace(topCard, mode, flipSide);

  // Wild cards can always be played (except when blocked by pending draw penalty handled above)
  if (cardFace.color === 'wild') {
    return true;
  }

  // Color match (with activeColor if set, or topCard color)
  const targetColor = activeColor || topFace.color;
  if (cardFace.color === targetColor) {
    return true;
  }

  // Action/Symbol match
  if (cardFace.type === topFace.type) {
    // For number cards, they must also match the number value
    if (cardFace.type === 'number') {
      return cardFace.value === topFace.value;
    }
    return true;
  }

  return false;
}

export function getPlayableCardIds(
  hand,
  topCard,
  activeColor,
  mode = 'classic',
  flipSide = 'light',
  pendingDrawPenalty = 0,
  houseRules = {}
) {
  return (hand || [])
    .filter((card) => isCardPlayable(card, topCard, activeColor, mode, flipSide, pendingDrawPenalty, houseRules))
    .map((card) => card.id);
}

export function getNextPlayerIndex(
  currentIndex,
  direction = 1,
  players = [],
  step = 1
) {
  if (!players.some(p => !p.isEliminated)) return currentIndex;
  let index = currentIndex;
  for (let n = 0; n < step; n++) {
    do { index = (index + direction + players.length) % players.length; }
    while (players[index].isEliminated);
  }
  return index;
}

export function checkWinCondition(players = [], hands = {}, mode = 'classic') {
  // 1. Any player with 0 cards wins
  for (const player of players) {
    if (!player.isEliminated) {
      const hand = hands[player.id];
      if (hand && hand.length === 0) {
        return {
          winnerId: player.id,
          reason: `${player.name} played all their cards!`,
        };
      }
    }
  }

  // 2. In No Mercy: Last player standing when all others are eliminated
  if (mode === 'no_mercy') {
    const activePlayers = players.filter((p) => !p.isEliminated);
    if (activePlayers.length === 1 && players.length > 1) {
      return {
        winnerId: activePlayers[0].id,
        reason: `${activePlayers[0].name} is the last player standing! All other players were knocked out by Mercy!`,
      };
    }
  }

  return { winnerId: null, reason: null };
}

export function checkMercyKnockout(player, hand = [], mode = 'classic', houseRules = {}) {
  if (mode !== 'no_mercy' || houseRules.mercyKnockout === false) return false;
  const limit = Number(houseRules.mercyKnockoutLimit) || NO_MERCY_MAX_CARDS;
  return hand.length >= limit;
}

export function calculateScore(hand = [], mode = 'classic', flipSide = 'light') {
  return hand.reduce((total, card) => {
    const face = getActiveFace(card, mode, flipSide);
    if (face.type === 'number') {
      return total + (face.value || 0);
    }
    if (face.color === 'wild') {
      return total + 50;
    }
    return total + 20; // Action cards
  }, 0);
}

