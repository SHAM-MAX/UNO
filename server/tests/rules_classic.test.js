import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistentRoomStore } from '../src/db.js';
import { RoomManager } from '../src/roomManager.js';
import { isCardPlayable } from '../../shared/rules.js';

test('Classic Rules: Move validation', () => {
  const topCard = { id: 't1', color: 'red', type: 'number', value: 5 };

  // Match color
  assert.ok(isCardPlayable({ id: 'c1', color: 'red', type: 'number', value: 8 }, topCard, 'red', 'classic'));

  // Match number
  assert.ok(isCardPlayable({ id: 'c2', color: 'blue', type: 'number', value: 5 }, topCard, 'red', 'classic'));

  // Action match
  const topSkip = { id: 'ts', color: 'green', type: 'skip' };
  assert.ok(isCardPlayable({ id: 'cs', color: 'blue', type: 'skip' }, topSkip, 'green', 'classic'));

  // Wild on anything
  assert.ok(isCardPlayable({ id: 'w1', color: 'wild', type: 'wild' }, topCard, 'red', 'classic'));

  // Illegal: mismatch color and number
  assert.equal(
    isCardPlayable({ id: 'c3', color: 'blue', type: 'number', value: 8 }, topCard, 'red', 'classic'),
    false
  );
});

test('Classic Rules: 2-Player Reverse edge case acts as Skip', () => {
  const store = new PersistentRoomStore();
  const rm = new RoomManager(store);

  const { roomId, playerId: p1 } = rm.createRoom('Player 1', 'classic');
  const { playerId: p2 } = rm.joinRoom(roomId, 'Player 2');

  rm.startGame(roomId, p1);

  const room = rm.getRoom(roomId);
  assert.equal(room.status, 'playing');

  // Force top discard to red 5 and give p1 a red reverse + extra cards so game does not end
  room.topDiscard = { id: 'top-red', color: 'red', type: 'number', value: 5 };
  room.activeColor = 'red';
  room.currentTurn = 0; // Player 1
  room.playerHands[p1] = [
    { id: 'rev-card', color: 'red', type: 'reverse' },
    { id: 'extra-card', color: 'blue', type: 'number', value: 3 },
  ];

  // Play Reverse in 2-player game
  const playRes = rm.playCard(roomId, p1, { cardId: 'rev-card' });
  assert.ok(playRes.success, 'Reverse should be played successfully');

  // In 2-player, player 1 should immediately get another turn!
  assert.equal(room.currentTurn, 0, 'In 2-player game, Reverse should allow current player to play again');
});

test('Classic Rules: Skip advances turn past next player', () => {
  const store = new PersistentRoomStore();
  const rm = new RoomManager(store);

  const { roomId, playerId: p1 } = rm.createRoom('P1', 'classic');
  const { playerId: p2 } = rm.joinRoom(roomId, 'P2');
  const { playerId: p3 } = rm.joinRoom(roomId, 'P3');

  rm.startGame(roomId, p1);
  const room = rm.getRoom(roomId);

  room.topDiscard = { id: 'top-blue', color: 'blue', type: 'number', value: 2 };
  room.activeColor = 'blue';
  room.currentTurn = 0; // P1
  room.direction = 1;
  room.playerHands[p1] = [
    { id: 'skip-blue', color: 'blue', type: 'skip' },
    { id: 'extra-card', color: 'blue', type: 'number', value: 3 },
  ];

  const res = rm.playCard(roomId, p1, { cardId: 'skip-blue' });
  assert.ok(res.success);
  // P2 should be skipped, so currentTurn should be 2 (P3)
  assert.equal(room.currentTurn, 2, 'Skip should jump over next player to P3');
});

test('Classic Rules: Draw Two forces opponent to draw 2 cards and lose turn', () => {
  const store = new PersistentRoomStore();
  const rm = new RoomManager(store);

  const { roomId, playerId: p1 } = rm.createRoom('P1', 'classic');
  const { playerId: p2 } = rm.joinRoom(roomId, 'P2');
  const { playerId: p3 } = rm.joinRoom(roomId, 'P3');

  rm.startGame(roomId, p1);
  const room = rm.getRoom(roomId);

  room.topDiscard = { id: 'top-green', color: 'green', type: 'number', value: 1 };
  room.activeColor = 'green';
  room.direction = 1;
  room.currentTurn = 0;
  room.pendingDrawPenalty = 0;
  const initialP2Count = room.playerHands[p2].length;

  room.playerHands[p1] = [
    { id: 'draw2-green', color: 'green', type: 'draw2' },
    { id: 'extra-card', color: 'green', type: 'number', value: 5 },
  ];

  const res = rm.playCard(roomId, p1, { cardId: 'draw2-green' });
  assert.ok(res.success);

  // In Classic without stacking, P2 immediately draws 2 cards and is skipped!
  assert.equal(room.playerHands[p2].length, initialP2Count + 2, 'P2 must draw 2 cards');
  assert.equal(room.currentTurn, 2, 'P2 loses turn; P3 takes turn');
});

test('Classic Rules: UNO call and Missed UNO Catch penalty', () => {
  const store = new PersistentRoomStore();
  const rm = new RoomManager(store);

  const { roomId, playerId: p1 } = rm.createRoom('P1', 'classic');
  const { playerId: p2 } = rm.joinRoom(roomId, 'P2');

  rm.startGame(roomId, p1);
  const room = rm.getRoom(roomId);

  // Set P1 with 2 cards. P1 plays 1 card down to 1 card without calling UNO!
  room.topDiscard = { id: 'top-yellow', color: 'yellow', type: 'number', value: 4 };
  room.activeColor = 'yellow';
  room.currentTurn = 0;
  room.playerHands[p1] = [
    { id: 'play-c', color: 'yellow', type: 'number', value: 7 },
    { id: 'last-c', color: 'red', type: 'number', value: 1 },
  ];

  const res = rm.playCard(roomId, p1, { cardId: 'play-c' });
  assert.ok(res.success);
  assert.equal(room.playerHands[p1].length, 1);

  // Challenge window should be open for P1
  assert.ok(room.unoChallengeWindow, 'Challenge window must be active');
  assert.equal(room.unoChallengeWindow.targetPlayerId, p1);

  // P2 catches P1 forgetting to call UNO!
  const catchRes = rm.catchUno(roomId, p2, p1);
  assert.ok(catchRes.success, 'Catch UNO must succeed');

  // P1 must have drawn 2 penalty cards (hand now 3 cards)
  assert.equal(room.playerHands[p1].length, 3, 'P1 must receive 2 penalty cards for missed UNO');
  assert.equal(room.unoChallengeWindow, null, 'Challenge window closed after catch');
});

test('Classic Rules: Win condition when hand is empty', () => {
  const store = new PersistentRoomStore();
  const rm = new RoomManager(store);

  const { roomId, playerId: p1 } = rm.createRoom('P1', 'classic');
  const { playerId: p2 } = rm.joinRoom(roomId, 'P2');

  rm.startGame(roomId, p1);
  const room = rm.getRoom(roomId);

  room.topDiscard = { id: 'top-red', color: 'red', type: 'number', value: 3 };
  room.activeColor = 'red';
  room.currentTurn = 0;
  room.playerHands[p1] = [{ id: 'final-card', color: 'red', type: 'number', value: 9 }];

  const res = rm.playCard(roomId, p1, { cardId: 'final-card' });
  assert.ok(res.success);

  assert.equal(room.status, 'game_over', 'Game must end');
  assert.equal(room.winnerId, p1, 'P1 must be the winner');
});
