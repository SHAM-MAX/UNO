process.env.NODE_ENV = 'test';

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
const { server, roomManager } = await import('../src/index.js');

function createClient(port) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const messages = [];
  const listeners = [];

  const client = {
    ws,
    roomId: null,
    playerId: null,
    sessionToken: null,
    waitForOpen: new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    }),
    send(type, payload = {}) {
      const msg = {
        type,
        roomId: client.roomId,
        playerId: client.playerId,
        sessionToken: client.sessionToken,
        ...payload,
      };
      ws.send(JSON.stringify(msg));
    },
    waitFor(predicate, timeout = 4000) {
      for (let i = 0; i < messages.length; i++) {
        if (predicate(messages[i])) {
          return Promise.resolve(messages.splice(i, 1)[0]);
        }
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timeout waiting for message matching predicate. Received: ${JSON.stringify(messages)}`));
        }, timeout);
        listeners.push({
          filter: predicate,
          resolve: (msg) => {
            clearTimeout(timer);
            resolve(msg);
          },
        });
      });
    },
    close() {
      ws.close();
    },
  };

  ws.on('message', (data) => {
    const parsed = JSON.parse(data.toString());
    messages.push(parsed);
    if (parsed.type === 'joined') {
      client.roomId = parsed.data.roomId;
      client.playerId = parsed.data.playerId;
      client.sessionToken = parsed.data.sessionToken;
    }
    for (let i = listeners.length - 1; i >= 0; i--) {
      if (listeners[i].filter(parsed)) {
        const { resolve } = listeners.splice(i, 1)[0];
        resolve(parsed);
      }
    }
  });

  return client;
}

test('E2E Multiplayer Flow: Full 2-player game in Classic, Flip, and No Mercy', async (t) => {
  if (!server.listening) {
    await new Promise((res) => server.listen(0, res));
  }
  const port = server.address().port;

  after(() => {
    try {
      server.close();
    } catch (e) {}
  });

  // 1. CLASSIC MODE 2-PLAYER GAME
  await t.test('Classic Mode 2-player session', async () => {
    const client1 = createClient(port);
    const client2 = createClient(port);
    await Promise.all([client1.waitForOpen, client2.waitForOpen]);

    const testRoomId = 'CLS' + Math.floor(Math.random() * 90000 + 10000);
    
    client1.send('create', { roomId: testRoomId, playerName: 'Alice', data: { mode: 'classic' } });
    const joined1 = await client1.waitFor((m) => m.type === 'joined');
    const p1Id = joined1.data.playerId;

    client2.send('join', { roomId: testRoomId, playerName: 'Bob' });
    const joined2 = await client2.waitFor((m) => m.type === 'joined');
    const p2Id = joined2.data.playerId;

    // A player ID supplied in a message cannot elevate a guest to host.
    client2.send('start_game', { playerId: p1Id });
    const spoofAttempt = await client2.waitFor((m) => m.type === 'error');
    assert.match(spoofAttempt.message, /host/i);

    // Creating a room with an occupied code must never replace its current state.
    const intruder = createClient(port);
    await intruder.waitForOpen;
    intruder.send('create', { roomId: testRoomId, playerName: 'Intruder', data: { mode: 'no_mercy' } });
    const duplicateRoomAttempt = await intruder.waitFor((m) => m.type === 'error');
    assert.match(duplicateRoomAttempt.message, /already in use/i);
    assert.equal(roomManager.getRoom(testRoomId).players.length, 2);
    intruder.close();

    client1.send('ready', { data: { isReady: true } });
    client2.send('ready', { data: { isReady: true } });
    client1.send('start_game');

    const state1 = await client1.waitFor((m) => m.type === 'room:state' && m.data.gameState.status === 'playing');
    const state2 = await client2.waitFor((m) => m.type === 'room:state' && m.data.gameState.status === 'playing');

    assert.equal(state1.data.gameState.status, 'playing');
    assert.ok([7, 9].includes(state1.data.myHand.length), 'Alice dealt seven plus any opening penalty');
    assert.ok([7, 9].includes(state2.data.myHand.length), 'Bob dealt seven plus any opening penalty');
    
    // Information hiding check: Alice should NOT see Bob's cards, only cardCount!
    assert.equal(typeof state1.data.gameState.players.find(p => p.id === p2Id).cardCount, 'number');
    assert.equal(state1.data.gameState.players.find(p => p.id === p2Id).hand, undefined, 'Private hand hidden from opponent');

    // Test playing card
    const room = roomManager.getRoom(testRoomId);
    room.pendingAction = null;
    room.direction = 1;
    room.currentTurn = 0;
    room.pendingDrawPenalty = 0;
    room.topDiscard = { id: 'c-top', color: 'red', type: 'number', value: 5 };
    room.activeColor = 'red';
    room.playerHands[p1Id] = [
      { id: 'c-p1-card', color: 'red', type: 'number', value: 9 },
      { id: 'c-p1-extra', color: 'blue', type: 'number', value: 1 },
    ];

    client1.send('play_card', { actionId: 'classic-action-once', data: { cardId: 'c-p1-card' } });
    const updateAfterPlay = await client2.waitFor((m) => m.type === 'room:state' && m.data.gameState.currentTurn === 1 && m.data.gameState.topDiscard?.id === 'c-p1-card');
    assert.equal(updateAfterPlay.data.gameState.currentTurn, 1, 'Turn moved to Bob');
    assert.equal(updateAfterPlay.data.gameState.topDiscard.id, 'c-p1-card');

    const guestBefore = room.playerHands[p2Id].length;
    client2.send('draw_card', { expectedActionVersion: room.actionVersion - 1, actionId: 'stale-version' });
    const stale = await client2.waitFor(m => m.type === 'error' && /turn changed/.test(m.message));
    assert.ok(stale);
    assert.equal(room.playerHands[p2Id].length, guestBefore, 'Stale version rejected without drawing');
    const beforeReplay = room.playerHands[p1Id].length;
    client1.send('draw_card', { actionId: 'classic-action-once' });
    await client1.waitFor(m => m.type === 'room:state' && m.data.gameState.topDiscard?.id === 'c-p1-card');
    assert.equal(room.playerHands[p1Id].length, beforeReplay, 'Duplicate action receipt prevents a second mutation');
    client1.close();
    client2.close();
  });

  // 2. UNO FLIP 2-PLAYER GAME
  await t.test('UNO Flip Mode: Light to Dark side transitions', async () => {
    const client1 = createClient(port);
    const client2 = createClient(port);
    await Promise.all([client1.waitForOpen, client2.waitForOpen]);

    const flipRoomId = 'FLP' + Math.floor(Math.random() * 90000 + 10000);
    client1.send('create', { roomId: flipRoomId, playerName: 'P1-Flip', data: { mode: 'flip' } });
    const j1 = await client1.waitFor((m) => m.type === 'joined');
    const p1Id = j1.data.playerId;

    client2.send('join', { roomId: flipRoomId, playerName: 'P2-Flip' });
    await client2.waitFor((m) => m.type === 'joined');

    client1.send('ready', { data: { isReady: true } });
    client2.send('ready', { data: { isReady: true } });
    client1.send('start_game');

    await client1.waitFor((m) => m.type === 'room:state' && m.data.gameState.status === 'playing');

    const room = roomManager.getRoom(flipRoomId);
    assert.equal(room.flipSide, 'light', 'Starts on light side');

    room.pendingAction = null;
    room.direction = 1;
    room.currentTurn = 0;
    room.pendingDrawPenalty = 0;
    room.topDiscard = {
      id: 'f-top-1',
      light: { color: 'blue', type: 'number', value: 3 },
      dark: { color: 'orange', type: 'number', value: 3 },
    };
    room.activeColor = 'blue';
    room.playerHands[p1Id] = [
      {
        id: 'f-flip-card',
        light: { color: 'blue', type: 'flip' },
        dark: { color: 'pink', type: 'number', value: 8 },
      },
      {
        id: 'extra',
        light: { color: 'green', type: 'number', value: 2 },
        dark: { color: 'teal', type: 'number', value: 2 },
      }
    ];

    client1.send('play_card', { data: { cardId: 'f-flip-card' } });

    const flipState = await client2.waitFor((m) => m.type === 'room:state' && m.data.gameState.flipSide === 'dark');
    assert.equal(flipState.data.gameState.flipSide, 'dark', 'Game must now be on DARK side!');
    assert.equal(flipState.data.gameState.activeColor, 'pink', 'Active color is the dark face of the played card');

    client1.close();
    client2.close();
  });

  // 3. SHOW 'EM NO MERCY 2-PLAYER GAME
  await t.test('Show em No Mercy: Stacking and Knockout', async () => {
    const client1 = createClient(port);
    const client2 = createClient(port);
    await Promise.all([client1.waitForOpen, client2.waitForOpen]);

    const nmRoomId = 'NMR' + Math.floor(Math.random() * 90000 + 10000);
    client1.send('create', { roomId: nmRoomId, playerName: 'P1-Mercy', data: { mode: 'no_mercy' } });
    const j1 = await client1.waitFor((m) => m.type === 'joined');
    const p1Id = j1.data.playerId;

    client2.send('join', { roomId: nmRoomId, playerName: 'P2-Mercy' });
    const j2 = await client2.waitFor((m) => m.type === 'joined');
    const p2Id = j2.data.playerId;

    client1.send('ready', { data: { isReady: true } });
    client2.send('ready', { data: { isReady: true } });
    client1.send('start_game');

    await client1.waitFor((m) => m.type === 'room:state' && m.data.gameState.status === 'playing');

    const room = roomManager.getRoom(nmRoomId);
    room.pendingAction = null;
    room.direction = 1;
    room.currentTurn = 0;
    room.pendingDrawPenalty = 0;
    room.topDiscard = { id: 'nm-t', color: 'yellow', type: 'number', value: 4 };
    room.activeColor = 'yellow';

    room.playerHands[p1Id] = [
      { id: 'd2-y', color: 'yellow', type: 'draw2' },
      { id: 'extra', color: 'green', type: 'number', value: 1 },
    ];
    room.playerHands[p2Id] = [
      { id: 'd4-y', color: 'yellow', type: 'draw4' },
      { id: 'p2-extra', color: 'blue', type: 'number', value: 2 },
    ];

    client1.send('play_card', { data: { cardId: 'd2-y' } });
    const sAfterD2 = await client2.waitFor((m) => m.type === 'room:state' && m.data.gameState.pendingDrawPenalty === 2);
    assert.equal(sAfterD2.data.gameState.pendingDrawPenalty, 2);

    client2.send('play_card', { data: { cardId: 'd4-y' } });
    const sAfterD4 = await client1.waitFor((m) => m.type === 'room:state' && m.data.gameState.pendingDrawPenalty === 6);
    assert.equal(sAfterD4.data.gameState.pendingDrawPenalty, 6, 'Penalty stacked to 6 cards!');

    client1.send('draw_card');
    const sAfterTake = await client2.waitFor((m) => m.type === 'room:state' && m.data.gameState.pendingDrawPenalty === 0);
    assert.equal(sAfterTake.data.gameState.pendingDrawPenalty, 0, 'Penalty cleared');

    client1.close();
    client2.close();
  });
});
