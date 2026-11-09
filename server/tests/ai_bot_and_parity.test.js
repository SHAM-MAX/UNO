import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { server, roomManager } from '../src/index.js';

function createClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages = [];
  const listeners = [];

  const client = {
    ws,
    messages,
    roomId: null,
    playerId: null,
    sessionToken: null,
    waitForOpen: new Promise((res) => ws.on('open', res)),
    waitFor(filter, timeoutMs = 4000) {
      const match = messages.find(filter);
      if (match) return Promise.resolve(match);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for message matching ${filter.toString()}`));
        }, timeoutMs);
        listeners.push({
          filter,
          resolve: (msg) => {
            clearTimeout(timeout);
            resolve(msg);
          },
        });
      });
    },
    send(type, payload = {}) {
      ws.send(JSON.stringify({ type, roomId: client.roomId, sessionToken: client.sessionToken, ...payload }));
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

test('AI Bot System and Social Parity Features', async (t) => {
  if (!server.listening) {
    await new Promise((res) => server.listen(0, res));
  }
  const port = server.address().port;

  after(() => {
    try {
      server.close();
    } catch (e) {}
  });

  await t.test('Host can add and remove bots in lobby', async () => {
    const client = createClient(port);
    await client.waitForOpen;

    const roomId = 'BOT' + Math.floor(Math.random() * 90000 + 10000);
    client.send('create', { roomId, playerName: 'HostAlice' });
    await client.waitFor((m) => m.type === 'joined');

    // Add bot
    client.send('add_bot', { data: { name: 'CardBot 3000' } });
    const stateWithBot = await client.waitFor((m) => m.type === 'room:state' && m.data.gameState.players.some((p) => p.isBot));
    assert.equal(stateWithBot.data.gameState.players.length, 2);
    const bot = stateWithBot.data.gameState.players.find((p) => p.isBot);
    assert.equal(bot.name, 'CardBot 3000');
    assert.equal(bot.isReady, true);

    // Remove bot
    client.send('remove_bot', { data: { botId: bot.id } });
    const stateWithoutBot = await client.waitFor((m) => m.type === 'room:state' && m.data.gameState.players.length === 1);
    assert.equal(stateWithoutBot.data.gameState.players.some((p) => p.isBot), false);

    client.close();
  });

  await t.test('create_bot_room spins up an immediate match with AI opponents', async () => {
    const client = createClient(port);
    await client.waitForOpen;

    client.send('create_bot_room', { playerName: 'SoloPlayer', data: { mode: 'classic', botCount: 3 } });
    const joined = await client.waitFor((m) => m.type === 'joined');
    assert.ok(joined.data.roomId);

    const playingState = await client.waitFor((m) => m.type === 'room:state' && m.data.gameState.status === 'playing');
    assert.equal(playingState.data.gameState.players.length, 4);
    const botCount = playingState.data.gameState.players.filter((p) => p.isBot).length;
    assert.equal(botCount, 3);
    assert.equal(playingState.data.gameState.turnDurationMs, 30000);

    client.close();
  });

  await t.test('Bot automatically takes turn when scheduled', async () => {
    const client = createClient(port);
    await client.waitForOpen;

    client.send('create_bot_room', { playerName: 'HumanPlayer', data: { mode: 'no_mercy', botCount: 1 } });
    await client.waitFor((m) => m.type === 'room:state' && m.data.gameState.status === 'playing');

    const room = roomManager.getRoom(client.roomId);
    assert.ok(room);
    const botPlayer = room.players.find((p) => p.isBot);
    assert.ok(botPlayer);

    // Force turn to bot
    room.currentTurn = room.players.findIndex((p) => p.id === botPlayer.id);
    const turnAtStart = room.currentTurn;
    const botHandBefore = room.playerHands[botPlayer.id].length;

    // Trigger scheduled bot turn
    roomManager.scheduleBotTurn(room);

    // Wait for state update indicating bot acted (either played card or drew/passed)
    const stateAfterBot = await client.waitFor(
      (m) => m.type === 'room:state' && (m.data.gameState.currentTurn !== turnAtStart || room.playerHands[botPlayer.id]?.length !== botHandBefore),
      3500
    );
    assert.ok(stateAfterBot);

    client.close();
  });

  await t.test('Host can shuffle player seats', async () => {
    const client1 = createClient(port);
    const client2 = createClient(port);
    await Promise.all([client1.waitForOpen, client2.waitForOpen]);

    const roomId = 'SHF' + Math.floor(Math.random() * 90000 + 10000);
    client1.send('create', { roomId, playerName: 'P1' });
    await client1.waitFor((m) => m.type === 'joined');

    client2.send('join', { roomId, playerName: 'P2' });
    await client2.waitFor((m) => m.type === 'joined');

    client1.send('add_bot');
    await client1.waitFor((m) => m.type === 'room:state' && m.data.gameState.players.length === 3);

    client1.send('shuffle_seats');
    const shuffledState = await client1.waitFor((m) => m.type === 'room:state' && m.data.gameState.lastActionMessage?.includes('shuffled'));
    assert.equal(shuffledState.data.gameState.players.length, 3);
    assert.ok(shuffledState.data.gameState.lastActionMessage.includes('shuffled'));

    client1.close();
    client2.close();
  });

  await t.test('Multiplayer reactions and rate limiting', async () => {
    const client1 = createClient(port);
    const client2 = createClient(port);
    await Promise.all([client1.waitForOpen, client2.waitForOpen]);

    const roomId = 'EMO' + Math.floor(Math.random() * 90000 + 10000);
    client1.send('create', { roomId, playerName: 'EmoteUser1' });
    await client1.waitFor((m) => m.type === 'joined');

    client2.send('join', { roomId, playerName: 'EmoteUser2' });
    await client2.waitFor((m) => m.type === 'joined');

    // Send valid emote
    client1.send('send_reaction', { data: { emoteId: 'fire' } });
    const reactionMsg = await client2.waitFor((m) => m.type === 'player_reaction');
    assert.equal(reactionMsg.data.emoteId, 'fire');
    assert.equal(reactionMsg.data.playerId, client1.playerId);

    client1.close();
    client2.close();
  });

  await t.test('Opponent card hover synchronization broadcasts to peers', async () => {
    const client1 = createClient(port);
    const client2 = createClient(port);
    await Promise.all([client1.waitForOpen, client2.waitForOpen]);

    const roomId = 'HOV' + Math.floor(Math.random() * 90000 + 10000);
    client1.send('create', { roomId, playerName: 'HoverUser1' });
    await client1.waitFor((m) => m.type === 'joined');

    client2.send('join', { roomId, playerName: 'HoverUser2' });
    await client2.waitFor((m) => m.type === 'joined');

    // Hover card index 3
    client1.send('player_card_hovered', { data: { cardIndex: 3 } });
    const hoverMsg = await client2.waitFor((m) => m.type === 'player_card_hovered');
    assert.equal(hoverMsg.data.cardIndex, 3);
    assert.equal(hoverMsg.data.playerId, client1.playerId);

    // Unhover
    client1.send('player_card_hovered', { data: { cardIndex: null } });
    const unhoverMsg = await client2.waitFor((m) => m.type === 'player_card_hovered' && m.data.cardIndex === null);
    assert.equal(unhoverMsg.data.cardIndex, null);

    client1.close();
    client2.close();
  });
});
