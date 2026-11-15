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
  console.log('=== Starting Verification for Navbar Layout & Room Entry Flow ===');
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
    // Test 1: Desktop Landing Page Navbar Layout & Settings Icon
    // -------------------------------------------------------------
    console.log('\n--- 1. Testing Desktop Navbar Layout & Settings Icon (1280x800) ---');
    await cdp.setViewport(1280, 800, false);
    await cdp.navigate(baseUrl);

    await cdp.waitForFunction(() => window.app !== undefined && window.app.el !== undefined);

    const navLayoutState = await cdp.evaluate(() => {
      const brandToggle = document.getElementById('brandNavToggle');
      const brandUno = brandToggle?.querySelector('.brand-uno');
      const logoBadge = brandToggle?.querySelector('.logo-badge');
      const toggleCue = brandToggle?.querySelector('.nav-toggle-cue');

      const settingsBtn = document.getElementById('settingsBtn');
      const fullscreenBtn = document.getElementById('fullscreenToggleBtn');
      const backBtn = document.getElementById('flipBackToModesBtn');
      const leaveBtn = document.getElementById('leaveBtn');
      const roomDetails = document.getElementById('navRoomDetails');

      const settingsRect = settingsBtn?.getBoundingClientRect();
      const fullscreenRect = fullscreenBtn?.getBoundingClientRect();

      const settingsSvg = settingsBtn?.querySelector('svg');
      const settingsText = settingsBtn?.textContent?.trim() || '';

      const brandRect = brandToggle?.getBoundingClientRect();
      const cueComputed = toggleCue ? window.getComputedStyle(toggleCue) : null;
      const backComputed = backBtn ? window.getComputedStyle(backBtn) : null;
      const leaveComputed = leaveBtn ? window.getComputedStyle(leaveBtn) : null;
      const roomDetailsComputed = roomDetails ? window.getComputedStyle(roomDetails) : null;

      return {
        brandText: brandToggle?.innerText?.replace(/\s+/g, ' ').trim(),
        hasBrandUno: !!brandUno,
        brandUnoText: brandUno?.textContent,
        hasLogoBadge: !!logoBadge,
        logoBadgeText: logoBadge?.textContent,
        cueHidden: !toggleCue || cueComputed.display === 'none',
        backHidden: !backBtn || backComputed.display === 'none',
        leaveHidden: !leaveBtn || leaveComputed.display === 'none',
        roomDetailsHidden: !roomDetails || roomDetailsComputed.display === 'none',

        settingsWidth: settingsRect?.width,
        settingsHeight: settingsRect?.height,
        fullscreenWidth: fullscreenRect?.width,
        fullscreenHeight: fullscreenRect?.height,
        hasSettingsSvg: !!settingsSvg,
        settingsVisibleText: settingsText,
        settingsBg: window.getComputedStyle(settingsBtn).backgroundColor,
        settingsColor: window.getComputedStyle(settingsBtn).color,
      };
    });

    console.log('Nav layout evaluation:', navLayoutState);

    if (!navLayoutState.hasBrandUno || navLayoutState.brandUnoText !== 'UNO') {
      throw new Error(`Expected UNO brand text, got: ${navLayoutState.brandUnoText}`);
    }
    if (!navLayoutState.hasLogoBadge || navLayoutState.logoBadgeText !== 'ARENA') {
      throw new Error(`Expected ARENA logo badge, got: ${navLayoutState.logoBadgeText}`);
    }
    if (!navLayoutState.cueHidden) {
      throw new Error('Down arrow cue (▾) must be hidden on landing nav!');
    }
    if (!navLayoutState.backHidden) {
      throw new Error('Back button must be hidden on landing nav!');
    }
    if (!navLayoutState.leaveHidden) {
      throw new Error('Leave button must be hidden on landing nav!');
    }
    if (!navLayoutState.hasSettingsSvg) {
      throw new Error('Settings button must contain an SVG gear icon!');
    }
    if (navLayoutState.settingsVisibleText !== '') {
      throw new Error(`Settings button should be icon-only with no text, but has: "${navLayoutState.settingsVisibleText}"`);
    }
    if (navLayoutState.settingsWidth < 40 || navLayoutState.settingsHeight < 40) {
      throw new Error(`Settings touch target too small: ${navLayoutState.settingsWidth}x${navLayoutState.settingsHeight}`);
    }

    // Verify Settings button opens settings modal
    console.log('Clicking Settings button to verify modal opens...');
    await cdp.evaluate(() => document.getElementById('settingsBtn').click());
    await delay(300);

    const modalState = await cdp.evaluate(() => {
      const modal = document.getElementById('settingsModal');
      const tabs = Array.from(document.querySelectorAll('.settings-tab-btn')).map(t => t.textContent.trim());
      return {
        isActive: modal.classList.contains('active'),
        tabs,
      };
    });
    console.log('Settings modal state:', modalState);
    if (!modalState.isActive) throw new Error('Settings modal failed to open when clicking gear icon!');

    // Close settings modal
    await cdp.evaluate(() => document.getElementById('settingsModalClose').click());
    await delay(200);

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'navbar_landing_desktop.png'));

    // -------------------------------------------------------------
    // Test 2: Explicit Mode Selected Creation Flow (e.g. UNO Flip)
    // -------------------------------------------------------------
    console.log('\n--- 2. Testing Explicit Mode Selection Flow (UNO Flip -> Lobby Direct) ---');
    await cdp.evaluate(() => {
      // Click UNO Flip card on landing page
      const flipBtn = document.querySelector('[data-home-mode="flip"]');
      flipBtn.click();
      document.getElementById('playerNameInput').value = 'AliceHost';
    });

    const modeCardState = await cdp.evaluate(() => {
      const flipBtn = document.querySelector('[data-home-mode="flip"]');
      return {
        isSelected: flipBtn.classList.contains('is-selected'),
        ariaPressed: flipBtn.getAttribute('aria-pressed'),
      };
    });
    console.log('Mode card state after clicking Flip:', modeCardState);
    if (!modeCardState.isSelected || modeCardState.ariaPressed !== 'true') {
      throw new Error('Clicking Flip mode card did not set is-selected state!');
    }

    // Now click CREATE ROOM
    console.log('Clicking CREATE ROOM with explicit Flip mode...');
    await cdp.evaluate(() => document.getElementById('createRoomBtn').click());

    // Wait until lobby is displayed
    await cdp.waitForFunction(() => {
      const lobby = document.getElementById('lobbySection');
      return lobby && window.getComputedStyle(lobby).display !== 'none';
    });

    await delay(400);

    const lobbyState = await cdp.evaluate(() => {
      const lobbyModeDisplay = document.getElementById('lobbyModeDisplay');
      const modeGrid = document.getElementById('modeSelectorGrid');
      const playersHeading = document.getElementById('lobbyPlayersHeading');
      const startBtn = document.getElementById('startGameBtn');
      const navRoomDetails = document.getElementById('navRoomDetails');
      const navRoomCode = document.getElementById('navRoomCode');
      const navModeTag = document.getElementById('navModeTag');
      const leaveBtn = document.getElementById('leaveBtn');
      const codeText = document.getElementById('lobbyCodeText');

      return {
        lobbyModeText: lobbyModeDisplay?.innerText?.trim(),
        modeGridHidden: window.getComputedStyle(modeGrid).display === 'none',
        playersHeadingText: playersHeading?.textContent?.trim(),
        startBtnText: startBtn?.textContent?.trim(),
        roomDetailsVisible: window.getComputedStyle(navRoomDetails).display !== 'none',
        navRoomCodeText: navRoomCode?.textContent?.trim(),
        navModeTagText: navModeTag?.textContent?.trim(),
        leaveBtnVisible: window.getComputedStyle(leaveBtn).display !== 'none',
        roomId: codeText?.textContent?.trim(),
      };
    });

    console.log('Lobby state after creating Flip room:', lobbyState);

    if (!lobbyState.lobbyModeText.includes('UNO FLIP') || !lobbyState.lobbyModeText.includes('Up to 6 players')) {
      throw new Error(`Expected UNO Flip read-only indicator in lobby, got: ${lobbyState.lobbyModeText}`);
    }
    if (!lobbyState.modeGridHidden) {
      throw new Error('Duplicate modeSelectorGrid must be hidden in lobby!');
    }
    if (!lobbyState.playersHeadingText.includes('(1/6)')) {
      throw new Error(`Expected Flip lobby capacity (1/6), got: ${lobbyState.playersHeadingText}`);
    }
    if (!lobbyState.startBtnText.includes('(1/6)')) {
      throw new Error(`Expected Start button to show (1/6), got: ${lobbyState.startBtnText}`);
    }
    if (!lobbyState.roomDetailsVisible) {
      throw new Error('Navbar room details must be visible in lobby!');
    }
    if (lobbyState.navModeTagText !== 'flip') {
      throw new Error(`Expected nav mode tag "flip", got: ${lobbyState.navModeTagText}`);
    }
    if (!lobbyState.leaveBtnVisible) {
      throw new Error('Leave button must be visible in navbar when in room!');
    }

    const createdRoomId = lobbyState.roomId;
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_flip_direct_entry.png'));

    // -------------------------------------------------------------
    // Test 3: Join Room Flow (Guest never asked for mode)
    // -------------------------------------------------------------
    console.log('\n--- 3. Testing Join Room Flow (Joiner -> Direct to Lobby) ---');
    const { cdp: cdpJoiner } = await createBrowserSession('Joiner');
    await cdpJoiner.setViewport(1280, 800, false);
    await cdpJoiner.navigate(baseUrl);

    await cdpJoiner.waitForFunction(() => window.app !== undefined && window.app.el !== undefined);

    // Joiner enters code and name
    console.log(`Joiner entering code: ${createdRoomId}...`);
    await cdpJoiner.evaluate((code) => {
      document.getElementById('playerNameInput').value = 'BobGuest';
      document.getElementById('roomCodeInput').value = code;
      document.getElementById('joinRoomBtn').click();
    }, createdRoomId);

    await delay(1000);
    const debugJoiner = await cdpJoiner.evaluate(() => {
      const toast = document.getElementById('toast');
      const name = document.getElementById('playerNameInput')?.value;
      const code = document.getElementById('roomCodeInput')?.value;
      const isJoining = window.app?.isJoiningRoom;
      const wsState = window.app?.ws ? window.app.ws.readyState : null;
      const gameState = window.app?.gameState;
      return {
        toastText: toast?.textContent,
        toastClass: toast?.className,
        name,
        code,
        isJoining,
        wsState,
        gameStateStatus: gameState?.status,
        displayEntryView: document.getElementById('entryView')?.style?.display,
        displayLobby: document.getElementById('lobbySection')?.style?.display,
      };
    });
    console.log('debugJoiner:', debugJoiner);

    // Joiner should directly enter lobby
    await cdpJoiner.waitForFunction(() => {
      const lobby = document.getElementById('lobbySection');
      return lobby && window.getComputedStyle(lobby).display !== 'none';
    });

    await delay(400);

    const joinerLobbyState = await cdpJoiner.evaluate(() => {
      const lobbyModeDisplay = document.getElementById('lobbyModeDisplay');
      const playersHeading = document.getElementById('lobbyPlayersHeading');
      const readyBtn = document.getElementById('readyBtn');
      const startBtn = document.getElementById('startGameBtn');
      const navModeTag = document.getElementById('navModeTag');
      return {
        lobbyModeText: lobbyModeDisplay?.innerText?.trim(),
        playersHeadingText: playersHeading?.textContent?.trim(),
        readyBtnText: readyBtn?.textContent?.trim(),
        startBtnVisible: window.getComputedStyle(startBtn).display !== 'none',
        navModeTagText: navModeTag?.textContent?.trim(),
      };
    });

    console.log('Joiner lobby state:', joinerLobbyState);
    if (!joinerLobbyState.lobbyModeText.includes('UNO FLIP')) {
      throw new Error(`Joiner should see host mode UNO FLIP, got: ${joinerLobbyState.lobbyModeText}`);
    }
    if (!joinerLobbyState.playersHeadingText.includes('(2/6)')) {
      throw new Error(`Expected Players in Lobby (2/6), got: ${joinerLobbyState.playersHeadingText}`);
    }
    if (joinerLobbyState.startBtnVisible) {
      throw new Error('Start button should NOT be visible to guest!');
    }

    // Guest clicks ready
    console.log('Guest clicking ready button...');
    await cdpJoiner.evaluate(() => document.getElementById('readyBtn').click());
    await delay(300);

    // Host should see Start button enabled
    const hostReadyState = await cdp.evaluate(() => {
      const startBtn = document.getElementById('startGameBtn');
      return {
        startDisabled: startBtn.disabled,
        startText: startBtn.textContent.trim(),
      };
    });
    console.log('Host state after guest ready:', hostReadyState);
    if (hostReadyState.startDisabled) {
      throw new Error('Host start button should be enabled when all players are ready!');
    }

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_guest_and_host_ready.png'));

    cdpJoiner.close();

    // -------------------------------------------------------------
    // Test 4: Unselected Mode Creation Prompt Modal Flow
    // -------------------------------------------------------------
    console.log('\n--- 4. Testing Unselected Mode Creation Prompt Modal Flow ---');
    // Navigate back to fresh landing page
    await cdp.navigate(baseUrl);
    await cdp.waitForFunction(() => window.app !== undefined && window.app.el !== undefined);

    // Verify initially no card has is-selected
    const initialModeState = await cdp.evaluate(() => {
      const selectedCards = document.querySelectorAll('.home-mode.is-selected');
      return {
        selectedCount: selectedCards.length,
      };
    });
    console.log('Initial mode selected count on fresh landing:', initialModeState);

    // Click CREATE ROOM without selecting mode
    console.log('Clicking CREATE ROOM without selecting mode...');
    await cdp.evaluate(() => {
      document.getElementById('playerNameInput').value = 'CharlieHost';
      document.getElementById('createRoomBtn').click();
    });

    await delay(300);

    const chooseModalState = await cdp.evaluate(() => {
      const modal = document.getElementById('chooseModeModal');
      const cards = Array.from(modal.querySelectorAll('.choose-mode-card')).map(c => c.dataset.selectMode);
      return {
        modalVisible: window.getComputedStyle(modal).display !== 'none',
        cardModes: cards,
      };
    });

    console.log('Choose mode modal state:', chooseModalState);
    if (!chooseModalState.modalVisible) {
      throw new Error('Choose Game Mode modal must open when clicking Create Room without mode!');
    }
    if (chooseModalState.cardModes.length !== 3) {
      throw new Error(`Expected 3 mode cards in modal, got ${chooseModalState.cardModes.length}`);
    }

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'choose_mode_modal_prompt.png'));

    // Select Classic UNO inside modal
    console.log('Selecting CLASSIC UNO from modal...');
    await cdp.evaluate(() => {
      document.querySelector('[data-select-mode="classic"]').click();
    });

    // Should create Classic room and enter lobby directly
    await cdp.waitForFunction(() => {
      const lobby = document.getElementById('lobbySection');
      return lobby && window.getComputedStyle(lobby).display !== 'none';
    });

    await delay(400);

    const classicLobbyState = await cdp.evaluate(() => {
      const lobbyModeDisplay = document.getElementById('lobbyModeDisplay');
      const playersHeading = document.getElementById('lobbyPlayersHeading');
      const startBtn = document.getElementById('startGameBtn');
      const navModeTag = document.getElementById('navModeTag');
      return {
        lobbyModeText: lobbyModeDisplay?.innerText?.trim(),
        playersHeadingText: playersHeading?.textContent?.trim(),
        startBtnText: startBtn?.textContent?.trim(),
        navModeTagText: navModeTag?.textContent?.trim(),
      };
    });

    console.log('Classic lobby state:', classicLobbyState);
    if (!classicLobbyState.lobbyModeText.includes('CLASSIC UNO') || !classicLobbyState.lobbyModeText.includes('Up to 10 players')) {
      throw new Error(`Expected Classic UNO with up to 10 players, got: ${classicLobbyState.lobbyModeText}`);
    }
    if (!classicLobbyState.playersHeadingText.includes('(1/10)')) {
      throw new Error(`Expected Players in Lobby (1/10) for Classic, got: ${classicLobbyState.playersHeadingText}`);
    }
    if (!classicLobbyState.startBtnText.includes('(1/10)')) {
      throw new Error(`Expected Start button to show (1/10), got: ${classicLobbyState.startBtnText}`);
    }

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_classic_10_players.png'));

    // -------------------------------------------------------------
    // Test 5: Mobile Viewport Layout Verification (390x844)
    // -------------------------------------------------------------
    console.log('\n--- 5. Testing Mobile Viewport Layout (390x844) ---');
    await cdp.setViewport(390, 844, true);
    await cdp.navigate(baseUrl);

    await cdp.waitForFunction(() => window.app !== undefined && window.app.el !== undefined);

    const mobileNavState = await cdp.evaluate(() => {
      const brandUno = document.querySelector('.mobile-brand-uno');
      const brandArena = document.querySelector('.mobile-brand-arena');
      const fsBtn = document.getElementById('mobileNavFullscreenBtn');
      const setBtn = document.getElementById('mobileNavSettingsBtn');

      const fsRect = fsBtn?.getBoundingClientRect();
      const setRect = setBtn?.getBoundingClientRect();

      return {
        unoText: brandUno?.textContent?.trim(),
        arenaText: brandArena?.textContent?.trim(),
        hasFsSvg: !!fsBtn?.querySelector('svg'),
        hasSetSvg: !!setBtn?.querySelector('svg'),
        fsWidth: fsRect?.width,
        fsHeight: fsRect?.height,
        setWidth: setRect?.width,
        setHeight: setRect?.height,
      };
    });

    console.log('Mobile nav state:', mobileNavState);
    if (mobileNavState.unoText !== 'UNO' || mobileNavState.arenaText !== 'ARENA') {
      throw new Error(`Expected mobile brand UNO ARENA, got ${mobileNavState.unoText} ${mobileNavState.arenaText}`);
    }
    if (!mobileNavState.hasSetSvg) {
      throw new Error('Mobile settings button must contain SVG gear!');
    }
    if (mobileNavState.setWidth < 34 || mobileNavState.setHeight < 34) {
      throw new Error(`Mobile settings button touch target too small: ${mobileNavState.setWidth}x${mobileNavState.setHeight}`);
    }

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'mobile_portrait_navbar.png'));

    console.log('\n=== ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ===');
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
