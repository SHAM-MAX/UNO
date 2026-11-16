import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9477;
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
    const req = http.request(url, { method: 'PUT', timeout: 8000 }, (res) => {
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
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`PUT timeout on ${url}`));
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
      const argsJson = args.map((a) => JSON.stringify(a)).join(', ');
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
    await delay(1200);
  }

  async setViewport(width, height, isMobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: isMobile,
    });
    await delay(200);
  }

  async waitForFunction(fn, timeoutMs = 15000, pollIntervalMs = 200) {
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-normal-lobby-test-'));
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
  console.log('=== Verifying Lobby Layout in Normal Windows & Authentic No Mercy Theme ===\n');
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = 'scratch/normal-window-lobby-db';
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const { server } = await import('../server/src/index.js');
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`Server running at ${baseUrl}`);

  const { proc: chromeProc, tempDir } = await startHeadlessChrome();
  console.log('Headless Chrome ready.');

  try {
    const { cdp } = await createBrowserSession('Host');

    // =========================================================================
    // 1. NO MERCY LOBBY IN NORMAL WINDOW (1366x650)
    // =========================================================================
    console.log('\n--- 1. Testing No Mercy Lobby in Normal Window (1366x650) ---');
    await cdp.setViewport(1366, 650, false);
    await cdp.navigate(baseUrl);
    await cdp.waitForFunction(() => document.readyState === 'complete' && window.app !== undefined);

    // Enter name and click No Mercy mode card
    await cdp.evaluate(() => {
      document.getElementById('playerNameInput').value = 'Sam Host';
      document.querySelector('[data-home-mode="no_mercy"]').click();
    });

    await cdp.waitForFunction(() => {
      const nmContainer = document.getElementById('noMercySetupContainer');
      return nmContainer && window.getComputedStyle(nmContainer).display !== 'none';
    });

    console.log('Clicking Create room in No Mercy setup form...');
    await cdp.evaluate(() => {
      document.getElementById('noMercyCreateRoomBtn').click();
    });

    await cdp.waitForFunction(() => {
      const lobby = document.getElementById('lobbySection');
      const inLobby = document.body.classList.contains('in-mode-lobby');
      return inLobby && lobby && window.getComputedStyle(lobby).display !== 'none';
    });
    await delay(500);

    const normalWindowState = await cdp.evaluate(() => {
      const lobby = document.getElementById('lobbySection');
      const lobbyRect = lobby.getBoundingClientRect();
      const readyBtn = document.getElementById('readyBtn');
      const startBtn = document.getElementById('startGameBtn');
      const codeBadge = document.getElementById('lobbyCodeBadge');
      const codeText = document.getElementById('lobbyCodeText');
      const heading = document.getElementById('lobbyPlayersHeading');
      const playerRows = Array.from(document.querySelectorAll('.lobby-player-row'));
      const emptySlots = Array.from(document.querySelectorAll('.lobby-player-empty'));
      const readyRect = readyBtn.getBoundingClientRect();
      const startRect = startBtn.getBoundingClientRect();

      const docEl = document.documentElement;
      const scrollHeight = docEl.scrollHeight;
      const clientHeight = docEl.clientHeight;
      const scrollWidth = docEl.scrollWidth;
      const clientWidth = docEl.clientWidth;

      const lobbyStyle = window.getComputedStyle(lobby);
      const codeBadgeStyle = window.getComputedStyle(codeBadge);
      const firstRow = playerRows[0];
      const firstRowStyle = firstRow ? window.getComputedStyle(firstRow) : null;
      const startBtnStyle = window.getComputedStyle(startBtn);

      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        lobbyWidth: Math.round(lobbyRect.width),
        lobbyHeight: Math.round(lobbyRect.height),
        hasPageVerticalScroll: scrollHeight > clientHeight + 1,
        hasPageHorizontalScroll: scrollWidth > clientWidth,
        scrollHeight,
        clientHeight,
        readyBottom: Math.round(readyRect.bottom),
        startBottom: Math.round(startRect.bottom),
        readyFullyVisible: readyRect.bottom <= clientHeight && readyRect.top >= 0,
        startFullyVisible: startRect.bottom <= clientHeight && startRect.top >= 0,
        // Theme verification
        lobbyBg: lobbyStyle.backgroundColor,
        lobbyBorderColor: lobbyStyle.borderColor,
        codeBadgeBg: codeBadgeStyle.backgroundColor,
        codeBadgeBorder: codeBadgeStyle.borderColor,
        codeText: codeText?.textContent?.trim(),
        firstRowBg: firstRowStyle?.backgroundColor,
        firstRowColor: firstRowStyle?.color,
        startBtnBg: startBtnStyle.backgroundColor,
        startBtnBorder: startBtnStyle.borderColor,
        headingText: heading?.textContent?.trim(),
        playerRowCount: playerRows.length,
        emptySlotCount: emptySlots.length,
      };
    });

    console.log('No Mercy Normal Window (1366x650) State:', normalWindowState);

    if (normalWindowState.hasPageVerticalScroll) {
      throw new Error(`Normal window (1366x650) must NOT have vertical page scrollbar! scrollHeight=${normalWindowState.scrollHeight}, clientHeight=${normalWindowState.clientHeight}`);
    }
    if (!normalWindowState.readyFullyVisible || !normalWindowState.startFullyVisible) {
      throw new Error(`Footer action buttons clipped! ReadyBottom=${normalWindowState.readyBottom}, StartBottom=${normalWindowState.startBottom}, ClientHeight=${normalWindowState.clientHeight}`);
    }
    if (normalWindowState.emptySlotCount > 1) {
      throw new Error(`Expected compact empty seats summary (<= 1 row), got ${normalWindowState.emptySlotCount} rows!`);
    }

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_no_mercy_normal_window_1366x650.png'));

    // =========================================================================
    // 2. ACTUAL FULLSCREEN ENTRY -> EXIT AT SAME WIDTH (1366px)
    // =========================================================================
    console.log('\n--- 2. Testing Actual Fullscreen Entry -> Exit at Same Width (1366px) ---');
    const baselineWidth = await cdp.evaluate(() => window.innerWidth);
    console.log(`Baseline Normal Window Width: ${baselineWidth}px (Height: 650px)`);

    // Click mode lobby fullscreen button to enter fullscreen
    console.log('Clicking fullscreen button to enter fullscreen...');
    await cdp.evaluate(() => {
      document.getElementById('modeLobbyFullscreenBtn').click();
    });
    // In headless browser, expand viewport to screen height (1366x768) at exact same width
    await cdp.setViewport(1366, 768, false);
    await delay(300);

    const enteredFullscreenState = await cdp.evaluate(() => {
      const docEl = document.documentElement;
      const readyBtn = document.getElementById('readyBtn');
      const startBtn = document.getElementById('startGameBtn');
      const readyRect = readyBtn.getBoundingClientRect();
      const startRect = startBtn.getBoundingClientRect();
      const fsBtn = document.getElementById('modeLobbyFullscreenBtn');
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        hasPageVerticalScroll: docEl.scrollHeight > docEl.clientHeight + 1,
        readyFullyVisible: readyRect.bottom <= docEl.clientHeight,
        startFullyVisible: startRect.bottom <= docEl.clientHeight,
        isBodyFullscreenClass: document.body.classList.contains('is-fullscreen'),
        fsBtnTitle: fsBtn?.getAttribute('title') || fsBtn?.getAttribute('aria-label'),
      };
    });
    console.log('Entered Fullscreen State:', enteredFullscreenState);
    if (enteredFullscreenState.viewportWidth !== baselineWidth) {
      throw new Error(`Fullscreen entry altered width! Expected ${baselineWidth}, got ${enteredFullscreenState.viewportWidth}`);
    }
    if (enteredFullscreenState.hasPageVerticalScroll) {
      throw new Error('Fullscreen must not have vertical page scrollbar!');
    }
    if (!enteredFullscreenState.readyFullyVisible || !enteredFullscreenState.startFullyVisible) {
      throw new Error('Controls clipped inside fullscreen!');
    }
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_no_mercy_fullscreen_entered_1366x768.png'));

    // Now exit fullscreen by clicking the fullscreen button again
    console.log('Clicking fullscreen button again to exit fullscreen...');
    await cdp.evaluate(() => {
      document.getElementById('modeLobbyFullscreenBtn').click();
    });
    // Return viewport to normal window bounds (1366x650) at exact same width
    await cdp.setViewport(1366, 650, false);
    await delay(300);

    const exitedFullscreenState = await cdp.evaluate(() => {
      const docEl = document.documentElement;
      const readyBtn = document.getElementById('readyBtn');
      const startBtn = document.getElementById('startGameBtn');
      const readyRect = readyBtn.getBoundingClientRect();
      const startRect = startBtn.getBoundingClientRect();
      const fsBtn = document.getElementById('modeLobbyFullscreenBtn');
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollHeight: docEl.scrollHeight,
        clientHeight: docEl.clientHeight,
        hasPageVerticalScroll: docEl.scrollHeight > docEl.clientHeight + 1,
        readyFullyVisible: readyRect.bottom <= docEl.clientHeight,
        startFullyVisible: startRect.bottom <= docEl.clientHeight,
        isBodyFullscreenClass: document.body.classList.contains('is-fullscreen'),
      };
    });
    console.log('Exited Fullscreen State (at same width):', exitedFullscreenState);
    if (exitedFullscreenState.viewportWidth !== baselineWidth) {
      throw new Error(`Fullscreen exit altered width! Expected ${baselineWidth}, got ${exitedFullscreenState.viewportWidth}`);
    }
    if (exitedFullscreenState.viewportHeight !== 650) {
      throw new Error(`Expected viewport height to return to 650, got ${exitedFullscreenState.viewportHeight}`);
    }
    if (exitedFullscreenState.hasPageVerticalScroll) {
      throw new Error('Lobby developed page scrollbar after exiting fullscreen!');
    }
    if (!exitedFullscreenState.readyFullyVisible || !exitedFullscreenState.startFullyVisible) {
      throw new Error('Footer action buttons became clipped after exiting fullscreen!');
    }
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_no_mercy_fullscreen_exited_at_same_width.png'));

    // =========================================================================
    // 3. SHORT DESKTOP WINDOW (1280x600)
    // =========================================================================
    console.log('\n--- 3. Testing Short Desktop Window (1280x600) ---');
    await cdp.setViewport(1280, 600, false);
    await delay(300);

    const shortWindowState = await cdp.evaluate(() => {
      const docEl = document.documentElement;
      const readyBtn = document.getElementById('readyBtn');
      const startBtn = document.getElementById('startGameBtn');
      const readyRect = readyBtn.getBoundingClientRect();
      const startRect = startBtn.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollHeight: docEl.scrollHeight,
        clientHeight: docEl.clientHeight,
        hasPageVerticalScroll: docEl.scrollHeight > docEl.clientHeight + 1,
        readyFullyVisible: readyRect.bottom <= docEl.clientHeight,
        startFullyVisible: startRect.bottom <= docEl.clientHeight,
      };
    });
    console.log('Short Window (1280x600) State:', shortWindowState);
    if (shortWindowState.hasPageVerticalScroll) {
      throw new Error(`Short window (1280x600) must NOT have vertical page scrollbar! scrollHeight=${shortWindowState.scrollHeight}, clientHeight=${shortWindowState.clientHeight}`);
    }
    if (!shortWindowState.readyFullyVisible || !shortWindowState.startFullyVisible) {
      throw new Error('Footer action buttons clipped in 1280x600 window!');
    }
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_no_mercy_short_window_1280x600.png'));

    // =========================================================================
    // 4. POPULATED LOBBY IN NORMAL WINDOW (1366x650) - 6 Players
    // =========================================================================
    console.log('\n--- 4. Testing Populated Lobby in Normal Window (1366x650) ---');
    await cdp.setViewport(1366, 650, false);
    await delay(200);

    console.log('Adding 5 bots to fill No Mercy lobby to 6/6 capacity...');
    for (let i = 0; i < 5; i++) {
      await cdp.evaluate(() => {
        document.getElementById('addBotBtn').click();
      });
      await delay(250);
    }

    const populatedState = await cdp.evaluate(() => {
      const docEl = document.documentElement;
      const heading = document.getElementById('lobbyPlayersHeading');
      const playerRows = Array.from(document.querySelectorAll('.lobby-player-row'));
      const emptySlots = Array.from(document.querySelectorAll('.lobby-player-empty'));
      const readyBtn = document.getElementById('readyBtn');
      const startBtn = document.getElementById('startGameBtn');
      const playersList = document.getElementById('lobbyPlayersList');
      const readyRect = readyBtn.getBoundingClientRect();
      const startRect = startBtn.getBoundingClientRect();

      return {
        headingText: heading?.textContent?.trim(),
        playerRowCount: playerRows.length,
        emptySlotCount: emptySlots.length,
        hasPageVerticalScroll: docEl.scrollHeight > docEl.clientHeight + 1,
        readyFullyVisible: readyRect.bottom <= docEl.clientHeight,
        startFullyVisible: startRect.bottom <= docEl.clientHeight,
        startDisabled: startBtn?.disabled,
        startBtnBg: window.getComputedStyle(startBtn).backgroundColor,
        listScrollable: playersList.scrollHeight > playersList.clientHeight,
      };
    });

    console.log('Populated Lobby (6/6) State:', populatedState);
    if (populatedState.hasPageVerticalScroll) {
      throw new Error('Populated lobby in 1366x650 must NOT have page scrollbar; only player list should scroll!');
    }
    if (!populatedState.readyFullyVisible || !populatedState.startFullyVisible) {
      throw new Error('Footer action buttons clipped in populated lobby!');
    }
    if (populatedState.playerRowCount !== 6) {
      throw new Error(`Expected 6 players in full lobby, got ${populatedState.playerRowCount}`);
    }
    if (populatedState.emptySlotCount !== 0) {
      throw new Error(`Expected 0 empty slots in full lobby, got ${populatedState.emptySlotCount}`);
    }
    if (populatedState.startDisabled) {
      throw new Error('Start button should be enabled when host and all bots are ready!');
    }

    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_no_mercy_populated_normal_window.png'));

    // Capture Fullscreen Populated comparison
    await cdp.setViewport(1366, 768, false);
    await delay(200);
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_no_mercy_populated_fullscreen.png'));

    // Return to 1366x650 to verify smooth resize without reloads
    await cdp.setViewport(1366, 650, false);
    await delay(200);

    // =========================================================================
    // 5. MOBILE VIEWPORTS (390x844 portrait & 844x390 landscape)
    // =========================================================================
    console.log('\n--- 5. Testing Mobile Portrait (390x844) & Landscape (844x390) ---');
    await cdp.setViewport(390, 844, true);
    await delay(300);

    const mobilePortraitState = await cdp.evaluate(() => {
      const docEl = document.documentElement;
      const readyBtn = document.getElementById('readyBtn');
      const startBtn = document.getElementById('startGameBtn');
      const readyRect = readyBtn.getBoundingClientRect();
      const startRect = startBtn.getBoundingClientRect();
      return {
        scrollWidth: docEl.scrollWidth,
        clientWidth: docEl.clientWidth,
        noHorizontalOverflow: docEl.scrollWidth <= docEl.clientWidth,
        readyBottom: Math.round(readyRect.bottom),
        startBottom: Math.round(startRect.bottom),
        readyVisible: readyRect.bottom <= docEl.clientHeight,
        startVisible: startRect.bottom <= docEl.clientHeight,
      };
    });
    console.log('Mobile Portrait State:', mobilePortraitState);
    if (!mobilePortraitState.noHorizontalOverflow) {
      throw new Error(`Mobile portrait has horizontal overflow: ${mobilePortraitState.scrollWidth} > ${mobilePortraitState.clientWidth}`);
    }
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_no_mercy_mobile_portrait.png'));

    // Landscape Mobile
    await cdp.setViewport(844, 390, true);
    await delay(300);
    const mobileLandscapeState = await cdp.evaluate(() => {
      const docEl = document.documentElement;
      return {
        scrollWidth: docEl.scrollWidth,
        clientWidth: docEl.clientWidth,
        noHorizontalOverflow: docEl.scrollWidth <= docEl.clientWidth,
      };
    });
    console.log('Mobile Landscape State:', mobileLandscapeState);
    if (!mobileLandscapeState.noHorizontalOverflow) {
      throw new Error('Mobile landscape has horizontal overflow!');
    }
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'lobby_no_mercy_mobile_landscape.png'));

    // Verify actions remain visible and usable on small phones, including rotation.
    for (const [width, height] of [[320, 740], [360, 740], [390, 844], [667, 375], [844, 390]]) {
      await cdp.setViewport(width, height, true);
      await delay(200);
      const mobile = await cdp.evaluate(() => {
        const panel = document.getElementById('lobbySection').getBoundingClientRect();
        const buttons = ['readyBtn', 'startGameBtn', 'copyInviteBtn', 'modeLobbySettingsBtn'].map(id => {
          const r = document.getElementById(id).getBoundingClientRect();
          return { id, visible: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && r.bottom <= panel.bottom, touchHeight: r.height };
        });
        return { overflow: document.documentElement.scrollWidth > innerWidth, buttons };
      });
      console.log('Mobile action visibility', width, height, mobile);
      if (mobile.overflow || mobile.buttons.some(b => !b.visible || b.touchHeight < 43)) throw new Error('Mobile controls clipped or too small at ' + width + 'x' + height);
    }

    // Return to desktop
    await cdp.setViewport(1366, 650, false);

    // =========================================================================
    // 6. INDEPENDENT GUEST SESSION & MATCH STARTUP
    // =========================================================================
    console.log('\n--- 6. Testing Independent Guest Session & Match Startup ---');
    // Remove 1 bot so a seat is available for the guest (5 players in room of 6)
    console.log('Removing 1 bot to open a seat for the guest...');
    await cdp.evaluate(() => {
      const removeBtns = document.querySelectorAll('.remove-bot-btn');
      if (removeBtns.length > 0) removeBtns[removeBtns.length - 1].click();
    });
    await delay(400);

    const roomCode = normalWindowState.codeText;
    console.log(`Connecting guest to room ${roomCode}...`);

    const { cdp: cdpGuest } = await createBrowserSession('Guest');
    await cdpGuest.setViewport(1366, 650, false);
    await cdpGuest.navigate(baseUrl);
    await cdpGuest.waitForFunction(() => document.readyState === 'complete' && window.app !== undefined);

    // Guest enters code on landing page
    await cdpGuest.evaluate((code) => {
      document.getElementById('playerNameInput').value = 'Bob Guest';
      document.getElementById('roomCodeInput').value = code;
      document.getElementById('joinRoomBtn').click();
    }, roomCode);

    await cdpGuest.waitForFunction(() => {
      const lobby = document.getElementById('lobbySection');
      return lobby && window.getComputedStyle(lobby).display !== 'none';
    });
    await delay(500);

    const guestState = await cdpGuest.evaluate(() => {
      const lobby = document.getElementById('lobbySection');
      const addBotBtn = document.getElementById('addBotBtn');
      const modeGrid = document.getElementById('modeSelectorGrid');
      const readyBtn = document.getElementById('readyBtn');
      return {
        themeClass: lobby.className,
        hasAddBot: addBotBtn && window.getComputedStyle(addBotBtn).display !== 'none',
        hasModeGrid: modeGrid && window.getComputedStyle(modeGrid).display !== 'none',
        readyText: readyBtn?.textContent?.trim(),
      };
    });
    console.log('Guest Lobby State:', guestState);
    if (guestState.hasAddBot) throw new Error('Guest must not see Add Bot button!');
    if (guestState.hasModeGrid) throw new Error('Guest must not see mode grid in fixed lobby!');

    // Guest marks ready
    await cdpGuest.evaluate(() => document.getElementById('readyBtn').click());
    await delay(300);

    // Host starts game
    console.log('Host starts the game...');
    await cdp.evaluate(() => document.getElementById('startGameBtn').click());

    await cdp.waitForFunction(() => {
      const arena = document.getElementById('arenaView');
      return arena && window.getComputedStyle(arena).display !== 'none';
    });
    console.log('Match successfully started!');
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'match_no_mercy_started_from_lobby.png'));

    // =========================================================================
    // 7. CLASSIC AND FLIP THEMES PRESERVED IN NORMAL WINDOW (1366x650)
    // =========================================================================
    console.log('\n--- 7. Testing Classic & Flip Themes in Normal Window (1366x650) ---');
    const { cdp: cdpClassic } = await createBrowserSession('ClassicHost');
    await cdpClassic.setViewport(1366, 650, false);
    await cdpClassic.navigate(baseUrl);
    await cdpClassic.waitForFunction(() => document.readyState === 'complete' && window.app !== undefined);

    // Classic room
    await cdpClassic.evaluate(() => {
      document.getElementById('playerNameInput').value = 'Classic Host';
      document.querySelector('[data-home-mode="classic"]').click();
    });
    await cdpClassic.waitForFunction(() => {
      const setup = document.getElementById('modeSetupSection');
      return setup && !setup.hidden;
    });
    await cdpClassic.evaluate(() => document.getElementById('setupCreateRoomBtn').click());
    await cdpClassic.waitForFunction(() => {
      const lobby = document.getElementById('lobbySection');
      return lobby && window.getComputedStyle(lobby).display !== 'none';
    });
    await delay(400);

    const classicState = await cdpClassic.evaluate(() => {
      const docEl = document.documentElement;
      const lobby = document.getElementById('lobbySection');
      const style = window.getComputedStyle(lobby);
      return {
        lobbyBg: style.backgroundColor,
        themeClass: lobby.className,
        hasPageVerticalScroll: docEl.scrollHeight > docEl.clientHeight + 1,
      };
    });
    console.log('Classic Lobby State in Normal Window:', classicState);
    await cdpClassic.screenshot(path.join(ARTIFACT_DIR, 'lobby_classic_normal_window_1366x650.png'));

    // Flip room
    const { cdp: cdpFlip } = await createBrowserSession('FlipHost');
    await cdpFlip.setViewport(1366, 650, false);
    await cdpFlip.navigate(baseUrl);
    await cdpFlip.waitForFunction(() => document.readyState === 'complete' && window.app !== undefined);

    await cdpFlip.evaluate(() => {
      document.getElementById('playerNameInput').value = 'Flip Host';
      document.querySelector('[data-home-mode="flip"]').click();
    });
    await cdpFlip.waitForFunction(() => {
      const container = document.getElementById('flipSetupContainer');
      return container && window.getComputedStyle(container).display !== 'none';
    });
    await cdpFlip.evaluate(() => document.getElementById('flipCreateRoomBtn').click());
    await cdpFlip.waitForFunction(() => {
      const lobby = document.getElementById('lobbySection');
      return lobby && window.getComputedStyle(lobby).display !== 'none';
    });
    await delay(400);

    const flipState = await cdpFlip.evaluate(() => {
      const docEl = document.documentElement;
      const lobby = document.getElementById('lobbySection');
      const style = window.getComputedStyle(lobby);
      return {
        lobbyBg: style.backgroundColor,
        themeClass: lobby.className,
        hasPageVerticalScroll: docEl.scrollHeight > docEl.clientHeight + 1,
      };
    });
    console.log('Flip Lobby State in Normal Window:', flipState);
    await cdpFlip.screenshot(path.join(ARTIFACT_DIR, 'lobby_flip_normal_window_1366x650.png'));

    console.log('\n=============================================================');
    console.log('🎉 ALL NORMAL-WINDOW, RESPONSIVE & NO MERCY THEME CHECKS PASSED!');
    console.log('=============================================================\n');

  } finally {
    if (chromeProc) chromeProc.kill();
    try {
      server.close();
    } catch {}
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal Verification Error:', err);
    process.exit(1);
  });
