import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistentRoomStore } from '../src/db.js';
import { RoomManager } from '../src/roomManager.js';
import { isCardPlayable } from '../../shared/rules.js';

function card(id, color = 'red', type = 'number', value = 0) {
  return { id, color, type, value, front: `${color}_${value}.webp` };
}

function setupRoom(mode = 'no_mercy', numPlayers = 3) {
  const store = new PersistentRoomStore();
  const rm = new RoomManager(store);
  const { roomId, playerId: p1, sessionToken: s1 } = rm.createRoom('Alice', mode);
  const ids = [p1];
  const tokens = [s1];
  for (let i = 2; i <= numPlayers; i++) {
    const name = i === 2 ? 'Bob' : 'Charlie';
    const { playerId, sessionToken } = rm.joinRoom(roomId, name);
    ids.push(playerId);
    tokens.push(sessionToken);
  }
  rm.startGame(roomId, p1);
  const room = rm.getRoom(roomId);
  room.currentTurn = 0;
  room.direction = 1;
  room.pendingAction = null;
  room.pendingDrawPenalty = 0;
  room.turnDrawnCard = false;
  room.turnDrawnCardId = null;
  room.turnDrawnCount = 0;
  room.turnDrawnPlayable = false;
  room.activeColor = 'green';
  room.topDiscard = card('top-discard', 'green', 'number', 5);
  room.discardPile = [card('top-discard', 'green', 'number', 5)];
  return { rm, room, ids, tokens, roomId };
}

test('A. Optional drawing: Player has playable cards in hand but can voluntarily draw from deck', () => {
  const { rm, room, ids, roomId } = setupRoom();
  // Alice has matching green 3 and matching 5 in hand
  room.playerHands[ids[0]] = [
    card('g3', 'green', 'number', 3),
    card('b5', 'blue', 'number', 5),
    card('r8', 'red', 'number', 8),
  ];
  room.drawPile = [card('drawn-r1', 'red', 'number', 1)];

  const viewBefore = rm.getClientView(roomId, ids[0]);
  assert.equal(viewBefore.isMyTurn, true);
  assert.equal(viewBefore.canPlayCards.length, 2, 'Alice has 2 playable cards in hand');
  assert.equal(viewBefore.canDraw, true, 'Draw pile MUST remain enabled even with playable cards in hand');
  assert.equal(viewBefore.canPass, false, 'Cannot pass before drawing or playing');

  // Alice chooses to voluntarily draw instead of playing
  const drawRes = rm.drawCard(roomId, ids[0]);
  assert.ok(drawRes.success, 'Voluntary draw must succeed');
  assert.equal(drawRes.drawnCards.length, 1, 'Draws exactly 1 card');
  assert.equal(drawRes.drawnCards[0].id, 'drawn-r1');
  assert.equal(drawRes.isPlayable, false);
  assert.equal(room.playerHands[ids[0]].length, 4, 'Hand increased by 1 card');
  assert.equal(room.turnDrawnCount, 1);
  assert.equal(room.turnDrawnPlayable, false);
});

test('B & C. Sequential voluntary draws: Each click draws exactly one card until playable', () => {
  const { rm, room, ids, roomId } = setupRoom();
  room.playerHands[ids[0]] = [card('held-r2', 'red', 'number', 2)];
  // Deck sequence: unplayable, unplayable, playable
  room.drawPile = [
    card('unplayable-1', 'blue', 'number', 1),
    card('unplayable-2', 'yellow', 'number', 7),
    card('playable-3', 'green', 'number', 9), // Matches activeColor green
    card('extra', 'red', 'number', 0),
  ];

  // Draw 1
  const d1 = rm.drawCard(roomId, ids[0]);
  assert.ok(d1.success);
  assert.equal(d1.drawnCards[0].id, 'unplayable-1');
  assert.equal(room.turnDrawnCount, 1);
  assert.equal(room.turnDrawnPlayable, false);
  const view1 = rm.getClientView(roomId, ids[0]);
  assert.equal(view1.canDraw, true, 'Deck remains enabled after unplayable draw');
  assert.equal(view1.canPass, true, 'Player can pass after drawing');

  // Draw 2
  const d2 = rm.drawCard(roomId, ids[0]);
  assert.ok(d2.success);
  assert.equal(d2.drawnCards[0].id, 'unplayable-2');
  assert.equal(room.turnDrawnCount, 2);
  assert.equal(room.turnDrawnPlayable, false);
  const view2 = rm.getClientView(roomId, ids[0]);
  assert.equal(view2.canDraw, true, 'Deck remains enabled after second unplayable draw');
  assert.equal(view2.canPass, true, 'Player can pass after second draw');

  // Draw 3 (Playable card drawn)
  const d3 = rm.drawCard(roomId, ids[0]);
  assert.ok(d3.success);
  assert.equal(d3.drawnCards[0].id, 'playable-3');
  assert.equal(d3.isPlayable, true);
  assert.equal(room.turnDrawnCount, 3);
  assert.equal(room.turnDrawnPlayable, true);

  const view3 = rm.getClientView(roomId, ids[0]);
  assert.equal(view3.canDraw, false, 'Deck MUST become locked once a playable card is drawn');
  assert.equal(view3.canPass, true, 'Player can choose to pass');
  assert.deepEqual(view3.canPlayCards, ['playable-3'], 'Only the drawn playable card is playable');

  // Draw 4 attempt: Must be rejected by server
  const d4 = rm.drawCard(roomId, ids[0]);
  assert.equal(d4.success, false, 'Server must reject draw once draw pile is locked');
  assert.match(d4.error, /locked/i);
});

test('D. Pass Turn after voluntary drawing: Advances turn and keeps all drawn cards', () => {
  const { rm, room, ids, roomId } = setupRoom();
  room.playerHands[ids[0]] = [card('initial-1', 'blue', 'number', 1)];
  room.drawPile = [
    card('drawn-1', 'red', 'number', 2),
    card('drawn-2', 'yellow', 'number', 3),
  ];

  rm.drawCard(roomId, ids[0]);
  rm.drawCard(roomId, ids[0]);
  assert.equal(room.playerHands[ids[0]].length, 3, 'Alice has 3 cards (1 initial + 2 drawn)');

  // Alice chooses to pass
  const passRes = rm.passTurn(roomId, ids[0]);
  assert.ok(passRes.success, 'Pass turn must succeed');
  assert.equal(room.currentTurn, 1, 'Turn advances to Bob (seat 1)');
  assert.equal(room.playerHands[ids[0]].length, 3, 'Drawn cards remain safely in Alice hand');
  assert.equal(room.turnDrawnCount, 0, 'Turn draw count reset for next player');
  assert.equal(room.turnDrawnPlayable, false, 'Turn draw playable reset for next player');
  assert.equal(room.turnDrawnCard, false, 'turnDrawnCard reset');

  // Bob now acts
  const bobView = rm.getClientView(roomId, ids[1]);
  assert.equal(bobView.isMyTurn, true);
  assert.equal(bobView.canPass, false, 'Bob cannot pass before drawing or playing');
});

test('E, F, G. Playable drawn card variations trigger draw lock immediately', () => {
  // E. Color match triggers lock
  {
    const { rm, room, ids, roomId } = setupRoom();
    room.activeColor = 'blue';
    room.topDiscard = card('top-blue', 'blue', 'number', 9);
    room.drawPile = [card('drawn-blue', 'blue', 'number', 4)];
    rm.drawCard(roomId, ids[0]);
    assert.equal(room.turnDrawnPlayable, true);
    assert.equal(rm.getClientView(roomId, ids[0]).canDraw, false);
  }

  // F. Action/symbol match triggers lock
  {
    const { rm, room, ids, roomId } = setupRoom();
    room.activeColor = 'red';
    room.topDiscard = card('top-skip', 'red', 'skip');
    // Drawn card is blue skip (same symbol/action)
    room.drawPile = [card('drawn-blue-skip', 'blue', 'skip')];
    rm.drawCard(roomId, ids[0]);
    assert.equal(room.turnDrawnPlayable, true, 'Symbol match makes action card playable');
    assert.equal(rm.getClientView(roomId, ids[0]).canDraw, false);
  }

  // G. Wild card triggers lock
  {
    const { rm, room, ids, roomId } = setupRoom();
    room.activeColor = 'yellow';
    room.topDiscard = card('top-yellow', 'yellow', 'number', 2);
    room.drawPile = [card('drawn-wild', 'wild', 'wild_draw6')];
    rm.drawCard(roomId, ids[0]);
    assert.equal(room.turnDrawnPlayable, true, 'Playable Wild card triggers draw lock');
    assert.equal(rm.getClientView(roomId, ids[0]).canDraw, false);
  }
});

test('H & J. Rejections: Drawing during opponent turn and repeat draw after lock', () => {
  const { rm, room, ids, roomId } = setupRoom();
  // J. Bob attempts to draw during Alice's turn
  const nonTurnDraw = rm.drawCard(roomId, ids[1]);
  assert.equal(nonTurnDraw.success, false);
  assert.match(nonTurnDraw.error, /not your turn/i);

  // Bob attempts to pass during Alice's turn
  const nonTurnPass = rm.passTurn(roomId, ids[1]);
  assert.equal(nonTurnPass.success, false);
  assert.match(nonTurnPass.error, /not your turn/i);

  // Alice draws playable card
  room.drawPile = [card('drawn-green', 'green', 'number', 1)];
  rm.drawCard(roomId, ids[0]);
  assert.equal(room.turnDrawnPlayable, true);

  // H. Alice attempts to draw again after draw pile is locked
  const lockDraw = rm.drawCard(roomId, ids[0]);
  assert.equal(lockDraw.success, false);
  assert.match(lockDraw.error, /locked/i);
});

test('K. Mandatory penalty stacking regression: Cannot pass to escape penalty; penalty draw takes all accumulated cards', () => {
  const { rm, room, ids, roomId } = setupRoom();
  // Bob stacked a +6 onto Alice
  room.pendingDrawPenalty = 6;
  room.playerHands[ids[0]] = [card('a1', 'red', 'number', 1), card('a2', 'blue', 'number', 2)];
  room.drawPile = Array.from({ length: 10 }, (_, i) => card(`pen-${i}`, 'yellow', 'number', i));

  // Alice cannot pass to escape penalty
  const passAttempt = rm.passTurn(roomId, ids[0]);
  assert.equal(passAttempt.success, false, 'Server must never allow passing to bypass mandatory penalty');

  // Alice resolves penalty by drawing
  const penaltyDraw = rm.drawCard(roomId, ids[0]);
  assert.ok(penaltyDraw.success);
  assert.equal(penaltyDraw.drawnCards.length, 6, 'Alice must draw all 6 penalty cards');
  assert.equal(room.pendingDrawPenalty, 0, 'Penalty cleared');
  assert.equal(room.currentTurn, 1, 'Turn moves to Bob after taking penalty');
  assert.equal(room.playerHands[ids[0]].length, 8, 'Alice now has 2 + 6 = 8 cards');
});

test('L. Player reconnects during voluntary draw sequence: Exact drawing state is restored', () => {
  const { rm, room, ids, roomId } = setupRoom();
  room.playerHands[ids[0]] = [card('initial', 'red', 'number', 9)];
  room.drawPile = [
    card('drawn-unplayable-1', 'blue', 'number', 1),
    card('drawn-unplayable-2', 'yellow', 'number', 3),
  ];

  // Alice draws 2 cards
  rm.drawCard(roomId, ids[0]);
  rm.drawCard(roomId, ids[0]);
  assert.equal(room.turnDrawnCount, 2);
  assert.equal(room.turnDrawnPlayable, false);

  // Simulate client reconnect: getClientView restores state
  const restoredView = rm.getClientView(roomId, ids[0]);
  assert.equal(restoredView.isMyTurn, true);
  assert.equal(restoredView.canDraw, true, 'Restored state allows continued voluntary drawing');
  assert.equal(restoredView.canPass, true, 'Restored state allows passing');
  assert.equal(restoredView.gameState.turnDrawnCount, 2, 'Restored count is 2');
  assert.equal(restoredView.gameState.turnDrawnPlayable, false, 'Restored playability is false');
  assert.equal(restoredView.myHand.length, 3, 'Restored hand has 3 cards');
});

test('Reshuffle on voluntary draw when draw pile is empty', () => {
  const { rm, room, ids, roomId } = setupRoom();
  room.drawPile = [];
  room.discardPile = [
    card('old-1', 'yellow', 'number', 1),
    card('old-2', 'blue', 'number', 2),
    card('top-discard', 'green', 'number', 5),
  ];
  room.mercyPile = [card('mercy-1', 'red', 'number', 3)];

  const drawRes = rm.drawCard(roomId, ids[0]);
  assert.ok(drawRes.success, 'Draw from empty pile triggers automatic reshuffle');
  assert.equal(drawRes.drawnCards.length, 1);
  assert.equal(room.discardPile.length, 1, 'Top discard preserved in discard pile');
  assert.equal(room.discardPile[0].id, 'top-discard');
});
