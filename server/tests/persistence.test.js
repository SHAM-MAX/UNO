import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PersistentRoomStore } from '../src/db.js';
import { RoomManager } from '../src/roomManager.js';

test('Persistence: State survives room manager recreation', () => {
  const testDir = path.join(process.cwd(), 'data', 'test_db_' + Date.now());
  const store1 = new PersistentRoomStore(testDir);
  const rm1 = new RoomManager(store1);

  const { roomId, playerId: p1, sessionToken } = rm1.createRoom('PersistentHost', 'classic');
  const { playerId: p2 } = rm1.joinRoom(roomId, 'Guest');

  rm1.startGame(roomId, p1);
  const originalRoom = rm1.getRoom(roomId);
  const originalTurn = originalRoom.currentTurn;
  const originalTopCardId = originalRoom.topDiscard.id;

  // Simulate server shutdown and reboot by instantiating new store and RoomManager
  const store2 = new PersistentRoomStore(testDir);
  const rm2 = new RoomManager(store2);

  const rehydratedRoom = rm2.getRoom(roomId);
  assert.ok(rehydratedRoom, 'Room must be rehydrated from persistent database');
  assert.equal(rehydratedRoom.mode, 'classic');
  assert.equal(rehydratedRoom.status, 'playing');
  assert.equal(rehydratedRoom.topDiscard.id, originalTopCardId);
  assert.equal(rehydratedRoom.players.length, 2);

  // Test player reconnection using sessionToken
  const reconnectRes = rm2.joinRoom(roomId, 'PersistentHost', sessionToken);
  assert.ok(reconnectRes.success, 'Reconnecting with session token must succeed');
  assert.equal(reconnectRes.playerId, p1, 'Player ID must match original seat');

  // Cleanup test directory
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch (e) {}
});

