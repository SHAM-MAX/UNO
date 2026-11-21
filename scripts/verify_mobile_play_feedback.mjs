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

async function main(){const mode=process.env.TEST_MODE||'classic';process.env.NODE_ENV='test';process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'uno-feedback-'));const {server,roomManager:rm}=await import('../server/src/index.js');await new Promise(r=>server.listen(0,r));const chrome=await startHeadlessChrome();let cdp;try{({cdp}=await createBrowserSession('Touch feedback'));await cdp.setViewport(844,390,true);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});await cdp.navigate('http://localhost:'+server.address().port);await cdp.waitForFunction(()=>!!window.app);await cdp.evaluate(mode=>{localStorage.setItem('uno_quick_guide_seen','true');window.app.createRoom('Mobile',mode,undefined,'fixed')},mode);await cdp.waitForFunction(()=>window.app.gameState?.status==='lobby');const code=await cdp.evaluate(()=>window.app.roomId),room=rm.getRoom(code);rm.joinRoom(code,'Friend');room.players.forEach(p=>p.isReady=true);await cdp.evaluate(()=>window.app.send({type:'start_game'}));await cdp.waitForFunction(()=>window.app.gameState?.status==='playing');let round=0;
async function fixture(){round++;room.currentTurn=0;room.pendingAction=null;room.pendingDrawPenalty=0;room.turnDrawnCard=null;room.activeColor='red';const number=(id,value)=>mode==='flip'?{id,light:{type:'number',color:'red',value},dark:{type:'number',color:'pink',value}}:{id,type:'number',color:'red',value};room.topDiscard=number('top-'+round,2);room.flipSide='light';room.playerHands[room.players[0].id]=Array.from({length:4},(_,i)=>number('touch-'+round+'-'+i,5));room.players[0].cardCount=4;await cdp.evaluate(prefix=>window.expectedHandPrefix=prefix,'touch-'+round+'-');rm.onStateChange(code);await cdp.waitForFunction(()=>window.app.clientView?.isMyTurn&&[...document.querySelectorAll('[data-card-id]')].some(n=>n.dataset.cardId.startsWith(window.expectedHandPrefix)));await delay(100);}
await fixture();await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.evaluate(()=>{window.realSend=window.app.ws.send.bind(window.app.ws);window.playRequests=0;window.app.ws.send=function(raw){const p=JSON.parse(raw);if(p.type==='play_card'){window.playRequests++;window.playSentAt=performance.now();setTimeout(()=>window.realSend(raw),1800)}else window.realSend(raw)}});
const point=await cdp.evaluate(()=>{const n=[...document.querySelectorAll('.card-wrapper.playable')].at(-1),r=n.getBoundingClientRect();return {x:r.x+r.width*.65,y:r.y+r.height*.35}});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.waitForFunction(()=>!!window.app.localPlayPreview,500);const id=await cdp.evaluate(()=>window.lastFeedbackCardId=window.app.localPlayPreview.id);if(room.topDiscard.id===id)throw Error('Server already updated before simulated delay');await cdp.waitForFunction(()=>!!window.app.localPlayPreview?.firstFrameAt,1000);const feedback=await cdp.evaluate(()=>({elapsed:window.app.localPlayPreview.firstFrameAt-window.app.localPlayPreview.createdAt,ghost:!!document.querySelector('.local-play-ghost'),selected:window.app.selectedCardId,locked:window.app.isPlayInFlight}));if(!feedback.ghost||feedback.elapsed>150||feedback.selected||!feedback.locked)throw Error(JSON.stringify(feedback));rm.onStateChange(code);await delay(100);if(!await cdp.evaluate(()=>!!window.app.localPlayPreview&&window.app.isPlayInFlight))throw Error('Unrelated state cleared pending play');await cdp.evaluate(()=>{const a=window.app,c=a.clientView.myHand[0];a.handleCardClick(c,a.handCardElements.get(c.id))});if(await cdp.evaluate(()=>window.playRequests)!==1)throw Error('Duplicate tap sent another move');await delay(600);if(!await cdp.evaluate(()=>!!document.querySelector('.local-play-notice')))throw Error('Slow connection feedback missing');await cdp.waitForFunction(()=>!window.app.localPlayPreview&&window.app.gameState.topDiscard.id===window.lastFeedbackCardId,3500).catch(async()=>{if(room.topDiscard.id!==id)throw Error('Delayed play not accepted');await cdp.waitForFunction(()=>!window.app.localPlayPreview)});await delay(300);if(await cdp.evaluate(()=>!!document.querySelector('.local-play-ghost')))throw Error('Accepted ghost leaked');console.log('PASS single real touch, immediate feedback '+Math.round(feedback.elapsed)+'ms, 1800ms delayed send, duplicate suppression, unrelated update preservation and acknowledgement cleanup');
await fixture();await cdp.evaluate(()=>{window.app.ws.send=window.realSend});room.currentTurn=1;await cdp.evaluate(()=>{const a=window.app,c=a.clientView.myHand.at(-1);a.handleCardClick(c,a.handCardElements.get(c.id))});await cdp.waitForFunction(()=>!window.app.localPlayPreview&&!window.app.isPlayInFlight);await cdp.waitForFunction(()=>![...document.querySelectorAll('.card-wrapper')].some(n=>n.style.visibility==='hidden')&&!document.querySelector('.local-play-ghost'));if(!await cdp.evaluate(()=>![...document.querySelectorAll('.card-wrapper')].some(n=>n.style.visibility==='hidden')&&!document.querySelector('.local-play-ghost')))throw Error('Rejected preview did not restore cards '+JSON.stringify(await cdp.evaluate(()=>({nodes:[...document.querySelectorAll('.card-wrapper')].map(n=>[n.dataset.cardId,n.style.visibility]),ghosts:document.querySelectorAll('.local-play-ghost').length,preview:!!window.app.localPlayPreview}))));console.log('PASS rejected move returns card without changing authoritative hand');
await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await fixture();
const drag=await cdp.evaluate(()=>{const node=[...document.querySelectorAll('.card-wrapper.playable')].at(-1),r=node.getBoundingClientRect(),b=document.querySelector('.table-felt').getBoundingClientRect();return {id:node.dataset.cardId,x:r.x+r.width*.6,y:r.y+r.height*.35,endY:b.y+b.height*.6}});
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:drag.x,y:drag.y}]});
for(let step=1;step<=8;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:drag.x,y:drag.y+(drag.endY-drag.y)*step/8}]});await delay(15);}
if(!await cdp.evaluate(()=>!!document.querySelector('.play-drag-ghost')))throw Error('Touch drag did not start');await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(500);if(room.topDiscard.id!==drag.id)throw Error('Touch drag did not play');console.log('PASS vertical mobile drag remains playable');
}finally{cdp?.close();chrome.proc.kill();server.close();}}main().catch(e=>{console.error(e);process.exit(1)});