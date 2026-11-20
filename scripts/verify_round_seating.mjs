import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9596;
const ARTIFACT_DIR = path.resolve('scratch/round-seating');

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




async function main(){process.env.NODE_ENV='test';process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'uno-seating-'));fs.mkdirSync(ARTIFACT_DIR,{recursive:true});const {server,roomManager}=await import('../server/src/index.js');await new Promise(r=>server.listen(0,r));const base='http://localhost:'+server.address().port,chrome=await startHeadlessChrome();const sessions=[];
 try{for(const mode of ['classic','flip','no_mercy']){const {cdp}=await createBrowserSession(mode);sessions.push(cdp);await cdp.setViewport(844,390,true);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});await cdp.navigate(base);await cdp.waitForFunction(()=>!!window.app);await cdp.evaluate(mode=>{localStorage.setItem('uno_quick_guide_seen','true');window.app.createRoom('Seat Host',mode,undefined,'fixed');},mode);await cdp.waitForFunction(()=>window.app.gameState?.status==='lobby');const code=await cdp.evaluate(()=>window.app.roomId),room=roomManager.getRoom(code),max=mode==='classic'?10:6;for(let i=1;i<max;i++)roomManager.joinRoom(code,'Friend '+i);room.players.forEach(p=>p.isReady=true);await cdp.evaluate(()=>window.app.send({type:'start_game'}));await cdp.waitForFunction(()=>window.app.gameState.status==='playing');await cdp.evaluate(()=>window.seatBase=structuredClone(window.app.clientView));
 for(const [w,h] of [[844,390],[800,360],[568,320],[1600,720]]){await cdp.setViewport(w,h,true);for(const count of [...new Set([2,3,4,6,max])].filter(c=>c<=max)){await cdp.evaluate(count=>{const view=structuredClone(window.seatBase);view.gameState.players=view.gameState.players.slice(0,count);view.gameState.currentTurn=0;window.app.handleRoomState(view);},count);await delay(120);const report=await cdp.evaluate(()=>{const boxes=[...document.querySelectorAll('#opponentsRow .opponent-wrapper')].map(n=>{const r=n.getBoundingClientRect();return {id:n.dataset.playerId,x:r.x,y:r.y,w:r.width,h:r.height};});const felt=document.querySelector('.table-felt').getBoundingClientRect();return {active:document.body.classList.contains('round-table-layout'),w:innerWidth,h:innerHeight,boxes,felt:{x:felt.x,y:felt.y,w:felt.width,h:felt.height},scroll:document.documentElement.scrollHeight>innerHeight+1};});if(!await cdp.evaluate(()=>['fullscreenToggleBtn','settingsBtn','leaveBtn'].every(id=>{const b=document.getElementById(id),r=b.getBoundingClientRect();return r.width>0&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})))throw Error('Header controls hidden or blocked '+mode+w);if(Math.abs(report.felt.x+report.felt.w/2-report.w/2)>2)throw Error('Table is not centered across the full viewport '+mode+w);if(!report.active||report.scroll)throw Error('Layout inactive or scrolls '+mode+w+': '+JSON.stringify(report));for(const b of report.boxes){if(b.x<0||b.y<50||b.x+b.w>report.w+1||b.y+b.h>report.h)throw Error('Seat outside viewport '+mode+count+w+': '+JSON.stringify(report));for(const other of report.boxes){if(b===other)continue;if(b.x<other.x+other.w&&b.x+b.w>other.x&&b.y<other.y+other.h&&b.y+b.h>other.y)throw Error('Seats overlap '+mode+count+w+': '+JSON.stringify(report));}}
 if([2,4,max].includes(count))await cdp.screenshot(path.join(ARTIFACT_DIR,mode+'-'+count+'-'+w+'.png'));}
 }
 await cdp.setViewport(390,844,true);await delay(200);if(await cdp.evaluate(()=>document.body.classList.contains('round-table-layout')))throw Error('Landscape seating leaked into portrait');}
 console.log('PASS round seating: Classic 2–10, Flip/No Mercy 2–6, four landscape sizes including wide fullscreen, no seat overlap/scroll, portrait restoration');
 }finally{sessions.forEach(c=>c.close());chrome.proc.kill();server.close();}}
main().catch(e=>{console.error(e);process.exit(1)});
