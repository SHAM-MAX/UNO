import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistentRoomStore } from '../src/db.js';
import { RoomManager } from '../src/roomManager.js';

test('Flip Rules: Playing Flip card toggles side and flips discard pile', () => {
  const store = new PersistentRoomStore();
  const rm = new RoomManager(store);

  const { roomId, playerId: p1 } = rm.createRoom('P1', 'flip');
  const { playerId: p2 } = rm.joinRoom(roomId, 'P2');

  rm.startGame(roomId, p1);
  const room = rm.getRoom(roomId);

  assert.equal(room.flipSide, 'light', 'Starts on light side');

  // Set top discard as Light Red 5 / Dark Teal 5
  room.topDiscard = {
    id: 'f-top',
    light: { color: 'red', type: 'number', value: 5 },
    dark: { color: 'teal', type: 'number', value: 5 },
  };
  room.activeColor = 'red';
  room.currentTurn = 0;

  // Give P1 a Light Red Flip / Dark Orange 2
  const flipCard = {
    id: 'f-flip-1',
    light: { color: 'red', type: 'flip' },
    dark: { color: 'orange', type: 'number', value: 2 },
  };
  room.playerHands[p1] = [flipCard, { id: 'extra', light: { color: 'blue', type: 'number', value: 1 }, dark: { color: 'pink', type: 'number', value: 1 } }];

  const res = rm.playCard(roomId, p1, { cardId: 'f-flip-1' });
  assert.ok(res.success, 'Flip card should be played successfully');

  // Verify side changed to DARK
  assert.equal(room.flipSide, 'dark', 'Game must now be on DARK side');
  // Discard pile top card is now evaluated on dark side
  assert.equal(room.activeColor, 'orange', 'Active color is now dark face of the played card');
});

test('Flip Rules: Dark Side Draw 5 penalty', () => {
  const store = new PersistentRoomStore();
  const rm = new RoomManager(store);

  const { roomId, playerId: p1 } = rm.createRoom('P1', 'flip');
  const { playerId: p2 } = rm.joinRoom(roomId, 'P2');

  rm.startGame(roomId, p1);
  const room = rm.getRoom(roomId);

  room.flipSide = 'dark';
  room.topDiscard = {
    id: 'dark-top',
    light: { color: 'yellow', type: 'number', value: 3 },
    dark: { color: 'purple', type: 'number', value: 3 },
  };
  room.activeColor = 'purple';
  room.currentTurn = 0;

  const initialP2Hand = room.playerHands[p2].length;

  // Give P1 a Dark Purple Draw 5 card
  const draw5Card = {
    id: 'f-d5',
    light: { color: 'green', type: 'number', value: 1 },
    dark: { color: 'purple', type: 'draw5' },
  };
  room.playerHands[p1] = [draw5Card];

  const res = rm.playCard(roomId, p1, { cardId: 'f-d5' });
  assert.ok(res.success);

  // P2 should have drawn 5 cards and been skipped
  assert.equal(room.playerHands[p2].length, initialP2Hand + 5, 'P2 must draw 5 cards on Dark side');
});

test('Flip Rules: Dark Side Skip Everyone gives player another turn', () => {
  const store = new PersistentRoomStore();
  const rm = new RoomManager(store);

  const { roomId, playerId: p1 } = rm.createRoom('P1', 'flip');
  const { playerId: p2 } = rm.joinRoom(roomId, 'P2');
  const { playerId: p3 } = rm.joinRoom(roomId, 'P3');

  rm.startGame(roomId, p1);
  const room = rm.getRoom(roomId);

  room.flipSide = 'dark';
  room.topDiscard = {
    id: 'dark-top-2',
    light: { color: 'blue', type: 'number', value: 4 },
    dark: { color: 'teal', type: 'number', value: 4 },
  };
  room.activeColor = 'teal';
  room.currentTurn = 0; // P1

  const skipEveryoneCard = {
    id: 'f-skipeveryone',
    light: { color: 'red', type: 'number', value: 2 },
    dark: { color: 'teal', type: 'skip_everyone' },
  };
  room.playerHands[p1] = [skipEveryoneCard, { id: 'p1-c2', light: { color: 'blue', type: 'number', value: 7 }, dark: { color: 'teal', type: 'number', value: 7 } }];

  const res = rm.playCard(roomId, p1, { cardId: 'f-skipeveryone' });
  assert.ok(res.success);

  // P1 takes another turn immediately
  assert.equal(room.currentTurn, 0, 'Skip Everyone gives the player another turn immediately');
});
