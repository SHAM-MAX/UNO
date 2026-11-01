import { randomBytes, randomUUID } from 'node:crypto';
import { CLASSIC_COLORS, FLIP_DARK_COLORS, NO_MERCY_MAX_CARDS } from '../../shared/constants.js';
import { createDeckForMode, getActiveFace, shuffleDeck } from '../../shared/deck.js';
import {
  canStackCard,
  checkMercyKnockout,
  checkWinCondition,
  getCardDrawPenalty,
  getNextPlayerIndex,
  getPlayableCardIds,
  isCardPlayable,
} from '../../shared/rules.js';

export function defaultHouseRules(mode) {
  if (mode === 'no_mercy') {
    return {
      stackingAllowed: true,
      drawUntilPlayable: true,
      sevenZeroSwap: true,
      mercyKnockout: true,
    };
  }
  return {
    stackingAllowed: false,
    drawUntilPlayable: false,
    sevenZeroSwap: false,
    mercyKnockout: false,
  };
}

export class RoomManager {
  constructor(store) {
    this.rooms = new Map();
    this.store = store;
    this.loadFromStorage();
  }

  loadFromStorage() {
    const loaded = this.store.loadAllActiveRooms();
    for (const item of loaded) {
      if (item.state && item.roomId) {
        const state = item.state;
        state.players.forEach((p) => {
          p.isConnected = false;
          p.socket = null;
        });
        this.rooms.set(item.roomId, state);
      }
    }
    console.log(`[RoomManager] Rehydrated ${this.rooms.size} active rooms from persistent storage.`);
  }

  persist(roomId) {
    const room = this.rooms.get(roomId);
    if (room) {
      // Create a clean serializable snapshot (strip socket objects)
      const cleanPlayers = room.players.map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        isReady: p.isReady,
        isConnected: p.isConnected,
        cardCount: p.cardCount,
        hasCalledUno: p.hasCalledUno,
        isEliminated: p.isEliminated,
        eliminatedReason: p.eliminatedReason,
        score: p.score,
        sessionToken: p.sessionToken,
      }));

      const snapshot = {
        ...room,
        players: cleanPlayers,
      };
      this.store.saveRoom(roomId, room.mode, snapshot);
    }
  }

  addLog(room, text, type = 'info') {
    const log = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: Date.now(),
      text,
      type,
    };
    room.eventLogs.unshift(log);
    if (room.eventLogs.length > 50) {
      room.eventLogs.pop();
    }
    room.lastActionMessage = text;
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(hostName, mode = 'classic', houseRulesInput = {}, providedCode = null) {
    const roomId = (providedCode || this.generateRoomCode()).toUpperCase();
    if (this.rooms.has(roomId)) throw new Error('Room code is already in use. Choose another code.');
    mode = ['classic', 'flip', 'no_mercy'].includes(mode) ? mode : 'classic';
    const playerId = `p-${randomUUID()}`;
    const sessionToken = randomBytes(32).toString('base64url');

    const hostPlayer = {
      id: playerId,
      name: String(hostName || '').trim().slice(0, 18) || 'Host',
      isHost: true,
      isReady: true,
      isConnected: true,
      socket: null,
      cardCount: 0,
      hasCalledUno: false,
      isEliminated: false,
      score: 0,
      sessionToken,
    };

    const rules = { ...defaultHouseRules(mode), ...(houseRulesInput || {}) };

    const room = {
      roomId,
      mode,
      houseRules: rules,
      status: 'lobby',
      players: [hostPlayer],
      playerHands: {},
      drawPile: [],
      discardPile: [],
      topDiscard: null,
      activeColor: null,
      flipSide: 'light',
      direction: 1,
      currentTurn: 0,
      pendingDrawPenalty: 0,
      lastActionMessage: `Room created by ${hostPlayer.name}. Mode: ${mode.toUpperCase()}`,
      unoChallengeWindow: null,
      winnerId: null,
      winReason: null,
      roundNumber: 1,
      pendingAction: null,
      eventLogs: [],
      turnDrawnCard: false,
    };

    this.addLog(room, `${hostPlayer.name} created the room.`);
    this.rooms.set(roomId, room);
    this.store.saveSession(sessionToken, roomId, playerId, hostPlayer.name);
    this.persist(roomId);

    return { roomId, playerId, sessionToken };
  }

  joinRoom(roomId, playerName, sessionToken) {
    const cleanCode = (roomId || '').trim().toUpperCase();
    const room = this.rooms.get(cleanCode);
    if (!room) {
      return { success: false, error: 'Room not found. Check the code and try again.' };
    }

    // Try reconnecting via sessionToken
    if (sessionToken) {
      const existing = room.players.find((p) => p.sessionToken === sessionToken);
      if (existing) {
        existing.isConnected = true;
        this.addLog(room, `${existing.name} reconnected.`);
        this.persist(cleanCode);
        return { success: true, playerId: existing.id, sessionToken };
      }
      return { success: false, error: 'Invalid player session. Rejoin with a valid invite or create a new room.' };
    }

    if (room.status !== 'lobby') {
      return { success: false, error: 'Game has already started in this room.' };
    }

    if (room.players.length >= 6) {
      return { success: false, error: 'Room is full (maximum 6 players).' };
    }

    const playerId = `p-${randomUUID()}`;
    const newSessionToken = randomBytes(32).toString('base64url');

    const player = {
      id: playerId,
      name: String(playerName || '').trim().slice(0, 18) || `Player ${room.players.length + 1}`,
      isHost: false,
      isReady: false,
      isConnected: true,
      socket: null,
      cardCount: 0,
      hasCalledUno: false,
      isEliminated: false,
      score: 0,
      sessionToken: newSessionToken,
    };

    room.players.push(player);
    this.addLog(room, `${player.name} joined the room.`);
    this.store.saveSession(newSessionToken, room.roomId, playerId, player.name);
    this.persist(room.roomId);

    return { success: true, playerId, sessionToken: newSessionToken };
  }

  attachSocket(roomId, playerId, socket) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return false;
    player.socket = socket;
    player.isConnected = true;
    return true;
  }

  detachSocket(socket) {
    for (const [roomId, room] of this.rooms.entries()) {
      const player = room.players.find((p) => p.socket === socket);
      if (player) {
        player.isConnected = false;
        player.socket = null;
        this.addLog(room, `${player.name} disconnected.`);
        this.persist(roomId);
        return { roomId, playerId: player.id };
      }
    }
    return null;
  }

  setReady(roomId, playerId, isReady) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'lobby') return false;
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return false;
    player.isReady = Boolean(isReady);
    this.persist(roomId);
    return true;
  }

  setMode(roomId, playerId, mode) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'lobby') return false;
    if (!['classic', 'flip', 'no_mercy'].includes(mode)) return false;
    const player = room.players.find((p) => p.id === playerId);
    if (!player || !player.isHost) return false;
    room.mode = mode;
    room.houseRules = defaultHouseRules(mode);
    this.addLog(room, `Game mode changed to ${mode.toUpperCase()} by host.`);
    this.persist(roomId);
    return true;
  }

  setHouseRules(roomId, playerId, rules) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'lobby') return false;
    const player = room.players.find((p) => p.id === playerId);
    if (!player || !player.isHost) return false;
    room.houseRules = { ...room.houseRules, ...rules };
    this.persist(roomId);
    return true;
  }

  leaveRoom(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return { roomEmpty: true };

    const idx = room.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return { roomEmpty: false };

    const leavingPlayer = room.players[idx];

    if (room.status === 'lobby') {
      room.players.splice(idx, 1);
      if (room.players.length === 0) {
        this.rooms.delete(roomId);
        this.store.deleteRoom(roomId);
        return { roomEmpty: true };
      }
      if (leavingPlayer.isHost) {
        room.players[0].isHost = true;
        this.addLog(room, `${room.players[0].name} is now the host.`);
      }
    } else {
      leavingPlayer.isConnected = false;
      this.addLog(room, `${leavingPlayer.name} left the room.`);
      if (leavingPlayer.isHost) {
        const nextActive = room.players.find((p) => p.isConnected && !p.isEliminated);
        if (nextActive) {
          nextActive.isHost = true;
          this.addLog(room, `${nextActive.name} is now the host.`);
        }
      }
      const activeConnected = room.players.filter((p) => p.isConnected && !p.isEliminated);
      if (activeConnected.length === 1 && room.players.length > 1) {
        room.status = 'game_over';
        room.winnerId = activeConnected[0].id;
        room.winReason = `${activeConnected[0].name} wins! All opponents disconnected.`;
      }
    }

    this.persist(roomId);
    return { roomEmpty: false };
  }

  startGame(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player || !player.isHost) return { success: false, error: 'Only the host can start the game' };
    if (room.players.length < 2) return { success: false, error: 'At least 2 players are required to start' };

    room.status = 'playing';
    room.winnerId = null;
    room.winReason = null;
    room.direction = 1;
    room.currentTurn = 0;
    room.pendingDrawPenalty = 0;
    room.unoChallengeWindow = null;
    room.turnDrawnCard = false;
    room.flipSide = 'light';
    room.pendingAction = null;

    room.players.forEach((p) => {
      p.cardCount = 7;
      p.hasCalledUno = false;
      p.isEliminated = false;
      p.eliminatedReason = null;
    });

    const fullDeck = shuffleDeck(createDeckForMode(room.mode));

    room.playerHands = {};
    room.players.forEach((p) => {
      room.playerHands[p.id] = fullDeck.splice(0, 7);
    });

    let initialDiscardIndex = 0;
    while (initialDiscardIndex < fullDeck.length) {
      const card = fullDeck[initialDiscardIndex];
      const face = getActiveFace(card, room.mode, 'light');
      if (
        face.type !== 'wild_draw4' &&
        face.type !== 'wild_draw_color' &&
        face.type !== 'wild_reverse_draw4' &&
        face.type !== 'wild_draw6' &&
        face.type !== 'wild_draw10' &&
        face.type !== 'wild_color_roulette'
      ) {
        break;
      }
      initialDiscardIndex++;
    }

    const topCard = fullDeck.splice(initialDiscardIndex, 1)[0];
    room.discardPile = [topCard];
    room.topDiscard = topCard;
    room.drawPile = fullDeck;

    const initialFace = getActiveFace(topCard, room.mode, 'light');
    room.activeColor = initialFace.color === 'wild' ? CLASSIC_COLORS[Math.floor(Math.random() * 4)] : initialFace.color;

    if (initialFace.type === 'skip') {
      room.currentTurn = getNextPlayerIndex(0, 1, room.players);
      this.addLog(room, `Game started! Top card is Skip: ${room.players[0].name} was skipped.`);
    } else if (initialFace.type === 'reverse') {
      room.direction = -1;
      room.currentTurn = room.players.length === 2 ? 1 : room.players.length - 1;
      this.addLog(room, `Game started! Top card is Reverse: Play direction reversed.`);
    } else if (initialFace.type === 'draw2') {
      if (room.houseRules.stackingAllowed || room.mode === 'no_mercy') {
        room.pendingDrawPenalty = 2;
        this.addLog(room, `Game started! Top card is Draw 2: +2 penalty active for ${room.players[0].name}.`);
      } else {
        const drawn = room.drawPile.splice(0, 2);
        room.playerHands[room.players[0].id].push(...drawn);
        room.players[0].cardCount = room.playerHands[room.players[0].id].length;
        room.currentTurn = getNextPlayerIndex(0, 1, room.players);
        this.addLog(room, `Game started! Top card is Draw 2: ${room.players[0].name} drew 2 and was skipped.`);
      }
    } else if (room.mode === 'flip' && initialFace.type === 'flip') {
      room.flipSide = 'dark';
      const flippedFace = getActiveFace(topCard, room.mode, 'dark');
      room.activeColor = flippedFace.color === 'wild' ? FLIP_DARK_COLORS[0] : flippedFace.color;
      this.addLog(room, `Game started! Top card is Flip: Flipped to DARK side!`);
    } else {
      this.addLog(room, `Game started! ${room.players[0].name}'s turn.`);
    }

    this.persist(roomId);
    return { success: true };
  }

  reshuffleIfEmpty(room) {
    if (room.drawPile.length === 0 && room.discardPile.length > 1) {
      const top = room.discardPile.pop();
      room.drawPile = shuffleDeck(room.discardPile);
      room.discardPile = [top];
      this.addLog(room, `Reshuffled discard pile into draw pile.`);
    }
  }

  checkKnockout(room, player) {
    const hand = room.playerHands[player.id] || [];
    if (room.mode === 'no_mercy' && hand.length >= NO_MERCY_MAX_CARDS && !player.isEliminated) {
      player.isEliminated = true;
      player.eliminatedReason = `Knocked out by Mercy rule (25 cards)!`;
      room.discardPile.push(...hand);
      room.playerHands[player.id] = [];
      player.cardCount = 0;
      this.addLog(room, `💥 ${player.name} accumulated 25+ cards and was KNOCKED OUT!`, 'knockout');

      const win = checkWinCondition(room.players, room.playerHands, room.mode);
      if (win.winnerId) {
        room.status = 'game_over';
        room.winnerId = win.winnerId;
        room.winReason = win.reason;
        this.addLog(room, `🏆 ${win.reason}`, 'win');
      }
      return true;
    }
    return false;
  }

  playCard(roomId, playerId, payload) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'playing') {
      return { success: false, error: 'Game is not currently active' };
    }

    const currentPlayer = room.players[room.currentTurn];
    if (currentPlayer.id !== playerId) {
      return { success: false, error: 'It is not your turn' };
    }

    const hand = room.playerHands[playerId];
    if (!hand) return { success: false, error: 'Hand not found' };

    const cardIdx = hand.findIndex((c) => c.id === payload.cardId);
    if (cardIdx === -1) {
      return { success: false, error: 'Card not in hand' };
    }
    const card = hand[cardIdx];

    const isLegal = isCardPlayable(
      card,
      room.topDiscard,
      room.activeColor,
      room.mode,
      room.flipSide,
      room.pendingDrawPenalty,
      room.houseRules
    );

    if (!isLegal) {
      return { success: false, error: 'Illegal move: card does not match color, symbol, or stacking rules' };
    }

    const face = getActiveFace(card, room.mode, room.flipSide);

    let chosenColor = payload.chosenColor;
    if (face.color === 'wild') {
      if (!chosenColor) {
        return { success: false, error: 'Please choose a color for the wild card' };
      }
      const allowedColors = room.flipSide === 'dark' ? FLIP_DARK_COLORS : CLASSIC_COLORS;
      if (!allowedColors.includes(chosenColor)) {
        return { success: false, error: 'Invalid color chosen' };
      }
    }

    if (room.mode === 'no_mercy' && face.type === 'number' && face.value === 7) {
      if (!payload.targetPlayerId) {
        return { success: false, error: 'Must select a player to swap hands with' };
      }
      const target = room.players.find((p) => p.id === payload.targetPlayerId && !p.isEliminated);
      if (!target || target.id === playerId) {
        return { success: false, error: 'Invalid swap target player' };
      }
    }

    hand.splice(cardIdx, 1);
    room.discardPile.push(card);
    room.topDiscard = card;
    currentPlayer.cardCount = hand.length;
    room.turnDrawnCard = false;

    if (face.color === 'wild') {
      room.activeColor = chosenColor;
    } else {
      room.activeColor = face.color;
    }

    if (room.mode === 'no_mercy' && face.type === 'discard_all') {
      const matchColor = face.color;
      const discarded = [];
      const remaining = [];
      for (const c of hand) {
        const cFace = getActiveFace(c, room.mode, room.flipSide);
        if (cFace.color === matchColor) {
          discarded.push(c);
        } else {
          remaining.push(c);
        }
      }
      room.playerHands[playerId] = remaining;
      room.discardPile.push(...discarded);
      currentPlayer.cardCount = remaining.length;
      this.addLog(
        room,
        `${currentPlayer.name} played Discard All and dumped ${discarded.length} additional ${matchColor.toUpperCase()} card(s)!`
      );
    }

    if (room.mode === 'no_mercy' && face.type === 'number' && face.value === 7) {
      const target = room.players.find((p) => p.id === payload.targetPlayerId);
      const myHand = room.playerHands[playerId];
      const targetHand = room.playerHands[target.id];

      room.playerHands[playerId] = targetHand;
      room.playerHands[target.id] = myHand;

      currentPlayer.cardCount = targetHand.length;
      target.cardCount = myHand.length;

      this.addLog(room, `🔄 7 SWAP! ${currentPlayer.name} swapped hands with ${target.name}!`, 'action');
    }

    if (room.mode === 'no_mercy' && face.type === 'number' && face.value === 0) {
      const activePlayers = room.players.filter((p) => !p.isEliminated);
      if (activePlayers.length > 1) {
        const oldHands = activePlayers.map((p) => [...room.playerHands[p.id]]);
        const n = activePlayers.length;
        activePlayers.forEach((p, idx) => {
          const fromIdx = (idx - room.direction + n) % n;
          room.playerHands[p.id] = oldHands[fromIdx];
          p.cardCount = oldHands[fromIdx].length;
        });
        this.addLog(
          room,
          `🔄 0 PASS! All hands passed ${room.direction === 1 ? 'clockwise' : 'counter-clockwise'}!`,
          'action'
        );
      }
    }

    if (room.mode === 'flip' && face.type === 'flip') {
      room.flipSide = room.flipSide === 'light' ? 'dark' : 'light';
      const flippedFace = getActiveFace(card, room.mode, room.flipSide);
      room.activeColor =
        flippedFace.color === 'wild'
          ? room.flipSide === 'dark'
            ? FLIP_DARK_COLORS[0]
            : CLASSIC_COLORS[0]
          : flippedFace.color;
      this.addLog(room, `🌀 FLIP! Turned all hands, draw pile, and discard pile to the ${room.flipSide.toUpperCase()} side!`, 'action');
    }

    let step = 1;

    if (face.type === 'reverse') {
      room.direction = room.direction * -1;
      const activePlayers = room.players.filter((p) => !p.isEliminated);
      if (activePlayers.length === 2) {
        step = 0;
        this.addLog(room, `${currentPlayer.name} played Reverse (2-player: plays again!).`);
      } else {
        step = 1;
        this.addLog(room, `${currentPlayer.name} reversed play direction.`);
      }
    } else if (face.type === 'wild_reverse_draw4') {
      room.direction = room.direction * -1;
      room.pendingDrawPenalty += 4;
      step = 1;
      this.addLog(
        room,
        `⚡ ${currentPlayer.name} played Wild Reverse Draw 4! Direction reversed, +4 penalty (total ${room.pendingDrawPenalty}).`
      );
    } else if (face.type === 'skip') {
      step = 2;
      const skippedPlayer = room.players[getNextPlayerIndex(room.currentTurn, room.direction, room.players, 1)];
      this.addLog(room, `${currentPlayer.name} skipped ${skippedPlayer.name}.`);
    } else if (face.type === 'skip_everyone') {
      step = 0;
      this.addLog(room, `🛑 ${currentPlayer.name} played Skip Everyone and takes another turn!`);
    } else if (
      face.type === 'draw1' ||
      face.type === 'draw2' ||
      face.type === 'draw4' ||
      face.type === 'draw5' ||
      face.type === 'wild_draw2' ||
      face.type === 'wild_draw4' ||
      face.type === 'wild_draw6' ||
      face.type === 'wild_draw10'
    ) {
      const penalty = getCardDrawPenalty(card, room.mode, room.flipSide);
      if (room.mode === 'no_mercy' || room.houseRules.stackingAllowed) {
        room.pendingDrawPenalty += penalty;
        step = 1;
        this.addLog(room, `${currentPlayer.name} played +${penalty}! Pending penalty: ${room.pendingDrawPenalty} cards.`);
      } else {
        step = 2;
        const targetPlayer = room.players[getNextPlayerIndex(room.currentTurn, room.direction, room.players, 1)];
        this.reshuffleIfEmpty(room);
        const drawnCards = room.drawPile.splice(0, penalty);
        room.playerHands[targetPlayer.id].push(...drawnCards);
        targetPlayer.cardCount = room.playerHands[targetPlayer.id].length;
        this.addLog(room, `${currentPlayer.name} played +${penalty}! ${targetPlayer.name} drew ${drawnCards.length} cards and was skipped.`);
        this.checkKnockout(room, targetPlayer);
      }
    } else if (face.type === 'wild_draw_color' || face.type === 'wild_color_roulette') {
      step = 2;
      const targetPlayer = room.players[getNextPlayerIndex(room.currentTurn, room.direction, room.players, 1)];
      const drawnCards = [];
      let found = false;

      while (!found) {
        this.reshuffleIfEmpty(room);
        if (room.drawPile.length === 0) break;
        const drawn = room.drawPile.shift();
        drawnCards.push(drawn);
        const dFace = getActiveFace(drawn, room.mode, room.flipSide);
        if (dFace.color === chosenColor) {
          found = true;
        }
        if (room.mode === 'no_mercy' && room.playerHands[targetPlayer.id].length + drawnCards.length >= NO_MERCY_MAX_CARDS) {
          break;
        }
      }

      room.playerHands[targetPlayer.id].push(...drawnCards);
      targetPlayer.cardCount = room.playerHands[targetPlayer.id].length;
      this.addLog(
        room,
        `🎰 ${currentPlayer.name} played ${face.type === 'wild_color_roulette' ? 'Color Roulette' : 'Draw Color'} (${chosenColor.toUpperCase()})! ${targetPlayer.name} drew ${drawnCards.length} cards and was skipped!`
      );
      this.checkKnockout(room, targetPlayer);
    } else {
      this.addLog(room, `${currentPlayer.name} played ${face.color.toUpperCase()} ${face.type === 'number' ? face.value : face.type}.`);
    }

    const remainingCards = room.playerHands[playerId].length;
    if (remainingCards === 1) {
      if (currentPlayer.hasCalledUno) {
        this.addLog(room, `📢 ${currentPlayer.name} called UNO!`, 'action');
      } else {
        room.unoChallengeWindow = {
          targetPlayerId: playerId,
          expiresAt: Date.now() + 5000,
        };
        this.addLog(room, `⚠️ ${currentPlayer.name} has 1 card left and DID NOT call UNO! Catch them!`, 'warn');
      }
    } else {
      currentPlayer.hasCalledUno = false;
      room.unoChallengeWindow = null;
    }

    const win = checkWinCondition(room.players, room.playerHands, room.mode);
    if (win.winnerId) {
      room.status = 'game_over';
      room.winnerId = win.winnerId;
      room.winReason = win.reason;
      this.addLog(room, `🎉 ${win.reason}`, 'win');
      this.persist(roomId);
      return { success: true };
    }

    if (step > 0) {
      room.currentTurn = getNextPlayerIndex(room.currentTurn, room.direction, room.players, step);
    }

    this.persist(roomId);
    return { success: true };
  }

  drawCard(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'playing') {
      return { success: false, error: 'Game not active' };
    }

    const currentPlayer = room.players[room.currentTurn];
    if (currentPlayer.id !== playerId) {
      return { success: false, error: 'It is not your turn' };
    }

    const hand = room.playerHands[playerId];

    if (room.pendingDrawPenalty > 0) {
      const penalty = room.pendingDrawPenalty;
      room.pendingDrawPenalty = 0;
      const drawn = [];

      for (let i = 0; i < penalty; i++) {
        this.reshuffleIfEmpty(room);
        if (room.drawPile.length > 0) {
          drawn.push(room.drawPile.shift());
        }
      }

      hand.push(...drawn);
      currentPlayer.cardCount = hand.length;
      this.addLog(room, `${currentPlayer.name} took the penalty and drew ${drawn.length} cards!`);

      if (this.checkKnockout(room, currentPlayer)) {
        this.persist(roomId);
        return { success: true, drawnCards: drawn };
      }

      room.turnDrawnCard = false;
      room.currentTurn = getNextPlayerIndex(room.currentTurn, room.direction, room.players, 1);
      this.persist(roomId);
      return { success: true, drawnCards: drawn };
    }

    if (room.mode === 'no_mercy') {
      const drawn = [];
      let foundPlayable = false;

      while (!foundPlayable) {
        this.reshuffleIfEmpty(room);
        if (room.drawPile.length === 0) break;
        const card = room.drawPile.shift();
        drawn.push(card);
        hand.push(card);
        currentPlayer.cardCount = hand.length;

        if (this.checkKnockout(room, currentPlayer)) {
          this.persist(roomId);
          return { success: true, drawnCards: drawn };
        }

        if (isCardPlayable(card, room.topDiscard, room.activeColor, room.mode, room.flipSide, 0, room.houseRules)) {
          foundPlayable = true;
        }
      }

      this.addLog(room, `${currentPlayer.name} drew ${drawn.length} card(s) until finding a playable card.`);
      room.turnDrawnCard = true;
      this.persist(roomId);
      return { success: true, drawnCards: drawn };
    }

    this.reshuffleIfEmpty(room);
    if (room.drawPile.length === 0) {
      return { success: false, error: 'Draw pile is empty' };
    }

    const drawnCard = room.drawPile.shift();
    hand.push(drawnCard);
    currentPlayer.cardCount = hand.length;
    room.turnDrawnCard = true;

    this.addLog(room, `${currentPlayer.name} drew a card.`);

    const playable = isCardPlayable(
      drawnCard,
      room.topDiscard,
      room.activeColor,
      room.mode,
      room.flipSide,
      0,
      room.houseRules
    );

    if (!playable) {
      room.turnDrawnCard = false;
      room.currentTurn = getNextPlayerIndex(room.currentTurn, room.direction, room.players, 1);
      this.addLog(room, `Drawn card was not playable. Turn passed to ${room.players[room.currentTurn].name}.`);
    }

    this.persist(roomId);
    return { success: true, drawnCards: [drawnCard] };
  }

  passTurn(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'playing') return { success: false, error: 'Game not active' };

    const currentPlayer = room.players[room.currentTurn];
    if (currentPlayer.id !== playerId) return { success: false, error: 'Not your turn' };

    if (!room.turnDrawnCard) {
      return { success: false, error: 'You must draw a card before passing' };
    }

    room.turnDrawnCard = false;
    room.currentTurn = getNextPlayerIndex(room.currentTurn, room.direction, room.players, 1);
    this.addLog(room, `${currentPlayer.name} passed.`);
    this.persist(roomId);
    return { success: true };
  }

  callUno(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'playing') return { success: false, error: 'Game not active' };

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { success: false, error: 'Player not found' };

    player.hasCalledUno = true;
    if (room.unoChallengeWindow && room.unoChallengeWindow.targetPlayerId === playerId) {
      room.unoChallengeWindow = null;
    }

    this.addLog(room, `📢 ${player.name} called UNO!`, 'action');
    this.persist(roomId);
    return { success: true };
  }

  catchUno(roomId, challengerId, targetPlayerId) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'playing') return { success: false, error: 'Game not active' };

    const challenger = room.players.find((p) => p.id === challengerId);
    const target = room.players.find((p) => p.id === targetPlayerId);
    if (!challenger || !target) return { success: false, error: 'Player not found' };

    const targetHand = room.playerHands[targetPlayerId] || [];
    if (targetHand.length !== 1 || target.hasCalledUno) {
      return { success: false, error: 'Cannot challenge: player either called UNO or does not have 1 card' };
    }

    const drawn = [];
    for (let i = 0; i < 2; i++) {
      this.reshuffleIfEmpty(room);
      if (room.drawPile.length > 0) {
        drawn.push(room.drawPile.shift());
      }
    }
    targetHand.push(...drawn);
    target.cardCount = targetHand.length;
    target.hasCalledUno = false;
    room.unoChallengeWindow = null;

    this.addLog(
      room,
      `🚨 CAUGHT! ${challenger.name} caught ${target.name} forgetting to call UNO! ${target.name} drew 2 penalty cards!`,
      'warn'
    );
    this.checkKnockout(room, target);
    this.persist(roomId);
    return { success: true };
  }

  rematch(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'game_over') return { success: false, error: 'Game is not over' };

    const player = room.players.find((p) => p.id === playerId);
    if (!player || !player.isHost) return { success: false, error: 'Only the host can start a rematch' };

    room.roundNumber += 1;
    return this.startGame(roomId, playerId);
  }

  getClientView(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const myPlayer = room.players.find((p) => p.id === playerId);
    const myHand = myPlayer ? room.playerHands[playerId] || [] : [];
    const isMyTurn = room.status === 'playing' && room.players[room.currentTurn]?.id === playerId;

    let canPlayCards = [];
    if (isMyTurn) {
      canPlayCards = getPlayableCardIds(
        myHand,
        room.topDiscard,
        room.activeColor,
        room.mode,
        room.flipSide,
        room.pendingDrawPenalty,
        room.houseRules
      );
    }

    let canCatchUno = null;
    if (room.unoChallengeWindow && room.unoChallengeWindow.expiresAt > Date.now()) {
      if (room.unoChallengeWindow.targetPlayerId !== playerId) {
        canCatchUno = room.unoChallengeWindow.targetPlayerId;
      }
    }

    const publicPlayers = room.players.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      isReady: p.isReady,
      isConnected: p.isConnected,
      cardCount: p.cardCount,
      hasCalledUno: p.hasCalledUno,
      isEliminated: p.isEliminated,
      eliminatedReason: p.eliminatedReason,
      score: p.score,
    }));

    const gameState = {
      roomId: room.roomId,
      mode: room.mode,
      houseRules: room.houseRules,
      status: room.status,
      players: publicPlayers,
      currentTurn: room.currentTurn,
      direction: room.direction,
      topDiscard: room.topDiscard,
      activeColor: room.activeColor,
      flipSide: room.flipSide,
      pendingDrawPenalty: room.pendingDrawPenalty,
      lastActionMessage: room.lastActionMessage,
      unoChallengeWindow: room.unoChallengeWindow,
      winnerId: room.winnerId,
      winReason: room.winReason,
      roundNumber: room.roundNumber,
      deckRemainingCount: room.drawPile.length,
      discardRemainingCount: room.discardPile.length,
      pendingAction: room.pendingAction,
      turnDrawnCard: room.turnDrawnCard,
      eventLogs: room.eventLogs.slice(0, 20),
    };

    return {
      gameState,
      myHand,
      myPlayerId: playerId,
      isMyTurn,
      canPlayCards,
      canDraw: isMyTurn,
      canCallUno: myHand.length <= 2,
      canCatchUno,
    };
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomCount() {
    return this.rooms.size;
  }
}

