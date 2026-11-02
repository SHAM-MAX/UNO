import { CLASSIC_COLORS, FLIP_DARK_COLORS, COLOR_METADATA } from '../shared/constants.js';
import { sounds } from './audio.js';
import { renderCardHTML, renderCardBackHTML } from './cardGraphics.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

class UnoArenaApp {
  constructor() {
    this.ws = null;
    this.roomId = null;
    this.playerId = null;
    this.sessionToken = null;
    this.playerName = localStorage.getItem('uno_arena_name') || '';
    this.preferredMode = localStorage.getItem('uno_arena_mode') || 'classic';
    this.mercyKnockoutLimit = Number(localStorage.getItem('uno_arena_mercy_limit')) || 25;
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
      leaveConfirmModal: document.getElementById('leaveConfirmModal'),
      cancelLeaveBtn: document.getElementById('cancelLeaveBtn'),
      closeLeaveConfirmBtn: document.getElementById('closeLeaveConfirmBtn'),
      confirmLeaveBtn: document.getElementById('confirmLeaveBtn'),
      toast: document.getElementById('toast'),

      // Containers
      entryView: document.getElementById('entryView'),
      arenaView: document.getElementById('arenaView'),

      // Entry
      playerNameInput: document.getElementById('playerNameInput'),
      roomCodeInput: document.getElementById('roomCodeInput'),
      createRoomBtn: document.getElementById('createRoomBtn'),
      joinRoomBtn: document.getElementById('joinRoomBtn'),
      modeHomeScreen: document.getElementById('homeLandingSection'),
      modeSetupSection: document.getElementById('modeSetupSection'),
      setupModeTitle: document.getElementById('setupModeTitle'),
      setupModeDescription: document.getElementById('setupModeDescription'),
      backToModesBtn: document.getElementById('backToModesBtn'),
      setupPlayerNameInput: document.getElementById('setupPlayerNameInput'),
      setupRoomCodeInput: document.getElementById('setupRoomCodeInput'),
      setupCreateRoomBtn: document.getElementById('setupCreateRoomBtn'),
      setupJoinRoomBtn: document.getElementById('setupJoinRoomBtn'),
      setupRulesCard: document.getElementById('setupRulesCard'),
      setupMercyLimit: document.getElementById('setupMercyLimit'),

      // Lobby
      lobbySection: document.getElementById('lobbySection'),
      lobbyCodeBadge: document.getElementById('lobbyCodeBadge'),
      lobbyCodeText: document.getElementById('lobbyCodeText'),
      copyInviteBtn: document.getElementById('copyInviteBtn'),
      modeSelectorGrid: document.getElementById('modeSelectorGrid'),
      lobbyRulesPanel: document.getElementById('lobbyRulesPanel'),
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
    this.el.backToModesBtn.addEventListener('click', () => this.showModePicker());
    this.el.setupMercyLimit.value = String(this.mercyKnockoutLimit);
    this.el.setupMercyLimit.addEventListener('change', () => {
      this.mercyKnockoutLimit = Number(this.el.setupMercyLimit.value) || 25;
      localStorage.setItem('uno_arena_mercy_limit', String(this.mercyKnockoutLimit));
    });
    this.el.setupCreateRoomBtn.addEventListener('click', () => {
      const name = this.el.setupPlayerNameInput.value.trim() || this.playerName || 'Player 1';
      this.playerName = name;
      localStorage.setItem('uno_arena_name', name);
      this.createRoom(name, this.preferredMode, this.getSelectedHouseRules());
    });
    this.el.setupPlayerNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.el.setupCreateRoomBtn.click();
      }
    });
    this.el.setupJoinRoomBtn.addEventListener('click', () => {
      const name = this.el.setupPlayerNameInput.value.trim() || this.playerName || 'Guest';
      const code = this.el.setupRoomCodeInput.value.trim().toUpperCase();
      if (!code) {
        this.showToast('Enter your friend’s room code');
        this.el.setupRoomCodeInput.focus();
        return;
      }
      if (this.isJoiningRoom) return;
      this.isJoiningRoom = true;
      this.el.setupJoinRoomBtn.disabled = true;
      this.playerName = name;
      localStorage.setItem('uno_arena_name', name);
      this.connectWebSocket(code, null, null, name);
      setTimeout(() => {
        this.isJoiningRoom = false;
        if (this.el.setupJoinRoomBtn) this.el.setupJoinRoomBtn.disabled = false;
      }, 2500);
    });
    this.el.setupRoomCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.el.setupJoinRoomBtn.click();
      }
    });
    this.el.setupRoomCodeInput.addEventListener('input', () => {
      this.el.setupRoomCodeInput.value = this.el.setupRoomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    // Leave room
    this.el.leaveBtn.addEventListener('click', () => this.leaveRoom());
    this.el.cancelLeaveBtn.addEventListener('click', () => this.closeLeaveConfirm());
    this.el.closeLeaveConfirmBtn.addEventListener('click', () => this.closeLeaveConfirm());
    this.el.confirmLeaveBtn.addEventListener('click', () => this.confirmLeaveRoom());
    this.el.leaveConfirmModal.addEventListener('click', (event) => {
      if (event.target === this.el.leaveConfirmModal) this.closeLeaveConfirm();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.el.leaveConfirmModal.classList.contains('active')) {
        this.closeLeaveConfirm();
      }
    });

    // Ensure connection immediately refreshes when tab regains visibility/focus
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.roomId) {
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
          const sToken = localStorage.getItem(`session_${this.roomId}`);
          const pId = localStorage.getItem(`player_${this.roomId}`);
          this.connectWebSocket(this.roomId, pId, sToken, this.playerName);
        }
      }
    });

    window.addEventListener('focus', () => {
      if (this.roomId && (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING)) {
        const sToken = localStorage.getItem(`session_${this.roomId}`);
        const pId = localStorage.getItem(`player_${this.roomId}`);
        this.connectWebSocket(this.roomId, pId, sToken, this.playerName);
      }
    });

    // Choose a mode before creating a room. The lobby still lets the host change it.
    document.querySelectorAll('[data-home-mode]').forEach((button) => {
      const selected = button.dataset.homeMode === this.preferredMode;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.addEventListener('click', () => {
        this.openModeSetup(button.dataset.homeMode);
        document.querySelectorAll('[data-home-mode]').forEach((tile) => {
          const isSelected = tile === button;
          tile.classList.toggle('is-selected', isSelected);
          tile.setAttribute('aria-pressed', String(isSelected));
        });
      });
    });

    // Create room
    this.el.createRoomBtn.addEventListener('click', () => {
      const name = this.el.playerNameInput.value.trim() || 'Player 1';
      this.playerName = name;
      localStorage.setItem('uno_arena_name', name);
      this.createRoom(name, this.preferredMode, this.getSelectedHouseRules());
    });

    this.el.playerNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.el.createRoomBtn.click();
      }
    });

    // Join room
    this.el.joinRoomBtn.addEventListener('click', () => {
      const name = this.el.playerNameInput.value.trim() || 'Guest';
      const code = this.el.roomCodeInput.value.trim().toUpperCase();
      if (!code) {
        this.showToast('Please enter a room code');
        return;
      }
      if (this.isJoiningRoom) return;
      this.isJoiningRoom = true;
      this.el.joinRoomBtn.disabled = true;
      this.playerName = name;
      localStorage.setItem('uno_arena_name', name);
      this.connectWebSocket(code, null, null, name);
      setTimeout(() => {
        this.isJoiningRoom = false;
        if (this.el.joinRoomBtn) this.el.joinRoomBtn.disabled = false;
      }, 2500);
    });

    this.el.roomCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.el.joinRoomBtn.click();
      }
    });

    // Copy invite
    this.el.copyInviteBtn.addEventListener('click', () => this.copyInviteLink());
    this.el.lobbyCodeBadge.addEventListener('click', () => this.copyInviteLink());
    this.el.navRoomCode.addEventListener('click', () => this.copyInviteLink());

    // Ready & Start
    this.el.readyBtn.addEventListener('click', () => {
      if (!this.clientView) return;
      const now = Date.now();
      if (this.lastReadyClick && now - this.lastReadyClick < 350) return;
      this.lastReadyClick = now;
      const me = this.clientView.gameState.players.find((p) => p.id === this.playerId);
      const nextReady = !me?.isReady;
      this.send({ type: 'ready', data: { isReady: nextReady } });
    });

    this.el.startGameBtn.addEventListener('click', () => {
      if (this.isStartingGame) return;
      this.isStartingGame = true;
      this.el.startGameBtn.disabled = true;
      this.send({ type: 'start_game' });
      setTimeout(() => {
        this.isStartingGame = false;
      }, 2000);
    });

    // In-game actions
    this.el.btnDrawAction.addEventListener('click', () => {
      if (this.isMoveInFlight) return;
      this.isMoveInFlight = true;
      clearTimeout(this.moveFlightTimer);
      this.moveFlightTimer = setTimeout(() => { this.isMoveInFlight = false; }, 800);
      sounds.playDraw();
      this.send({ type: 'draw_card' });
    });

    this.el.drawPileBtn.addEventListener('click', () => {
      if (this.clientView?.isMyTurn && !this.isMoveInFlight) {
        this.isMoveInFlight = true;
        clearTimeout(this.moveFlightTimer);
        this.moveFlightTimer = setTimeout(() => { this.isMoveInFlight = false; }, 800);
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
      const roomId = roomParam.toUpperCase();
      const playerId = localStorage.getItem(`player_${roomId}`);
      const sessionToken = localStorage.getItem(`session_${roomId}`);
      if (playerId && sessionToken) {
        this.connectWebSocket(roomId, playerId, sessionToken, this.playerName || 'Player');
      } else {
        this.el.roomCodeInput.value = roomId;
        this.el.roomCodeInput.focus();
      }
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

  openModeSetup(mode) {
    const details = {
      classic: ['Classic UNO', 'Play the familiar classic rules with your friends.'],
      flip: ['UNO Flip', 'Two-sided cards. Flip the deck and change the whole table.'],
      no_mercy: ["Show ’em No Mercy", 'Stack penalties, survive the knockout limit, and be the last player standing.'],
    };
    if (!details[mode]) return;
    this.preferredMode = mode;
    localStorage.setItem('uno_arena_mode', mode);
    this.el.setupModeTitle.textContent = details[mode][0];
    this.el.setupModeDescription.textContent = details[mode][1];
    this.el.setupRulesCard.hidden = mode !== 'no_mercy';
    this.el.setupMercyLimit.value = String(this.mercyKnockoutLimit);
    this.el.setupPlayerNameInput.value = this.el.playerNameInput.value.trim() || this.playerName;
    this.el.modeHomeScreen.hidden = true;
    this.el.modeSetupSection.hidden = false;
  }

  showModePicker() {
    if (this.el.setupPlayerNameInput && this.el.setupPlayerNameInput.value.trim()) {
      this.el.playerNameInput.value = this.el.setupPlayerNameInput.value.trim();
    }
    this.el.modeSetupSection.hidden = true;
    this.el.modeHomeScreen.hidden = false;
  }

  getSelectedHouseRules() {
    return this.preferredMode === 'no_mercy'
      ? { mercyKnockoutLimit: this.mercyKnockoutLimit }
      : {};
  }

  async createRoom(hostName, mode = this.preferredMode, houseRules = {}) {
    if (this.isCreatingRoom) return;
    this.isCreatingRoom = true;
    if (this.el.createRoomBtn) this.el.createRoomBtn.disabled = true;
    if (this.el.setupCreateRoomBtn) this.el.setupCreateRoomBtn.disabled = true;

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostName, mode, houseRules }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.success) {
        this.roomId = data.roomId;
        this.playerId = data.playerId;
        this.sessionToken = data.sessionToken;
        this.playerName = hostName;
        localStorage.setItem(`session_${this.roomId}`, this.sessionToken);
        localStorage.setItem(`player_${this.roomId}`, this.playerId);
        localStorage.setItem('uno_arena_name', hostName);

        // Update URL immediately so room link is accurate
        const roomUrl = new URL(window.location.href);
        roomUrl.searchParams.set('room', this.roomId);
        window.history.replaceState({}, '', roomUrl);

        // Immediate lobby transition: do not wait for WebSocket handshake roundtrip
        const initialHost = {
          id: this.playerId,
          name: hostName,
          isHost: true,
          isReady: true,
          isConnected: true,
          cardCount: 0,
          hasCalledUno: false,
          isEliminated: false,
          score: 0,
        };
        const initialGameState = {
          roomId: this.roomId,
          status: 'lobby',
          mode: mode || 'classic',
          houseRules: houseRules || {},
          players: [initialHost],
          hostId: this.playerId,
        };
        this.handleRoomState({
          playerId: this.playerId,
          gameState: initialGameState,
          myHand: [],
          canPlayCards: [],
          isMyTurn: false,
        });

        // Connect WebSocket in background for real-time multiplayer synchronization
        this.connectWebSocket(data.roomId, data.playerId, data.sessionToken, hostName);
      } else {
        const errorMsg = data?.error || `Failed to create room (${res.status})`;
        this.showToast(errorMsg);
      }
    } catch (e) {
      this.showToast('Network error creating room. Please try again.');
    } finally {
      this.isCreatingRoom = false;
      if (this.el.createRoomBtn) this.el.createRoomBtn.disabled = false;
      if (this.el.setupCreateRoomBtn) this.el.setupCreateRoomBtn.disabled = false;
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
      // Flush any messages queued while connection was establishing
      if (this.pendingMessages && this.pendingMessages.length > 0) {
        while (this.pendingMessages.length > 0) {
          const queued = this.pendingMessages.shift();
          this.ws.send(JSON.stringify(queued));
        }
      }
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
          const roomUrl = new URL(window.location.href);
          roomUrl.searchParams.set('room', this.roomId);
          window.history.replaceState({}, '', roomUrl);
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
    const full = {
      roomId: this.roomId,
      playerId: this.playerId,
      sessionToken: this.sessionToken,
      ...payload,
    };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(full));
    } else if (payload.type !== 'join') {
      this.pendingMessages = this.pendingMessages || [];
      this.pendingMessages.push(full);
    }
  }

  handleRoomState(view) {
    this.clientView = view;
    this.gameState = view.gameState;
    this.isMoveInFlight = false;
    this.isStartingGame = false;
    this.isJoiningRoom = false;
    if (this.el.joinRoomBtn) this.el.joinRoomBtn.disabled = false;
    if (this.el.setupJoinRoomBtn) this.el.setupJoinRoomBtn.disabled = false;

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
    document.body.classList.add('in-room');
    document.body.classList.remove('in-arena');
    this.el.entryView.style.display = 'block';
    this.el.arenaView.style.display = 'none';
    this.el.modeSetupSection.hidden = true;
    this.el.modeHomeScreen.hidden = true;
    this.el.lobbySection.style.display = 'block';
    document.getElementById('entryFormSection').style.display = 'none';

    this.el.lobbyCodeText.textContent = this.gameState.roomId;

    // Render Mode selector
    const me = this.gameState.players.find((p) => p.id === this.playerId);
    const isHost = me?.isHost || false;

    this.el.modeSelectorGrid.innerHTML = `
      <button class="mode-card-btn ${this.gameState.mode === 'classic' ? 'selected' : ''}" data-mode="classic" ${!isHost ? 'disabled' : ''}>
        <span class="lobby-mode-art mode-art-classic" aria-hidden="true"><svg viewBox="0 0 80 100"><rect x="7" y="16" width="46" height="68" rx="8" fill="#f5b92f" stroke="#12372a" stroke-width="4" transform="rotate(-14 30 50)"/><rect x="21" y="9" width="48" height="72" rx="8" fill="#176cb0" stroke="#12372a" stroke-width="4" transform="rotate(9 45 45)"/><rect x="13" y="13" width="50" height="76" rx="9" fill="#d83227" stroke="#f8e9c9" stroke-width="4" transform="rotate(-5 38 50)"/><ellipse cx="38" cy="51" rx="13" ry="25" fill="none" stroke="#fff1d4" stroke-width="2" transform="rotate(-5 38 51)"/><text x="38" y="58" text-anchor="middle" fill="#fff1d4" stroke="#17362b" stroke-width="1.5" paint-order="stroke" font-family="Arial" font-size="12" font-weight="900" transform="rotate(-5 38 51)">UNO</text><text x="20" y="29" fill="white" font-family="Arial" font-size="10" font-weight="900" transform="rotate(-5 20 29)">1</text></svg></span>
        <strong>Classic</strong>
        <span style="font-size: 0.72rem; color: #94A3B8;">108 Cards • Standard UNO</span>
      </button>
      <button class="mode-card-btn ${this.gameState.mode === 'flip' ? 'selected' : ''}" data-mode="flip" ${!isHost ? 'disabled' : ''}>
        <span class="lobby-mode-art mode-art-flip" aria-hidden="true"><svg viewBox="0 0 80 100"><rect x="12" y="8" width="54" height="82" rx="10" fill="#10191f" stroke="#f4d052" stroke-width="3" transform="rotate(-8 39 49)"/><rect x="20" y="16" width="38" height="66" rx="15" fill="#71318d" transform="rotate(-8 39 49)"/><path d="M28 44c3-12 19-15 26-5l4 5m0-9v10h-10M51 56c-4 11-19 14-26 4l-3-5m0 9V54h10" fill="none" stroke="#fff0ce" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><text x="38" y="28" text-anchor="middle" fill="#fff1d5" font-family="Arial" font-size="8" font-weight="900" transform="rotate(-8 38 28)">FLIP</text></svg></span>
        <strong>UNO Flip</strong>
        <span style="font-size: 0.72rem; color: #94A3B8;">Double-Sided • Dark Side</span>
      </button>
      <button class="mode-card-btn ${this.gameState.mode === 'no_mercy' ? 'selected' : ''}" data-mode="no_mercy" ${!isHost ? 'disabled' : ''}>
        <span class="lobby-mode-art mode-art-mercy" aria-hidden="true"><svg viewBox="0 0 80 100"><rect x="11" y="8" width="56" height="84" rx="10" fill="#17191c" stroke="#e6d5b4" stroke-width="3" transform="rotate(-7 39 50)"/><ellipse cx="39" cy="49" rx="16" ry="28" fill="none" stroke="#bc2e26" stroke-width="3" transform="rotate(-7 39 49)"/><text x="38" y="35" text-anchor="middle" fill="#fff0cf" font-family="Arial" font-size="17" font-weight="900" transform="rotate(-7 38 35)">+10</text><path d="M43 42 29 63h11l-3 15 18-25H44z" fill="#f3b92d" stroke="#091f18" stroke-width="2" stroke-linejoin="round" transform="rotate(-7 40 60)"/></svg></span>
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

    const mercyLimit = Number(this.gameState.houseRules?.mercyKnockoutLimit) || 25;
    this.el.lobbyRulesPanel.hidden = this.gameState.mode !== 'no_mercy';
    if (this.gameState.mode === 'no_mercy') {
      this.el.lobbyRulesPanel.innerHTML = isHost
        ? `<div class="lobby-rules-copy"><span>HOST RULES</span><strong>No Mercy knockout</strong><small>Eliminate a player when their hand reaches the chosen limit.</small></div>
           <label class="lobby-rule-control"><span>Knockout at</span><select id="lobbyMercyLimit" class="lobby-rule-select" aria-label="No Mercy knockout card limit">${[25, 35, 45].map((limit) => `<option value="${limit}" ${limit === mercyLimit ? 'selected' : ''}>${limit} cards</option>`).join('')}</select></label>`
        : `<div class="lobby-rules-copy"><span>HOST RULE</span><strong>No Mercy knockout: ${mercyLimit} cards</strong><small>The host can change this before the game starts.</small></div>`;
      const mercySelect = document.getElementById('lobbyMercyLimit');
      mercySelect?.addEventListener('change', () => {
        this.send({ type: 'set_rules', data: { houseRules: { mercyKnockoutLimit: Number(mercySelect.value) } } });
      });
    }

    // Render Players
    this.el.lobbyPlayersList.innerHTML = this.gameState.players
      .map(
        (p) => `
        <div class="lobby-player-row">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span>${p.isHost ? '👑' : '👤'}</span>
            <strong>${escapeHtml(p.name)}</strong>
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
    document.body.classList.add('in-room');
    document.body.classList.add('in-arena');
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
              ${escapeHtml(p.name.charAt(0).toUpperCase())}
            </div>
            <div class="opponent-info">
              <div class="opponent-name">
                ${p.isHost ? '👑 ' : ''}${escapeHtml(p.name)}
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
    this.el.drawPile.innerHTML = renderCardBackHTML(
      gameState.mode === 'flip' && gameState.flipSide === 'dark',
      false,
      gameState.mode,
    );
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
      wrapper.setAttribute('role', isPlayable ? 'button' : 'img');
      wrapper.setAttribute('tabindex', isPlayable ? '0' : '-1');
      const cardTitle = card.type === 'number' ? `${card.color || ''} ${card.value}` : `${card.color || ''} ${card.type}`;
      wrapper.setAttribute('aria-label', isPlayable ? `Play card: ${cardTitle}` : `Card: ${cardTitle}`);
      wrapper.innerHTML = renderCardHTML(card, { mode, flipSide });

      if (isPlayable) {
        wrapper.addEventListener('click', () => this.handleCardClick(card, wrapper));
        wrapper.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.handleCardClick(card, wrapper);
          }
        });
      }

      this.el.playerHandCards.appendChild(wrapper);
    });
  }

  handleCardClick(card, wrapperEl) {
    if (this.isMoveInFlight) return;

    const face = card.color ? card : (this.gameState.flipSide === 'dark' ? card.dark : card.light);

    // Wild Card -> Prompt Color Picker
    if (face.color === 'wild') {
      this.pendingPlayCard = card;
      this.pendingPlayWrapper = wrapperEl;
      this.openColorPicker();
      return;
    }

    // 7 in No Mercy -> Prompt Swap Picker
    if (this.gameState.mode === 'no_mercy' && face.type === 'number' && face.value === 7) {
      this.pendingPlayCard = card;
      this.pendingPlayWrapper = wrapperEl;
      this.openSwapPicker();
      return;
    }

    // Regular Card Play
    this.isMoveInFlight = true;
    clearTimeout(this.moveFlightTimer);
    this.moveFlightTimer = setTimeout(() => { this.isMoveInFlight = false; }, 800);

    if (wrapperEl) {
      wrapperEl.classList.add('playing');
    }

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
        if (this.isMoveInFlight) return;
        this.isMoveInFlight = true;
        clearTimeout(this.moveFlightTimer);
        this.moveFlightTimer = setTimeout(() => { this.isMoveInFlight = false; }, 800);

        if (this.pendingPlayWrapper) {
          this.pendingPlayWrapper.classList.add('playing');
        }

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
        this.pendingPlayWrapper = null;
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
          <span>👤 ${escapeHtml(p.name)}</span>
          <span style="font-size: 0.85rem; opacity: 0.8;">${p.cardCount} cards</span>
        </button>
      `
      )
      .join('');

    this.el.swapOptionsContainer.querySelectorAll('.player-target-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (this.isMoveInFlight) return;
        this.isMoveInFlight = true;
        clearTimeout(this.moveFlightTimer);
        this.moveFlightTimer = setTimeout(() => { this.isMoveInFlight = false; }, 800);

        if (this.pendingPlayWrapper) {
          this.pendingPlayWrapper.classList.add('playing');
        }

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
        this.pendingPlayWrapper = null;
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
    this.el.leaveConfirmModal.classList.add('active');
    this.el.cancelLeaveBtn.focus();
  }

  closeLeaveConfirm() {
    this.el.leaveConfirmModal.classList.remove('active');
    this.el.leaveBtn.focus();
  }

  confirmLeaveRoom() {
    this.send({ type: 'leave' });
    this.roomId = null;
    this.playerId = null;
    this.sessionToken = null;
    if (this.ws) this.ws.close();
    window.location.search = '';
  }

  copyInviteLink() {
    const url = `${window.location.origin}/?room=${this.gameState?.roomId || this.roomId}`;
    if (this.el.lobbyCodeBadge) {
      this.el.lobbyCodeBadge.classList.add('copied');
      setTimeout(() => this.el.lobbyCodeBadge.classList.remove('copied'), 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        this.showToast('Invite link copied to clipboard! 📋');
      }).catch(() => {
        this.showToast('Invite link copied! 📋');
      });
    } else {
      this.showToast('Invite link copied! 📋');
    }
  }
}

// Bootstrap app when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new UnoArenaApp();
});

