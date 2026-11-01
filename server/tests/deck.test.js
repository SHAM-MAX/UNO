import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createClassicDeck,
  createFlipDeck,
  createNoMercyDeck,
  getActiveFace,
} from '../../shared/deck.js';

test('Classic Deck: Composition must be exactly 108 cards', () => {
  const deck = createClassicDeck();
  assert.equal(deck.length, 108, 'Classic deck must contain 108 cards');

  // Verify colors
  const colors = { red: 0, yellow: 0, green: 0, blue: 0, wild: 0 };
  const types = {};

  for (const card of deck) {
    colors[card.color] = (colors[card.color] || 0) + 1;
    types[card.type] = (types[card.type] || 0) + 1;
  }

  assert.equal(colors.red, 25, '25 red cards');
  assert.equal(colors.yellow, 25, '25 yellow cards');
  assert.equal(colors.green, 25, '25 green cards');
  assert.equal(colors.blue, 25, '25 blue cards');
  assert.equal(colors.wild, 8, '8 wild cards (4 Wild + 4 Wild Draw 4)');

  assert.equal(types.wild, 4, '4 regular wild cards');
  assert.equal(types.wild_draw4, 4, '4 wild draw 4 cards');
  assert.equal(types.skip, 8, '8 skip cards (2 per color)');
  assert.equal(types.reverse, 8, '8 reverse cards (2 per color)');
  assert.equal(types.draw2, 8, '8 draw two cards (2 per color)');
  assert.equal(types.number, 76, '76 number cards (1x 0 and 2x 1-9 per color)');
});

test('Flip Deck: Composition must be exactly 112 double-sided cards', () => {
  const deck = createFlipDeck();
  assert.equal(deck.length, 112, 'Flip deck must contain 112 cards');

  for (const card of deck) {
    assert.ok(card.light, 'Every card must have a light face');
    assert.ok(card.dark, 'Every card must have a dark face');
    assert.ok(['red', 'yellow', 'green', 'blue', 'wild'].includes(card.light.color), 'Light color valid');
    assert.ok(['teal', 'orange', 'pink', 'purple', 'wild'].includes(card.dark.color), 'Dark color valid');
  }

  // Check special flip actions on light side
  const lightFlips = deck.filter((c) => c.light.type === 'flip');
  assert.equal(lightFlips.length, 8, '8 Flip cards on Light side (2 per color)');

  // Check special flip actions on dark side
  const darkFlips = deck.filter((c) => c.dark.type === 'flip');
  assert.equal(darkFlips.length, 8, '8 Flip cards on Dark side (2 per color)');

  // Check dark side extremes
  const darkDraw5 = deck.filter((c) => c.dark.type === 'draw5');
  assert.equal(darkDraw5.length, 8, '8 Draw 5 cards on Dark side');

  const darkSkipEveryone = deck.filter((c) => c.dark.type === 'skip_everyone');
  assert.equal(darkSkipEveryone.length, 8, '8 Skip Everyone cards on Dark side');

  const darkDrawColor = deck.filter((c) => c.dark.type === 'wild_draw_color');
  assert.equal(darkDrawColor.length, 4, '4 Wild Draw Color cards on Dark side');
});

test('No Mercy Deck: Composition must be exactly 168 cards with all extreme actions', () => {
  const deck = createNoMercyDeck();
  assert.equal(deck.length, 168, 'No Mercy deck must contain exactly 168 cards');

  const types = {};
  for (const card of deck) {
    types[card.type] = (types[card.type] || 0) + 1;
  }

  assert.equal(types.skip_everyone, 4, '4 Skip Everyone cards (1 per color)');
  assert.equal(types.discard_all, 8, '8 Discard All cards (2 per color)');
  assert.equal(types.draw4, 8, '8 colored Draw 4 cards (2 per color)');
  assert.equal(types.wild_reverse_draw4, 8, '8 Wild Reverse Draw 4 cards');
  assert.equal(types.wild_draw6, 8, '8 Wild Draw 6 cards');
  assert.equal(types.wild_draw10, 4, '4 Wild Draw 10 cards');
  assert.equal(types.wild_color_roulette, 8, '8 Wild Color Roulette cards');
  assert.equal(types.wild, 8, '8 Regular Wild cards');
});

