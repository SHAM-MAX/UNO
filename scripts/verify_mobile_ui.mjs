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

  async waitForFunction(fnStr, timeout = 30000) {
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
      '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
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



import assert from 'node:assert/strict';
const sizes=[[360,640],[360,800],[390,844],[412,915],[430,932],[768,1024],[1366,768],[1920,1080],[844,390]];
async function runMobileChecks(){
 const {proc}=await startHeadlessChrome();const {cdp:a}=await createBrowserSession('mobile');const {cdp:b}=await createBrowserSession('guest');
 fs.mkdirSync('scratch/mobile-final',{recursive:true});
 const view=async(w,h)=>{await a.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:w<1000});await a.send('Emulation.setTouchEmulationEnabled',{enabled:w<1000});};
 const load=async()=>{await a.send('Page.bringToFront');await resetBrowserPage(a,'http://localhost:3001/');await a.send('Page.bringToFront');};
 const tap=async(selector)=>{await a.evaluate('document.querySelector('+JSON.stringify(selector)+').scrollIntoView({block:"center"})');const r=await a.evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');await a.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[r]});await a.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
 const screenshot=async(name,w,h)=>{await a.send('Page.bringToFront');await view(w,h);await a.evaluate('document.fonts.ready');await a.waitForFunction('()=>[...document.images].filter(i=>i.getClientRects().length).every(i=>i.complete)');const result=await a.evaluate('({width:innerWidth,height:innerHeight,docHeight:document.documentElement.scrollHeight,overflow:document.documentElement.scrollWidth>innerWidth,broken:[...document.images].filter(i=>i.getClientRects().length&&i.complete&&!i.naturalWidth).map(i=>i.src)})');assert.equal(result.overflow,false,name+' overflow');assert.deepEqual(result.broken,[],name+' broken images');const png=await a.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:w,height:result.docHeight,scale:1}});fs.writeFileSync('scratch/mobile-final/'+name+'-'+w+'x'+h+'.png',Buffer.from(png.data,'base64'));console.log(name,w,h,JSON.stringify(result));};
 const matrix=async(name)=>{for(const [w,h]of sizes)await screenshot(name,w,h);};
 try{
 await load();await matrix('landing');
 // Original desktop and preserved-mobile pixels are checked by verify_responsive_landing.mjs.
 await view(390,844);const previous=await a.evaluate('document.querySelector("#mobileNavSoundBtn").getAttribute("aria-pressed")');await tap('#mobileNavSoundBtn');assert.notEqual(await a.evaluate('document.querySelector("#mobileNavSoundBtn").getAttribute("aria-pressed")'),previous);
 await tap('#mobileNavRulesBtn');await a.waitForFunction('()=>document.querySelector("#rulesModal").contains(document.activeElement)');await a.evaluate('document.querySelector("#rulesModal .rule-tab-btn:last-child").focus()');await a.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab'});assert.ok(await a.evaluate('document.querySelector("#rulesModal").contains(document.activeElement)'));await a.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await a.waitForFunction('()=>!document.querySelector("#rulesModal").classList.contains("active")');assert.equal(await a.evaluate('document.activeElement.id'),'mobileNavRulesBtn');
 await view(390,360);await a.evaluate('document.querySelector("#mobilePlayerNameInput").focus();document.activeElement.scrollIntoView({block:"center"})');const keyboard=await a.evaluate('(()=>{const r=document.activeElement.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()');assert.ok(keyboard);await screenshot('keyboard-height',390,360);
 for(const mode of ['classic','flip','no_mercy']){
 await load();await view(390,844);await tap('.mobile-modes-wrap [data-home-mode="'+mode+'"]');assert.equal(await a.evaluate('window.app.preferredMode'),mode);await matrix('setup-'+mode);
 await load();await view(390,844);await a.evaluate('window.app.preferredMode='+JSON.stringify(mode)+';document.querySelector("#mobilePlayerNameInput").value="MobileHost"');await tap('#mobileCreateRoomBtn');await a.waitForFunction('()=>!!window.app.roomId');const code=await a.evaluate('window.app.roomId');
 await resetBrowserPage(b,'http://127.0.0.1:3001/');await b.evaluate('document.querySelector("#mobilePlayerNameInput").value="MobileGuest";document.querySelector("#mobileRoomCodeInput").value='+JSON.stringify(code)+';document.querySelector("#mobileJoinRoomBtn").click()');await a.waitForFunction('()=>document.querySelectorAll("#lobbyPlayersList .lobby-player-row").length===2');await matrix('lobby-'+mode);
 await b.evaluate('document.querySelector("#readyBtn").click()');await a.waitForFunction('()=>!document.querySelector("#startGameBtn").disabled');await a.evaluate('document.querySelector("#startGameBtn").click()');await a.waitForFunction('()=>document.body.classList.contains("in-arena")');await matrix('gameplay-'+mode);
 if(mode==='classic'){
 await a.evaluate('window.app.showGameOver({...window.app.gameState,winnerId:window.app.playerId,winReason:"All cards played!"})');await screenshot('game-over',390,844);await a.evaluate('document.querySelector("#gameOverModal").classList.remove("active")');
 for(const id of ['rulesModal','colorPickerModal','swapPickerModal','leaveConfirmModal']){if(id==='colorPickerModal')await a.evaluate('window.app.openColorPicker()');else if(id==='swapPickerModal')await a.evaluate('window.app.openSwapPicker()');else await a.evaluate('document.querySelector("#'+id+'").classList.add("active")');await screenshot(id,390,844);await screenshot(id,844,390);await a.evaluate('document.querySelector("#'+id+'").classList.remove("active")');}
 // A large hand is a renderer fixture; it does not mutate room/game rules.
 await view(360,640);await a.evaluate('(()=>{const h=window.app.clientView.myHand;const cards=Array.from({length:25},(_,i)=>({...h[i%h.length],id:"preview-"+i}));window.app.clientView={...window.app.clientView,myHand:cards};window.app.renderPlayerHand(cards,[],window.app.gameState.mode,window.app.gameState.flipSide)})()');await screenshot('large-hand',360,640);await a.evaluate('(()=>{const base=window.app.clientView.gameState;const players=[base.players[0],...Array.from({length:5},(_,i)=>({...base.players[1],id:"fixture-player-"+i,name:"Player "+(i+2)}))];window.app.clientView={...window.app.clientView,gameState:{...base,players}};window.app.renderArena()})()');await screenshot('six-players',360,640);
 }
 }
 console.log('PASS mobile touch, sound, dialogs, keyboard-height, rooms, all modes, and desktop regression');
 }finally{a.close();b.close();proc.kill();}
}
runMobileChecks().catch(e=>{console.error(e);process.exitCode=1});
