import {initPlayerHUD} from './player-hud.js';
import {initArenaMenu} from './arena-menu.js';
import {initPerformance} from './performance.js';
import {beginLocalPlay,cancelLocalPlay,reconcileLocalPlay,syncLocalPlayTarget} from './local-play-feedback.js';
import {syncDrawFourDecision} from './draw-four-decision.js';
import {initPlayMotion,syncPlayDirection} from './play-motion.js';
import {prepareCardArt,gateCardArt,clearCardArtGate} from './card-atlas.js';
import {syncRoundSeating} from './round-seating.js';
import {initTableTools,syncTableTools,sortedHand,warnTurn} from './table-tools.js';
import { initSocial, syncSocial, syncRulePresets, stopSocial, onPong } from './social-features.js';
import { setActionVisible, setGameModal, jumpControl, exitControl, clearInteractionMotion } from './interaction-motion.js';
import { music } from './music.js';
import { updateTurnStatus, renderMatchStandings, playPowerSound } from './game-experience.js';
import { initFriendWordmark } from './friend-wordmark.js';
import { animatePowerCard } from './power-effects.js';
import { playNoMercyEntrance, preloadNoMercyEntrance, playFlipEntrance, preloadFlipEntrance, playClassicEntrance, preloadClassicEntrance } from './mode-entrance.js';
import { initBackNavigation } from './navigation.js';
import { CLASSIC_COLORS, FLIP_DARK_COLORS, COLOR_METADATA } from '../shared/constants.js';
import { defaultHouseRules } from '../shared/rules.js';
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
    this.roomEntryFlow = null;
    this.selectedSetupMode = null;
    this.mercyKnockoutLimit = Number(localStorage.getItem('uno_arena_mercy_limit')) || 25;
    this.gameState = null;
    this.clientView = null;
    this.pendingPlayCard = null; // Card awaiting color or target selection

    this.customHouseRules = {
      classic: defaultHouseRules('classic'),
      flip: defaultHouseRules('flip'),
      no_mercy: defaultHouseRules('no_mercy'),
    };
    this.activeRulesModalMode = 'classic';
    this.rulesModalContext = 'lobby'; // 'ai', 'lobby', 'arena'

    this.aiSetup = {
      mode: null,
      totalPlayers: null,
      selectedBots: [],
    };
    this.handCardElements = new Map();
    this.opponentElements = new Map();
    this.inFlightCardId = null;
    this.lastRenderedDiscardKey = null;
    this.lastRenderedDrawKey = null;
    this.quickMatchTimerInterval = null;
    this.quickMatchStartMs = 0;
    this.playerAvatar = localStorage.getItem('uno_arena_avatar') || 'fox';
    const savedVol = localStorage.getItem('uno_arena_volume');
    if (savedVol !== null && !isNaN(Number(savedVol))) {
      sounds.setVolume(Number(savedVol));
    }
    if (localStorage.getItem('uno_arena_reduced_motion') === 'true') {
      document.body.classList.add('reduced-motion');
    }

    prepareCardArt(this.preferredMode).catch(()=>{});
    // Entrance artwork loads on demand for the mode the player opens.
    this.initElements();
    initSocial(this);
    initTableTools(this);
    initArenaMenu(this);
    initPlayerHUD(this);
    initPlayMotion(this);
    initPerformance(this);
    this.playTurnWarning=frequency=>sounds.playSnap(frequency,.06);
    music.init();
    window.addEventListener('online',()=>{
      if(this.roomId && this.ws?.readyState!==WebSocket.OPEN){
        clearTimeout(this.reconnectTimeout);
        this.connectWebSocket(this.roomId,this.playerId,this.sessionToken,this.playerName);
      }
    });
    window.addEventListener('offline',()=>{
      if(this.roomId){this.connectionRecovering=true;this.el.banner.textContent='You’re offline · reconnecting when your network returns';this.el.banner.classList.add('visible');this.el.playerHandCards.setAttribute('inert','');this.ws?.close();}
    });
    initFriendWordmark();
    this.initEvents();
    this.initDialogAccessibility();
    this.initPWA();
    initBackNavigation(this);
    this.checkUrlForRoomCode();
  }

  initPWA() {
    // Proactively purge legacy v1 cache from client window
    if (typeof window !== 'undefined' && 'caches' in window) {
      window.caches.keys().then((keys) => {
        keys.forEach((k) => {
          if (k !== 'uno-arena-v2.2.0') {
            window.caches.delete(k).catch(() => {});
          }
        });
      }).catch(() => {});
    }

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then((reg) => {
            console.log('[PWA] Service Worker registered:', reg.scope);
            reg.update().catch(() => {});
            reg.addEventListener('updatefound', () => {
              const newWorker = reg.installing;
              if (newWorker) {
                newWorker.addEventListener('statechange', () => {
                  if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    newWorker.postMessage({ type: 'SKIP_WAITING' });
                  }
                });
              }
            });
          })
          .catch((err) => console.warn('[PWA] Service Worker registration notice:', err));
      });

      let isInitialController = !navigator.serviceWorker.controller;
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (isInitialController) {
          isInitialController = false;
          return;
        }
        if (!refreshing && (!this.gameState || this.gameState.status === 'idle')) {
          refreshing = true;
          window.location.reload();
        }
      });
    }
  }

  initElements() {
    this.el = {
      banner: document.getElementById('connectionBanner'),
      navRoomDetails: document.getElementById('navRoomDetails'),
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
      genericLobbySlot: document.getElementById('genericLobbySlot'),
      noMercyLobbySlot: document.getElementById('noMercyLobbySlot'),
      flipLobbySlot: document.getElementById('flipLobbySlot'),
      classicLobbySlot: document.getElementById('classicLobbySlot'),
      modeLobbyHeader: document.getElementById('modeLobbyHeader'),
      modeLobbyBadge: document.getElementById('modeLobbyBadge'),
      modeLobbyCenterLogo: document.getElementById('modeLobbyCenterLogo'),
      modeLobbyFullscreenBtn: document.getElementById('modeLobbyFullscreenBtn'),
      modeLobbySettingsBtn: document.getElementById('modeLobbySettingsBtn'),
      modeLobbyLeaveBtn: document.getElementById('modeLobbyLeaveBtn'),
      lobbySection: document.getElementById('lobbySection'),
      lobbyCodeBadge: document.getElementById('lobbyCodeBadge'),
      lobbyCodeText: document.getElementById('lobbyCodeText'),
      copyInviteBtn: document.getElementById('copyInviteBtn'),
      lobbyModeSelectContainer: document.getElementById('lobbyModeSelectContainer'),
      lobbyModeSelectHeading: document.getElementById('lobbyModeSelectHeading'),
      modeSelectorGrid: document.getElementById('modeSelectorGrid'),
      lobbyModeDisplay: document.getElementById('lobbyModeDisplay'),
      lobbyPlayersHeading: document.getElementById('lobbyPlayersHeading'),
      lobbyRulesPanel: document.getElementById('lobbyRulesPanel'),
      lobbyPlayersList: document.getElementById('lobbyPlayersList'),
      readyBtn: document.getElementById('readyBtn'),
      startGameBtn: document.getElementById('startGameBtn'),
      addBotBtn: document.getElementById('addBotBtn'),
      shuffleSeatsBtn: document.getElementById('shuffleSeatsBtn'),
      homePlaybox: document.getElementById('homePlaybox'),
      mobileFormWrap: document.getElementById('mobileFormWrap'),
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
      colorPickerCardFan: document.getElementById('colorPickerCardFan'),
      colorOptionsContainer: document.getElementById('colorOptionsContainer'),
      rouletteModal: document.getElementById('rouletteModal'),
      rouletteCardFan: document.getElementById('rouletteCardFan'),
      rouletteSubtitle: document.getElementById('rouletteSubtitle'),
      rouletteWheelFrame: document.getElementById('rouletteWheelFrame'),
      rouletteWheelSvg: document.getElementById('rouletteWheelSvg'),
      rouletteActionBtn: document.getElementById('rouletteActionBtn'),
      rouletteSpinnerIcon: document.getElementById('rouletteSpinnerIcon'),
      rouletteStatusText: document.getElementById('rouletteStatusText'),
      swapPickerModal: document.getElementById('swapPickerModal'),
      swapOptionsContainer: document.getElementById('swapOptionsContainer'),
      aiSetupModal: document.getElementById('aiSetupModal'),
      aiSetupCloseBtn: document.getElementById('aiSetupCloseBtn'),
      aiSetupCancelBtn: document.getElementById('aiSetupCancelBtn'),
      aiSetupStartBtn: document.getElementById('aiSetupStartBtn'),
      aiModeGrid: document.getElementById('aiModeGrid'),
      aiPlayerCountPills: document.getElementById('aiPlayerCountPills'),
      aiBotsGrid: document.getElementById('aiBotsGrid'),
      summaryModeVal: document.getElementById('summaryModeVal'),
      summaryPlayersVal: document.getElementById('summaryPlayersVal'),
      summaryBotsVal: document.getElementById('summaryBotsVal'),
      aiBotSelectionHint: document.getElementById('aiBotSelectionHint'),
      aiSetupValidationMsg: document.getElementById('aiSetupValidationMsg'),
      gameOverModal: document.getElementById('gameOverModal'),
      gameOverCloseBtn: document.getElementById('gameOverCloseBtn'),
      winnerNameText: document.getElementById('winnerNameText'),
      victoryWinsBadge: document.getElementById('victoryWinsBadge'),
      winReasonText: document.getElementById('winReasonText'),
      rematchBtn: document.getElementById('rematchBtn'),
      btnViewVictory: document.getElementById('btnViewVictory'),
      rulesModal: document.getElementById('rulesModal'),
      rulesModalClose: document.getElementById('rulesModalClose'),

      // Fullscreen controls
      fullscreenToggleBtn: document.getElementById('fullscreenToggleBtn'),
      fullscreenIcon: document.getElementById('fullscreenIcon'),
      mobileNavFullscreenBtn: document.getElementById('mobileNavFullscreenBtn'),
      arenaFullscreenBtn: document.getElementById('arenaFullscreenBtn'),

      // Quick Match controls & modal
      quickMatchBtn: document.getElementById('quickMatchBtn'),
      mobileQuickMatchBtn: document.getElementById('mobileQuickMatchBtn'),
      quickMatchModal: document.getElementById('quickMatchModal'),
      quickMatchModeBadge: document.getElementById('quickMatchModeBadge'),
      quickMatchTimer: document.getElementById('quickMatchTimer'),
      cancelQuickMatchBtn: document.getElementById('cancelQuickMatchBtn'),

      // Game Rules Settings Modal & Controls
      gameRulesModal: document.getElementById('gameRulesModal'),
      gameRulesModalClose: document.getElementById('gameRulesModalClose'),
      gameRulesModeTabs: document.getElementById('gameRulesModeTabs'),
      gameRulesModeBadge: document.getElementById('gameRulesModeBadge'),
      gameRulesTypeBadge: document.getElementById('gameRulesTypeBadge'),
      rulesLockedBanner: document.getElementById('rulesLockedBanner'),
      rulesGuestBanner: document.getElementById('rulesGuestBanner'),
      rulesModeSpecificGroup: document.getElementById('rulesModeSpecificGroup'),
      rulesModeSpecificHeading: document.getElementById('rulesModeSpecificHeading'),

      // Rule Inputs
      ruleMissedUnoPenalty: document.getElementById('ruleMissedUnoPenalty'),
      ruleStartingHandSize: document.getElementById('ruleStartingHandSize'),
      ruleTurnDuration: document.getElementById('ruleTurnDuration'),
      ruleClassicStacking: document.getElementById('ruleClassicStacking'),
      ruleClassicDrawBehavior: document.getElementById('ruleClassicDrawBehavior'),
      ruleClassicSevenZero: document.getElementById('ruleClassicSevenZero'),
      ruleClassicWd4Challenge: document.getElementById('ruleClassicWd4Challenge'),
      ruleFlipStacking: document.getElementById('ruleFlipStacking'),
      ruleFlipDrawBehavior: document.getElementById('ruleFlipDrawBehavior'),
      ruleNmStacking: document.getElementById('ruleNmStacking'),
      ruleNmDrawBehavior: document.getElementById('ruleNmDrawBehavior'),
      ruleNmSevenZero: document.getElementById('ruleNmSevenZero'),
      ruleNmKnockout: document.getElementById('ruleNmKnockout'),
      ruleNmKnockoutLimit: document.getElementById('ruleNmKnockoutLimit'),

      // Modal Footer Buttons
      ruleRestoreDefaultsBtn: document.getElementById('ruleRestoreDefaultsBtn'),
      ruleApplyBtn: document.getElementById('ruleApplyBtn'),

      // AI Setup Rule Controls (Desktop & Mobile)
      aiCustomizeRulesBtn: document.getElementById('aiCustomizeRulesBtn'),
      mobileAiCustomizeRulesBtn: document.getElementById('mobileAiCustomizeRulesBtn'),
      aiRulesStatusBadge: document.getElementById('aiRulesStatusBadge'),
      mobileAiRulesStatusBadge: document.getElementById('mobileAiRulesStatusBadge'),
      aiRulesSummaryText: document.getElementById('aiRulesSummaryText'),
      mobileAiRulesSummaryText: document.getElementById('mobileAiRulesSummaryText'),

      // Unified Settings Modal
      settingsBtn: document.getElementById('settingsBtn'),
      mobileNavSettingsBtn: document.getElementById('mobileNavSettingsBtn'),
      noMercySettingsBtn: document.getElementById('noMercySettingsBtn'),
      settingsModal: document.getElementById('settingsModal'),
      settingsModalTitle: document.getElementById('settingsModalTitle'),
      settingsModalClose: document.getElementById('settingsModalClose'),
      tabBtnGeneral: document.getElementById('tabBtnGeneral'),
      tabBtnGameRules: document.getElementById('tabBtnGameRules'),
      tabBtnHowToPlay: document.getElementById('tabBtnHowToPlay'),
      tabContentGeneral: document.getElementById('tabContentGeneral'),
      tabContentGameRules: document.getElementById('tabContentGameRules'),
      tabContentHowToPlay: document.getElementById('tabContentHowToPlay'),
      howToPlayTabs: document.getElementById('howToPlayTabs'),
      settingSoundToggle: document.getElementById('settingSoundToggle'),
      settingVolumeSlider: document.getElementById('settingVolumeSlider'),
      settingVolumeValue: document.getElementById('settingVolumeValue'),
      settingPlayerNameInput: document.getElementById('settingPlayerNameInput'),
      settingAvatarPreview: document.getElementById('settingAvatarPreview'),
      settingAvatarEmoji: document.getElementById('settingAvatarEmoji'),
      settingAvatarImg: document.getElementById('settingAvatarImg'),
      settingAvatarUpload: document.getElementById('settingAvatarUpload'),
      settingAvatarRemoveBtn: document.getElementById('settingAvatarRemoveBtn'),
      avatarPresetsGrid: document.getElementById('avatarPresetsGrid'),
      settingReducedMotion: document.getElementById('settingReducedMotion'),
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

    if (this.el.soundToggleBtn) {
      this.el.soundToggleBtn.addEventListener('click', () => {
        const enabled = sounds.toggle();
        this.updateSoundIcon(enabled);
        if (this.el.settingSoundToggle) this.el.settingSoundToggle.checked = enabled;
        this.showToast(enabled ? 'Sound Enabled 🔊' : 'Sound Muted 🔇');
      });
    }
    this.updateSoundIcon(sounds.isEnabled());

    // Legacy How to Play button triggers
    if (this.el.howToPlayBtn) {
      this.el.howToPlayBtn.addEventListener('click', () => this.openRulesModal());
    }
    if (this.el.rulesModalClose && this.el.rulesModalClose !== this.el.settingsModalClose) {
      this.el.rulesModalClose.addEventListener('click', () => this.closeRulesModal());
    }

    // Initialize unified settings modal
    this.initSettingsModal();

    // Color Roulette modal actions
    if (this.el.rouletteActionBtn) {
      this.el.rouletteActionBtn.addEventListener('click', () => this.handleRouletteSpinClick());
    }
    if (this.el.rouletteWheelFrame) {
      this.el.rouletteWheelFrame.addEventListener('click', () => {
        if (this.isRouletteInteractive) this.handleRouletteSpinClick();
      });
    }

    // Fullscreen and Orientation controls
    this.el.fullscreenToggleBtn?.addEventListener('click', () => this.toggleFullscreen());
    this.el.mobileNavFullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());
    this.el.arenaFullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());
    this.el.modeLobbyFullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());
    this.el.modeLobbyLeaveBtn?.addEventListener('click', () => this.leaveRoom());
    document.addEventListener('fullscreenchange', () => this.handleOrientationOrResize());
    document.addEventListener('webkitfullscreenchange', () => this.handleOrientationOrResize());
    window.addEventListener('orientationchange', () => this.handleOrientationOrResize());
    if (window.screen?.orientation) {
      try {
        window.screen.orientation.addEventListener('change', () => this.handleOrientationOrResize());
      } catch (_) { }
    }
    this.syncFullscreenState();
    window.visualViewport?.addEventListener('resize', () => this.handleOrientationOrResize());

    // Quick Match controls
    this.el.quickMatchBtn?.addEventListener('click', () => this.startQuickMatch());
    this.el.mobileQuickMatchBtn?.addEventListener('click', () => this.startQuickMatch());
    this.el.cancelQuickMatchBtn?.addEventListener('click', () => this.cancelQuickMatch());

    // Window resize handler: seamlessly recalculate card fan and hand overlap
    window.addEventListener('resize', () => {
      this.handleOrientationOrResize();
    });

    this.el.backToModesBtn.addEventListener('click', () => this.showModePicker());
    document.getElementById('classicBackBottomBtn')?.addEventListener('click', () => this.showModePicker());
    this.el.setupMercyLimit.value = String(this.mercyKnockoutLimit);
    this.el.setupMercyLimit.addEventListener('change', () => {
      this.mercyKnockoutLimit = Number(this.el.setupMercyLimit.value) || 25;
      localStorage.setItem('uno_arena_mercy_limit', String(this.mercyKnockoutLimit));
    });
    this.el.setupCreateRoomBtn.addEventListener('click', () => {
      const name = this.el.setupPlayerNameInput.value.trim() || this.playerName || 'Player 1';
      this.playerName = name;
      localStorage.setItem('uno_arena_name', name);
      this.createRoom(name, 'classic', this.getSelectedHouseRules(), 'fixed');
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
      document.getElementById('noMercyBackBottomBtn')?.addEventListener('click', () => this.showModePicker());
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
      document.getElementById('flipBackCornerBtn')?.addEventListener('click', () => this.showModePicker());
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

    // Landing game mode cards - clicking opens mode-specific setup
    document.querySelectorAll('[data-home-mode]').forEach((button) => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        const mode = button.dataset.homeMode;
        this.openModeSetup(mode);
      });
    });

    // Create room (Direct Create Room -> opens room with mode choices)
    this.el.createRoomBtn.addEventListener('click', () => {
      const name = this.el.playerNameInput.value.trim() || 'Player 1';
      this.playerName = name;
      localStorage.setItem('uno_arena_name', name);
      this.createRoom(name, this.preferredMode || 'classic', this.getSelectedHouseRules(), 'selectable');
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
        this.createRoom(name, this.preferredMode || 'classic', this.getSelectedHouseRules(), 'selectable');
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
      this.openAiSetup();
    };

    if (this.el.playVsAiBtn) {
      this.el.playVsAiBtn.addEventListener('click', triggerPlayVsAi);
    }
    if (this.el.mobilePlayVsAiBtn) {
      this.el.mobilePlayVsAiBtn.addEventListener('click', triggerPlayVsAi);
    }

    const cancelAiSetup = () => this.closeAiSetup();
    document.querySelectorAll('.ai-cancel-btn, #aiSetupCancelBtn, #mobileAiCancelBtn').forEach((btn) => {
      btn.addEventListener('click', cancelAiSetup);
    });

    const startAiGameHandler = () => this.startAiGame();
    document.querySelectorAll('.ai-start-btn, #aiSetupStartBtn, #mobileAiStartBtn').forEach((btn) => {
      btn.addEventListener('click', startAiGameHandler);
    });

    // AI Setup Mode selections
    document.querySelectorAll('.ai-mode-card, .ai-mode-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        this.aiSetup.mode = mode;
        document.querySelectorAll('.ai-mode-card, .ai-mode-option').forEach((b) => {
          b.classList.toggle('selected', b.dataset.mode === mode);
        });
        sounds.playSnap?.(440, 0.08);
        this.updateAiSetupState();
        this.updateAiRulesSummary(mode);
      });
    });

    // AI Setup Customize Rules button
    const triggerCustomizeAiRules = () => {
      this.openGameRulesModal('ai', this.aiSetup.mode || 'classic');
    };
    if (this.el.aiCustomizeRulesBtn) {
      this.el.aiCustomizeRulesBtn.addEventListener('click', triggerCustomizeAiRules);
    }
    if (this.el.mobileAiCustomizeRulesBtn) {
      this.el.mobileAiCustomizeRulesBtn.addEventListener('click', triggerCustomizeAiRules);
    }

    // Game Rules Modal Close & Apply
    if (this.el.gameRulesModalClose && this.el.gameRulesModalClose !== this.el.settingsModalClose) {
      this.el.gameRulesModalClose.addEventListener('click', () => this.closeGameRulesModal());
    }
    if (this.el.ruleApplyBtn) {
      this.el.ruleApplyBtn.addEventListener('click', () => this.closeGameRulesModal());
    }
    if (this.el.gameRulesModal && this.el.gameRulesModal !== this.el.settingsModal) {
      this.el.gameRulesModal.addEventListener('click', (e) => {
        if (e.target === this.el.gameRulesModal) this.closeGameRulesModal();
      });
    }

    // Modal Mode Tabs
    if (this.el.gameRulesModeTabs) {
      this.el.gameRulesModeTabs.querySelectorAll('.rule-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.rulesMode;
          if (mode) {
            this.activeRulesModalMode = mode;
            this.el.gameRulesModeTabs.querySelectorAll('.rule-tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
            const rules = ['ai', 'setup'].includes(this.rulesModalContext)
              ? (this.customHouseRules[mode] || defaultHouseRules(mode))
              : (this.gameState?.houseRules || defaultHouseRules(mode));
            this.syncGameRulesModalInputs(mode, rules, this.gameState?.status === 'playing', this.gameState?.players?.find(p => p.id === this.playerId)?.isHost);
          }
        });
      });
    }

    // Restore Defaults Button in Rules Modal
    if (this.el.ruleRestoreDefaultsBtn) {
      this.el.ruleRestoreDefaultsBtn.addEventListener('click', () => {
        const mode = this.activeRulesModalMode;
        if (['ai', 'setup'].includes(this.rulesModalContext)) {
          this.customHouseRules[mode] = defaultHouseRules(mode);
          this.syncGameRulesModalInputs(mode, this.customHouseRules[mode], false, true);
          this.updateAiRulesSummary(mode);
        } else if (this.rulesModalContext === 'lobby') {
          this.send({ type: 'set_rules', data: { houseRules: { restoreDefaults: true } } });
        }
      });
    }

    // Live update when rule inputs change
    const handleRuleInputChange = () => {
      const mode = this.activeRulesModalMode;
      const updatedRules = this.readGameRulesModalInputs(mode);
      if (['ai', 'setup'].includes(this.rulesModalContext)) {
        this.customHouseRules[mode] = updatedRules;
        const isCustom = this.isCustomRules(mode, updatedRules);
        if (this.el.gameRulesTypeBadge) {
          this.el.gameRulesTypeBadge.textContent = isCustom ? 'Custom House Rules' : 'Official Rules';
          this.el.gameRulesTypeBadge.classList.toggle('is-custom', isCustom);
        }
        this.updateAiRulesSummary(mode);
      } else if (this.rulesModalContext === 'lobby') {
        const me = this.gameState?.players?.find((p) => p.id === this.playerId);
        if (me?.isHost) {
          this.send({ type: 'set_rules', data: { houseRules: updatedRules } });
        }
      }
    };

    const ruleInputs = [
      this.el.ruleMissedUnoPenalty,
      this.el.ruleStartingHandSize,
      this.el.ruleTurnDuration,
      this.el.ruleClassicStacking,
      this.el.ruleClassicDrawBehavior,
      this.el.ruleClassicSevenZero,
      this.el.ruleClassicWd4Challenge,
      this.el.ruleFlipStacking,
      this.el.ruleFlipDrawBehavior,
      this.el.ruleNmStacking,
      this.el.ruleNmDrawBehavior,
      this.el.ruleNmSevenZero,
      this.el.ruleNmKnockout,
      this.el.ruleNmKnockoutLimit,
    ];
    ruleInputs.forEach((input) => {
      if (input) {
        input.addEventListener('change', handleRuleInputChange);
      }
    });

    // AI Setup Player Count pills
    document.querySelectorAll('.ai-player-pill, .ai-count-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const count = Number(btn.dataset.count);
        this.aiSetup.totalPlayers = count;
        document.querySelectorAll('.ai-player-pill, .ai-count-pill').forEach((b) => {
          b.classList.toggle('selected', Number(b.dataset.count) === count);
        });
        sounds.playSnap?.(480, 0.08);
        this.updateAiSetupState();
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const playbox = document.getElementById('homePlaybox');
        const mobileWrap = document.getElementById('mobileFormWrap');
        if (playbox?.classList.contains('show-ai-form') || mobileWrap?.classList.contains('show-ai-form')) {
          this.closeAiSetup();
        }
      }
    });

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
          if(this.connectionRecovering||this.ws?.readyState!==WebSocket.OPEN||Date.now()<(this.reactionCooldownUntil||0))return;
          this.reactionCooldownUntil=Date.now()+1500;
          document.querySelectorAll('.reaction-item-btn').forEach(n=>n.disabled=true);
          clearTimeout(this.reactionCooldownTimer);this.reactionCooldownTimer=setTimeout(()=>document.querySelectorAll('.reaction-item-btn').forEach(n=>n.disabled=false),1500);
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
        this.el.btnCallUnoContextual.innerHTML = '<span class="btn-icon">✓</span> UNO READY!';
        sounds.playUnoCall();
        this.send({ type: 'call_uno' });
        this.showToast('UNO Ready! 📢');
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
      if (!this.clientView?.canCallUno || this.unoRequestPending) return;
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

    // Closing a finished match exits the room, rather than stranding the player.
    this.el.gameOverCloseBtn?.addEventListener('click', () => this.confirmLeaveRoom());
    document.getElementById('victoryHomeBtn')?.addEventListener('click', () => this.confirmLeaveRoom());

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

  async toggleFullscreen() {
    try {
      const doc = document;
      const isFull = Boolean(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);
      if (isFull) {
        if (doc.exitFullscreen) await doc.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
        else if (doc.mozCancelFullScreen) await doc.mozCancelFullScreen();
        else if (doc.msExitFullscreen) await doc.msExitFullscreen();
        if (window.screen?.orientation?.unlock) {
          try { window.screen.orientation.unlock(); } catch (_) { }
        }
      } else {
        const el = document.documentElement;
        if (el.requestFullscreen) {
          await el.requestFullscreen({ navigationUI: 'hide' });
        } else if (el.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen();
        } else if (el.mozRequestFullScreen) {
          await el.mozRequestFullScreen();
        } else if (el.msRequestFullscreen) {
          await el.msRequestFullscreen();
        } else {
          this.showToast('Fullscreen is unavailable in this browser. You can still play in either orientation.');
        }

        if ((document.fullscreenElement || document.webkitFullscreenElement) && (navigator.maxTouchPoints > 0 || window.innerWidth <= 800)) {
          try {
            if (screen.orientation?.lock) await screen.orientation.lock('landscape');
            else if (window.innerHeight > window.innerWidth) this.showToast('Rotate your phone to landscape to fill the table.');
          } catch { this.showToast('Rotate your phone to landscape to fill the table.'); }
        }
      }
    } catch (err) {
      console.warn('Fullscreen/Orientation request notice:', err);
      this.showToast('Fullscreen could not open. Try the fullscreen button again.');
    }
    this.handleOrientationOrResize();
  }

  syncFullscreenState() {
    const isFull = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    const layoutKey=[isFull,innerWidth,innerHeight,window.visualViewport?.height,this.gameState?.status,this.gameState?.mode,document.body.classList.contains('in-arena')].join('|');
    if(this.fullscreenLayoutKey===layoutKey)return;
    this.fullscreenLayoutKey=layoutKey;
    document.body.classList.toggle('is-fullscreen', isFull);
    const fsIcon = isFull ? '🗗' : '⛶';
    const fsSvg = isFull
      ? `<svg class="nav-icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>`
      : `<svg class="nav-icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
    if (this.el.fullscreenToggleBtn) {
      this.el.fullscreenToggleBtn.innerHTML = `${fsSvg}<span id="fullscreenIcon" class="sr-only">${isFull ? 'Exit Fullscreen' : 'Toggle Fullscreen'}</span>`;
      this.el.fullscreenToggleBtn.setAttribute('title', isFull ? 'Exit Fullscreen' : 'Toggle Fullscreen');
      this.el.fullscreenToggleBtn.setAttribute('aria-label', isFull ? 'Exit Fullscreen' : 'Toggle Fullscreen');
    }
    if (this.el.mobileNavFullscreenBtn) {
      this.el.mobileNavFullscreenBtn.innerHTML = fsSvg;
      this.el.mobileNavFullscreenBtn.setAttribute('title', isFull ? 'Exit Fullscreen' : 'Toggle Fullscreen');
      this.el.mobileNavFullscreenBtn.setAttribute('aria-label', isFull ? 'Exit Fullscreen' : 'Toggle Fullscreen');
    }
    const arenaFsText = this.el.arenaFullscreenBtn?.querySelector('.arena-fs-text');
    if (arenaFsText) arenaFsText.textContent = isFull ? 'EXIT FULL' : 'FULLSCREEN';
    const arenaFsIcon = this.el.arenaFullscreenBtn?.querySelector('.arena-fs-icon');
    if (arenaFsIcon) arenaFsIcon.textContent = fsIcon;
    for (const button of [this.el.fullscreenToggleBtn, this.el.mobileNavFullscreenBtn, this.el.arenaFullscreenBtn, this.el.modeLobbyFullscreenBtn]) {
      button?.setAttribute('aria-pressed', String(isFull));
      button?.setAttribute('aria-label', isFull ? 'Exit fullscreen' : 'Enter fullscreen');
    }
    this.syncLandscapeState();
    const root = document.documentElement;
    root.style.setProperty('--app-height', `${window.innerHeight}px`);
    root.style.setProperty('--visible-height', `${window.visualViewport?.height || window.innerHeight}px`);
    const nav = this.el.topNav || document.querySelector('.top-nav');
    root.style.setProperty('--arena-nav-height', `${nav?.getBoundingClientRect().height || 0}px`);
  }

  syncLandscapeState() {
    const isLandscape = window.matchMedia('(orientation: landscape)').matches || window.innerWidth > window.innerHeight;
    document.body.classList.toggle('is-landscape', isLandscape);
    const isMobile = window.innerWidth <= 800 || (isLandscape && window.innerHeight <= 540);
    document.body.classList.toggle('mobile-viewport', isMobile);
    syncRoundSeating(this);
  }

  handleOrientationOrResize() {
    this.syncFullscreenState();
    cancelAnimationFrame(this.viewportLayoutFrame);
    this.viewportLayoutFrame = requestAnimationFrame(() => {
      if (this.gameState?.status === 'playing' && this.clientView) {
        this.renderPlayerHand(this.clientView.myHand || [], this.clientView.canPlayCards || [], this.gameState.mode || 'classic', this.gameState.flipSide || 'light');
      }
      this.syncPlayerHUD?.();
      if (window.visualViewport?.height < window.innerHeight * .8 && document.activeElement?.matches('input, textarea, select')) {
        document.activeElement.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    });
  }

  startQuickMatch(modeOverride) {
    const mode = modeOverride || this.preferredMode || 'classic';
    const rawName = (this.el.playerNameInput?.value || this.el.mobilePlayerNameInput?.value || this.playerName || '').trim();
    const playerName = rawName.slice(0, 15) || `Player_${Math.floor(Math.random() * 900 + 100)}`;
    this.playerName = playerName;
    localStorage.setItem('uno_arena_name', playerName);

    if (this.el.quickMatchModal) {
      if (this.el.quickMatchModeBadge) {
        this.el.quickMatchModeBadge.textContent = mode.replace('_', ' ').toUpperCase();
      }
      this.el.quickMatchModal.style.display = 'flex';
    }

    this.quickMatchStartMs = Date.now();
    if (this.quickMatchTimerInterval) clearInterval(this.quickMatchTimerInterval);
    this.quickMatchTimerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - this.quickMatchStartMs) / 1000);
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      if (this.el.quickMatchTimer) this.el.quickMatchTimer.textContent = `${mm}:${ss}`;
    }, 1000);

    const action = {
      type: 'quick_match',
      playerName,
      data: { mode },
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send(action);
    } else {
      this.connectWebSocket(null, null, null, null, action);
    }
  }

  cancelQuickMatch() {
    this.cancelQuickMatchTimerOnly();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'cancel_quick_match' });
    }
  }

  cancelQuickMatchTimerOnly() {
    if (this.quickMatchTimerInterval) {
      clearInterval(this.quickMatchTimerInterval);
      this.quickMatchTimerInterval = null;
    }
    if (this.el.quickMatchModal) {
      this.el.quickMatchModal.style.display = 'none';
    }
  }

  showToast(msg) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.el.toast.classList.remove('show');
    }, 2800);
  }

  showRouletteDrawNotice(roulette) {
    if (!roulette?.id || !roulette.color || !Array.isArray(roulette.revealed)) return;
    if (this.lastRouletteNoticeId === roulette.id) return;
    this.lastRouletteNoticeId = roulette.id;
    clearTimeout(this.rouletteNoticeTimer);
    document.getElementById('rouletteDrawNotice')?.remove();
    const player = this.gameState?.players.find(p => p.id === roulette.targetPlayerId);
    const notice = document.createElement('div');
    notice.id = 'rouletteDrawNotice';
    notice.className = 'roulette-draw-notice';
    notice.setAttribute('role','status');
    const count = roulette.revealed.length;
    const colors = { red:'#f45151',yellow:'#ffe14b',green:'#40cd87',blue:'#53a9ff' };
    notice.style.setProperty('--roulette-color', colors[roulette.color] || '#ffe14b');
    notice.innerHTML = `<span class="roulette-notice-heading"><span class="roulette-notice-dot" aria-hidden="true"></span>ROULETTE RESULT</span><strong class="roulette-notice-player">${escapeHtml(player?.name || 'Player')}</strong><span class="roulette-notice-details"><span class="roulette-notice-color">${escapeHtml(roulette.color.toUpperCase())}</span><span>Drew <b>${count}</b> card${count === 1 ? '' : 's'}</span></span>`;

    document.body.append(notice);
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.body.classList.contains('reduced-motion'))notice.animate([{opacity:0,transform:'translateY(-10px) scale(.97)'},{opacity:1,transform:'none',offset:.09},{opacity:1,transform:'none',offset:.91},{opacity:0,transform:'translateY(-8px) scale(.97)'}],{duration:2000,easing:'ease-out'});
    this.rouletteNoticeTimer = setTimeout(() => {
      notice.remove();
      this.completedRouletteNoticeId = roulette.id;
      if (this.pendingWinnerRouletteId === roulette.id) {
        this.pendingWinnerRouletteId = null;
        if (this.gameState?.rouletteResult?.id === roulette.id && ['game_over','round_over'].includes(this.gameState.status)) this.showGameOver(this.gameState);
      }
    }, 2000);
  }

  highlightSelectedMode(mode) {
    document.querySelectorAll('[data-home-mode]').forEach((tile) => {
      const isSelected = tile.dataset.homeMode === mode;
      tile.classList.toggle('is-selected', isSelected);
      tile.setAttribute('aria-pressed', String(isSelected));
    });
  }

  openModeSetup(mode) {
    music.setScene(mode);
    this.cancelModeEntrance?.();
    const details = {
      classic: ['Classic UNO', 'Play the familiar classic rules with your friends.'],
      flip: ['UNO Flip', 'Two-sided cards. Flip the deck and change the whole table.'],
      no_mercy: ["Show ’em No Mercy", 'Stack penalties, survive the knockout limit, and be the last player standing.'],
    };
    if (!details[mode]) return;
    this.roomEntryFlow = 'mode_setup';
    this.selectedSetupMode = mode;
    this.preferredMode = mode;
    localStorage.setItem('uno_arena_mode', mode);
    this.highlightSelectedMode(mode);
    this.el.setupModeTitle.textContent = details[mode][0];
    this.el.setupModeDescription.textContent = details[mode][1];
    this.el.setupRulesCard.hidden = mode !== 'no_mercy';
    this.el.setupMercyLimit.value = String(this.mercyKnockoutLimit);
    const currentName = (window.innerWidth <= 768 && this.el.mobilePlayerNameInput?.value.trim()) || this.el.playerNameInput?.value.trim() || this.el.mobilePlayerNameInput?.value.trim() || this.playerName || '';
    this.el.setupPlayerNameInput.value = currentName;
    if (this.el.mobilePlayerNameInput) this.el.mobilePlayerNameInput.value = currentName;
    this.el.playerNameInput.value = currentName;

    const isNoMercy = mode === 'no_mercy';
    const isFlip = mode === 'flip';
    const isClassic = mode === 'classic';

    // Ensure central form components are visible and lobby slots hidden
    const nmCard = document.querySelector('.nm-card-container');
    const nmBack = document.getElementById('noMercyBackBtn');
    if (nmCard) nmCard.style.display = '';
    if (nmBack) nmBack.style.display = '';
    if (this.el.noMercyLobbySlot) this.el.noMercyLobbySlot.style.display = 'none';

    const flipCard = document.getElementById('flipCardWrapper');
    const flipBack = document.getElementById('flipBackToModesBtn');
    if (flipCard) flipCard.style.display = '';
    if (flipBack) flipBack.style.display = '';
    if (this.el.flipLobbySlot) this.el.flipLobbySlot.style.display = 'none';

    const classicHeading = document.querySelector('.mode-setup-heading');
    const classicLayout = document.querySelector('.mode-setup-layout');
    const classicBack = document.getElementById('backToModesBtn');
    if (classicHeading) classicHeading.style.display = '';
    if (classicLayout) classicLayout.style.display = '';
    if (classicBack) classicBack.style.display = '';
    if (this.el.classicLobbySlot) this.el.classicLobbySlot.style.display = 'none';

    this.el.modeSetupSection.classList.toggle('mode-no-mercy-setup', isNoMercy);
    document.body.classList.toggle('in-no-mercy-setup', isNoMercy);
    this.el.modeSetupSection.classList.toggle('mode-flip-setup', isFlip);
    document.body.classList.toggle('in-flip-setup', isFlip);
    this.el.modeSetupSection.classList.toggle('mode-classic-setup', isClassic);
    document.body.classList.toggle('in-classic-setup', isClassic);
    document.body.classList.add('in-mode-setup');
    document.body.classList.remove('in-mode-lobby', 'in-room');

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
    if (isNoMercy) this.cancelModeEntrance = playNoMercyEntrance(nmCard);
    else if (isFlip) this.cancelModeEntrance = playFlipEntrance(flipCard);
    else if (isClassic) this.cancelModeEntrance = playClassicEntrance(document.querySelector('.mode-classic-setup .setup-panel'));
  }

  showModePicker() {
    music.setScene('lobby');
    this.cancelModeEntrance?.();
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
    this.roomEntryFlow = null;
    this.selectedSetupMode = null;
    this.el.modeSetupSection.classList.remove('mode-no-mercy-setup', 'mode-flip-setup', 'mode-classic-setup');
    document.body.classList.remove('in-no-mercy-setup', 'in-flip-setup', 'in-classic-setup', 'in-mode-setup', 'in-mode-lobby');
    this.el.modeSetupSection.hidden = true;
    this.el.modeHomeScreen.hidden = false;

    if (this.el.genericLobbySlot && this.el.lobbySection && this.el.lobbySection.parentElement !== this.el.genericLobbySlot) {
      this.el.genericLobbySlot.appendChild(this.el.lobbySection);
    }
    if (this.el.lobbySection) this.el.lobbySection.style.display = 'none';
    if (this.el.entryView) this.el.entryView.style.display = 'block';
    const entryForm = document.getElementById('entryFormSection');
    if (entryForm) entryForm.style.display = '';

    const nmCard = document.querySelector('.nm-card-container');
    const nmBack = document.getElementById('noMercyBackBtn');
    if (nmCard) nmCard.style.display = '';
    if (nmBack) nmBack.style.display = '';
    if (this.el.noMercyLobbySlot) this.el.noMercyLobbySlot.style.display = 'none';

    const flipCard = document.getElementById('flipCardWrapper');
    const flipBack = document.getElementById('flipBackToModesBtn');
    if (flipCard) flipCard.style.display = '';
    if (flipBack) flipBack.style.display = '';
    if (this.el.flipLobbySlot) this.el.flipLobbySlot.style.display = 'none';

    const classicHeading = document.querySelector('.mode-setup-heading');
    const classicLayout = document.querySelector('.mode-setup-layout');
    const classicBack = document.getElementById('backToModesBtn');
    if (classicHeading) classicHeading.style.display = '';
    if (classicLayout) classicLayout.style.display = '';
    if (classicBack) classicBack.style.display = '';
    if (this.el.classicLobbySlot) this.el.classicLobbySlot.style.display = 'none';
  }

  triggerFlipCreate() {
    const inputVal = (this.el.flipPlayerNameInput?.value || '').trim();
    const name = inputVal || this.playerName || 'Player 1';
    this.playerName = name;
    localStorage.setItem('uno_arena_name', name);
    this.createRoom(name, 'flip', this.getSelectedHouseRules(), 'fixed');
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
    this.createRoom(name, 'no_mercy', this.getSelectedHouseRules(), 'fixed');
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

  async createRoom(hostName, mode = this.preferredMode, houseRules = {}, modeSelectionPolicy = 'selectable') {
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
        body: JSON.stringify({ hostName, mode, houseRules, avatar: this.playerAvatar, modeSelectionPolicy }),
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
        if (!history.state?.unoNavigation) window.history.replaceState(history.state, '', roomUrl);

        // Immediate lobby transition: do not wait for WebSocket handshake roundtrip
        const initialHost = {
          id: this.playerId,
          name: hostName,
          avatar: this.playerAvatar,
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
          modeSelectionPolicy: modeSelectionPolicy || 'selectable',
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

  openAiSetup() {
    if (!this.aiSetup) {
      this.aiSetup = {
        mode: null,
        totalPlayers: null,
        selectedBots: [],
      };
    }
    if (this.aiSetup.mode) {
      document.querySelectorAll('.ai-mode-card, .ai-mode-option').forEach((b) => {
        b.classList.toggle('selected', b.dataset.mode === this.aiSetup.mode);
      });
    }
    if (this.aiSetup.totalPlayers) {
      document.querySelectorAll('.ai-player-pill, .ai-count-pill').forEach((b) => {
        b.classList.toggle('selected', Number(b.dataset.count) === Number(this.aiSetup.totalPlayers));
      });
    }
    this.updateAiSetupState();

    const homePlaybox = document.getElementById('homePlaybox') || this.el.homePlaybox;
    if (homePlaybox) homePlaybox.classList.add('show-ai-form');
    document.getElementById('homeDefaultForm')?.setAttribute('inert','');

    const mobileWrap = document.getElementById('mobileFormWrap') || this.el.mobileFormWrap;
    if (mobileWrap) mobileWrap.classList.add('show-ai-form');

    this.updateAiRulesSummary(this.aiSetup.mode || 'classic');
    sounds.playSnap?.(440, 0.08);
  }

  closeAiSetup() {
    const homePlaybox = document.getElementById('homePlaybox') || this.el.homePlaybox;
    if (homePlaybox) homePlaybox.classList.remove('show-ai-form');
    document.getElementById('homeDefaultForm')?.removeAttribute('inert');

    const mobileWrap = document.getElementById('mobileFormWrap') || this.el.mobileFormWrap;
    if (mobileWrap) mobileWrap.classList.remove('show-ai-form');

    sounds.playSnap?.(380, 0.08);
  }

  openAiSetupModal() {
    this.openAiSetup();
  }

  closeAiSetupModal() {
    this.closeAiSetup();
  }

  updateAiSetupState() {
    const isValid = Boolean(this.aiSetup.mode && this.aiSetup.totalPlayers);
    document.querySelectorAll('.ai-start-btn, #aiSetupStartBtn, #mobileAiStartBtn').forEach((btn) => {
      btn.disabled = !isValid;
    });
  }

  startAiGame() {
    if (!this.aiSetup.mode || !this.aiSetup.totalPlayers) return;

    const botCount = this.aiSetup.totalPlayers - 1;
    const botNames = UnoArenaApp.BOT_ROSTER.slice(0, botCount).map((b) => b.name);
    this.aiSetup.selectedBots = botNames;

    const name = (this.el.playerNameInput?.value || '').trim() ||
      (this.el.mobilePlayerNameInput?.value || '').trim() ||
      this.playerName || 'Player 1';
    this.playerName = name;
    localStorage.setItem('uno_arena_name', name);

    this.closeAiSetup();
    this.createBotRoom(name, this.aiSetup.mode, botCount, this.getSelectedHouseRules(this.aiSetup.mode), botNames);
  }

  async createBotRoom(hostName, mode = this.preferredMode, botCount = 3, houseRules = {}, botNames = null) {
    if (this.isCreatingRoom) return;
    this.isCreatingRoom = true;
    if (this.el.createRoomBtn) this.el.createRoomBtn.disabled = true;
    if (this.el.playVsAiBtn) this.el.playVsAiBtn.disabled = true;
    if (this.el.mobilePlayVsAiBtn) this.el.mobilePlayVsAiBtn.disabled = true;

    try {
      const res = await fetch('/api/rooms/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostName, mode, botCount, houseRules, botNames, avatar: this.playerAvatar }),
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
        if (!history.state?.unoNavigation) window.history.replaceState(history.state, '', roomUrl);

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

  connectWebSocket(roomId, playerId, sessionToken, playerName, customAction) {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      if (!this.roomId) this.el.banner.classList.remove('visible');
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      // Keep alive heartbeat ping every 20s to prevent reverse proxy/mobile timeout
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'ping', sentAt:Date.now() }));
        }
      }, 10000);
      this.ws.send(JSON.stringify({type:'ping',sentAt:Date.now()}));

      // Send action or join message
      if (customAction) {
        this.send(customAction);
      } else if (roomId) {
        this.send({
          type: 'join',
          roomId,
          playerId,
          sessionToken,
          playerName: playerName || this.playerName,
          avatar: this.playerAvatar,
        });
      }
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
          onPong(this,msg.sentAt);
          // Heartbeat acknowledged
          return;
        }
        if (msg.type === 'joined') {
          this.cancelQuickMatchTimerOnly();
          this.roomId = msg.data.roomId;
          this.playerId = msg.data.playerId;
          this.sessionToken = msg.data.sessionToken;
          localStorage.setItem(`session_${this.roomId}`, this.sessionToken);
          localStorage.setItem(`player_${this.roomId}`, this.playerId);
          const roomUrl = new URL(window.location.href);
          roomUrl.searchParams.set('room', this.roomId);
          if (!history.state?.unoNavigation) window.history.replaceState(history.state, '', roomUrl);
        } else if (msg.type === 'quick_match_cancelled') {
          this.cancelQuickMatchTimerOnly();
        } else if (msg.type === 'room:state') {
          const recovered=this.connectionRecovering;
          if(recovered){this.skipNextStateAnimations=true;this.clearClassicAnimations?.();this.performanceMetrics?.bump('resyncs');}
          this.connectionRecovering=false;this.reconnectAttempts=0;this.el.banner.classList.remove('visible');
          this.cancelQuickMatchTimerOnly();
          this.handleRoomState(msg.data);
          if(recovered)this.showToast('Reconnected · your hand and seat are restored.');
        } else if (msg.type === 'room_removed') {
          this.confirmLeaveRoom();this.showToast(msg.data?.message||'You were removed from the room.');
        } else if (msg.type === 'player_card_hovered') {
          this.handleOpponentCardHover(msg.data);
        } else if (msg.type === 'player_reaction') {
          this.handlePlayerReaction(msg.data);
        } else if (msg.type === 'catch_failed') {
          this.catchRequestPending = false;
          this.showCaughtFailedModal(msg.data);
        } else if (msg.type === 'error') {
          cancelLocalPlay(this,true);
          this.cancelCardDrag?.();
          this.isPlayInFlight=false;
          this.cancelQuickMatchTimerOnly();
          this.rematchRequestPending = false; this.rematchActionPending = false; this.rematchDismissAfterResponseId = null; this.unoRequestPending = false; this.catchRequestPending = false; this.pendingClassicMotion = null;
          this.clearClassicAnimations?.();
          this.isMoveInFlight = false;
          if (this.inFlightCardId) {
            const el = this.handCardElements.get(this.inFlightCardId);
            if (el) {
              el.style.opacity = '1';
              el.style.pointerEvents = '';
              el.animate([{ transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'none' }], { duration: 220 });
            }
            this.inFlightCardId = null;
          }
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
      cancelLocalPlay(this);
      if (this.gameState) {
        this.cancelCardDrag?.();
        this.clearClassicAnimations?.();
        this.pendingClassicMotion = null;
        this.isMoveInFlight = false;
        this.pendingPlayCard = null;
        this.pendingPlayWrapper = null;
        setGameModal(this.el.colorPickerModal,false);
        setGameModal(this.el.swapPickerModal,false);
        this.el.playerHandCards.setAttribute('inert', '');
        this.el.btnDrawAction.disabled = true;
        this.el.drawPileBtn.disabled = true;
      }
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
      this.connectionRecovering=true;
      this.pendingMessages=[];
      this.reconnectAttempts=(this.reconnectAttempts||0)+1;
      this.el.banner.textContent=navigator.onLine?'Reconnecting… Your seat is saved.':'You’re offline · reconnecting when your network returns';
      this.el.banner.classList.add('visible');
      // Retry progressively, without hammering a disconnected mobile connection.
      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = setTimeout(() => {
        if (this.roomId) {
          const sToken = this.gameState?.mode === 'no_mercy' ? this.sessionToken || localStorage.getItem(`session_${this.roomId}`) : localStorage.getItem(`session_${this.roomId}`);
          const pId = this.gameState?.mode === 'no_mercy' ? this.playerId : localStorage.getItem(`player_${this.roomId}`);
          this.connectWebSocket(this.roomId, pId, sToken, this.playerName);
        }
      }, Math.min(15000,1000*2**Math.min(this.reconnectAttempts-1,4)));
    };

    this.ws.onerror = (err) => {
      console.warn('WebSocket connection error:', err);
    };
  }

  send(payload) {
    if(payload.type==='player_card_hovered'){
      if(navigator.maxTouchPoints>0||this.localPlayPreview)return;
      this.pendingHoverIndex=payload.data?.cardIndex??null;
      if(this.hoverSendTimer)return;
      this.hoverSendTimer=setTimeout(()=>{this.hoverSendTimer=null;if(this.localPlayPreview||this.ws?.readyState!==WebSocket.OPEN)return;this.ws.send(JSON.stringify({roomId:this.roomId,sessionToken:this.sessionToken,type:'player_card_hovered',data:{cardIndex:this.pendingHoverIndex}}));},65);
      return;
    }
    if(this.localPlayPreview&&['play_card','draw_card','pass_turn','call_uno','catch_uno'].includes(payload.type))return false;
    const roomAction=!['join','ping'].includes(payload.type);
    if(this.roomId && this.connectionRecovering && roomAction){this.isMoveInFlight=false;return false;}
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
      if(payload.type==='play_card'){
        clearTimeout(this.hoverSendTimer);this.hoverSendTimer=null;
        beginLocalPlay(this,payload.data?.cardId,{animate:!this.dragDropSubmitting});
        if(this.pendingClassicMotion)this.pendingClassicMotion.localPreview=true;
      }
      this.ws.send(JSON.stringify(full));
    } else if (this.gameState && ['play_card', 'draw_card', 'pass_turn', 'choose_color', 'challenge_draw4', 'call_uno', 'catch_uno', 'rematch', 'start_game', 'rematch_propose', 'rematch_respond', 'rematch_vote', 'rematch_cancel'].includes(payload.type)) {
      this.isMoveInFlight = false;this.isPlayInFlight=false;
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
    opponentBox.classList.toggle('is-hovering-card', Number.isInteger(cardIndex));
    const cardBacks = opponentBox.querySelectorAll('.opponent-card-back');
    cardBacks.forEach((back, idx) => {
      back.style.setProperty('--fan-rest', back.style.transform);
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
      cry: '😭',
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
    if(document.hidden){this.backgroundRoomView=view;return;}
    if(gateCardArt(this,view))return;
    this.releaseDroppedCard?.();
    const renderStarted=performance.now();
    const fingerprint=JSON.stringify(view);
    if(!this.skipNextStateAnimations&&!this.localPlayPreview&&!this.finishingLocalPlay&&this.lastRoomViewFingerprint===fingerprint){this.performanceMetrics?.bump('stateSkips');this.performanceMetrics?.record('render',performance.now()-renderStarted);return;}
    const previous = this.clientView;
    const stateGap=Number.isFinite(previous?.gameState.actionVersion)&&view.gameState.actionVersion-previous.gameState.actionVersion>1;
    const animateView=Boolean(previous&&!this.skipNextStateAnimations&&!stateGap&&previous.gameState.status==='playing'&&view.gameState.status==='playing'&&(previous.gameState.topDiscard?.id!==view.gameState.topDiscard?.id||previous.gameState.flipSide!==view.gameState.flipSide||previous.myHand.map(c=>c.id).join(',')!==view.myHand.map(c=>c.id).join(',')||previous.gameState.players.some(p=>view.gameState.players.find(n=>n.id===p.id)?.cardCount!==p.cardCount)));
    const classicGeometry = animateView?this.captureClassicGeometry():{hand:new Map(),opponents:new Map(),pending:this.pendingClassicMotion};
    classicGeometry.previewedCardId=reconcileLocalPlay(this,view);
    if(this.skipNextStateAnimations||stateGap)this.clearClassicAnimations();
    if (!previous || previous.gameState.matchId !== view.gameState.matchId) this.clearClassicAnimations();
    const playSource = previous && this.el.playerHandCards.querySelector(`[data-card-id="${view.gameState.topDiscard?.id}"]`);
    const playRect = playSource?.getBoundingClientRect();
    const oldIds = new Set(previous?.myHand.map(c => c.id) || []);
    if(this.draggingCardId&&(!view.isMyTurn||!view.canPlayCards.includes(this.draggingCardId)||previous?.gameState.flipSide!==view.gameState.flipSide))this.cancelCardDrag?.();
    document.querySelectorAll('.classic-returning-card').forEach(el => el.remove());
    this.el.playerHandCards.removeAttribute('inert');
    if(!view.isMyTurn || !view.myHand.some(c=>c.id===this.selectedCardId) || !view.canPlayCards.includes(this.selectedCardId) || previous?.gameState.flipSide!==view.gameState.flipSide) this.selectedCardId=null;
    music.setScene(['game_over','round_over'].includes(view.gameState.status)?'victory':view.gameState.status==='playing'?view.gameState.mode:'lobby');
    this.clientView = view;
    this.gameState = view.gameState;
    this.isPlayInFlight = Boolean(this.localPlayPreview);
    this.isMoveInFlight = false;
    if (this.inFlightCardId) {
      if (view.gameState.topDiscard?.id === this.inFlightCardId || !view.myHand.some(c => c.id === this.inFlightCardId)) {
        this.inFlightCardId = null;
      } else {
        const el = this.handCardElements.get(this.inFlightCardId);
        if (el) el.style.opacity = '1';
        this.inFlightCardId = null;
      }
    }
    if (view.myPlayerId) this.playerId = view.myPlayerId;
    this.rematchRequestPending = false; this.rematchActionPending = false;
    if (this.rematchDismissAfterResponseId && view.rematchProposal?.id === this.rematchDismissAfterResponseId && (view.rematchProposal.status === 'cancelled' || view.rematchProposal.declinedPlayerIds.includes(this.playerId))) { this.dismissedRematchId = view.rematchProposal.id; this.rematchDismissAfterResponseId = null; }
    if (view.isSpectator) { this.renderRematchSpectator(); this.renderRematchProposal(); return; }
    const pendingStillPlayable = this.pendingPlayCard && view.canPlayCards.includes(this.pendingPlayCard.id);
    const openingChoice = view.isMyTurn && view.gameState.pendingAction?.type === 'opening_color';
    const rouletteChoice = view.gameState.pendingAction?.type === 'color_roulette';
    if (!view.isMyTurn && !openingChoice) {
      this.pendingPlayCard = null;
      this.pendingPlayWrapper = null;
      setGameModal(this.el.colorPickerModal,false);
      if (view.gameState.mode === 'no_mercy') setGameModal(this.el.swapPickerModal,false);
    } else if (view.gameState.mode !== 'flip' && !pendingStillPlayable && !openingChoice) {
      this.pendingPlayCard = null;
      this.pendingPlayWrapper = null;
      setGameModal(this.el.colorPickerModal,false);
      if (view.gameState.mode === 'no_mercy') setGameModal(this.el.swapPickerModal,false);
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
    this.isStartingGame = false;
    this.isJoiningRoom = false;
    if (this.el.joinRoomBtn) this.el.joinRoomBtn.disabled = false;
    if (this.el.setupJoinRoomBtn) this.el.setupJoinRoomBtn.disabled = false;
    if (this.el.flipJoinRoomBtn) this.el.flipJoinRoomBtn.disabled = false;

    // Update Top Bar
    if (this.el.navRoomDetails) {
      this.el.navRoomDetails.style.display = 'inline-flex';
    }
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
      if (animateView) this.animateClassicState(previous, classicGeometry);
      else this.pendingClassicMotion=null;
      this.announceEliminations(previous, view);
    }
    if (openingChoice && !this.el.colorPickerModal.classList.contains('active')) {
      this.openColorPicker();
    } else if (this.el.colorPickerModal.classList.contains('active') && (this.pendingPlayCard || openingChoice)) {
      this.renderColorPickerContent();
    }

    if (rouletteChoice) {
      const isTarget = view.gameState.pendingAction.targetPlayerId === this.playerId;
      if (!this.el.rouletteModal.classList.contains('active')) {
        this.openRouletteModal(isTarget);
        if (isTarget) {
          this.isRouletteInteractive = true;
          if (this.rouletteAutoSpinTimer) clearTimeout(this.rouletteAutoSpinTimer);
          this.rouletteAutoSpinTimer = setTimeout(() => {
            if (this.isRouletteInteractive && this.el.rouletteModal.classList.contains('active')) {
              this.handleRouletteSpinClick();
            }
          }, 7000);
        }
      }
    } else if (!view.gameState.rouletteResult && this.el.rouletteModal?.classList.contains('active') && !this.isRouletteDecelerating) {
      this.closeRouletteModal();
    }

    if (view.gameState.mode === 'no_mercy' && view.gameState.rouletteResult && view.gameState.rouletteResult.id !== this.lastHandledRouletteId && (!previous || view.isSpectator)) {
      this.lastHandledRouletteId = view.gameState.rouletteResult.id;
      this.displayRouletteResult(view.gameState.rouletteResult, () => {
        this.showRouletteDrawNotice(view.gameState.rouletteResult);
      });
    }
    this.renderRematchProposal();
    syncSocial(this);
    syncTableTools(this);
    syncPlayDirection(this);
    syncRoundSeating(this);
    this.lastRoomViewFingerprint=fingerprint;
    this.skipNextStateAnimations=false;
    this.performanceMetrics?.record('render',performance.now()-renderStarted);
    this.syncPerformance?.();
    this.syncArenaMenu?.();
    this.syncPlayerHUD?.();
    syncLocalPlayTarget(this);
    syncDrawFourDecision(this);
    if(view.gameState.rouletteInProgress || view.gameState.pendingAction?.type === 'draw4_challenge'){updateTurnStatus(this,0,false);this.el.playerHandCards.setAttribute('inert','');this.el.drawPileBtn.disabled=true;this.el.btnDrawAction.disabled=true;this.el.btnPassAction.disabled=true;this.el.btnUnoAction.disabled=true;}
    else {this.el.btnPassAction.disabled=false;this.el.btnUnoAction.disabled=false;}
  }

  sendRematchAction(type, data = {}) {
    if (this.rematchActionPending || this.ws?.readyState !== WebSocket.OPEN) return;
    this.rematchActionPending = true;
    this.send({ type, data: { proposalId: this.clientView.rematchProposal.id, ...data } });
  }

  closeRematchDialog() {
    this.confirmLeaveRoom();
  }

  announceEliminations(previous, view) {
    if (!previous || view.gameState.mode !== 'no_mercy' ||
        previous.gameState.matchId !== view.gameState.matchId ||
        previous.gameState.roomId !== view.gameState.roomId) return;
    const eliminated = view.gameState.players.filter(player => player.isEliminated &&
      previous.gameState.players.some(before => before.id === player.id && !before.isEliminated));
    if (!eliminated.length) return;
    let notice = document.getElementById('eliminationNotice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'eliminationNotice';
      notice.className = 'elimination-notice';
      notice.setAttribute('role', 'status');
      document.body.appendChild(notice);
    }
    const title = document.createElement('strong');
    title.textContent = eliminated.map(player => player.id === this.playerId ? 'You' : player.name).join(', ') +
      (eliminated.length === 1 && eliminated[0].id !== this.playerId ? ' is eliminated' : ' are eliminated');
    const detail = document.createElement('span');
    detail.textContent = eliminated.map(player => player.eliminatedReason || 'Mercy knockout limit reached').join(' · ');
    notice.replaceChildren(title, detail);
    clearTimeout(this.eliminationNoticeTimer);
    notice.classList.remove('leaving');
    this.eliminationNoticeTimer = setTimeout(() => {
      notice.classList.add('leaving');
      this.eliminationNoticeTimer = setTimeout(() => notice.remove(), 220);
    }, 1600);
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
      <p class="rematch-ready-summary" role="status">${p.acceptedPlayerIds.length} ready · ${p.pendingPlayerIds.length} waiting · ${p.declinedPlayerIds.length} declined</p><ul class="rematch-roster">${p.participants.map(player => {
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

  classicAvatarInner(player) {
    if (!player) return '👤';
    if (player.isBot) return '🤖';
    const avatar = player.avatar || (player.id === this.playerId ? this.playerAvatar : null);
    if (avatar) {
      if (avatar.startsWith('data:image/')) {
        return `<img src="${avatar}" alt="${escapeHtml(player.name)}" class="avatar-face-img">`;
      }
      const presetEmojis = {
        fox: '🦊', panda: '🐼', lion: '🦁', frog: '🐸', robot: '🤖',
        wizard: '🧙', crown: '👑', lightning: '⚡', rocket: '🚀', tiger: '🐯'
      };
      if (presetEmojis[avatar]) return presetEmojis[avatar];
    }
    const initials = player.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
    return escapeHtml(initials || 'P');
  }

  classicAvatarHTML(player, active) {
    const content = this.classicAvatarInner(player);
    return `<span class="classic-avatar-initials">${content}</span>${active ? '<svg class="classic-profile-ring" viewBox="0 0 54 54" aria-label="Active player countdown"><circle cx="27" cy="27" r="22" fill="none" stroke-dasharray="138.23"/></svg><span class="classic-profile-seconds"></span>' : ''}`;
  }

  renderAvatarHtml(player, className = 'player-avatar-badge') {
    if (player.isBot) {
      return `<span class="${className} avatar-bot">🤖</span>`;
    }
    const avatar = player.avatar || (player.id === this.playerId ? this.playerAvatar : null);
    if (avatar) {
      if (avatar.startsWith('data:image/')) {
        return `<span class="${className} avatar-custom-img"><img src="${avatar}" alt="${escapeHtml(player.name)}" class="avatar-face-img"></span>`;
      }
      const presetEmojis = {
        fox: '🦊', panda: '🐼', lion: '🦁', frog: '🐸', robot: '🤖',
        wizard: '🧙', crown: '👑', lightning: '⚡', rocket: '🚀', tiger: '🐯'
      };
      const emoji = presetEmojis[avatar] || avatar;
      return `<span class="${className} avatar-preset-emoji">${emoji}</span>`;
    }
    return `<span class="${className} avatar-default">${player.isHost ? '👑' : '👤'}</span>`;
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
    setActionVisible(this.el.btnUnoAction,myHand.length >= 1 && myHand.length <= 2 && canCallUno && !me.hasCalledUno);
  }

  captureClassicGeometry() {
    const hand = new Map();
    this.el.playerHandCards.querySelectorAll('[data-card-id]').forEach(el => hand.set(el.dataset.cardId, { rect: el.getBoundingClientRect(), html: el.querySelector('.game-card')?.outerHTML }));
    const opponents = new Map();
    this.el.opponentsRow.querySelectorAll('[data-profile-id]').forEach(el => {
      const back=el.querySelector('.opponent-fan-card:last-child .game-card');
      opponents.set(el.dataset.profileId,(back?.getClientRects().length?back:el).getBoundingClientRect());
    });
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
    if(faceHTML===html&&Math.hypot(destination.left-source.left,destination.top-source.top)<4)return;
    this.classicAnimationCleanups ||= new Set();
    if(this.classicAnimationCleanups.size>=18)this.classicAnimationCleanups.values().next().value?.();
    const pileMotion=target instanceof Node && this.el.discardPile.contains(target);
    if(pileMotion)for(const dispose of this.discardMotionCleanups||[])dispose();
    const ghost = document.createElement('div'); ghost.className = 'classic-motion-ghost'; ghost.setAttribute('aria-hidden', 'true'); ghost.innerHTML = html;
    Object.assign(ghost.style, { left: `${source.left}px`, top: `${source.top}px`, width: `${source.width}px`, height: `${source.height}px` });
    document.body.appendChild(ghost);
    this.cardTargetCleanups ||= new WeakMap();
    if (faceHTML) this.cardTargetCleanups.get(target)?.();
    const originalVisibility = target.style.visibility;
    if (faceHTML) target.style.visibility = 'hidden';
    const duration = Math.min(280, Math.max(210, Math.hypot(destination.left - source.left, destination.top - source.top) * .18));
    const dx = destination.left - source.left, dy = destination.top - source.top;
    const scaleX = destination.width / source.width, scaleY = destination.height / source.height;
    const animation = ghost.animate([{ transform: 'translate(0,0) rotate(-3deg)' },{ transform: `translate(${dx}px,${dy}px) rotate(0deg) scale(${scaleX},${scaleY})` }], { duration, delay, easing: 'cubic-bezier(.18,.65,.28,1)', fill: 'both' });
    let reveal;
    if (faceHTML && faceHTML !== html) {
      const front = document.createElement('div'); front.className = 'classic-motion-front'; front.innerHTML = faceHTML; ghost.appendChild(front);
      reveal = front.animate([{ opacity: 0, offset: 0 }, { opacity: 1, offset: .18 }, { opacity: 1, offset: .4 }, { opacity: 1, offset: 1 }], { duration, delay, fill: 'both' });
    }
    const dispose = () => { reveal?.cancel(); animation.cancel(); ghost.remove(); if (faceHTML) { target.style.visibility = originalVisibility; this.cardTargetCleanups.delete(target); } this.classicAnimationCleanups.delete(dispose); this.discardMotionCleanups?.delete(dispose); };
    this.classicAnimationCleanups ||= new Set();
    this.classicAnimationCleanups.add(dispose);
    if(pileMotion){this.discardMotionCleanups ||= new Set();this.discardMotionCleanups.add(dispose);}
    if (faceHTML) this.cardTargetCleanups.set(target, dispose);
    animation.onfinish = dispose;
  }

  animateHandTransfer(from, to, back, delay = 0) {
    if (!from || !to) return;
    const bounds = from.getBoundingClientRect();
    const card = this.el.drawPile.querySelector('.game-card')?.getBoundingClientRect();
    const width = card?.width || 64, height = card?.height || 96;
    const source = {left:bounds.left+bounds.width/2-width/2,top:bounds.top+bounds.height/2-height/2,width,height};
    const end = to.getBoundingClientRect();
    const destination = {style:{},getBoundingClientRect:()=>({left:end.left+end.width/2-width/2,top:end.top+end.height/2-height/2,width,height})};
    // A small packet represents the whole hand without exposing opponents' faces.
    for (let i=0;i<3;i++) this.travelClassicCard(source,destination,back,null,delay+i*65);
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
        if (a && b) { this.animateHandTransfer(a, b, back); this.animateHandTransfer(b, a, back, 90); }
      }
      if (event.type === 'number' && state.topDiscard?.value === 0) active.forEach((p, i) => {
        const a = destination(p.id), b = destination(active[(i + event.direction + active.length) % active.length].id);
        if (a && b) this.animateHandTransfer(a, b, back, i * 60);
      });
      if (event.type === 'discard_all') event.discardedIds.forEach((id, i) => {
        const source = geometry.hand.get(id); if (source) this.travelClassicCard(source.rect, this.el.discardPile, source.html, null, i * 70);
      });
      if (event.type === 'skip_everyone') destination(event.playerId)?.animate([{ filter: 'brightness(2)' }, { filter: 'none' }], { duration: 500 });
    }
    const roulette = state.rouletteResult;
    if (roulette && roulette.id !== previous.gameState.rouletteResult?.id && roulette.id !== this.lastHandledRouletteId) {
      this.lastHandledRouletteId = roulette.id;
      this.displayRouletteResult(roulette, () => {
        const target = destination(roulette.targetPlayerId);
        roulette.revealed.forEach((card, i) => this.travelClassicCard(geometry.deck, target, renderCardHTML(card, { mode: 'no_mercy' }), null, i * 160));
        this.showRouletteDrawNotice(roulette);
      });
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
    if (me?.hasCalledUno && !beforeMe?.hasCalledUno) this.showToast('UNO!');
    if(previous.gameState.status==='playing' && previous.gameState.roomId===current.gameState.roomId) playPowerSound(previous.gameState,current.gameState);
    if (previous.gameState.mode !== current.gameState.mode || previous.gameState.status !== 'playing' || previous.gameState.roomId !== current.gameState.roomId || matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('reduced-motion')) return;
    animatePowerCard(this, previous.gameState);
    if (current.gameState.mode === 'no_mercy') this.animateNoMercyAction(previous, geometry);
    const newTop = current.gameState.topDiscard;
    if (newTop?.id !== previous.gameState.topDiscard?.id && geometry.hand.has(newTop?.id) && geometry.previewedCardId!==newTop.id) {
      const from = geometry.pending?.cardId === newTop.id ? geometry.pending : geometry.hand.get(newTop.id);
      this.travelClassicCard(from.rect, this.el.discardPile.querySelector('.game-card'), from.html, from.html);
    }
    const action = current.gameState.noMercyAction;
    const transfer = current.gameState.mode === 'no_mercy' && action?.id !== previous.gameState.noMercyAction?.id && action?.type === 'number' && [0, 7].includes(current.gameState.topDiscard?.value);
    const roulette = current.gameState.mode === 'no_mercy' && current.gameState.rouletteResult?.id !== previous.gameState.rouletteResult?.id;
    if (newTop?.id !== previous.gameState.topDiscard?.id && !geometry.hand.has(newTop?.id)) {
      const actor = current.gameState.lastPlay?.playerId || action?.playerId || previous.gameState.players[previous.gameState.currentTurn]?.id;
      const source = geometry.opponents.get(actor);
      if (source) {const html=renderCardHTML(newTop,{mode:current.gameState.mode,flipSide:current.gameState.flipSide});this.travelClassicCard(source,this.el.discardPile.querySelector('.game-card'),html,html);}
    }
    const oldIds = new Set(previous.myHand.map(c => c.id));
    current.myHand.filter(c => !transfer && !roulette && !oldIds.has(c.id)).forEach((card, index) => {
      const target = this.el.playerHandCards.querySelector(`[data-card-id="${card.id}"] .game-card`);
      this.travelClassicCard(geometry.pending?.type === 'draw_card' ? geometry.pending.rect : geometry.deck, target, renderCardBackHTML(false, false, current.gameState.mode), renderCardHTML(card, { mode: current.gameState.mode, flipSide: current.gameState.flipSide }), Math.min(index * 35, 210));
    });
    for (const player of current.gameState.players.filter(p => p.id !== this.playerId)) {
      const before = previous.gameState.players.find(p => p.id === player.id);
      const fan = this.el.opponentsRow.querySelector(`[data-profile-id="${player.id}"] .opponent-fan-card:last-child img`);
      const target = fan?.getClientRects().length ? fan : this.el.opponentsRow.querySelector(`[data-profile-id="${player.id}"] .opponent-avatar`);
      for (let i = 0; !transfer && !roulette && i < Math.min(6, Math.max(0, player.cardCount - (before?.cardCount ?? player.cardCount))); i++) this.travelClassicCard(geometry.deck, target, renderCardBackHTML(false, false, current.gameState.mode), null, i * 65);
    }
    // Move retained cards into their new fan positions without a layout snap.
    this.el.playerHandCards.querySelectorAll('[data-card-id]').forEach(el => {
      const old = geometry.hand.get(el.dataset.cardId); if (!old) return;
      this.handShiftAnimations ||=new WeakMap();this.handShiftAnimations.get(el)?.cancel();
      const now = el.getBoundingClientRect();
      if (Math.abs(old.rect.left - now.left) > 1 || Math.abs(old.rect.top-now.top)>1) this.handShiftAnimations.set(el,el.animate([{ transform: `translate(${old.rect.left - now.left}px,${old.rect.top - now.top}px) ${el.style.transform}` }, { transform: el.style.transform }], { duration: 220, easing: 'cubic-bezier(.2,.7,.25,1)' }));
    });
  }

  renderLobby() {
    if (this.gameState.mode === 'classic') { this.clearClassicAnimations(); clearInterval(this.turnTimerInterval); this.turnTimerInterval = null; }

    if (this.el.lobbyCodeText) {
      this.el.lobbyCodeText.textContent = this.gameState.roomId || this.roomId || '------';
    }

    const me = this.gameState.players.find((p) => p.id === this.playerId);
    const isHost = me?.isHost || false;
    const policy = this.gameState.modeSelectionPolicy || 'selectable';
    const playerCount = this.gameState.players.length;
    const mode = this.gameState.mode || 'classic';

    const modeDetails = {
      classic: {
        title: 'CLASSIC UNO',
        desc: 'Standard 108 cards · Official rules · Up to 10 players',
        icon: '🎴'
      },
      flip: {
        title: 'UNO FLIP',
        desc: 'Dual-sided cards · Light & Dark sides · Up to 6 players',
        icon: '🔄'
      },
      no_mercy: {
        title: "SHOW 'EM NO MERCY",
        desc: '168 cards · Stacking & Knockout · Up to 6 players',
        icon: '🔥'
      }
    };
    const currentModeInfo = modeDetails[mode] || modeDetails.classic;

    if (policy === 'fixed') {
      // Flow: Mode-Specific Setup -> Players lobby within the exact same mode background
      document.body.classList.remove('in-room');
      document.body.classList.remove('in-arena');
      document.body.classList.add('in-mode-lobby');
      document.body.classList.toggle('in-flip-setup', mode === 'flip');
      document.body.classList.toggle('in-no-mercy-setup', mode === 'no_mercy');
      document.body.classList.toggle('in-classic-setup', mode === 'classic');

      this.el.arenaView.style.display = 'none';
      this.el.modeHomeScreen.hidden = true;
      document.getElementById('entryFormSection').style.display = 'none';
      this.el.modeSetupSection.hidden = false;
      this.el.modeSetupSection.classList.toggle('mode-flip-setup', mode === 'flip');
      this.el.modeSetupSection.classList.toggle('mode-no-mercy-setup', mode === 'no_mercy');
      this.el.modeSetupSection.classList.toggle('mode-classic-setup', mode === 'classic');

      // Hide center forms & back buttons in all containers; show lobby slot in active container
      const nmCard = document.querySelector('.nm-card-container');
      const nmBack = document.getElementById('noMercyBackBtn');
      if (nmCard) nmCard.style.display = 'none';
      if (nmBack) nmBack.style.display = 'none';

      const flipCard = document.getElementById('flipCardWrapper');
      const flipBack = document.getElementById('flipBackToModesBtn');
      if (flipCard) flipCard.style.display = 'none';
      if (flipBack) flipBack.style.display = 'none';

      const classicHeading = document.querySelector('.mode-setup-heading');
      const classicLayout = document.querySelector('.mode-setup-layout');
      const classicBack = document.getElementById('backToModesBtn');
      if (classicHeading) classicHeading.style.display = 'none';
      if (classicLayout) classicLayout.style.display = 'none';
      if (classicBack) classicBack.style.display = 'none';

      // Move #lobbySection into the active mode lobby slot
      let targetSlot = this.el.classicLobbySlot;
      if (mode === 'flip') targetSlot = this.el.flipLobbySlot;
      else if (mode === 'no_mercy') targetSlot = this.el.noMercyLobbySlot;

      if (targetSlot && this.el.lobbySection.parentElement !== targetSlot) {
        targetSlot.appendChild(this.el.lobbySection);
      }
      if (this.el.noMercyLobbySlot) this.el.noMercyLobbySlot.style.display = mode === 'no_mercy' ? 'block' : 'none';
      if (this.el.flipLobbySlot) this.el.flipLobbySlot.style.display = mode === 'flip' ? 'block' : 'none';
      if (this.el.classicLobbySlot) this.el.classicLobbySlot.style.display = mode === 'classic' ? 'block' : 'none';

      this.el.lobbySection.style.display = 'block';
      this.el.lobbySection.className = `mode-specific-lobby lobby-theme-${mode}`;

      // Mode Lobby Header Controls
      if (this.el.modeLobbyHeader) this.el.modeLobbyHeader.style.display = 'flex';
      if (this.el.modeLobbyBadge) {
        this.el.modeLobbyBadge.className = `mode-lobby-pill ${mode}`;
        this.el.modeLobbyBadge.textContent = `${currentModeInfo.icon} ${currentModeInfo.title}`;
      }
      if (this.el.modeLobbyCenterLogo) {
        this.el.modeLobbyCenterLogo.style.display = mode === 'no_mercy' ? 'block' : 'none';
      }

      // Hide 3-mode selector and generic compact display
      if (this.el.lobbyModeSelectContainer) this.el.lobbyModeSelectContainer.style.display = 'none';
      if (this.el.modeSelectorGrid) this.el.modeSelectorGrid.style.display = 'none';
      if (this.el.lobbyModeDisplay) this.el.lobbyModeDisplay.style.display = 'none';

    } else {
      // Flow: Direct Create Room -> Generic wooden lobby with 3 mode choices
      document.body.classList.add('in-room');
      document.body.classList.remove('in-arena');
      document.body.classList.remove('in-mode-lobby', 'in-mode-setup', 'in-no-mercy-setup', 'in-flip-setup', 'in-classic-setup');

      this.el.entryView.style.display = 'block';
      this.el.arenaView.style.display = 'none';
      this.el.modeSetupSection.hidden = true;
      this.el.modeSetupSection.classList.remove('mode-no-mercy-setup', 'mode-flip-setup', 'mode-classic-setup');
      this.el.modeHomeScreen.hidden = true;
      document.getElementById('entryFormSection').style.display = 'none';

      // Move #lobbySection back to generic slot if needed
      if (this.el.genericLobbySlot && this.el.lobbySection.parentElement !== this.el.genericLobbySlot) {
        this.el.genericLobbySlot.appendChild(this.el.lobbySection);
      }
      this.el.lobbySection.style.display = 'block';
      this.el.lobbySection.className = '';

      if (this.el.modeLobbyHeader) this.el.modeLobbyHeader.style.display = 'none';
      if (this.el.modeLobbyCenterLogo) this.el.modeLobbyCenterLogo.style.display = 'none';

      // 3-mode selector for Direct Create Room
      if (this.el.lobbyModeSelectContainer) this.el.lobbyModeSelectContainer.style.display = 'block';
      if (this.el.lobbyModeDisplay) this.el.lobbyModeDisplay.style.display = 'none';
      if (this.el.lobbyModeSelectHeading) {
        this.el.lobbyModeSelectHeading.textContent = 'Game Mode';
      }
      if (this.el.modeSelectorGrid) {
        this.el.modeSelectorGrid.style.display = 'grid';
        this.el.modeSelectorGrid.removeAttribute('aria-hidden');
        const disableFlipAndMercy = playerCount > 6;
        this.el.modeSelectorGrid.innerHTML = `
          <button class="mode-card-btn ${this.gameState.mode === 'classic' ? 'selected' : ''}" data-mode="classic" ${!isHost ? 'disabled' : ''} type="button" title="${isHost ? 'Select Classic UNO' : 'Current Mode: Classic UNO'}">
            <span class="lobby-mode-art mode-art-classic" aria-hidden="true"><img src="./assets/classic-cards-svg/red-skip.svg" alt="" decoding="async" width="68" height="104"><img src="./assets/classic-cards-svg/blue-reverse.svg" alt="" decoding="async" width="68" height="104"><img src="./assets/classic-cards-svg/green-draw2.svg" alt="" decoding="async" width="68" height="104"><img src="./assets/classic-cards-svg/wild-draw4.svg" alt="" decoding="async" width="68" height="104"></span>
            <strong>Classic</strong>
            <span style="font-size: 0.72rem; color: #94A3B8;">108 Cards • Standard UNO</span>
          </button>
          <button class="mode-card-btn ${this.gameState.mode === 'flip' ? 'selected' : ''}" data-mode="flip" ${!isHost || disableFlipAndMercy ? 'disabled' : ''} type="button" title="${!isHost ? 'Current Mode: UNO Flip' : (disableFlipAndMercy ? 'Max 6 players for Flip' : 'Select UNO Flip')}">
            <span class="lobby-mode-art mode-art-flip" aria-hidden="true"><img src="./assets/flip-cards/Pink_SKIP_EVERYONE.jpg" alt="" decoding="async" width="68" height="104"><img src="./assets/flip-cards/Orange_DRAW_FIVE.jpg" alt="" decoding="async" width="68" height="104"><img src="./assets/flip-cards/Teal_REVERSE.jpg" alt="" decoding="async" width="68" height="104"><img src="./assets/flip-cards/Purple_FLIP.jpg" alt="" decoding="async" width="68" height="104"></span>
            <strong>UNO Flip</strong>
            <span style="font-size: 0.72rem; color: #94A3B8;">Double-Sided • Dark Side</span>
          </button>
          <button class="mode-card-btn ${this.gameState.mode === 'no_mercy' ? 'selected' : ''}" data-mode="no_mercy" ${!isHost || disableFlipAndMercy ? 'disabled' : ''} type="button" title="${!isHost ? 'Current Mode: No Mercy' : (disableFlipAndMercy ? 'Max 6 players for No Mercy' : 'Select No Mercy')}">
            <span class="lobby-mode-art mode-art-mercy" aria-hidden="true"><img src="./assets/no-mercy-cards/red_discard_all.webp" alt="" decoding="async" width="68" height="104"><img src="./assets/no-mercy-cards/wild_draw6.webp" alt="" decoding="async" width="68" height="104"><img src="./assets/no-mercy-cards/wild_roulette.webp" alt="" decoding="async" width="68" height="104"><img src="./assets/no-mercy-cards/wild_draw10.webp" alt="" decoding="async" width="68" height="104"></span>
            <strong>No Mercy</strong>
            <span style="font-size: 0.72rem; color: #94A3B8;">168 Cards • Knockout</span>
          </button>
        `;
        if (isHost) {
          this.el.modeSelectorGrid.querySelectorAll('.mode-card-btn:not(:disabled)').forEach((btn) => {
            btn.addEventListener('click', (e) => {
              const selectedMode = e.currentTarget.dataset.mode;
              if (selectedMode && selectedMode !== this.gameState.mode) {
                this.send({ type: 'set_mode', data: { mode: selectedMode } });
              }
            });
          });
        }
      }
    }

    const maxPlayers = this.gameState.mode === 'classic' ? 10 : 6;
    if (this.el.lobbyPlayersHeading) {
      this.el.lobbyPlayersHeading.textContent = mode === 'no_mercy' ? `PLAYERS • ${playerCount}/${maxPlayers}` : `Players · ${playerCount}/${maxPlayers}`;
    }

    // Sync Game Rules modal if open while in lobby
    if (this.el.settingsModal?.classList.contains('active') && this.rulesModalContext === 'lobby') {
      const mode = this.gameState.mode || 'classic';
      const rules = this.gameState.houseRules || defaultHouseRules(mode);
      this.syncGameRulesModalInputs(mode, rules, !isHost, isHost);
    }

    // Render Players
    const connectedPlayersHtml = this.gameState.players
      .map(
        (p) => `
        <div class="lobby-player-row lobby-player-card ${p.id === this.playerId ? 'is-self' : ''}">
          <div class="lobby-player-info">
            ${this.renderAvatarHtml(p, 'lobby-player-avatar')}
            <div class="lobby-player-meta">
              <strong class="lobby-player-name">${escapeHtml(p.name)}</strong>
              <div class="lobby-player-tags">
                ${p.isHost ? '<span class="player-role-badge host-badge">HOST 👑</span>' : ''}
                ${p.isBot ? '<span class="player-role-badge bot-badge">BOT 🤖</span>' : ''}
                ${p.id === this.playerId ? '<span class="player-role-badge self-badge">(You)</span>' : ''}
              </div>
            </div>
          </div>
          <div class="lobby-player-status">
            <span class="ready-pill ${p.isReady ? 'ready' : 'waiting'}">
              ${p.isReady ? '✓ READY' : 'WAITING'}
            </span>
            ${isHost && p.isBot ? `<button class="remove-bot-btn" data-bot-id="${p.id}" type="button" aria-label="Remove bot" title="Remove bot">✕</button>` : ''}
          </div>
        </div>
      `
      )
      .join('');

    const emptySlotsCount = Math.max(0, maxPlayers - playerCount);
    let emptySlotsHtml = '';
    if (emptySlotsCount === 1) {
      emptySlotsHtml = `
        <div class="lobby-player-empty lobby-player-card">
          <div class="lobby-player-info">
            <div class="lobby-empty-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div class="lobby-player-meta">
              <span class="lobby-empty-label">Waiting for player…</span>
            </div>
          </div>
          <div class="lobby-player-status">
            <span class="empty-seat-pill">Open Seat</span>
          </div>
        </div>
      `;
    } else if (emptySlotsCount > 1) {
      emptySlotsHtml = `
        <div class="lobby-player-empty lobby-player-card lobby-empty-summary">
          <div class="lobby-player-info">
            <div class="lobby-empty-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div class="lobby-player-meta">
              <span class="lobby-empty-label">Waiting for players…</span>
            </div>
          </div>
          <div class="lobby-player-status">
            <span class="empty-seat-pill">${emptySlotsCount} Open Seats</span>
          </div>
        </div>
      `;
    }

    this.el.lobbyPlayersList.innerHTML = connectedPlayersHtml + emptySlotsHtml;

    this.el.lobbyPlayersList.querySelectorAll('.remove-bot-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const botId = e.currentTarget.dataset.botId;
        if (botId) this.send({ type: 'remove_bot', data: { botId } });
      });
    });

    const hostControls = document.getElementById('lobbyHostControls');
    if (hostControls) {
      hostControls.style.display = isHost ? 'flex' : 'none';
      if (this.el.addBotBtn) this.el.addBotBtn.style.display = isHost ? 'inline-flex' : 'none';
      if (this.el.shuffleSeatsBtn) this.el.shuffleSeatsBtn.style.display = isHost ? 'inline-flex' : 'none';
    }

    const allReady = this.gameState.players.length >= 2 && this.gameState.players.every((p) => p.isReady);
    const unreadyPlayers = this.gameState.players.filter((p) => !p.isReady);

    const startHint = document.getElementById('lobbyStartHint');
    if (startHint) {
      if (playerCount < 2) {
        startHint.textContent = isHost ? 'Waiting for at least 2 players to start' : 'Waiting for more players to join…';
      } else if (!allReady) {
        const count = unreadyPlayers.length;
        startHint.textContent = `Waiting for ${count === 1 ? '1 player' : `${count} players`} to be ready`;
      } else {
        startHint.textContent = isHost ? 'All players ready! Host can start the game.' : 'All players ready! Waiting for host to start.';
      }
    }

    // Host controls
    if (isHost) {
      this.el.startGameBtn.style.display = 'inline-flex';
      this.el.startGameBtn.disabled = !allReady;
      this.el.startGameBtn.textContent = 'START GAME ▶';
    } else {
      this.el.startGameBtn.style.display = 'none';
    }

    // Ready button state
    if (me?.isReady) {
      this.el.readyBtn.classList.add('is-ready');
      this.el.readyBtn.textContent = 'CANCEL READY ✕';
      this.el.readyBtn.style.background = '';
    } else {
      this.el.readyBtn.classList.remove('is-ready');
      this.el.readyBtn.textContent = 'I AM READY ✓';
      this.el.readyBtn.style.background = '';
    }
  }

  renderArena() {
    document.body.classList.add('in-room');
    document.body.classList.add('in-arena');
    document.body.classList.remove('in-mode-lobby', 'in-mode-setup');
    if (this.el.modeSetupSection) this.el.modeSetupSection.hidden = true;
    document.body.classList.toggle('no-mercy-arena', this.gameState.mode === 'no_mercy');
    document.body.classList.toggle('classic-arena', this.gameState.mode === 'classic');
    document.body.classList.toggle('classic-many-players', this.gameState.mode === 'classic' && this.gameState.players.length > 6);
    this.el.entryView.style.display = 'none';
    this.el.arenaView.style.display = 'flex';

    const { gameState, myHand, isMyTurn, canPlayCards, canDraw, canCallUno, canCatchUno } = this.clientView;
    document.body.classList.toggle('classic-draw4-response', gameState.mode === 'classic' && isMyTurn && gameState.pendingAction?.type === 'draw4_challenge');

    const controls = this.el.btnDrawAction.closest('.table-action-bar');
    const controlsParent = this.el.tableFelt;
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
    if (this.el.directionArrow) {
      this.el.directionArrow.className = `direction-arrow ${!isClockwise ? 'counter-clockwise' : ''}`;
      this.el.directionArrow.textContent = isClockwise ? '↻' : '↺';
    }
    if (this.el.directionText) {
      this.el.directionText.textContent = '';
      this.el.directionText.style.display = 'none';
    }

    // Opponents (Keyed DOM diffing to eliminate layout churn and micro-stutter)
    const opponents = gameState.players.filter((p) => p.id !== this.playerId);
    this.renderOpponents(opponents, gameState);

    // Keyed Discard Pile
    const discardKey = gameState.topDiscard ? `${gameState.topDiscard.id}_${gameState.flipSide}_${gameState.mode}` : 'empty';
    if (this.lastRenderedDiscardKey !== discardKey) {
      this.lastRenderedDiscardKey = discardKey;
      if (gameState.topDiscard) {
        this.el.discardPile.innerHTML = renderCardHTML(gameState.topDiscard, {
          mode: gameState.mode,
          flipSide: gameState.flipSide,
        });
      } else {
        this.el.discardPile.innerHTML = '';
      }
    }

    // Keyed Draw Pile
    const drawKey = `${gameState.mode}_${gameState.flipSide}`;
    if (this.lastRenderedDrawKey !== drawKey) {
      this.lastRenderedDrawKey = drawKey;
      this.el.drawPile.innerHTML = renderCardBackHTML(
        gameState.mode === 'flip' && gameState.flipSide === 'dark',
        false,
        gameState.mode,
      );
    }
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
    setActionVisible(this.el.btnPassAction,canPass);

    // UNO and Catch buttons
    this.el.btnUnoAction.disabled = !canCallUno;
    setActionVisible(this.el.btnUnoAction,myHand.length >= 1 && myHand.length <= 2 && canCallUno);
    this.el.btnUnoAction.textContent = 'Call UNO';
    if (canCatchUno) {
      const caughtPlayer = gameState.players.find((p) => p.id === canCatchUno);
      setActionVisible(this.el.btnCatchAction,true);
      this.el.btnCatchAction.textContent = 'Caught';
      this.el.btnCatchAction.setAttribute('aria-label', `Catch ${caughtPlayer?.name} for missed UNO`);
    } else {
      setActionVisible(this.el.btnCatchAction,false);
    }

    if (gameState.mode === 'classic') {
      let challenge = document.getElementById('classicChallenge');
      if (!challenge) { challenge = document.createElement('button'); challenge.id = 'classicChallenge'; challenge.className = 'action-btn btn-challenge'; challenge.type = 'button'; this.el.btnDrawAction.parentElement.insertBefore(challenge, this.el.btnUnoAction); }
      const pending = gameState.pendingAction;
      challenge.hidden = !(isMyTurn && pending?.type === 'draw4_challenge');
      challenge.textContent = 'Challenge Draw Four';
      if (isMyTurn && pending?.type === 'draw4_challenge') this.el.btnDrawAction.textContent = 'Accept +4';
      challenge.onclick = () => { if (this.isPlayInFlight) return; this.isPlayInFlight = true; this.send({ type: 'challenge_draw4' }); };
      let accept = document.getElementById('classicAcceptDrawFour');
      if (!accept) { accept = document.createElement('button'); accept.id = 'classicAcceptDrawFour'; accept.className = 'action-btn btn-draw'; accept.textContent = 'ACCEPT +4'; challenge.before(accept); }
      accept.hidden = challenge.hidden;
      accept.onclick = () => { if (this.isPlayInFlight) return; this.isPlayInFlight = true; this.send({ type: 'draw_card' }); };
      if (isMyTurn && pending?.type === 'opening_color' && !this.el.colorPickerModal.classList.contains('active')) this.openColorPicker();
    }
    // Render Local Player Profile Bar (Unified across all modes)
    const me = gameState.players.find(p => p.id === this.playerId);
    if (this.el.localPlayerProfile) {
      if (gameState.status === 'playing') {
        this.el.localPlayerProfile.style.display = 'flex';
        this.el.localPlayerProfile.classList.toggle('active-turn', isMyTurn);
        const localUnoDeclaredHtml = (myHand.length === 1 && (me?.hasCalledUno || this.isUnoArmed))
          ? '<span class="uno-declared-badge" style="margin-left: 8px;">✓ UNO DECLARED</span>'
          : '';

        const localProfileHTML = `
          <div class="local-profile-left">
            <div class="local-avatar">
              ${this.classicAvatarInner(me)}
              ${isMyTurn && gameState.status === 'playing' && !!gameState.turnDeadline ? `
                <div class="avatar-turn-timer-wrap" aria-label="Turn timer">
                  <svg class="avatar-turn-ring" viewBox="0 0 54 54">
                    <circle class="avatar-turn-bg" cx="27" cy="27" r="22" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="4"></circle>
                    <circle class="avatar-turn-circle" cx="27" cy="27" r="22" fill="none" stroke="#f0ba28" stroke-width="4" stroke-dasharray="138.23" stroke-dashoffset="0"></circle>
                  </svg>
                  <span class="avatar-turn-seconds"></span>
                </div>
              ` : ''}
            </div>
            <div class="local-info">
              <div class="local-name">${escapeHtml(me?.name || 'Player')}</div>
              <div class="local-cards-count">${myHand.length} card${myHand.length === 1 ? '' : 's'}${gameState.mode === 'classic' ? ` · ${me?.score || 0} pts` : ''}</div>
            </div>
          </div>
          ${localUnoDeclaredHtml}
        `;
        if(this.lastLocalProfileHTML!==localProfileHTML){this.lastLocalProfileHTML=localProfileHTML;this.el.localPlayerProfile.innerHTML=localProfileHTML;this.turnTimerDOMChanged=true;}
      } else {
        this.el.localPlayerProfile.style.display = 'none';
      }
    }

    // The single authoritative UNO control is shown for one or two cards until UNO is declared.
    if (this.el.contextualUnoContainer) this.el.contextualUnoContainer.style.display = 'none';

    // Synchronized Turn Timer (invoked after all DOM elements are mounted)
    this.updateTurnTimer(gameState.turnDeadline, isMyTurn, gameState.status);
    this.syncFullscreenState();

    // Player Hand Cards
    this.renderPlayerHand(myHand, canPlayCards, gameState.mode, gameState.flipSide);

    // Game Over Check
    if (gameState.status === 'game_over' || gameState.status === 'round_over') {
      this.showGameOver(gameState);
    }
  }

  renderOpponents(opponents, gameState) {
    this.el.opponentsRow.dataset.opponentCount = String(opponents.length);
    const avatarPalettes = ['#1e3a8a', '#065f46', '#78350f', '#831843', '#4c1d95'];
    const activeIds = new Set(opponents.map((p) => p.id));

    // 1. Prune removed opponents
    for (const [id, el] of this.opponentElements.entries()) {
      if (!activeIds.has(id)) {
        el.remove();
        this.opponentElements.delete(id);
      }
    }

    // 2. Keyed update or creation
    opponents.forEach((p, idx) => {
      const isCurrent = gameState.players[gameState.currentTurn]?.id === p.id;
      const unoActive = p.cardCount === 1;
      const avatarColor = avatarPalettes[idx % avatarPalettes.length];
      const canCatchThis =
        ((this.clientView?.canCatchUnoTargets?.includes(p.id) || this.clientView?.canCatchUno === p.id) ||
          (p.cardCount === 1 && !p.hasCalledUno && !p.isEliminated)) &&
        p.id !== this.playerId;

      let wrapper = this.opponentElements.get(p.id);
      const isNew = !wrapper;
      if (isNew) {
        wrapper = document.createElement('div');
        wrapper.className = 'opponent-wrapper opponent-box';
        wrapper.dataset.profileId = p.id;
        wrapper.dataset.playerId = p.id;
        this.opponentElements.set(p.id, wrapper);
        this.el.opponentsRow.appendChild(wrapper);
      }

      // Keep correct DOM child order
      if (this.el.opponentsRow.children[idx] !== wrapper) {
        this.el.opponentsRow.insertBefore(wrapper, this.el.opponentsRow.children[idx] || null);
      }

      let badge = wrapper.querySelector('.opponent-card-badge');
      if (!badge) {
        badge = document.createElement('div');
        wrapper.appendChild(badge);
      }
      badge.className = `opponent-card-badge ${isCurrent ? 'active-turn' : ''} ${p.isEliminated ? 'eliminated' : ''}`;

      // Avatar
      let avatar = badge.querySelector('.opponent-avatar');
      if (!avatar) {
        avatar = document.createElement('div');
        avatar.className = 'opponent-avatar';
        badge.appendChild(avatar);
      }
      avatar.style.background = isCurrent ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : avatarColor;

      const avatarContent = this.classicAvatarInner(p);
      const needsTimer = isCurrent && gameState.status === 'playing' && !!gameState.turnDeadline;
      let timerWrap = avatar.querySelector('.avatar-turn-timer-wrap');
      if (needsTimer) {
        if (!timerWrap) {
          avatar.innerHTML = `<span class="avatar-content">${avatarContent}</span>
            <div class="avatar-turn-timer-wrap" aria-label="Turn timer">
              <svg class="avatar-turn-ring" viewBox="0 0 54 54">
                <circle class="avatar-turn-bg" cx="27" cy="27" r="22" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="4"></circle>
                <circle class="avatar-turn-circle" cx="27" cy="27" r="22" fill="none" stroke="#f0ba28" stroke-width="4" stroke-dasharray="138.23" stroke-dashoffset="0"></circle>
              </svg>
              <span class="avatar-turn-seconds"></span>
            </div>`;
        }
      } else {
        if (timerWrap) timerWrap.remove();
        if(timerWrap||avatar._renderedContent!==avatarContent){avatar.innerHTML = `<span class="avatar-content">${avatarContent}</span>`;avatar._renderedContent=avatarContent;}
      }

      // Info
      let info = badge.querySelector('.opponent-info');
      if (!info) {
        info = document.createElement('div');
        info.className = 'opponent-info';
        badge.appendChild(info);
      }
      const countText = p.isEliminated
        ? 'KNOCKED OUT'
        : `${p.cardCount} card${p.cardCount === 1 ? '' : 's'}${gameState.mode === 'classic' ? ` · ${p.score || 0} pts` : ''}`;
      const nameHtml = `${escapeHtml(p.name)} ${p.isBot ? '<span class="mini-bot-tag" title="AI Bot">BOT</span>' : ''}`;

      let disconnectBadge = '';
      if (!p.isConnected && p.disconnectedAt) {
        const elapsedSec = Math.floor((Date.now() - p.disconnectedAt) / 1000);
        const leftSec = Math.max(0, 60 - elapsedSec);
        disconnectBadge = `<span class="disconnect-countdown-badge" data-disconnected-at="${p.disconnectedAt}" title="Your opponent can reconnect to this seat">RECONNECTING · SEAT SAVED</span>`;
      }
      const opponentInfoHTML = `
        <div class="opponent-name">${nameHtml}</div>
        <div class="opponent-cards-count">${countText}</div>
        ${disconnectBadge}
      `;
      if(info._renderedHTML!==opponentInfoHTML){info._renderedHTML=opponentInfoHTML;info.innerHTML=opponentInfoHTML;}

      // UNO status
      let unoStatusSlot = badge.querySelector('.uno-status-slot');
      if (!unoStatusSlot) {
        unoStatusSlot = document.createElement('div');
        unoStatusSlot.className = 'uno-status-slot';
        badge.appendChild(unoStatusSlot);
      }
      let unoStatusHtml = '';
      if (unoActive && !p.isEliminated && gameState.status === 'playing') {
        unoStatusHtml = (p.hasCalledUno ? '<span class="uno-declared-badge">UNO!</span>' : '') +
          '<button class="opponent-caught-btn" data-catch-target="' + p.id + '" type="button">CAUGHT</button>';
      }
      if (unoStatusSlot.innerHTML !== unoStatusHtml) {
        const oldCatch=unoStatusSlot.querySelector('.opponent-caught-btn');
        if(oldCatch)exitControl(oldCatch);
        unoStatusSlot.innerHTML = unoStatusHtml;
        jumpControl(unoStatusSlot.querySelector('.opponent-caught-btn'));
      }

      // Fan cards: only recalculate if count, flipSide, or mode changed
      const fanKey = `${p.cardCount}_${gameState.flipSide}_${gameState.mode}_${p.isEliminated}`;
      if (wrapper.dataset.renderedFanKey !== fanKey) {
        wrapper.dataset.renderedFanKey = fanKey;
        let fanEl = wrapper.querySelector('.opponent-cards-fan');
        if (p.isEliminated || p.cardCount <= 0) {
          if (fanEl) fanEl.remove();
        } else {
          if (!fanEl) {
            fanEl = document.createElement('div');
            fanEl.className = 'opponent-cards-fan';
            fanEl.setAttribute('aria-hidden', 'true');
            wrapper.appendChild(fanEl);
          }
          const fanCardsCount = Math.min(Math.max(p.cardCount, 1), 10);
          fanEl.innerHTML = '';
          const spread = fanCardsCount > 1 ? Math.min(44 / (fanCardsCount - 1), 9) : 0;
          const startAngle = -((fanCardsCount - 1) * spread) / 2;
          let fanInner = '';
          for (let c = 0; c < fanCardsCount; c++) {
            const rot = startAngle + c * spread;
            const offset = c - (fanCardsCount - 1) / 2;
            const arc = fanCardsCount > 1 ? Math.pow(offset / ((fanCardsCount - 1) / 2), 2) * 7 : 0;
            fanInner += `<div class="opponent-fan-card opponent-card-back" data-card-index="${c}" style="--fan-offset:${offset}; transform: translateX(calc(var(--fan-offset) * var(--opponent-fan-step, 17px))) translateY(${arc.toFixed(1)}px) rotate(${rot.toFixed(1)}deg); z-index: ${c + 1};">
              ${renderCardBackHTML(gameState.flipSide === 'dark', true, gameState.mode)}
            </div>`;
          }
          fanEl.innerHTML = fanInner;
        }
      }
    });
  }

  renderPlayerHand(hand, canPlayIds, mode, flipSide) {
    hand=sortedHand(hand,this.handSort,mode,flipSide);
    const container = this.el.playerHandCards;
    const count = hand.length;
    const handKey=[mode,flipSide,this.handSort,this.selectedCardId,innerWidth,innerHeight,hand.map(c=>c.id).join(','),canPlayIds.join(',')].join('|');
    if(this.lastHandRenderKey===handKey&&container.querySelectorAll('[data-card-id]').length===count){this.performanceMetrics?.bump('handSkips');return;}
    this.lastHandRenderKey=handKey;this.performanceMetrics?.bump('handRenders');
    if (count === 0) {
      container.innerHTML = '';
      this.handCardElements.clear();
      return;
    }

    const isMobile = document.body.classList.contains('mobile-viewport') || window.innerWidth <= 800;
    // On mobile, if > 7 cards, use two compact rows. On desktop, if > 14 cards, use two rows.
    const useTwoRows = false; // Hands expand horizontally; never shrink into a second row.
    container.classList.toggle('two-rows', useTwoRows);

    // Track active card IDs and prune departed DOM nodes
    const newCardIds = new Set(hand.map(c => c.id));
    for (const [id, el] of this.handCardElements.entries()) {
      if (!newCardIds.has(id) && id !== this.inFlightCardId) {
        el.remove();
        this.handCardElements.delete(id);
      }
    }

    let row1El = container.querySelector('.hand-row-top') || container.querySelector('.hand-row-single');
    let row2El = container.querySelector('.hand-row-bottom');

    if (useTwoRows) {
      if (!container.querySelector('.hand-row-top')) {
        container.innerHTML = '';
        row1El = document.createElement('div');
        row1El.className = 'hand-row hand-row-top';
        row2El = document.createElement('div');
        row2El.className = 'hand-row hand-row-bottom';
        container.appendChild(row1El);
        container.appendChild(row2El);
      }
      const row1Count = Math.ceil(count / 2);
      const row1Cards = hand.slice(0, row1Count);
      const row2Cards = hand.slice(row1Count);

      this.populateHandRow(row1El, row1Cards, 0, canPlayIds, mode, flipSide, isMobile);
      this.populateHandRow(row2El, row2Cards, row1Count, canPlayIds, mode, flipSide, isMobile);
    } else {
      if (!container.querySelector('.hand-row-single')) {
        container.innerHTML = '';
        row1El = document.createElement('div');
        row1El.className = 'hand-row hand-row-single';
        container.appendChild(row1El);
      }
      this.populateHandRow(row1El, hand, 0, canPlayIds, mode, flipSide, isMobile);
    }
  }

  populateHandRow(rowEl, rowCards, startIndex, canPlayIds, mode, flipSide, isMobile) {
    const rowCount = rowCards.length;
    const landscape = window.innerWidth > window.innerHeight;
    const cardH = isMobile ? (landscape ? Math.min(112, Math.max(68, innerHeight * .25)) : Math.min(142, Math.max(110, innerHeight * .18))) : Math.min(158, Math.max(118, innerHeight * .22));
    const maxCardW = Math.round(cardH * .68);
    this.el.playerHandCards.style.setProperty('--local-card-height',cardH+'px');
    this.el.playerHandCards.style.setProperty('--local-card-width',maxCardW+'px');
    const parentContainer = this.el.playerHandCards.parentElement;
    const containerW = (parentContainer && parentContainer.clientWidth) || this.el.playerHandCards.clientWidth || (isMobile ? window.innerWidth - 24 : window.innerWidth);
    const availableW = Math.max(160, Math.min(containerW - (isMobile ? 26 : 14), window.innerWidth - 36));

    const naturalTotal = rowCount * maxCardW;
    const needsOverlap = naturalTotal > availableW && rowCount > 1;
    const overlapMargin = needsOverlap
      ? -Math.min(maxCardW - Math.min(28, maxCardW * .3), Math.max(Math.round(maxCardW * .20), Math.ceil((naturalTotal - availableW) / (rowCount - 1))))
      : (rowCount > 1 ? -Math.round(maxCardW * .38) : 0);

    const maxAngle = Math.min(Math.max(0, rowCount - 1) * 6, 32);
    const startAngle = rowCount > 1 ? -maxAngle / 2 : 0;
    const angleStep = rowCount > 1 ? maxAngle / (rowCount - 1) : 0;

    const rowWidth = maxCardW + Math.max(0,rowCount - 1) * (maxCardW + overlapMargin);
    rowEl.style.width = Math.ceil(rowWidth + maxCardW * .6) + 'px';
    this.el.playerHandCards.style.setProperty('--local-hand-width', rowEl.style.width);
    const layoutKey = rowCards.map(card=>card.id).join(',') + ':' + innerWidth + ':' + innerHeight;
    if (rowEl.dataset.layoutKey !== layoutKey) {
      rowEl.dataset.layoutKey = layoutKey;
      requestAnimationFrame(()=>{ const scroller=this.el.playerHandCards.closest('.hand-scroll-container'); if(scroller)scroller.scrollLeft=Math.max(0,(scroller.scrollWidth-scroller.clientWidth)/2); });
    }

    rowCards.forEach((card, idx) => {
      const globalIdx = startIndex + idx;
      const isPlayable = canPlayIds.includes(card.id);
      const isSelected = this.selectedCardId === card.id;
      const rot = rowCount > 1 ? (startAngle + idx * angleStep).toFixed(1) : '0';

      let wrapper = this.handCardElements.get(card.id);
      const isNew = !wrapper;

      if (isNew) {
        wrapper = document.createElement('div');
        wrapper.dataset.cardId = card.id;
        wrapper.dataset.flipSide = flipSide || 'light';
        wrapper.innerHTML = renderCardHTML(card, { mode, flipSide });

        wrapper.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (wrapper.getAttribute('aria-disabled') === 'true') return;
          this.handleCardClick(card, wrapper);
        });
        wrapper.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (wrapper.getAttribute('aria-disabled') === 'true') return;
            this.handleCardClick(card, wrapper);
          }
        });
        wrapper.addEventListener('mouseenter', () => {
          this.send({ type: 'player_card_hovered', data: { cardIndex: Number(wrapper.dataset.handIndex) } });
        });
        wrapper.addEventListener('mouseleave', () => {
          this.send({ type: 'player_card_hovered', data: { cardIndex: null } });
        });

        wrapper.addEventListener('pointerdown', () => { clearTimeout(this.hoverClearTimer); this.send({ type: 'player_card_hovered', data: { cardIndex: Number(wrapper.dataset.handIndex) } }); });
        wrapper.addEventListener('pointerup', () => { this.hoverClearTimer = setTimeout(() => this.send({ type: 'player_card_hovered', data: { cardIndex: null } }), 250); });
        for (const event of ['pointercancel', 'blur']) wrapper.addEventListener(event, () => this.send({ type: 'player_card_hovered', data: { cardIndex: null } }));
        wrapper.addEventListener('focus', () => this.send({ type: 'player_card_hovered', data: { cardIndex: Number(wrapper.dataset.handIndex) } }));
        this.handCardElements.set(card.id, wrapper);
      } else {
        if (wrapper.dataset.flipSide !== (flipSide || 'light')) {
          wrapper.dataset.flipSide = flipSide || 'light';
          wrapper.innerHTML = renderCardHTML(card, { mode, flipSide });
        }
      }

      wrapper.dataset.handIndex = String(globalIdx);
      wrapper.className = `card-wrapper ${isPlayable ? 'playable' : 'unplayable'} ${isSelected ? 'is-selected' : ''}`;
      wrapper.style.zIndex = isSelected ? 200 : (idx + 1);
      wrapper.style.marginLeft = idx > 0 ? `${overlapMargin}px` : '0px';
      wrapper.setAttribute('role', 'button');
      wrapper.setAttribute('aria-disabled', String(!isPlayable));
      wrapper.setAttribute('tabindex', isPlayable ? '0' : '-1');

      const cardTitle = card.type === 'number' ? `${card.color || ''} ${card.value}` : `${card.color || ''} ${card.type}`;
      wrapper.setAttribute('aria-label', isPlayable ? `Play card: ${cardTitle}` : `Card: ${cardTitle}`);

      wrapper.style.setProperty('--card-rot', `${rot}deg`);
      wrapper.style.transform = isSelected ? 'translateY(-14px) rotate(0deg) scale(1.12)' : `rotate(${rot}deg)`;

      if (rowEl.children[idx] !== wrapper) {
        rowEl.appendChild(wrapper);
      }
    });
  }

  updateTurnTimer(deadline, isMyTurn, status) {
    const timerKey=[deadline,isMyTurn,status,this.gameState?.currentTurn].join('|');
    if(this.turnTimerKey===timerKey&&this.turnTimerInterval&&!this.turnTimerDOMChanged)return;
    this.turnTimerKey=timerKey;this.turnTimerDOMChanged=false;
    if (this.turnTimerInterval) {
      clearInterval(this.turnTimerInterval);
      this.turnTimerInterval = null;
    }
    this.activeTurnDeadline = deadline;
    this.activeTurnStatus = status;
    this.activeTurnIsMyTurn = Boolean(isMyTurn);

    let ringCircles = Array.from(document.querySelectorAll('.avatar-turn-circle, .classic-profile-ring circle'));
    let ringSvgs = Array.from(document.querySelectorAll('.avatar-turn-ring, .classic-profile-ring'));
    let secondsEls = Array.from(document.querySelectorAll('.avatar-turn-seconds, .classic-profile-seconds'));
    let discBadges = Array.from(document.querySelectorAll('.disconnect-countdown-badge'));
    let lastQuery = Date.now();

    const tick = () => {
      if (this.activeTurnStatus !== 'playing' || !this.activeTurnDeadline) {
        updateTurnStatus(this,0,false);
        if (this.turnTimerInterval) {
          clearInterval(this.turnTimerInterval);
          this.turnTimerInterval = null;
        }
        return;
      }

      const now = Date.now();
      // Periodically refresh cached element refs in case badges were dynamically added
      if (now - lastQuery > 1000) {
        ringCircles = Array.from(document.querySelectorAll('.avatar-turn-circle, .classic-profile-ring circle'));
        ringSvgs = Array.from(document.querySelectorAll('.avatar-turn-ring, .classic-profile-ring'));
        secondsEls = Array.from(document.querySelectorAll('.avatar-turn-seconds, .classic-profile-seconds'));
        discBadges = Array.from(document.querySelectorAll('.disconnect-countdown-badge'));
        lastQuery = now;
      }

      const remainingMs = Math.max(0, this.activeTurnDeadline - now);
      const durationMs = this.clientView?.turnDurationMs || (this.gameState?.houseRules?.turnDuration ? this.gameState.houseRules.turnDuration * 1000 : 30000);
      const fraction = Math.max(0, Math.min(1, remainingMs / durationMs));
      const remainingSec = Math.ceil(remainingMs / 1000);
      const ringOffset = (138.23 * (1 - fraction)).toFixed(2);
      const isCritical = remainingMs <= 5000;
      updateTurnStatus(this,remainingSec,isCritical);
      warnTurn(this,remainingSec);

      // Update disconnect countdown badges
      for (let i = 0; i < discBadges.length; i++) {
        const badge = discBadges[i];
        const discAt = Number(badge.dataset.disconnectedAt);
        if (discAt) {
          const leftSec = Math.max(0, 60 - Math.floor((now - discAt) / 1000));
          badge.textContent = 'RECONNECTING · SEAT SAVED';
        }
      }

      // Update the single active player's avatar turn ring
      for (let i = 0; i < ringCircles.length; i++) {
        ringCircles[i].style.strokeDashoffset = ringOffset;
      }
      for (let i = 0; i < ringSvgs.length; i++) {
        ringSvgs[i].classList.toggle('timer-critical', isCritical);
      }
      const secStr = `${remainingSec}s`;
      for (let i = 0; i < secondsEls.length; i++) {
        if (secondsEls[i].textContent !== secStr) {
          secondsEls[i].textContent = secStr;
        }
      }
    };

    tick();

    if (status === 'playing' && deadline > Date.now()) {
      this.turnTimerInterval = setInterval(tick, 100);
    }
  }

  handleCardClick(card, wrapperEl, previewFirst = false) {
    if (!this.clientView?.isMyTurn) {
      if (wrapperEl) {
        wrapperEl.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 160 });
      }
      return;
    }

    const canPlayIds = this.clientView.canPlayCards || [];
    const isPlayable = canPlayIds.includes(card.id);

    if (!isPlayable) {
      if (wrapperEl) {
        wrapperEl.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 180 });
      }
      sounds.playSnap?.(300, 0.05);
      return;
    }

    if (this.isPlayInFlight || this.connectionRecovering) return;
    if(previewFirst && this.selectedCardId!==card.id){
      this.selectedCardId=card.id;
      this.renderPlayerHand(this.clientView.myHand,this.clientView.canPlayCards,this.gameState.mode,this.gameState.flipSide);
      this.handCardElements.get(card.id)?.setAttribute('aria-label','Selected card. Tap again to play.');
      return;
    }
    this.selectedCardId=null;

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
    this.isPlayInFlight = true;
    clearTimeout(this.playFlightTimer);
    // The authoritative reply releases the play lock, not a short timer.

    sounds.playSnap();

    // Fly once from the captured hand position after the authoritative update.
    if (wrapperEl) {
      this.inFlightCardId = card.id;
      wrapperEl.style.opacity = '1';
    }

    this.send({
      type: 'play_card',
      data: { cardId: card.id },
    });
  }

  static BOT_ROSTER = [
    { name: 'RoboMax', avatar: '🤖', tag: 'Aggressive' },
    { name: 'CardBot 3000', avatar: '⚙️', tag: 'Balanced' },
    { name: 'UnoDroid', avatar: '🦾', tag: 'Tactical' },
    { name: 'BytePlayer', avatar: '💻', tag: 'Quick' },
    { name: 'MatrixMaster', avatar: '🌐', tag: 'Strategic' },
    { name: 'CyberAce', avatar: '⚡', tag: 'Wildcard' },
    { name: 'PixelPro', avatar: '👾', tag: 'Adaptive' },
    { name: 'CircuitChampion', avatar: '🏆', tag: 'Expert' },
  ];

  static COLOR_SVGS = {
    red: '<svg class="color-choice-svg" viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"><polygon points="12,2 22,12 12,22 2,12" fill="currentColor"/></svg>',
    yellow: '<svg class="color-choice-svg" viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="currentColor"/></svg>',
    green: '<svg class="color-choice-svg" viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"><polygon points="12,3 22,21 2,21" fill="currentColor"/></svg>',
    blue: '<svg class="color-choice-svg" viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="currentColor"/></svg>',
    orange: '<svg class="color-choice-svg" viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"><path d="M12 2l2.6 6.4L21 9l-5.4 4.6L17.2 21 12 17.5 6.8 21l1.6-7.4L3 9l6.4-.6L12 2z" fill="currentColor"/></svg>',
    pink: '<svg class="color-choice-svg" viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z" fill="currentColor"/></svg>',
    teal: '<svg class="color-choice-svg" viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"><polygon points="12,2 22,9.2 18.2,21 5.8,21 2,9.2" fill="currentColor"/></svg>',
    purple: '<svg class="color-choice-svg" viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-5.4-5.4c0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z" fill="currentColor"/></svg>',
  };

  renderColorPickerCardFan(mode, isDark) {
    if (!this.el.colorPickerCardFan) return;
    const cardBackHtml = renderCardBackHTML(isDark, false, mode);
    const fanCards = [
      { pos: 0, rot: -18, x: -100, y: 14, z: 1 },
      { pos: 1, rot: -9, x: -50, y: 2, z: 2 },
      { pos: 2, rot: 0, x: 0, y: -8, z: 3 },
      { pos: 3, rot: 9, x: 50, y: 2, z: 2 },
      { pos: 4, rot: 18, x: 100, y: 14, z: 1 },
    ];
    this.el.colorPickerCardFan.innerHTML = fanCards
      .map(
        (c) => `
        <div class="color-fan-card fan-pos-${c.pos}" style="--fan-rot: ${c.rot}deg; --fan-x: ${c.x}px; --fan-y: ${c.y}px; z-index: ${c.z};" aria-hidden="true">
          ${cardBackHtml}
        </div>
      `
      )
      .join('');
  }

  renderColorPickerContent() {
    const mode = this.gameState?.mode || 'classic';
    const isDark = mode === 'flip' && this.gameState?.flipSide === 'dark';
    const colors = isDark
      ? ['orange', 'pink', 'teal', 'purple']
      : ['red', 'yellow', 'green', 'blue'];

    this.renderColorPickerCardFan(mode, isDark);

    this.el.colorOptionsContainer.innerHTML = colors
      .map((c) => {
        const meta = COLOR_METADATA[c] || { name: c };
        const svgIcon = UnoArenaApp.COLOR_SVGS[c] || '';
        return `
          <button class="color-option-btn color-choice-${c}" data-color="${c}" type="button" aria-label="${meta.name}">
            <span class="color-choice-symbol-wrap" aria-hidden="true">${svgIcon}</span>
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

        if (this.pendingPlayWrapper && this.gameState?.mode === 'flip') {
          this.pendingPlayWrapper.classList.add('playing');
        }

        const chosenColor = currentBtn.dataset.color;
        sounds.playSnap(520, 0.1);

        setTimeout(() => {
          setGameModal(this.el.colorPickerModal,false);
          this.send({
            type: ['opening_color'].includes(this.gameState?.pendingAction?.type) ? 'choose_color' : 'play_card',
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
  }

  openColorPicker() {
    this.renderColorPickerContent();
    setGameModal(this.el.colorPickerModal,true);
  }

  static ROULETTE_ANGLES = {
    red: 45,
    yellow: 315,
    blue: 225,
    green: 135,
  };

  renderRouletteCardFan(mode = 'no_mercy') {
    if (!this.el.rouletteCardFan) return;
    const cardBackHtml = renderCardBackHTML(false, false, mode);
    const fanCards = [
      { pos: 0, rot: -18, x: -100, y: 14, z: 1 },
      { pos: 1, rot: -9, x: -50, y: 2, z: 2 },
      { pos: 2, rot: 0, x: 0, y: -8, z: 3 },
      { pos: 3, rot: 9, x: 50, y: 2, z: 2 },
      { pos: 4, rot: 18, x: 100, y: 14, z: 1 },
    ];
    this.el.rouletteCardFan.innerHTML = fanCards
      .map(
        (c) => `
        <div class="color-fan-card fan-pos-${c.pos}" style="--fan-rot: ${c.rot}deg; --fan-x: ${c.x}px; --fan-y: ${c.y}px; z-index: ${c.z};" aria-hidden="true">
          ${cardBackHtml}
        </div>
      `
      )
      .join('');
  }

  renderRouletteWheelSvg() {
    if (!this.el.rouletteWheelSvg) return;
    this.el.rouletteWheelSvg.innerHTML = `
      <defs>
        <!-- Quadrant gradients for rich satin depth -->
        <radialGradient id="rouletteGradRed" cx="30%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#ef4444" />
          <stop offset="60%" stop-color="#dc2626" />
          <stop offset="100%" stop-color="#991b1b" />
        </radialGradient>
        <radialGradient id="rouletteGradYellow" cx="70%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#fef08a" />
          <stop offset="45%" stop-color="#facc15" />
          <stop offset="100%" stop-color="#ca8a04" />
        </radialGradient>
        <radialGradient id="rouletteGradBlue" cx="70%" cy="70%" r="70%">
          <stop offset="0%" stop-color="#60a5fa" />
          <stop offset="55%" stop-color="#2563eb" />
          <stop offset="100%" stop-color="#1e40af" />
        </radialGradient>
        <radialGradient id="rouletteGradGreen" cx="30%" cy="70%" r="70%">
          <stop offset="0%" stop-color="#4ade80" />
          <stop offset="55%" stop-color="#16a34a" />
          <stop offset="100%" stop-color="#166534" />
        </radialGradient>
        <filter id="rouletteDropShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.6" />
        </filter>
      </defs>

      <!-- 4 Quadrants -->
      <!-- TOP-LEFT: RED (270° to 180° / 9 o'clock to 12 o'clock) -->
      <g class="roulette-quadrant" data-color="red">
        <path d="M 100,100 L 0,100 A 100,100 0 0,1 100,0 Z" fill="url(#rouletteGradRed)" />
        <polygon points="58,44 72,58 58,72 44,58" fill="#ffffff" filter="url(#rouletteDropShadow)" />
      </g>

      <!-- TOP-RIGHT: YELLOW (12 o'clock to 3 o'clock) -->
      <g class="roulette-quadrant" data-color="yellow">
        <path d="M 100,100 L 100,0 A 100,100 0 0,1 200,100 Z" fill="url(#rouletteGradYellow)" />
        <polygon points="142,45 145.5,54 155,55 147.5,62 149.5,71 142,66 134.5,71 136.5,62 129,55 138.5,54" fill="#111111" />
      </g>

      <!-- BOTTOM-RIGHT: BLUE (3 o'clock to 6 o'clock) -->
      <g class="roulette-quadrant" data-color="blue">
        <path d="M 100,100 L 200,100 A 100,100 0 0,1 100,200 Z" fill="url(#rouletteGradBlue)" />
        <circle cx="142" cy="142" r="13" fill="#ffffff" filter="url(#rouletteDropShadow)" />
      </g>

      <!-- BOTTOM-LEFT: GREEN (6 o'clock to 9 o'clock) -->
      <g class="roulette-quadrant" data-color="green">
        <path d="M 100,100 L 100,200 A 100,100 0 0,1 0,100 Z" fill="url(#rouletteGradGreen)" />
        <polygon points="58,130 72,154 44,154" fill="#ffffff" filter="url(#rouletteDropShadow)" />
      </g>

      <!-- Quadrant Dividers -->
      <line x1="0" y1="100" x2="200" y2="100" stroke="#2a050b" stroke-width="2.5" />
      <line x1="100" y1="0" x2="100" y2="200" stroke="#2a050b" stroke-width="2.5" />

      <!-- Center Hub with UNO Logo -->
      <g class="roulette-center-hub" filter="url(#rouletteDropShadow)">
        <circle cx="100" cy="100" r="32" fill="#dca336" stroke="#5a3505" stroke-width="2" />
        <circle cx="100" cy="100" r="28" fill="#140205" stroke="#fde047" stroke-width="1.2" />
        <g transform="translate(100, 100) rotate(-13)">
          <ellipse cx="0" cy="0" rx="21" ry="12.5" fill="#d11a2a" stroke="#ffd700" stroke-width="1.5" />
          <text x="0" y="4.5" text-anchor="middle" font-family="'Impact', 'Arial Black', sans-serif" font-weight="900" font-style="italic" font-size="12.5" fill="#ffffff" stroke="#110202" stroke-width="0.8">UNO</text>
        </g>
      </g>
    `;
  }

  getCurrentWheelAngle() {
    if (!this.el.rouletteWheelFrame) return 0;
    try {
      const st = window.getComputedStyle(this.el.rouletteWheelFrame);
      const tr = st.transform;
      if (tr && tr !== 'none') {
        const values = tr.split('(')[1].split(')')[0].split(',');
        const a = parseFloat(values[0]);
        const b = parseFloat(values[1]);
        const angle = Math.round(Math.atan2(b, a) * (180 / Math.PI));
        return ((angle % 360) + 360) % 360;
      }
    } catch (_) { }
    return this.currentRouletteAngle || 0;
  }

  openRouletteModal(isTargetPlayer = false) {
    if (!this.el.rouletteModal) return;
    if (this.rouletteLandedTimer) { clearTimeout(this.rouletteLandedTimer); this.rouletteLandedTimer = null; }
    if (this.rouletteCloseTimer) { clearTimeout(this.rouletteCloseTimer); this.rouletteCloseTimer = null; }

    const mode = this.gameState?.mode || 'no_mercy';
    this.renderRouletteCardFan(mode);
    this.renderRouletteWheelSvg();

    document.getElementById('rouletteTitle').textContent=isTargetPlayer?'COLOR ROULETTE':'Roulette in progress';
    this.isRouletteInteractive = isTargetPlayer;
    this.isRouletteDecelerating = false;

    if (this.el.rouletteWheelFrame) {
      this.el.rouletteWheelFrame.style.transition = 'none';
      this.el.rouletteWheelFrame.style.transform = 'rotate(0deg)';
      this.currentRouletteAngle = 0;
      this.el.rouletteWheelSvg?.querySelectorAll('.roulette-quadrant').forEach(q => q.classList.remove('is-winner'));
    }

    if (this.el.rouletteActionBtn) {
      this.el.rouletteActionBtn.classList.remove('landed');
      if (isTargetPlayer) {
        this.el.rouletteActionBtn.classList.add('clickable');
        this.el.rouletteStatusText.textContent = 'SPIN WHEEL';
        if (this.el.rouletteSpinnerIcon) this.el.rouletteSpinnerIcon.style.display = 'none';
        if (this.el.rouletteSubtitle) this.el.rouletteSubtitle.textContent = 'Spin the wheel to choose your roulette color...';
      } else {
        this.el.rouletteActionBtn.classList.remove('clickable');
        this.el.rouletteStatusText.textContent = 'Spinning...';
        if (this.el.rouletteSpinnerIcon) this.el.rouletteSpinnerIcon.style.display = 'inline-block';
        if (this.el.rouletteSubtitle) this.el.rouletteSubtitle.textContent = 'Waiting for the roulette color. All card play is paused.';
        this.el.rouletteWheelFrame?.classList.add('spinning-free');
      }
    }

    setGameModal(this.el.rouletteModal,true);
  }

  closeRouletteModal() {
    if (!this.el.rouletteModal) return;
    if (this.rouletteLandedTimer) { clearTimeout(this.rouletteLandedTimer); this.rouletteLandedTimer = null; }
    if (this.rouletteCloseTimer) { clearTimeout(this.rouletteCloseTimer); this.rouletteCloseTimer = null; }
    setGameModal(this.el.rouletteModal,false);
    this.el.rouletteWheelFrame?.classList.remove('spinning-free');
    this.isRouletteInteractive = false;
    this.isRouletteDecelerating = false;
    if (this.rouletteAutoSpinTimer) {
      clearTimeout(this.rouletteAutoSpinTimer);
      this.rouletteAutoSpinTimer = null;
    }
  }

  handleRouletteSpinClick() {
    if (!this.isRouletteInteractive) return;
    this.isRouletteInteractive = false;
    if (this.rouletteAutoSpinTimer) {
      clearTimeout(this.rouletteAutoSpinTimer);
      this.rouletteAutoSpinTimer = null;
    }

    if (this.el.rouletteActionBtn) {
      this.el.rouletteActionBtn.classList.remove('clickable');
      if (this.el.rouletteSpinnerIcon) this.el.rouletteSpinnerIcon.style.display = 'inline-block';
      this.el.rouletteStatusText.textContent = 'Spinning...';
    }
    if (this.el.rouletteSubtitle) {
      this.el.rouletteSubtitle.textContent = 'Spinning to choose the next color...';
    }
    this.el.rouletteWheelFrame?.classList.add('spinning-free');

    const colors = ['red', 'yellow', 'green', 'blue'];
    const chosenColor = colors[Math.floor(Math.random() * colors.length)];
    this.send({
      type: 'choose_color',
      data: { chosenColor },
    });
  }

  displayRouletteResult(roulette, onComplete) {
    if (!this.el.rouletteModal) {
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    if (!this.el.rouletteModal.classList.contains('active')) {
      this.openRouletteModal(false);
    }

    this.isRouletteDecelerating = true;
    this.isRouletteInteractive = false;
    if (this.rouletteAutoSpinTimer) {
      clearTimeout(this.rouletteAutoSpinTimer);
      this.rouletteAutoSpinTimer = null;
    }

    const color = roulette.color;
    const targetBaseAngle = UnoArenaApp.ROULETTE_ANGLES[color] ?? 45;

    const currentAngle = this.getCurrentWheelAngle();
    const normalizedCurrent = ((currentAngle % 360) + 360) % 360;

    if (this.el.rouletteWheelFrame) {
      this.el.rouletteWheelFrame.classList.remove('spinning-free');
      this.el.rouletteWheelFrame.style.transition = 'none';
      this.el.rouletteWheelFrame.style.transform = `rotate(${normalizedCurrent}deg)`;
      void this.el.rouletteWheelFrame.offsetHeight; // force reflow

      let diff = targetBaseAngle - normalizedCurrent;
      if (diff <= 0) diff += 360;
      const totalRotation = normalizedCurrent + 1440 + diff;
      this.currentRouletteAngle = totalRotation;

      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const budget=roulette.resumeAt?Math.max(0,roulette.resumeAt-Date.now()-2000):3600;
      const duration = Math.min(prefersReducedMotion ? 400 : 2200,budget);
      const landedHold=Math.min(1400,Math.max(0,budget-duration));

      this.el.rouletteWheelFrame.style.transition = `transform ${duration}ms cubic-bezier(0.15, 0.9, 0.25, 1)`;
      this.el.rouletteWheelFrame.style.transform = `rotate(${totalRotation}deg)`;

      if (this.rouletteLandedTimer) clearTimeout(this.rouletteLandedTimer);
      if (this.rouletteCloseTimer) clearTimeout(this.rouletteCloseTimer);

      this.rouletteLandedTimer = setTimeout(() => {
        const winningQuadrant = this.el.rouletteWheelSvg?.querySelector(`.roulette-quadrant[data-color="${color}"]`);
        if (winningQuadrant) winningQuadrant.classList.add('is-winner');

        if (this.el.rouletteActionBtn) {
          this.el.rouletteActionBtn.classList.remove('clickable');
          this.el.rouletteActionBtn.classList.add('landed');
          if (this.el.rouletteSpinnerIcon) this.el.rouletteSpinnerIcon.style.display = 'none';
          this.el.rouletteStatusText.textContent = `Landed on ${color.toUpperCase()}!`;
        }
        if (this.el.rouletteSubtitle) {
          this.el.rouletteSubtitle.textContent = `Color chosen: ${color.toUpperCase()}`;
        }

        this.rouletteCloseTimer = setTimeout(() => {
          this.closeRouletteModal();
          if (typeof onComplete === 'function') onComplete();
        }, landedHold);
      }, duration);
    } else {
      if (typeof onComplete === 'function') onComplete();
    }
  }

  openSwapPicker() {
    const otherActivePlayers = this.gameState.players.filter(
      (p) => p.id !== this.playerId && !p.isEliminated
    );

    this.el.swapOptionsContainer.innerHTML = otherActivePlayers
      .map(
        (p) => `
        <button class="player-target-btn" data-player-id="${p.id}">
          <span class="swap-player-avatar">${this.classicAvatarInner(p)}</span><span class="swap-player-name">${escapeHtml(p.name)}<small>${p.isBot ? 'AI opponent' : 'Player'}</small></span><span class="swap-card-count">${p.cardCount}<small>cards</small></span><span class="swap-player-arrow" aria-hidden="true">↔</span>
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
        setGameModal(this.el.swapPickerModal,false);
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

    setGameModal(this.el.swapPickerModal,true);
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
    setGameModal(modal,true);

    if (this.caughtFailedTimer) clearTimeout(this.caughtFailedTimer);
    this.caughtFailedTimer = setTimeout(() => {
      setGameModal(modal,false);
      this.caughtFailedTimer = null;
    }, 2400);
  }

  showGameOver(gameState) {
    // Finish the roulette reveal and its two-second draw receipt before victory.
    const roulette = gameState.mode === 'no_mercy' && gameState.rouletteResult;
    if (roulette && gameState.players.some(p => p.id === roulette.targetPlayerId && p.isEliminated) && this.completedRouletteNoticeId !== roulette.id) {
      this.pendingWinnerRouletteId = roulette.id;
      return;
    }

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

    const modeDetail = document.getElementById('victoryModeDetail');
    const playersDetail = document.getElementById('victoryPlayersDetail');
    if (modeDetail) modeDetail.textContent = { classic: 'CLASSIC UNO', flip: 'UNO FLIP', no_mercy: 'NO MERCY' }[gameState.mode] || 'UNO';
    if (playersDetail) playersDetail.textContent = `${gameState.players.length} PLAYERS`;
    this.el.gameOverModal.dataset.mode = gameState.mode;
    renderMatchStandings(this,gameState);
    const me = gameState.players.find((p) => p.id === this.playerId);
    this.el.rematchBtn.style.display = (gameState.status === 'round_over' ? me?.isHost : this.clientView.canProposeRematch) ? 'block' : 'none';

    if (this.el.btnViewVictory) this.el.btnViewVictory.style.display = 'none';
    if (!this.el.gameOverModal.classList.contains('active')) {
      sounds.playVictory();
      requestAnimationFrame(() => this.el.gameOverCloseBtn?.focus({ preventScroll: true }));
    }
    this.el.gameOverModal.classList.add('active');
  }

  openRulesModal() {
    if (this.gameState?.status === 'playing') {
      this.openGameRulesModal('arena', this.gameState.mode);
      return;
    }
    if (this.gameState?.status === 'lobby') {
      this.openGameRulesModal('lobby', this.gameState.mode);
      return;
    }
    this.openSettingsModal('how_to_play');
  }

  closeRulesModal() {
    this.closeSettingsModal();
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
    clearCardArtGate(this);
    stopSocial(this);
    document.body.classList.remove('round-table-layout');
    const tools=document.getElementById('tableTools');if(tools)tools.hidden=true;
    clearInteractionMotion();
    this.connectionRecovering=false;this.reconnectAttempts=0;this.selectedCardId=null;this.el.banner.classList.remove('visible');
    this.pendingWinnerRouletteId = null;
    clearTimeout(this.rouletteNoticeTimer);
    document.getElementById('rouletteDrawNotice')?.remove();
    this.clearClassicAnimations();
    this.cancelCardDrag?.();
    this.send({ type: 'leave' });
    if (this.roomId) localStorage.removeItem(`session_${this.roomId}`);
    clearTimeout(this.eliminationNoticeTimer);
    document.getElementById('eliminationNotice')?.remove();
    this.el.gameOverModal?.classList.remove('active');
    document.getElementById('rematchProposalModal')?.classList.remove('active');
    this.clientView = null;
    this.gameState = null;
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
      this.ws.onmessage = null;
      this.ws.close();
    }
    this.el.leaveConfirmModal?.classList.remove('active');
    document.body.classList.remove('in-mode-lobby', 'in-mode-setup', 'in-no-mercy-setup', 'in-flip-setup', 'in-classic-setup', 'in-room', 'in-arena');
    this.pendingPlayCard = null;
    this.rematchRequestPending = false;
    this.rematchActionPending = false;
    this.el.arenaView.style.display = 'none';
    this.el.leaveBtn.style.display = 'none';
    this.el.navRoomDetails.style.display = 'none';
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.classList.remove('active');
      if (modal.style.display === 'flex') modal.style.display = '';
    });
    clearTimeout(this.rouletteAutoSpinTimer);
    this.closeRouletteModal?.();
    this.showModePicker();
    history.replaceState(null, '', window.location.pathname);
  }

  copyInviteLink() {
    const url = `${window.location.origin}/?room=${this.gameState?.roomId || this.roomId}`;
    if (this.el.lobbyCodeBadge) {
      this.el.lobbyCodeBadge.classList.add('copied');
      setTimeout(() => this.el.lobbyCodeBadge.classList.remove('copied'), 1500);
    }
    if (this.el.copyInviteBtn) {
      this.el.copyInviteBtn.classList.add('copied');
      const textSpan = this.el.copyInviteBtn.querySelector('.share-btn-text') || this.el.copyInviteBtn.querySelector('span');
      if (textSpan) {
        const orig = textSpan.textContent;
        textSpan.textContent = 'Invite Link Copied! ✓';
        setTimeout(() => {
          this.el.copyInviteBtn.classList.remove('copied');
          textSpan.textContent = orig;
        }, 1500);
      }
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

  getSelectedHouseRules(mode = this.gameState?.mode || this.selectedSetupMode || this.preferredMode || this.aiSetup?.mode || 'classic') {
    const custom = this.customHouseRules?.[mode];
    if (custom) return { ...custom };
    return defaultHouseRules(mode);
  }

  isCustomRules(mode, rules) {
    if (!rules) return false;
    const defaults = defaultHouseRules(mode);
    if (rules.missedUnoPenalty !== undefined && Number(rules.missedUnoPenalty) !== defaults.missedUnoPenalty) return true;
    if (rules.startingHandSize !== undefined && Number(rules.startingHandSize) !== defaults.startingHandSize) return true;
    if (rules.turnDuration !== undefined && Number(rules.turnDuration) !== defaults.turnDuration) return true;

    if (mode === 'classic') {
      if (rules.stackingAllowed !== undefined && Boolean(rules.stackingAllowed) !== defaults.stackingAllowed) return true;
      if (rules.drawUntilPlayable !== undefined && Boolean(rules.drawUntilPlayable) !== defaults.drawUntilPlayable) return true;
      if (rules.sevenZeroSwap !== undefined && Boolean(rules.sevenZeroSwap) !== defaults.sevenZeroSwap) return true;
      if (rules.wildDraw4Challenge !== undefined && Boolean(rules.wildDraw4Challenge) !== defaults.wildDraw4Challenge) return true;
    } else if (mode === 'flip') {
      if (rules.stackingAllowed !== undefined && Boolean(rules.stackingAllowed) !== defaults.stackingAllowed) return true;
      if (rules.drawUntilPlayable !== undefined && Boolean(rules.drawUntilPlayable) !== defaults.drawUntilPlayable) return true;
    } else if (mode === 'no_mercy') {
      if (rules.stackingAllowed !== undefined && Boolean(rules.stackingAllowed) !== defaults.stackingAllowed) return true;
      if (rules.drawUntilPlayable !== undefined && Boolean(rules.drawUntilPlayable) !== defaults.drawUntilPlayable) return true;
      if (rules.sevenZeroSwap !== undefined && Boolean(rules.sevenZeroSwap) !== defaults.sevenZeroSwap) return true;
      if (rules.mercyKnockout !== undefined && Boolean(rules.mercyKnockout) !== defaults.mercyKnockout) return true;
      if (rules.mercyKnockoutLimit !== undefined && Number(rules.mercyKnockoutLimit) !== defaults.mercyKnockoutLimit) return true;
    }
    return false;
  }

  getRulesSummaryString(mode, rules) {
    const r = { ...defaultHouseRules(mode), ...(rules || {}) };
    const parts = [
      `Missed UNO: ${r.missedUnoPenalty} cards`,
      `Starting hand: ${r.startingHandSize}`,
      `Turn: ${r.turnDuration}s`,
    ];
    if (mode === 'classic') {
      if (r.stackingAllowed) parts.push('Stacking');
      if (r.drawUntilPlayable) parts.push('Draw Until Playable');
      if (r.sevenZeroSwap) parts.push('7-Swap & 0-Pass');
      if (r.wildDraw4Challenge === false) parts.push('No WD4 Challenge');
    } else if (mode === 'flip') {
      if (r.stackingAllowed) parts.push('Stacking');
      if (r.drawUntilPlayable) parts.push('Draw Until Playable');
    } else if (mode === 'no_mercy') {
      if (!r.stackingAllowed) parts.push('No Stacking');
      if (!r.drawUntilPlayable) parts.push('Draw 1');
      if (!r.sevenZeroSwap) parts.push('No 7-0');
      if (!r.mercyKnockout) parts.push('No Knockout');
      else parts.push(`Knockout: ${r.mercyKnockoutLimit || 25}`);
    }
    return parts.join(' · ');
  }

  updateAiRulesSummary(mode = this.aiSetup?.mode || 'classic') {
    const rules = this.getSelectedHouseRules(mode);
    const isCustom = this.isCustomRules(mode, rules);
    const badgeText = isCustom ? 'Custom House Rules' : 'Official Rules';
    const summaryText = this.getRulesSummaryString(mode, rules);

    if (this.el.aiRulesStatusBadge) {
      this.el.aiRulesStatusBadge.textContent = badgeText;
      this.el.aiRulesStatusBadge.classList.toggle('is-custom', isCustom);
    }
    if (this.el.mobileAiRulesStatusBadge) {
      this.el.mobileAiRulesStatusBadge.textContent = badgeText;
      this.el.mobileAiRulesStatusBadge.classList.toggle('is-custom', isCustom);
    }
    if (this.el.aiRulesSummaryText) {
      this.el.aiRulesSummaryText.textContent = summaryText;
    }
    if (this.el.mobileAiRulesSummaryText) {
      this.el.mobileAiRulesSummaryText.textContent = summaryText;
    }
  }

  openGameRulesModal(context = 'lobby', mode = null) {
    if (!this.roomId && context !== 'ai') context = 'setup';
    this.rulesModalContext = context;
    const targetMode = mode || (['ai', 'setup'].includes(context) ? (this.aiSetup?.mode || 'classic') : (this.gameState?.mode || 'classic'));
    this.activeRulesModalMode = targetMode;

    const me = this.gameState?.players?.find((p) => p.id === this.playerId);
    const isHost = ['ai', 'setup'].includes(context) ? true : (me?.isHost || false);
    const isPlaying = this.gameState?.status === 'playing';
    const isReadOnly = isPlaying || !isHost;

    if (this.el.rulesLockedBanner) {
      this.el.rulesLockedBanner.hidden = !isPlaying;
    }
    if (this.el.rulesGuestBanner) {
      this.el.rulesGuestBanner.hidden = isPlaying || isHost || ['ai', 'setup'].includes(context);
    }

    if (this.el.gameRulesModalTitle) {
      this.el.gameRulesModalTitle.textContent = isPlaying
        ? 'Match rules'
        : (['ai', 'setup'].includes(context) ? 'AI game rules' : 'Game rules');
    }

    const rules = ['ai', 'setup'].includes(context)
      ? this.getSelectedHouseRules(targetMode)
      : (this.gameState?.houseRules || defaultHouseRules(targetMode));

    this.syncGameRulesModalInputs(targetMode, rules, isReadOnly, isHost);
    this.openSettingsModal('rules');
  }

  closeGameRulesModal() {
    this.closeSettingsModal();
  }

  syncGameRulesModalInputs(mode, rules, isReadOnly, isHost) {
    syncRulePresets(mode,isReadOnly);
    const currentRules = { ...defaultHouseRules(mode), ...(rules || {}) };
    const isCustom = this.isCustomRules(mode, currentRules);
    const modeNames = { classic: 'CLASSIC UNO', flip: 'UNO FLIP', no_mercy: 'NO MERCY' };

    // Badges
    if (this.el.gameRulesModeBadge) {
      this.el.gameRulesModeBadge.textContent = modeNames[mode] || mode.toUpperCase();
    }
    if (this.el.gameRulesTypeBadge) {
      this.el.gameRulesTypeBadge.textContent = isCustom ? 'Custom House Rules' : 'Official Rules';
      this.el.gameRulesTypeBadge.classList.toggle('is-custom', isCustom);
    }

    // Tabs
    if (this.el.gameRulesModeTabs) {
      this.el.gameRulesModeTabs.querySelectorAll('.rule-tab-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.rulesMode === mode);
      });
      this.el.gameRulesModeTabs.style.display = ['ai', 'setup'].includes(this.rulesModalContext) ? 'flex' : 'none';
    }

    // Mode-specific sections visibility
    const classicRows = document.querySelectorAll('.mode-setting.mode-classic');
    const flipRows = document.querySelectorAll('.mode-setting.mode-flip');
    const nmRows = document.querySelectorAll('.mode-setting.mode-no_mercy');

    classicRows.forEach((r) => { r.style.display = mode === 'classic' ? 'flex' : 'none'; });
    flipRows.forEach((r) => { r.style.display = mode === 'flip' ? 'flex' : 'none'; });
    nmRows.forEach((r) => { r.style.display = mode === 'no_mercy' ? 'flex' : 'none'; });

    if (this.el.rulesModeSpecificHeading) {
      const headings = {
        classic: 'Classic UNO Specific Settings',
        flip: 'UNO Flip Specific Settings',
        no_mercy: 'No Mercy Specific Settings',
      };
      this.el.rulesModeSpecificHeading.textContent = headings[mode] || 'Mode-Specific Settings';
    }

    // Common Settings
    if (this.el.ruleMissedUnoPenalty) {
      this.el.ruleMissedUnoPenalty.value = String(currentRules.missedUnoPenalty || 2);
      this.el.ruleMissedUnoPenalty.disabled = isReadOnly;
    }
    if (this.el.ruleStartingHandSize) {
      this.el.ruleStartingHandSize.value = String(currentRules.startingHandSize || 7);
      this.el.ruleStartingHandSize.disabled = isReadOnly;
    }
    if (this.el.ruleTurnDuration) {
      this.el.ruleTurnDuration.value = String(currentRules.turnDuration || 30);
      this.el.ruleTurnDuration.disabled = isReadOnly;
    }

    // Classic
    if (this.el.ruleClassicStacking) {
      this.el.ruleClassicStacking.checked = Boolean(currentRules.stackingAllowed);
      this.el.ruleClassicStacking.disabled = isReadOnly;
    }
    if (this.el.ruleClassicDrawBehavior) {
      this.el.ruleClassicDrawBehavior.value = currentRules.drawUntilPlayable ? 'draw_until_playable' : 'draw_one';
      this.el.ruleClassicDrawBehavior.disabled = isReadOnly;
    }
    if (this.el.ruleClassicSevenZero) {
      this.el.ruleClassicSevenZero.checked = Boolean(currentRules.sevenZeroSwap);
      this.el.ruleClassicSevenZero.disabled = isReadOnly;
    }
    if (this.el.ruleClassicWd4Challenge) {
      this.el.ruleClassicWd4Challenge.checked = currentRules.wildDraw4Challenge !== false;
      this.el.ruleClassicWd4Challenge.disabled = isReadOnly;
    }

    // Flip
    if (this.el.ruleFlipStacking) {
      this.el.ruleFlipStacking.checked = Boolean(currentRules.stackingAllowed);
      this.el.ruleFlipStacking.disabled = isReadOnly;
    }
    if (this.el.ruleFlipDrawBehavior) {
      this.el.ruleFlipDrawBehavior.value = currentRules.drawUntilPlayable ? 'draw_until_playable' : 'draw_one';
      this.el.ruleFlipDrawBehavior.disabled = isReadOnly;
    }

    // No Mercy
    if (this.el.ruleNmStacking) {
      this.el.ruleNmStacking.checked = currentRules.stackingAllowed !== false;
      this.el.ruleNmStacking.disabled = isReadOnly;
    }
    if (this.el.ruleNmDrawBehavior) {
      this.el.ruleNmDrawBehavior.value = currentRules.drawUntilPlayable !== false ? 'draw_until_playable' : 'draw_one';
      this.el.ruleNmDrawBehavior.disabled = isReadOnly;
    }
    if (this.el.ruleNmSevenZero) {
      this.el.ruleNmSevenZero.checked = currentRules.sevenZeroSwap !== false;
      this.el.ruleNmSevenZero.disabled = isReadOnly;
    }
    if (this.el.ruleNmKnockout) {
      this.el.ruleNmKnockout.checked = currentRules.mercyKnockout !== false;
      this.el.ruleNmKnockout.disabled = isReadOnly;
    }
    if (this.el.ruleNmKnockoutLimit) {
      this.el.ruleNmKnockoutLimit.value = String(currentRules.mercyKnockoutLimit || 25);
      this.el.ruleNmKnockoutLimit.disabled = isReadOnly;
    }

    // Footer actions
    if (this.el.ruleRestoreDefaultsBtn) {
      this.el.ruleRestoreDefaultsBtn.style.display = isReadOnly ? 'none' : 'inline-flex';
    }
    if (this.el.ruleApplyBtn) {
      this.el.ruleApplyBtn.textContent = isReadOnly ? 'Close ✕' : 'Done ✓';
    }
  }

  readGameRulesModalInputs(mode) {
    const rules = {
      missedUnoPenalty: Math.max(1, Math.min(10, Number(this.el.ruleMissedUnoPenalty?.value) || 2)),
      startingHandSize: Math.max(3, Math.min(10, Number(this.el.ruleStartingHandSize?.value) || 7)),
      turnDuration: [15, 30, 45, 60].includes(Number(this.el.ruleTurnDuration?.value))
        ? Number(this.el.ruleTurnDuration?.value)
        : 30,
    };

    if (mode === 'classic') {
      rules.stackingAllowed = Boolean(this.el.ruleClassicStacking?.checked);
      rules.drawUntilPlayable = this.el.ruleClassicDrawBehavior?.value === 'draw_until_playable';
      rules.sevenZeroSwap = Boolean(this.el.ruleClassicSevenZero?.checked);
      rules.wildDraw4Challenge = Boolean(this.el.ruleClassicWd4Challenge?.checked);
    } else if (mode === 'flip') {
      rules.stackingAllowed = Boolean(this.el.ruleFlipStacking?.checked);
      rules.drawUntilPlayable = this.el.ruleFlipDrawBehavior?.value === 'draw_until_playable';
    } else if (mode === 'no_mercy') {
      rules.stackingAllowed = Boolean(this.el.ruleNmStacking?.checked);
      rules.drawUntilPlayable = this.el.ruleNmDrawBehavior?.value === 'draw_until_playable';
      rules.sevenZeroSwap = Boolean(this.el.ruleNmSevenZero?.checked);
      rules.mercyKnockout = Boolean(this.el.ruleNmKnockout?.checked);
      rules.mercyKnockoutLimit = Number(this.el.ruleNmKnockoutLimit?.value) || 25;
    }
    return rules;
  }

  renderLobbyRulesPanel(isHost) {
    if (this.el.settingsModal?.classList.contains('active') && this.rulesModalContext === 'lobby') {
      const mode = this.gameState.mode || 'classic';
      const rules = this.gameState.houseRules || defaultHouseRules(mode);
      this.syncGameRulesModalInputs(mode, rules, !isHost, isHost);
    }
  }

  initSettingsModal() {
    const openSettings = () => {
      if (this.gameState?.status === 'lobby') {
        this.openGameRulesModal('lobby', this.gameState.mode);
      } else {
        this.openSettingsModal('general');
      }
    };
    this.el.settingsBtn?.addEventListener('click', openSettings);
    this.el.mobileNavSettingsBtn?.addEventListener('click', openSettings);
    this.el.noMercySettingsBtn?.addEventListener('click', openSettings);
    this.el.modeLobbySettingsBtn?.addEventListener('click', openSettings);

    // Tab buttons
    const settingsTabs = [this.el.tabBtnGeneral, this.el.tabBtnGameRules, this.el.tabBtnHowToPlay];
    settingsTabs.forEach((button, index) => button?.addEventListener('keydown', event => {
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : ['ArrowRight','ArrowDown'].includes(event.key) ? (index + 1) % 3 : ['ArrowLeft','ArrowUp'].includes(event.key) ? (index + 2) % 3 : null;
      if (next === null) return;
      event.preventDefault(); settingsTabs[next].click(); settingsTabs[next].focus();
    }));
    this.el.tabBtnGeneral?.addEventListener('click', () => this.switchSettingsTab('general'));
    this.el.tabBtnGameRules?.addEventListener('click', () => this.switchSettingsTab('rules'));
    this.el.tabBtnHowToPlay?.addEventListener('click', () => this.switchSettingsTab('how_to_play'));

    // Modal Close
    this.el.settingsModalClose?.addEventListener('click', () => this.closeSettingsModal());
    this.el.settingsModal?.addEventListener('click', (e) => {
      if (e.target === this.el.settingsModal) this.closeSettingsModal();
    });

    // How to Play tabs
    if (this.el.howToPlayTabs) {
      this.el.howToPlayTabs.querySelectorAll('.rule-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tab = btn.dataset.tab;
          this.el.howToPlayTabs.querySelectorAll('.rule-tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
          ['classic', 'flip', 'no_mercy'].forEach((m) => {
            const block = document.getElementById(`tab-${m}`);
            if (block) block.style.display = m === tab ? 'block' : 'none';
          });
        });
      });
    }

    // Sound toggle
    this.el.settingSoundToggle?.addEventListener('change', (e) => {
      const enabled = sounds.setEnabled(e.target.checked);
      this.updateSoundIcon(enabled);
      if (enabled) sounds.playSnap?.(520, 0.08);
      this.showToast(enabled ? 'Sound Enabled 🔊' : 'Sound Muted 🔇');
    });

    // Volume slider
    this.el.settingVolumeSlider?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (this.el.settingVolumeValue) this.el.settingVolumeValue.textContent = `${val}%`;
      sounds.setVolume(val / 100);
    });
    this.el.settingVolumeSlider?.addEventListener('change', (e) => {
      const val = Number(e.target.value);
      sounds.setVolume(val / 100);
      localStorage.setItem('uno_arena_volume', String(val / 100));
      sounds.playSnap?.(440, 0.08);
    });

    // Display Name input
    const handleNameSync = (e) => {
      const val = (e.target.value || '').trim().slice(0, 18);
      if (val) {
        this.playerName = val;
        localStorage.setItem('uno_arena_name', val);
        localStorage.setItem('uno_arena_player_name', val);
        if (this.el.playerNameInput && this.el.playerNameInput !== e.target) this.el.playerNameInput.value = val;
        if (this.el.mobilePlayerNameInput && this.el.mobilePlayerNameInput !== e.target) this.el.mobilePlayerNameInput.value = val;
        if (this.roomId && this.playerId) {
          this.send({ type: 'update_profile', data: { name: val, avatar: this.playerAvatar } });
        }
      }
    };
    this.el.settingPlayerNameInput?.addEventListener('input', handleNameSync);
    this.el.settingPlayerNameInput?.addEventListener('change', handleNameSync);

    // Avatar Presets
    if (this.el.avatarPresetsGrid) {
      this.el.avatarPresetsGrid.querySelectorAll('.avatar-preset-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const avatarId = btn.dataset.avatarId;
          if (avatarId) this.setPlayerAvatar(avatarId);
        });
      });
    }

    // Avatar Upload
    this.el.settingAvatarUpload?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        this.showToast('Please upload a PNG, JPEG or WebP image');
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const size = 96;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          this.setPlayerAvatar(dataUrl);
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });

    // Avatar Remove
    this.el.settingAvatarRemoveBtn?.addEventListener('click', () => {
      this.setPlayerAvatar('fox');
    });

    // Reduced motion toggle
    this.el.settingReducedMotion?.addEventListener('change', (e) => {
      const reduced = e.target.checked;
      document.body.classList.toggle('reduced-motion', reduced);
      localStorage.setItem('uno_arena_reduced_motion', String(reduced));
      this.showToast(reduced ? 'Reduced Motion Enabled' : 'Standard Animations Enabled');
    });

    // Global Escape Key to close settings
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.el.settingsModal?.classList.contains('active')) {
        this.closeSettingsModal();
      }
    });
  }

  setPlayerAvatar(avatar) {
    this.playerAvatar = avatar;
    localStorage.setItem('uno_arena_avatar', avatar);
    this.updateAvatarUI();
    if (this.roomId && this.playerId) {
      this.send({ type: 'update_profile', data: { name: this.playerName, avatar } });
    }
    sounds.playSnap?.(560, 0.08);
  }

  updateAvatarUI() {
    const avatar = this.playerAvatar || 'fox';
    const isCustomImage = avatar.startsWith('data:image/');
    const presetEmojis = {
      fox: '🦊', panda: '🐼', lion: '🦁', frog: '🐸', robot: '🤖',
      wizard: '🧙', crown: '👑', lightning: '⚡', rocket: '🚀', tiger: '🐯'
    };

    if (this.el.avatarPresetsGrid) {
      this.el.avatarPresetsGrid.querySelectorAll('.avatar-preset-btn').forEach((btn) => {
        btn.classList.toggle('active', !isCustomImage && btn.dataset.avatarId === avatar);
      });
    }

    if (this.el.settingAvatarEmoji && this.el.settingAvatarImg) {
      if (isCustomImage) {
        this.el.settingAvatarEmoji.style.display = 'none';
        this.el.settingAvatarImg.src = avatar;
        this.el.settingAvatarImg.style.display = 'block';
      } else {
        this.el.settingAvatarEmoji.textContent = presetEmojis[avatar] || '🦊';
        this.el.settingAvatarEmoji.style.display = 'block';
        this.el.settingAvatarImg.style.display = 'none';
      }
    }

    if (this.el.settingAvatarRemoveBtn) {
      this.el.settingAvatarRemoveBtn.style.display = isCustomImage ? 'inline-block' : 'none';
    }

    const localAvatar = document.querySelector('.local-avatar');
    if (localAvatar) {
      const timer = localAvatar.querySelector('.avatar-turn-timer-wrap');
      if (isCustomImage) {
        localAvatar.innerHTML = `<img src="${avatar}" alt="Avatar" class="avatar-face-img">`;
      } else {
        localAvatar.innerHTML = presetEmojis[avatar] || '🦊';
      }
      if (timer) localAvatar.appendChild(timer);
    }
  }

  switchSettingsTab(tab = 'general') {
    const tabs = [
      { id: 'general', btn: this.el.tabBtnGeneral, content: this.el.tabContentGeneral },
      { id: 'rules', btn: this.el.tabBtnGameRules, content: this.el.tabContentGameRules },
      { id: 'how_to_play', btn: this.el.tabBtnHowToPlay, content: this.el.tabContentHowToPlay },
    ];

    tabs.forEach((t) => {
      const isMatch = t.id === tab;
      if (t.btn) {
        t.btn.classList.toggle('active', isMatch);
        t.btn.setAttribute('aria-selected', String(isMatch));
        t.btn.tabIndex = isMatch ? 0 : -1;
        t.btn.setAttribute('aria-controls', t.content.id);
      }
      if (t.content) {
        t.content.classList.toggle('active', isMatch);
        t.content.setAttribute('role', 'tabpanel');
        t.content.setAttribute('aria-labelledby', t.btn.id);
      }
    });

    const isPlaying = this.gameState?.status === 'playing';
    const isHost = ['ai', 'setup'].includes(this.rulesModalContext) ? true : (this.gameState?.players?.find((p) => p.id === this.playerId)?.isHost || false);
    const isReadOnly = isPlaying || !isHost;
    if (this.el.rulesLockedBanner) this.el.rulesLockedBanner.hidden = tab !== 'rules' || !isPlaying;
    if (this.el.rulesGuestBanner) this.el.rulesGuestBanner.hidden = tab !== 'rules' || isPlaying || isHost;

    if (tab === 'rules') {
      if (this.el.gameRulesModeBadge) this.el.gameRulesModeBadge.style.display = 'inline-block';
      if (this.el.gameRulesTypeBadge) this.el.gameRulesTypeBadge.style.display = 'inline-block';
      if (this.el.ruleRestoreDefaultsBtn) {
        this.el.ruleRestoreDefaultsBtn.style.display = isReadOnly ? 'none' : 'inline-flex';
      }
      if (this.el.ruleApplyBtn) {
        this.el.ruleApplyBtn.textContent = isReadOnly ? 'Close ✕' : 'Save & Close ✓';
      }
      const targetMode = this.activeRulesModalMode || this.gameState?.mode || this.aiSetup?.mode || 'classic';
      const rules = ['ai', 'setup'].includes(this.rulesModalContext)
        ? this.getSelectedHouseRules(targetMode)
        : (this.gameState?.houseRules || defaultHouseRules(targetMode));
      this.syncGameRulesModalInputs(targetMode, rules, isReadOnly, isHost);
    } else {
      if (this.el.gameRulesModeBadge) this.el.gameRulesModeBadge.style.display = 'none';
      if (this.el.gameRulesTypeBadge) this.el.gameRulesTypeBadge.style.display = 'none';
      if (this.el.ruleRestoreDefaultsBtn) {
        this.el.ruleRestoreDefaultsBtn.style.display = 'none';
      }
      if (this.el.ruleApplyBtn) {
        this.el.ruleApplyBtn.textContent = 'Done ✓';
      }
    }

    if (this.el.settingsModalTitle) {
      if (tab === 'general') {
        this.el.settingsModalTitle.textContent = 'Settings';
      } else if (tab === 'rules') {
        this.el.settingsModalTitle.textContent = isPlaying
          ? 'Match rules'
          : (['ai', 'setup'].includes(this.rulesModalContext) ? 'AI game rules' : 'Game rules');
      } else if (tab === 'how_to_play') {
        this.el.settingsModalTitle.textContent = 'How to play';
      }
    }
  }

  openSettingsModal(tab = 'general') {
    music.syncControls();
    if (!this.roomId && this.rulesModalContext !== 'ai') {
      this.rulesModalContext = 'setup';
      this.activeRulesModalMode = this.selectedSetupMode || this.preferredMode || 'classic';
    } else if (this.roomId && this.rulesModalContext !== 'ai') {
      this.rulesModalContext = this.gameState?.status === 'playing' ? 'arena' : 'lobby';
      this.activeRulesModalMode = this.gameState?.mode || 'classic';
    }
    this.switchSettingsTab(tab);

    if (this.el.settingSoundToggle) {
      this.el.settingSoundToggle.checked = sounds.isEnabled();
    }
    if (this.el.settingVolumeSlider) {
      const vol = Math.round(sounds.getVolume() * 100);
      this.el.settingVolumeSlider.value = String(vol);
      if (this.el.settingVolumeValue) this.el.settingVolumeValue.textContent = `${vol}%`;
    }
    if (this.el.settingPlayerNameInput) {
      this.el.settingPlayerNameInput.value = this.playerName || 'Player 1';
    }
    this.updateAvatarUI();
    if (this.el.settingReducedMotion) {
      this.el.settingReducedMotion.checked = document.body.classList.contains('reduced-motion');
    }

    if (this.el.settingsModal) {
      this.el.settingsModal.classList.add('active');
      this.el.settingsModal.setAttribute('aria-hidden', 'false');
    }
    sounds.playSnap?.(440, 0.08);
  }

  closeSettingsModal() {
    if (this.el.settingsModal) {
      this.el.settingsModal.classList.remove('active');
      this.el.settingsModal.setAttribute('aria-hidden', 'true');
    }
    sounds.playSnap?.(380, 0.08);
  }
}

// Bootstrap app when DOM is ready
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    window.app = new UnoArenaApp();
  });
} else {
  window.app = new UnoArenaApp();
}

// Scale the reference composition as one unit instead of shrinking its typography independently.
function fitNoMercyReferenceLobby() {
 document.documentElement.style.setProperty('--no-mercy-reference-scale', String(Math.min((window.innerWidth - 40) / 1328, (window.innerHeight - 40) / 1184, 1)));
}
window.addEventListener('resize', fitNoMercyReferenceLobby);
fitNoMercyReferenceLobby();

function fitClassicLobby() { document.documentElement.style.setProperty("--classic-lobby-scale",String(Math.min((innerWidth-40)/1000,(innerHeight-64)/940,1))); }
window.addEventListener("resize",fitClassicLobby);
fitClassicLobby();

// Measure untransformed layout so the complete result and actions stay visible.
let victoryFitFrame;
function fitVictoryStage() {
  cancelAnimationFrame(victoryFitFrame);
  victoryFitFrame = requestAnimationFrame(() => {
    const modal = document.getElementById('gameOverModal');
    const stage = modal?.querySelector('.victory-stage');
    if (!stage || !modal.classList.contains('active')) return;
    const height = stage.offsetHeight;
    const width = stage.offsetWidth;
    const availableHeight = Math.max(1, modal.clientHeight - 80);
    const availableWidth = Math.max(1, modal.clientWidth - 24);
    const scale = Math.min(1, availableHeight / Math.max(1, height), availableWidth / Math.max(1, width));
    stage.style.setProperty('--victory-fit', String(scale));
  });
}
const victoryModal = document.getElementById('gameOverModal');
if (victoryModal) {
  new MutationObserver(fitVictoryStage).observe(victoryModal, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true, characterData: true });
  new ResizeObserver(fitVictoryStage).observe(victoryModal.querySelector('.victory-card'));
  window.addEventListener('resize', fitVictoryStage);
  window.visualViewport?.addEventListener('resize', fitVictoryStage);
}
