import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9596;
const ARTIFACT_DIR = path.resolve('scratch/social-features');

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


async function main(){
 process.env.NODE_ENV='test';process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'uno-social-'));fs.mkdirSync(ARTIFACT_DIR,{recursive:true});
 const {server}=await import('../server/src/index.js');await new Promise(r=>server.listen(0,r));const base='http://localhost:'+server.address().port;const chrome=await startHeadlessChrome();let peer,cdp;
 const check=async(fn,message)=>{if(!await cdp.evaluate(fn))throw Error(message);};
 try{
  ({cdp}=await createBrowserSession('Social'));await cdp.setViewport(1280,800);await cdp.navigate(base);await cdp.waitForFunction(()=>!!window.app);
  await cdp.evaluate(()=>window.app.createRoom('Social Host','classic',undefined,'fixed'));await cdp.waitForFunction(()=>window.app.gameState?.status==='lobby');const roomId=await cdp.evaluate(()=>window.app.roomId);
  peer=new WebSocket(base.replace('http','ws')+'/ws');const messages=[];peer.on('message',r=>messages.push(JSON.parse(r)));await new Promise(r=>peer.once('open',r));peer.send(JSON.stringify({type:'join',roomId,playerName:'Social Guest'}));await cdp.waitForFunction(()=>window.app.gameState.players.length===2);
  await cdp.evaluate(()=>document.getElementById('qrInviteBtn').click());await cdp.waitForFunction(()=>!!document.querySelector('.invite-qr svg'));await check(()=>document.getElementById('qrInviteLink').value.endsWith('?room='+window.app.roomId),'QR link incorrect');
  for(const [w,h,m] of [[1280,800,false],[390,844,true],[844,390,true]]){await cdp.setViewport(w,h,m);await delay(300);await check(()=>{const r=document.querySelector('.table-feature-card').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;},'Invite does not fit viewport');await cdp.screenshot(path.join(ARTIFACT_DIR,'invite-'+w+'.png'));}
  await cdp.evaluate(()=>history.back());await cdp.waitForFunction(()=>!document.getElementById('socialModal').classList.contains('active'));await check(()=>!!window.app.roomId,'Invite close left room');
  await cdp.evaluate(()=>window.app.openSettingsModal('rules'));await cdp.evaluate(()=>document.querySelector('[data-preset="quick"]').click());await cdp.waitForFunction(()=>window.app.gameState.houseRules.startingHandSize===5&&window.app.gameState.houseRules.turnDuration===15);
  await cdp.evaluate(()=>window.app.openSocialPanel('history'));await cdp.evaluate(()=>window.app.closeSocialPanel());await cdp.waitForFunction(()=>history.state.modal==='settings');await check(()=>window.app.el.settingsModal.classList.contains('active'),'Social Back did not restore settings');await cdp.evaluate(()=>window.app.closeSettingsModal());await cdp.waitForFunction(()=>!history.state.modal);
  await cdp.evaluate(()=>document.getElementById('manageRoomBtn').click());await cdp.evaluate(()=>document.getElementById('lockRoomButton').click());await cdp.waitForFunction(()=>window.app.gameState.isLocked);await cdp.evaluate(()=>document.getElementById('lockRoomButton').click());await cdp.waitForFunction(()=>!window.app.gameState.isLocked);
  const hostId=await cdp.evaluate(()=>window.app.playerId);await cdp.evaluate(()=>document.querySelector('[data-transfer]').click());await cdp.evaluate(()=>document.getElementById('confirmHostAction').click());await cdp.waitForFunction(()=>!window.app.gameState.players.find(p=>p.id===window.app.playerId).isHost);peer.send(JSON.stringify({type:'manage_lobby',data:{action:'transfer',targetPlayerId:hostId}}));await cdp.waitForFunction(()=>window.app.gameState.players.find(p=>p.id===window.app.playerId).isHost);
  await cdp.evaluate(()=>document.querySelector('[data-remove]').click());await check(()=>!!document.getElementById('confirmHostAction'),'Missing remove confirmation');await cdp.evaluate(()=>document.getElementById('confirmHostAction').click());await cdp.waitForFunction(()=>window.app.gameState.players.length===1);await delay(200);if(!messages.some(m=>m.type==='room_removed'))throw Error('Removed player not notified');
  await cdp.evaluate(async()=>{const {recordMatch,onPong}=await import('./social-features.js');localStorage.removeItem('uno_table_history_v1');const app={roomId:'TEST',playerId:'me',gameState:{status:'game_over',matchId:'one',mode:'classic',winnerId:'me',players:[{id:'me',name:'Host'},{id:'other',name:'Guest'}]}};recordMatch(app);recordMatch(app);app.gameState.matchId='two';app.gameState.winnerId='other';recordMatch(app);window.app.openSocialPanel('history');onPong(window.app,Date.now()-900);});
  await check(()=>{const d=JSON.parse(localStorage.getItem('uno_table_history_v1'));return d.games===2&&d.wins===1&&document.querySelector('.match-history-list').children.length===2&&document.getElementById('connectionQuality').dataset.quality==='weak';},'Stats deduplication or network feedback failed');
  await cdp.evaluate(()=>window.app.closeSocialPanel());await cdp.waitForFunction(()=>!history.state.modal);await cdp.evaluate(()=>window.app.send({type:'add_bot'}));await cdp.waitForFunction(()=>window.app.gameState.players.length===2);await cdp.evaluate(()=>window.app.send({type:'start_game'}));await cdp.waitForFunction(()=>window.app.gameState.status==='playing');await cdp.waitForFunction(()=>!!document.getElementById('firstGameGuide'));await cdp.evaluate(()=>document.getElementById('nextQuickGuide').click());await check(()=>document.getElementById('firstGameGuide').innerText.includes('The draw pile'),'Guide next failed');await cdp.evaluate(()=>document.getElementById('skipQuickGuide').click());await check(()=>!document.getElementById('firstGameGuide')&&localStorage.getItem('uno_quick_guide_seen')==='true','Guide skip failed');
  await cdp.evaluate(()=>{const app=window.app,send=app.send.bind(app);window.reactionCount=0;app.send=m=>{if(m.type==='send_reaction')window.reactionCount++;return send(m);};const b=document.querySelector('.reaction-item-btn');b.click();b.click();});await check(()=>window.reactionCount===1&&document.querySelector('.reaction-item-btn').disabled,'Reaction cooldown failed');await delay(1600);await check(()=>!document.querySelector('.reaction-item-btn').disabled,'Reaction cooldown never cleared');
  console.log('PASS QR invite, viewport fit, nested modal Back, rule preset, live host lock/remove, saved stats, guide and reaction cooldown');
 }finally{peer?.terminate();cdp?.close();chrome.proc.kill();server.close();}
}
main().catch(e=>{console.error(e);process.exit(1)});
