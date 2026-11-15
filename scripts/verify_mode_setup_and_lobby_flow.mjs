import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9466;
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-mode-flow-test-'));
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
  console.log('=== Verifying UNO Arena Mode-Specific Setup & Same-Background Lobby Flow ===\n');
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = 'scratch/mode-flow-test-db';
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

    // =========================================================================
    // 1. CLASSIC MODE FLOW
    // =========================================================================
    console.log('\n--- 1. Testing Classic Mode Flow ---');
    await cdp.setViewport(1280, 800, false);
    await cdp.navigate(baseUrl);
    await cdp.waitForFunction(() => document.readyState === 'complete');

    // Enter name on landing page first
    await cdp.evaluate(() => {
      const nameInput = document.getElementById('playerNameInput');
      nameInput.value = 'Alice Classic';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Click Classic mode card
    await cdp.evaluate(() => {
      const card = document.querySelector('.home-mode[data-home-mode="classic"]');
      card.click();
    });

    // Verify setup screen is open
    await cdp.waitForFunction(() => {
      const setup = document.getElementById('modeSetupSection');
      return setup && !setup.hidden && document.body.classList.contains('in-classic-setup');
    });

    // Verify navbar is HIDDEN and padding-top is 0
    const classicSetupNavState = await cdp.evaluate(() => {
      const topNav = document.querySelector('.top-nav');
      const navDisplay = window.getComputedStyle(topNav).display;
      const bodyPaddingTop = window.getComputedStyle(document.body).paddingTop;
      const nmNav = document.querySelector('.nm-top-nav');
      const backBtn = document.getElementById('backToModesBtn');
      return {
        navDisplay,
        bodyPaddingTop,
        hasNmNav: !!nmNav,
        hasBackBtn: !!backBtn && window.getComputedStyle(backBtn).display !== 'none',
        backBtnText: backBtn?.textContent?.trim()
      };
    });
    console.log('Classic setup navbar state:', classicSetupNavState);
    if (classicSetupNavState.navDisplay !== 'none') {
      throw new Error(`Expected navbar to be hidden on Classic setup, got display: ${classicSetupNavState.navDisplay}`);
    }
    if (classicSetupNavState.bodyPaddingTop !== '0px') {
      throw new Error(`Expected body padding-top: 0px, got: ${classicSetupNavState.bodyPaddingTop}`);
    }

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'setup_classic_no_navbar.png'));

    // Click Create Room in Classic setup
    await cdp.evaluate(() => {
      document.getElementById('setupCreateRoomBtn').click();
    });

    // Verify lobby opens in SAME Classic background
    await cdp.waitForFunction(() => {
      const lobby = document.getElementById('lobbySection');
      const classicSlot = document.getElementById('classicLobbySlot');
      return lobby && lobby.parentElement === classicSlot && window.getComputedStyle(lobby).display === 'block';
    });

    const classicLobbyState = await cdp.evaluate(() => {
      const lobby = document.getElementById('lobbySection');
      const classicSlot = document.getElementById('classicLobbySlot');
      const topNav = document.querySelector('.top-nav');
      const navDisplay = window.getComputedStyle(topNav).display;
      const isInsideClassicSlot = lobby.parentElement === classicSlot;
      const bodyClasses = Array.from(document.body.classList);
      const modeHeader = document.getElementById('modeLobbyHeader');
      const modeBadge = document.getElementById('modeLobbyBadge')?.textContent?.trim();
      const players = Array.from(document.querySelectorAll('#lobbyPlayersList .lobby-player-row')).map(r => r.textContent.trim());
      const hasModeSelector = document.getElementById('modeSelectorGrid')?.style.display !== 'none';
      const hasLobbySettings = !!document.getElementById('modeLobbySettingsBtn');
      const hasLobbyLeave = !!document.getElementById('modeLobbyLeaveBtn');
      return {
        navDisplay,
        isInsideClassicSlot,
        bodyClasses,
        modeBadge,
        players,
        hasModeSelector,
        hasLobbySettings,
        hasLobbyLeave,
        headerDisplay: window.getComputedStyle(modeHeader).display
      };
    });
    console.log('Classic lobby state:', classicLobbyState);
    if (classicLobbyState.navDisplay !== 'none') {
      throw new Error('Navbar should remain hidden in Classic lobby');
    }
    if (!classicLobbyState.isInsideClassicSlot) {
      throw new Error('Lobby section should be inside classicLobbySlot');
    }
    if (!classicLobbyState.bodyClasses.includes('in-classic-setup') || !classicLobbyState.bodyClasses.includes('in-mode-lobby')) {
      throw new Error('Body should retain in-classic-setup and in-mode-lobby');
    }
    if (classicLobbyState.hasModeSelector) {
      throw new Error('3-mode selector should NOT be shown in mode-specific lobby');
    }

    // Test Settings gear click inside mode lobby
    await cdp.evaluate(() => {
      document.getElementById('modeLobbySettingsBtn').click();
    });
    await cdp.waitForFunction(() => document.getElementById('settingsModal')?.classList.contains('active'));
    console.log('Settings modal opened from mode lobby gear button.');
    await cdp.evaluate(() => {
      const closeBtn = document.getElementById('settingsModalClose') || document.querySelector('#settingsModal .modal-close-btn');
      closeBtn.click();
    });
    await delay(300);

    // Test Add Bot in Classic lobby
    await cdp.evaluate(() => {
      document.getElementById('addBotBtn').click();
    });
    await cdp.waitForFunction(() => {
      return document.querySelectorAll('#lobbyPlayersList .lobby-player-row').length >= 2;
    });
    console.log('Bot added in Classic lobby.');

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_classic_same_background.png'));

    // Test Leave Room
    await cdp.evaluate(() => {
      document.getElementById('modeLobbyLeaveBtn').click();
    });
    await cdp.waitForFunction(() => document.getElementById('leaveConfirmModal')?.classList.contains('active'));
    await cdp.evaluate(() => {
      document.getElementById('confirmLeaveBtn').click();
    });
    await delay(600);

    // Check we returned to landing page with name preserved
    const afterLeaveName = await cdp.evaluate(() => document.getElementById('playerNameInput')?.value);
    console.log('Returned to landing page. Preserved name:', afterLeaveName);


    // =========================================================================
    // 2. FLIP MODE FLOW
    // =========================================================================
    console.log('\n--- 2. Testing Flip Mode Flow ---');
    await cdp.navigate(baseUrl);
    await cdp.waitForFunction(() => document.readyState === 'complete');

    // Click UNO Flip card
    await cdp.evaluate(() => {
      const card = document.querySelector('.home-mode[data-home-mode="flip"]');
      card.click();
    });

    await cdp.waitForFunction(() => {
      const setup = document.getElementById('modeSetupSection');
      return setup && !setup.hidden && document.body.classList.contains('in-flip-setup');
    });

    const flipSetupNavState = await cdp.evaluate(() => {
      const topNav = document.querySelector('.top-nav');
      const navDisplay = window.getComputedStyle(topNav).display;
      const bodyPaddingTop = window.getComputedStyle(document.body).paddingTop;
      const backBtn = document.getElementById('flipBackToModesBtn');
      return {
        navDisplay,
        bodyPaddingTop,
        hasBackBtn: !!backBtn && window.getComputedStyle(backBtn).display !== 'none',
        backBtnText: backBtn?.textContent?.trim()
      };
    });
    console.log('Flip setup navbar state:', flipSetupNavState);
    if (flipSetupNavState.navDisplay !== 'none') {
      throw new Error(`Expected navbar to be hidden on Flip setup, got display: ${flipSetupNavState.navDisplay}`);
    }
    if (flipSetupNavState.bodyPaddingTop !== '0px') {
      throw new Error(`Expected body padding-top: 0px, got: ${flipSetupNavState.bodyPaddingTop}`);
    }

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'setup_flip_no_navbar.png'));

    // Click Create Room in Flip setup
    await cdp.evaluate(() => {
      document.getElementById('flipCreateRoomBtn').click();
    });

    await cdp.waitForFunction(() => {
      const lobby = document.getElementById('lobbySection');
      const flipSlot = document.getElementById('flipLobbySlot');
      const codeText = document.getElementById('lobbyCodeText')?.textContent?.trim();
      return lobby && lobby.parentElement === flipSlot && window.getComputedStyle(lobby).display === 'block' && codeText && codeText !== '------';
    });

    const flipLobbyState = await cdp.evaluate(() => {
      const lobby = document.getElementById('lobbySection');
      const flipSlot = document.getElementById('flipLobbySlot');
      const topNav = document.querySelector('.top-nav');
      const navDisplay = window.getComputedStyle(topNav).display;
      const isInsideFlipSlot = lobby.parentElement === flipSlot;
      const bodyClasses = Array.from(document.body.classList);
      const modeBadge = document.getElementById('modeLobbyBadge')?.textContent?.trim();
      const codeText = document.getElementById('lobbyCodeText')?.textContent?.trim();
      return {
        navDisplay,
        isInsideFlipSlot,
        bodyClasses,
        modeBadge,
        codeText,
        themeClass: lobby.className
      };
    });
    console.log('Flip lobby state:', flipLobbyState);
    if (flipLobbyState.navDisplay !== 'none') {
      throw new Error('Navbar should remain hidden in Flip lobby');
    }
    if (!flipLobbyState.isInsideFlipSlot) {
      throw new Error('Lobby section should be inside flipLobbySlot');
    }
    if (!flipLobbyState.bodyClasses.includes('in-flip-setup') || !flipLobbyState.bodyClasses.includes('in-mode-lobby')) {
      throw new Error('Body should retain in-flip-setup and in-mode-lobby');
    }
    const flipRoomCode = flipLobbyState.codeText;

    // Test Ready button toggle
    await cdp.evaluate(() => {
      document.getElementById('readyBtn').click();
    });
    await delay(300);

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_flip_same_background.png'));


    // =========================================================================
    // 3. MULTI-CLIENT GUEST JOIN INTO FLIP ROOM
    // =========================================================================
    console.log('\n--- 3. Testing Guest Joining Fixed Flip Room ---');
    const { cdp: guestCdp } = await createBrowserSession('Guest');
    await guestCdp.setViewport(1280, 800, false);
    await guestCdp.navigate(baseUrl);
    await guestCdp.waitForFunction(() => document.readyState === 'complete');

    // Guest enters name and room code on landing page, then clicks Join Room
    await guestCdp.evaluate((code) => {
      const nameInput = document.getElementById('playerNameInput');
      nameInput.value = 'Bob Guest';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));

      const codeInput = document.getElementById('roomCodeInput');
      codeInput.value = code;
      codeInput.dispatchEvent(new Event('input', { bubbles: true }));

      document.getElementById('joinRoomBtn').click();
    }, flipRoomCode);

    // Verify Guest is placed in Flip mode lobby in Flip background
    await guestCdp.waitForFunction(() => {
      const lobby = document.getElementById('lobbySection');
      const flipSlot = document.getElementById('flipLobbySlot');
      return lobby && lobby.parentElement === flipSlot && window.getComputedStyle(lobby).display === 'block';
    });

    const guestLobbyState = await guestCdp.evaluate(() => {
      const topNav = document.querySelector('.top-nav');
      const navDisplay = window.getComputedStyle(topNav).display;
      const bodyClasses = Array.from(document.body.classList);
      const isHostControls = document.getElementById('lobbyHostControls')?.style.display !== 'none';
      const players = Array.from(document.querySelectorAll('#lobbyPlayersList .lobby-player-row')).map(r => r.textContent.trim());
      const modeBadge = document.getElementById('modeLobbyBadge')?.textContent?.trim();
      return {
        navDisplay,
        bodyClasses,
        isHostControls,
        players,
        modeBadge
      };
    });
    console.log('Guest in Flip lobby:', guestLobbyState);
    if (guestLobbyState.navDisplay !== 'none') {
      throw new Error('Guest should also have top navbar hidden in Flip lobby');
    }
    if (!guestLobbyState.bodyClasses.includes('in-flip-setup') || !guestLobbyState.bodyClasses.includes('in-mode-lobby')) {
      throw new Error('Guest body should have in-flip-setup and in-mode-lobby');
    }
    if (guestLobbyState.isHostControls) {
      throw new Error('Guest should not see host controls');
    }

    await guestCdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_flip_guest_view.png'));
    guestCdp.close();


    // =========================================================================
    // 4. NO MERCY MODE FLOW & MATCH START
    // =========================================================================
    console.log('\n--- 4. Testing No Mercy Mode Flow & Match Start ---');
    await cdp.navigate(baseUrl);
    await cdp.waitForFunction(() => document.readyState === 'complete');

    // Click No Mercy card
    await cdp.evaluate(() => {
      const card = document.querySelector('.home-mode[data-home-mode="no_mercy"]');
      card.click();
    });

    await cdp.waitForFunction(() => {
      const setup = document.getElementById('modeSetupSection');
      return setup && !setup.hidden && document.body.classList.contains('in-no-mercy-setup');
    });

    const nmSetupState = await cdp.evaluate(() => {
      const topNav = document.querySelector('.top-nav');
      const navDisplay = window.getComputedStyle(topNav).display;
      const bodyPaddingTop = window.getComputedStyle(document.body).paddingTop;
      const nmTopNav = document.querySelector('.nm-top-nav');
      const backBtn = document.getElementById('noMercyBackBtn');
      return {
        navDisplay,
        bodyPaddingTop,
        hasNmTopNav: !!nmTopNav,
        hasBackBtn: !!backBtn && window.getComputedStyle(backBtn).display !== 'none',
        backBtnText: backBtn?.textContent?.trim()
      };
    });
    console.log('No Mercy setup navbar state:', nmSetupState);
    if (nmSetupState.navDisplay !== 'none') {
      throw new Error('Top navbar should be hidden in No Mercy setup');
    }
    if (nmSetupState.bodyPaddingTop !== '0px') {
      throw new Error(`Body padding-top should be 0px, got ${nmSetupState.bodyPaddingTop}`);
    }
    if (nmSetupState.hasNmTopNav) {
      throw new Error('Old .nm-top-nav bar should be completely removed');
    }

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'setup_no_mercy_no_navbar.png'));

    // Create No Mercy room
    await cdp.evaluate(() => {
      document.getElementById('noMercyCreateRoomBtn').click();
    });

    await cdp.waitForFunction(() => {
      const lobby = document.getElementById('lobbySection');
      const nmSlot = document.getElementById('noMercyLobbySlot');
      return lobby && lobby.parentElement === nmSlot && window.getComputedStyle(lobby).display === 'block';
    });

    const nmLobbyState = await cdp.evaluate(() => {
      const lobby = document.getElementById('lobbySection');
      const nmSlot = document.getElementById('noMercyLobbySlot');
      const topNav = document.querySelector('.top-nav');
      const navDisplay = window.getComputedStyle(topNav).display;
      const isInsideNmSlot = lobby.parentElement === nmSlot;
      const bodyClasses = Array.from(document.body.classList);
      const modeBadge = document.getElementById('modeLobbyBadge')?.textContent?.trim();
      return {
        navDisplay,
        isInsideNmSlot,
        bodyClasses,
        modeBadge,
        themeClass: lobby.className
      };
    });
    console.log('No Mercy lobby state:', nmLobbyState);
    if (nmLobbyState.navDisplay !== 'none') {
      throw new Error('Top navbar should remain hidden in No Mercy lobby');
    }
    if (!nmLobbyState.isInsideNmSlot) {
      throw new Error('Lobby section should be inside noMercyLobbySlot');
    }
    if (!nmLobbyState.bodyClasses.includes('in-no-mercy-setup') || !nmLobbyState.bodyClasses.includes('in-mode-lobby')) {
      throw new Error('Body should retain in-no-mercy-setup and in-mode-lobby');
    }

    // Add bot to allow game start
    await cdp.evaluate(() => {
      document.getElementById('addBotBtn').click();
    });
    await cdp.waitForFunction(() => {
      return document.querySelectorAll('#lobbyPlayersList .lobby-player-row').length >= 2;
    });

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_no_mercy_same_background.png'));

    // Click START GAME
    console.log('Starting No Mercy game...');
    await cdp.evaluate(() => {
      document.getElementById('startGameBtn').click();
    });

    // Verify arena loads
    await cdp.waitForFunction(() => {
      const arena = document.getElementById('arenaView');
      return arena && window.getComputedStyle(arena).display === 'flex' && document.body.classList.contains('in-arena');
    });

    const arenaState = await cdp.evaluate(() => {
      const topNav = document.querySelector('.top-nav');
      const navDisplay = window.getComputedStyle(topNav).display;
      const bodyClasses = Array.from(document.body.classList);
      const setupHidden = document.getElementById('modeSetupSection')?.hidden;
      return {
        navDisplay,
        bodyClasses,
        setupHidden
      };
    });
    console.log('Arena state after match start:', arenaState);
    if (!arenaState.setupHidden) {
      throw new Error('Mode setup section should be hidden in arena');
    }
    if (arenaState.bodyClasses.includes('in-mode-lobby')) {
      throw new Error('in-mode-lobby should be removed in arena');
    }

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'match_no_mercy_started.png'));


    // =========================================================================
    // 5. DIRECT CREATE ROOM FLOW (PRESERVED)
    // =========================================================================
    console.log('\n--- 5. Testing Direct Create Room Preserved Flow ---');
    await cdp.navigate(baseUrl);
    await cdp.waitForFunction(() => document.readyState === 'complete');

    // Click main CREATE ROOM on landing page
    await cdp.evaluate(() => {
      const createBtn = document.getElementById('createRoomBtn');
      createBtn.click();
    });

    // Wait for generic lobby with 3-mode selector
    await cdp.waitForFunction(() => {
      const modeGrid = document.getElementById('modeSelectorGrid');
      const inRoom = document.body.classList.contains('in-room');
      return inRoom && modeGrid && modeGrid.querySelectorAll('.mode-card-btn').length === 3;
    });

    const directLobbyState = await cdp.evaluate(() => {
      const topNav = document.querySelector('.top-nav');
      const navDisplay = window.getComputedStyle(topNav).display;
      const bodyClasses = Array.from(document.body.classList);
      const modeButtons = Array.from(document.querySelectorAll('#modeSelectorGrid .mode-card-btn')).map(b => b.dataset.mode);
      const lobbyParent = document.getElementById('lobbySection')?.parentElement?.id;
      return {
        navDisplay,
        bodyClasses,
        modeButtons,
        lobbyParent
      };
    });
    console.log('Direct Create Room lobby state:', directLobbyState);
    if (directLobbyState.navDisplay === 'none') {
      throw new Error('Top navbar SHOULD be visible in direct create room generic lobby');
    }
    if (!directLobbyState.bodyClasses.includes('in-room')) {
      throw new Error('Body should have in-room for generic lobby');
    }
    if (directLobbyState.lobbyParent !== 'genericLobbySlot') {
      throw new Error('Lobby section should be in genericLobbySlot');
    }
    if (directLobbyState.modeButtons.length !== 3) {
      throw new Error(`Expected 3 mode choices in direct lobby, found ${directLobbyState.modeButtons.length}`);
    }

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_direct_create_preserved.png'));


    // =========================================================================
    // 6. MOBILE RESPONSIVENESS CHECKS
    // =========================================================================
    console.log('\n--- 6. Testing Mobile Responsiveness ---');
    // Mobile Portrait 390x844
    await cdp.setViewport(390, 844, true);
    await cdp.navigate(baseUrl);
    await cdp.waitForFunction(() => document.readyState === 'complete');

    // Click Flip mode
    await cdp.evaluate(() => {
      const btn = document.querySelector('[data-home-mode="flip"]');
      btn.click();
    });
    await cdp.waitForFunction(() => document.body.classList.contains('in-flip-setup'));

    const mobileSetupCheck = await cdp.evaluate(() => {
      const topNav = document.querySelector('.top-nav');
      const navDisplay = window.getComputedStyle(topNav).display;
      const bodyPaddingTop = window.getComputedStyle(document.body).paddingTop;
      return { navDisplay, bodyPaddingTop };
    });
    console.log('Mobile Flip setup nav check:', mobileSetupCheck);
    if (mobileSetupCheck.navDisplay !== 'none' || mobileSetupCheck.bodyPaddingTop !== '0px') {
      throw new Error('Mobile setup should have no top nav and 0 padding top');
    }

    // Create room in mobile
    await cdp.evaluate(() => {
      document.getElementById('flipCreateRoomBtn').click();
    });
    await cdp.waitForFunction(() => document.body.classList.contains('in-mode-lobby'));

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'mobile_flip_lobby_portrait.png'));

    // Mobile Landscape 844x390
    await cdp.setViewport(844, 390, true);
    await delay(300);
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'mobile_no_mercy_lobby_landscape.png'));

    console.log('\n=== All Mode Setup & Lobby Flow Verifications Passed! ===\n');

  } finally {
    if (chromeProc) chromeProc.kill();
    server.close();
  }
}

main().catch((err) => {
  console.error('Fatal Verification Error:', err);
  process.exit(1);
});
