import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/roomManager.js';

function createTestSetup(mode = 'no_mercy') {
  const saved = new Map();
  const store = {
    loadAllActiveRooms: () => [],
    saveRoom: (id, mode, state) => saved.set(id, structuredClone(state)),
    saveSession: () => { },
    deleteRoom: (id) => saved.delete(id),
  };
  const rm = new RoomManager(store);
  const { roomId, playerId: p1 } = rm.createRoom('Alice', mode);
  const { playerId: p2 } = rm.joinRoom(roomId, 'Bob');
  const { playerId: p3 } = rm.joinRoom(roomId, 'Charlie');
  rm.setReady(roomId, p1, true);
  rm.setReady(roomId, p2, true);
  rm.setReady(roomId, p3, true);
  rm.startGame(roomId, p1);
  const room = rm.getRoom(roomId);
  return { rm, room, roomId, p1, p2, p3 };
}

function card(id, color = 'red', type = 'number', value = 1) {
  return { id, color, type, ...(type === 'number' ? { value } : {}) };
}

test('Dynamic UNO Scenario A: Player has 2 cards: only their own screen shows canCallUno', () => {
  const { rm, room, roomId, p1, p2, p3 } = createTestSetup();
  room.currentTurn = 0; // p1's turn
  room.activeColor = 'red';
  room.topDiscard = card('top', 'red', 'number', 5);

  room.playerHands[p1] = [card('c1', 'red', 'number', 1), card('c2', 'red', 'number', 2)];
  room.playerHands[p2] = [card('c3', 'blue', 'number', 3), card('c4', 'blue', 'number', 4), card('c5', 'blue', 'number', 5)];
  room.playerHands[p3] = [card('c6', 'green', 'number', 6), card('c7', 'green', 'number', 7)];

  const viewP1 = rm.getClientView(roomId, p1);
  const viewP2 = rm.getClientView(roomId, p2);
  const viewP3 = rm.getClientView(roomId, p3);

  // p1 has 2 cards and it's their turn: canCallUno must be true
  assert.equal(viewP1.canCallUno, true, 'p1 has 2 cards on their turn, canCallUno must be true');

  // p2 has 3 cards: canCallUno must be false
  assert.equal(viewP2.canCallUno, false, 'p2 has 3 cards, canCallUno must be false');

  // p3 has 2 cards but it is NOT their turn: canCallUno must be false
  assert.equal(viewP3.canCallUno, false, 'p3 is not current turn player, canCallUno must be false');
});

test('Dynamic UNO Scenario B: Player arms UNO at 2 cards and plays down to 1: UNO DECLARED and CAUGHT buttons disappear', () => {
  const { rm, room, roomId, p1, p2, p3 } = createTestSetup();
  room.currentTurn = 0; // p1's turn
  room.activeColor = 'red';
  room.topDiscard = card('top', 'red', 'number', 5);

  room.playerHands[p1] = [card('c1', 'red', 'number', 1), card('c2', 'red', 'number', 2)];

  // p1 arms UNO declaration
  const armRes = rm.callUno(roomId, p1);
  assert.equal(armRes.success, true, 'Arming UNO must succeed');
  assert.equal(armRes.armed, true, 'Must indicate armed status');

  // p1 plays card c1 down to 1 card
  const playRes = rm.playCard(roomId, p1, { cardId: 'c1' });
  assert.equal(playRes.success, true, 'Playing card must succeed');

  const player1 = room.players.find(p => p.id === p1);
  assert.equal(player1.hasCalledUno, true, 'p1 hasCalledUno must be true');
  assert.equal(room.playerHands[p1].length, 1, 'p1 hand has 1 card remaining');
  assert.equal(room.unoChallengeWindow, null, 'Catch window must NOT open because UNO was declared');

  // Check client views for opponents
  const viewP2 = rm.getClientView(roomId, p2);
  const viewP3 = rm.getClientView(roomId, p3);
  assert.equal(viewP2.canCatchUno, null, 'Opponent p2 cannot catch p1');
  assert.equal(viewP3.canCatchUno, null, 'Opponent p3 cannot catch p1');
});

test('Dynamic UNO Scenario C & D: Player has 1 card without calling UNO: opponents see CAUGHT and successful catch draws 2 cards', () => {
  const { rm, room, roomId, p1, p2, p3 } = createTestSetup();
  room.currentTurn = 0; // p1's turn
  room.activeColor = 'red';
  room.topDiscard = card('top', 'red', 'number', 5);

  room.playerHands[p1] = [card('c1', 'red', 'number', 1), card('c2', 'red', 'number', 2)];

  // p1 plays card c1 without arming/calling UNO
  const playRes = rm.playCard(roomId, p1, { cardId: 'c1' });
  assert.equal(playRes.success, true);
  assert.equal(room.playerHands[p1].length, 1);

  // Challenge window must be open with p1 as target
  assert.equal(room.unoChallengeWindow?.targetPlayerId, p1);

  // Both opponents must see canCatchUno pointing to p1
  const viewP2 = rm.getClientView(roomId, p2);
  const viewP3 = rm.getClientView(roomId, p3);
  assert.equal(viewP2.canCatchUno, p1, 'p2 must be able to catch p1');
  assert.equal(viewP3.canCatchUno, p1, 'p3 must be able to catch p1');

  // p1 must NOT see canCatchUno on themselves
  const viewP1 = rm.getClientView(roomId, p1);
  assert.equal(viewP1.canCatchUno, null, 'p1 cannot catch themselves');

  // Opponent p2 catches p1
  const catchRes = rm.catchUno(roomId, p2, p1);
  assert.equal(catchRes.success, true, 'Catch must succeed');
  assert.equal(catchRes.targetName, 'Alice');

  // Exactly 2 cards added to p1 (1 original + 2 drawn = 3)
  assert.equal(room.playerHands[p1].length, 3, 'p1 hand must have 3 cards after penalty');
  assert.equal(room.unoChallengeWindow, null, 'Challenge window must be closed after catch');

  // Log and notification check
  assert.equal(room.lastActionMessage, 'CAUGHT! Alice draws 2 cards.');

  // Opponents no longer see canCatchUno
  assert.equal(rm.getClientView(roomId, p2).canCatchUno, null);
  assert.equal(rm.getClientView(roomId, p3).canCatchUno, null);
});

test('Dynamic UNO Scenario E: Player has already called UNO: CAUGHT produces CAUGHT FAILED and no penalty', () => {
  const { rm, room, roomId, p1, p2 } = createTestSetup();
  room.currentTurn = 0;
  room.activeColor = 'red';
  room.topDiscard = card('top', 'red', 'number', 5);

  room.playerHands[p1] = [card('c1', 'red', 'number', 1), card('c2', 'red', 'number', 2)];

  // p1 arms UNO and plays down to 1
  rm.callUno(roomId, p1);
  rm.playCard(roomId, p1, { cardId: 'c1' });

  assert.equal(room.players.find(p => p.id === p1).hasCalledUno, true);
  assert.equal(room.playerHands[p1].length, 1);

  // p2 attempts to catch p1
  const catchRes = rm.catchUno(roomId, p2, p1);
  assert.equal(catchRes.success, false, 'Catch must fail because p1 called UNO');
  assert.match(catchRes.error, /CAUGHT FAILED.*already called UNO/i, 'Must have specific error message');

  // p1 hand remains 1 card (no penalty applied)
  assert.equal(room.playerHands[p1].length, 1, 'Target hand must remain 1 card');
});

test('Dynamic UNO Scenario F: Simultaneous catch race condition: only one catch can succeed', () => {
  const { rm, room, roomId, p1, p2, p3 } = createTestSetup();
  room.currentTurn = 0;
  room.activeColor = 'red';
  room.topDiscard = card('top', 'red', 'number', 5);

  room.playerHands[p1] = [card('c1', 'red', 'number', 1), card('c2', 'red', 'number', 2)];
  rm.playCard(roomId, p1, { cardId: 'c1' }); // down to 1, did not call UNO

  assert.equal(room.playerHands[p1].length, 1);

  // Opponent 2 and Opponent 3 try to catch at the same time
  const catch1 = rm.catchUno(roomId, p2, p1);
  const catch2 = rm.catchUno(roomId, p3, p1);

  assert.equal(catch1.success, true, 'First catch must succeed');
  assert.equal(catch2.success, false, 'Second simultaneous catch must fail');
  assert.match(catch2.error, /CAUGHT FAILED/);

  // Exactly 2 penalty cards were added, not 4
  assert.equal(room.playerHands[p1].length, 3, 'p1 must receive exactly 2 penalty cards in total');
});

test('Dynamic UNO Scenario G: Reconnection restores active catch window and UNO states', () => {
  const { rm, room, roomId, p1, p2, p3 } = createTestSetup();
  room.currentTurn = 0;
  room.activeColor = 'red';
  room.topDiscard = card('top', 'red', 'number', 5);

  room.playerHands[p1] = [card('c1', 'red', 'number', 1), card('c2', 'red', 'number', 2)];
  rm.playCard(roomId, p1, { cardId: 'c1' }); // down to 1 card, catch window open

  // Simulate p3 disconnecting
  const charlie = room.players.find(p => p.id === p3);
  charlie.isConnected = false;

  // p3 reconnects and requests room state
  charlie.isConnected = true;
  const reconnectView = rm.getClientView(roomId, p3);

  // Reconnected client must see the active catch window on p1
  assert.equal(reconnectView.canCatchUno, p1, 'Reconnected client view must restore canCatchUno');
  assert.equal(reconnectView.gameState.players.find(p => p.id === p1).cardCount, 1);
  assert.equal(reconnectView.gameState.players.find(p => p.id === p1).hasCalledUno, false);
});

test('Dynamic UNO Scenario H: Armed UNO clears if player passes or draws without playing down to 1', () => {
  const { rm, room, roomId, p1 } = createTestSetup();
  room.currentTurn = 0;
  room.activeColor = 'red';
  room.topDiscard = card('top', 'red', 'number', 5);

  room.playerHands[p1] = [card('c1', 'blue', 'number', 1), card('c2', 'blue', 'number', 2)];

  // p1 arms UNO
  rm.callUno(roomId, p1);
  assert.equal(room.players[0].isUnoArmed, true);

  // p1 draws a card (cannot play, so draws)
  rm.drawCard(roomId, p1);

  // Since hand is now >= 3 cards, isUnoArmed and hasCalledUno must be cleared
  assert.equal(room.players[0].isUnoArmed, false, 'isUnoArmed must clear after drawing');
  assert.equal(room.players[0].hasCalledUno, false, 'hasCalledUno must clear after drawing');
});

test('Dynamic UNO Scenario I: Stacking draw penalty accumulates properly (+2, +4, +6, +10) without affecting UNO penalty', () => {
  const { rm, room, roomId, p1, p2 } = createTestSetup();
  room.currentTurn = 0;
  room.activeColor = 'red';
  room.topDiscard = card('d2_1', 'red', 'draw2');
  room.pendingDrawPenalty = 2;

  // p1 counters with +4
  room.playerHands[p1] = [card('d4_1', 'red', 'draw4'), card('other', 'blue', 'number', 3)];
  const playRes = rm.playCard(roomId, p1, { cardId: 'd4_1' });
  assert.equal(playRes.success, true);

  // Penalty stacked to 6 (+2 + +4 = 6)
  assert.equal(room.pendingDrawPenalty, 6, 'Draw penalty must accumulate to 6');

  const viewP2 = rm.getClientView(roomId, p2);
  assert.equal(viewP2.gameState.pendingDrawPenalty, 6, 'Client view must reflect authoritative stacked penalty of 6');
});
