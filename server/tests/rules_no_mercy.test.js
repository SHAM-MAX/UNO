import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistentRoomStore } from '../src/db.js';
import { RoomManager } from '../src/roomManager.js';

function setupCleanRoom(rm, mode = 'no_mercy', numPlayers = 2) {
  const { roomId, playerId: p1 } = rm.createRoom('P1', mode);
  const players = [p1];
  for (let i = 2; i <= numPlayers; i++) {
    const { playerId } = rm.joinRoom(roomId, `P${i}`);
    players.push(playerId);
  }
  rm.startGame(roomId, p1);
  const room = rm.getRoom(roomId);
  room.direction = 1;
  room.currentTurn = 0;
  room.pendingDrawPenalty = 0;
  room.status = 'playing';
  return { roomId, room, players };
}

test('No Mercy: Stacking draw cards accumulates penalty', () => {
  const store = new PersistentRoomStore();
  const rm = new RoomManager(store);

  const { roomId, room, players: [p1, p2, p3] } = setupCleanRoom(rm, 'no_mercy', 3);

  room.topDiscard = { id: 'nm-top', color: 'red', type: 'number', value: 2 };
  room.activeColor = 'red';
  room.direction = 1;
  room.currentTurn = 0; // P1
  room.pendingDrawPenalty = 0;

  // Setup hands
  room.playerHands[p1] = [
    { id: 'd2', color: 'red', type: 'draw2' },
    { id: 'p1-extra', color: 'blue', type: 'number', value: 3 },
  ];
  room.playerHands[p2] = [
    { id: 'd4', color: 'red', type: 'draw4' },
    { id: 'p2-extra', color: 'green', type: 'number', value: 4 },
  ];
  room.playerHands[p3] = [{ id: 'b1', color: 'blue', type: 'number', value: 1 }];

  // 1. P1 plays Draw 2
  const res1 = rm.playCard(roomId, p1, { cardId: 'd2' });
  assert.ok(res1.success, res1.error);
  assert.equal(room.pendingDrawPenalty, 2, 'Pending penalty should be 2');
  assert.equal(room.currentTurn, 1, 'Turn moves to P2');

  // 2. P2 stacks Draw 4
  const res2 = rm.playCard(roomId, p2, { cardId: 'd4' });
  assert.ok(res2.success, 'P2 can stack Draw 4 on Draw 2 in No Mercy');
  assert.equal(room.pendingDrawPenalty, 6, 'Pending penalty should accumulate to 6 (2 + 4)');
  assert.equal(room.currentTurn, 2, 'Turn moves to P3');

  // 3. P3 cannot stack, so P3 must take the draw penalty
  const initialHandP3 = room.playerHands[p3].length;
  const res3 = rm.drawCard(roomId, p3);
  assert.ok(res3.success);
  assert.equal(room.pendingDrawPenalty, 0, 'Penalty cleared after taking it');
  assert.equal(room.playerHands[p3].length, initialHandP3 + 6, 'P3 must have drawn 6 accumulated cards');
});

test('No Mercy: 7 Hand-Swap swaps entire hand with chosen player', () => {
  const store = new PersistentRoomStore();
  const rm = new RoomManager(store);

  const { roomId, room, players: [p1, p2] } = setupCleanRoom(rm, 'no_mercy', 2);

  room.topDiscard = { id: 'top-c', color: 'green', type: 'number', value: 3 };
  room.activeColor = 'green';
  room.direction = 1;
  room.currentTurn = 0; // P1
  room.pendingDrawPenalty = 0;

  const p1OriginalHand = [
    { id: 'seven', color: 'green', type: 'number', value: 7 },
    { id: 'p1-c2', color: 'red', type: 'number', value: 1 },
  ];
  const p2OriginalHand = [
    { id: 'p2-c1', color: 'blue', type: 'number', value: 9 },
    { id: 'p2-c2', color: 'yellow', type: 'number', value: 8 },
    { id: 'p2-c3', color: 'green', type: 'number', value: 6 },
  ];

  room.playerHands[p1] = [...p1OriginalHand];
  room.playerHands[p2] = [...p2OriginalHand];

  const res = rm.playCard(roomId, p1, { cardId: 'seven', targetPlayerId: p2 });
  assert.ok(res.success, '7 Hand-swap should succeed');

  assert.equal(room.playerHands[p1].length, 3, 'P1 received P2 hand');
  assert.equal(room.playerHands[p2].length, 1, 'P2 received P1 hand');
  assert.equal(room.playerHands[p2][0].id, 'p1-c2', 'P2 has the card that was in P1 hand');
});

test('No Mercy: 0 Hand-Pass shifts hands in direction of play', () => {
  const store = new PersistentRoomStore();
  const rm = new RoomManager(store);

  const { roomId, room, players: [p1, p2, p3] } = setupCleanRoom(rm, 'no_mercy', 3);

  room.topDiscard = { id: 'top-y', color: 'yellow', type: 'number', value: 9 };
  room.activeColor = 'yellow';
  room.direction = 1;
  room.currentTurn = 0;
  room.pendingDrawPenalty = 0;

  room.playerHands[p1] = [
    { id: 'zero-card', color: 'yellow', type: 'number', value: 0 },
    { id: 'p1-card', color: 'blue', type: 'number', value: 2 },
  ];
  room.playerHands[p2] = [{ id: 'p2-card', color: 'red', type: 'number', value: 5 }];
  room.playerHands[p3] = [{ id: 'p3-card', color: 'green', type: 'number', value: 8 }];

  const res = rm.playCard(roomId, p1, { cardId: 'zero-card' });
  assert.ok(res.success);

  assert.equal(room.playerHands[p2][0].id, 'p1-card', 'P2 receives P1 remaining hand');
  assert.equal(room.playerHands[p3][0].id, 'p2-card', 'P3 receives P2 hand');
  assert.equal(room.playerHands[p1][0].id, 'p3-card', 'P1 receives P3 hand');
});

test('No Mercy: Discard All dumps all cards of the played color', () => {
  const store = new PersistentRoomStore();
  const rm = new RoomManager(store);

  const { roomId, room, players: [p1, p2] } = setupCleanRoom(rm, 'no_mercy', 2);

  room.topDiscard = { id: 'top-b', color: 'blue', type: 'number', value: 1 };
  room.activeColor = 'blue';
  room.direction = 1;
  room.currentTurn = 0;
  room.pendingDrawPenalty = 0;

  room.playerHands[p1] = [
    { id: 'da-blue', color: 'blue', type: 'discard_all' },
    { id: 'b-num1', color: 'blue', type: 'number', value: 3 },
    { id: 'b-num2', color: 'blue', type: 'number', value: 7 },
    { id: 'r-num', color: 'red', type: 'number', value: 5 },
  ];

  const res = rm.playCard(roomId, p1, { cardId: 'da-blue' });
  assert.ok(res.success, res.error);

  assert.equal(room.playerHands[p1].length, 1, 'Only 1 card should remain in hand');
  assert.equal(room.playerHands[p1][0].id, 'r-num', 'Only non-blue card should remain');
});

test('No Mercy: 25-Card Mercy Knockout eliminates player and awards win to last survivor', () => {
  const store = new PersistentRoomStore();
  const rm = new RoomManager(store);

  const { roomId, room, players: [p1, p2] } = setupCleanRoom(rm, 'no_mercy', 2);

  room.topDiscard = { id: 'top-r', color: 'red', type: 'number', value: 1 };
  room.activeColor = 'red';
  room.direction = 1;
  room.currentTurn = 0; // P1
  room.pendingDrawPenalty = 0;

  // P2 has 20 cards
  const p2Cards = [];
  for (let i = 0; i < 20; i++) {
    p2Cards.push({ id: `p2-${i}`, color: 'blue', type: 'number', value: 2 });
  }
  room.playerHands[p2] = p2Cards;

  // P1 plays Wild Draw 10!
  room.playerHands[p1] = [
    { id: 'wd10', color: 'wild', type: 'wild_draw10' },
    { id: 'extra', color: 'green', type: 'number', value: 4 },
  ];

  const res1 = rm.playCard(roomId, p1, { cardId: 'wd10', chosenColor: 'blue' });
  assert.ok(res1.success, res1.error);
  assert.equal(room.pendingDrawPenalty, 10);

  // P2 cannot stack (all blue 2s), so P2 draws 10 cards!
  // 20 + 10 = 30 cards >= 25 -> KNOCKOUT!
  const res2 = rm.drawCard(roomId, p2);
  assert.ok(res2.success);

  assert.equal(room.players[1].isEliminated, true, 'P2 must be eliminated by Mercy rule');
  assert.equal(room.status, 'game_over', 'Game must end because only 1 player remains');
  assert.equal(room.winnerId, p1, 'P1 must win as the last player standing');
});
