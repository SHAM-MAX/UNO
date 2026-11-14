import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HOST_DEBUG_PORT = 9458;
const GUEST_DEBUG_PORT = 9459;
const SERVER_PORT = 3095;
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

class CDPClient {
  constructor(wsUrl, tag = 'Client') {
    this.wsUrl = wsUrl;
    this.tag = tag;
    this.ws = null;
    this.reqId = 1;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });

    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id && this.callbacks.has(msg.id)) {
        const cb = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) cb.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else cb.resolve(msg.result);
      }
    });

    await this.send('Page.enable');
    await this.send('DOM.enable');
    await this.send('Runtime.enable');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.reqId++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${res.exceptionDetails.text || res.exceptionDetails.exception?.description}`);
    }
    return res.result ? res.result.value : undefined;
  }

  async screenshot(filePath, clip = null) {
    const params = { format: 'png' };
    if (clip) params.clip = clip;
    const res = await this.send('Page.captureScreenshot', params);
    const buf = Buffer.from(res.data, 'base64');
    fs.writeFileSync(filePath, buf);
    console.log(`[Screenshot] Saved ${path.basename(filePath)} (${buf.length} bytes)`);
    // Copy to artifact directory
    const artifactPath = path.join(ARTIFACT_DIR, path.basename(filePath));
    try {
      fs.writeFileSync(artifactPath, buf);
    } catch (e) {
      console.warn(`[Screenshot] Could not copy to artifact dir: ${e.message}`);
    }
  }

  async setViewport(width, height, isMobile = false, deviceScaleFactor = 1) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile: isMobile,
    });
  }

  close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) { }
    }
  }
}

async function run() {
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uno-rules-verify-'));
  const tempDbPath = path.join(tempDbDir, 'test.sqlite');

  console.log(`[Setup] Starting test server on port ${SERVER_PORT}...`);
  const serverProcess = spawn('node', ['server/src/index.js'], {
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      DB_PATH: tempDbPath,
      ENABLE_AUTH_PERSISTENCE: 'false',
    },
    stdio: 'pipe',
  });

  await delay(1200);

  const hostUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'uno-chrome-host-'));
  const guestUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'uno-chrome-guest-'));

  console.log(`[Setup] Launching Host Chrome on debug port ${HOST_DEBUG_PORT}...`);
  const hostChromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${HOST_DEBUG_PORT}`,
    `--user-data-dir=${hostUserData}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]);

  console.log(`[Setup] Launching Guest Chrome on debug port ${GUEST_DEBUG_PORT}...`);
  const guestChromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${GUEST_DEBUG_PORT}`,
    `--user-data-dir=${guestUserData}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]);

  await delay(1800);

  let hostCdp = null;
  let guestCdp = null;

  try {
    const hostList = await httpGetJson(`http://127.0.0.1:${HOST_DEBUG_PORT}/json/list`);
    const hostTarget = hostList.find((t) => t.type === 'page');
    if (!hostTarget) throw new Error('No host page target found');

    hostCdp = new CDPClient(hostTarget.webSocketDebuggerUrl, 'HostPage');
    await hostCdp.connect();
    await hostCdp.setViewport(1280, 850);

    const baseUrl = `http://localhost:${SERVER_PORT}`;
    console.log(`[Test] Navigating Host to ${baseUrl}...`);
    await hostCdp.send('Page.navigate', { url: baseUrl });
    await delay(1200);

    // ==========================================
    // TEST 1: Play vs AI Landing Page Customization
    // ==========================================
    console.log('\n--- TEST 1: Play vs AI Landing Page Customization ---');
    await hostCdp.evaluate(`
      document.getElementById('playerNameInput').value = 'RulesTester';
      document.getElementById('playVsAiBtn').click();
    `);
    await delay(500);

    // Select UNO Flip mode, 3 Players
    await hostCdp.evaluate(`
      document.querySelector('.ai-mode-card[data-mode="flip"]').click();
      document.querySelector('.ai-player-pill[data-count="3"]').click();
    `);
    await delay(300);

    // Check initial summary
    const initialBadge = await hostCdp.evaluate(`document.getElementById('aiRulesStatusBadge').textContent`);
    const initialSummary = await hostCdp.evaluate(`document.getElementById('aiRulesSummaryText').textContent`);
    console.log(`[AI Form] Initial badge: "${initialBadge}", summary: "${initialSummary}"`);

    // Click customize rules button
    await hostCdp.evaluate(`document.getElementById('aiCustomizeRulesBtn').click()`);
    await delay(400);

    const isModalActive = await hostCdp.evaluate(`document.getElementById('gameRulesModal').classList.contains('active')`);
    console.log(`[Modal] Game rules modal active: ${isModalActive}`);

    // Customize rules: 5 cards missed UNO penalty, 5 starting hand size, stacking ON
    await hostCdp.evaluate(`
      const penalty = document.getElementById('ruleMissedUnoPenalty');
      penalty.value = "5";
      penalty.dispatchEvent(new Event('change'));

      const hand = document.getElementById('ruleStartingHandSize');
      hand.value = "5";
      hand.dispatchEvent(new Event('change'));

      const stacking = document.getElementById('ruleFlipStacking');
      stacking.checked = true;
      stacking.dispatchEvent(new Event('change'));
    `);
    await delay(300);

    const modalBadge = await hostCdp.evaluate(`document.getElementById('gameRulesTypeBadge').textContent`);
    console.log(`[Modal] Updated badge in modal: "${modalBadge}"`);

    // Screenshot 1: Game Rules Modal Desktop
    await hostCdp.screenshot('game_rules_modal_desktop.png');

    // Close modal via Done button
    await hostCdp.evaluate(`document.getElementById('ruleApplyBtn').click()`);
    await delay(300);

    const updatedAiBadge = await hostCdp.evaluate(`document.getElementById('aiRulesStatusBadge').textContent`);
    const updatedAiSummary = await hostCdp.evaluate(`document.getElementById('aiRulesSummaryText').textContent`);
    console.log(`[AI Form] Updated badge: "${updatedAiBadge}", summary: "${updatedAiSummary}"`);

    // Screenshot 2: AI Setup Form with custom rules
    await hostCdp.screenshot('game_rules_ai_setup_desktop.png');

    // ==========================================
    // TEST 2: Start Match and Verify Rule Locking in Gameplay
    // ==========================================
    console.log('\n--- TEST 2: Start Match & In-Game Rule Locking ---');
    await hostCdp.evaluate(`document.getElementById('aiSetupStartBtn').click()`);

    // Deterministically wait for match to start
    for (let i = 0; i < 30; i++) {
      const isPlaying = await hostCdp.evaluate(`Boolean(window.app.gameState?.status === 'playing')`);
      if (isPlaying) break;
      await delay(200);
    }

    const inArena = await hostCdp.evaluate(`document.body.classList.contains('in-arena')`);
    const matchHouseRules = await hostCdp.evaluate(`window.app.gameState?.houseRules`);
    const myHandCount = await hostCdp.evaluate(`window.app.clientView?.myHand?.length`);
    console.log(`[Match] In arena: ${inArena}, Starting hand count: ${myHandCount}`);
    console.log(`[Match] Active house rules:`, matchHouseRules);

    if (matchHouseRules?.missedUnoPenalty !== 5) throw new Error(`Expected missedUnoPenalty 5, got ${matchHouseRules?.missedUnoPenalty}`);
    if (matchHouseRules?.startingHandSize !== 5) throw new Error(`Expected startingHandSize 5, got ${matchHouseRules?.startingHandSize}`);
    if (myHandCount !== 5) throw new Error(`Expected starting hand of 5 cards, got ${myHandCount}`);

    // Click RULES in top nav to inspect active rules
    await hostCdp.evaluate(`document.getElementById('howToPlayBtn').click()`);
    await delay(400);

    const arenaModalActive = await hostCdp.evaluate(`document.getElementById('gameRulesModal').classList.contains('active')`);
    const lockedBannerHidden = await hostCdp.evaluate(`document.getElementById('rulesLockedBanner').hidden`);
    const penaltyInputDisabled = await hostCdp.evaluate(`document.getElementById('ruleMissedUnoPenalty').disabled`);
    const restoreBtnDisplay = await hostCdp.evaluate(`window.getComputedStyle(document.getElementById('ruleRestoreDefaultsBtn')).display`);

    console.log(`[Arena Rules] Modal active: ${arenaModalActive}, Locked banner hidden: ${lockedBannerHidden}, Inputs disabled: ${penaltyInputDisabled}, Restore btn: ${restoreBtnDisplay}`);

    // Screenshot 3: In-Game Arena Rules Locked (Mobile view for variety)
    await hostCdp.setViewport(390, 844, true, 2);
    await delay(300);
    await hostCdp.screenshot('game_rules_arena_locked_mobile.png');

    // Reset viewport and close modal
    await hostCdp.setViewport(1280, 850);
    await hostCdp.evaluate(`document.getElementById('ruleApplyBtn').click()`);
    await delay(300);

    // ==========================================
    // TEST 3: Multiplayer Lobby Synchronization & Guest Re-readiness
    // ==========================================
    console.log('\n--- TEST 3: Multiplayer Lobby Synchronization & Guest Re-readiness ---');
    // Navigate Host back to home to create a multiplayer room
    await hostCdp.send('Page.navigate', { url: baseUrl });
    for (let i = 0; i < 30; i++) {
      const isReady = await hostCdp.evaluate(`Boolean(window.app && document.readyState === 'complete')`);
      if (isReady) break;
      await delay(200);
    }

    await hostCdp.evaluate(`
      localStorage.clear();
      document.getElementById('playerNameInput').value = 'HostPlayer';
      document.getElementById('createRoomBtn').click();
    `);

    let hostRoomId = null;
    for (let i = 0; i < 30; i++) {
      hostRoomId = await hostCdp.evaluate(`window.app?.gameState?.roomId || window.app?.roomId`);
      if (hostRoomId) break;
      await delay(200);
    }
    console.log(`[Multiplayer] Host created room ${hostRoomId}`);
    if (!hostRoomId) throw new Error('Host failed to create room');

    // Connect Guest Chrome
    const guestList = await httpGetJson(`http://127.0.0.1:${GUEST_DEBUG_PORT}/json/list`);
    const guestTarget = guestList.find((t) => t.type === 'page');
    if (!guestTarget) throw new Error('No guest page target found');

    guestCdp = new CDPClient(guestTarget.webSocketDebuggerUrl, 'GuestPage');
    await guestCdp.connect();
    await guestCdp.setViewport(1280, 850);
    console.log(`[Test] Navigating Guest to ${baseUrl}/?room=${hostRoomId}...`);
    await guestCdp.send('Page.navigate', { url: `${baseUrl}/?room=${hostRoomId}` });

    // Wait until guest page DOM and window.app are completely ready
    for (let i = 0; i < 30; i++) {
      const isReady = await guestCdp.evaluate(`Boolean(window.app && document.readyState === 'complete')`);
      if (isReady) break;
      await delay(200);
    }

    // Guest joins room
    await guestCdp.evaluate(`
      document.getElementById('playerNameInput').value = 'GuestPlayer';
      document.getElementById('roomCodeInput').value = '${hostRoomId}';
      document.getElementById('joinRoomBtn').click();
    `);

    // Wait until guest is in lobby
    for (let i = 0; i < 30; i++) {
      const inLobby = await guestCdp.evaluate(`Boolean(window.app?.clientView && window.app?.gameState?.status === 'lobby')`);
      if (inLobby) break;
      await delay(200);
    }

    // Guest sets Ready
    await guestCdp.evaluate(`document.getElementById('readyBtn')?.click()`);

    // Deterministically wait until host sees guest is ready
    for (let i = 0; i < 30; i++) {
      const ready = await hostCdp.evaluate(`Boolean(window.app?.gameState?.players?.find(p => p.name === 'GuestPlayer')?.isReady)`);
      if (ready) break;
      await delay(200);
    }

    const guestReadyBefore = await hostCdp.evaluate(`window.app?.gameState?.players?.find(p => p.name === 'GuestPlayer')?.isReady`);
    console.log(`[Multiplayer] Guest ready state before rule change: ${guestReadyBefore}`);

    // Screenshot 4: Host Lobby with Rules Panel
    await hostCdp.screenshot('game_rules_lobby_host.png');

    // Screenshot 5: Guest Lobby with Rules Panel
    await guestCdp.screenshot('game_rules_lobby_guest.png');

    // Host opens rules modal and changes Missed UNO penalty to 6 cards
    await hostCdp.evaluate(`
      document.getElementById('lobbyRulesBtn')?.click();
    `);
    await delay(400);

    await hostCdp.evaluate(`
      const penalty = document.getElementById('ruleMissedUnoPenalty');
      if (penalty) {
        penalty.value = "6";
        penalty.dispatchEvent(new Event('change'));
      }
    `);
    await delay(400);

    // Wait until guest receives unreadied state and 6 cards rule
    for (let i = 0; i < 30; i++) {
      const p = await guestCdp.evaluate(`window.app?.gameState?.houseRules?.missedUnoPenalty`);
      if (p === 6) break;
      await delay(200);
    }

    // Verify Guest was unreadied
    const guestReadyAfter = await hostCdp.evaluate(`window.app?.gameState?.players?.find(p => p.name === 'GuestPlayer')?.isReady`);
    const guestSeenPenalty = await guestCdp.evaluate(`window.app?.gameState?.houseRules?.missedUnoPenalty`);
    const guestLobbyChips = await guestCdp.evaluate(`document.getElementById('lobbyRulesPanel')?.textContent || ''`);

    console.log(`[Multiplayer] Guest ready state after host rule change: ${guestReadyAfter} (Expected: false)`);
    console.log(`[Multiplayer] Guest received penalty: ${guestSeenPenalty} cards (Expected: 6)`);
    console.log(`[Multiplayer] Guest lobby text contains 6 cards: ${guestLobbyChips.includes('6 cards')}`);

    if (guestReadyAfter !== false) throw new Error('Guest was not unreadied after host changed rules!');
    if (guestSeenPenalty !== 6) throw new Error(`Expected guest to receive 6 card penalty, got ${guestSeenPenalty}`);

    // ==========================================
    // TEST 4: Mobile Responsive Rules Modal (Portrait & Landscape)
    // ==========================================
    console.log('\n--- TEST 4: Mobile Responsive Rules Modal ---');
    // Open modal on host
    await hostCdp.evaluate(`document.getElementById('gameRulesModalClose').click()`);
    await delay(200);

    // Mobile Portrait: 390 x 844
    await hostCdp.setViewport(390, 844, true, 2);
    await hostCdp.evaluate(`document.getElementById('lobbyRulesBtn').click()`);
    await delay(400);
    await hostCdp.screenshot('game_rules_modal_mobile_portrait.png');

    // Mobile Landscape: 844 x 390
    await hostCdp.setViewport(844, 390, true, 2);
    await delay(400);
    await hostCdp.screenshot('game_rules_modal_mobile_landscape.png');

    console.log('\n✅ ALL GAME RULES VERIFICATIONS COMPLETED SUCCESSFULLY!');
  } finally {
    if (hostCdp) hostCdp.close();
    if (guestCdp) guestCdp.close();
    hostChromeProcess.kill();
    guestChromeProcess.kill();
    serverProcess.kill();
    try {
      fs.rmSync(tempDbDir, { recursive: true, force: true });
      fs.rmSync(hostUserData, { recursive: true, force: true });
      fs.rmSync(guestUserData, { recursive: true, force: true });
    } catch (e) { }
  }
}

run().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
