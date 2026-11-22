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

async function main(){process.env.NODE_ENV='test';process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'uno-performance-'));fs.mkdirSync(ARTIFACT_DIR,{recursive:true});const {server,roomManager:rm}=await import('../server/src/index.js');await new Promise(r=>server.listen(0,r));const chrome=await startHeadlessChrome();let cdp;try{({cdp}=await createBrowserSession('Performance'));await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(navigator,"hardwareConcurrency",{get:()=>2});Object.defineProperty(navigator,"deviceMemory",{get:()=>2});'});await cdp.setViewport(844,390,true);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});const requested=[];cdp.ws.on('message',raw=>{const event=JSON.parse(raw.toString());if(event.method==='Network.requestWillBeSent')requested.push(event.params.request.url)});await cdp.send('Network.enable');await cdp.navigate('http://localhost:'+server.address().port);await cdp.waitForFunction(()=>!!window.app);if(!await cdp.evaluate(()=>document.body.classList.contains('performance-lite')))throw Error('Constrained phone did not select lite effects');if(requested.some(url=>/no-mercy-card-canvas|uno-flip-create-reference/.test(url)))throw Error('Unselected mode entrance downloaded');
await cdp.evaluate(()=>{localStorage.setItem('uno_quick_guide_seen','true');window.app.createRoom('Phone','classic',undefined,'fixed')});await cdp.waitForFunction(()=>window.app.gameState?.status==='lobby');const code=await cdp.evaluate(()=>window.app.roomId),room=rm.getRoom(code);rm.joinRoom(code,'Friend');room.players.forEach(p=>p.isReady=true);await cdp.evaluate(()=>window.app.send({type:'start_game'}));await cdp.waitForFunction(()=>window.app.gameState?.status==='playing');room.currentTurn=0;room.pendingAction=null;room.topDiscard={id:'performance-top',type:'number',color:'red',value:5};room.activeColor='red';room.playerHands[room.players[0].id]=Array.from({length:30},(_,i)=>({id:'perf-'+i,type:'number',color:'red',value:i%10}));room.players[0].cardCount=30;rm.onStateChange(code);await cdp.waitForFunction(()=>document.querySelectorAll('.hand-cards .card-wrapper').length===30);await delay(300);
const result=await cdp.evaluate(()=>{const a=window.app,view=structuredClone(a.clientView),first=a.handCardElements.get(view.myHand[0].id),before=a.performanceMetrics.snapshot();let began=performance.now();for(let i=0;i<30;i++)a.handleRoomState(structuredClone(view));const stateMs=performance.now()-began,after=a.performanceMetrics.snapshot();if(a.handCardElements.get(view.myHand[0].id)!==first)throw Error('Retained card replaced');if((after.counters.handSkips-before.counters.handSkips)+(after.counters.stateSkips-before.counters.stateSkips)<30)throw Error('Unchanged hands were rerendered');const render=()=>a.renderPlayerHand(view.myHand,view.canPlayCards,view.gameState.mode,view.gameState.flipSide);began=performance.now();for(let i=0;i<30;i++){a.lastHandRenderKey=null;render();}const forcedMs=performance.now()-began;began=performance.now();for(let i=0;i<30;i++)render();const cachedMs=performance.now()-began;if(cachedMs>=forcedMs)throw Error('Hand cache did not reduce work');return {stateUpdates:30,stateMs,forcedHandMs:forcedMs,cachedHandMs:cachedMs,metrics:after};});
await cdp.setViewport(390,844,true);await delay(350);const swipe=await cdp.evaluate(()=>{const e=document.querySelector('.hand-scroll-container'),r=e.getBoundingClientRect();return {x:r.x+r.width*.65,y:Math.min(innerHeight-18,r.y+r.height*.65),before:e.scrollLeft};});
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:swipe.x,y:swipe.y}]});for(let step=1;step<=8;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:swipe.x-step*12,y:swipe.y+2}]});await delay(20);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(300);const swipeResult=await cdp.evaluate(()=>({left:document.querySelector('.hand-scroll-container').scrollLeft,preview:!!window.app.localPlayPreview,drag:!!document.querySelector('.play-drag-ghost')}));if(Math.abs(swipeResult.left-swipe.before)<15||swipeResult.preview||swipeResult.drag||room.topDiscard.id!=='performance-top')throw Error('Horizontal swipe played a card or did not scroll '+JSON.stringify({swipe,swipeResult}));
await cdp.evaluate(()=>{window.perfHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.perfHidden});document.dispatchEvent(new Event('visibilitychange'));window.backgroundBase=structuredClone(window.app.clientView);for(let i=1;i<=5;i++){const v=structuredClone(window.backgroundBase);v.gameState.topDiscard={id:'background-'+i,type:'number',color:'blue',value:i};window.app.handleRoomState(v);}if(window.app.clientView.gameState.topDiscard.id.startsWith('background'))throw Error('Hidden table rendered');window.perfHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await delay(250);if(!await cdp.evaluate(()=>window.app.gameState.topDiscard.id==='background-5'&&!document.querySelector('.classic-motion-ghost')))throw Error('Background resume replayed stale moves');
await cdp.evaluate(()=>{window.perfOldSocket=window.app.ws;window.app.ws.close();});await cdp.waitForFunction(()=>window.app.connectionRecovering);room.topDiscard={id:'recovered-latest',type:'number',color:'green',value:8};rm.onStateChange(code);await cdp.waitForFunction(()=>window.app.ws!==window.perfOldSocket&&window.app.ws.readyState===1&&!window.app.connectionRecovering&&window.app.gameState.topDiscard.id==='recovered-latest');if(await cdp.evaluate(()=>!!document.querySelector('.classic-motion-ghost')))throw Error('Reconnect replayed old moves');
await cdp.evaluate(()=>{const a=window.app;for(let i=0;i<200;i++)a.performanceMetrics.record('paint',i);if(a.performanceMetrics.snapshot().paint.count!==120)throw Error('Metrics are unbounded')});
await cdp.evaluate(async()=>{await navigator.serviceWorker.ready;});await cdp.waitForFunction(()=>!!navigator.serviceWorker.controller);const atlasUrl=await cdp.evaluate(async()=>{const {cardAtlases}=await import('./card-atlas-manifest.js');const url=cardAtlases.classic.url;await fetch(url);return new URL(url,location.href).href;});await delay(400);await cdp.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});const cached=await cdp.evaluate(async url=>{try{const r=await fetch(url);return r.ok&&(await r.blob()).size>0;}catch{return false}},atlasUrl);await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});if(!cached)throw Error('Warm card artwork unavailable offline');fs.writeFileSync(path.resolve('scratch/mobile-performance-report.json'),JSON.stringify({conditions:'844x390, 2GB / 2-core hints, 4x CPU slowdown, 30 cards',...result,checks:['unchanged card DOM preserved','selected-mode entrance loading','background latest-state only','reconnect without replay','bounded diagnostics','horizontal touch scroll without accidental play','offline warm artwork cache']},null,2));console.log('PASS performance, recovery, cache and 30-card checks',JSON.stringify(result));}finally{cdp?.close();chrome.proc.kill();server.close();}}main().catch(e=>{console.error(e);process.exit(1)});