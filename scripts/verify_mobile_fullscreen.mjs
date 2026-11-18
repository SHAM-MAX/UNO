import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9591;
const ARTIFACT_DIR = path.resolve('scratch/mobile-fullscreen');

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

  const { server } = await import('../server/src/index.js');
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
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
    await cdp.navigate(baseUrl);
    console.log('Navigated to baseUrl, waiting for window.app...');
    await cdp.waitForFunction(() => window.app !== undefined && window.app.el !== undefined);
    console.log('window.app is loaded and ready.');
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'tabletop_brand_landing.png'));



    await cdp.setViewport(390,844,true);
    const rotation=await cdp.evaluate(async()=>{
      const root=document.documentElement,orientation=screen.orientation,log=[];
      const request=root.requestFullscreen,exit=document.exitFullscreen,lock=orientation.lock,unlock=orientation.unlock;
      try {
        root.requestFullscreen=async()=>{log.push('fullscreen');Object.defineProperty(document,'fullscreenElement',{configurable:true,value:root});};
        document.exitFullscreen=async()=>{log.push('exit');delete document.fullscreenElement;};
        orientation.lock=async(value)=>log.push(value);orientation.unlock=()=>log.push('unlock');
        await window.app.toggleFullscreen();await window.app.toggleFullscreen();
        return log.join(',');
      } finally {root.requestFullscreen=request;document.exitFullscreen=exit;orientation.lock=lock;orientation.unlock=unlock;delete document.fullscreenElement;window.app.syncFullscreenState();}
    });
    if(rotation!=='fullscreen,landscape,exit,unlock')throw Error('Fullscreen orientation ordering: '+rotation);
    const sizes=[[320,568],[390,844],[844,390],[932,430]];
    const audit=async(label)=>{
      for(const [w,h]of sizes){
        await cdp.setViewport(w,h,true);await delay(250);
        const state=await cdp.evaluate(()=>({width:innerWidth,height:innerHeight,wide:document.documentElement.scrollWidth>innerWidth+1,body:document.body.className,table:document.querySelector('.center-table')?.getBoundingClientRect().toJSON(),hand:document.getElementById('playerHandCards')?.getBoundingClientRect().toJSON()}));
        console.log(label,w,h,JSON.stringify(state));
        if(state.wide)throw Error(label+' horizontal overflow');
        if(label.startsWith('arena')&&(state.hand.bottom>h+1||state.hand.top<0||state.table.bottom>state.hand.top+1))throw Error(label+' table/hand collision');
        if(label.startsWith('arena')){
          const controls=await cdp.evaluate(()=>{
            const visible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;};
            return {header:['leaveBtn','fullscreenToggleBtn','settingsBtn'].every(id=>visible(document.getElementById(id))),singleFullscreen:!document.getElementById('arenaFullscreenBtn'),backs:[...document.querySelectorAll('.opponent-cards-fan')].some(visible),clock:!document.querySelector('.direction-indicator')};
          });
          if(Object.values(controls).some(v=>!v))throw Error('Missing gameplay controls: '+JSON.stringify(controls));
          const seating=await cdp.evaluate(()=>{
            const row=document.getElementById('opponentsRow'),fan=row.querySelector('.opponent-cards-fan');
            const upright=fan&&getComputedStyle(fan).transform==='none';
            const r=row.getBoundingClientRect(),p=row.firstElementChild.getBoundingClientRect();
            return upright&&(row.dataset.opponentCount!=='1'||Math.abs((r.left+r.right)/2-(p.left+p.right)/2)<2);
          });
          if(!seating)throw Error('Opponent fan is rotated or single opponent not centered');
        }
        if(label==='generic-lobby'){
          const aligned=await cdp.evaluate(()=>{
            const word=document.querySelector('#brandNavToggle .nav-uno-wordmark').getBoundingClientRect();
            return ['leaveBtn','fullscreenToggleBtn','settingsBtn'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.width>0&&r.height>0&&(r.right<=word.left||r.left>=word.right||r.bottom<=word.top||r.top>=word.bottom);});
          });
          if(!aligned)throw Error('Lobby brand overlaps controls');
        }
        // Headless mobile Chromium rejects native fullscreen. Exercise both native
        // event states with the same viewport metrics; device testing remains needed.
        await cdp.evaluate(()=>{Object.defineProperty(document,'fullscreenElement',{configurable:true,value:document.documentElement});document.dispatchEvent(new Event('fullscreenchange'));});
        if(!await cdp.evaluate(()=>document.body.classList.contains('is-fullscreen')))throw Error('Fullscreen state not synchronized');
        await cdp.evaluate(()=>{delete document.fullscreenElement;document.dispatchEvent(new Event('fullscreenchange'));});
        if(await cdp.evaluate(()=>document.body.classList.contains('is-fullscreen')))throw Error('Fullscreen exit state stuck');
        await cdp.screenshot(path.join(ARTIFACT_DIR,'mobile_audit_'+label+'_'+w+'x'+h+'.png'));
      }
    };
    await audit('landing');
    await cdp.evaluate(()=>window.app.createRoom('Lobby Host','classic',undefined,'selectable'));
    await cdp.waitForFunction(()=>window.app.clientView?.gameState.status==='lobby');
    await audit('generic-lobby');
    await cdp.evaluate(()=>window.app.confirmLeaveRoom());
    for(const mode of ['classic','flip','no_mercy']){
      await cdp.setViewport(390,844,true);
      await cdp.evaluate(new Function('window.app.openModeSetup('+JSON.stringify(mode)+')'));
      await audit('setup-'+mode);
      await cdp.evaluate(new Function('window.app.createRoom(\"Mobile Host\",'+JSON.stringify(mode)+',undefined,\"fixed\")'));
      await cdp.waitForFunction(()=>window.app.clientView?.gameState.status==='lobby');
      await audit('lobby-'+mode);
      for(let i=0;i<1;i++){await cdp.evaluate(()=>window.app.send({type:'add_bot'}));await delay(150);}
      await cdp.evaluate(()=>window.app.send({type:'start_game'}));
      await cdp.waitForFunction(()=>window.app.gameState.status==='playing');
      await audit('arena-'+mode);
      const uno=await cdp.evaluate(()=>{
        const app=window.app,saved=structuredClone(app.clientView),next=structuredClone(saved),me=next.gameState.players.find(p=>p.id===app.playerId);
        next.myHand=next.myHand.slice(0,2);next.canCallUno=true;me.hasCalledUno=false;app.clientView=next;app.gameState=next.gameState;app.renderArena();
        const button=document.getElementById('btnUnoAction'),r=button.getBoundingClientRect();const visible=r.width>0&&r.height>0&&r.bottom<=innerHeight&&r.top>=0;
        app.clientView={...next,myHand:[...next.myHand,{...next.myHand[0],id:'third-fixture'}],canCallUno:false};app.renderArena();
        const hidden=getComputedStyle(button).display==='none';
        app.clientView=saved;app.gameState=saved.gameState;app.renderArena();return {visible,hidden};
      });
      if(!uno.visible||!uno.hidden)throw Error('UNO count visibility failed '+mode+JSON.stringify(uno));
      if(mode==='classic'){
        for(const id of ['rulesModal','colorPickerModal','leaveConfirmModal']){
          await cdp.evaluate(new Function('document.getElementById('+JSON.stringify(id)+').classList.add(\"active\")'));
          await cdp.setViewport(844,390,true);await delay(150);
          const fits=await cdp.evaluate(new Function('const modal=document.getElementById('+JSON.stringify(id)+');const r=modal.querySelector(\".modal-card, .leave-confirm-card\").getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&r.left>=0&&r.right<=innerWidth+1;'));
          if(!fits)throw Error('Dialog clipped: '+id);
          await cdp.evaluate(new Function('document.getElementById('+JSON.stringify(id)+').classList.remove(\"active\")'));
        }
        await cdp.evaluate(()=>{const app=window.app;const hand=app.clientView.myHand;app.clientView.myHand=Array.from({length:25},(_,i)=>({...hand[i%hand.length],id:'fixture-'+i}));app.renderPlayerHand(app.clientView.myHand,[],app.gameState.mode,app.gameState.flipSide);});
        await audit('arena-large-hand');
        await cdp.evaluate(()=>{const app=window.app,base=app.clientView.gameState;app.clientView.gameState={...base,players:[base.players[0],...Array.from({length:5},(_,i)=>({...base.players[1],id:'fixture-player-'+i,name:'Player '+(i+2)}))]};app.renderArena();});
        await audit('arena-six-players');
      }
      await cdp.evaluate(()=>window.app.confirmLeaveRoom());
      if(await cdp.evaluate(()=>!!document.querySelector('.modal-overlay.active')))throw Error('Overlay leaked onto landing');
    }
    console.log('PASS all mode layouts, fullscreen state transitions, large hands, and dialogs');
    cdp.close();
  } finally {
    chromeProc.kill();
    server.close();

  }
}

main().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
