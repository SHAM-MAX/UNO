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

async function main(){process.env.NODE_ENV='test';process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'uno-decision-'));fs.mkdirSync(ARTIFACT_DIR,{recursive:true});const {server,roomManager:rm}=await import('../server/src/index.js');await new Promise(r=>server.listen(0,r));const chrome=await startHeadlessChrome();let cdp;try{({cdp}=await createBrowserSession('Challenge'));await cdp.setViewport(1366,768);await cdp.navigate('http://localhost:'+server.address().port);await cdp.waitForFunction(()=>!!window.app);await cdp.evaluate(()=>{localStorage.setItem('uno_quick_guide_seen','true');window.app.createRoom('Host','classic',undefined,'fixed')});await cdp.waitForFunction(()=>window.app.gameState?.status==='lobby');const code=await cdp.evaluate(()=>window.app.roomId),room=rm.getRoom(code),guest=rm.joinRoom(code,'Guest');room.players.forEach(p=>p.isReady=true);await cdp.evaluate(()=>window.app.send({type:'start_game'}));await cdp.waitForFunction(()=>window.app.gameState?.status==='playing');const hostId=room.players[0].id,guestId=guest.playerId;const number=(id)=>({id,type:'number',color:'red',value:5});
function challenge(offender){room.currentTurn=room.players.findIndex(p=>p.id===offender);room.pendingAction=null;room.pendingDrawPenalty=0;room.turnDrawnCard=null;room.activeColor='red';room.topDiscard=number('top');room.playerHands[offender]=[{id:'wild-'+Date.now(),type:'wild_draw4',color:'wild'},number('kept')];const res=rm.playCard(code,offender,{cardId:room.playerHands[offender][0].id,chosenColor:'blue'});if(!res.success)throw Error(res.error);rm.onStateChange(code);}
challenge(hostId);await cdp.waitForFunction(()=>document.getElementById('drawFourHeading')?.textContent==='Challenge in progress');if(!await cdp.evaluate(()=>document.querySelector('.draw-four-actions').hidden&&document.querySelector('.hand-cards').inert))throw Error('Waiting view not locked');await cdp.screenshot(path.join(ARTIFACT_DIR,'challenge-waiting.png'));rm.resolveDrawFour(code,guestId,false);rm.onStateChange(code);await cdp.waitForFunction(()=>document.getElementById('drawFourDecision').hidden);
for(const decision of [0,1]){challenge(guestId);await cdp.waitForFunction(()=>document.getElementById('drawFourHeading')?.textContent==='Accept or challenge?'&&!document.getElementById('drawFourDecision').hidden);await cdp.screenshot(path.join(ARTIFACT_DIR,'challenge-decision.png'));await cdp.evaluate(i=>document.querySelectorAll('.draw-four-actions button')[i].click(),decision);await cdp.waitForFunction(()=>document.getElementById('drawFourDecision').hidden);if(room.pendingAction)throw Error('Decision not resolved');}
for(const [w,h]of [[1366,768],[844,390],[390,844]]){await cdp.setViewport(w,h,w<1000);await delay(350);await cdp.evaluate(()=>{const a=window.app;const hand=Array.from({length:6},(_,i)=>({...a.clientView.myHand[0],id:'center-'+i}));a.renderPlayerHand(hand,[],'classic','light')});await delay(220);const r=await cdp.evaluate(()=>{const nodes=[...document.querySelectorAll('.hand-cards .card-wrapper')];const left=nodes[0].getBoundingClientRect().left,right=nodes.at(-1).getBoundingClientRect().right;return {center:(left+right)/2,w:innerWidth,boxes:['.card-rack-container','.hand-scroll-container','.hand-cards','.hand-row'].map(q=>{const e=document.querySelector(q),r=e.getBoundingClientRect(),s=getComputedStyle(e);return [q,r.x,r.width,s.minWidth,s.width,s.justifyContent,s.marginLeft,s.marginRight,s.transform,s.overflowX,e.scrollWidth,e.clientWidth,e.scrollLeft]})}});if(Math.abs(r.center-r.w/2)>12)throw Error('Off center '+JSON.stringify(r));await cdp.screenshot(path.join(ARTIFACT_DIR,'centered-hand-'+w+'.png'));}console.log('PASS waiting lock, accept, challenge, unlock, centered hands at desktop and mobile sizes');}finally{cdp?.close();chrome.proc.kill();server.close();}}main().catch(e=>{console.error(e);process.exit(1)});