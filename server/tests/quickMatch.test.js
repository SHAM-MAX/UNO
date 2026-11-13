import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/roomManager.js';
import { PersistentRoomStore } from '../src/db.js';
import fs from 'node:fs';
import path from 'node:path';

function createFreshManager() {
  const tmpDir = path.resolve(`./data/test_db_qm_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const store = new PersistentRoomStore(path.join(tmpDir, 'test.sqlite'));
  const manager = new RoomManager(store);
  return { manager, tmpDir };
}

test('Quick Match: First player creates public quick match room', () => {
  const { manager, tmpDir } = createFreshManager();
  try {
    const p1 = manager.joinOrCreateQuickMatch('Alice', 'flip');
    assert.equal(p1.success, true);
    assert.ok(p1.roomId);
    assert.ok(p1.playerId);

    const room = manager.getRoom(p1.roomId);
    assert.equal(room.isQuickMatch, true);
    assert.equal(room.mode, 'flip');
    assert.equal(room.players.length, 1);
    assert.equal(room.players[0].name, 'Alice');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('Quick Match: Second player with matching mode automatically pairs into room', () => {
  const { manager, tmpDir } = createFreshManager();
  try {
    const p1 = manager.joinOrCreateQuickMatch('Alice', 'classic');
    const p2 = manager.joinOrCreateQuickMatch('Bob', 'classic');

    assert.equal(p1.roomId, p2.roomId);
    const room = manager.getRoom(p1.roomId);
    assert.equal(room.players.length, 2);
    assert.equal(room.players[0].name, 'Alice');
    assert.equal(room.players[1].name, 'Bob');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('Quick Match: Different game modes create isolated queues', () => {
  const { manager, tmpDir } = createFreshManager();
  try {
    const p1 = manager.joinOrCreateQuickMatch('Alice', 'classic');
    const p2 = manager.joinOrCreateQuickMatch('Bob', 'no_mercy');

    assert.notEqual(p1.roomId, p2.roomId);
    assert.equal(manager.getRoom(p1.roomId).mode, 'classic');
    assert.equal(manager.getRoom(p2.roomId).mode, 'no_mercy');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

