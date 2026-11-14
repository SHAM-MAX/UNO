import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, defaultHouseRules, sanitizeHouseRules } from '../src/roomManager.js';
import { PersistentRoomStore } from '../src/db.js';
import { isCardPlayable, canStackCard, checkMercyKnockout } from '../../shared/rules.js';
import fs from 'node:fs';
import path from 'node:path';

function createFreshManager() {
  const tmpDir = path.resolve(`./data/test_db_rules_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const store = new PersistentRoomStore(path.join(tmpDir, 'test.sqlite'));
  const manager = new RoomManager(store);
  return { manager, tmpDir };
}

test('Game Rules: Default rules match official standards across all modes', () => {
  const classicDefaults = defaultHouseRules('classic');
  assert.equal(classicDefaults.missedUnoPenalty, 2);
  assert.equal(classicDefaults.startingHandSize, 7);
  assert.equal(classicDefaults.turnDuration, 30);
  assert.equal(classicDefaults.stackingAllowed, false);
  assert.equal(classicDefaults.drawUntilPlayable, false);
  assert.equal(classicDefaults.sevenZeroSwap, false);
  assert.equal(classicDefaults.wildDraw4Challenge, true);

  const flipDefaults = defaultHouseRules('flip');
  assert.equal(flipDefaults.missedUnoPenalty, 2);
  assert.equal(flipDefaults.startingHandSize, 7);
  assert.equal(flipDefaults.turnDuration, 30);
  assert.equal(flipDefaults.stackingAllowed, false);
  assert.equal(flipDefaults.drawUntilPlayable, false);

  const noMercyDefaults = defaultHouseRules('no_mercy');
  assert.equal(noMercyDefaults.missedUnoPenalty, 2);
  assert.equal(noMercyDefaults.startingHandSize, 7);
  assert.equal(noMercyDefaults.turnDuration, 30);
  assert.equal(noMercyDefaults.stackingAllowed, true);
  assert.equal(noMercyDefaults.drawUntilPlayable, true);
  assert.equal(noMercyDefaults.sevenZeroSwap, true);
  assert.equal(noMercyDefaults.mercyKnockout, true);
  assert.equal(noMercyDefaults.mercyKnockoutLimit, 25);
});

test('Game Rules: Sanitization enforces types, ranges and ignores unsafe inputs', () => {
  // Clamping missedUnoPenalty to [1, 10]
  assert.equal(sanitizeHouseRules('classic', { missedUnoPenalty: 0 }).missedUnoPenalty, 2);
  assert.equal(sanitizeHouseRules('classic', { missedUnoPenalty: 1 }).missedUnoPenalty, 1);
  assert.equal(sanitizeHouseRules('classic', { missedUnoPenalty: 10 }).missedUnoPenalty, 10);
  assert.equal(sanitizeHouseRules('classic', { missedUnoPenalty: 99 }).missedUnoPenalty, 2);
  assert.equal(sanitizeHouseRules('classic', { missedUnoPenalty: 'invalid' }).missedUnoPenalty, 2);

  // Clamping startingHandSize to [3, 10]
  assert.equal(sanitizeHouseRules('classic', { startingHandSize: 2 }).startingHandSize, 7);
  assert.equal(sanitizeHouseRules('classic', { startingHandSize: 5 }).startingHandSize, 5);
  assert.equal(sanitizeHouseRules('classic', { startingHandSize: 15 }).startingHandSize, 7);

  // Validating turnDuration [15, 30, 45, 60]
  assert.equal(sanitizeHouseRules('classic', { turnDuration: 15 }).turnDuration, 15);
  assert.equal(sanitizeHouseRules('classic', { turnDuration: 45 }).turnDuration, 45);
  assert.equal(sanitizeHouseRules('classic', { turnDuration: 20 }).turnDuration, 30); // fallback

  // No Mercy knockout limits [20, 25, 30, 35, 45]
  assert.equal(sanitizeHouseRules('no_mercy', { mercyKnockoutLimit: 35 }).mercyKnockoutLimit, 35);
  assert.equal(sanitizeHouseRules('no_mercy', { mercyKnockoutLimit: 50 }).mercyKnockoutLimit, 25);
});

test('Game Rules: Only host may change rules; guests are unreadied when rules change', () => {
  const { manager, tmpDir } = createFreshManager();
  try {
    const roomRes = manager.createRoom('HostPlayer', 'classic');
    const roomId = roomRes.roomId;
    const hostId = roomRes.playerId;

    const guestRes = manager.joinRoom(roomId, 'GuestPlayer');
    const guestId = guestRes.playerId;

    // Guest sets ready
    manager.setReady(roomId, guestId, true);
    assert.equal(manager.getRoom(roomId).players.find(p => p.id === guestId).isReady, true);

    // Guest tries to change rules -> rejected!
    const guestAttempt = manager.setHouseRules(roomId, guestId, { missedUnoPenalty: 4 });
    assert.equal(guestAttempt.success, false);
    assert.match(guestAttempt.error, /Only the host/i);

    // Host changes rules -> succeeds and unreadies guest!
    const hostUpdate = manager.setHouseRules(roomId, hostId, { missedUnoPenalty: 4 });
    assert.equal(hostUpdate.success, true);
    assert.equal(manager.getRoom(roomId).houseRules.missedUnoPenalty, 4);
    assert.equal(manager.getRoom(roomId).players.find(p => p.id === guestId).isReady, false);

    // Starting match locks rules
    manager.setReady(roomId, guestId, true);
    manager.startGame(roomId, hostId);
    assert.equal(manager.getRoom(roomId).status, 'playing');

    // Attempting to change rules while playing -> rejected!
    const midMatchAttempt = manager.setHouseRules(roomId, hostId, { missedUnoPenalty: 6 });
    assert.equal(midMatchAttempt.success, false);
    assert.match(midMatchAttempt.error, /while a match is in progress|Cannot change rules/i);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('Game Rules: Restore default rules button resets custom rules cleanly', () => {
  const { manager, tmpDir } = createFreshManager();
  try {
    const roomRes = manager.createRoom('HostPlayer', 'classic', {
      missedUnoPenalty: 5,
      stackingAllowed: true,
      sevenZeroSwap: true,
    });
    const roomId = roomRes.roomId;
    const hostId = roomRes.playerId;

    assert.equal(manager.getRoom(roomId).houseRules.missedUnoPenalty, 5);
    assert.equal(manager.getRoom(roomId).houseRules.stackingAllowed, true);

    // Restore defaults
    manager.setHouseRules(roomId, hostId, { restoreDefaults: true });
    const rules = manager.getRoom(roomId).houseRules;
    assert.equal(rules.missedUnoPenalty, 2);
    assert.equal(rules.stackingAllowed, false);
    assert.equal(rules.sevenZeroSwap, false);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('Mandatory: Missed UNO penalty configurable from 1 to 10 cards across all modes', () => {
  const { manager, tmpDir } = createFreshManager();
  try {
    for (const mode of ['classic', 'flip', 'no_mercy']) {
      for (const penalty of [1, 4, 10]) {
        const roomRes = manager.createRoom('Host', mode, { missedUnoPenalty: penalty });
        const roomId = roomRes.roomId;
        const hostId = roomRes.playerId;
        const guestRes = manager.joinRoom(roomId, 'Guest');
        const guestId = guestRes.playerId;

        manager.startGame(roomId, hostId);
        const room = manager.getRoom(roomId);

        // Put Guest down to 1 card without calling UNO
        room.playerHands[guestId] = [{ id: `test-card-${mode}-${penalty}`, color: 'red', type: 'number', value: 3 }];
        const guest = room.players.find(p => p.id === guestId);
        guest.cardCount = 1;
        guest.hasCalledUno = false;
        guest.isUnoArmed = false;

        // Open catch window
        room.unoChallengeWindow = { targetPlayerId: guestId, expiresAt: Date.now() + 10000 };
        if (mode === 'no_mercy') room.unoChallengeTargets = [guestId];

        // Host catches guest
        const catchRes = manager.catchUno(roomId, hostId, guestId);
        assert.equal(catchRes.success, true);
        assert.equal(catchRes.drawnCount, penalty);
        assert.equal(room.playerHands[guestId].length, 1 + penalty);
        assert.equal(guest.cardCount, 1 + penalty);
        assert.match(room.lastActionMessage, new RegExp(`draws ${penalty} card`, 'i'));

        // Duplicate catch rejected immediately
        const duplicateCatch = manager.catchUno(roomId, hostId, guestId);
        assert.equal(duplicateCatch.success, false);

        // Self catch rejected
        const selfCatch = manager.catchUno(roomId, guestId, guestId);
        assert.equal(selfCatch.success, false);
      }
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('Missed UNO: Deck exhaustion reshuffles and draws all available cards safely', () => {
  const { manager, tmpDir } = createFreshManager();
  try {
    const roomRes = manager.createRoom('Host', 'classic', { missedUnoPenalty: 8 });
    const roomId = roomRes.roomId;
    const hostId = roomRes.playerId;
    const guestRes = manager.joinRoom(roomId, 'Guest');
    const guestId = guestRes.playerId;

    manager.startGame(roomId, hostId);
    const room = manager.getRoom(roomId);

    // Artificially reduce draw pile to 3 cards and discard pile to 0
    room.drawPile = room.drawPile.slice(0, 3);
    room.discardPile = [room.topDiscard];

    room.playerHands[guestId] = [{ id: 'single-card', color: 'blue', type: 'number', value: 7 }];
    const guest = room.players.find(p => p.id === guestId);
    guest.cardCount = 1;
    guest.hasCalledUno = false;
    room.unoChallengeWindow = { targetPlayerId: guestId, expiresAt: Date.now() + 10000 };

    const catchRes = manager.catchUno(roomId, hostId, guestId);
    assert.equal(catchRes.success, true);
    // Drew all 3 available cards without crashing
    assert.equal(catchRes.drawnCount, 3);
    assert.equal(room.playerHands[guestId].length, 4);
    assert.equal(guest.cardCount, 4);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('Missed UNO: Penalty in No Mercy can trigger Mercy Knockout', () => {
  const { manager, tmpDir } = createFreshManager();
  try {
    const roomRes = manager.createRoom('Host', 'no_mercy', { missedUnoPenalty: 10, mercyKnockoutLimit: 10 });
    const roomId = roomRes.roomId;
    const hostId = roomRes.playerId;
    const guestRes = manager.joinRoom(roomId, 'Guest');
    const guestId = guestRes.playerId;

    manager.startGame(roomId, hostId);
    const room = manager.getRoom(roomId);

    // Give guest exactly 1 card to be valid for UNO catch
    room.playerHands[guestId] = [{ id: 'lone-card', color: 'red', type: 'number', value: 5 }];
    const guest = room.players.find(p => p.id === guestId);
    guest.cardCount = 1;
    guest.hasCalledUno = false;
    room.unoChallengeTargets = [guestId];

    const catchRes = manager.catchUno(roomId, hostId, guestId);
    assert.equal(catchRes.success, true);
    assert.equal(catchRes.drawnCount, 10);
    // 1 card + 10 drawn = 11 cards >= 10 limit -> KNOCKED OUT!
    assert.equal(guest.isEliminated, true);
    assert.match(guest.eliminatedReason, /Knocked out by Mercy rule/i);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('Game Rules: Starting hand size configurable (3 to 10 cards)', () => {
  const { manager, tmpDir } = createFreshManager();
  try {
    for (const size of [3, 5, 10]) {
      const roomRes = manager.createRoom('Host', 'classic', { startingHandSize: size });
      const roomId = roomRes.roomId;
      const hostId = roomRes.playerId;
      const guestRes = manager.joinRoom(roomId, 'Guest');
      const guestId = guestRes.playerId;

      manager.startGame(roomId, hostId);
      const room = manager.getRoom(roomId);

      const topFace = room.topDiscard?.type;
      const isDraw2 = topFace === 'draw2';
      const leftPlayer = room.players[(room.dealerIndex + 1) % room.players.length];
      const expectedHost = isDraw2 && leftPlayer.id === hostId ? size + 2 : size;
      const expectedGuest = isDraw2 && leftPlayer.id === guestId ? size + 2 : size;

      assert.equal(room.playerHands[hostId].length, expectedHost);
      assert.equal(room.playerHands[guestId].length, expectedGuest);
      assert.equal(room.players.find(p => p.id === hostId).cardCount, expectedHost);
      assert.equal(room.players.find(p => p.id === guestId).cardCount, expectedGuest);
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('Game Rules: Turn duration configurable (15s, 30s, 45s, 60s)', () => {
  const { manager, tmpDir } = createFreshManager();
  try {
    const roomRes = manager.createRoom('Host', 'classic', { turnDuration: 15 });
    const roomId = roomRes.roomId;
    const hostId = roomRes.playerId;
    manager.joinRoom(roomId, 'Guest');

    manager.startGame(roomId, hostId);
    const room = manager.getRoom(roomId);

    const clientView = manager.getClientView(roomId, hostId);
    assert.equal(clientView.gameState.turnDurationMs, 15000);
    assert.ok(room.turnDeadline <= Date.now() + 15200);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('Game Rules: Classic Draw-card Stacking house rule', () => {
  // 1. When stackingAllowed is false (default):
  const draw2Card = { id: 'c1', color: 'red', type: 'draw2' };
  const topDraw2 = { id: 'top', color: 'blue', type: 'draw2' };
  assert.equal(canStackCard(draw2Card, 'classic', 'light', 2, topDraw2, { stackingAllowed: false }), false);
  assert.equal(isCardPlayable(draw2Card, topDraw2, 'blue', 'classic', 'light', 2, { stackingAllowed: false }), false);

  // 2. When stackingAllowed is true:
  assert.equal(canStackCard(draw2Card, 'classic', 'light', 2, topDraw2, { stackingAllowed: true }), true);
  assert.equal(isCardPlayable(draw2Card, topDraw2, 'blue', 'classic', 'light', 2, { stackingAllowed: true }), true);

  // Wild Draw 4 stacks on Wild Draw 4
  const wd4_1 = { id: 'wd4-1', color: 'wild', type: 'wild_draw4' };
  const wd4_2 = { id: 'wd4-2', color: 'wild', type: 'wild_draw4' };
  assert.equal(canStackCard(wd4_2, 'classic', 'light', 4, wd4_1, { stackingAllowed: true }), true);
});

test('Game Rules: 7-Swap and 0-Pass toggles in Classic and No Mercy', () => {
  const { manager, tmpDir } = createFreshManager();
  try {
    const roomRes = manager.createRoom('Host', 'classic', { sevenZeroSwap: true });
    const roomId = roomRes.roomId;
    const hostId = roomRes.playerId;
    const guestRes = manager.joinRoom(roomId, 'Guest');
    const guestId = guestRes.playerId;

    manager.startGame(roomId, hostId);
    const room = manager.getRoom(roomId);

    // Give host a 7 card
    const sevenCard = { id: 'card-seven', color: 'red', type: 'number', value: 7 };
    room.playerHands[hostId] = [sevenCard];
    room.activeColor = 'red';
    room.topDiscard = { id: 'top-1', color: 'red', type: 'number', value: 2 };
    room.currentTurn = 0; // host turn

    // Playing 7 requires targetPlayerId
    const failPlay = manager.playCard(roomId, hostId, { cardId: 'card-seven' });
    assert.equal(failPlay.success, false);
    assert.match(failPlay.error, /Must select a player to swap/i);

    // Give guest 4 cards
    room.playerHands[guestId] = [
      { id: 'g1', color: 'blue', type: 'number', value: 1 },
      { id: 'g2', color: 'blue', type: 'number', value: 2 },
      { id: 'g3', color: 'blue', type: 'number', value: 3 },
      { id: 'g4', color: 'blue', type: 'number', value: 4 },
    ];
    room.players.find(p => p.id === guestId).cardCount = 4;

    // Play 7 with target guest
    const playSuccess = manager.playCard(roomId, hostId, { cardId: 'card-seven', targetPlayerId: guestId });
    assert.equal(playSuccess.success, true);
    // Host swapped and now has 4 cards!
    assert.equal(room.playerHands[hostId].length, 4);
    assert.equal(room.playerHands[guestId].length, 0); // guest had hand swapped with empty remaining!
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('Game Rules: Rematch preserves settings for same mode and resets to defaults on mode change', () => {
  const { manager, tmpDir } = createFreshManager();
  try {
    const roomRes = manager.createRoom('Host', 'classic', {
      missedUnoPenalty: 5,
      startingHandSize: 5,
      turnDuration: 45,
      stackingAllowed: true,
    });
    const roomId = roomRes.roomId;
    const hostId = roomRes.playerId;
    const guestRes = manager.joinRoom(roomId, 'Guest');
    const guestId = guestRes.playerId;

    manager.startGame(roomId, hostId);
    const room = manager.getRoom(roomId);
    room.status = 'game_over';
    room.winnerId = hostId;

    // 1. Rematch with SAME mode:
    const proposalRes = manager.proposeRematch(roomId, hostId, { selectedMode: 'classic' });
    assert.equal(proposalRes.success, true);
    manager.respondRematch(roomId, guestId, { proposalId: room.rematchProposal.id, accept: true });
    manager.advanceRematch(roomId, Date.now() + 100000);

    // Check that custom rules are preserved:
    assert.equal(room.houseRules.missedUnoPenalty, 5);
    assert.equal(room.houseRules.startingHandSize, 5);
    assert.equal(room.houseRules.turnDuration, 45);
    assert.equal(room.houseRules.stackingAllowed, true);

    // 2. Rematch with DIFFERENT mode (e.g. no_mercy):
    room.status = 'game_over';
    room.winnerId = hostId;
    const prop2 = manager.proposeRematch(roomId, hostId);
    assert.equal(prop2.success, true);
    manager.respondRematch(roomId, guestId, { proposalId: room.rematchProposal.id, accept: true });
    manager.voteRematch(roomId, hostId, { proposalId: room.rematchProposal.id, mode: 'no_mercy' });
    manager.voteRematch(roomId, guestId, { proposalId: room.rematchProposal.id, mode: 'no_mercy' });
    manager.advanceRematch(roomId, Date.now() + 100000);

    // Check that No Mercy defaults are applied, while common settings (missedUnoPenalty, etc.) remain compatible:
    assert.equal(room.mode, 'no_mercy');
    assert.equal(room.houseRules.missedUnoPenalty, 5);
    assert.equal(room.houseRules.startingHandSize, 5);
    assert.equal(room.houseRules.mercyKnockout, true);
    assert.equal(room.houseRules.mercyKnockoutLimit, 25);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});
