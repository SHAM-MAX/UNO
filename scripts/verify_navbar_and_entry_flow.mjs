import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9455;
const ARTIFACT_DIR = 'C:\\Users\\ShamSundarR\\.gemini\\antigravity\\brain\\4e1038d0-74ee-4ac0-bff4-c89b1e848589';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function httpPutJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'PUT' }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

class CDPClient {
  constructor(wsUrl, tag = 'CDP') {
    this.wsUrl = wsUrl;
    this.tag = tag;
    this.ws = null;
    this.id = 1;
    this.pending = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      });
    });
  }

  async send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, ...args) {
    let expr;
    if (typeof expression === 'function') {
      const argsJson = args.map(a => JSON.stringify(a)).join(', ');
      expr = `(${expression.toString()})(${argsJson})`;
    } else {
      expr = expression;
    }
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Evaluation failed: ${res.exceptionDetails.text} - ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await delay(600);
  }

  async setViewport(width, height, isMobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: isMobile,
    });
  }

  async waitForFunction(fn, timeoutMs = 8000, pollIntervalMs = 150) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const ok = await this.evaluate(fn);
        if (ok) return true;
      } catch {}
      await delay(pollIntervalMs);
    }
    throw new Error(`waitForFunction timed out after ${timeoutMs}ms: ${fn.toString()}`);
  }

  async screenshot(outPath) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
    console.log(`Saved screenshot -> ${outPath}`);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function startHeadlessChrome() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-nav-test-'));
  const proc = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${tempDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
    ],
    { stdio: 'ignore' }
  );

  for (let i = 0; i < 30; i++) {
    try {
      await httpGetJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      return { proc, tempDir };
    } catch {
      await delay(250);
    }
  }
  proc.kill();
  throw new Error('Chrome failed to start within timeout');
}

async function createBrowserSession(tag) {
  const target = await httpPutJson(`http://127.0.0.1:${DEBUG_PORT}/json/new?about%3Ablank`);
  const cdp = new CDPClient(target.webSocketDebuggerUrl, tag);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return { cdp, targetId: target.id };
}

async function main() {
  console.log('=== Starting Verification for Room Entry & Mode Selection Flows ===');
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = 'scratch/navbar-flow-test-db';
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const { server } = await import('../server/src/index.js');
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`Server running at ${baseUrl}`);

  const { proc: chromeProc, tempDir } = await startHeadlessChrome();
  console.log('Headless Chrome ready.');

  try {
    const { cdp } = await createBrowserSession('Primary');

    // -------------------------------------------------------------
    // Test 1: Direct Create Room -> Lobby with 3 Mode Choices
    // -------------------------------------------------------------
    console.log('\n--- 1. Testing Direct Create Room -> Lobby with 3 Mode Choices ---');
    await cdp.setViewport(1280, 800, false);
    console.log('Set viewport, navigating to baseUrl...');
    await cdp.navigate(baseUrl);
    console.log('Navigated to baseUrl, waiting for window.app...');
    await cdp.waitForFunction(() => window.app !== undefined && window.app.el !== undefined);
    console.log('window.app is loaded and ready.');

    // Host enters name and clicks main Create Room button (no mode card clicked)
    await cdp.evaluate(() => {
      document.getElementById('playerNameInput').value = 'AliceHost';
      document.getElementById('createRoomBtn').click();
    });

    // Wait for lobby to display
    await cdp.waitForFunction(() => {
      const lobby = document.getElementById('lobbySection');
      return lobby && window.getComputedStyle(lobby).display !== 'none';
    });
    await delay(300);

    const directLobbyState = await cdp.evaluate(() => {
      const modeGrid = document.getElementById('modeSelectorGrid');
      const modeSelectContainer = document.getElementById('lobbyModeSelectContainer');
      const lobbyModeDisplay = document.getElementById('lobbyModeDisplay');
      const rulesBtn = document.getElementById('lobbyCustomizeRulesBtn');
      const duplicateRules = document.getElementById('lobbyRulesPanel');
      const modeCards = Array.from(modeGrid ? modeGrid.querySelectorAll('.mode-card-btn') : []);
      const selectedCard = modeGrid?.querySelector('.mode-card-btn.selected');
      const playersHeading = document.getElementById('lobbyPlayersHeading');
      const codeText = document.getElementById('lobbyCodeText');

      return {
        gridVisible: modeGrid && window.getComputedStyle(modeGrid).display !== 'none',
        containerVisible: modeSelectContainer && window.getComputedStyle(modeSelectContainer).display !== 'none',
        compactDisplayHidden: !lobbyModeDisplay || window.getComputedStyle(lobbyModeDisplay).display === 'none',
        hasRulesBtn: !!rulesBtn,
        hasDuplicateRules: !!duplicateRules,
        modeCardCount: modeCards.length,
        selectedMode: selectedCard?.dataset.mode,
        classicDisabled: modeCards.find(c => c.dataset.mode === 'classic')?.disabled,
        flipDisabled: modeCards.find(c => c.dataset.mode === 'flip')?.disabled,
        mercyDisabled: modeCards.find(c => c.dataset.mode === 'no_mercy')?.disabled,
        playersHeadingText: playersHeading?.textContent?.trim(),
        roomId: codeText?.textContent?.trim(),
      };
    });

    console.log('Direct Create Room lobby state:', directLobbyState);

    if (!directLobbyState.gridVisible) {
      throw new Error('modeSelectorGrid must be visible in Direct Create Room flow!');
    }
    if (directLobbyState.hasRulesBtn) {
      throw new Error('Extra lobby ⚙️ Rules button must not exist!');
    }
    if (directLobbyState.hasDuplicateRules) {
      throw new Error('Duplicate rules panel must not exist in lobby!');
    }
    if (directLobbyState.modeCardCount !== 3) {
      throw new Error(`Expected 3 mode choices in lobby, found: ${directLobbyState.modeCardCount}`);
    }
    if (!directLobbyState.compactDisplayHidden) {
      throw new Error('Compact lobbyModeDisplay should be hidden when modeSelectorGrid is active!');
    }
    if (directLobbyState.classicDisabled || directLobbyState.flipDisabled || directLobbyState.mercyDisabled) {
      throw new Error('Host must have all 3 mode buttons enabled in lobby when playerCount <= 6!');
    }

    const directRoomCode = directLobbyState.roomId;
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_direct_create_with_mode_selection.png'));

    // -------------------------------------------------------------
    // Test 2: Host Changes Mode & Independent Guest Synchronizes
    // -------------------------------------------------------------
    console.log('\n--- 2. Testing Host Changes Mode & Independent Guest Synchronizes ---');
    const { cdp: cdpGuest } = await createBrowserSession('Guest');
    await cdpGuest.setViewport(1280, 800, false);
    await cdpGuest.navigate(baseUrl);
    await cdpGuest.waitForFunction(() => window.app !== undefined && window.app.el !== undefined);

    // Guest enters direct room code and name
    console.log(`Guest joining room ${directRoomCode}...`);
    await cdpGuest.evaluate((code) => {
      document.getElementById('playerNameInput').value = 'BobGuest';
      document.getElementById('roomCodeInput').value = code;
      document.getElementById('joinRoomBtn').click();
    }, directRoomCode);

    await cdpGuest.waitForFunction(() => {
      const lobby = document.getElementById('lobbySection');
      return lobby && window.getComputedStyle(lobby).display !== 'none';
    });
    await delay(400);

    const guestLobbyState = await cdpGuest.evaluate(() => {
      const modeGrid = document.getElementById('modeSelectorGrid');
      const modeCards = Array.from(modeGrid ? modeGrid.querySelectorAll('.mode-card-btn') : []);
      const selectedCard = modeGrid?.querySelector('.mode-card-btn.selected');
      const playersHeading = document.getElementById('lobbyPlayersHeading');

      return {
        gridVisible: modeGrid && window.getComputedStyle(modeGrid).display !== 'none',
        selectedMode: selectedCard?.dataset.mode,
        allButtonsDisabled: modeCards.every(c => c.disabled),
        playersHeadingText: playersHeading?.textContent?.trim(),
      };
    });

    console.log('Guest lobby state before mode change:', guestLobbyState);
    if (!guestLobbyState.gridVisible) {
      throw new Error('Guest in selectable room must see mode choices in lobby!');
    }
    if (!guestLobbyState.allButtonsDisabled) {
      throw new Error('Guest must have mode buttons disabled (read-only view)!');
    }

    // Guest marks ready
    await cdpGuest.evaluate(() => document.getElementById('readyBtn').click());
    await delay(200);

    // Host switches mode to UNO Flip
    console.log('Host switching mode to UNO Flip...');
    await cdp.evaluate(() => {
      const flipBtn = document.querySelector('#modeSelectorGrid .mode-card-btn[data-mode="flip"]');
      flipBtn.click();
    });

    // Wait for update on host and guest
    await cdp.waitForFunction(() => window.app?.gameState?.mode === 'flip');
    await cdpGuest.waitForFunction(() => window.app?.gameState?.mode === 'flip');
    await delay(300);

    const hostAfterSwitch = await cdp.evaluate(() => {
      const selectedCard = document.querySelector('#modeSelectorGrid .mode-card-btn.selected');
      const navTag = document.getElementById('navModeTag')?.textContent?.trim();
      const playersHeading = document.getElementById('lobbyPlayersHeading')?.textContent?.trim();
      return {
        selectedMode: selectedCard?.dataset.mode,
        navTag,
        playersHeading,
      };
    });

    const guestAfterSwitch = await cdpGuest.evaluate(() => {
      const selectedCard = document.querySelector('#modeSelectorGrid .mode-card-btn.selected');
      const navTag = document.getElementById('navModeTag')?.textContent?.trim();
      const readyBtnText = document.getElementById('readyBtn')?.textContent?.trim();
      const playersHeading = document.getElementById('lobbyPlayersHeading')?.textContent?.trim();
      return {
        selectedMode: selectedCard?.dataset.mode,
        navTag,
        readyBtnText,
        playersHeading,
      };
    });

    console.log('Host after mode switch:', hostAfterSwitch);
    console.log('Guest after mode switch:', guestAfterSwitch);

    if (hostAfterSwitch.selectedMode !== 'flip' || guestAfterSwitch.selectedMode !== 'flip') {
      throw new Error('Mode switch to Flip did not synchronize to both host and guest!');
    }
    if (!hostAfterSwitch.playersHeading.includes('(2/6)') || !guestAfterSwitch.playersHeading.includes('(2/6)')) {
      throw new Error(`Expected capacity (2/6) after Flip switch, got host: ${hostAfterSwitch.playersHeading}, guest: ${guestAfterSwitch.playersHeading}`);
    }
    if (!guestAfterSwitch.readyBtnText.includes('READY ✓')) {
      throw new Error('Mode change must unready guest players!');
    }

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_host_switched_to_flip.png'));
    await cdpGuest.screenshot(path.join(ARTIFACT_DIR, 'lobby_guest_saw_mode_switch.png'));

    cdpGuest.close();

    // -------------------------------------------------------------
    // Test 3: Landing Mode Cards Open Corresponding Setup Forms
    // -------------------------------------------------------------
    console.log('\n--- 3. Testing Landing Mode Cards Open Corresponding Setup Forms ---');
    await cdp.navigate(baseUrl);
    await cdp.waitForFunction(() => window.app !== undefined && window.app.el !== undefined);

    await cdp.evaluate(() => {
      document.getElementById('playerNameInput').value = 'DaisyPlayer';
      if (document.getElementById('mobilePlayerNameInput')) {
        document.getElementById('mobilePlayerNameInput').value = 'DaisyPlayer';
      }
      localStorage.setItem('uno_arena_name', 'DaisyPlayer');
    });

    // 3A. Classic Card -> Classic setup layout
    console.log('Clicking Classic mode card on landing...');
    await cdp.evaluate(() => {
      document.querySelector('[data-home-mode="classic"]').click();
    });
    await delay(300);

    const classicSetupState = await cdp.evaluate(() => {
      const setupSection = document.getElementById('modeSetupSection');
      const standardLayout = document.getElementById('standardSetupLayout');
      const title = document.getElementById('setupModeTitle')?.textContent?.trim();
      const nameInput = document.getElementById('setupPlayerNameInput')?.value;
      const homeHidden = document.getElementById('modeHomeScreen')?.hidden;

      return {
        setupVisible: setupSection && !setupSection.hidden,
        standardVisible: standardLayout && window.getComputedStyle(standardLayout).display !== 'none',
        title,
        nameInput,
        homeHidden,
      };
    });

    console.log('Classic setup state:', classicSetupState);
    if (!classicSetupState.setupVisible || !classicSetupState.standardVisible || classicSetupState.title !== 'Classic UNO') {
      throw new Error(`Expected Classic UNO setup layout, got: ${JSON.stringify(classicSetupState)}`);
    }
    if (classicSetupState.nameInput !== 'DaisyPlayer') {
      throw new Error(`Player name not preserved in Classic setup: ${classicSetupState.nameInput}`);
    }
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'setup_form_classic.png'));

    // Back to modes
    console.log('Clicking Back to game modes...');
    await cdp.evaluate(() => document.getElementById('backToModesBtn').click());
    await delay(200);

    // 3B. UNO Flip Card -> Flip setup container
    console.log('Clicking UNO Flip mode card on landing...');
    await cdp.evaluate(() => {
      document.querySelector('[data-home-mode="flip"]').click();
    });
    await delay(300);

    const flipSetupState = await cdp.evaluate(() => {
      const flipContainer = document.getElementById('flipSetupContainer');
      const nameInput = document.getElementById('flipPlayerNameInput')?.value;
      const bodyHasFlip = document.body.classList.contains('in-flip-setup');
      return {
        flipVisible: flipContainer && window.getComputedStyle(flipContainer).display !== 'none',
        nameInput,
        bodyHasFlip,
      };
    });

    console.log('Flip setup state:', flipSetupState);
    if (!flipSetupState.flipVisible || !flipSetupState.bodyHasFlip) {
      throw new Error('Expected Flip dedicated setup container to be visible!');
    }
    if (flipSetupState.nameInput !== 'DaisyPlayer') {
      throw new Error(`Player name not preserved in Flip setup: ${flipSetupState.nameInput}`);
    }
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'setup_form_flip.png'));

    // Back to modes via navbar back button
    console.log('Clicking Flip back button...');
    await cdp.evaluate(() => document.getElementById('flipBackToModesBtn').click());
    await delay(200);

    // 3C. No Mercy Card -> No Mercy setup container
    console.log('Clicking No Mercy mode card on landing...');
    await cdp.evaluate(() => {
      document.querySelector('[data-home-mode="no_mercy"]').click();
    });
    await delay(300);

    const mercySetupState = await cdp.evaluate(() => {
      const nmContainer = document.getElementById('noMercySetupContainer');
      const nameInput = document.getElementById('noMercyPlayerNameInput')?.value;
      const bodyHasMercy = document.body.classList.contains('in-no-mercy-setup');
      return {
        mercyVisible: nmContainer && window.getComputedStyle(nmContainer).display !== 'none',
        nameInput,
        bodyHasMercy,
      };
    });

    console.log('No Mercy setup state:', mercySetupState);
    if (!mercySetupState.mercyVisible || !mercySetupState.bodyHasMercy) {
      throw new Error('Expected No Mercy dedicated setup container to be visible!');
    }
    if (mercySetupState.nameInput !== 'DaisyPlayer') {
      throw new Error(`Player name not preserved in No Mercy setup: ${mercySetupState.nameInput}`);
    }
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'setup_form_no_mercy.png'));

    // Back to modes
    await cdp.evaluate(() => document.getElementById('noMercyBackBtn').click());
    await delay(200);

    // -------------------------------------------------------------
    // Test 4: Creation from Mode-Specific Setup -> Players-Only Lobby
    // -------------------------------------------------------------
    console.log('\n--- 4. Testing Creation from Mode Setup -> Players-Only Lobby ---');
    // Open Flip setup and click Create Room inside Flip setup
    await cdp.evaluate(() => {
      document.querySelector('[data-home-mode="flip"]').click();
    });
    await delay(200);

    console.log('Clicking Create room inside Flip setup form...');
    await cdp.evaluate(() => {
      document.getElementById('flipCreateRoomBtn').click();
    });

    await cdp.waitForFunction(() => {
      const lobby = document.getElementById('lobbySection');
      return lobby && window.getComputedStyle(lobby).display !== 'none';
    });
    await delay(300);

    const fixedLobbyState = await cdp.evaluate(() => {
      const modeGrid = document.getElementById('modeSelectorGrid');
      const modeBadge = document.getElementById('modeLobbyBadge');
      const lobbyModeDisplay = document.getElementById('lobbyModeDisplay');
      const rulesBtn = document.getElementById('lobbyCustomizeRulesBtn');
      const summaryText = lobbyModeDisplay?.querySelector('.lobby-mode-summary-text');
      const playersHeading = document.getElementById('lobbyPlayersHeading');
      const codeText = document.getElementById('lobbyCodeText');

      return {
        gridHidden: !modeGrid || window.getComputedStyle(modeGrid).display === 'none',
        compactDisplayVisible: (modeBadge && window.getComputedStyle(modeBadge).display !== 'none') || (lobbyModeDisplay && window.getComputedStyle(lobbyModeDisplay).display !== 'none'),
        compactText: (modeBadge?.innerText || lobbyModeDisplay?.innerText || '').trim(),
        hasRulesBtn: !!rulesBtn,
        hasSummaryText: !!summaryText,
        playersHeadingText: playersHeading?.textContent?.trim(),
        roomId: codeText?.textContent?.trim(),
      };
    });

    console.log('Mode Setup -> Fixed lobby state:', fixedLobbyState);
    if (!fixedLobbyState.gridHidden) {
      throw new Error('Mode setup flow MUST NOT repeat modeSelectorGrid in lobby!');
    }
    if (!fixedLobbyState.compactDisplayVisible || !fixedLobbyState.compactText.includes('UNO FLIP')) {
      throw new Error(`Expected compact lobbyModeDisplay with UNO FLIP, got: ${fixedLobbyState.compactText}`);
    }
    if (fixedLobbyState.hasRulesBtn) {
      throw new Error('Extra lobby ⚙️ Rules button must be removed!');
    }
    if (fixedLobbyState.hasSummaryText) {
      throw new Error('Duplicate rule summary text in lobby must be removed!');
    }
    if (!fixedLobbyState.playersHeadingText.includes('(1/6)')) {
      throw new Error(`Expected capacity (1/6) in Flip fixed lobby, got: ${fixedLobbyState.playersHeadingText}`);
    }

    const fixedRoomCode = fixedLobbyState.roomId;
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_fixed_players_only.png'));

    // -------------------------------------------------------------
    // Test 5: Join Room uses Host Mode Without Prompt
    // -------------------------------------------------------------
    console.log('\n--- 5. Testing Join Room uses Host Mode Without Prompt ---');
    const { cdp: cdpJoiner2 } = await createBrowserSession('Joiner2');
    await cdpJoiner2.setViewport(1280, 800, false);
    await cdpJoiner2.navigate(baseUrl);
    await cdpJoiner2.waitForFunction(() => window.app !== undefined && window.app.el !== undefined);

    // Joiner has local preference classic, but joins Flip fixed room
    await cdpJoiner2.evaluate((code) => {
      localStorage.setItem('uno_arena_mode', 'classic');
      document.getElementById('playerNameInput').value = 'EvanJoiner';
      document.getElementById('roomCodeInput').value = code;
      document.getElementById('joinRoomBtn').click();
    }, fixedRoomCode);

    await cdpJoiner2.waitForFunction(() => {
      const lobby = document.getElementById('lobbySection');
      return lobby && window.getComputedStyle(lobby).display !== 'none';
    });
    await delay(300);

    const joinerFixedState = await cdpJoiner2.evaluate(() => {
      const modeGrid = document.getElementById('modeSelectorGrid');
      const modeBadge = document.getElementById('modeLobbyBadge');
      const lobbyModeDisplay = document.getElementById('lobbyModeDisplay');
      const navTag = document.getElementById('navModeTag')?.textContent?.trim();
      const playersHeading = document.getElementById('lobbyPlayersHeading')?.textContent?.trim();

      return {
        gridHidden: !modeGrid || window.getComputedStyle(modeGrid).display === 'none',
        compactVisible: (modeBadge && window.getComputedStyle(modeBadge).display !== 'none') || (lobbyModeDisplay && window.getComputedStyle(lobbyModeDisplay).display !== 'none'),
        compactText: (modeBadge?.innerText || lobbyModeDisplay?.innerText || '').trim(),
        navTag,
        playersHeading,
      };
    });

    console.log('Joiner in fixed room state:', joinerFixedState);
    if (!joinerFixedState.gridHidden) {
      throw new Error('Joiner in fixed room must see players-only lobby without mode choices!');
    }
    if (!joinerFixedState.compactText.includes('UNO FLIP')) {
      throw new Error('Joiner did not receive authoritative Flip mode from host room!');
    }
    if (!joinerFixedState.playersHeading.includes('(2/6)')) {
      throw new Error(`Expected capacity (2/6), got: ${joinerFixedState.playersHeading}`);
    }

    cdpJoiner2.close();

    // -------------------------------------------------------------
    // Test 6: Refresh/Reconnect Preserves Flow
    // -------------------------------------------------------------
    console.log('\n--- 6. Testing Refresh/Reconnect Preserves Flow ---');
    await cdp.evaluate(() => window.location.reload());
    await delay(1200);
    await cdp.waitForFunction(() => window.app?.gameState !== null && document.getElementById('lobbySection')?.style?.display !== 'none');

    const reconnectedState = await cdp.evaluate(() => {
      const modeGrid = document.getElementById('modeSelectorGrid');
      const modeBadge = document.getElementById('modeLobbyBadge');
      const lobbyModeDisplay = document.getElementById('lobbyModeDisplay');
      return {
        gridHidden: !modeGrid || window.getComputedStyle(modeGrid).display === 'none',
        compactVisible: (modeBadge && window.getComputedStyle(modeBadge).display !== 'none') || (lobbyModeDisplay && window.getComputedStyle(lobbyModeDisplay).display !== 'none'),
        mode: window.app?.gameState?.mode,
        policy: window.app?.gameState?.modeSelectionPolicy,
      };
    });

    console.log('Reconnected state:', reconnectedState);
    if (!reconnectedState.gridHidden || !reconnectedState.compactVisible) {
      throw new Error('Reconnected session did not preserve players-only lobby layout!');
    }
    if (reconnectedState.mode !== 'flip' || reconnectedState.policy !== 'fixed') {
      throw new Error(`Expected flip fixed policy on reconnect, got mode=${reconnectedState.mode}, policy=${reconnectedState.policy}`);
    }

    // -------------------------------------------------------------
    // Test 7: Leaving Room Resets State Cleanly
    // -------------------------------------------------------------
    console.log('\n--- 7. Testing Leaving Room Resets State Cleanly ---');
    await cdp.navigate(baseUrl);
    await cdp.waitForFunction(() => window.app !== undefined && window.app.el !== undefined);

    const freshLandingState = await cdp.evaluate(() => {
      const roomEntryFlow = window.app?.roomEntryFlow;
      const selectedSetupMode = window.app?.selectedSetupMode;
      const homeHidden = document.getElementById('modeHomeScreen')?.hidden;
      const setupHidden = document.getElementById('modeSetupSection')?.hidden;
      return {
        roomEntryFlow,
        selectedSetupMode,
        homeHidden,
        setupHidden,
      };
    });

    console.log('Fresh landing state after leave/navigate:', freshLandingState);
    if (freshLandingState.roomEntryFlow !== null || freshLandingState.selectedSetupMode !== null) {
      throw new Error('Leaving room did not reset entry flow state cleanly!');
    }
    if (freshLandingState.homeHidden || !freshLandingState.setupHidden) {
      throw new Error('Landing screen not visible or setup section not hidden!');
    }

    // -------------------------------------------------------------
    // Test 8: Mobile Landing -> Mode Setup & AI Setup Functionality
    // -------------------------------------------------------------
    console.log('\n--- 8. Testing Mobile Landing Mode Card & AI Match Startup ---');
    await cdp.setViewport(390, 844, true);
    await cdp.navigate(baseUrl);
    await cdp.waitForFunction(() => window.app !== undefined && window.app.el !== undefined);

    // Mobile mode tile click
    console.log('Clicking mobile Flip mode tile...');
    await cdp.evaluate(() => {
      document.getElementById('mobileModeFlipBtn').click();
    });
    await delay(300);

    const mobileFlipState = await cdp.evaluate(() => {
      const flipContainer = document.getElementById('flipSetupContainer');
      return {
        flipVisible: flipContainer && window.getComputedStyle(flipContainer).display !== 'none',
      };
    });
    console.log('Mobile Flip tile click result:', mobileFlipState);
    if (!mobileFlipState.flipVisible) {
      throw new Error('Clicking mobile Flip mode tile did not open Flip setup!');
    }

    // Navigate back to test AI setup
    console.log('Navigating to test AI Setup and Match startup on desktop...');
    await cdp.setViewport(1280, 800, false);
    await cdp.navigate(baseUrl);
    await cdp.waitForFunction(() => window.app !== undefined && window.app.el !== undefined);

    // Click Play vs AI
    await cdp.evaluate(() => {
      document.getElementById('playVsAiBtn').click();
    });
    await delay(300);

    const aiFormState = await cdp.evaluate(() => {
      const form = document.getElementById('homeAiForm');
      return {
        formVisible: form && window.getComputedStyle(form).display !== 'none',
      };
    });
    console.log('AI setup form visible:', aiFormState);
    if (!aiFormState.formVisible) {
      throw new Error('Play vs AI button did not open AI Setup Form!');
    }

    // Start AI game
    console.log('Starting AI game...');
    await cdp.evaluate(() => {
      const classicCard = document.querySelector('#aiModeGrid .ai-mode-card[data-mode="classic"]');
      if (classicCard) classicCard.click();
      const countPill = document.querySelector('#aiPlayerCountPills .ai-player-pill[data-count="4"]');
      if (countPill) countPill.click();
      const startBtn = document.getElementById('aiSetupStartBtn');
      if (startBtn) startBtn.click();
    });

    await cdp.waitForFunction(() => {
      const arena = document.getElementById('arenaView');
      return arena && window.getComputedStyle(arena).display !== 'none';
    }, 10000);

    const arenaState = await cdp.evaluate(() => {
      const arena = document.getElementById('arenaView');
      const isPlaying = window.app?.gameState?.status === 'playing';
      const botCount = window.app?.gameState?.players?.filter(p => p.isBot)?.length;
      return {
        arenaVisible: arena && window.getComputedStyle(arena).display !== 'none',
        isPlaying,
        botCount,
      };
    });

    console.log('AI Arena match state:', arenaState);
    if (!arenaState.arenaVisible || !arenaState.isPlaying || arenaState.botCount < 1) {
      throw new Error(`AI Game failed to launch properly: ${JSON.stringify(arenaState)}`);
    }

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'ai_game_match_started.png'));

    console.log('\n=============================================================');
    console.log('🎉 ALL 8 REAL-TIME INTERACTION SCENARIOS PASSED WITH SUCCESS!');
    console.log('=============================================================');
    cdp.close();
  } finally {
    chromeProc.kill();
    server.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
