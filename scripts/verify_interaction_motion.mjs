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






    await cdp.evaluate(async()=>{const {prepareCardArt}=await import('./card-atlas.js');await prepareCardArt('no_mercy');});
    const host=roomManager.createRoom('Motion Host','no_mercy');for(const name of ['Sam','Alex','Jamie'])roomManager.joinRoom(host.roomId,name);roomManager.startGame(host.roomId,host.playerId);
    const room=roomManager.getRoom(host.roomId);room.currentTurn=0;room.pendingAction=null;
    const initial=roomManager.getClientView(host.roomId,host.playerId);initial.canPass=false;
    await cdp.evaluate(new Function(`window.app.roomId=${JSON.stringify(host.roomId)};window.app.playerId=${JSON.stringify(host.playerId)};window.app.handleRoomState(${JSON.stringify(initial)});window.motionView=${JSON.stringify(initial)};`));
    await cdp.evaluate(()=>{const v=structuredClone(window.motionView);v.canPass=true;v.canCallUno=true;v.myHand=v.myHand.slice(0,2);window.app.handleRoomState(v);});
    if(!await cdp.evaluate(()=>window.app.el.btnPassAction.getAnimations().length>0&&window.app.el.btnUnoAction.getAnimations().length>0))throw Error('Entry motion missing');
    await delay(350);
    await cdp.evaluate(()=>window.app.handleRoomState(window.motionView));
    if(!await cdp.evaluate(()=>window.app.el.btnPassAction.style.display==='none'&&!!document.querySelector('.interaction-control-exit')&&[...document.querySelectorAll('.interaction-control-exit')].every(n=>n.inert&&!n.id)))throw Error('Unsafe or missing exit');
    await delay(220);if(await cdp.evaluate(()=>!!document.querySelector('.interaction-control-exit')))throw Error('Exit clones leaked');
    for(const [w,h] of [[1440,900],[390,844],[844,390]]){
      await cdp.setViewport(w,h,w<900);
      await cdp.evaluate(()=>{window.app.pendingPlayCard={id:'test-seven'};window.app.openSwapPicker();});await delay(350);
      const bounds=await cdp.evaluate(()=>{const r=document.querySelector('.swap-picker-card').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;});
      if(!bounds)throw Error('Swap picker clipped');
      await cdp.screenshot(path.join(ARTIFACT_DIR,'swap-picker-'+w+'.png'));
      await cdp.evaluate(async()=>{const {setGameModal}=await import('/interaction-motion.js');setGameModal(window.app.el.swapPickerModal,false);window.app.openSwapPicker();});
      await delay(350);
      if(!await cdp.evaluate(()=>window.app.el.swapPickerModal.classList.contains('active')&&!window.app.el.swapPickerModal.inert))throw Error('Reopening during exit failed');
      await cdp.evaluate(async()=>{const {setGameModal}=await import('/interaction-motion.js');setGameModal(window.app.el.swapPickerModal,false);});await delay(220);
    }
    await cdp.evaluate(()=>{window.app.pendingPlayCard={id:'test-seven'};window.sentSwap=[];window.originalSend=window.app.send;window.app.send=p=>{window.sentSwap.push(p);return true;};window.app.openSwapPicker();});await delay(350);
    await cdp.evaluate(()=>{const n=document.querySelector('#swapOptionsContainer button');n.click();n.click();});
    if(!await cdp.evaluate(()=>window.sentSwap.length===1&&window.sentSwap[0].data.cardId==='test-seven'&&window.app.el.swapPickerModal.inert&&!window.app.el.swapPickerModal.classList.contains('active')))throw Error('Swap click was not safe');
    await delay(220);await cdp.evaluate(()=>window.app.send=window.originalSend);
    await cdp.evaluate(()=>window.app.openRouletteModal(false));await delay(350);
    await cdp.evaluate(()=>window.app.closeRouletteModal());await delay(220);
    if(!await cdp.evaluate(()=>!window.app.el.rouletteModal.classList.contains('active')&&window.app.el.rouletteModal.style.display==='none'))throw Error('Roulette exit incomplete');
    await cdp.evaluate(()=>window.app.showCaughtFailedModal({targetName:'Sam'}));await delay(2700);
    if(!await cdp.evaluate(()=>window.app.el.caughtFailedModal.style.display==='none'))throw Error('Caught exit incomplete');
    await cdp.evaluate(async()=>{document.body.classList.add('reduced-motion');const {setGameModal,setActionVisible}=await import('/interaction-motion.js');setGameModal(window.app.el.swapPickerModal,true);setGameModal(window.app.el.swapPickerModal,false);setActionVisible(window.app.el.btnPassAction,true);setActionVisible(window.app.el.btnPassAction,false);});
    if(await cdp.evaluate(()=>!!document.querySelector('.interaction-control-exit,.interaction-exiting')))throw Error('Reduced motion did not close immediately');
    console.log('PASS action entry/exit, inert exits, swap themed layouts and single send, rapid reopen, roulette/caught dismissal and reduced motion');cdp.close();
  } finally {
    chromeProc.kill();
    server.close();

  }
}

main().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
