import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9222;

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
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params?.args?.map((a) => a.value ?? JSON.stringify(a)).join(' ');
        console.log(`[Browser ${this.tag} Console]`, text);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.error(`[Browser ${this.tag} Exception]`, JSON.stringify(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text));
      }
    });

    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('DOM.enable');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.reqId++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`[${this.tag}] Eval error: ${JSON.stringify(result.exceptionDetails)}`);
    }
    return result.result?.value;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await delay(1200);
  }

  async waitForFunction(fnStr, timeout = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const val = await this.evaluate(`(${fnStr})()`);
        if (val) return val;
      } catch (e) {
        // retry
      }
      await delay(200);
    }
    throw new Error(`[${this.tag}] Timed out waiting for function: ${fnStr}`);
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function startHeadlessChrome() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uno-chrome-'));
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
  return { cdp, targetId: target.id };
}

async function resetBrowserPage(client, url) {
  await client.navigate(url);
  await client.waitForFunction(`() => document.readyState === 'complete' && !!window.app`);
  await client.evaluate(`
    localStorage.clear();
    window.location.href = '${url}';
  `);
  await delay(1000);
  await client.waitForFunction(`() => document.readyState === 'complete' && !!window.app`);
}

async function runTwoPlayerVerification() {
  console.log('===========================================================');
  console.log('🚀 Running Two-Player Browser Verification in Headless Chrome');
  console.log('   Origin 1 (Alice): http://localhost:3001');
  console.log('   Origin 2 (Bob):   http://127.0.0.1:3001 (Isolated Storage)');
  console.log('===========================================================');
  const { proc: chromeProc, tempDir } = await startHeadlessChrome();
  console.log(`[Chrome] Launched Chrome headless (PID ${chromeProc.pid})`);

  try {
    const s1 = await createBrowserSession('Alice');
    const s2 = await createBrowserSession('Bob');
    const alice = s1.cdp;
    const bob = s2.cdp;

    // -------------------------------------------------------------
    // Test 1: CLASSIC MODE
    // -------------------------------------------------------------
    console.log('\n[TEST 1] Verifying Classic Mode 2-Player Game in Browser...');
    await resetBrowserPage(alice, 'http://localhost:3001');
    await resetBrowserPage(bob, 'http://127.0.0.1:3001');

    // Alice creates Classic room
    await alice.evaluate(`
      document.getElementById('playerNameInput').value = 'Alice';
      document.getElementById('createRoomBtn').click();
    `);

    const roomCode = await alice.waitForFunction(`
      () => {
        const text = document.getElementById('lobbyCodeText')?.textContent?.trim();
        return (text && text !== '------' && text.length === 6) ? text : null;
      }
    `);
    console.log(`[Alice] Successfully created Classic room: ${roomCode}`);

    // Bob joins Classic room
    await bob.evaluate(`
      document.getElementById('playerNameInput').value = 'Bob';
      document.getElementById('roomCodeInput').value = '${roomCode}';
      document.getElementById('joinRoomBtn').click();
    `);

    // Wait for both in lobby
    await alice.waitForFunction(`() => document.querySelectorAll('#lobbyPlayersList .lobby-player-row').length === 2`);
    await bob.waitForFunction(`() => document.querySelectorAll('#lobbyPlayersList .lobby-player-row').length === 2`);
    console.log('[Lobby] Both Alice and Bob rendered in Lobby player roster!');

    // Bob clicks Ready
    await bob.evaluate(`document.getElementById('readyBtn').click();`);
    await alice.waitForFunction(`() => !document.getElementById('startGameBtn').disabled`);
    console.log('[Lobby] Both players ready; Start Game button enabled!');

    // Alice starts game
    await alice.evaluate(`document.getElementById('startGameBtn').click();`);
    await alice.waitForFunction(`() => document.getElementById('arenaView').style.display === 'flex'`);
    await bob.waitForFunction(`() => document.getElementById('arenaView').style.display === 'flex'`);
    console.log('[Arena] Felt table and Arena layout loaded in both browser sessions!');

    // Check hand counts and information hiding
    const aliceCards = await alice.evaluate(`document.querySelectorAll('#playerHandCards .card-wrapper').length`);
    const bobCards = await bob.evaluate(`document.querySelectorAll('#playerHandCards .card-wrapper').length`);
    console.log(`[Hand Check] Alice cards: ${aliceCards}, Bob cards: ${bobCards}`);
    if (aliceCards !== 7 || bobCards !== 7) throw new Error('Hands did not deal 7 cards each');

    const bobHandRevealed = await alice.evaluate(`window.app.gameState.players.find(p => p.name === 'Bob')?.hand !== undefined`);
    if (bobHandRevealed) throw new Error('Security failure: Opponent hand revealed in state');
    console.log('[Security] Verified information hiding: Opponent hands hidden from network.');

    // Execute first turn
    const isAliceTurn = await alice.evaluate(`window.app.clientView.isMyTurn`);
    const active = isAliceTurn ? alice : bob;
    const activeName = isAliceTurn ? 'Alice' : 'Bob';
    console.log(`[Turn 1] Active player: ${activeName}`);

    const moveAction = await active.evaluate(`
      (() => {
        const playable = document.querySelector('#playerHandCards .card-wrapper.playable');
        if (playable) {
          playable.click();
          return 'played card';
        } else {
          document.getElementById('btnDrawAction').click();
          return 'drew card';
        }
      })()
    `);
    console.log(`[Turn 1 Action] ${activeName} ${moveAction}`);
    await delay(500);

    const inactive = isAliceTurn ? bob : alice;
    const bannerMsg = await inactive.evaluate(`document.getElementById('actionBanner').textContent`);
    console.log(`[Broadcast] Inactive player banner: "${bannerMsg}"`);
    console.log('✔ Classic Mode verified successfully in dual real browser sessions!\n');

    // -------------------------------------------------------------
    // Test 2: UNO FLIP MODE
    // -------------------------------------------------------------
    console.log('[TEST 2] Verifying UNO Flip Mode in Real Browser...');
    await resetBrowserPage(alice, 'http://localhost:3001');
    await resetBrowserPage(bob, 'http://127.0.0.1:3001');

    // Create Flip Room
    await alice.evaluate(`
      document.querySelector('[data-home-mode="flip"]').click();
      document.getElementById('setupPlayerNameInput').value = 'FlipAlice';
      document.getElementById('setupCreateRoomBtn').click();
    `);

    const flipRoomCode = await alice.waitForFunction(`
      () => {
        const text = document.getElementById('lobbyCodeText')?.textContent?.trim();
        return (text && text !== '------' && text.length === 6) ? text : null;
      }
    `);
    console.log(`[Flip] Created Flip room: ${flipRoomCode}`);

    await bob.evaluate(`
      document.getElementById('playerNameInput').value = 'FlipBob';
      document.getElementById('roomCodeInput').value = '${flipRoomCode}';
      document.getElementById('joinRoomBtn').click();
    `);

    await alice.waitForFunction(`() => document.querySelectorAll('#lobbyPlayersList .lobby-player-row').length === 2`);
    await bob.evaluate(`document.getElementById('readyBtn').click();`);
    await alice.waitForFunction(`() => !document.getElementById('startGameBtn').disabled`);
    await alice.evaluate(`document.getElementById('startGameBtn').click();`);

    await alice.waitForFunction(`() => document.getElementById('arenaView').style.display === 'flex'`);
    await bob.waitForFunction(`() => document.getElementById('arenaView').style.display === 'flex'`);

    // Verify flip side matches table styling
    const flipSide = await alice.evaluate(`window.app.gameState.flipSide`);
    const feltDark = await alice.evaluate(`document.getElementById('tableFelt').classList.contains('dark-side')`);
    console.log(`[Flip State] Active side: ${flipSide}, Table felt dark-side class: ${feltDark}`);
    if ((flipSide === 'dark') !== feltDark) throw new Error('Table felt styling does not match active flip side');

    // Verify deck composition is 112 cards (112 - 15 = 97 remaining)
    const flipRemaining = await alice.evaluate(`window.app.gameState.deckRemainingCount`);
    console.log(`[Flip Deck Remaining] ${flipRemaining} cards`);
    if (flipRemaining !== 97) throw new Error(`Expected 97 cards remaining in Flip deck, got ${flipRemaining}`);

    console.log('✔ UNO Flip Mode verified successfully in dual real browser sessions!\n');

    // -------------------------------------------------------------
    // Test 3: SHOW 'EM NO MERCY MODE
    // -------------------------------------------------------------
    console.log('[TEST 3] Verifying Show \'em No Mercy Mode in Real Browser...');
    await resetBrowserPage(alice, 'http://localhost:3001');
    await resetBrowserPage(bob, 'http://127.0.0.1:3001');

    // Create No Mercy room
    await alice.evaluate(`
      document.querySelector('[data-home-mode="no_mercy"]').click();
      document.getElementById('setupPlayerNameInput').value = 'MercyAlice';
      document.getElementById('setupCreateRoomBtn').click();
    `);

    const mercyRoomCode = await alice.waitForFunction(`
      () => {
        const text = document.getElementById('lobbyCodeText')?.textContent?.trim();
        return (text && text !== '------' && text.length === 6) ? text : null;
      }
    `);
    console.log(`[No Mercy] Created No Mercy room: ${mercyRoomCode}`);

    await bob.evaluate(`
      document.getElementById('playerNameInput').value = 'MercyBob';
      document.getElementById('roomCodeInput').value = '${mercyRoomCode}';
      document.getElementById('joinRoomBtn').click();
    `);

    await alice.waitForFunction(`() => document.querySelectorAll('#lobbyPlayersList .lobby-player-row').length === 2`);
    await bob.evaluate(`document.getElementById('readyBtn').click();`);
    await alice.waitForFunction(`() => !document.getElementById('startGameBtn').disabled`);
    await alice.evaluate(`document.getElementById('startGameBtn').click();`);

    await alice.waitForFunction(`() => document.getElementById('arenaView').style.display === 'flex'`);
    await bob.waitForFunction(`() => document.getElementById('arenaView').style.display === 'flex'`);

    // Verify 168 card deck mechanics (168 - 15 = 153 remaining)
    const mercyRemaining = await alice.evaluate(`window.app.gameState.deckRemainingCount`);
    console.log(`[No Mercy Deck Remaining] ${mercyRemaining} cards`);
    if (mercyRemaining !== 153) throw new Error(`Expected 153 cards remaining in No Mercy deck, got ${mercyRemaining}`);

    const modeTag = await alice.evaluate(`document.getElementById('navModeTag').textContent`);
    console.log(`[No Mercy UI] Mode tag in TopBar: "${modeTag}"`);

    alice.close();
    bob.close();
    console.log('✔ Show \'em No Mercy verified successfully in dual real browser sessions!\n');

    console.log('================================================================');
    console.log('🏆 SUCCESS: All 3 Modes Verified with Real Dual Browser Sessions!');
    console.log('================================================================');

  } finally {
    console.log('[Cleanup] Terminating Chrome headless instance...');
    chromeProc.kill();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

runTwoPlayerVerification().catch((err) => {
  console.error('Browser verification failed:', err);
  process.exit(1);
});
