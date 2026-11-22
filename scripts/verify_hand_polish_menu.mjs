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

async function main(){process.env.NODE_ENV='test';process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'uno-polish-'));fs.mkdirSync(ARTIFACT_DIR,{recursive:true});const {server,roomManager:rm}=await import('../server/src/index.js');await new Promise(r=>server.listen(0,r));const chrome=await startHeadlessChrome();let cdp;try{({cdp}=await createBrowserSession('Polished hand'));await cdp.setViewport(1366,768);await cdp.navigate('http://localhost:'+server.address().port);await cdp.waitForFunction(()=>!!window.app);await cdp.evaluate(()=>{localStorage.setItem('uno_quick_guide_seen','true');window.app.createRoom('Sam','classic',undefined,'fixed')});await cdp.waitForFunction(()=>window.app.gameState?.status==='lobby');const code=await cdp.evaluate(()=>window.app.roomId),room=rm.getRoom(code);rm.joinRoom(code,'Friend');room.players.forEach(p=>p.isReady=true);await cdp.evaluate(()=>window.app.send({type:'start_game'}));await cdp.waitForFunction(()=>window.app.gameState?.status==='playing');room.currentTurn=0;room.pendingAction=null;room.pendingDrawPenalty=0;room.turnDrawnCard=null;room.topDiscard={id:'polish-top',type:'number',color:'red',value:5};room.activeColor='red';room.playerHands[room.players[0].id]=['blue','red','blue','red'].map((color,i)=>({id:'polish-'+i,type:'number',color,value:i+1}));room.players[0].cardCount=4;rm.onStateChange(code);await cdp.waitForFunction(()=>document.querySelectorAll('[data-card-id^="polish-"]').length===4);await delay(300);
const states=await cdp.evaluate(()=>[...document.querySelectorAll('.hand-cards .card-wrapper')].map(n=>({id:n.dataset.cardId,disabled:n.getAttribute('aria-disabled'),opacity:getComputedStyle(n).opacity,filter:getComputedStyle(n.querySelector('.game-card')).filter,shadow:getComputedStyle(n.querySelector('.game-card')).boxShadow})));if(states.filter(s=>s.disabled==='true').length!==2||!states.every(s=>s.opacity==='1')||states[0].filter===states[1].filter)throw Error('Enabled and disabled states not distinct '+JSON.stringify(states));
const rect=await cdp.evaluate(()=>{const r=document.querySelector('[data-card-id="polish-3"]').getBoundingClientRect();return {x:r.x+r.width*.5,y:r.y+r.height*.3,top:r.top,width:r.width}});await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x,y:rect.y});await delay(260);const hovered=await cdp.evaluate(()=>{const r=document.querySelector('[data-card-id="polish-3"]').getBoundingClientRect();return {top:r.top,width:r.width}});if(hovered.top>=rect.top-12)throw Error('Hover did not lift card '+JSON.stringify({rect,hovered}));await cdp.screenshot(path.join(ARTIFACT_DIR,'polished-hand-hover.png'));
await cdp.evaluate(()=>document.getElementById('arenaMenuToggle').click());const menu=await cdp.evaluate(()=>{const p=document.getElementById('arenaMenuPanel'),r=p.getBoundingClientRect(),e=document.elementFromPoint(r.x+35,r.y+22);return {open:!p.hidden,visible:p.contains(e),fullscreen:getComputedStyle(document.getElementById('fullscreenToggleBtn')).display,red:getComputedStyle(document.getElementById('arenaMenuToggle')).color}});if(!menu.open||!menu.visible||menu.fullscreen!=='none'||menu.red!=='rgb(244, 25, 8)')throw Error('Menu misplaced '+JSON.stringify(menu));await cdp.screenshot(path.join(ARTIFACT_DIR,'arena-three-dot-menu.png'));await cdp.evaluate(()=>document.querySelector('[data-arena-option="tools"]').click());await cdp.evaluate(()=>document.getElementById('sortHandBtn').click());if(!await cdp.evaluate(()=>window.app.handSort!=='dealt'))throw Error('Tools do not work');await cdp.evaluate(()=>document.querySelector('[data-arena-option="settings"]').click());await cdp.waitForFunction(()=>document.getElementById('settingsModal').classList.contains('active'));if(!await cdp.evaluate(()=>document.getElementById('arenaMenuPanel').hidden))throw Error('Menu did not close');await cdp.evaluate(()=>document.getElementById('settingsModalClose').click());await cdp.setViewport(390,844,true);await delay(350);await cdp.evaluate(()=>document.getElementById('arenaMenuToggle').click());await cdp.screenshot(path.join(ARTIFACT_DIR,'arena-menu-mobile.png'));await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});if(!await cdp.evaluate(()=>document.getElementById('arenaMenuPanel').hidden))throw Error('Escape did not dismiss menu');
await cdp.evaluate(()=>{window.app.handSort='dealt';window.app.renderPlayerHand(window.app.clientView.myHand,window.app.clientView.canPlayCards,'classic','light');window.actualSend=window.app.ws.send.bind(window.app.ws);window.app.ws.send=raw=>{if(JSON.parse(raw).type==='play_card')setTimeout(()=>window.actualSend(raw),100);else window.actualSend(raw)};const c=window.app.clientView.myHand.find(c=>c.id==='polish-3');window.app.handleCardClick(c,window.app.handCardElements.get(c.id))});await cdp.waitForFunction(()=>!!window.app.finishingLocalPlay,1500,10);if(!await cdp.evaluate(()=>document.querySelector('#discardPile .game-card').style.visibility==='hidden'))throw Error('Flying and landed card duplicate');await cdp.waitForFunction(()=>!window.app.finishingLocalPlay&&!document.querySelector('.local-play-ghost'));if(!await cdp.evaluate(()=>document.querySelector('#discardPile .game-card').style.visibility!=='hidden'))throw Error('Landed card not revealed');console.log('PASS distinct opaque card states, smooth hover lift, three-dot menu desktop/mobile, tools, settings, escape and seamless authoritative card handoff');}finally{cdp?.close();chrome.proc.kill();server.close();}}main().catch(e=>{console.error(e);process.exit(1)});