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
    this.initDialogAccessibility();
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

      // UNO Flip Setup dedicated elements
      flipSetupContainer: document.getElementById('flipSetupContainer'),
      flipPlayerNameInput: document.getElementById('flipPlayerNameInput'),
      flipRoomCodeInput: document.getElementById('flipRoomCodeInput'),
      flipCreateRoomBtn: document.getElementById('flipCreateRoomBtn'),
      flipJoinRoomBtn: document.getElementById('flipJoinRoomBtn'),
      flipBackToModesBtn: document.getElementById('flipBackToModesBtn'),

      // Dedicated Mobile Landing Elements
      mobileLandingContainer: document.getElementById('mobileLandingContainer'),
      mobileNavSoundBtn: document.getElementById('mobileNavSoundBtn'),
      mobileNavRulesBtn: document.getElementById('mobileNavRulesBtn'),
      mobilePlayerNameInput: document.getElementById('mobilePlayerNameInput'),
      mobileCreateRoomBtn: document.getElementById('mobileCreateRoomBtn'),
      mobileRoomCodeInput: document.getElementById('mobileRoomCodeInput'),
      mobileJoinRoomBtn: document.getElementById('mobileJoinRoomBtn'),
      mobileModeClassicBtn: document.getElementById('mobileModeClassicBtn'),
      mobileModeFlipBtn: document.getElementById('mobileModeFlipBtn'),
      mobileModeMercyBtn: document.getElementById('mobileModeMercyBtn'),

      // No Mercy Setup dedicated elements
      noMercySetupContainer: document.getElementById('noMercySetupContainer'),
      noMercyPlayerNameInput: document.getElementById('noMercyPlayerNameInput'),
      noMercyCreateRoomBtn: document.getElementById('noMercyCreateRoomBtn'),
      noMercyRoomCodeInput: document.getElementById('noMercyRoomCodeInput'),
      noMercyJoinRoomBtn: document.getElementById('noMercyJoinRoomBtn'),
      noMercyLimitSelect: document.getElementById('noMercyLimitSelect'),
      noMercyBackBtn: document.getElementById('noMercyBackBtn'),
      noMercySoundBtn: document.getElementById('noMercySoundBtn'),
      noMercyRulesBtn: document.getElementById('noMercyRulesBtn'),
      noMercyMobilePlayerNameInput: document.getElementById('noMercyMobilePlayerNameInput'),
      noMercyMobileCreateRoomBtn: document.getElementById('noMercyMobileCreateRoomBtn'),
      noMercyMobileRoomCodeInput: document.getElementById('noMercyMobileRoomCodeInput'),
      noMercyMobileJoinRoomBtn: document.getElementById('noMercyMobileJoinRoomBtn'),
      noMercyMobileLimitSelect: document.getElementById('noMercyMobileLimitSelect'),
      noMercyMobileBackBtn: document.getElementById('noMercyMobileBackBtn'),
      noMercyMobileSoundBtn: document.getElementById('noMercyMobileSoundBtn'),
      noMercyMobileRulesBtn: document.getElementById('noMercyMobileRulesBtn'),

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
      addBotBtn: document.getElementById('addBotBtn'),
      shuffleSeatsBtn: document.getElementById('shuffleSeatsBtn'),
      playVsAiBtn: document.getElementById('playVsAiBtn'),
      mobilePlayVsAiBtn: document.getElementById('mobilePlayVsAiBtn'),

      // Arena
      opponentsRow: document.getElementById('opponentsRow'),
      tableFelt: document.getElementById('tableFelt'),
      directionArrow: document.getElementById('directionArrow'),
      directionText: document.getElementById('directionText'),
      orbitalDirectionTrack: document.getElementById('orbitalDirectionTrack'),
      discardPile: document.getElementById('discardPile'),
      drawPile: document.getElementById('drawPile'),
      drawPileBtn: document.getElementById('drawPileBtn'),
      drawCountBadge: document.getElementById('drawCountBadge'),
      penaltyTag: document.getElementById('penaltyTag'),
      drawPenaltyBadge: document.getElementById('drawPenaltyBadge'),
      btnCallUnoContextual: document.getElementById('btnCallUnoContextual'),
      contextualUnoContainer: document.getElementById('contextualUnoContainer'),
      localPlayerProfile: document.getElementById('localPlayerProfile'),
      caughtFailedModal: document.getElementById('caughtFailedModal'),
      caughtFailedMsg: document.getElementById('caughtFailedMsg'),
      actionBanner: document.getElementById('actionBanner'),
      turnTimerContainer: document.getElementById('turnTimerContainer'),
      timerRingProgress: document.getElementById('timerRingProgress'),
      turnTimerSeconds: document.getElementById('turnTimerSeconds'),
      reactionToggleBtn: document.getElementById('reactionToggleBtn'),
      reactionTray: document.getElementById('reactionTray'),

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
      gameOverCloseBtn: document.getElementById('gameOverCloseBtn'),
      winnerNameText: document.getElementById('winnerNameText'),
      victoryWinsBadge: document.getElementById('victoryWinsBadge'),
      winReasonText: document.getElementById('winReasonText'),
      rematchBtn: document.getElementById('rematchBtn'),
      btnViewVictory: document.getElementById('btnViewVictory'),
      rulesModal: document.getElementById('rulesModal'),
      rulesModalClose: document.getElementById('rulesModalClose'),
    };
  }

  initEvents() {
    // Sound toggle
    const brandNavToggle = document.getElementById('brandNavToggle');
    const topNav = document.querySelector('.top-nav');
    if (brandNavToggle && topNav) {
      brandNavToggle.addEventListener('click', (e) => {
        if (!document.body.classList.contains('in-arena')) return;
        e.stopPropagation();
        const expanded = topNav.classList.toggle('nav-expanded');
        brandNavToggle.setAttribute('aria-expanded', String(expanded));
      });
      brandNavToggle.addEventListener('keydown', (e) => {
        if (!document.body.classList.contains('in-arena')) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          const expanded = topNav.classList.toggle('nav-expanded');
          brandNavToggle.setAttribute('aria-expanded', String(expanded));
        }
      });
      document.addEventListener('click', (e) => {
        if (topNav.classList.contains('nav-expanded') && !topNav.contains(e.target)) {
          topNav.classList.remove('nav-expanded');
          brandNavToggle.setAttribute('aria-expanded', 'false');
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && topNav.classList.contains('nav-expanded')) {
          topNav.classList.remove('nav-expanded');
          brandNavToggle.setAttribute('aria-expanded', 'false');
        }
      });
    }

    this.el.soundToggleBtn.addEventListener('click', () => {
      const enabled = sounds.toggle();
      this.updateSoundIcon(enabled);
      this.showToast(enabled ? 'Sound Enabled 🔊' : 'Sound Muted 🔇');
    });
    this.updateSoundIcon(sounds.isEnabled());

    // How to Play modal
    this.el.howToPlayBtn.addEventListener('click', () => this.openRulesModal());
    this.el.rulesModalClose.addEventListener('click', () => this.closeRulesModal());

    // Window resize handler: seamlessly recalculate card fan and hand overlap
    window.addEventListener('resize', () => {
      if (this.gameState && this.gameState.status === 'playing' && this.clientView) {
        const canPlayIds = this.clientView.canPlayCards || [];
        this.renderPlayerHand(
          this.clientView.myHand || [],
          canPlayIds,
          this.gameState.mode || 'classic',
          this.gameState.flipSide || 'light'
        );
      }
    });

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

    // Dedicated No Mercy Setup Event Handlers
    if (this.el.noMercyBackBtn) {
      this.el.noMercyBackBtn.addEventListener('click', () => this.showModePicker());
    }
    if (this.el.noMercyMobileBackBtn) {
      this.el.noMercyMobileBackBtn.addEventListener('click', () => this.showModePicker());
    }

    if (this.el.noMercySoundBtn) {
      this.el.noMercySoundBtn.addEventListener('click', () => {
        const next = sounds.toggle();
        this.updateSoundIcon(next);
      });
    }
    if (this.el.noMercyMobileSoundBtn) {
      this.el.noMercyMobileSoundBtn.addEventListener('click', () => {
        const next = sounds.toggle();
        this.updateSoundIcon(next);
      });
    }

    if (this.el.noMercyRulesBtn) {
      this.el.noMercyRulesBtn.addEventListener('click', () => this.openRulesModal());
    }
    if (this.el.noMercyMobileRulesBtn) {
      this.el.noMercyMobileRulesBtn.addEventListener('click', () => this.openRulesModal());
    }

    const syncMercyLimit = (val) => {
      this.mercyKnockoutLimit = Number(val) || 25;
      localStorage.setItem('uno_arena_mercy_limit', String(this.mercyKnockoutLimit));
      if (this.el.noMercyLimitSelect) this.el.noMercyLimitSelect.value = String(this.mercyKnockoutLimit);
      if (this.el.noMercyMobileLimitSelect) this.el.noMercyMobileLimitSelect.value = String(this.mercyKnockoutLimit);
      if (this.el.setupMercyLimit) this.el.setupMercyLimit.value = String(this.mercyKnockoutLimit);
    };
    if (this.el.noMercyLimitSelect) {
      this.el.noMercyLimitSelect.addEventListener('change', () => syncMercyLimit(this.el.noMercyLimitSelect.value));
    }
    if (this.el.noMercyMobileLimitSelect) {
      this.el.noMercyMobileLimitSelect.addEventListener('change', () => syncMercyLimit(this.el.noMercyMobileLimitSelect.value));
    }

    const syncPlayerName = (val) => {
      if (this.el.noMercyPlayerNameInput && this.el.noMercyPlayerNameInput !== document.activeElement) {
        this.el.noMercyPlayerNameInput.value = val;
      }
      if (this.el.noMercyMobilePlayerNameInput && this.el.noMercyMobilePlayerNameInput !== document.activeElement) {
        this.el.noMercyMobilePlayerNameInput.value = val;
      }
      if (this.el.setupPlayerNameInput) this.el.setupPlayerNameInput.value = val;
      if (this.el.playerNameInput) this.el.playerNameInput.value = val;
    };
    if (this.el.noMercyPlayerNameInput) {
      this.el.noMercyPlayerNameInput.addEventListener('input', () => syncPlayerName(this.el.noMercyPlayerNameInput.value));
      this.el.noMercyPlayerNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.triggerNoMercyCreate();
        }
      });
    }
    if (this.el.noMercyMobilePlayerNameInput) {
      this.el.noMercyMobilePlayerNameInput.addEventListener('input', () => syncPlayerName(this.el.noMercyMobilePlayerNameInput.value));
      this.el.noMercyMobilePlayerNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.triggerNoMercyCreate();
        }
      });
    }

    const syncRoomCode = (inputEl) => {
      inputEl.value = inputEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const val = inputEl.value;
      if (this.el.noMercyRoomCodeInput && this.el.noMercyRoomCodeInput !== inputEl) {
        this.el.noMercyRoomCodeInput.value = val;
      }
      if (this.el.noMercyMobileRoomCodeInput && this.el.noMercyMobileRoomCodeInput !== inputEl) {
        this.el.noMercyMobileRoomCodeInput.value = val;
      }
      if (this.el.setupRoomCodeInput) this.el.setupRoomCodeInput.value = val;
    };
    if (this.el.noMercyRoomCodeInput) {
      this.el.noMercyRoomCodeInput.addEventListener('input', () => syncRoomCode(this.el.noMercyRoomCodeInput));
      this.el.noMercyRoomCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.triggerNoMercyJoin();
        }
      });
    }
    if (this.el.noMercyMobileRoomCodeInput) {
      this.el.noMercyMobileRoomCodeInput.addEventListener('input', () => syncRoomCode(this.el.noMercyMobileRoomCodeInput));
      this.el.noMercyMobileRoomCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.triggerNoMercyJoin();
        }
      });
    }

    if (this.el.noMercyCreateRoomBtn) {
      this.el.noMercyCreateRoomBtn.addEventListener('click', () => this.triggerNoMercyCreate());
    }
    if (this.el.noMercyMobileCreateRoomBtn) {
      this.el.noMercyMobileCreateRoomBtn.addEventListener('click', () => this.triggerNoMercyCreate());
    }

    if (this.el.noMercyJoinRoomBtn) {
      this.el.noMercyJoinRoomBtn.addEventListener('click', () => this.triggerNoMercyJoin());
    }
    if (this.el.noMercyMobileJoinRoomBtn) {
      this.el.noMercyMobileJoinRoomBtn.addEventListener('click', () => this.triggerNoMercyJoin());
    }

    // Dedicated UNO Flip Setup Event Handlers
    if (this.el.flipBackToModesBtn) {
      this.el.flipBackToModesBtn.addEventListener('click', () => this.showModePicker());
    }
    if (this.el.flipPlayerNameInput) {
      this.el.flipPlayerNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.triggerFlipCreate();
        }
      });
      this.el.flipPlayerNameInput.addEventListener('input', () => {
        const val = this.el.flipPlayerNameInput.value.trim();
        if (val) {
          this.playerName = val;
          localStorage.setItem('uno_arena_name', val);
        }
      });
    }
    if (this.el.flipRoomCodeInput) {
      this.el.flipRoomCodeInput.addEventListener('input', () => {
        this.el.flipRoomCodeInput.value = this.el.flipRoomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      });
      this.el.flipRoomCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.triggerFlipJoin();
        }
      });
    }
    if (this.el.flipCreateRoomBtn) {
      this.el.flipCreateRoomBtn.addEventListener('click', () => this.triggerFlipCreate());
    }
    if (this.el.flipJoinRoomBtn) {
      this.el.flipJoinRoomBtn.addEventListener('click', () => this.triggerFlipJoin());
    }

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
      if (['classic', 'no_mercy'].includes(this.gameState?.mode)) { this.clearClassicAnimations(); this.cancelCardDrag?.(); }
      if (document.visibilityState === 'visible' && this.roomId) {
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
          const sToken = this.gameState?.mode === 'no_mercy' ? this.sessionToken || localStorage.getItem(`session_${this.roomId}`) : localStorage.getItem(`session_${this.roomId}`);
          const pId = this.gameState?.mode === 'no_mercy' ? this.playerId : localStorage.getItem(`player_${this.roomId}`);
          this.connectWebSocket(this.roomId, pId, sToken, this.playerName);
        }
      }
    });

    window.addEventListener('focus', () => {
      if (this.roomId && (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING)) {
        const sToken = this.gameState?.mode === 'no_mercy' ? this.sessionToken || localStorage.getItem(`session_${this.roomId}`) : localStorage.getItem(`session_${this.roomId}`);
        const pId = this.gameState?.mode === 'no_mercy' ? this.playerId : localStorage.getItem(`player_${this.roomId}`);
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

    // Mobile Landing Controls Event Handlers
    if (this.el.mobileNavSoundBtn) {
      this.el.mobileNavSoundBtn.addEventListener('click', () => {
        this.el.soundToggleBtn.click();
      });
    }

    if (this.el.mobileNavRulesBtn) {
      this.el.mobileNavRulesBtn.addEventListener('click', () => {
        this.el.howToPlayBtn.click();
      });
    }

    if (this.el.mobilePlayerNameInput) {
      if (this.playerName) {
        this.el.mobilePlayerNameInput.value = this.playerName;
      }
      this.el.mobilePlayerNameInput.addEventListener('input', () => {
        const val = this.el.mobilePlayerNameInput.value;
        this.el.playerNameInput.value = val;
        this.playerName = val.trim();
        if (this.playerName) {
          localStorage.setItem('uno_arena_name', this.playerName);
        }
      });
      this.el.mobilePlayerNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (this.el.mobileCreateRoomBtn) this.el.mobileCreateRoomBtn.click();
        }
      });
      this.el.playerNameInput.addEventListener('input', () => {
        if (this.el.mobilePlayerNameInput) {
          this.el.mobilePlayerNameInput.value = this.el.playerNameInput.value;
        }
      });
    }

    if (this.el.mobileRoomCodeInput) {
      this.el.mobileRoomCodeInput.addEventListener('input', () => {
        const clean = this.el.mobileRoomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        this.el.mobileRoomCodeInput.value = clean;
        this.el.roomCodeInput.value = clean;
      });
      this.el.mobileRoomCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (this.el.mobileJoinRoomBtn) this.el.mobileJoinRoomBtn.click();
        }
      });
      this.el.roomCodeInput.addEventListener('input', () => {
        if (this.el.mobileRoomCodeInput) {
          this.el.mobileRoomCodeInput.value = this.el.roomCodeInput.value;
        }
      });
    }

    if (this.el.mobileCreateRoomBtn) {
      this.el.mobileCreateRoomBtn.addEventListener('click', () => {
        const name = (this.el.mobilePlayerNameInput?.value || '').trim() ||
          (this.el.playerNameInput?.value || '').trim() ||
          this.playerName || 'Player 1';
        this.playerName = name;
        this.el.playerNameInput.value = name;
        if (this.el.mobilePlayerNameInput) this.el.mobilePlayerNameInput.value = name;
        localStorage.setItem('uno_arena_name', name);
        this.createRoom(name, this.preferredMode, this.getSelectedHouseRules());
      });
    }

    if (this.el.mobileJoinRoomBtn) {
      this.el.mobileJoinRoomBtn.addEventListener('click', () => {
        const name = (this.el.mobilePlayerNameInput?.value || '').trim() ||
          (this.el.playerNameInput?.value || '').trim() ||
          this.playerName || 'Guest';
        const code = (this.el.mobileRoomCodeInput?.value || '').trim().toUpperCase() ||
          (this.el.roomCodeInput?.value || '').trim().toUpperCase();
        if (!code) {
          this.showToast('Please enter a room code');
          if (this.el.mobileRoomCodeInput) this.el.mobileRoomCodeInput.focus();
          return;
        }
        if (this.isJoiningRoom) return;
        this.isJoiningRoom = true;
        this.el.mobileJoinRoomBtn.disabled = true;
        if (this.el.joinRoomBtn) this.el.joinRoomBtn.disabled = true;
        this.playerName = name;
        localStorage.setItem('uno_arena_name', name);
        this.connectWebSocket(code, null, null, name);
        setTimeout(() => {
          this.isJoiningRoom = false;
          if (this.el.mobileJoinRoomBtn) this.el.mobileJoinRoomBtn.disabled = false;
          if (this.el.joinRoomBtn) this.el.joinRoomBtn.disabled = false;
        }, 2500);
      });
    }

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

    const triggerPlayVsAi = () => {
      const name = (this.el.playerNameInput?.value || '').trim() ||
        (this.el.mobilePlayerNameInput?.value || '').trim() ||
        this.playerName || 'Player 1';
      this.playerName = name;
      localStorage.setItem('uno_arena_name', name);
      this.createBotRoom(name, this.preferredMode, 3, this.getSelectedHouseRules());
    };

    if (this.el.playVsAiBtn) {
      this.el.playVsAiBtn.addEventListener('click', triggerPlayVsAi);
    }
    if (this.el.mobilePlayVsAiBtn) {
      this.el.mobilePlayVsAiBtn.addEventListener('click', triggerPlayVsAi);
    }

    if (this.el.addBotBtn) {
      this.el.addBotBtn.addEventListener('click', () => {
        this.send({ type: 'add_bot' });
      });
    }

    if (this.el.shuffleSeatsBtn) {
      this.el.shuffleSeatsBtn.addEventListener('click', () => {
        this.send({ type: 'shuffle_seats' });
      });
    }

    if (this.el.reactionToggleBtn) {
      this.el.reactionToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.el.reactionTray) {
          const isShown = this.el.reactionTray.style.display === 'flex';
          this.el.reactionTray.style.display = isShown ? 'none' : 'flex';
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (this.el.reactionTray && !this.el.reactionTray.contains(e.target) && e.target !== this.el.reactionToggleBtn) {
        this.el.reactionTray.style.display = 'none';
      }
    });

    document.querySelectorAll('.reaction-item-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const emote = e.currentTarget.getAttribute('data-emote');
        if (emote) {
          sounds.playSnap?.(520, 0.1);
          this.send({ type: 'send_reaction', data: { emoteId: emote } });
          if (this.el.reactionTray) this.el.reactionTray.style.display = 'none';
        }
      });
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
      if (this.clientView?.canDraw && !(this.gameState.mode === 'classic' && this.gameState.pendingAction) && !this.isMoveInFlight) {
        this.el.drawPileBtn.classList.add('deck-tap-feedback');
        setTimeout(() => this.el.drawPileBtn.classList.remove('deck-tap-feedback'), 250);
        this.isMoveInFlight = true;
        clearTimeout(this.moveFlightTimer);
        this.moveFlightTimer = setTimeout(() => { this.isMoveInFlight = false; }, 800);
        sounds.playDraw();
        this.send({ type: 'draw_card' });
      }
    });

    if (this.el.btnCallUnoContextual) {
      this.el.btnCallUnoContextual.addEventListener('click', () => {
        if (this.unoRequestPending) return;
        this.unoRequestPending = true;
        this.isUnoArmed = true;
        this.el.btnCallUnoContextual.classList.add('uno-armed');
        this.el.btnCallUnoContextual.innerHTML = '<span class="btn-icon">✓</span> UNO ARMED!';
        sounds.playUnoCall();
        this.send({ type: 'call_uno' });
        this.showToast('UNO Armed! 📢');
      });
    }

    this.el.opponentsRow.addEventListener('click', (e) => {
      const caughtBtn = e.target.closest('.opponent-caught-btn');
      if (caughtBtn) {
        const targetId = caughtBtn.dataset.catchTarget;
        if (targetId && !this.catchRequestPending) {
          this.catchRequestPending = true;
          sounds.playCatch();
          this.send({ type: 'catch_uno', data: { targetPlayerId: targetId } });
        }
      }
    });

    if (this.el.caughtFailedModal) {
      this.el.caughtFailedModal.addEventListener('click', () => {
        this.el.caughtFailedModal.classList.remove('active');
        this.el.caughtFailedModal.style.display = 'none';
        if (this.caughtFailedTimer) clearTimeout(this.caughtFailedTimer);
      });
    }

    this.el.btnPassAction.addEventListener('click', () => {
      if (this.isMoveInFlight) return;
      this.isMoveInFlight = true;
      clearTimeout(this.moveFlightTimer);
      this.moveFlightTimer = setTimeout(() => { this.isMoveInFlight = false; }, 800);
      sounds.playSnap?.(480, 0.08);
      this.send({ type: 'pass_turn' });
    });

    this.el.btnUnoAction.addEventListener('click', () => {
      if (this.gameState.mode === 'classic' && (!this.clientView?.canCallUno || this.unoRequestPending)) return;
      this.unoRequestPending = true;
      sounds.playUnoCall();
      this.send({ type: 'call_uno' });
      if (this.gameState.mode !== 'classic') this.showToast('UNO called! 📢');
    });

    this.el.btnCatchAction.addEventListener('click', () => {
      if (this.clientView?.canCatchUno && !this.catchRequestPending) {
        this.catchRequestPending = true;
        sounds.playCatch();
        this.send({ type: 'catch_uno', data: { targetPlayerId: this.clientView.canCatchUno } });
      }
    });

    // Rematch
    this.el.rematchBtn.addEventListener('click', () => {
      if (this.rematchRequestPending) return;
      if (this.ws?.readyState !== WebSocket.OPEN) { this.showToast('Wait for the room to reconnect before requesting a rematch.'); return; }
      this.rematchRequestPending = true;
      this.send({ type: this.gameState.status === 'round_over' ? 'rematch' : 'rematch_propose', data: { matchId: this.gameState.matchId } });
      if (this.gameState.status === 'round_over') this.el.gameOverModal.classList.remove('active');
    });

    // Victory celebration close button (dismisses celebration overlay to reveal table)
    this.el.gameOverCloseBtn?.addEventListener('click', () => {
      const currentMatchKey = this.gameState?.matchId || `${this.roomId || ''}_${this.gameState?.roundNumber || 0}`;
      this.dismissedGameOverMatchId = currentMatchKey || true;
      this.el.gameOverModal.classList.remove('active');
      if (this.el.btnViewVictory && (this.gameState?.status === 'game_over' || this.gameState?.status === 'round_over')) {
        this.el.btnViewVictory.style.display = 'inline-flex';
      }
    });

    // Reopen victory celebration from finished table
    this.el.btnViewVictory?.addEventListener('click', () => {
      this.dismissedGameOverMatchId = null;
      if (this.el.btnViewVictory) this.el.btnViewVictory.style.display = 'none';
      if (this.gameState) this.showGameOver(this.gameState);
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
    if (this.el.soundIcon) this.el.soundIcon.textContent = enabled ? '🔊' : '🔇';
    for (const button of [this.el.mobileNavSoundBtn, this.el.noMercySoundBtn, this.el.noMercyMobileSoundBtn]) {
      if (!button) continue;
      button.textContent = enabled ? '🔊' : '🔇';
      button.setAttribute('aria-pressed', String(enabled));
      button.setAttribute('aria-label', enabled ? 'Mute sound' : 'Enable sound');
    }
  }

  initDialogAccessibility() {
    const focusTargets = (dialog) => [...dialog.querySelectorAll('button, input, select, [tabindex="0"]')]
      .filter((element) => !element.disabled && element.getClientRects().length);
    for (const dialog of document.querySelectorAll('.modal-overlay')) {
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.tabIndex = -1;
      const title = dialog.querySelector('h2, h3');
      if (title) {
        if (!title.id) title.id = `${dialog.id}Title`;
        dialog.setAttribute('aria-labelledby', title.id);
      }
      let opened = false;
      let previousFocus = null;
      new MutationObserver(() => {
        const active = dialog.classList.contains('active');
        if (active === opened) return;
        opened = active;
        if (active) {
          previousFocus = document.activeElement;
          (focusTargets(dialog)[0] || dialog).focus({ preventScroll: true });
        } else if (previousFocus?.isConnected && previousFocus.getClientRects().length) {
          previousFocus.focus({ preventScroll: true });
        }
      }).observe(dialog, { attributes: true, attributeFilter: ['class'] });
    }
    document.addEventListener('keydown', (event) => {
      const dialog = [...document.querySelectorAll('.modal-overlay.active')].at(-1);
      if (!dialog) return;
      if (event.key === 'Escape' && dialog === this.el.rulesModal) {
        this.closeRulesModal();
      } else if (event.key === 'Tab') {
        const targets = focusTargets(dialog);
        const first = targets[0] || dialog;
        const last = targets.at(-1) || dialog;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
          event.preventDefault();
          first.focus();
        }
      }
    });
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
    const currentName = this.el.mobilePlayerNameInput?.value.trim() || this.el.playerNameInput.value.trim() || this.playerName || '';
    this.el.setupPlayerNameInput.value = currentName;
    if (this.el.mobilePlayerNameInput) this.el.mobilePlayerNameInput.value = currentName;
    this.el.playerNameInput.value = currentName;

    const isNoMercy = mode === 'no_mercy';
    const isFlip = mode === 'flip';
    this.el.modeSetupSection.classList.toggle('mode-no-mercy-setup', isNoMercy);
    document.body.classList.toggle('in-no-mercy-setup', isNoMercy);
    this.el.modeSetupSection.classList.toggle('mode-flip-setup', isFlip);
    document.body.classList.toggle('in-flip-setup', isFlip);

    if (isNoMercy) {
      if (this.el.noMercyPlayerNameInput) this.el.noMercyPlayerNameInput.value = currentName;
      if (this.el.noMercyMobilePlayerNameInput) this.el.noMercyMobilePlayerNameInput.value = currentName;
      if (this.el.noMercyLimitSelect) this.el.noMercyLimitSelect.value = String(this.mercyKnockoutLimit);
      if (this.el.noMercyMobileLimitSelect) this.el.noMercyMobileLimitSelect.value = String(this.mercyKnockoutLimit);
      if (this.el.noMercyRoomCodeInput) this.el.noMercyRoomCodeInput.value = '';
      if (this.el.noMercyMobileRoomCodeInput) this.el.noMercyMobileRoomCodeInput.value = '';
    }

    if (isFlip) {
      if (this.el.flipPlayerNameInput) this.el.flipPlayerNameInput.value = currentName;
      if (this.el.flipRoomCodeInput) this.el.flipRoomCodeInput.value = '';
    }

    this.el.modeHomeScreen.hidden = true;
    this.el.modeSetupSection.hidden = false;
  }

  showModePicker() {
    const enteredName = this.el.noMercyPlayerNameInput?.value?.trim() ||
      this.el.noMercyMobilePlayerNameInput?.value?.trim() ||
      this.el.flipPlayerNameInput?.value?.trim() ||
      this.el.setupPlayerNameInput?.value?.trim();
    if (enteredName) {
      this.playerName = enteredName;
      this.el.playerNameInput.value = enteredName;
      if (this.el.mobilePlayerNameInput) this.el.mobilePlayerNameInput.value = enteredName;
      localStorage.setItem('uno_arena_name', enteredName);
    }
    this.el.modeSetupSection.classList.remove('mode-no-mercy-setup');
    document.body.classList.remove('in-no-mercy-setup');
    this.el.modeSetupSection.classList.remove('mode-flip-setup');
    document.body.classList.remove('in-flip-setup');
    this.el.modeSetupSection.hidden = true;
    this.el.modeHomeScreen.hidden = false;
  }

  triggerFlipCreate() {
    const inputVal = (this.el.flipPlayerNameInput?.value || '').trim();
    const name = inputVal || this.playerName || 'Player 1';
    this.playerName = name;
    localStorage.setItem('uno_arena_name', name);
    this.createRoom(name, 'flip', this.getSelectedHouseRules());
  }

  triggerFlipJoin() {
    const nameInputVal = (this.el.flipPlayerNameInput?.value || '').trim();
    const name = nameInputVal || this.playerName || 'Guest';
    const code = (this.el.flipRoomCodeInput?.value || '').trim().toUpperCase();
    if (!code) {
      this.showToast('Enter your friend’s room code');
      if (this.el.flipRoomCodeInput) this.el.flipRoomCodeInput.focus();
      return;
    }
    if (this.isJoiningRoom) return;
    this.isJoiningRoom = true;
    if (this.el.flipJoinRoomBtn) this.el.flipJoinRoomBtn.disabled = true;
    this.playerName = name;
    localStorage.setItem('uno_arena_name', name);
    this.connectWebSocket(code, null, null, name);
    setTimeout(() => {
      this.isJoiningRoom = false;
      if (this.el.flipJoinRoomBtn) this.el.flipJoinRoomBtn.disabled = false;
    }, 1500);
  }

  triggerNoMercyCreate() {
    const inputVal = (this.el.noMercyPlayerNameInput?.value || this.el.noMercyMobilePlayerNameInput?.value || '').trim();
    const name = inputVal || this.playerName || 'Player 1';
    this.playerName = name;
    localStorage.setItem('uno_arena_name', name);
    this.createRoom(name, 'no_mercy', this.getSelectedHouseRules());
  }

  triggerNoMercyJoin() {
    const nameInputVal = (this.el.noMercyPlayerNameInput?.value || this.el.noMercyMobilePlayerNameInput?.value || '').trim();
    const name = nameInputVal || this.playerName || 'Guest';
    const code = (this.el.noMercyRoomCodeInput?.value || this.el.noMercyMobileRoomCodeInput?.value || '').trim().toUpperCase();
    if (!code) {
      this.showToast('Enter your friend’s room code');
      if (this.el.noMercyRoomCodeInput && this.el.noMercyRoomCodeInput.offsetParent) {
        this.el.noMercyRoomCodeInput.focus();
      } else if (this.el.noMercyMobileRoomCodeInput) {
        this.el.noMercyMobileRoomCodeInput.focus();
      }
      return;
    }
    if (this.isJoiningRoom) return;
    this.isJoiningRoom = true;
    if (this.el.noMercyJoinRoomBtn) this.el.noMercyJoinRoomBtn.disabled = true;
    if (this.el.noMercyMobileJoinRoomBtn) this.el.noMercyMobileJoinRoomBtn.disabled = true;
    this.playerName = name;
    localStorage.setItem('uno_arena_name', name);
    this.connectWebSocket(code, null, null, name);
    setTimeout(() => {
      this.isJoiningRoom = false;
      if (this.el.noMercyJoinRoomBtn) this.el.noMercyJoinRoomBtn.disabled = false;
      if (this.el.noMercyMobileJoinRoomBtn) this.el.noMercyMobileJoinRoomBtn.disabled = false;
    }, 2500);
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
    if (this.el.mobileCreateRoomBtn) this.el.mobileCreateRoomBtn.disabled = true;
    if (this.el.setupCreateRoomBtn) this.el.setupCreateRoomBtn.disabled = true;
    if (this.el.flipCreateRoomBtn) this.el.flipCreateRoomBtn.disabled = true;

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
      if (this.el.mobileCreateRoomBtn) this.el.mobileCreateRoomBtn.disabled = false;
      if (this.el.setupCreateRoomBtn) this.el.setupCreateRoomBtn.disabled = false;
      if (this.el.flipCreateRoomBtn) this.el.flipCreateRoomBtn.disabled = false;
    }
  }

  async createBotRoom(hostName, mode = this.preferredMode, botCount = 3, houseRules = {}) {
    if (this.isCreatingRoom) return;
    this.isCreatingRoom = true;
    if (this.el.createRoomBtn) this.el.createRoomBtn.disabled = true;
    if (this.el.playVsAiBtn) this.el.playVsAiBtn.disabled = true;
    if (this.el.mobilePlayVsAiBtn) this.el.mobilePlayVsAiBtn.disabled = true;

    try {
      const res = await fetch('/api/rooms/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostName, mode, botCount, houseRules }),
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

        const roomUrl = new URL(window.location.href);
        roomUrl.searchParams.set('room', this.roomId);
        window.history.replaceState({}, '', roomUrl);

        this.connectWebSocket(data.roomId, data.playerId, data.sessionToken, hostName);
      } else {
        this.showToast(data?.error || 'Failed to start AI game');
      }
    } catch (e) {
      this.showToast('Network error starting AI game');
    } finally {
      this.isCreatingRoom = false;
      if (this.el.createRoomBtn) this.el.createRoomBtn.disabled = false;
      if (this.el.playVsAiBtn) this.el.playVsAiBtn.disabled = false;
      if (this.el.mobilePlayVsAiBtn) this.el.mobilePlayVsAiBtn.disabled = false;
    }
  }

  connectWebSocket(roomId, playerId, sessionToken, playerName) {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.el.banner.classList.remove('visible');
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      // Keep alive heartbeat ping every 20s to prevent reverse proxy/mobile timeout
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 20000);

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
        if (msg.type === 'pong') {
          // Heartbeat acknowledged
          return;
        }
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
        } else if (msg.type === 'player_card_hovered') {
          this.handleOpponentCardHover(msg.data);
        } else if (msg.type === 'player_reaction') {
          this.handlePlayerReaction(msg.data);
        } else if (msg.type === 'catch_failed') {
          this.catchRequestPending = false;
          this.showCaughtFailedModal(msg.data);
        } else if (msg.type === 'error') {
          this.rematchRequestPending = false; this.rematchActionPending = false; this.rematchDismissAfterResponseId = null; this.unoRequestPending = false; this.catchRequestPending = false; this.pendingClassicMotion = null;
          this.clearClassicAnimations?.();
          this.isMoveInFlight = false;
          this.el.playerHandCards.querySelectorAll('.playing').forEach(el => el.classList.remove('playing'));
          if (msg.message && msg.message.includes('CAUGHT FAILED')) {
            this.showCaughtFailedModal({ message: msg.message });
          } else {
            this.showToast(msg.message || 'Error');
          }
        }
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    this.ws.onclose = () => {
      if (['classic', 'no_mercy'].includes(this.gameState?.mode)) {
        this.cancelCardDrag?.();
        this.clearClassicAnimations?.();
        this.pendingClassicMotion = null;
        this.isMoveInFlight = false;
        this.pendingPlayCard = null;
        this.pendingPlayWrapper = null;
        this.el.colorPickerModal.classList.remove('active');
        this.el.swapPickerModal.classList.remove('active');
        this.el.playerHandCards.setAttribute('inert', '');
        this.el.btnDrawAction.disabled = true;
        this.el.drawPileBtn.disabled = true;
      }
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
      this.el.banner.classList.add('visible');
      // Auto-reconnect after 2 seconds
      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = setTimeout(() => {
        if (this.roomId) {
          const sToken = this.gameState?.mode === 'no_mercy' ? this.sessionToken || localStorage.getItem(`session_${this.roomId}`) : localStorage.getItem(`session_${this.roomId}`);
          const pId = this.gameState?.mode === 'no_mercy' ? this.playerId : localStorage.getItem(`player_${this.roomId}`);
          this.connectWebSocket(this.roomId, pId, sToken, this.playerName);
        }
      }, 2000);
    };

    this.ws.onerror = (err) => {
      console.warn('WebSocket connection error:', err);
    };
  }

  send(payload) {
    if (['classic', 'no_mercy'].includes(this.gameState?.mode) && ['draw_card', 'play_card'].includes(payload.type)) {
      const element = payload.type === 'draw_card' ? this.el.drawPile.querySelector('.game-card') : this.el.playerHandCards.querySelector(`[data-card-id="${payload.data?.cardId}"]`);
      if (element) this.pendingClassicMotion = { type: payload.type, cardId: payload.data?.cardId, rect: element.getBoundingClientRect(), html: element.querySelector('.game-card')?.outerHTML || element.outerHTML };
    }
    const full = {
      roomId: this.roomId,
      playerId: this.playerId,
      sessionToken: this.sessionToken,
      ...payload,
      actionId: payload.actionId || crypto.randomUUID(),
      expectedActionVersion: ['classic', 'no_mercy'].includes(this.gameState?.mode) ? this.gameState.actionVersion : undefined,
    };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(full));
    } else if (['classic', 'no_mercy'].includes(this.gameState?.mode) && ['play_card', 'draw_card', 'pass_turn', 'choose_color', 'challenge_draw4', 'call_uno', 'catch_uno', 'rematch', 'start_game', 'rematch_propose', 'rematch_respond', 'rematch_vote', 'rematch_cancel'].includes(payload.type)) {
      this.isMoveInFlight = false;
      this.showToast('Connection lost. Wait for the table to reconnect.');
      return false;
    } else if (payload.type !== 'join') {
      this.pendingMessages = this.pendingMessages || [];
      this.pendingMessages.push(full);
    }
  }

  handleOpponentCardHover(data) {
    const { playerId, cardIndex } = data || {};
    const opponentBox = document.querySelector(`.opponent-box[data-player-id="${playerId}"]`);
    if (!opponentBox) return;
    const cardBacks = opponentBox.querySelectorAll('.opponent-card-back');
    cardBacks.forEach((back, idx) => {
      back.classList.toggle('fan-card-hovered', cardIndex !== null && idx === (cardIndex % Math.max(1, cardBacks.length)));
    });
  }

  handlePlayerReaction(data) {
    const { playerId, emoteId } = data || {};
    const EMOTE_MAP = {
      laugh: '😄',
      shocked: '😱',
      fire: '🔥',
      lightning: '⚡',
      skull: '💀',
    };
    const emoji = EMOTE_MAP[emoteId] || '😄';

    let avatarEl = null;
    if (playerId === this.playerId) {
      avatarEl = this.el.localPlayerProfile?.querySelector('.local-avatar') || document.querySelector('.player-bottom-area');
    } else {
      avatarEl = document.querySelector(`.opponent-box[data-player-id="${playerId}"] .opponent-avatar`) ||
        document.querySelector(`.opponent-box[data-player-id="${playerId}"]`);
    }
    if (!avatarEl) return;

    sounds.playSnap?.(560, 0.08);

    const bubble = document.createElement('div');
    bubble.className = 'player-emote-bubble';
    bubble.innerHTML = `<span class="emote-icon">${emoji}</span>`;
    avatarEl.appendChild(bubble);

    setTimeout(() => {
      if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
    }, 2200);
  }

  handleRoomState(view) {
    const previous = this.clientView;
    const classicGeometry = this.captureClassicGeometry();
    this.clearClassicAnimations();
    const playSource = previous && this.el.playerHandCards.querySelector(`[data-card-id="${view.gameState.topDiscard?.id}"]`);
    const playRect = playSource?.getBoundingClientRect();
    const oldIds = new Set(previous?.myHand.map(c => c.id) || []);
    this.cancelCardDrag?.();
    document.querySelectorAll('.classic-returning-card').forEach(el => el.remove());
    this.el.playerHandCards.removeAttribute('inert');
    this.clientView = view;
    this.gameState = view.gameState;
    if (view.myPlayerId) this.playerId = view.myPlayerId;
    this.rematchRequestPending = false; this.rematchActionPending = false;
    if (this.rematchDismissAfterResponseId && view.rematchProposal?.id === this.rematchDismissAfterResponseId && (view.rematchProposal.status === 'cancelled' || view.rematchProposal.declinedPlayerIds.includes(this.playerId))) { this.dismissedRematchId = view.rematchProposal.id; this.rematchDismissAfterResponseId = null; }
    if (view.isSpectator) { this.renderRematchSpectator(); this.renderRematchProposal(); return; }
    const pendingStillPlayable = this.pendingPlayCard && view.canPlayCards.includes(this.pendingPlayCard.id);
    const openingChoice = view.isMyTurn && ['opening_color', 'color_roulette'].includes(view.gameState.pendingAction?.type);
    if (view.gameState.mode !== 'flip' && !pendingStillPlayable && !openingChoice) {
      this.pendingPlayCard = null;
      this.pendingPlayWrapper = null;
      this.el.colorPickerModal.classList.remove('active');
      if (view.gameState.mode === 'no_mercy') this.el.swapPickerModal.classList.remove('active');
    }
    if (view.gameState.status === 'playing') {
      this.dismissedGameOverMatchId = null;
      if (this.el.btnViewVictory) this.el.btnViewVictory.style.display = 'none';
      this.el.gameOverModal.classList.remove('active');
    }
    if (view.drawFourEvidence && this.lastDrawFourEvidenceId !== view.drawFourEvidence.id) {
      this.lastDrawFourEvidenceId = view.drawFourEvidence.id;
      const evidence = view.drawFourEvidence;
      this.showToast(evidence.hadMatchingColor ? `Challenge successful: the player held ${evidence.matchingColorCount ?? 'a'} ${evidence.activeColorBeforePlay || 'matching-colour'} card(s). You play next.` : `Challenge failed: the player held no ${evidence.activeColorBeforePlay || 'matching-colour'} cards. Draw six and miss your turn.`);
    }
    this.unoRequestPending = false; this.catchRequestPending = false;
    this.isMoveInFlight = false;
    this.isStartingGame = false;
    this.isJoiningRoom = false;
    if (this.el.joinRoomBtn) this.el.joinRoomBtn.disabled = false;
    if (this.el.setupJoinRoomBtn) this.el.setupJoinRoomBtn.disabled = false;
    if (this.el.flipJoinRoomBtn) this.el.flipJoinRoomBtn.disabled = false;

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
      if (view.gameState.mode !== 'flip' && previous) this.animateClassicState(previous, classicGeometry);
    }
    if (view.gameState.mode === 'no_mercy' && openingChoice && !this.el.colorPickerModal.classList.contains('active')) this.openColorPicker();
    this.renderRematchProposal();
  }

  sendRematchAction(type, data = {}) {
    if (this.rematchActionPending || this.ws?.readyState !== WebSocket.OPEN) return;
    this.rematchActionPending = true;
    this.send({ type, data: { proposalId: this.clientView.rematchProposal.id, ...data } });
  }

  closeRematchDialog() {
    const p = this.clientView?.rematchProposal;
    if (!p) return;
    if (['responding', 'voting', 'resolved'].includes(p.status)) {
      if (this.rematchActionPending || this.ws?.readyState !== WebSocket.OPEN) return;
      this.rematchDismissAfterResponseId = p.id;
      if (p.initiatorPlayerId === this.playerId) this.sendRematchAction('rematch_cancel');
      else if (p.pendingPlayerIds.includes(this.playerId)) this.sendRematchAction('rematch_respond', { accept: false });
      else if (p.acceptedPlayerIds.includes(this.playerId)) this.sendRematchAction('rematch_respond', { accept: false, withdraw: true });
      else this.dismissedRematchId = p.id;
    } else this.dismissedRematchId = p.id;
    this.renderRematchProposal();
  }

  renderRematchSpectator() {
    const p = this.clientView.rematchProposal;
    const result = p?.previousResult;
    if (result) {
      const winner = result.scores.find(player => player.id === result.winnerId);
      if (this.el.victoryWinsBadge) {
        this.el.winnerNameText.textContent = winner?.name || 'Winner';
        this.el.victoryWinsBadge.textContent = 'WINS!';
      } else {
        this.el.winnerNameText.textContent = `${winner?.name || 'Winner'} WINS!`;
      }
      this.el.winReasonText.textContent = `You are sitting out this rematch. ${result.winReason || ''}`;
    }
    this.el.rematchBtn.style.display = 'none';
    this.el.gameOverModal.classList.add('active');
  }

  renderRematchProposal() {
    const modal = document.getElementById('rematchProposalModal'), content = document.getElementById('rematchProposalContent');
    const p = this.clientView.rematchProposal;
    clearInterval(this.rematchCountdownInterval); this.rematchCountdownInterval = null;
    if (!p || !p.originalParticipantIds.includes(this.playerId) || this.dismissedRematchId === p.id || (p.status === 'started' && !this.clientView.isSpectator)) { modal.classList.remove('active'); return; }
    const live = ['responding', 'voting'].includes(p.status);
    const isMeAccepted = this.playerId === p.initiatorPlayerId || p.acceptedPlayerIds.includes(this.playerId);
    const isMeDeclined = !isMeAccepted && p.declinedPlayerIds.includes(this.playerId);
    const isMePending = !isMeAccepted && !isMeDeclined && (p.pendingPlayerIds.includes(this.playerId) || live);
    const initiator = p.participants.find(player => player.id === p.initiatorPlayerId);
    const titles = { responding: 'Rematch Requested!', voting: 'Choose the next game', resolved: 'The votes are in!', cancelled: 'Rematch cancelled', started: 'A new game has started' };
    const labels = { classic: 'Classic UNO', flip: 'UNO Flip', no_mercy: 'UNO No Mercy' };
    const artwork = { classic: 'classic-card', flip: 'flip-card', no_mercy: 'no-mercy-card' };
    const counts = Object.fromEntries(Object.keys(labels).map(mode => [mode, Object.entries(p.modeVotes).filter(([id, vote]) => p.acceptedPlayerIds.includes(id) && vote === mode).length]));
    const focusedMode = document.activeElement?.dataset?.rematchMode;
    const focusedResponse = document.activeElement?.dataset?.rematchResponse;
    const acceptedVotedCount = p.acceptedPlayerIds.filter(id => p.modeVotes && p.modeVotes[id] && ['classic', 'flip', 'no_mercy'].includes(p.modeVotes[id])).length;
    const totalAcceptedCount = p.acceptedPlayerIds.length;

    content.innerHTML = `<div class="rematch-kicker">ONE MORE GAME?</div><h2 id="rematchProposalTitle">${titles[p.status] || 'Rematch'}</h2>
      <div class="rematch-inviter"><span class="rematch-initials">${escapeHtml(initiator?.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('') || '?')}</span><p><strong>${escapeHtml(initiator?.name)}</strong> wants to play another game.<br>${isMePending && live ? 'Do you accept?' : isMeAccepted ? 'You have ACCEPTED.' : isMeDeclined ? 'You have DECLINED.' : ''}</p></div>
      ${isMePending && p.status === 'responding' ? '<div class="rematch-response-actions"><button data-rematch-response="accept">ACCEPT</button><button data-rematch-response="decline">DECLINE</button></div>' : ''}
      ${isMeAccepted && live ? `<p class="rematch-vote-hint">Choose one mode. You can change your vote until voting closes. Uncast votes use the previous mode.</p><div class="rematch-mode-grid">${Object.keys(labels).map(mode => `<button data-rematch-mode="${mode}" class="${p.modeVotes[this.playerId] === mode ? 'selected' : ''}" aria-pressed="${p.modeVotes[this.playerId] === mode}" ${mode !== 'classic' && p.acceptedPlayerIds.length > 6 ? 'disabled' : ''}><img src="/assets/game-modes/${artwork[mode]}.png" alt=""><strong>${labels[mode]}</strong><span>${counts[mode]} vote${counts[mode] === 1 ? '' : 's'}</span></button>`).join('')}</div><small>${p.acceptedPlayerIds.length > 6 ? 'More than six accepted players: Classic is the supported mode.' : ''}</small>` : ''}
      ${p.selectedMode ? `<div class="rematch-result">${labels[p.selectedMode]} selected${p.status === 'resolved' ? ' · Starting together…' : ''}</div>` : ''}
      ${p.reason ? `<p class="rematch-reason">${escapeHtml(p.reason)}</p>` : ''}
      <ul class="rematch-roster">${p.participants.map(player => {
      const isAccepted = player.id === p.initiatorPlayerId || p.acceptedPlayerIds.includes(player.id) || player.status === 'accepted';
      const isDeclined = !isAccepted && (p.declinedPlayerIds.includes(player.id) || player.status === 'declined');
      const statusClass = isAccepted ? 'accepted' : isDeclined ? 'declined' : 'pending';
      const statusLabel = isAccepted ? 'ACCEPTED' : isDeclined ? 'DECLINED' : 'PENDING';
      return `<li><span>${escapeHtml(player.name)}</span><b class="${statusClass}">${statusLabel}</b></li>`;
    }).join('')}</ul>
      <footer><span>${acceptedVotedCount} / ${totalAcceptedCount} accepted players voted</span><span id="rematchCountdown"></span></footer>`;
    document.getElementById('rematchCloseBtn').onclick = () => this.closeRematchDialog();
    content.querySelectorAll('[data-rematch-response]').forEach(button => button.onclick = () => this.sendRematchAction('rematch_respond', { accept: button.dataset.rematchResponse === 'accept' }));
    content.querySelectorAll('[data-rematch-mode]').forEach(button => button.onclick = () => this.sendRematchAction('rematch_vote', { mode: button.dataset.rematchMode }));
    modal.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeRematchDialog(); } };
    const deadline = p.status === 'responding' ? p.responseDeadline : p.status === 'voting' ? p.votingDeadline : p.startAt;
    const tick = () => { const target = document.getElementById('rematchCountdown'); if (target) target.textContent = live ? `${p.status === 'responding' ? 'Responses' : 'Voting'}: ${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s` : ''; };
    tick(); if (live) this.rematchCountdownInterval = setInterval(tick, 250);
    const wasOpen = modal.classList.contains('active'); modal.classList.add('active'); if (!wasOpen) {
      sounds.playSnap?.(520, 0.15);
      document.getElementById('rematchCloseBtn').focus();
    }
    else if (focusedMode || focusedResponse) (content.querySelector(`[data-rematch-mode="${focusedMode}"]`) || content.querySelector('[data-rematch-mode]') || document.getElementById('rematchCloseBtn')).focus();
  }

  classicAvatarHTML(player, active) {
    const initials = player.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
    return `<span class="classic-avatar-initials">${escapeHtml(initials)}</span>${active ? '<svg class="classic-profile-ring" viewBox="0 0 54 54" aria-label="Active player countdown"><circle cx="27" cy="27" r="22" fill="none" stroke-dasharray="138.23"/></svg><span class="classic-profile-seconds"></span>' : ''}`;
  }

  renderClassicLocalProfile() {
    const { gameState, myHand, isMyTurn, canCallUno } = this.clientView;
    let controls = document.getElementById('classicLocalControls');
    if (!controls) { controls = document.createElement('div'); controls.id = 'classicLocalControls'; document.querySelector('.player-bottom-area').prepend(controls); }
    let profile = document.getElementById('classicLocalProfile');
    if (!profile) { profile = document.createElement('div'); profile.id = 'classicLocalProfile'; controls.appendChild(profile); }
    const me = gameState.players.find(p => p.id === this.playerId);
    profile.dataset.profileId = me.id;
    profile.innerHTML = `<div class="opponent-avatar">${this.classicAvatarHTML(me, isMyTurn && !!gameState.turnDeadline)}</div><span>${escapeHtml(me.name)}<small>${myHand.length} cards</small></span>`;
    controls.appendChild(this.el.btnUnoAction);
    this.el.btnUnoAction.style.display = myHand.length === 2 && isMyTurn && canCallUno && !me.hasCalledUno ? 'inline-flex' : 'none';
  }

  captureClassicGeometry() {
    const hand = new Map();
    this.el.playerHandCards.querySelectorAll('[data-card-id]').forEach(el => hand.set(el.dataset.cardId, { rect: el.getBoundingClientRect(), html: el.querySelector('.game-card')?.outerHTML }));
    const opponents = new Map();
    this.el.opponentsRow.querySelectorAll('[data-profile-id]').forEach(el => opponents.set(el.dataset.profileId, el.getBoundingClientRect()));
    return { hand, opponents, deck: this.el.drawPile.querySelector('.game-card')?.getBoundingClientRect(), pending: this.pendingClassicMotion };
  }

  clearClassicAnimations() {
    for (const dispose of this.classicAnimationCleanups || []) dispose();
    this.classicAnimationCleanups = new Set();
  }

  travelClassicCard(source, target, html, faceHTML, delay = 0) {
    if (!source || source.width <= 0 || source.height <= 0 || !target || !html) return;
    const destination = target.getBoundingClientRect();
    if (destination.width <= 0 || destination.height <= 0) return;
    const ghost = document.createElement('div'); ghost.className = 'classic-motion-ghost'; ghost.setAttribute('aria-hidden', 'true'); ghost.innerHTML = html;
    Object.assign(ghost.style, { left: `${source.left}px`, top: `${source.top}px`, width: `${source.width}px`, height: `${source.height}px` });
    document.body.appendChild(ghost);
    const originalVisibility = target.style.visibility;
    if (faceHTML) target.style.visibility = 'hidden';
    const duration = Math.min(450, Math.max(300, Math.hypot(destination.left - source.left, destination.top - source.top) * .45));
    const dx = destination.left - source.left, dy = destination.top - source.top;
    const scaleX = destination.width / source.width, scaleY = destination.height / source.height;
    const animation = ghost.animate([{ transform: 'translate(0,0) rotate(-5deg)' }, { transform: `translate(${dx * .55}px,${dy * .55 - 18}px) rotate(4deg) scale(${(1 + scaleX) / 2},${(1 + scaleY) / 2})`, offset: .55 }, { transform: `translate(${dx}px,${dy}px) rotate(0deg) scale(${scaleX},${scaleY})` }], { duration, delay, easing: 'cubic-bezier(.22,.65,.3,1)', fill: 'both' });
    let reveal;
    if (faceHTML && faceHTML !== html) {
      const front = document.createElement('div'); front.className = 'classic-motion-front'; front.innerHTML = faceHTML; ghost.appendChild(front);
      reveal = front.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: .72 }, { opacity: 1, offset: .86 }, { opacity: 1, offset: 1 }], { duration, delay, fill: 'both' });
    }
    const dispose = () => { reveal?.cancel(); animation.cancel(); ghost.remove(); target.style.visibility = originalVisibility; this.classicAnimationCleanups.delete(dispose); };
    this.classicAnimationCleanups.add(dispose);
    animation.onfinish = dispose;
  }

  animateNoMercyAction(previous, geometry) {
    const state = this.gameState;
    const destination = id => id === this.playerId ? this.el.playerHandCards : this.el.opponentsRow.querySelector(`[data-profile-id="${id}"] .opponent-avatar`);
    const back = renderCardBackHTML(false, false, 'no_mercy');
    const event = state.noMercyAction;
    if (event && event.id !== previous.gameState.noMercyAction?.id) {
      const active = state.players.filter(p => !p.isEliminated);
      if (event.type === 'number' && state.topDiscard?.value === 7) {
        const a = destination(event.playerId), b = destination(event.targetPlayerId);
        if (a && b) { this.travelClassicCard(a.getBoundingClientRect(), b, back); this.travelClassicCard(b.getBoundingClientRect(), a, back, null, 120); }
      }
      if (event.type === 'number' && state.topDiscard?.value === 0) active.forEach((p, i) => {
        const a = destination(p.id), b = destination(active[(i + event.direction + active.length) % active.length].id);
        if (a && b) this.travelClassicCard(a.getBoundingClientRect(), b, back, null, i * 80);
      });
      if (event.type === 'discard_all') event.discardedIds.forEach((id, i) => {
        const source = geometry.hand.get(id); if (source) this.travelClassicCard(source.rect, this.el.discardPile, source.html, null, i * 70);
      });
      if (event.type === 'skip_everyone') destination(event.playerId)?.animate([{ filter: 'brightness(2)' }, { filter: 'none' }], { duration: 500 });
    }
    const roulette = state.rouletteResult;
    if (roulette && roulette.id !== previous.gameState.rouletteResult?.id) {
      const target = destination(roulette.targetPlayerId);
      roulette.revealed.forEach((card, i) => this.travelClassicCard(geometry.deck, target, renderCardHTML(card, { mode: 'no_mercy' }), null, i * 160));
      this.showToast(`Roulette: ${roulette.color.toUpperCase()} · ${roulette.revealed.length} cards`);
    }
    state.players.filter(p => p.isEliminated && !previous.gameState.players.find(old => old.id === p.id)?.isEliminated).forEach(p => {
      this.showToast(`${p.name} — MERCY KNOCKOUT`);
      destination(p.id)?.animate([{ transform: 'scale(1.15)', opacity: 1 }, { transform: 'scale(.9)', opacity: .4 }], { duration: 650 });
    });
  }

  animateClassicState(previous, geometry) {
    const current = this.clientView;
    this.pendingClassicMotion = null;
    const me = current.gameState.players.find(p => p.id === this.playerId);
    const beforeMe = previous.gameState.players.find(p => p.id === this.playerId);
    const useful = current.gameState.eventLogs?.[0];
    if (useful && useful.id !== previous.gameState.eventLogs?.[0]?.id && /call(?:ed)? UNO|CAUGHT|Draw Four challenge|penalty|drew [246]|played \+[246]/i.test(useful.text)) this.showToast(useful.text);
    if (me?.hasCalledUno && !beforeMe?.hasCalledUno) this.showToast('UNO!');
    if (previous.gameState.mode === 'flip' || previous.gameState.status !== 'playing' || previous.gameState.roomId !== current.gameState.roomId || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (current.gameState.mode === 'no_mercy') this.animateNoMercyAction(previous, geometry);
    const newTop = current.gameState.topDiscard;
    if (newTop?.id !== previous.gameState.topDiscard?.id && geometry.hand.has(newTop?.id)) {
      const from = geometry.pending?.cardId === newTop.id ? geometry.pending : geometry.hand.get(newTop.id);
      this.travelClassicCard(from.rect, this.el.discardPile.querySelector('.game-card'), from.html, from.html);
    }
    const action = current.gameState.noMercyAction;
    const transfer = current.gameState.mode === 'no_mercy' && action?.id !== previous.gameState.noMercyAction?.id && action?.type === 'number' && [0, 7].includes(current.gameState.topDiscard?.value);
    const roulette = current.gameState.mode === 'no_mercy' && current.gameState.rouletteResult?.id !== previous.gameState.rouletteResult?.id;
    if (current.gameState.mode === 'no_mercy' && newTop?.id !== previous.gameState.topDiscard?.id && !geometry.hand.has(newTop?.id)) {
      const source = geometry.opponents.get(action?.playerId);
      if (source) this.travelClassicCard(source, this.el.discardPile.querySelector('.game-card'), renderCardBackHTML(false, false, 'no_mercy'), renderCardHTML(newTop, { mode: 'no_mercy' }));
    }
    const oldIds = new Set(previous.myHand.map(c => c.id));
    current.myHand.filter(c => !transfer && !roulette && !oldIds.has(c.id)).forEach((card, index) => {
      const target = this.el.playerHandCards.querySelector(`[data-card-id="${card.id}"] .game-card`);
      this.travelClassicCard(geometry.pending?.type === 'draw_card' ? geometry.pending.rect : geometry.deck, target, renderCardBackHTML(false, false, current.gameState.mode), renderCardHTML(card, { mode: current.gameState.mode }), index * 65);
    });
    for (const player of current.gameState.players.filter(p => p.id !== this.playerId)) {
      const before = previous.gameState.players.find(p => p.id === player.id);
      const fan = this.el.opponentsRow.querySelector(`[data-profile-id="${player.id}"] .opponent-fan-card:last-child img`);
      const target = fan?.getClientRects().length ? fan : this.el.opponentsRow.querySelector(`[data-profile-id="${player.id}"] .opponent-avatar`);
      for (let i = 0; !transfer && !roulette && i < Math.min(current.gameState.mode === 'no_mercy' ? 25 : 10, Math.max(0, player.cardCount - (before?.cardCount ?? player.cardCount))); i++) this.travelClassicCard(geometry.deck, target, renderCardBackHTML(false, false, current.gameState.mode), null, i * 65);
    }
    // Move retained cards into their new fan positions without a layout snap.
    this.el.playerHandCards.querySelectorAll('[data-card-id]').forEach(el => {
      const old = geometry.hand.get(el.dataset.cardId); if (!old) return;
      const now = el.getBoundingClientRect();
      if (Math.abs(old.rect.left - now.left) > 1) el.animate([{ transform: `translate(${old.rect.left - now.left}px,${old.rect.top - now.top}px) ${el.style.transform}` }, { transform: el.style.transform }], { duration: 350, easing: 'ease-out' });
    });
  }

  renderLobby() {
    if (this.gameState.mode === 'classic') { this.clearClassicAnimations(); clearInterval(this.turnTimerInterval); this.turnTimerInterval = null; }
    document.body.classList.add('in-room');
    document.body.classList.remove('in-arena');
    document.body.classList.remove('in-no-mercy-setup');
    document.body.classList.remove('in-flip-setup');
    this.el.entryView.style.display = 'block';
    this.el.arenaView.style.display = 'none';
    this.el.modeSetupSection.hidden = true;
    this.el.modeSetupSection.classList.remove('mode-no-mercy-setup');
    this.el.modeSetupSection.classList.remove('mode-flip-setup');
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
           <label class="lobby-rule-control"><span>Knockout at</span><select id="lobbyMercyLimit" class="lobby-rule-select" aria-label="No Mercy knockout card limit">${[25, 35, 45].map((limit) => `<option value="${limit}" ${limit === mercyLimit ? 'selected' : ''}>${limit} cards (${limit === 25 ? 'official' : 'house rule'})</option>`).join('')}</select></label>`
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
            <span>${p.isHost ? '👑' : (p.isBot ? '🤖' : '👤')}</span>
            <strong>${escapeHtml(p.name)}</strong>
            ${p.isBot ? '<span class="bot-badge" style="font-size: 0.7rem; background: #3B82F6; color: white; padding: 2px 6px; border-radius: 4px; font-weight: 800;">BOT</span>' : ''}
            ${p.id === this.playerId ? '<span style="font-size: 0.75rem; color: #F59E0B;">(You)</span>' : ''}
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="ready-pill ${p.isReady ? 'ready' : 'waiting'}">
              ${p.isReady ? '✓ READY' : 'WAITING'}
            </span>
            ${isHost && p.isBot ? `<button class="remove-bot-btn" data-bot-id="${p.id}" type="button" title="Remove bot" style="background: none; border: none; color: #EF4444; font-size: 1rem; cursor: pointer; padding: 2px 6px;">✕</button>` : ''}
          </div>
        </div>
      `
      )
      .join('');

    this.el.lobbyPlayersList.querySelectorAll('.remove-bot-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const botId = e.currentTarget.dataset.botId;
        if (botId) this.send({ type: 'remove_bot', data: { botId } });
      });
    });

    const hostControls = document.getElementById('lobbyHostControls');
    if (hostControls) {
      hostControls.style.display = isHost ? 'flex' : 'none';
    }

    // Host controls
    if (isHost) {
      this.el.startGameBtn.style.display = 'block';
      const allReady = this.gameState.players.length >= 2 && this.gameState.players.every((p) => p.isReady);
      this.el.startGameBtn.disabled = !allReady;
      this.el.startGameBtn.textContent = allReady
        ? 'START GAME ▶'
        : `WAITING FOR PLAYERS (${this.gameState.players.length}/${this.gameState.mode === 'classic' ? 10 : 6})`;
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
    document.body.classList.toggle('no-mercy-arena', this.gameState.mode === 'no_mercy');
    document.body.classList.toggle('classic-arena', this.gameState.mode === 'classic');
    document.body.classList.toggle('classic-many-players', this.gameState.mode === 'classic' && this.gameState.players.length > 6);
    this.el.entryView.style.display = 'none';
    this.el.arenaView.style.display = 'flex';

    const { gameState, myHand, isMyTurn, canPlayCards, canDraw, canCallUno, canCatchUno } = this.clientView;
    document.body.classList.toggle('classic-draw4-response', gameState.mode === 'classic' && isMyTurn && gameState.pendingAction?.type === 'draw4_challenge');

    const controls = this.el.btnDrawAction.closest('.table-action-bar');
    const controlsParent = gameState.mode === 'no_mercy' ? document.querySelector('.player-bottom-area') : this.el.tableFelt;
    if (controls && controls.parentElement !== controlsParent) {
      if (gameState.mode === 'no_mercy') controlsParent.prepend(controls); else controlsParent.appendChild(controls);
    }
    let mercyStatus = document.getElementById('noMercyStatus');
    if (mercyStatus) mercyStatus.remove();

    // Dynamic Table Felt Colour
    const feltColor = (gameState.activeColor || '').toLowerCase();
    ['felt-red', 'felt-blue', 'felt-green', 'felt-yellow'].forEach(c => this.el.tableFelt?.classList.remove(c));
    if (['red', 'blue', 'green', 'yellow'].includes(feltColor)) {
      this.el.tableFelt?.classList.add(`felt-${feltColor}`);
    }
    // Action banner
    this.el.actionBanner.textContent = gameState.lastActionMessage || 'Game in progress';
    if (gameState.mode === 'classic') {
      let status = document.getElementById('classicTableStatus');
      if (!status) { status = document.createElement('div'); status.id = 'classicTableStatus'; status.setAttribute('role', 'status'); this.el.actionBanner.parentElement.appendChild(status); }
      const current = gameState.players[gameState.currentTurn];
      status.textContent = `Round ${gameState.roundNumber} · ${gameState.activeColor || 'Choose colour'} · ${isMyTurn ? (gameState.pendingAction?.type === 'draw4_challenge' ? 'Accept +4 or challenge' : 'Your turn') : current?.name + "'s turn"} · ${gameState.players.find(p => p.id === this.playerId)?.score || 0}/500`;
      status.style.setProperty('--active-colour', COLOR_METADATA[gameState.activeColor]?.bgHex || '#fff');
      this.el.actionBanner.setAttribute('role', 'status');
    }


    // Arena Table theme (Flip Light vs Dark)
    if (gameState.mode === 'flip' && gameState.flipSide === 'dark') {
      this.el.tableFelt.classList.add('dark-side');
    } else {
      this.el.tableFelt.classList.remove('dark-side');
    }

    // Direction & Animated Orbital Indicator
    const isClockwise = gameState.direction === 1;
    if (this.el.tableFelt) {
      this.el.tableFelt.classList.toggle('direction-clockwise', isClockwise);
      this.el.tableFelt.classList.toggle('direction-counter-clockwise', !isClockwise);
    }
    this.el.directionArrow.className = `direction-arrow ${!isClockwise ? 'counter-clockwise' : ''}`;
    this.el.directionArrow.textContent = isClockwise ? '↻' : '↺';
    this.el.directionText.textContent = isClockwise ? 'CLOCKWISE' : 'COUNTER-CLOCKWISE';

    // Opponents
    const opponents = gameState.players.filter((p) => p.id !== this.playerId);
    const avatarPalettes = ['#1e3a8a', '#065f46', '#78350f', '#831843', '#4c1d95'];
    this.el.opponentsRow.innerHTML = opponents
      .map((p, idx) => {
        const isCurrent = gameState.players[gameState.currentTurn]?.id === p.id;
        const unoActive = p.cardCount === 1;
        const avatarColor = avatarPalettes[idx % avatarPalettes.length];
        const canCatchThis = (this.clientView?.canCatchUnoTargets?.includes(p.id) || this.clientView?.canCatchUno === p.id) || (p.cardCount === 1 && !p.hasCalledUno && !p.isEliminated);

        const durationMs = gameState.turnDurationMs || 30000;
        const remainingMs = (gameState.turnDeadline && gameState.turnDeadline > Date.now()) ? Math.max(0, gameState.turnDeadline - Date.now()) : durationMs;
        const initialSec = Math.ceil(remainingMs / 1000);
        const initialFraction = Math.max(0, Math.min(1, remainingMs / durationMs));
        const initialOffset = (87.96 * (1 - initialFraction)).toFixed(2);

        const activeTimerHtml = (isCurrent && gameState.status === 'playing' && gameState.turnDeadline)
          ? `<div class="active-player-turn-timer active ${initialSec <= 7 ? 'critical' : (initialSec <= 15 ? 'warning' : '')}" aria-label="Turn timer">
               <svg class="mini-timer-ring" viewBox="0 0 34 34">
                 <circle class="mini-timer-bg" cx="17" cy="17" r="14"></circle>
                 <circle class="mini-timer-prog" cx="17" cy="17" r="14" stroke-dasharray="87.96" stroke-dashoffset="${initialOffset}"></circle>
               </svg>
               <span class="mini-timer-text">${initialSec}</span>
             </div>`
          : '';

        let disconnectBadge = '';
        if (!p.isConnected && p.disconnectedAt) {
          const elapsedSec = Math.floor((Date.now() - p.disconnectedAt) / 1000);
          const leftSec = Math.max(0, 60 - elapsedSec);
          disconnectBadge = `<span class="disconnect-countdown-badge" data-disconnected-at="${p.disconnectedAt}" title="Disconnect grace period">DISCONNECTED (${leftSec}s)</span>`;
        }

        let unoStatusHtml = '';
        if (unoActive && !p.isEliminated) {
          if (p.hasCalledUno) {
            unoStatusHtml = '<span class="uno-declared-badge" title="UNO Declared">UNO!</span>';
          } else if (canCatchThis && gameState.status === 'playing') {
            unoStatusHtml = `<button class="opponent-caught-btn" data-catch-target="${p.id}" type="button" title="Catch ${escapeHtml(p.name)}!">🚨 CATCH ${escapeHtml(p.name).toUpperCase()}!</button>`;
          } else {
            unoStatusHtml = '<span class="uno-alert-badge">1 CARD</span>';
          }
        }

        // Realistic fan of actual UNO card backs underneath the badge (Screenshot 2)
        let fanHtml = '';
        if (!p.isEliminated && p.cardCount > 0) {
          const fanCardsCount = Math.min(Math.max(p.cardCount, 1), 10);
          fanHtml = '<div class="opponent-cards-fan" aria-hidden="true">';
          const spread = fanCardsCount > 1 ? Math.min(30 / (fanCardsCount - 1), 5.5) : 0;
          const startAngle = -((fanCardsCount - 1) * spread) / 2;
          for (let c = 0; c < fanCardsCount; c++) {
            const rot = startAngle + c * spread;
            const xOffset = (c - (fanCardsCount - 1) / 2) * 17;
            fanHtml += `<div class="opponent-fan-card opponent-card-back" data-card-index="${c}" style="transform: translateX(${xOffset.toFixed(1)}px) rotate(${rot.toFixed(1)}deg); z-index: ${c + 1};">
              ${renderCardBackHTML(gameState.flipSide === 'dark', true, gameState.mode)}
            </div>`;
          }
          fanHtml += '</div>';
        }

        return `
          <div class="opponent-wrapper opponent-box" data-profile-id="${p.id}" data-player-id="${p.id}">
            <div class="opponent-card-badge ${isCurrent ? 'active-turn' : ''} ${p.isEliminated ? 'eliminated' : ''}">
              <div class="opponent-avatar" style="background: ${isCurrent ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : avatarColor};">
                ${p.isBot ? '🤖' : (gameState.mode === 'classic' ? this.classicAvatarHTML(p, isCurrent && gameState.status === 'playing' && !!gameState.turnDeadline) : escapeHtml(p.name.charAt(0).toUpperCase()))}
              </div>
              <div class="opponent-info">
                <div class="opponent-name">
                  ${escapeHtml(p.name)} ${p.isBot ? '<span class="mini-bot-tag" title="AI Bot">BOT</span>' : ''}
                </div>
                <div class="opponent-cards-count">
                  ${p.isEliminated ? 'KNOCKED OUT' : `${p.cardCount} card${p.cardCount === 1 ? '' : 's'}${gameState.mode === 'classic' ? ` · ${p.score || 0} pts` : ''}`}
                </div>
                ${disconnectBadge}
              </div>
              ${gameState.mode === 'no_mercy' ? unoStatusHtml : (unoActive && !p.isEliminated ? `<span class="uno-alert-badge">${gameState.mode !== 'classic' || p.hasCalledUno ? 'UNO!' : '1 CARD'}</span>` : '')}
              ${activeTimerHtml}
              ${gameState.mode === 'classic' && unoActive && p.hasCalledUno ? '<span class="classic-caught-failed" role="status">CAUGHT FAILED</span>' : ''}
            </div>
            ${fanHtml}
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
    this.el.drawCountBadge.textContent = `${gameState.deckRemainingCount} CARDS`;
    this.el.drawPileBtn.disabled = !canDraw || (gameState.mode === 'classic' && !!gameState.pendingAction);
    this.el.drawPileBtn.setAttribute('aria-label', 'Draw one card from the deck');

    if (gameState.mode === 'no_mercy') {
      if (gameState.turnDrawnPlayable || (!canDraw && isMyTurn && !gameState.pendingDrawPenalty)) {
        this.el.drawPileBtn.classList.add('draw-locked');
      } else {
        this.el.drawPileBtn.classList.remove('draw-locked');
      }
    } else {
      this.el.drawPileBtn.classList.remove('draw-locked');
    }

    // Stacking draw penalty badge on draw pile
    if (gameState.pendingDrawPenalty > 0) {
      if (this.el.drawPenaltyBadge) {
        this.el.drawPenaltyBadge.textContent = `+${gameState.pendingDrawPenalty}`;
        this.el.drawPenaltyBadge.style.display = 'block';
      }
      this.el.penaltyTag.style.display = 'block';
      this.el.penaltyTag.textContent = `+${gameState.pendingDrawPenalty} PENALTY!`;
    } else {
      if (this.el.drawPenaltyBadge) {
        this.el.drawPenaltyBadge.style.display = 'none';
      }
      this.el.penaltyTag.style.display = 'none';
    }

    // Buttons
    this.el.btnDrawAction.disabled = !canDraw;
    if (gameState.pendingDrawPenalty > 0) {
      this.el.btnDrawAction.innerHTML = `<span class="btn-icon">🂠</span> TAKE +${gameState.pendingDrawPenalty} CARDS`;
    } else {
      this.el.btnDrawAction.innerHTML = '<span class="btn-icon">🂠</span> DRAW CARD';
    }

    if (gameState.mode === 'no_mercy' && !gameState.pendingDrawPenalty) this.el.btnDrawAction.textContent = 'DRAW TO PLAY';
    // Pass button (visible if drawn this turn and eligible to pass)
    const canPass = Boolean(this.clientView?.canPass ?? (gameState.turnDrawnCard && isMyTurn && !gameState.pendingDrawPenalty));
    if (canPass) {
      this.el.btnPassAction.style.display = 'inline-flex';
    } else {
      this.el.btnPassAction.style.display = 'none';
    }

    // UNO and Catch buttons
    this.el.btnUnoAction.disabled = !canCallUno;
    this.el.btnUnoAction.innerHTML = '<span class="btn-icon">📢</span> CALL UNO!';
    if (canCatchUno) {
      const caughtPlayer = gameState.players.find((p) => p.id === canCatchUno);
      this.el.btnCatchAction.style.display = 'inline-flex';
      this.el.btnCatchAction.textContent = gameState.mode !== 'flip' ? 'CAUGHT' : `CATCH ${caughtPlayer?.name?.toUpperCase()} (MISSED UNO)!`;
      this.el.btnCatchAction.setAttribute('aria-label', `Catch ${caughtPlayer?.name} for missed UNO`);
    } else {
      this.el.btnCatchAction.style.display = 'none';
    }

    if (gameState.mode === 'classic') {
      let challenge = document.getElementById('classicChallenge');
      if (!challenge) { challenge = document.createElement('button'); challenge.id = 'classicChallenge'; challenge.className = 'action-btn btn-challenge'; challenge.type = 'button'; this.el.btnDrawAction.parentElement.insertBefore(challenge, this.el.btnUnoAction); }
      const pending = gameState.pendingAction;
      challenge.hidden = !(isMyTurn && pending?.type === 'draw4_challenge');
      challenge.textContent = 'Challenge Draw Four';
      if (isMyTurn && pending?.type === 'draw4_challenge') this.el.btnDrawAction.textContent = 'Accept +4';
      challenge.onclick = () => { if (this.isMoveInFlight) return; this.isMoveInFlight = true; this.send({ type: 'challenge_draw4' }); };
      let accept = document.getElementById('classicAcceptDrawFour');
      if (!accept) { accept = document.createElement('button'); accept.id = 'classicAcceptDrawFour'; accept.className = 'action-btn btn-draw'; accept.textContent = 'ACCEPT +4'; challenge.before(accept); }
      accept.hidden = challenge.hidden;
      accept.onclick = () => { if (this.isMoveInFlight) return; this.isMoveInFlight = true; this.send({ type: 'draw_card' }); };
      this.renderClassicLocalProfile();
      this.updateTurnTimer(gameState.turnDeadline, isMyTurn, gameState.status);
      if (isMyTurn && pending?.type === 'opening_color' && !this.el.colorPickerModal.classList.contains('active')) this.openColorPicker();
    }
    if (gameState.mode !== 'classic') {
      if (this.el.btnUnoAction.parentElement.id === 'classicLocalControls') this.el.btnDrawAction.parentElement.appendChild(this.el.btnUnoAction);
      this.el.btnUnoAction.style.display = '';
    }
    // Render Local Player Profile Bar in No Mercy and Flip
    const me = gameState.players.find(p => p.id === this.playerId);
    if (this.el.localPlayerProfile) {
      if ((gameState.mode === 'no_mercy' || gameState.mode === 'flip') && gameState.status === 'playing') {
        this.el.localPlayerProfile.style.display = 'flex';
        this.el.localPlayerProfile.classList.toggle('active-turn', isMyTurn);
        const durationMs = gameState.turnDurationMs || 30000;
        const remainingMs = (gameState.turnDeadline && gameState.turnDeadline > Date.now()) ? Math.max(0, gameState.turnDeadline - Date.now()) : durationMs;
        const initialSec = Math.ceil(remainingMs / 1000);
        const initialFraction = Math.max(0, Math.min(1, remainingMs / durationMs));
        const initialOffset = (87.96 * (1 - initialFraction)).toFixed(2);

        const localTimerHtml = (isMyTurn && gameState.turnDeadline)
          ? `<div class="active-player-turn-timer active ${initialSec <= 7 ? 'critical' : (initialSec <= 15 ? 'warning' : '')}" aria-label="Turn timer">
               <svg class="mini-timer-ring" viewBox="0 0 34 34">
                 <circle class="mini-timer-bg" cx="17" cy="17" r="14"></circle>
                 <circle class="mini-timer-prog" cx="17" cy="17" r="14" stroke-dasharray="87.96" stroke-dashoffset="${initialOffset}"></circle>
               </svg>
               <span class="mini-timer-text">${initialSec}</span>
             </div>`
          : '';
        const localUnoDeclaredHtml = (myHand.length === 1 && (me?.hasCalledUno || this.isUnoArmed))
          ? '<span class="uno-declared-badge" style="margin-left: 8px;">✓ UNO DECLARED</span>'
          : '';

        this.el.localPlayerProfile.innerHTML = `
          <div class="local-profile-left">
            <div class="local-avatar">${escapeHtml(me?.name?.charAt(0)?.toUpperCase() || 'P')}</div>
            <div class="local-info">
              <div class="local-name">${escapeHtml(me?.name || 'Player')}</div>
              <div class="local-cards-count">${myHand.length} card${myHand.length === 1 ? '' : 's'}</div>
            </div>
          </div>
          ${localUnoDeclaredHtml}
          ${localTimerHtml}
        `;
      } else {
        this.el.localPlayerProfile.style.display = 'none';
      }
    }

    // Contextual Call UNO Button: displayed ONLY when hand has exactly 2 cards
    if (this.el.contextualUnoContainer && this.el.btnCallUnoContextual) {
      if (gameState.mode === 'no_mercy' && myHand.length === 2 && gameState.status === 'playing') {
        this.el.contextualUnoContainer.style.display = 'flex';
        const isArmed = this.isUnoArmed || me?.isUnoArmed || (me?.hasCalledUno && myHand.length === 2);
        if (isArmed) {
          this.el.btnCallUnoContextual.classList.add('uno-armed');
          this.el.btnCallUnoContextual.innerHTML = '<span class="btn-icon">✓</span> UNO ARMED!';
        } else {
          this.el.btnCallUnoContextual.classList.remove('uno-armed');
          this.el.btnCallUnoContextual.innerHTML = '<span class="btn-icon">📢</span> CALL UNO!';
        }
      } else {
        this.el.contextualUnoContainer.style.display = 'none';
        if (myHand.length !== 2) {
          this.isUnoArmed = false;
        }
      }
    }

    // Synchronized Turn Timer (invoked after all DOM elements are mounted)
    if (gameState.mode !== 'classic') {
      this.updateTurnTimer(gameState.turnDeadline, isMyTurn, gameState.status);
    }

    // Player Hand Cards
    this.renderPlayerHand(myHand, canPlayCards, gameState.mode, gameState.flipSide);

    // Game Over Check
    if (gameState.status === 'game_over' || gameState.status === 'round_over') {
      this.showGameOver(gameState);
    }
  }

  renderPlayerHand(hand, canPlayIds, mode, flipSide) {
    const container = this.el.playerHandCards;
    container.innerHTML = '';

    const count = hand.length;
    if (count === 0) return;

    const isMobile = window.innerWidth <= 760;
    // On mobile, if > 7 cards, use two compact rows. On desktop, if > 14 cards, use two rows.
    const useTwoRows = isMobile ? count > 7 : count > 14;
    container.classList.toggle('two-rows', useTwoRows);

    if (useTwoRows) {
      const row1Count = Math.ceil(count / 2);
      const row1Cards = hand.slice(0, row1Count);
      const row2Cards = hand.slice(row1Count);

      const row1El = document.createElement('div');
      row1El.className = 'hand-row hand-row-top';
      const row2El = document.createElement('div');
      row2El.className = 'hand-row hand-row-bottom';

      this.populateHandRow(row1El, row1Cards, 0, canPlayIds, mode, flipSide, isMobile);
      this.populateHandRow(row2El, row2Cards, row1Count, canPlayIds, mode, flipSide, isMobile);

      container.appendChild(row1El);
      container.appendChild(row2El);
    } else {
      const rowEl = document.createElement('div');
      rowEl.className = 'hand-row hand-row-single';
      this.populateHandRow(rowEl, hand, 0, canPlayIds, mode, flipSide, isMobile);
      container.appendChild(rowEl);
    }
  }

  populateHandRow(rowEl, rowCards, startIndex, canPlayIds, mode, flipSide, isMobile) {
    const rowCount = rowCards.length;
    const maxCardW = isMobile ? Math.min(54, Math.max(46, Math.round(window.innerWidth * 0.125))) : 86;
    const parentContainer = this.el.playerHandCards.parentElement;
    const containerW = (parentContainer && parentContainer.clientWidth) || this.el.playerHandCards.clientWidth || (isMobile ? window.innerWidth - 24 : window.innerWidth);
    const availableW = Math.max(160, Math.min(containerW - (isMobile ? 26 : 14), isMobile ? (window.innerWidth - 36) : 860));

    const naturalTotal = rowCount * maxCardW;
    const needsOverlap = naturalTotal > availableW && rowCount > 1;
    const overlapMargin = needsOverlap
      ? -Math.min(maxCardW - 14, Math.ceil((naturalTotal - availableW) / (rowCount - 1)))
      : (rowCount > 7 ? -8 : 4);

    const maxAngle = Math.min(rowCount * 1.4, 9);
    const startAngle = rowCount > 1 ? -maxAngle / 2 : 0;
    const angleStep = rowCount > 1 ? maxAngle / (rowCount - 1) : 0;

    rowCards.forEach((card, idx) => {
      const globalIdx = startIndex + idx;
      const isPlayable = canPlayIds.includes(card.id);
      const isSelected = this.selectedCardId === card.id;

      const wrapper = document.createElement('div');
      wrapper.className = `card-wrapper ${isPlayable ? 'playable' : 'unplayable'} ${isSelected ? 'is-selected' : ''}`;
      wrapper.style.zIndex = isSelected ? 200 : (idx + 1);
      if (idx > 0) {
        wrapper.style.marginLeft = `${overlapMargin}px`;
      }
      wrapper.setAttribute('role', isPlayable ? 'button' : 'img');
      wrapper.setAttribute('tabindex', isPlayable ? '0' : '-1');
      wrapper.dataset.cardId = card.id;

      const cardTitle = card.type === 'number' ? `${card.color || ''} ${card.value}` : `${card.color || ''} ${card.type}`;
      wrapper.setAttribute('aria-label', isPlayable ? `Play card: ${cardTitle}` : `Card: ${cardTitle}`);
      wrapper.innerHTML = renderCardHTML(card, { mode, flipSide });

      const rot = rowCount > 1 ? (startAngle + idx * angleStep).toFixed(1) : '0';
      wrapper.style.setProperty('--card-rot', `${rot}deg`);
      if (!isSelected) {
        wrapper.style.transform = `rotate(${rot}deg)`;
      }

      wrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        if (wrapper._suppressClick) { wrapper._suppressClick = false; return; }
        this.onCardInteraction(card, wrapper, isPlayable);
      });
      wrapper.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.onCardInteraction(card, wrapper, isPlayable);
        }
      });
      wrapper.addEventListener('mouseenter', () => {
        if (this.clientView?.isMyTurn) {
          this.send({ type: 'player_card_hovered', data: { cardIndex: globalIdx } });
        }
      });
      wrapper.addEventListener('mouseleave', () => {
        if (this.clientView?.isMyTurn) {
          this.send({ type: 'player_card_hovered', data: { cardIndex: null } });
        }
      });

      if (mode !== 'flip') this.bindCardPointer(wrapper, card, isPlayable);
      rowEl.appendChild(wrapper);
    });
  }

  bindCardPointer(wrapper, card, playable) {
    let drag = null;
    const cleanup = () => {
      if (!drag) return;
      cancelAnimationFrame(drag.frame);
      drag.ghost?.remove();
      this.el.discardPile.classList.remove('valid-drop');
      if (wrapper.hasPointerCapture(drag.id)) wrapper.releasePointerCapture(drag.id);
      drag = null;
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
    };
    wrapper.addEventListener('pointerdown', e => {
      if (!playable || this.ws?.readyState !== WebSocket.OPEN || !this.clientView?.isMyTurn || this.isMoveInFlight || e.button !== 0) return;
      this.cancelCardDrag?.();
      e.preventDefault();
      this.cancelCardDrag = cleanup;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, rect: wrapper.getBoundingClientRect(), target: this.el.discardPile.getBoundingClientRect() };
      wrapper.setPointerCapture(e.pointerId);
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', up, true);
    });
    const move = e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.ghost && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 7) return;
      if (!drag.ghost) {
        drag.ghost = wrapper.cloneNode(true);
        drag.ghost.className = 'classic-drag-ghost';
        drag.ghost.setAttribute('aria-hidden', 'true');
        drag.ghost.removeAttribute('tabindex');
        Object.assign(drag.ghost.style, { width: `${drag.rect.width}px`, height: `${drag.rect.height}px`, left: `${drag.rect.left}px`, top: `${drag.rect.top}px` });
        document.body.appendChild(drag.ghost);
      }
      drag.dx = e.clientX - drag.x; drag.dy = e.clientY - drag.y;
      drag.over = e.clientX >= drag.target.left - 20 && e.clientX <= drag.target.right + 20 && e.clientY >= drag.target.top - 20 && e.clientY <= drag.target.bottom + 20;
      this.el.discardPile.classList.toggle('valid-drop', drag.over);
      if (!drag.frame) drag.frame = requestAnimationFrame(() => {
        if (drag?.ghost) { drag.ghost.style.transform = `translate3d(${drag.dx}px,${drag.dy}px,0) scale(1.08)`; drag.frame = null; }
      });
    };
    const up = e => {
      if (!drag || drag.id !== e.pointerId) return;
      const moved = !!drag.ghost, accepted = drag.over, ghost = drag.ghost;
      cleanup();
      if (moved && !accepted && ghost && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        ghost.classList.add('classic-returning-card'); document.body.appendChild(ghost);
        const animation = ghost.animate([{ transform: ghost.style.transform }, { transform: 'none', opacity: .4 }], { duration: 160, easing: 'ease-out' });
        animation.onfinish = () => ghost.remove();
      }
      if (moved) { wrapper._suppressClick = true; if (accepted && wrapper.isConnected) this.handleCardClick(card, wrapper); else wrapper.animate([{ opacity: .45 }, { opacity: 1 }], { duration: 180 }); }
    };
    wrapper.addEventListener('pointercancel', cleanup);
    wrapper.addEventListener('lostpointercapture', cleanup);
  }

  onCardInteraction(card, wrapperEl, isPlayable) {
    if (this.gameState.mode !== 'flip') {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      if (isPlayable && this.clientView?.isMyTurn && !this.isMoveInFlight) this.handleCardClick(card, wrapperEl);
      return;
    }
    if (this.selectedCardId === card.id) {
      // Second tap on selected card -> play it!
      if (isPlayable && !this.isMoveInFlight) {
        this.handleCardClick(card, wrapperEl);
      }
    } else {
      // First tap -> select it with golden highlight and raise it
      this.selectedCardId = card.id;
      document.querySelectorAll('#playerHandCards .card-wrapper.is-selected').forEach((el) => {
        el.classList.remove('is-selected');
        el.style.zIndex = '';
        el.style.transform = `rotate(${el.style.getPropertyValue('--card-rot') || '0deg'})`;
      });
      wrapperEl.classList.add('is-selected');
      wrapperEl.style.zIndex = '200';
      wrapperEl.style.transform = 'translateY(-18px) scale(1.08)';

      // On desktop fine pointer, allow single-click play if desired
      if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && isPlayable && !this.isMoveInFlight) {
        this.handleCardClick(card, wrapperEl);
      }
    }
  }

  updateTurnTimer(deadline, isMyTurn, status) {
    this.activeTurnDeadline = deadline;
    this.activeTurnStatus = status;
    this.activeTurnIsMyTurn = Boolean(isMyTurn);

    const tick = () => {
      if (this.activeTurnStatus !== 'playing' || !this.activeTurnDeadline) {
        if (this.turnTimerInterval) {
          clearInterval(this.turnTimerInterval);
          this.turnTimerInterval = null;
        }
        return;
      }

      const now = Date.now();
      const durationMs = this.gameState?.turnDurationMs || 30000;
      const remainingMs = Math.max(0, this.activeTurnDeadline - now);
      const remainingSec = Math.ceil(remainingMs / 1000);

      const miniTimers = document.querySelectorAll('.active-player-turn-timer');
      const miniCircumference = 87.96;
      const fraction = Math.max(0, Math.min(1, remainingMs / durationMs));
      const offset = (miniCircumference * (1 - fraction)).toFixed(2);

      miniTimers.forEach(timer => {
        const txt = timer.querySelector('.mini-timer-text');
        const prog = timer.querySelector('.mini-timer-prog');
        if (txt) txt.textContent = String(remainingSec);
        if (prog) prog.style.strokeDashoffset = offset;
        timer.classList.toggle('warning', remainingSec <= 15 && remainingSec > 7);
        timer.classList.toggle('critical', remainingSec <= 7);
      });

      // Update disconnect badges live
      document.querySelectorAll('.disconnect-countdown-badge').forEach(badge => {
        const discAt = Number(badge.dataset.disconnectedAt);
        if (discAt) {
          const leftSec = Math.max(0, 60 - Math.floor((now - discAt) / 1000));
          badge.textContent = `DISCONNECTED (${leftSec}s)`;
        }
      });

      if (this.gameState?.mode === 'classic') {
        if (this.el.turnTimerContainer) this.el.turnTimerContainer.style.display = 'none';
        const ring = document.querySelector('.classic-profile-ring');
        if (ring) {
          const circle = ring.querySelector('circle');
          const seconds = ring.parentElement?.querySelector('.classic-profile-seconds');
          if (circle) circle.style.strokeDashoffset = String(138.23 * (1 - Math.min(1, remainingMs / durationMs)));
          if (seconds) seconds.textContent = `${remainingSec}s`;
          ring.classList.toggle('timer-critical', remainingMs <= 7000);
        }
        return;
      }

      if (this.gameState?.mode === 'no_mercy') {
        if (this.el.turnTimerContainer) this.el.turnTimerContainer.style.display = 'none';
        return;
      }

      const container = this.el.turnTimerContainer;
      const progressRing = this.el.timerRingProgress;
      const secondsEl = this.el.turnTimerSeconds;

      if (!container || !progressRing || !secondsEl) return;
      container.style.display = 'flex';
      container.classList.toggle('my-turn', this.activeTurnIsMyTurn);
      secondsEl.textContent = String(remainingSec);
      const ringOffset = (138.23 * (1 - fraction)).toFixed(2);
      progressRing.style.strokeDashoffset = ringOffset;

      container.classList.remove('timer-normal', 'timer-warning', 'timer-critical', 'timer-expired');
      if (remainingSec > 15) container.classList.add('timer-normal');
      else if (remainingSec > 7) container.classList.add('timer-warning');
      else if (remainingSec > 0) container.classList.add('timer-critical');
      else container.classList.add('timer-expired');
    };

    tick();

    if (status === 'playing' && deadline > Date.now()) {
      if (!this.turnTimerInterval) {
        this.turnTimerInterval = setInterval(tick, 100);
      }
    } else {
      if (this.turnTimerInterval) {
        clearInterval(this.turnTimerInterval);
        this.turnTimerInterval = null;
      }
    }
  }

  handleCardClick(card, wrapperEl) {
    if (this.isMoveInFlight) return;

    const face = card.color ? card : (this.gameState.flipSide === 'dark' ? card.dark : card.light);

    // Wild Card -> Prompt Color Picker
    if (face.color === 'wild' && !(this.gameState.mode === 'no_mercy' && face.type === 'wild_color_roulette')) {
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

    if (wrapperEl && this.gameState.mode === 'flip') {
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
          <button class="color-option-btn color-choice-${c}" data-color="${c}" type="button" aria-label="${meta.name}">
            <span class="color-choice-symbol" aria-hidden="true">${meta.symbol}</span>
            <span class="color-choice-name">${meta.name.toUpperCase()}</span>
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

        const currentBtn = e.currentTarget;
        currentBtn.classList.add('is-selected');

        if (this.pendingPlayWrapper && this.gameState.mode === 'flip') {
          this.pendingPlayWrapper.classList.add('playing');
        }

        const chosenColor = currentBtn.dataset.color;
        sounds.playSnap(520, 0.1);

        setTimeout(() => {
          this.el.colorPickerModal.classList.remove('active');
          this.send({
            type: ['opening_color', 'color_roulette'].includes(this.gameState.pendingAction?.type) ? 'choose_color' : 'play_card',
            data: {
              cardId: this.pendingPlayCard?.id,
              chosenColor,
            },
          });
          this.pendingPlayCard = null;
          this.pendingPlayWrapper = null;
        }, 120);
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

        if (this.pendingPlayWrapper && this.gameState.mode === 'flip') {
          this.pendingPlayWrapper.classList.add('playing');
        }

        const targetPlayerId = e.currentTarget.dataset.playerId;
        this.el.swapPickerModal.classList.remove('active');
        sounds.playSnap(400, 0.1);
        this.send({
          type: 'play_card',
          data: {
            cardId: this.pendingPlayCard?.id,
            targetPlayerId,
          },
        });
        this.pendingPlayCard = null;
        this.pendingPlayWrapper = null;
      });
    });

    this.el.swapPickerModal.classList.add('active');
  }

  showCaughtFailedModal(data) {
    const modal = this.el.caughtFailedModal || document.getElementById('caughtFailedModal');
    const msgEl = this.el.caughtFailedMsg || document.getElementById('caughtFailedMsg');
    if (!modal || !msgEl) return;

    const targetName = data?.targetName || 'Player';
    let messageText = `${targetName} already called UNO.`;
    if (data?.message) {
      if (data.message.includes('already called UNO')) {
        messageText = `${targetName} already called UNO.`;
      } else if (data.message.includes('closed') || data.message.includes('expired')) {
        messageText = 'The UNO catch window has closed.';
      } else if (data.message.includes('no longer has one card')) {
        messageText = `${targetName} no longer has one card.`;
      } else {
        messageText = data.message.replace(/^CAUGHT FAILED:\s*/i, '');
      }
    }
    msgEl.textContent = messageText;
    modal.style.display = 'flex';
    modal.classList.add('active');

    if (this.caughtFailedTimer) clearTimeout(this.caughtFailedTimer);
    this.caughtFailedTimer = setTimeout(() => {
      modal.classList.remove('active');
      modal.style.display = 'none';
      this.caughtFailedTimer = null;
    }, 2400);
  }

  showGameOver(gameState) {
    const currentMatchKey = gameState.matchId || `${this.roomId || ''}_${gameState.roundNumber || 0}`;
    if (this.dismissedGameOverMatchId && this.dismissedGameOverMatchId === currentMatchKey) {
      if (this.el.btnViewVictory) this.el.btnViewVictory.style.display = 'inline-flex';
      return;
    }

    const winner = gameState.players.find((p) => p.id === gameState.winnerId);
    if (this.el.victoryWinsBadge) {
      if (gameState.status === 'round_over') {
        this.el.winnerNameText.textContent = winner?.name || 'Player';
        this.el.victoryWinsBadge.textContent = 'ROUND WON!';
      } else if (winner) {
        this.el.winnerNameText.textContent = winner.name;
        this.el.victoryWinsBadge.textContent = 'WINS!';
      } else {
        this.el.winnerNameText.textContent = 'GAME OVER';
        this.el.victoryWinsBadge.textContent = '';
      }
    } else {
      this.el.winnerNameText.textContent = winner ? `${winner.name} WINS!` : 'GAME OVER!';
      if (gameState.status === 'round_over') this.el.winnerNameText.textContent = `${winner?.name || 'Player'} wins the round`;
    }

    this.el.winReasonText.textContent = (gameState.winReason || 'All cards played!') + (gameState.mode === 'classic' ? ' Scores: ' + gameState.players.map(p => `${p.name}: ${p.score}`).join(' · ') : '');
    this.el.rematchBtn.textContent = gameState.status === 'round_over' ? 'Next round' : 'REQUEST REMATCH';

    const me = gameState.players.find((p) => p.id === this.playerId);
    this.el.rematchBtn.style.display = (gameState.status === 'round_over' ? me?.isHost : this.clientView.canProposeRematch) ? 'block' : 'none';

    if (this.el.btnViewVictory) this.el.btnViewVictory.style.display = 'none';
    if (!this.el.gameOverModal.classList.contains('active')) sounds.playVictory();
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
    this.clearClassicAnimations();
    this.cancelCardDrag?.();
    this.send({ type: 'leave' });
    this.roomId = null;
    this.playerId = null;
    this.sessionToken = null;
    if (this.turnTimerInterval) {
      clearInterval(this.turnTimerInterval);
      this.turnTimerInterval = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
    }
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
