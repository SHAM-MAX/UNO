import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9596;
const ARTIFACT_DIR = path.resolve('scratch/back-navigation');

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

function httpPutJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'PUT', timeout: timeoutMs }, (res) => {
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
      reject(new Error(`httpPutJson timed out after ${timeoutMs}ms: ${url}`));
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
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uno-mobile-test-'));
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
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'tabletop_brand_landing.png'));



    await cdp.setViewport(390,844,true);
    await cdp.evaluate(()=>window.app.openModeSetup('flip'));
    await cdp.evaluate(()=>history.back());await cdp.waitForFunction(()=>window.app.selectedSetupMode===null);
    if(!await cdp.evaluate(()=>!window.app.el.modeHomeScreen.hidden))throw Error('Back did not return to landing');
    await cdp.evaluate(()=>history.forward());await cdp.waitForFunction(()=>window.app.selectedSetupMode==='flip');
    await cdp.evaluate(()=>window.app.openSettingsModal());await cdp.evaluate(()=>history.back());
    await cdp.waitForFunction(()=>!document.getElementById('settingsModal').classList.contains('active'));
    if(!await cdp.evaluate(()=>window.app.selectedSetupMode==='flip'))throw Error('Back from settings lost background screen');
    await cdp.evaluate(()=>history.back());await cdp.waitForFunction(()=>window.app.selectedSetupMode===null);
    await cdp.evaluate(()=>window.app.openAiSetup());await cdp.evaluate(()=>history.back());
    await cdp.waitForFunction(()=>!document.getElementById('mobileFormWrap').classList.contains('show-ai-form'));
    await cdp.evaluate(()=>window.app.openModeSetup('classic'));
    await cdp.evaluate(()=>window.app.createRoom('Back Host','classic',undefined,'fixed'));
    await cdp.waitForFunction(()=>window.app.gameState?.status==='lobby');
    await cdp.evaluate(()=>window.app.send({type:'add_bot'}));await cdp.waitForFunction(()=>window.app.gameState.players.length===2);
    await cdp.evaluate(()=>window.app.send({type:'start_game'}));await cdp.waitForFunction(()=>window.app.gameState.status==='playing');
    await cdp.evaluate(()=>window.app.openSettingsModal());await cdp.evaluate(()=>history.back());
    await cdp.waitForFunction(()=>!document.getElementById('settingsModal').classList.contains('active'));
    await cdp.evaluate(()=>history.back());await cdp.waitForFunction(()=>document.getElementById('leaveConfirmModal').classList.contains('active'));
    if(!await cdp.evaluate(()=>!!window.app.roomId))throw Error('Room left without confirmation');
    await cdp.evaluate(()=>history.back());await cdp.waitForFunction(()=>!document.getElementById('leaveConfirmModal').classList.contains('active'));
    if(!await cdp.evaluate(()=>!!window.app.roomId))throw Error('Cancel lost room');
    await cdp.evaluate(()=>history.back());await cdp.waitForFunction(()=>document.getElementById('leaveConfirmModal').classList.contains('active'));
    await cdp.evaluate(()=>window.app.confirmLeaveRoom());await cdp.waitForFunction(()=>!window.app.roomId&&window.app.selectedSetupMode==='classic');
    if(await cdp.evaluate(()=>location.search.includes('room=')))throw Error('Room URL retained after leaving');
    await cdp.evaluate(()=>history.forward());await delay(250);
    if(await cdp.evaluate(()=>!!window.app.roomId))throw Error('Forward rejoined an abandoned room');
    await cdp.navigate(baseUrl+'/?room=ABC123');await cdp.waitForFunction(()=>!!window.app);
    if(!await cdp.evaluate(()=>document.getElementById('roomCodeInput').value==='ABC123'&&location.search.includes('room=ABC123')))throw Error('Invite link lost its room code');
    console.log('PASS browser Back/Forward, mode screens, AI setup, modal dismissal, room confirmation/cancel and previous setup return');cdp.close();
  } finally {
    chromeProc.kill();
    server.close();

  }
}

main().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
