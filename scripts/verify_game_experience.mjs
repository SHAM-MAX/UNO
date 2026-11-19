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





    await cdp.setViewport(390,844,true);
    for(const mode of ['classic','flip','no_mercy']) {
      await cdp.evaluate(new Function(`window.app.createRoom('Experience Host','${mode}',undefined,'fixed')`));
      await cdp.waitForFunction(()=>window.app.gameState?.status==='lobby');
      await cdp.evaluate(()=>window.app.send({type:'add_bot'}));await cdp.waitForFunction(()=>window.app.gameState.players.length===2);
      await cdp.evaluate(()=>window.app.send({type:'start_game'}));await cdp.waitForFunction(()=>window.app.gameState.status==='playing');
      const identity=await cdp.evaluate(()=>({room:window.app.roomId,player:window.app.playerId}));
      await cdp.evaluate(()=>window.app.ws.close());
      await cdp.waitForFunction(()=>window.app.connectionRecovering);
      if(!await cdp.evaluate(()=>window.app.el.playerHandCards.hasAttribute('inert')&&!window.app.send({type:'draw_card'})))throw Error('Disconnected move not blocked');
      await cdp.waitForFunction(()=>!window.app.connectionRecovering && window.app.ws.readyState===WebSocket.OPEN,10000);
      if(!await cdp.evaluate(new Function(`return window.app.roomId===${JSON.stringify(identity.room)}&&window.app.playerId===${JSON.stringify(identity.player)}`)))throw Error('Reconnect lost identity');
      const room=roomManager.getRoom(identity.room);room.currentTurn=room.players.findIndex(p=>p.id===identity.player);room.pendingAction=null;room.pendingDrawPenalty=0;room.turnDrawnCard=null;room.turnDrawnCardId=null;room.turnDeadline=Date.now()+30000;
      const face=c=>c.color?c:(room.flipSide==='dark'?c.dark:c.light);
      let playable=room.playerHands[identity.player].find(c=>face(c)?.type==='number'&&![0,7].includes(face(c).value));
      if(!playable){playable=room.drawPile.find(c=>face(c)?.type==='number'&&![0,7].includes(face(c).value));room.drawPile=room.drawPile.filter(c=>c.id!==playable.id);room.playerHands[identity.player].push(playable);}
      room.activeColor=face(playable).color;
      room.topDiscard={...playable,id:'experience-top-'+mode};
      const view=roomManager.getClientView(identity.room,identity.player);
      await cdp.evaluate(new Function(`window.app.handleRoomState(${JSON.stringify(view)});window.experienceCardId=${JSON.stringify(playable.id)};`));
      await cdp.evaluate(()=>window.app.updateTurnTimer(Date.now()+4000,true,'playing'));
      if(!await cdp.evaluate(()=>document.getElementById('tableTurnStatus')?.classList.contains('is-urgent')))throw Error('Critical turn indicator missing');
      const tap=()=>cdp.evaluate(()=>{const w=window.app.handCardElements.get(window.experienceCardId);w.dispatchEvent(new PointerEvent('click',{bubbles:true,detail:1,pointerType:'touch'}));});
      await tap();
      await cdp.screenshot(path.join(ARTIFACT_DIR,'mobile-preview-'+mode+'.png'));
      if(!await cdp.evaluate(()=>window.app.selectedCardId===window.experienceCardId&&!window.app.inFlightCardId))throw Error('First tap played instead of preview');
      await tap();
      await cdp.waitForFunction(()=>window.app.selectedCardId===null);

      if(mode==='no_mercy'){
        room.houseRules.mercyKnockoutLimit=50;
        room.playerHands[identity.player]=room.drawPile.splice(0,35);room.players.find(p=>p.id===identity.player).cardCount=35;
        const largeView=roomManager.getClientView(identity.room,identity.player);
        const renderMs=await cdp.evaluate(new Function(`const start=performance.now();window.app.handleRoomState(${JSON.stringify(largeView)});return performance.now()-start;`));
        if(!await cdp.evaluate(()=>window.app.el.playerHandCards.querySelectorAll('[data-card-id]').length===35))throw Error('Large hand lost cards');
        console.log('35-card mobile hand render ms:',renderMs);
      }
      await cdp.evaluate(()=>window.app.confirmLeaveRoom());await delay(250);
    }
    await cdp.evaluate(async()=>{const {sounds}=await import('/audio.js');sounds.setVolume(.4);if(sounds.getVolume()!==.4)throw Error('Volume not applied');sounds.setEnabled(false);sounds.playPower('swap');if(sounds.isEnabled())throw Error('Mute failed');});
    for(const [w,h] of [[1440,900],[390,844],[844,390]]) {
      await cdp.setViewport(w,h,w<900);
      await cdp.evaluate(()=>{const a=window.app;a.clientView={canProposeRematch:true};a.gameState={mode:'no_mercy',status:'game_over',winnerId:'p0',players:Array.from({length:10},(_,i)=>({id:'p'+i,name:'Player '+i,cardCount:i?35:4,isEliminated:i>0,eliminationOrder:i?10-i:null}))};a.showGameOver(a.gameState);});
      await delay(300);
      if(!await cdp.evaluate(()=>{const r=document.getElementById('matchStandings').getBoundingClientRect();return document.querySelectorAll('#matchStandings li').length===10&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}))throw Error('Results overflow viewport');
      await cdp.screenshot(path.join(ARTIFACT_DIR,'enhanced-results-'+w+'.png'));
    }
    console.log('PASS reconnect identity and blocked offline moves in all modes, mobile two-tap play, critical turn, audio preferences and 10-player results layouts');cdp.close();
  } finally {
    chromeProc.kill();
    server.close();

  }
}

main().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
