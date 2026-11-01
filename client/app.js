import { CLASSIC_COLORS, FLIP_DARK_COLORS, COLOR_METADATA } from '../shared/constants.js';
import { sounds } from './audio.js';
import { renderCardHTML, renderCardBackHTML } from './cardGraphics.js';

class UnoArenaApp {
  constructor() {
    this.ws = null;
    this.roomId = null;
    this.playerId = null;
    this.sessionToken = null;
    this.playerName = localStorage.getItem('uno_arena_name') || '';
    this.gameState = null;
    this.clientView = null;
    this.pendingPlayCard = null; // Card awaiting color or target selection

    this.initElements();
    this.initEvents();
    this.checkUrlForRoomCode();
  }

  initElements() {
    this.el = {
      banner: document.getElementById('connectionBanner'),
      navRoomCode: document.getElementById('navRoomCode'),
      navModeTag: document.getElementById('navModeTag'),
      soundToggleBtn: document.getElementById('soundToggleBtn'),
      soundIcon: document.getElementById('soundIcon'),
      howToPlayBtn: document.getElementById('howToPlayBtn'),
      leaveBtn: document.getElementById('leaveBtn'),
      toast: document.getElementById('toast'),

      // Containers
      entryView: document.getElementById('entryView'),
      arenaView: document.getElementById('arenaView'),

      // Entry
      playerNameInput: document.getElementById('playerNameInput'),
      roomCodeInput: document.getElementById('roomCodeInput'),
      createRoomBtn: document.getElementById('createRoomBtn'),
      joinRoomBtn: document.getElementById('joinRoomBtn'),

      // Lobby
      lobbySection: document.getElementById('lobbySection'),
      lobbyCodeBadge: document.getElementById('lobbyCodeBadge'),
      lobbyCodeText: document.getElementById('lobbyCodeText'),
      copyInviteBtn: document.getElementById('copyInviteBtn'),
      modeSelectorGrid: document.getElementById('modeSelectorGrid'),
      lobbyPlayersList: document.getElementById('lobbyPlayersList'),
      readyBtn: document.getElementById('readyBtn'),
      startGameBtn: document.getElementById('startGameBtn'),

      // Arena
      opponentsRow: document.getElementById('opponentsRow'),
      tableFelt: document.getElementById('tableFelt'),
      directionArrow: document.getElementById('directionArrow'),
      directionText: document.getElementById('directionText'),
      discardPile: document.getElementById('discardPile'),
      drawPile: document.getElementById('drawPile'),
      drawPileBtn: document.getElementById('drawPileBtn'),
      drawCountBadge: document.getElementById('drawCountBadge'),
      penaltyTag: document.getElementById('penaltyTag'),
      actionBanner: document.getElementById('actionBanner'),

      // Player Controls
      btnDrawAction: document.getElementById('btnDrawAction'),
      btnPassAction: document.getElementById('btnPassAction'),
      btnUnoAction: document.getElementById('btnUnoAction'),
      btnCatchAction: document.getElementById('btnCatchAction'),
      playerHandCards: document.getElementById('playerHandCards'),

      // Modals
      colorPickerModal: document.getElementById('colorPickerModal'),
      colorOptionsContainer: document.getElementById('colorOptionsContainer'),
      swapPickerModal: document.getElementById('swapPickerModal'),
      swapOptionsContainer: document.getElementById('swapOptionsContainer'),
      gameOverModal: document.getElementById('gameOverModal'),
      winnerNameText: document.getElementById('winnerNameText'),
      winReasonText: document.getElementById('winReasonText'),
      rematchBtn: document.getElementById('rematchBtn'),
      rulesModal: document.getElementById('rulesModal'),
      rulesModalClose: document.getElementById('rulesModalClose'),
    };
  }

  initEvents() {
    // Sound toggle
    this.el.soundToggleBtn.addEventListener('click', () => {
      const enabled = sounds.toggle();
      this.updateSoundIcon(enabled);
      this.showToast(enabled ? 'Sound Enabled 🔊' : 'Sound Muted 🔇');
    });
    this.updateSoundIcon(sounds.isEnabled());

    // How to Play modal
    this.el.howToPlayBtn.addEventListener('click', () => this.openRulesModal());
    this.el.rulesModalClose.addEventListener('click', () => this.closeRulesModal());

    // Leave room
    this.el.leaveBtn.addEventListener('click', () => this.leaveRoom());

    // Create room
    this.el.createRoomBtn.addEventListener('click', () => {
      const name = this.el.playerNameInput.value.trim() || 'Player 1';
      this.playerName = name;
      localStorage.setItem('uno_arena_name', name);
      this.createRoom(name);
    });

    // Join room
    this.el.joinRoomBtn.addEventListener('click', () => {
      const name = this.el.playerNameInput.value.trim() || 'Guest';
      const code = this.el.roomCodeInput.value.trim().toUpperCase();
      if (!code) {
        this.showToast('Please enter a room code');
        return;
      }
      this.playerName = name;
      localStorage.setItem('uno_arena_name', name);
      this.connectWebSocket(code, null, null, name);
    });

    // Copy invite
    this.el.copyInviteBtn.addEventListener('click', () => this.copyInviteLink());
    this.el.lobbyCodeBadge.addEventListener('click', () => this.copyInviteLink());
    this.el.navRoomCode.addEventListener('click', () => this.copyInviteLink());

    // Ready & Start
    this.el.readyBtn.addEventListener('click', () => {
      if (!this.clientView) return;
      const me = this.clientView.gameState.players.find((p) => p.id === this.playerId);
      const nextReady = !me?.isReady;
      this.send({ type: 'ready', data: { isReady: nextReady } });
    });

    this.el.startGameBtn.addEventListener('click', () => {
      this.send({ type: 'start_game' });
    });

    // In-game actions
    this.el.btnDrawAction.addEventListener('click', () => {
      sounds.playDraw();
      this.send({ type: 'draw_card' });
    });

    this.el.drawPileBtn.addEventListener('click', () => {
      if (this.clientView?.isMyTurn) {
        sounds.playDraw();
        this.send({ type: 'draw_card' });
      }
    });

    this.el.btnPassAction.addEventListener('click', () => {
      this.send({ type: 'pass_turn' });
    });

    this.el.btnUnoAction.addEventListener('click', () => {
      sounds.playUnoCall();
      this.send({ type: 'call_uno' });
      this.showToast('UNO called! 📢');
    });

    this.el.btnCatchAction.addEventListener('click', () => {
      if (this.clientView?.canCatchUno) {
        sounds.playCatch();
        this.send({ type: 'catch_uno', data: { targetPlayerId: this.clientView.canCatchUno } });
      }
    });

    // Rematch
    this.el.rematchBtn.addEventListener('click', () => {
      this.send({ type: 'rematch' });
      this.el.gameOverModal.classList.remove('active');
    });

    // Rules Tabs
    document.querySelectorAll('.rule-tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.rule-tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.rule-content-block').forEach((c) => (c.style.display = 'none'));
        e.target.classList.add('active');
        const tab = e.target.dataset.tab;
        document.getElementById(`tab-${tab}`).style.display = 'block';
      });
    });
  }

  checkUrlForRoomCode() {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      this.el.roomCodeInput.value = roomParam.toUpperCase();
      this.el.roomCodeInput.focus();
    }
  }

  updateSoundIcon(enabled) {
    this.el.soundIcon.textContent = enabled ? '🔊' : '🔇';
  }

  showToast(msg) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.el.toast.classList.remove('show');
    }, 2800);
  }

  async createRoom(hostName) {
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostName, mode: 'classic' }),
      });
      const data = await res.json();
      if (data.success) {
        this.roomId = data.roomId;
        this.playerId = data.playerId;
        this.sessionToken = data.sessionToken;
        this.connectWebSocket(data.roomId, data.playerId, data.sessionToken, hostName);
      }
    } catch (e) {
      this.showToast('Error creating room');
    }
  }

  connectWebSocket(roomId, playerId, sessionToken, playerName) {
    if (this.ws) {
      this.ws.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.el.banner.classList.remove('visible');
      // Send join message
      this.send({
        type: 'join',
        roomId,
        playerId,
        sessionToken,
        playerName: playerName || this.playerName,
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'joined') {
          this.roomId = msg.data.roomId;
          this.playerId = msg.data.playerId;
          this.sessionToken = msg.data.sessionToken;
          localStorage.setItem(`session_${this.roomId}`, this.sessionToken);
          localStorage.setItem(`player_${this.roomId}`, this.playerId);
        } else if (msg.type === 'room:state') {
          this.handleRoomState(msg.data);
        } else if (msg.type === 'error') {
          this.showToast(msg.message || 'Error');
        }
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    this.ws.onclose = () => {
      this.el.banner.classList.add('visible');
      // Auto-reconnect after 2 seconds
      setTimeout(() => {
        if (this.roomId) {
          const sToken = localStorage.getItem(`session_${this.roomId}`);
          const pId = localStorage.getItem(`player_${this.roomId}`);
          this.connectWebSocket(this.roomId, pId, sToken, this.playerName);
        }
      }, 2000);
    };

    this.ws.onerror = (err) => {
      console.warn('WebSocket connection error:', err);
    };
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const full = {
        roomId: this.roomId,
        playerId: this.playerId,
        sessionToken: this.sessionToken,
        ...payload,
      };
      this.ws.send(JSON.stringify(full));
    }
  }

  handleRoomState(view) {
    this.clientView = view;
    this.gameState = view.gameState;

    // Update Top Bar
    this.el.navRoomCode.textContent = `ROOM: ${this.gameState.roomId}`;
    this.el.navRoomCode.style.display = 'inline-flex';
    this.el.navModeTag.textContent = this.gameState.mode.replace('_', ' ');
    this.el.navModeTag.className = `mode-tag ${this.gameState.mode}`;
    this.el.navModeTag.style.display = 'inline-block';
    this.el.leaveBtn.style.display = 'inline-flex';

    if (this.gameState.status === 'lobby') {
      this.renderLobby();
    } else {
      this.renderArena();
    }
  }

  renderLobby() {
    this.el.entryView.style.display = 'block';
    this.el.arenaView.style.display = 'none';
    this.el.lobbySection.style.display = 'block';
    document.getElementById('entryFormSection').style.display = 'none';

    this.el.lobbyCodeText.textContent = this.gameState.roomId;

    // Render Mode selector
    const me = this.gameState.players.find((p) => p.id === this.playerId);
    const isHost = me?.isHost || false;

    this.el.modeSelectorGrid.innerHTML = `
      <button class="mode-card-btn ${this.gameState.mode === 'classic' ? 'selected' : ''}" data-mode="classic" ${!isHost ? 'disabled' : ''}>
        <strong>Classic</strong>
        <span style="font-size: 0.72rem; color: #94A3B8;">108 Cards • Standard UNO</span>
      </button>
      <button class="mode-card-btn ${this.gameState.mode === 'flip' ? 'selected' : ''}" data-mode="flip" ${!isHost ? 'disabled' : ''}>
        <strong>UNO Flip</strong>
        <span style="font-size: 0.72rem; color: #94A3B8;">Double-Sided • Dark Side</span>
      </button>
      <button class="mode-card-btn ${this.gameState.mode === 'no_mercy' ? 'selected' : ''}" data-mode="no_mercy" ${!isHost ? 'disabled' : ''}>
        <strong>No Mercy</strong>
        <span style="font-size: 0.72rem; color: #94A3B8;">168 Cards • Knockout</span>
      </button>
    `;

    if (isHost) {
      this.el.modeSelectorGrid.querySelectorAll('.mode-card-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const mode = e.currentTarget.dataset.mode;
          this.send({ type: 'set_mode', data: { mode } });
        });
      });
    }

    // Render Players
    this.el.lobbyPlayersList.innerHTML = this.gameState.players
      .map(
        (p) => `
        <div class="lobby-player-row">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span>${p.isHost ? '👑' : '👤'}</span>
            <strong>${p.name}</strong>
            ${p.id === this.playerId ? '<span style="font-size: 0.75rem; color: #F59E0B;">(You)</span>' : ''}
          </div>
          <div>
            <span class="ready-pill ${p.isReady ? 'ready' : 'waiting'}">
              ${p.isReady ? '✓ READY' : 'WAITING'}
            </span>
          </div>
        </div>
      `
      )
      .join('');

    // Host controls
    if (isHost) {
      this.el.startGameBtn.style.display = 'block';
      const allReady = this.gameState.players.length >= 2 && this.gameState.players.every((p) => p.isReady);
      this.el.startGameBtn.disabled = !allReady;
      this.el.startGameBtn.textContent = allReady
        ? 'START GAME ▶'
        : `WAITING FOR PLAYERS (${this.gameState.players.length}/6)`;
    } else {
      this.el.startGameBtn.style.display = 'none';
    }

    // Ready button state
    this.el.readyBtn.textContent = me?.isReady ? 'CANCEL READY' : 'I AM READY ✓';
    this.el.readyBtn.style.background = me?.isReady ? '#475569' : '#10B981';
  }

  renderArena() {
    this.el.entryView.style.display = 'none';
    this.el.arenaView.style.display = 'flex';

    const { gameState, myHand, isMyTurn, canPlayCards, canDraw, canCallUno, canCatchUno } = this.clientView;

    // Action banner
    this.el.actionBanner.textContent = gameState.lastActionMessage || 'Game in progress';

    // Arena Table theme (Flip Light vs Dark)
    if (gameState.mode === 'flip' && gameState.flipSide === 'dark') {
      this.el.tableFelt.classList.add('dark-side');
    } else {
      this.el.tableFelt.classList.remove('dark-side');
    }

    // Direction
    this.el.directionArrow.className = `direction-arrow ${gameState.direction === -1 ? 'counter-clockwise' : ''}`;
    this.el.directionText.textContent = gameState.direction === 1 ? 'Clockwise' : 'Counter-Clockwise';

    // Opponents
    const opponents = gameState.players.filter((p) => p.id !== this.playerId);
    this.el.opponentsRow.innerHTML = opponents
      .map((p, idx) => {
        const isCurrent = gameState.players[gameState.currentTurn]?.id === p.id;
        const unoActive = p.cardCount === 1;
        return `
          <div class="opponent-card-badge ${isCurrent ? 'active-turn' : ''} ${p.isEliminated ? 'eliminated' : ''}">
            <div class="opponent-avatar">
              ${p.name.charAt(0).toUpperCase()}
            </div>
            <div class="opponent-info">
              <div class="opponent-name">
                ${p.isHost ? '👑 ' : ''}${p.name}
                ${isCurrent ? '⭐' : ''}
              </div>
              <div class="opponent-cards-count">
                🂠 ${p.isEliminated ? 'KNOCKED OUT' : `${p.cardCount} cards`}
              </div>
            </div>
            ${unoActive && !p.isEliminated ? '<span class="uno-alert-badge">UNO!</span>' : ''}
          </div>
        `;
      })
      .join('');

    // Discard Pile
    if (gameState.topDiscard) {
      this.el.discardPile.innerHTML = renderCardHTML(gameState.topDiscard, {
        mode: gameState.mode,
        flipSide: gameState.flipSide,
      });
    } else {
      this.el.discardPile.innerHTML = '';
    }

    // Draw Pile
    this.el.drawPile.innerHTML = renderCardBackHTML(gameState.mode === 'flip' && gameState.flipSide === 'dark');
    this.el.drawCountBadge.textContent = `${gameState.deckRemainingCount} cards`;
    this.el.drawPileBtn.disabled = !isMyTurn;

    // Stacking draw penalty tag
    if (gameState.pendingDrawPenalty > 0) {
      this.el.penaltyTag.style.display = 'block';
      this.el.penaltyTag.textContent = `+${gameState.pendingDrawPenalty} PENALTY!`;
    } else {
      this.el.penaltyTag.style.display = 'none';
    }

    // Buttons
    this.el.btnDrawAction.disabled = !canDraw;
    if (gameState.pendingDrawPenalty > 0) {
      this.el.btnDrawAction.textContent = `TAKE +${gameState.pendingDrawPenalty} CARDS`;
    } else {
      this.el.btnDrawAction.textContent = 'DRAW CARD';
    }

    // Pass button (visible if drawn this turn)
    if (gameState.turnDrawnCard && isMyTurn) {
      this.el.btnPassAction.style.display = 'inline-flex';
    } else {
      this.el.btnPassAction.style.display = 'none';
    }

    // UNO and Catch buttons
    this.el.btnUnoAction.disabled = !canCallUno;
    if (canCatchUno) {
      const caughtPlayer = gameState.players.find((p) => p.id === canCatchUno);
      this.el.btnCatchAction.style.display = 'inline-flex';
      this.el.btnCatchAction.textContent = `CATCH ${caughtPlayer?.name?.toUpperCase()} (MISSED UNO)!`;
    } else {
      this.el.btnCatchAction.style.display = 'none';
    }

    // Player Hand Cards
    this.renderPlayerHand(myHand, canPlayCards, gameState.mode, gameState.flipSide);

    // Game Over Check
    if (gameState.status === 'game_over') {
      this.showGameOver(gameState);
    }
  }

  renderPlayerHand(hand, canPlayIds, mode, flipSide) {
    this.el.playerHandCards.innerHTML = '';

    hand.forEach((card, idx) => {
      const isPlayable = canPlayIds.includes(card.id);
      const wrapper = document.createElement('div');
      wrapper.className = `card-wrapper ${isPlayable ? 'playable' : 'unplayable'}`;
      wrapper.style.zIndex = idx + 1;
      wrapper.innerHTML = renderCardHTML(card, { mode, flipSide });

      if (isPlayable) {
        wrapper.addEventListener('click', () => this.handleCardClick(card));
      }

      this.el.playerHandCards.appendChild(wrapper);
    });
  }

  handleCardClick(card) {
    const face = card.color ? card : (this.gameState.flipSide === 'dark' ? card.dark : card.light);

    // Wild Card -> Prompt Color Picker
    if (face.color === 'wild') {
      this.pendingPlayCard = card;
      this.openColorPicker();
      return;
    }

    // 7 in No Mercy -> Prompt Swap Picker
    if (this.gameState.mode === 'no_mercy' && face.type === 'number' && face.value === 7) {
      this.pendingPlayCard = card;
      this.openSwapPicker();
      return;
    }

    // Regular Card Play
    sounds.playSnap();
    this.send({
      type: 'play_card',
      data: { cardId: card.id },
    });
  }

  openColorPicker() {
    const isDark = this.gameState.mode === 'flip' && this.gameState.flipSide === 'dark';
    const colors = isDark ? FLIP_DARK_COLORS : CLASSIC_COLORS;

    this.el.colorOptionsContainer.innerHTML = colors
      .map((c) => {
        const meta = COLOR_METADATA[c];
        return `
          <button class="color-option-btn" style="background-color: ${meta.bgHex};" data-color="${c}">
            <span style="font-size: 1.8rem;">${meta.symbol}</span>
            <span>${meta.name}</span>
          </button>
        `;
      })
      .join('');

    this.el.colorOptionsContainer.querySelectorAll('.color-option-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const chosenColor = e.currentTarget.dataset.color;
        this.el.colorPickerModal.classList.remove('active');
        sounds.playSnap(520, 0.1);
        this.send({
          type: 'play_card',
          data: {
            cardId: this.pendingPlayCard.id,
            chosenColor,
          },
        });
        this.pendingPlayCard = null;
      });
    });

    this.el.colorPickerModal.classList.add('active');
  }

  openSwapPicker() {
    const otherActivePlayers = this.gameState.players.filter(
      (p) => p.id !== this.playerId && !p.isEliminated
    );

    this.el.swapOptionsContainer.innerHTML = otherActivePlayers
      .map(
        (p) => `
        <button class="player-target-btn" data-player-id="${p.id}">
          <span>👤 ${p.name}</span>
          <span style="font-size: 0.85rem; opacity: 0.8;">${p.cardCount} cards</span>
        </button>
      `
      )
      .join('');

    this.el.swapOptionsContainer.querySelectorAll('.player-target-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const targetPlayerId = e.currentTarget.dataset.playerId;
        this.el.swapPickerModal.classList.remove('active');
        sounds.playSnap(400, 0.1);
        this.send({
          type: 'play_card',
          data: {
            cardId: this.pendingPlayCard.id,
            targetPlayerId,
          },
        });
        this.pendingPlayCard = null;
      });
    });

    this.el.swapPickerModal.classList.add('active');
  }

  showGameOver(gameState) {
    const winner = gameState.players.find((p) => p.id === gameState.winnerId);
    this.el.winnerNameText.textContent = winner ? `${winner.name} WINS!` : 'GAME OVER!';
    this.el.winReasonText.textContent = gameState.winReason || 'All cards played!';

    const me = gameState.players.find((p) => p.id === this.playerId);
    this.el.rematchBtn.style.display = me?.isHost ? 'block' : 'none';

    sounds.playVictory();
    this.el.gameOverModal.classList.add('active');
  }

  openRulesModal() {
    this.el.rulesModal.classList.add('active');
  }

  closeRulesModal() {
    this.el.rulesModal.classList.remove('active');
  }

  leaveRoom() {
    if (confirm('Are you sure you want to leave the room?')) {
      this.send({ type: 'leave' });
      this.roomId = null;
      this.playerId = null;
      this.sessionToken = null;
      if (this.ws) this.ws.close();
      window.location.search = '';
    }
  }

  copyInviteLink() {
    const url = `${window.location.origin}/?room=${this.gameState?.roomId || this.roomId}`;
    navigator.clipboard.writeText(url).then(() => {
      this.showToast('Invite link copied to clipboard! 📋');
    });
  }
}

// Bootstrap app when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new UnoArenaApp();
});
