import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9593;
const ARTIFACT_DIR = path.resolve('scratch/install-suggestion');

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

async function main(){process.env.NODE_ENV='test';process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'uno-deck-hint-'));const {server,roomManager:rm}=await import('../server/src/index.js');await new Promise(r=>server.listen(0,r));const chrome=await startHeadlessChrome();let cdp;try{({cdp}=await createBrowserSession('Deck hint'));await cdp.setViewport(844,390,true);await cdp.navigate('http://localhost:'+server.address().port);await cdp.waitForFunction(()=>!!window.app);await cdp.evaluate(()=>{localStorage.setItem('uno_quick_guide_seen','true');window.app.createRoom('Sam','classic',undefined,'fixed')});await cdp.waitForFunction(()=>window.app.gameState?.status==='lobby');const code=await cdp.evaluate(()=>window.app.roomId),room=rm.getRoom(code),host=room.players[0].id;rm.joinRoom(code,'Friend');room.players.forEach(p=>p.isReady=true);await cdp.evaluate(()=>window.app.send({type:'start_game'}));await cdp.waitForFunction(()=>window.app.gameState?.status==='playing');room.currentTurn=0;room.pendingAction=null;room.pendingDrawPenalty=0;room.turnDrawnCard=null;room.topDiscard={id:'hint-top',type:'number',color:'red',value:5};room.activeColor='red';room.playerHands[host]=[{id:'held-blue',type:'number',color:'blue',value:2}];room.players[0].cardCount=1;room.drawPile.push({id:'hint-drawn',type:'number',color:'green',value:9});rm.resetTurnTimer(room);rm.onStateChange(code);await cdp.waitForFunction(()=>window.app.clientView.canDraw&&window.app.clientView.isMyTurn);if(!await cdp.evaluate(()=>getComputedStyle(window.app.el.btnDrawAction).display==='none'&&document.getElementById('deckDrawHint').hidden))throw Error('Button visible or hint premature');await cdp.evaluate(()=>{const a=window.app,base=structuredClone(a.clientView),penalty=structuredClone(base);penalty.gameState.pendingDrawPenalty=4;a.handleRoomState(penalty);const deck=a.el.drawPileBtn.getBoundingClientRect(),badge=document.getElementById('drawPenaltyBadge'),b=badge.getBoundingClientRect();if(badge.textContent!=='+4'||Math.abs(b.right-deck.right)>16||Math.abs(b.top-deck.top)>16||getComputedStyle(document.getElementById('penaltyTag')).display!=='none')throw Error('Penalty not attached only to draw deck');if(!getComputedStyle(document.getElementById('leaveBtn')).backgroundImage.includes('leave.png'))throw Error('Leave artwork missing');a.handleRoomState(base);});await delay(16500);if(!await cdp.evaluate(()=>document.getElementById('deckDrawHint').hidden))throw Error('Hint before 17 seconds');await delay(800);if(!await cdp.evaluate(()=>!document.getElementById('deckDrawHint').hidden))throw Error('Idle hint did not appear');if(!await cdp.evaluate(()=>document.querySelectorAll('.tap-click-ring').length===2&&getComputedStyle(document.querySelector('.tap-gesture-hand')).animationName==='deckFingerTap'))throw Error('Live tap gesture missing');fs.mkdirSync(ARTIFACT_DIR,{recursive:true});await cdp.screenshot(path.join(ARTIFACT_DIR,'animated-deck-tap.png'));await cdp.evaluate(()=>window.app.el.drawPileBtn.click());await cdp.waitForFunction(()=>window.app.clientView.myHand.length===2);if(!await cdp.evaluate(()=>document.getElementById('deckDrawHint').hidden))throw Error('Hint did not disappear after deck draw');await cdp.evaluate(()=>window.app.el.btnPassAction.click());await cdp.waitForFunction(()=>!window.app.clientView.isMyTurn);await delay(5200);if(!await cdp.evaluate(()=>document.getElementById('deckDrawHint').hidden))throw Error('Hint appears off turn');console.log('PASS draw CTA removed, delayed 17-second deck hint, deck draws one card, hint clears and stays hidden off turn');}finally{cdp?.close();chrome.proc.kill();server.close();}}main().catch(e=>{console.error(e);process.exit(1)});