import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/roomManager.js';

function createMockStore() {
  const map = new Map();
  return {
    loadAllActiveRooms: () => [],
    saveRoom: (id, mode, state) => map.set(id, structuredClone(state)),
    saveSession: () => {},
    deleteRoom: (id) => map.delete(id),
  };
}

function card(id, color = 'red', type = 'number', value = 1) {
  return { id, color, type, ...(type === 'number' ? { value } : {}) };
}

function setupRoom(mode = 'classic') {
  const rm = new RoomManager(createMockStore());
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

test('UNO Flow: Call UNO availability at 2 cards vs hidden at 3 cards', () => {
  const { rm, room, roomId, p1, p2 } = setupRoom('classic');
  room.currentTurn = 0; // p1's turn
  room.activeColor = 'red';
  room.topDiscard = card('top', 'red', 'number', 5);

  // Player 1 has 3 cards: canCallUno must be false
  room.playerHands[p1] = [card('c1', 'red', 'number', 1), card('c2', 'red', 'number', 2), card('c3', 'blue', 'number', 3)];
  const view3Cards = rm.getClientView(roomId, p1);
  assert.equal(view3Cards.canCallUno, false, 'Call UNO must be hidden when holding 3 cards');

  // Player 1 has 2 cards: canCallUno must be true on their turn
  room.playerHands[p1] = [card('c1', 'red', 'number', 1), card('c2', 'red', 'number', 2)];
  const view2Cards = rm.getClientView(roomId, p1);
  assert.equal(view2Cards.canCallUno, true, 'Call UNO must appear when holding exactly 2 cards on player turn');

  // Opponent has 2 cards but it is NOT their turn: canCallUno must be false
  room.playerHands[p2] = [card('c4', 'red', 'number', 4), card('c5', 'red', 'number', 5)];
  const viewOpponent = rm.getClientView(roomId, p2);
  assert.equal(viewOpponent.canCallUno, false, 'Call UNO must NOT appear for players when it is not their turn');
});

test('UNO Flow: Arming UNO registers declaration when player reaches 1 card; visible to opponents', () => {
  const { rm, room, roomId, p1, p2 } = setupRoom('classic');
  room.currentTurn = 0;
  room.activeColor = 'red';
  room.topDiscard = card('top', 'red', 'number', 5);
  room.playerHands[p1] = [card('c1', 'red', 'number', 1), card('c2', 'red', 'number', 2)];

  // Arm declaration
  const callRes = rm.callUno(roomId, p1);
  assert.equal(callRes.success, true);
  assert.equal(callRes.armed, true);

  // Play down to 1 card
  const playRes = rm.playCard(roomId, p1, { cardId: 'c1' });
  assert.equal(playRes.success, true);
  assert.equal(room.playerHands[p1].length, 1);

  // Authoritative declaration registered
  const p1Player = room.players.find(p => p.id === p1);
  assert.equal(p1Player.hasCalledUno, true);

  // Visible to opponent view
  const viewP2 = rm.getClientView(roomId, p2);
  const p1InP2View = viewP2.gameState.players.find(p => p.id === p1);
  assert.equal(p1InP2View.hasCalledUno, true, 'Declared UNO must be visible to opponents');
  assert.equal(viewP2.canCatchUno, null, 'Opponent cannot catch player who declared UNO');
});

test('UNO Flow: Failed card play does not register declaration', () => {
  const { rm, room, roomId, p1 } = setupRoom('classic');
  room.currentTurn = 0;
  room.activeColor = 'red';
  room.topDiscard = card('top', 'red', 'number', 5);
  // c1 is blue 1 - unplayable on red 5
  room.playerHands[p1] = [card('c1', 'blue', 'number', 1), card('c2', 'green', 'number', 2)];

  rm.callUno(roomId, p1);
  // Attempt invalid card play
  const playRes = rm.playCard(roomId, p1, { cardId: 'c1' });
  assert.equal(playRes.success, false, 'Unplayable card must be rejected');

  // Hand still has 2 cards and card was not played
  assert.equal(room.playerHands[p1].length, 2);
  // If player draws without playing down to 1, armed state resets
  rm.drawCard(roomId, p1);
  const player1 = room.players.find(p => p.id === p1);
  assert.equal(player1.hasCalledUno, false);
  assert.equal(player1.isUnoArmed, false);
});

test('CAUGHT Flow: Opponents see CAUGHT on uncalled 1 card; target does not see self catch', () => {
  const { rm, room, roomId, p1, p2, p3 } = setupRoom('flip');
  room.currentTurn = 0;
  room.activeColor = 'red';
  room.topDiscard = card('top', 'red', 'number', 5);
  room.playerHands[p1] = [card('c1', 'red', 'number', 1), card('c2', 'blue', 'number', 2)];

  // Play c1 down to 1 card WITHOUT calling UNO
  rm.playCard(roomId, p1, { cardId: 'c1' });
  assert.equal(room.playerHands[p1].length, 1);
  assert.equal(room.players.find(p => p.id === p1).hasCalledUno, false);

  // Both opponents see canCatchUno on p1
  const viewP2 = rm.getClientView(roomId, p2);
  const viewP3 = rm.getClientView(roomId, p3);
  assert.equal(viewP2.canCatchUno, p1);
  assert.equal(viewP3.canCatchUno, p1);

  // Target p1 NEVER sees canCatchUno on themselves
  const viewP1 = rm.getClientView(roomId, p1);
  assert.equal(viewP1.canCatchUno, null, 'Target player must NOT see catch button on themselves');
});

test('CAUGHT Flow: Successful catch adds exactly two cards atomically and prevents double penalty', () => {
  const { rm, room, roomId, p1, p2, p3 } = setupRoom('no_mercy');
  room.currentTurn = 0;
  room.activeColor = 'red';
  room.topDiscard = card('top', 'red', 'number', 5);
  room.playerHands[p1] = [card('c1', 'red', 'number', 1), card('c2', 'blue', 'number', 2)];

  rm.playCard(roomId, p1, { cardId: 'c1' }); // down to 1 uncalled

  // P2 catches P1
  const catch1 = rm.catchUno(roomId, p2, p1);
  assert.equal(catch1.success, true);
  assert.equal(catch1.drawnCount, 2);
  assert.equal(room.playerHands[p1].length, 3, 'P1 must have exactly 3 cards (1 + 2 penalty)');

  // P3 tries simultaneous catch
  const catch2 = rm.catchUno(roomId, p3, p1);
  assert.equal(catch2.success, false, 'Simultaneous second catch must be rejected atomically');
  assert.equal(room.playerHands[p1].length, 3, 'No additional penalty cards added');
});

test('CAUGHT Flow: Cannot catch player who called UNO or self', () => {
  const { rm, room, roomId, p1, p2 } = setupRoom('classic');
  room.currentTurn = 0;
  room.activeColor = 'red';
  room.topDiscard = card('top', 'red', 'number', 5);
  room.playerHands[p1] = [card('c1', 'red', 'number', 1), card('c2', 'red', 'number', 2)];

  rm.callUno(roomId, p1);
  rm.playCard(roomId, p1, { cardId: 'c1' });

  // Self catch attempt
  const selfCatch = rm.catchUno(roomId, p1, p1);
  assert.equal(selfCatch.success, false);
  assert.match(selfCatch.error, /Cannot catch yourself/i);

  // Opponent catch attempt on declared UNO
  const opponentCatch = rm.catchUno(roomId, p2, p1);
  assert.equal(opponentCatch.success, false);
  assert.match(opponentCatch.error, /already called UNO/i);
});

test('Play vs AI Setup: User-specified bots across all 3 game modes', () => {
  const rm = new RoomManager(createMockStore());

  // 1. Classic Mode with 2 specific bots (3 players total)
  const classicRoom = rm.createBotRoom('HostClassic', 'classic', 2, {}, ['RoboMax', 'CardBot 3000']);
  const classicState = rm.getRoom(classicRoom.roomId);
  assert.equal(classicState.mode, 'classic');
  assert.equal(classicState.players.length, 3);
  assert.deepEqual(
    classicState.players.filter(p => p.isBot).map(p => p.name),
    ['RoboMax', 'CardBot 3000']
  );

  // 2. Flip Mode with 1 specific bot (2 players total)
  const flipRoom = rm.createBotRoom('HostFlip', 'flip', 1, {}, ['MatrixMaster']);
  const flipState = rm.getRoom(flipRoom.roomId);
  assert.equal(flipState.mode, 'flip');
  assert.equal(flipState.players.length, 2);
  assert.deepEqual(
    flipState.players.filter(p => p.isBot).map(p => p.name),
    ['MatrixMaster']
  );

  // 3. No Mercy Mode with 4 specific bots (5 players total)
  const mercyBots = ['BytePlayer', 'CyberAce', 'PixelPro', 'CircuitChampion'];
  const mercyRoom = rm.createBotRoom('HostMercy', 'no_mercy', 4, {}, mercyBots);
  const mercyState = rm.getRoom(mercyRoom.roomId);
  assert.equal(mercyState.mode, 'no_mercy');
  assert.equal(mercyState.players.length, 5);
  assert.deepEqual(
    mercyState.players.filter(p => p.isBot).map(p => p.name),
    mercyBots
  );
});
