import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9465;
const SERVER_PORT = 3097;
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

  async setViewport(width, height, isMobile = false, deviceScaleFactor = 1) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile: isMobile,
    });
  }

  async screenshot(filePath, clip = null) {
    const params = { format: 'png' };
    if (clip) params.clip = clip;
    const res = await this.send('Page.captureScreenshot', params);
    const buf = Buffer.from(res.data, 'base64');
    fs.writeFileSync(filePath, buf);
    console.log(`[Screenshot] Saved ${path.basename(filePath)} (${buf.length} bytes)`);
    const artifactPath = path.join(ARTIFACT_DIR, path.basename(filePath));
    try {
      fs.writeFileSync(artifactPath, buf);
    } catch (e) {
      console.warn(`[Screenshot] Could not copy to artifact dir: ${e.message}`);
    }
  }

  close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
    }
  }
}

async function run() {
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uno_theme_test_'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome_uno_theme_'));

  console.log(`[Setup] Starting test server on port ${SERVER_PORT}...`);
  const serverProcess = spawn('node', ['server/src/index.js'], {
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      DB_PATH: path.join(tempDbDir, 'uno.sqlite'),
    },
    stdio: 'inherit',
  });

  await delay(1500);

  console.log(`[Setup] Launching Chrome on debug port ${DEBUG_PORT}...`);
  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]);

  await delay(1800);

  let cdp = null;

  try {
    const targetList = await httpGetJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const target = targetList.find((t) => t.type === 'page');
    if (!target) throw new Error('No page target found');

    cdp = new CDPClient(target.webSocketDebuggerUrl, 'ThemeTester');
    await cdp.connect();
    await cdp.setViewport(1280, 850);

    const baseUrl = `http://localhost:${SERVER_PORT}`;
    console.log(`[Test] Navigating to ${baseUrl}...`);
    await cdp.send('Page.navigate', { url: baseUrl });
    await delay(1200);

    // ================================================================
    // 1. Landing navbar Settings button: Default & Hover states
    // ================================================================
    console.log('\n--- 1. Landing navbar Settings button (Default & Hover) ---');
    // Get box coordinates for settings button
    const btnBox = await cdp.evaluate(`
      (() => {
        const btn = document.getElementById('settingsBtn');
        const rect = btn.getBoundingClientRect();
        return {
          x: Math.max(0, rect.x - 20),
          y: Math.max(0, rect.y - 10),
          width: rect.width + 40,
          height: rect.height + 20,
          scale: 1
        };
      })()
    `);

    // Capture default state
    await cdp.screenshot('uno_arena_landing_default.png');
    if (btnBox) {
      await cdp.screenshot('uno_arena_settings_btn_default.png', btnBox);
    }

    // Hover over Settings button
    const btnCenter = await cdp.evaluate(`
      (() => {
        const btn = document.getElementById('settingsBtn');
        const rect = btn.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })()
    `);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: btnCenter.x,
      y: btnCenter.y,
    });
    await delay(200);

    if (btnBox) {
      await cdp.screenshot('uno_arena_settings_btn_hover.png', btnBox);
    }

    // ================================================================
    // 2. Settings Modal: General Tab
    // ================================================================
    console.log('\n--- 2. Settings Modal: General Tab ---');
    await cdp.evaluate(`document.getElementById('settingsBtn').click()`);
    await delay(400);

    await cdp.screenshot('uno_arena_settings_general.png');

    // ================================================================
    // 3. Settings Modal: Game Rules Tab
    // ================================================================
    console.log('\n--- 3. Settings Modal: Game Rules Tab ---');
    await cdp.evaluate(`document.getElementById('tabBtnGameRules').click()`);
    await delay(400);

    await cdp.screenshot('uno_arena_settings_rules.png');

    // ================================================================
    // 4. Cleaned Lobby without duplicate rules panel
    // ================================================================
    console.log('\n--- 4. Cleaned Lobby (Multiplayer Room) ---');
    // Close modal
    await cdp.evaluate(`document.getElementById('settingsModalClose').click()`);
    await delay(300);

    // Create room
    await cdp.evaluate(`
      document.getElementById('playerNameInput').value = 'LobbyHost';
      document.getElementById('createRoomBtn').click();
    `);

    for (let i = 0; i < 30; i++) {
      const inLobby = await cdp.evaluate(`Boolean(document.body.classList.contains('in-room') && window.app?.gameState?.roomId)`);
      if (inLobby) break;
      await delay(200);
    }

    const duplicatePanelExists = await cdp.evaluate(`Boolean(document.getElementById('lobbyRulesPanel'))`);
    console.log(`[Lobby] Duplicate lobbyRulesPanel in DOM: ${duplicatePanelExists}`);

    await delay(500);
    await cdp.screenshot('uno_arena_cleaned_lobby.png');

    // Open settings from lobby (should open Game Rules tab for room)
    console.log('\n--- Lobby Settings Click (Opens Room Rules) ---');
    await cdp.evaluate(`document.getElementById('settingsBtn').click()`);
    await delay(400);
    await cdp.screenshot('uno_arena_lobby_settings_rules.png');

    await cdp.evaluate(`document.getElementById('settingsModalClose').click()`);
    await delay(200);

    // ================================================================
    // 5. Mobile Settings Layout (Portrait & Landscape)
    // ================================================================
    console.log('\n--- 5. Mobile Settings Layout ---');
    // Portrait 390x844
    await cdp.setViewport(390, 844, true, 2);
    await cdp.evaluate(`document.getElementById('settingsBtn').click()`);
    await delay(400);
    await cdp.screenshot('uno_arena_settings_mobile_portrait.png');

    // Landscape 844x390
    await cdp.setViewport(844, 390, true, 2);
    await delay(400);
    await cdp.screenshot('uno_arena_settings_mobile_landscape.png');

    console.log('\n✨ ALL UNO THEME AND BUTTON VERIFICATION SCREENSHOTS CAPTURED!');
  } finally {
    if (cdp) cdp.close();
    chromeProcess.kill();
    serverProcess.kill();
    try {
      fs.rmSync(tempDbDir, { recursive: true, force: true });
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

run().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
