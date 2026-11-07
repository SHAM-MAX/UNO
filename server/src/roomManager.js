import { randomBytes, randomUUID } from 'node:crypto';
import { CLASSIC_COLORS, FLIP_DARK_COLORS, NO_MERCY_MAX_CARDS, REMATCH_RESPONSE_MS, REMATCH_VOTING_MS, REMATCH_RESULT_MS } from '../../shared/constants.js';
import { createDeckForMode, getActiveFace, shuffleDeck } from '../../shared/deck.js';
import {
  calculateScore,
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
      mercyKnockoutLimit: NO_MERCY_MAX_CARDS,
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
    this.turnTimers = new Map();
    this.rematchTimers = new Map();
    this.onStateChange = null;
    this.loadFromStorage();
  }

  loadFromStorage() {
    const loaded = this.store.loadAllActiveRooms();
    for (const item of loaded) {
      if (item.state && item.roomId) {
        const state = item.state;
        state.matchId ||= randomUUID();
        [...state.players, ...(state.spectators || [])].forEach((p) => {
          p.isConnected = false;
          p.socket = null;
        });
        this.rooms.set(item.roomId, state);
        this.scheduleRematch(state);
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
        spectators: (room.spectators || []).map(({ socket, ...player }) => player),
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

    const rules = { ...defaultHouseRules(mode) };
    if (mode === 'no_mercy') {
      const requestedLimit = Number(houseRulesInput?.mercyKnockoutLimit);
      if ([25, 35, 45].includes(requestedLimit)) rules.mercyKnockoutLimit = requestedLimit;
    }

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
      const existing = [...room.players, ...(room.spectators || [])].find((p) => p.sessionToken === sessionToken);
      if (existing) {
        existing.isConnected = true;
        if (room.status === 'playing' && !this.turnTimers.has(room.roomId)) this.resetTurnTimer(room);
        this.addLog(room, `${existing.name} reconnected.`);
        this.persist(cleanCode);
        return { success: true, playerId: existing.id, sessionToken };
      }
      return { success: false, error: 'Invalid player session. Rejoin with a valid invite or create a new room.' };
    }

    if (room.status !== 'lobby') {
      return { success: false, error: 'Game has already started in this room.' };
    }

    if (room.players.length >= (room.mode === 'classic' ? 10 : 6)) {
      return { success: false, error: `Room is full (maximum ${room.mode === 'classic' ? 10 : 6} players).` };
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
    const player = [...room.players, ...(room.spectators || [])].find((p) => p.id === playerId);
    if (!player) return false;
    player.socket = socket;
    player.isConnected = true;
    return true;
  }

  detachSocket(socket) {
    for (const [roomId, room] of this.rooms.entries()) {
      const player = [...room.players, ...(room.spectators || [])].find((p) => p.socket === socket);
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
    if (mode !== 'classic' && room.players.length > 6) return false;
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
    if (room.mode === 'no_mercy') {
      const requestedLimit = Number(rules?.mercyKnockoutLimit);
      if ([25, 35, 45].includes(requestedLimit)) {
        room.houseRules = { ...room.houseRules, mercyKnockoutLimit: requestedLimit };
        this.addLog(room, `${player.name} set the Mercy knockout limit to ${requestedLimit} cards.`);
      }
    }
    this.persist(roomId);
    return true;
  }

  leaveRoom(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return { roomEmpty: true };

    const proposal = room.rematchProposal;
    if (room.status === 'game_over' && proposal && ['responding','voting','resolved'].includes(proposal.status)) {
      const participant = room.players.find(p => p.id === playerId);
      if (participant) participant.isConnected = false;
      if (proposal.initiatorPlayerId === playerId) this.cancelRematch(roomId, playerId, {proposalId:proposal.id});
      else if (proposal.pendingPlayerIds.includes(playerId)) this.respondRematch(roomId,playerId,{proposalId:proposal.id,accept:false});
      this.persist(roomId);
      return {roomEmpty:false};
    }
    if (room.status === 'game_over') { const player=room.players.find(p=>p.id===playerId); if(player){player.isConnected=false;player.socket=null;} this.persist(roomId);return {roomEmpty:false}; }
    const spectator = (room.spectators || []).find(p => p.id === playerId);
    if (spectator) { spectator.isConnected = false; spectator.socket = null; this.persist(roomId); return {roomEmpty:false}; }
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
    if (room.status === 'game_over') return {success:false,error:'Request a rematch proposal before starting a new match'};
    if (room.players.length < 2) return { success: false, error: 'At least 2 players are required to start' };

    if (room.status === 'lobby') room.matchId = randomUUID();
    if (!['lobby', 'round_over', 'game_over'].includes(room.status)) return { success: false, error: 'Round already active' };
    if (room.mode === 'classic') {
      if (room.status !== 'round_over') {
        room.players.forEach(p => { p.score = 0; });
        room.roundNumber = 1;
        room.dealerIndex = this.determineClassicDealer(room);
      } else {
        room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
        room.roundNumber++;
      }
      room.roundResult = null;
      room.lastDrawFourResult = null;
      room.pendingRoundWinner = null;
      room.turnDrawnCardId = null;
    }
    if (room.mode === 'no_mercy') { room.dealerIndex = Math.floor(Math.random() * room.players.length); room.mercyPile = []; room.turnDrawnCardId = null; room.lastRoulette = null; room.unoChallengeTargets = []; room.lastNoMercyAction = null; }
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
      if (room.mode === 'no_mercy' ? face.type === 'number' : (
        face.type !== 'wild_draw4' &&
        face.type !== 'wild_draw_color' &&
        face.type !== 'wild_reverse_draw4' &&
        face.type !== 'wild_draw6' &&
        face.type !== 'wild_draw10' &&
        face.type !== 'wild_color_roulette' &&
        !(room.mode === 'flip' && face.type === 'flip'))
      ) {
        break;
      }
      initialDiscardIndex++;
    }

    const topCard = fullDeck.splice(initialDiscardIndex, 1)[0];
    room.discardPile = room.mode === 'no_mercy' ? [...fullDeck.splice(0, initialDiscardIndex), topCard] : [topCard];
    room.topDiscard = topCard;
    room.drawPile = fullDeck;

    const initialFace = getActiveFace(topCard, room.mode, 'light');
    room.activeColor = initialFace.color === 'wild' ? CLASSIC_COLORS[Math.floor(Math.random() * 4)] : initialFace.color;

    if (room.mode === 'no_mercy') {
      room.currentTurn = (room.dealerIndex + 1) % room.players.length;
      this.addLog(room, `No Mercy: ${room.players[room.currentTurn].name} starts; action cards ignored during setup.`);
    } else if (room.mode === 'classic') {
      this.applyClassicOpening(room, initialFace);
    } else if (initialFace.type === 'skip') {
      room.currentTurn = getNextPlayerIndex(0, 1, room.players);
      this.addLog(room, `Game started! Top card is Skip: ${room.players[0].name} was skipped.`);
    } else if (initialFace.type === 'reverse') {
      room.direction = -1;
      room.currentTurn = room.players.length === 2 ? 1 : room.players.length - 1;
      this.addLog(room, `Game started! Top card is Reverse: Play direction reversed.`);
    } else if (initialFace.type === 'draw2') {
      if (room.mode !== 'classic' && (room.houseRules.stackingAllowed || room.mode === 'no_mercy')) {
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

    this.resetTurnTimer(room);
    this.persist(roomId);
    return { success: true };
  }

  determineClassicDealer(room, drawDeck = () => shuffleDeck(createDeckForMode('classic'))) {
    let tied = room.players.map((_, i) => i);
    while (tied.length > 1) {
      const deck = drawDeck();
      const draws = tied.map(i => ({ i, card: deck.pop() }));
      const value = card => card.type === 'number' ? card.value : 0;
      const high = Math.max(...draws.map(d => value(d.card)));
      this.addLog(room, `Dealer draw: ${draws.map(d => `${room.players[d.i].name}: ${value(d.card)}`).join(', ')}.`);
      tied = draws.filter(d => value(d.card) === high).map(d => d.i);
      if (tied.length > 1) this.addLog(room, `Dealer draw tied. ${tied.map(i => room.players[i].name).join(', ')} draw again.`);
    }
    return tied[0];
  }

  takeCards(room, count) {
    const cards = [];
    for (let i = 0; i < count; i++) {
      this.reshuffleIfEmpty(room);
      if (!room.drawPile.length) break;
      cards.push(room.drawPile.shift());
    }
    return cards;
  }

  applyClassicOpening(room, face) {
    const left = (room.dealerIndex + 1) % room.players.length;
    room.currentTurn = left;
    if (face.type === 'reverse') { room.direction = -1; room.currentTurn = room.dealerIndex; }
    if (face.type === 'skip' || face.type === 'draw2') {
      if (face.type === 'draw2') {
        const p = room.players[left];
        room.playerHands[p.id].push(...this.takeCards(room, 2));
        p.cardCount = room.playerHands[p.id].length;
      }
      room.currentTurn = (left + 1) % room.players.length;
    }
    if (face.type === 'wild') {
      room.activeColor = null;
      room.pendingAction = { type: 'opening_color', targetPlayerId: room.players[left].id };
    }
    this.addLog(room, `Round ${room.roundNumber}: ${room.players[room.currentTurn].name} starts. Dealer: ${room.players[room.dealerIndex].name}.`);
  }

  chooseOpeningColor(roomId, playerId, color) {
    const room = this.rooms.get(roomId);
    if (room?.mode === 'no_mercy') return this.resolveRoulette(roomId, playerId, color);
    if (room?.status !== 'playing' || room.pendingAction?.type !== 'opening_color' || room.pendingAction.targetPlayerId !== playerId || !CLASSIC_COLORS.includes(color)) return { success: false, error: 'Invalid opening colour choice' };
    room.activeColor = color;
    room.pendingAction = null;
    this.resetTurnTimer(room);
    this.persist(roomId);
    return { success: true };
  }

  finishClassicRound(room, winnerId) {
    const points = room.players.filter(p => p.id !== winnerId).reduce((sum, p) => sum + calculateScore(room.playerHands[p.id]), 0);
    const winner = room.players.find(p => p.id === winnerId);
    winner.score = (winner.score || 0) + points;
    room.roundResult = { winnerId, points, total: winner.score };
    room.winnerId = winnerId;
    room.status = winner.score >= 500 ? 'game_over' : 'round_over';
    room.winReason = `${winner.name} earned ${points} points (${winner.score}/500).`;
    room.pendingRoundWinner = null;
    room.unoChallengeWindow = null;
    this.resetTurnTimer(room);
  }

  resolveDrawFour(roomId, playerId, challenge = true) {
    const room = this.rooms.get(roomId);
    const action = room?.pendingAction;
    if (room?.status !== 'playing' || action?.type !== 'draw4_challenge' || action.targetPlayerId !== playerId) return { success: false, error: 'No Draw Four challenge available' };
    // Evaluate the immutable pre-play snapshot, never the current hand or chosen colour.
    const matchingColorCount = action.handBeforePlay?.filter(card => card.color === action.previousColor).length;
    const hadMatchingColor = matchingColorCount !== undefined ? matchingColorCount > 0 : Boolean(action.illegal);
    const successful = challenge && hadMatchingColor;
    const target = room.players.find(p => p.id === (successful ? action.offenderId : playerId));
    room.playerHands[target.id].push(...this.takeCards(room, successful || !challenge ? 4 : 6));
    target.cardCount = room.playerHands[target.id].length;
    target.hasCalledUno = false;
    room.lastDrawFourResult = {
      id: action.id || randomUUID(),
      offenderId: action.offenderId,
      challengerId: challenge ? playerId : null,
      outcome: !challenge ? 'accepted' : successful ? 'successful' : 'failed',
      penalizedPlayerId: target.id,
      drawCount: successful || !challenge ? 4 : 6,
      evidence: challenge ? { activeColorBeforePlay: action.previousColor, hadMatchingColor, matchingColorCount } : null,
    };
    room.pendingAction = null;
    room.unoChallengeWindow = null;
    this.addLog(room, challenge ? `Draw Four challenge ${successful ? 'successful' : 'failed'}: ${target.name} draws ${successful ? 4 : 6}.` : `${target.name} accepts and draws four.`, 'action');
    if (!successful) room.currentTurn = getNextPlayerIndex(room.currentTurn, room.direction, room.players);
    if (room.pendingRoundWinner && !successful) this.finishClassicRound(room, room.pendingRoundWinner);
    else { room.pendingRoundWinner = null; room.winnerId = null; }
    this.resetTurnTimer(room);
    this.persist(roomId);
    return { success: true };
  }

  resolveRoulette(roomId, playerId, color) {
    const room = this.rooms.get(roomId);
    const action = room?.pendingAction;
    if (room?.status !== 'playing' || action?.type !== 'color_roulette' || action.targetPlayerId !== playerId || !CLASSIC_COLORS.includes(color)) return { success: false, error: 'Invalid Roulette colour choice' };
    room.pendingAction = null;
    room.unoChallengeTargets = [];
    room.activeColor = color;
    const target = room.players.find(p => p.id === playerId);
    const revealed = [];
    while (!target.isEliminated) {
      const card = this.takeCards(room, 1)[0];
      if (!card) break;
      revealed.push(card);
      room.playerHands[playerId].push(card);
      target.cardCount = room.playerHands[playerId].length;
      if (this.checkKnockout(room, target) || card.color === color) break;
    }
    room.lastRoulette = { id: action.id, targetPlayerId: playerId, color, revealed };
    room.unoChallengeWindow = null;
    room.turnDrawnCard = false; room.turnDrawnCardId = null;
    room.currentTurn = getNextPlayerIndex(room.currentTurn, room.direction, room.players);
    const win = checkWinCondition(room.players, room.playerHands, room.mode);
    if (win.winnerId) { room.status = 'game_over'; room.winnerId = win.winnerId; room.winReason = win.reason; }
    this.addLog(room, `${target.name} chose ${color} and revealed ${revealed.length} Roulette cards; turn skipped.`);
    this.resetTurnTimer(room); this.persist(roomId);
    return { success: true };
  }

  reshuffleIfEmpty(room) {
    if (room.drawPile.length === 0 && (room.discardPile.length > 1 || (room.mode === 'no_mercy' && room.mercyPile?.length))) {
      const top = room.discardPile.pop();
      room.drawPile = shuffleDeck([...room.discardPile, ...(room.mode === 'no_mercy' ? room.mercyPile || [] : [])]);
      if (room.mode === 'no_mercy') room.mercyPile = [];
      room.discardPile = [top];
      this.addLog(room, `Reshuffled discard pile into draw pile.`);
    }
  }

  checkKnockout(room, player) {
    const hand = room.playerHands[player.id] || [];
    const knockoutLimit = Number(room.houseRules?.mercyKnockoutLimit) || NO_MERCY_MAX_CARDS;
    if (room.mode === 'no_mercy' && hand.length >= knockoutLimit && !player.isEliminated) {
      player.isEliminated = true;
      player.eliminatedReason = `Knocked out by Mercy rule (${knockoutLimit} cards)!`;
      room.mercyPile = [...(room.mercyPile || []), ...hand];
      room.playerHands[player.id] = [];
      player.cardCount = 0;
      this.addLog(room, `💥 ${player.name} accumulated ${knockoutLimit}+ cards and was KNOCKED OUT!`, 'knockout');

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

  resetTurnTimer(room) {
    if (!room) return;
    room.turnTimerGeneration = (room.turnTimerGeneration || 0) + 1;
    if (room.mode !== 'flip') room.actionVersion = (room.actionVersion || 0) + 1;
    if (this.turnTimers.has(room.roomId)) {
      clearTimeout(this.turnTimers.get(room.roomId));
      this.turnTimers.delete(room.roomId);
    }

    if (room.status !== 'playing') {
      room.turnDeadline = null;
      return;
    }

    if (room.pendingAction && ['opening_color', 'color_roulette'].includes(room.pendingAction.type)) { room.turnDeadline = null; return; }
    const DURATION = 20000; // 20 seconds
    room.turnDeadline = Date.now() + DURATION;

    const currentTurnAtSchedule = room.currentTurn;
    const actionVersionAtSchedule = room.actionVersion;
    const generationAtSchedule = room.turnTimerGeneration;
    const timer = setTimeout(() => {
      this.handleTurnTimeout(room.roomId, currentTurnAtSchedule, actionVersionAtSchedule, generationAtSchedule);
    }, DURATION + 150);
    if (timer.unref) timer.unref();

    this.turnTimers.set(room.roomId, timer);
  }

  handleTurnTimeout(roomId, expectedTurn, expectedActionVersion, expectedGeneration) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (expectedGeneration !== undefined && expectedGeneration !== room.turnTimerGeneration) return;
    // Guard against race conditions where turn already advanced
    if (room.currentTurn !== expectedTurn) return;
    if (room.mode !== 'flip' && expectedActionVersion !== undefined && expectedActionVersion !== room.actionVersion) return;

    const currentPlayer = room.players[room.currentTurn];
    if (!currentPlayer || currentPlayer.isEliminated) return;
    if (room.pendingAction && ['opening_color', 'color_roulette'].includes(room.pendingAction.type)) {
      return; // An opening wild requires the first player's explicit choice.
    }

    if (room.mode === 'no_mercy') {
      if (!room.turnDrawnCard && !room.pendingDrawPenalty) {
        const playable = getPlayableCardIds(room.playerHands[currentPlayer.id], room.topDiscard, room.activeColor, room.mode);
        if (!playable.length) this.drawCard(roomId, currentPlayer.id);
      }
      if (room.status === 'playing' && room.players[room.currentTurn].id === currentPlayer.id) {
        if (room.pendingDrawPenalty) this.drawCard(roomId, currentPlayer.id);
        else {
          const cardId = room.turnDrawnCardId || getPlayableCardIds(room.playerHands[currentPlayer.id], room.topDiscard, room.activeColor, room.mode)[0];
          if (cardId) this.playCard(roomId, currentPlayer.id, { cardId, chosenColor: CLASSIC_COLORS[0], targetPlayerId: room.players.find(p => !p.isEliminated && p.id !== currentPlayer.id)?.id });
        }
      }
      if (this.onStateChange) this.onStateChange(roomId);
      return;
    }
    if (room.turnDrawnCard) {
      // Player already drew, so pass their turn
      this.passTurn(roomId, currentPlayer.id);
      this.addLog(room, `⏱️ ${currentPlayer.name}'s turn timed out (20s). Turn passed.`);
      room.lastActionMessage = `⏱️ ${currentPlayer.name}'s turn timed out (20s).`;
    } else {
      // Player took no action: automatically apply penalty/draw and pass
      if (room.pendingDrawPenalty > 0) {
        this.drawCard(roomId, currentPlayer.id);
        this.addLog(room, `⏱️ ${currentPlayer.name}'s turn timed out! Draw penalty applied.`);
        room.lastActionMessage = `⏱️ ${currentPlayer.name}'s turn timed out! Penalty applied.`;
      } else {
        this.drawCard(roomId, currentPlayer.id);
        if (room.turnDrawnCard) {
          this.passTurn(roomId, currentPlayer.id);
        }
        this.addLog(room, `⏱️ ${currentPlayer.name}'s turn timed out (20s). Drew card & passed.`);
        room.lastActionMessage = `⏱️ ${currentPlayer.name}'s turn timed out (20s). Drew card & passed.`;
      }
    }

    this.persist(roomId);

    if (room.status === 'playing') {
      this.resetTurnTimer(room);
    }

    if (this.onStateChange) {
      this.onStateChange(roomId);
    }
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

    if (room.mode !== 'flip' && room.pendingAction) return { success: false, error: 'Resolve the pending colour or challenge first' };
    const hand = room.playerHands[playerId];
    if (!hand) return { success: false, error: 'Hand not found' };

    const cardIdx = hand.findIndex((c) => c.id === payload.cardId);
    if (cardIdx === -1) {
      return { success: false, error: 'Card not in hand' };
    }
    const card = hand[cardIdx];
    if (room.mode !== 'flip' && room.turnDrawnCard && card.id !== room.turnDrawnCardId) return { success: false, error: 'Only the newly drawn card may be played' };

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
    if (face.color === 'wild' && face.type !== 'wild_color_roulette') {
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

    const previousColor = room.activeColor;
    const hadMatchingColor = hand.some(c => c.color === previousColor);
    const handBeforeDrawFour = room.mode === 'classic' && face.type === 'wild_draw4' ? hand.map(c => ({ ...c })) : null;
    if (room.mode !== 'flip') room.unoChallengeWindow = null;
    if (room.mode === 'no_mercy') room.unoChallengeTargets = [];
    hand.splice(cardIdx, 1);
    room.discardPile.push(card);
    room.topDiscard = card;
    currentPlayer.cardCount = hand.length;
    room.turnDrawnCard = false;
    if (room.mode === 'no_mercy') room.lastNoMercyAction = { id: randomUUID(), type: face.type, playerId, targetPlayerId: payload.targetPlayerId, direction: room.direction, discardedIds: [] };

    if (face.color === 'wild') {
      room.activeColor = room.mode === 'no_mercy' && face.type === 'wild_color_roulette' ? null : chosenColor;
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
      room.discardPile.splice(room.discardPile.length - 1, 0, ...discarded);
      room.lastNoMercyAction.discardedIds = discarded.map(c => c.id);
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

    if (room.mode === 'classic' && face.type === 'wild_draw4') {
      step = 1;
      room.lastDrawFourResult = null;
      room.pendingAction = { id: randomUUID(), type: 'draw4_challenge', offenderId: playerId, targetPlayerId: room.players[getNextPlayerIndex(room.currentTurn, room.direction, room.players)].id, illegal: hadMatchingColor, previousColor, handBeforePlay: handBeforeDrawFour };
      this.addLog(room, `${currentPlayer.name} played Wild Draw Four. Accept or challenge.`);
    } else if (face.type === 'reverse') {
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
      step = room.mode === 'no_mercy' && room.players.filter(p => !p.isEliminated).length === 2 ? 0 : 1;
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
      if (room.mode !== 'classic' && (room.mode === 'no_mercy' || room.houseRules.stackingAllowed)) {
        room.pendingDrawPenalty += penalty;
        step = 1;
        this.addLog(room, `${currentPlayer.name} played +${penalty}! Pending penalty: ${room.pendingDrawPenalty} cards.`);
      } else {
        step = 2;
        const targetPlayer = room.players[getNextPlayerIndex(room.currentTurn, room.direction, room.players, 1)];
        this.reshuffleIfEmpty(room);
        const drawnCards = room.mode === 'classic' ? this.takeCards(room, penalty) : room.drawPile.splice(0, penalty);
        room.playerHands[targetPlayer.id].push(...drawnCards);
        targetPlayer.cardCount = room.playerHands[targetPlayer.id].length;
        this.addLog(room, `${currentPlayer.name} played +${penalty}! ${targetPlayer.name} drew ${drawnCards.length} cards and was skipped.`);
        this.checkKnockout(room, targetPlayer);
      }
    } else if (room.mode === 'no_mercy' && face.type === 'wild_color_roulette') {
      const target = room.players[getNextPlayerIndex(room.currentTurn, room.direction, room.players)];
      room.pendingAction = { id: randomUUID(), type: 'color_roulette', targetPlayerId: target.id };
      this.addLog(room, `${target.name} must choose the Roulette colour.`);
    } else if (face.type === 'wild_draw_color') {
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
        const knockoutLimit = Number(room.houseRules?.mercyKnockoutLimit) || NO_MERCY_MAX_CARDS;
        if (room.mode === 'no_mercy' && room.playerHands[targetPlayer.id].length + drawnCards.length >= knockoutLimit) {
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

    if (room.mode === 'no_mercy') {
      room.lastNoMercyAction.direction = room.direction;
      if (face.type === 'number' && [0, 7].includes(face.value)) {
        room.players.forEach(p => { p.hasCalledUno = false; });
      }
    }
    const remainingCards = room.playerHands[playerId].length;
    if (remainingCards === 1) {
      if (currentPlayer.hasCalledUno || currentPlayer.isUnoArmed) {
        currentPlayer.hasCalledUno = true;
        currentPlayer.isUnoArmed = false;
        this.addLog(room, `📢 ${currentPlayer.name} called UNO!`, 'action');
      } else {
        currentPlayer.hasCalledUno = false;
        currentPlayer.isUnoArmed = false;
        room.unoChallengeWindow = {
          targetPlayerId: playerId,
          expiresAt: room.mode !== 'flip' ? null : Date.now() + 5000,
        };
        this.addLog(room, `⚠️ ${currentPlayer.name} has 1 card left and DID NOT call UNO! Catch them!`, 'warn');
      }
    } else {
      currentPlayer.hasCalledUno = false;
      currentPlayer.isUnoArmed = false;
      room.unoChallengeWindow = null;
    }

    if (room.mode === 'no_mercy') {
      room.unoChallengeTargets = room.players.filter(p => (p.id === playerId || (face.type === 'number' && [0, 7].includes(face.value))) && !p.isEliminated && room.playerHands[p.id].length === 1 && !p.hasCalledUno).map(p => p.id);
      room.unoChallengeWindow = room.unoChallengeTargets.length ? { targetPlayerId: room.unoChallengeTargets[0], expiresAt: null } : null;
    }
    const win = checkWinCondition(room.players, room.playerHands, room.mode);
    if (win.winnerId && !(room.mode === 'no_mercy' && (room.pendingAction || (face.type === 'wild_reverse_draw4' && step === 0)))) {
      if (room.mode === 'classic') {
        if (!room.pendingAction) this.finishClassicRound(room, win.winnerId);
        else room.pendingRoundWinner = win.winnerId;
      } else if (!room.pendingAction) room.status = 'game_over';
      if (!room.pendingAction) room.winnerId = win.winnerId;
      if (room.mode !== 'classic') room.winReason = win.reason;
      this.addLog(room, `🎉 ${win.reason}`, 'win');
      if (!room.pendingAction) { this.resetTurnTimer(room); this.persist(roomId); return { success: true }; }
    }

    if (step > 0) {
      room.currentTurn = getNextPlayerIndex(room.currentTurn, room.direction, room.players, step);
    }

    room.turnDrawnCardId = null;
    this.resetTurnTimer(room);
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

    if (room.mode === 'classic') {
      if (room.pendingAction?.type === 'draw4_challenge') return this.resolveDrawFour(roomId, playerId, false);
      if (room.pendingAction || room.turnDrawnCard) return { success: false, error: 'Cannot draw again or before choosing colour' };
      room.unoChallengeWindow = null;
      currentPlayer.hasCalledUno = false;
    }
    const hand = room.playerHands[playerId];
    if (room.mode === 'no_mercy') {
      if (room.pendingAction || room.turnDrawnCard) return { success: false, error: 'Resolve the pending action or play the drawn card' };
      if (!room.pendingDrawPenalty && getPlayableCardIds(hand, room.topDiscard, room.activeColor, room.mode).length) return { success: false, error: 'Play a matching card before drawing' };
      room.unoChallengeWindow = null; room.unoChallengeTargets = []; currentPlayer.hasCalledUno = false;
    }

    if (room.pendingDrawPenalty > 0) {
      const penalty = room.pendingDrawPenalty;
      room.pendingDrawPenalty = 0;
      const drawn = [];

      for (let i = 0; i < penalty; i++) {
        const card = this.takeCards(room, 1)[0];
        if (!card) break;
        drawn.push(card); hand.push(card); currentPlayer.cardCount = hand.length;
        if (this.checkKnockout(room, currentPlayer)) break;
      }
      this.addLog(room, `${currentPlayer.name} took the penalty and drew ${drawn.length} cards!`);
      if (hand.length !== 1) {
        currentPlayer.hasCalledUno = false;
        currentPlayer.isUnoArmed = false;
      }
      room.turnDrawnCard = false;
      room.turnDrawnCardId = null;
      room.currentTurn = getNextPlayerIndex(room.currentTurn, room.direction, room.players, 1);
      this.resetTurnTimer(room);
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
          room.currentTurn = getNextPlayerIndex(room.currentTurn, room.direction, room.players);
          room.turnDrawnCard = false; room.turnDrawnCardId = null;
          this.resetTurnTimer(room);
          this.persist(roomId);
          return { success: true, drawnCards: drawn };
        }

        if (isCardPlayable(card, room.topDiscard, room.activeColor, room.mode, room.flipSide, 0, room.houseRules)) {
          foundPlayable = true;
        }
      }

      this.addLog(room, `${currentPlayer.name} drew ${drawn.length} card(s) until finding a playable card.`);
      if (hand.length !== 1) {
        currentPlayer.hasCalledUno = false;
        currentPlayer.isUnoArmed = false;
      }
      room.turnDrawnCard = foundPlayable;
      room.turnDrawnCardId = foundPlayable ? drawn.at(-1).id : null;
      if (!foundPlayable) room.currentTurn = getNextPlayerIndex(room.currentTurn, room.direction, room.players);
      this.resetTurnTimer(room);
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
    if (hand.length !== 1) {
      currentPlayer.hasCalledUno = false;
      currentPlayer.isUnoArmed = false;
    }
    room.turnDrawnCard = true;
    room.turnDrawnCardId = drawnCard.id;

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
      room.turnDrawnCardId = null;
      room.currentTurn = getNextPlayerIndex(room.currentTurn, room.direction, room.players, 1);
      this.addLog(room, `Drawn card was not playable. Turn passed to ${room.players[room.currentTurn].name}.`);
    }

    this.resetTurnTimer(room);
    this.persist(roomId);
    return { success: true, drawnCards: [drawnCard] };
  }

  passTurn(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'playing') return { success: false, error: 'Game not active' };

    const currentPlayer = room.players[room.currentTurn];
    if (currentPlayer.id !== playerId) return { success: false, error: 'Not your turn' };

    if (room.mode !== 'flip' && room.pendingAction) return { success: false, error: 'Resolve pending action first' };
    if (room.mode === 'no_mercy' && room.turnDrawnCardId) return { success: false, error: 'You must play the drawn card' };
    if (!room.turnDrawnCard) {
      return { success: false, error: 'You must draw a card before passing' };
    }

    currentPlayer.isUnoArmed = false;
    if (room.playerHands[currentPlayer.id]?.length !== 1) {
      currentPlayer.hasCalledUno = false;
    }
    room.turnDrawnCard = false;
    room.turnDrawnCardId = null;
    room.currentTurn = getNextPlayerIndex(room.currentTurn, room.direction, room.players, 1);
    this.addLog(room, `${currentPlayer.name} passed.`);
    this.resetTurnTimer(room);
    this.persist(roomId);
    return { success: true };
  }

  callUno(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'playing') return { success: false, error: 'Game not active' };

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { success: false, error: 'Player not found' };

    const hand = room.playerHands[playerId] || [];
    const isTwoCardArming = hand.length === 2 && room.players[room.currentTurn]?.id === playerId && !room.pendingAction;
    const isCatchWindowTarget = room.unoChallengeWindow?.targetPlayerId === playerId || (room.mode === 'no_mercy' && room.unoChallengeTargets?.includes(playerId));

    if (room.mode !== 'flip' && !isTwoCardArming && !isCatchWindowTarget) {
      return { success: false, error: 'Call UNO when playing down to one card' };
    }
    if (room.mode !== 'flip' && (player.hasCalledUno || player.isUnoArmed)) {
      return { success: false, error: 'UNO already called' };
    }

    if (isTwoCardArming) {
      player.isUnoArmed = true;
      player.hasCalledUno = true;
      this.addLog(room, `📢 ${player.name} armed UNO!`, 'action');
    } else {
      player.hasCalledUno = true;
      player.isUnoArmed = false;
      if (room.unoChallengeWindow && room.unoChallengeWindow.targetPlayerId === playerId) {
        room.unoChallengeWindow = null;
      }
      if (room.mode === 'no_mercy') {
        room.unoChallengeTargets = (room.unoChallengeTargets || []).filter(id => id !== playerId);
        room.unoChallengeWindow = room.unoChallengeTargets.length ? { targetPlayerId: room.unoChallengeTargets[0], expiresAt: null } : null;
      }
      this.addLog(room, `📢 ${player.name} called UNO!`, 'action');
    }

    if (room.mode !== 'classic') this.resetTurnTimer(room);
    this.persist(roomId);
    return { success: true, armed: isTwoCardArming };
  }

  catchUno(roomId, challengerId, targetPlayerId) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'playing') return { success: false, error: 'Game not active' };

    const challenger = room.players.find((p) => p.id === challengerId);
    const target = room.players.find((p) => p.id === targetPlayerId);
    if (room.mode === 'no_mercy' && challenger?.isEliminated) return { success: false, error: 'Eliminated players cannot catch UNO' };
    if (!challenger || !target) return { success: false, error: 'Player not found' };

    if (challengerId === targetPlayerId) {
      return { success: false, error: 'Cannot catch yourself' };
    }

    const targetHand = room.playerHands[targetPlayerId] || [];
    if (target.hasCalledUno) {
      return { success: false, error: `CAUGHT FAILED: ${target.name} already called UNO.` };
    }
    if (targetHand.length !== 1) {
      return { success: false, error: `CAUGHT FAILED: ${target.name} no longer has one card.` };
    }

    const inWindow = room.mode === 'no_mercy'
      ? (room.unoChallengeTargets?.includes(targetPlayerId) || room.unoChallengeWindow?.targetPlayerId === targetPlayerId)
      : (room.unoChallengeWindow?.targetPlayerId === targetPlayerId && (room.mode !== 'flip' || room.unoChallengeWindow.expiresAt > Date.now()));

    if (room.mode !== 'flip' && !inWindow) {
      return { success: false, error: 'CAUGHT FAILED: UNO catch window is closed' };
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
    target.isUnoArmed = false;
    room.unoChallengeWindow = null;
    if (room.mode === 'no_mercy') {
      room.unoChallengeTargets = (room.unoChallengeTargets || []).filter(id => id !== targetPlayerId);
      room.unoChallengeWindow = room.unoChallengeTargets.length ? { targetPlayerId: room.unoChallengeTargets[0], expiresAt: null } : null;
    }

    const caughtMsg = `CAUGHT! ${target.name} draws 2 cards.`;
    this.addLog(room, caughtMsg, 'warn');
    room.lastActionMessage = caughtMsg;

    this.checkKnockout(room, target);
    this.persist(roomId);
    return { success: true, targetId: targetPlayerId, targetName: target.name, drawnCount: drawn.length };
  }

  rematch(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (room?.status === 'game_over') return this.proposeRematch(roomId, playerId);
    if (room?.status !== 'round_over') return {success:false,error:'Round is not over'};
    if (!room.players.find(p => p.id === playerId)?.isHost) return {success:false,error:'Only the host can start the next round'};
    return this.startGame(roomId,playerId);
  }

  scheduleRematch(room) {
    clearTimeout(this.rematchTimers.get(room.roomId));
    this.rematchTimers.delete(room.roomId);
    const p = room.rematchProposal;
    const due = p?.status === 'responding' ? p.responseDeadline : p?.status === 'voting' ? p.votingDeadline : p?.status === 'resolved' ? p.startAt : null;
    if (!due) return;
    const timer = setTimeout(() => this.advanceRematch(room.roomId), Math.max(0,due-Date.now())+5);
    timer.unref?.(); this.rematchTimers.set(room.roomId,timer);
  }

  proposeRematch(roomId,playerId,payload={}) {
    const room = this.rooms.get(roomId);
    if (payload.matchId !== undefined && payload.matchId !== room?.matchId) return {success:false,error:'The match changed. This rematch request is stale'};
    if (room?.status !== 'game_over' || room.winnerId !== playerId || !room.players.some(p=>p.id===playerId)) return {success:false,error:'Only the match winner can request a rematch'};
    if (['responding','voting','resolved'].includes(room.rematchProposal?.status)) return {success:false,error:'A rematch proposal is already open'};
    const now=Date.now();
    const initiatorId = playerId;
    const acceptedPlayerIds = [initiatorId];
    const pendingPlayerIds = room.players.filter(p => p.id !== initiatorId).map(p => p.id);
    const participants = room.players.map(p => ({
      id: p.id,
      name: p.name,
      status: p.id === initiatorId ? 'accepted' : 'pending',
    }));

    room.rematchProposal = {
      id: randomUUID(),
      version: 1,
      initiatorPlayerId: initiatorId,
      originalParticipantIds: room.players.map(p => p.id),
      participants,
      acceptedPlayerIds,
      declinedPlayerIds: [],
      pendingPlayerIds,
      modeVotes: {},
      status: 'responding',
      createdAt: now,
      responseDeadline: now + REMATCH_RESPONSE_MS,
      votingDeadline: now + REMATCH_RESPONSE_MS + REMATCH_VOTING_MS,
      selectedMode: null,
      previousMode: room.mode,
      previousResult: {
        winnerId: room.winnerId,
        winReason: room.winReason,
        scores: room.players.map(p => ({ id: p.id, name: p.name, score: p.score || 0 })),
      },
    };
    this.scheduleRematch(room);this.persist(roomId);return {success:true};
  }

  rematchAction(roomId,playerId,payload,kind) {
    this.advanceRematch(roomId);
    const room=this.rooms.get(roomId),p=room?.rematchProposal;
    if (!p || payload?.proposalId!==p.id || !p.originalParticipantIds.includes(playerId)) return {error:'Invalid or stale rematch proposal'};
    if (payload.version !== undefined && payload.version !== p.version) return {error:'Rematch changed. Review the current proposal'};
    if (!(['cancel','withdraw'].includes(kind)?['responding','voting','resolved']:['responding','voting']).includes(p.status)) return {error:'Rematch proposal is closed'};
    if (kind==='respond' && (p.status!=='responding' || Date.now()>=p.responseDeadline)) return {error:'The response deadline has passed'};
    return {room,p};
  }

  respondRematch(roomId,playerId,payload) {
    const {room,p,error}=this.rematchAction(roomId,playerId,payload,payload.withdraw?'withdraw':'respond');
    if (error) return {success:false,error};
    if (payload.withdraw) {
      if (payload.accept!==false || playerId===p.initiatorPlayerId || !p.acceptedPlayerIds.includes(playerId)) return {success:false,error:'No accepted invitation to decline'};
      p.acceptedPlayerIds=p.acceptedPlayerIds.filter(id=>id!==playerId);
      if (!p.declinedPlayerIds.includes(playerId)) p.declinedPlayerIds.push(playerId);
      p.pendingPlayerIds=p.pendingPlayerIds.filter(id=>id!==playerId);
      delete p.modeVotes[playerId];p.version++;
      if (p.status!=='responding' && p.acceptedPlayerIds.length<2) {p.status='cancelled';p.reason='At least two players must accept.';}
      else if (p.status==='resolved') p.selectedMode=this.selectRematchMode(p);
      this.advanceRematch(roomId);this.scheduleRematch(room);this.persist(roomId);return {success:true};
    }
    if (typeof payload.accept!=='boolean' || !p.pendingPlayerIds.includes(playerId)) return {success:false,error:'A response was already recorded or is invalid'};
    p.pendingPlayerIds=p.pendingPlayerIds.filter(id=>id!==playerId);
    if (payload.accept) {
      if (!p.acceptedPlayerIds.includes(playerId)) p.acceptedPlayerIds.push(playerId);
      p.declinedPlayerIds=p.declinedPlayerIds.filter(id=>id!==playerId);
    } else {
      if (!p.declinedPlayerIds.includes(playerId)) p.declinedPlayerIds.push(playerId);
      p.acceptedPlayerIds=p.acceptedPlayerIds.filter(id=>id!==playerId);
      delete p.modeVotes[playerId];
    }
    if(p.acceptedPlayerIds.length>6)for(const [id,mode] of Object.entries(p.modeVotes))if(mode!=='classic')delete p.modeVotes[id];
    p.version++;
    this.advanceRematch(roomId);this.scheduleRematch(room);this.persist(roomId);return {success:true};
  }

  voteRematch(roomId,playerId,payload) {
    const {room,p,error}=this.rematchAction(roomId,playerId,payload,'vote');
    if (error) return {success:false,error};
    if (!p.acceptedPlayerIds.includes(playerId)) return {success:false,error:'Accept the invitation before voting'};
    if (!['classic','flip','no_mercy'].includes(payload.mode) || (payload.mode!=='classic' && p.acceptedPlayerIds.length>6)) return {success:false,error:'That mode does not support the accepted player count'};
    p.modeVotes[playerId]=payload.mode;p.version++;this.persist(roomId);return {success:true};
  }

  cancelRematch(roomId,playerId,payload) {
    const {room,p,error}=this.rematchAction(roomId,playerId,payload,'cancel');
    if (error) return {success:false,error};
    if (p.initiatorPlayerId!==playerId) return {success:false,error:'Only the initiator may cancel'};
    p.status='cancelled';p.reason='The initiator cancelled the rematch.';p.version++;
    this.scheduleRematch(room);this.persist(roomId);return {success:true};
  }

  selectRematchMode(p) {
    const allowed=['classic','flip','no_mercy'].filter(mode=>mode==='classic'||p.acceptedPlayerIds.length<=6);
    const counts=Object.fromEntries(allowed.map(mode=>[mode,0]));
    for (const id of p.acceptedPlayerIds) {
      const mode=allowed.includes(p.modeVotes[id])?p.modeVotes[id]:allowed.includes(p.previousMode)?p.previousMode:'classic';
      p.modeVotes[id]=mode;counts[mode]++;
    }
    const high=Math.max(...Object.values(counts)),tied=allowed.filter(mode=>counts[mode]===high);
    return tied.includes(p.modeVotes[p.initiatorPlayerId])?p.modeVotes[p.initiatorPlayerId]:tied.includes(p.previousMode)?p.previousMode:tied[0];
  }

  advanceRematch(roomId,now=Date.now()) {
    const room=this.rooms.get(roomId),p=room?.rematchProposal;
    if (!p || !['responding','voting','resolved'].includes(p.status)) return;
    let changed=false;
    if (p.status==='responding' && (!p.pendingPlayerIds.length || now>=p.responseDeadline)) {
      for (const id of p.pendingPlayerIds) {
        if (!p.declinedPlayerIds.includes(id) && !p.acceptedPlayerIds.includes(id)) {
          p.declinedPlayerIds.push(id);
        }
      }
      p.pendingPlayerIds=[];
      if (p.acceptedPlayerIds.length<2) {p.status='cancelled';p.reason='At least two players must accept.';}
      else {p.status='voting';p.votingDeadline=Math.min(now,p.responseDeadline)+REMATCH_VOTING_MS;}
      p.version++;changed=true;
    }
    if (p.status==='voting' && now>=p.votingDeadline) {p.selectedMode=this.selectRematchMode(p);p.status='resolved';p.startAt=p.votingDeadline+REMATCH_RESULT_MS;p.version++;changed=true;}
    if (p.status==='resolved' && now>=p.startAt) {this.startRematchRoster(room,p);changed=true;}
    if (changed) {this.persist(roomId);this.scheduleRematch(room);this.onStateChange?.(roomId);}
  }

  startRematchRoster(room,p) {
    if (p.status!=='resolved' || room.status!=='game_over') return;
    const accepted=new Set(p.acceptedPlayerIds);
    const excluded=room.players.filter(player=>!accepted.has(player.id));
    room.spectators=[...(room.spectators||[]),...excluded].filter((player,i,all)=>all.findIndex(x=>x.id===player.id)===i);
    room.players=room.players.filter(player=>accepted.has(player.id));
    const host=room.players.find(player=>player.isHost&&player.isConnected)||room.players.find(player=>player.id===p.initiatorPlayerId&&player.isConnected)||room.players.find(player=>player.isConnected)||room.players.find(player=>player.id===p.initiatorPlayerId)||room.players[0];
    for (const player of [...room.players,...room.spectators]) {player.isHost=player.id===host.id; if(accepted.has(player.id)){player.score=0;player.isReady=true;}}
    room.mode=p.selectedMode;room.houseRules=defaultHouseRules(room.mode);room.roundNumber=1;room.turnDrawnCardId=null;room.roundResult=null;room.lastDrawFourResult=null;room.pendingRoundWinner=null;room.actionReceipts=[];room.status='lobby';
    p.status='started';p.version++;
    this.startGame(room.roomId,host.id);
  }

  getClientView(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const myPlayer = room.players.find((p) => p.id === playerId);
    const isSpectator = !myPlayer && (room.spectators || []).some(p=>p.id===playerId);
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

    if (room.mode !== 'flip') {
      if (room.pendingAction) canPlayCards = [];
      if (room.turnDrawnCard) canPlayCards = canPlayCards.filter(id => id === room.turnDrawnCardId);

    }
    let canCatchUno = null;
    if (room.unoChallengeWindow && (room.mode !== 'flip' || room.unoChallengeWindow.expiresAt > Date.now())) {
      if (room.unoChallengeWindow.targetPlayerId !== playerId) {
        canCatchUno = room.unoChallengeWindow.targetPlayerId;
      }
    }

    if (room.mode === 'no_mercy') canCatchUno = room.unoChallengeTargets?.find(id => id !== playerId) || null;
    const canCatchUnoTargets = room.mode === 'no_mercy'
      ? (room.unoChallengeTargets || []).filter(id => id !== playerId)
      : (canCatchUno ? [canCatchUno] : []);
    const publicPlayers = room.players.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      isReady: p.isReady,
      isConnected: p.isConnected,
      cardCount: p.cardCount,
      hasCalledUno: p.hasCalledUno,
      isUnoArmed: p.isUnoArmed || false,
      isEliminated: p.isEliminated,
      eliminatedReason: p.eliminatedReason,
      score: p.score,
    }));

    const gameState = {
      roomId: room.roomId,
      actionVersion: room.actionVersion || 0,
      matchId: room.matchId,
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
      pendingAction: room.mode === 'classic' && room.pendingAction ? { id: room.pendingAction.id, type: room.pendingAction.type, offenderId: room.pendingAction.offenderId, targetPlayerId: room.pendingAction.targetPlayerId } : room.pendingAction,
      drawFourResult: room.lastDrawFourResult ? Object.fromEntries(Object.entries(room.lastDrawFourResult).filter(([key]) => key !== 'evidence')) : null,
      noMercyAction: room.mode === 'no_mercy' ? room.lastNoMercyAction || null : null,
      rouletteResult: room.mode === 'no_mercy' ? room.lastRoulette || null : null,
      roundResult: room.roundResult,
      dealerIndex: room.dealerIndex,
      turnDrawnCard: room.turnDrawnCard,
      turnDeadline: room.turnDeadline || null,
      turnDurationMs: 20000,
      eventLogs: room.eventLogs.slice(0, 20),
    };

    let rematchProposal = null;
    if (room.rematchProposal) {
      const p = room.rematchProposal;
      const acceptedSet = new Set(p.acceptedPlayerIds || []);
      if (p.initiatorPlayerId) acceptedSet.add(p.initiatorPlayerId);
      const declinedSet = new Set((p.declinedPlayerIds || []).filter((id) => !acceptedSet.has(id)));
      const pendingList = (p.pendingPlayerIds || []).filter((id) => !acceptedSet.has(id) && !declinedSet.has(id));

      rematchProposal = {
        ...p,
        acceptedPlayerIds: Array.from(acceptedSet),
        declinedPlayerIds: Array.from(declinedSet),
        pendingPlayerIds: pendingList,
        participants: (p.participants || []).map((player) => {
          const isAccepted = acceptedSet.has(player.id) || player.id === p.initiatorPlayerId;
          const isDeclined = !isAccepted && declinedSet.has(player.id);
          return {
            ...player,
            status: isAccepted ? 'accepted' : isDeclined ? 'declined' : 'pending',
          };
        }),
      };
    }

    return {
      gameState,
      isSpectator,
      rematchProposal,
      canProposeRematch: room.status === 'game_over' && room.winnerId === playerId && !['responding','voting','resolved'].includes(room.rematchProposal?.status),
      myHand,
      myPlayerId: playerId,
      isMyTurn,
      canPlayCards,
      canDraw: room.mode === 'no_mercy' ? isMyTurn && !room.pendingAction && !room.turnDrawnCard && (room.pendingDrawPenalty > 0 || !canPlayCards.length) : room.mode === 'classic' ? isMyTurn && !room.turnDrawnCard && (!room.pendingAction || room.pendingAction.type === 'draw4_challenge') : isMyTurn,
      canCallUno: room.mode !== 'flip' ? room.status === 'playing' && ((isMyTurn && myHand.length === 2 && !room.pendingAction) || room.unoChallengeWindow?.targetPlayerId === playerId || (room.mode === 'no_mercy' && room.unoChallengeTargets?.includes(playerId))) && !myPlayer.hasCalledUno : myHand.length <= 2,
      canCatchUno,
      canCatchUnoTargets,
      drawFourEvidence: room.lastDrawFourResult?.challengerId === playerId ? { id: room.lastDrawFourResult.id, ...room.lastDrawFourResult.evidence } : null,
    };
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomCount() {
    return this.rooms.size;
  }
}

