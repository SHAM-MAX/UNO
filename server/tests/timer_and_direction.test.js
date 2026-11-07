import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/roomManager.js';

class MockStore {
  saveRoom() {}
  loadAllActiveRooms() { return []; }
  deleteRoom() {}
  saveSession() {}
  loadSession() { return null; }
  deleteSession() {}
}

test('Turn Timer & Direction Behavior', async (t) => {
  const store = new MockStore();
  const rm = new RoomManager(store);

  // 1. Create a 3-player classic room
  const created = rm.createRoom('Alice', 'classic');
  const roomId = created.roomId;
  const p1 = created.playerId;

  const j2 = rm.joinRoom(roomId, 'Bob');
  const p2 = j2.playerId;

  const j3 = rm.joinRoom(roomId, 'Charlie');
  const p3 = j3.playerId;

  rm.setReady(roomId, p1, true);
  rm.setReady(roomId, p2, true);
  rm.setReady(roomId, p3, true);

  await t.test('Game start sets authoritative 20-second turn deadline and default direction', () => {
    const started = rm.startGame(roomId, p1);
    assert.equal(started.success, true);

    const initialRoom = rm.getRoom(roomId);
    if (initialRoom.pendingAction?.type === 'opening_color') rm.chooseOpeningColor(roomId, initialRoom.players[initialRoom.currentTurn].id, 'red');
    const view = rm.getClientView(roomId, p1);
    assert.ok(view.gameState.turnDeadline, 'turnDeadline should be set on game start');
    const remaining = view.gameState.turnDeadline - Date.now();
    assert.ok(remaining > 18000 && remaining <= 20100, `Remaining ms (${remaining}) should be ~20s`);
    assert.equal(view.gameState.turnDurationMs, 20000);
    assert.ok(view.gameState.direction === 1 || view.gameState.direction === -1);
  });

  await t.test('Reverse card changes direction to -1 (Counter-Clockwise) and resets timer', () => {
    const room = rm.rooms.get(roomId);
    room.currentTurn = 0;
    room.direction = 1;
    const initialDeadline = room.turnDeadline;

    // Inject a playable Reverse card
    const reverseCard = { id: 'c-rev-test', color: 'red', type: 'reverse' };
    room.activeColor = 'red';
    room.topDiscard = { id: 'c-top-test', color: 'red', type: 'number', value: 5 };
    room.playerHands[p1] = [reverseCard, { id: 'c-extra', color: 'blue', type: 'number', value: 1 }];
    room.players[0].cardCount = 2;

    const playRes = rm.playCard(roomId, p1, { cardId: 'c-rev-test' });
    assert.equal(playRes.success, true);

    const view = rm.getClientView(roomId, p2);
    assert.equal(view.gameState.direction, -1, 'Direction must reverse to -1 (Counter-Clockwise)');
    assert.ok(view.gameState.turnDeadline >= initialDeadline, 'Turn deadline must reset on card play');
  });

  await t.test('Playing second Reverse returns direction to 1 (Clockwise)', () => {
    const room = rm.rooms.get(roomId);
    assert.equal(room.direction, -1);

    const currentPlayer = room.players[room.currentTurn];
    const reverseCard2 = { id: 'c-rev-test-2', color: 'red', type: 'reverse' };
    room.playerHands[currentPlayer.id].unshift(reverseCard2);
    currentPlayer.cardCount = room.playerHands[currentPlayer.id].length;

    const playRes = rm.playCard(roomId, currentPlayer.id, { cardId: 'c-rev-test-2' });
    assert.equal(playRes.success, true);

    const view = rm.getClientView(roomId, p1);
    assert.equal(view.gameState.direction, 1, 'Direction must return to 1 (Clockwise)');
  });

  await t.test('Client view rehydration restores exact active turn deadline without resetting', () => {
    const room = rm.rooms.get(roomId);
    const serverDeadline = room.turnDeadline;

    const view1 = rm.getClientView(roomId, p1);
    const view2 = rm.getClientView(roomId, p2);

    assert.equal(view1.gameState.turnDeadline, serverDeadline);
    assert.equal(view2.gameState.turnDeadline, serverDeadline);
  });

  await t.test('Deterministic timeout action advances turn when timer expires', async () => {
    const room = rm.rooms.get(roomId);
    const turnBefore = room.currentTurn;
    const playerBefore = room.players[turnBefore];
    const initialCardCount = playerBefore.cardCount;

    // Trigger timeout directly
    rm.handleTurnTimeout(roomId, turnBefore);

    assert.notEqual(room.currentTurn, turnBefore, 'Turn should advance past timed-out player');
    assert.ok(playerBefore.cardCount >= initialCardCount, 'Timed out player should have drawn a card');
    assert.ok(room.turnDeadline, 'New player must receive fresh turn deadline');
  });
});
