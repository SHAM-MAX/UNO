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

async function main(){process.env.NODE_ENV='test';process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'uno-hud-'));fs.mkdirSync(ARTIFACT_DIR,{recursive:true});const {server,roomManager:rm}=await import('../server/src/index.js');await new Promise(r=>server.listen(0,r));const chrome=await startHeadlessChrome();let cdp;try{({cdp}=await createBrowserSession('HUD'));await cdp.setViewport(1366,768);await cdp.navigate('http://localhost:'+server.address().port);await cdp.waitForFunction(()=>!!window.app);await cdp.evaluate(()=>{localStorage.setItem('uno_quick_guide_seen','true');window.app.createRoom('Sham Sundar','classic',undefined,'fixed')});await cdp.waitForFunction(()=>window.app.gameState?.status==='lobby');const code=await cdp.evaluate(()=>window.app.roomId),room=rm.getRoom(code),host=room.players[0].id;rm.joinRoom(code,'Friend');room.players.forEach(p=>p.isReady=true);await cdp.evaluate(()=>window.app.send({type:'start_game'}));await cdp.waitForFunction(()=>window.app.gameState?.status==='playing');room.currentTurn=0;room.pendingAction=null;room.pendingDrawPenalty=0;room.topDiscard={id:'hud-top',type:'number',color:'red',value:5};room.activeColor='red';room.playerHands[host]=[{id:'hud-a',type:'number',color:'red',value:3},{id:'hud-b',type:'number',color:'blue',value:8}];room.players[0].cardCount=2;room.players[0].hasCalledUno=false;room.players[0].isUnoArmed=false;room.playerHands[room.players[1].id]=[{id:'other-last',type:'number',color:'green',value:4}];room.players[1].cardCount=1;room.players[1].hasCalledUno=false;room.turnDrawnCard=true;room.turnDrawnCardId='hud-a';rm.resetTurnTimer(room);rm.onStateChange(code);await cdp.waitForFunction(()=>document.querySelector('.local-turn-clock')&&window.app.clientView.canPass&&window.app.clientView.canCallUno);await delay(400);
for(const [w,h]of [[1366,768],[844,390],[390,844]]){await cdp.setViewport(w,h,w<1000);await delay(400);const report=await cdp.evaluate(()=>{const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};const profile=document.getElementById('localPlayerProfile'),clock=profile.querySelector('.local-turn-clock'),chat=document.getElementById('reactionToggleBtn'),buttons=['btnPassAction','btnUnoAction','btnCatchAction'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {id,...rect(e),font:s.fontFamily,weight:s.fontWeight,visible:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}});const pr=profile.getBoundingClientRect();return {profile:rect(profile),clock:clock.textContent,profileVisible:profile.contains(document.elementFromPoint(pr.x+pr.width/2,pr.y+pr.height/2)),chat:rect(chat),buttons,w:innerWidth,h:innerHeight}});if(!report.profileVisible||!/^\d+s$/.test(report.clock)||Math.abs(report.chat.x+report.chat.w-(w-14))>3||Math.abs(report.chat.y+report.chat.h-(h-14))>3)throw Error('HUD visibility '+JSON.stringify(report));if(report.buttons.some(b=>!b.visible||b.h<39||!b.font.includes('Outfit')||b.weight!=='500'))throw Error('Unreadable/blocked actions '+JSON.stringify(report));for(const a of report.buttons)for(const b of report.buttons)if(a!==b&&a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y)throw Error('Actions overlap');await cdp.screenshot(path.join(ARTIFACT_DIR,'readable-hud-'+w+'.png'));}

await cdp.evaluate(()=>{const gift=document.querySelector('.opponent-gift');if(!gift)throw Error('No gift control');gift.click();if(!window.app.giftTargetPlayerId||!window.app.el.reactionTray.dataset.targetName)throw Error('Target picker missing');window.app.el.reactionTray.querySelector('[data-emote="fire"]').click();});
await cdp.waitForFunction(()=>!!document.querySelector('.gift-flight'));
await delay(850);
if(await cdp.evaluate(()=>!!document.querySelector('.gift-received')))throw Error('Sender got large targeted reaction');
await cdp.evaluate(()=>{const a=window.app,other=a.gameState.players.find(p=>p.id!==a.playerId);a.handlePlayerReaction({playerId:other.id,targetPlayerId:a.playerId,emoteId:'laugh'});});
await cdp.waitForFunction(()=>!!document.querySelector('.gift-received'));
await cdp.screenshot(path.join(ARTIFACT_DIR,'targeted-gift-received.png'));
await delay(1600);
await cdp.evaluate(()=>{const a=window.app,other=a.gameState.players.find(p=>p.id!==a.playerId);a.handlePlayerReaction({playerId:other.id,targetPlayerId:null,emoteId:'fire'});});await delay(850);
if(await cdp.evaluate(()=>!!document.querySelector('.gift-received')))throw Error('Broadcast unexpectedly large');
await cdp.evaluate(()=>{const a=window.app,other=a.gameState.players.find(p=>p.id!==a.playerId);a.gameState.pendingAction={type:'color_roulette',sourcePlayerId:a.playerId,targetPlayerId:other.id};a.openRouletteModal(false);if(document.getElementById('rouletteMatchup').textContent!==a.gameState.players.find(p=>p.id===a.playerId).name+' → '+other.name)throw Error('Roulette actors missing');if(!document.querySelector('#rouletteModal .color-picker-badge svg'))throw Error('Roulette logo still boxed');});
await delay(600);await cdp.screenshot(path.join(ARTIFACT_DIR,'roulette-matchup.png'));
await cdp.evaluate(()=>{const a=window.app;a.closeRouletteModal();a.gameState.pendingAction=null;a.showRouletteDrawNotice({id:'receipt-test',targetPlayerId:a.playerId,color:'red',revealed:[{id:1},{id:2}]});if(!document.getElementById('rouletteDrawNotice').textContent.includes('Drew 2 cards'))throw Error('Receipt details');});await delay(400);await cdp.screenshot(path.join(ARTIFACT_DIR,'themed-roulette-receipt.png'));await delay(1700);if(await cdp.evaluate(()=>!!document.getElementById('rouletteDrawNotice')))throw Error('Receipt did not expire');
await cdp.evaluate(()=>document.getElementById('reactionToggleBtn').click());if(!await cdp.evaluate(()=>document.getElementById('reactionTray').style.display!=='none'))throw Error('Messages tray did not open');await cdp.evaluate(()=>document.getElementById('reactionToggleBtn').click());await cdp.evaluate(()=>window.app.el.btnUnoAction.click());await cdp.waitForFunction(()=>window.app.gameState.players.find(p=>p.id===window.app.playerId).hasCalledUno);if(!await cdp.evaluate(()=>document.querySelector('#btnUnoAction .uno-confirmation')?.textContent==='UNO CALLED ✓'&&!document.querySelector('.toast')?.textContent?.includes('UNO')))throw Error('UNO did not confirm inside button');await cdp.evaluate(()=>window.app.el.btnCatchAction.click());await cdp.waitForFunction(()=>!window.app.clientView.canCatchUno);await cdp.evaluate(()=>{window.handoffSeen=false;new MutationObserver(changes=>{for(const change of changes)for(const node of change.addedNodes)if(node.classList?.contains('turn-handoff'))window.handoffSeen={turn:window.app.gameState.currentTurn};}).observe(document.body,{childList:true});window.passTurnBefore=window.app.gameState.currentTurn;window.app.el.btnPassAction.click();});await cdp.waitForFunction(()=>!window.app.clientView.isMyTurn);if(!await cdp.evaluate(()=>window.handoffSeen&&window.handoffSeen.turn!==window.passTurnBefore))throw Error('Pass handoff did not follow authoritative turn');if(!await cdp.evaluate(()=>document.getElementById('tableTurnStatus').getBoundingClientRect().width===1&&!document.querySelector('.play-direction-label')))throw Error('Visual turn/direction text still shown');console.log('PASS visible profile/countdown, readable non-overlapping actions, bottom-right messages and working UNO/catch/pass on desktop/mobile');}finally{cdp?.close();chrome.proc.kill();server.close();}}main().catch(e=>{console.error(e);process.exit(1)});