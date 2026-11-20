import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9596;
const ARTIFACT_DIR = path.resolve('scratch/mode-entrance');

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

  const { server, roomManager } = await import('../server/src/index.js');
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  const baseUrl = process.env.ENTRANCE_TEST_URL || `http://localhost:${port}`;
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
    if (process.env.ENTRANCE_SLOW_NETWORK) {
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:300,downloadThroughput:600000,uploadThroughput:600000});
    }
    await cdp.navigate(baseUrl);
    console.log('Navigated to baseUrl, waiting for window.app...');
    await cdp.waitForFunction(() => window.app !== undefined && window.app.el !== undefined, 60000);
    console.log('window.app is loaded and ready.');
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'tabletop_brand_landing.png'));






    await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    await cdp.send('Network.setBlockedURLs',{urls:['*/assets/classic-cards-svg/*','*/assets/no-mercy-cards/*','*/assets/flip-cards/*']});
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:400,downloadThroughput:32000,uploadThroughput:16000});
    for(const mode of ['classic','flip','no_mercy']){
      const host=roomManager.createRoom('Fast Host',mode);roomManager.joinRoom(host.roomId,'Fast Opponent');roomManager.startGame(host.roomId,host.playerId);
      const room=roomManager.getRoom(host.roomId);room.pendingAction=null;room.currentTurn=1;
      const base=roomManager.getClientView(host.roomId,host.playerId);
      await cdp.setViewport(390,844,true);
      await cdp.evaluate(new Function(`window.app.roomId=${JSON.stringify(host.roomId)};window.app.playerId=${JSON.stringify(host.playerId)};window.app.handleRoomState(${JSON.stringify(base)});`));
      let latest;
      for(let i=0;i<12;i++){
        const face={color:['red','blue','yellow','green'][i%4],type:i===0?'reverse':'number',value:i%9+1};
        const card=mode==='flip'?{id:'fast-'+i,light:face,dark:{color:'purple',type:'number',value:4}}:{id:'fast-'+i,...face};
        const view=structuredClone(base);view.gameState.topDiscard=card;view.gameState.activeColor=face.color;view.gameState.currentTurn=i%2;view.gameState.players[1].cardCount=6;
        latest=card.id;
        const elapsed=await cdp.evaluate(new Function(`const t=performance.now();window.app.handleRoomState(${JSON.stringify(view)});return performance.now()-t;`));
        const visible=await cdp.evaluate(()=>{const n=window.app.el.discardPile.querySelector('.game-card'),f=n.querySelector('.card-instant-face');return !!f&&getComputedStyle(n).visibility!=='hidden'&&f.getBoundingClientRect().width>0;});
        if(!visible)throw Error('Opponent face delayed with blocked artwork: '+mode);
        if(i===0)await cdp.screenshot(path.join(ARTIFACT_DIR,'instant-card-'+mode+'.png'));
        await delay(30);
        if(elapsed>300)throw Error('Unexpected render stall '+elapsed);
      }
      await delay(300);
      if(await cdp.evaluate(()=>!!document.querySelector('.classic-motion-ghost')))throw Error('Rapid play left stale ghosts');
      console.log('PASS blocked card art and rapid plays',mode,latest);
    }
    await cdp.send('Network.setBlockedURLs',{urls:[]});await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    for(const mode of ['classic','flip','no_mercy']){
      await cdp.evaluate(new Function(`return (async()=>{const {renderCardHTML}=await import('/cardGraphics.js');const card={id:'loaded',color:'red',type:'number',value:4,light:{color:'red',type:'number',value:4},dark:{color:'purple',type:'number',value:4}};window.app.el.discardPile.innerHTML=renderCardHTML(card,{mode:'${mode}'});})()`));
      await cdp.waitForFunction(()=>{const image=window.app.el.discardPile.querySelector('img.card-art-ready');return image?.naturalWidth>0&&getComputedStyle(image).opacity==='1';},10000);
    }
    console.log('PASS authentic art replaces fallback when loaded');cdp.close();
  } finally {
    chromeProc.kill();
    server.close();

  }
}

main().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
