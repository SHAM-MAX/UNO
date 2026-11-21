import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9596;
const ARTIFACT_DIR = path.resolve('scratch/roulette-lock');

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




async function main(){process.env.NODE_ENV='test';process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'uno-roulette-lock-'));fs.mkdirSync(ARTIFACT_DIR,{recursive:true});const {server,roomManager}=await import('../server/src/index.js');await new Promise(r=>server.listen(0,r));const base='http://localhost:'+server.address().port,chrome=await startHeadlessChrome(),clients=[];try{
 for(const name of ['Sam','Alex','Jamie']){const {cdp}=await createBrowserSession(name);clients.push(cdp);await cdp.setViewport(844,390,true);await cdp.navigate(base);await cdp.waitForFunction(()=>!!window.app);await cdp.evaluate(async()=>{localStorage.setItem('uno_quick_guide_seen','true');const {prepareCardArt}=await import('./card-atlas.js');await prepareCardArt('no_mercy');});}
 const [host,target,next]=clients;await host.evaluate(()=>window.app.createRoom('Sam','no_mercy',undefined,'fixed'));await host.waitForFunction(()=>window.app.gameState?.status==='lobby');const code=await host.evaluate(()=>window.app.roomId);await target.evaluate(code=>window.app.connectWebSocket(code,null,null,'Alex'),code);await target.waitForFunction(()=>window.app.gameState?.players.length===2);await next.evaluate(code=>window.app.connectWebSocket(code,null,null,'Jamie'),code);await next.waitForFunction(()=>window.app.gameState?.players.length===3);const room=roomManager.getRoom(code);room.players.forEach(p=>p.isReady=true);await host.evaluate(()=>window.app.send({type:'start_game'}));await host.waitForFunction(()=>window.app.gameState.status==='playing');
 const card=(id,color='red',value=5)=>({id,color,type:'number',value});room.currentTurn=0;room.pendingAction=null;room.pendingDrawPenalty=0;room.activeColor='red';room.topDiscard=card('top');room.playerHands[room.players[0].id]=[{id:'roulette-live',color:'wild',type:'wild_color_roulette'},card('sam-r'),card('sam-b','blue')];for(const p of room.players.slice(1))room.playerHands[p.id]=[card(p.id+'r'),card(p.id+'b','blue'),card(p.id+'y','yellow')];room.players.forEach(p=>p.cardCount=room.playerHands[p.id].length);room.drawPile=[card('roulette-stop','yellow')];roomManager.resetTurnTimer(room);for(const p of room.players)p.socket.send(JSON.stringify({type:'room:state',data:roomManager.getClientView(code,p.id)}));await host.waitForFunction(()=>window.app.clientView.myHand.some(c=>c.id==='roulette-live'));
 await host.evaluate(()=>window.app.send({type:'play_card',data:{cardId:'roulette-live'}}));for(const c of clients)await c.waitForFunction(()=>window.app.gameState.rouletteInProgress&&window.app.el.playerHandCards.inert);
 if(!await host.evaluate(()=>document.getElementById('rouletteTitle').textContent==='Roulette in progress'))throw Error('Other players do not see progress');if(!await target.evaluate(()=>window.app.isRouletteInteractive))throw Error('Victim cannot choose');await host.screenshot(path.join(ARTIFACT_DIR,'other-player-progress.png'));
 await target.evaluate(()=>window.app.send({type:'choose_color',data:{chosenColor:'yellow'}}));await next.waitForFunction(()=>!!window.app.gameState.rouletteResumeAt);const snapshot=JSON.stringify({hands:room.playerHands,top:room.topDiscard,turn:room.currentTurn});await next.evaluate(()=>{window.app.send({type:'play_card',data:{cardId:window.app.clientView.myHand[0].id}});window.app.send({type:'draw_card'});});await delay(500);if(JSON.stringify({hands:room.playerHands,top:room.topDiscard,turn:room.currentTurn})!==snapshot)throw Error('A next-player move executed while roulette was showing');if(room.turnDeadline!==null)throw Error('Turn timer ran during roulette');
 await next.waitForFunction(()=>!window.app.gameState.rouletteInProgress&&window.app.clientView.isMyTurn,10000);if(!await next.evaluate(()=>!window.app.el.playerHandCards.inert&&window.app.clientView.canPlayCards.length>0))throw Error('Controls did not resume');await next.evaluate(()=>window.app.send({type:'play_card',data:{cardId:window.app.clientView.canPlayCards[0]}}));await next.waitForFunction(()=>window.app.gameState.topDiscard.id!=='roulette-live');console.log('PASS three live clients: progress shown, target can choose, early card/draw rejected, clock paused, fresh turn resumes and next card succeeds');
 }finally{clients.forEach(c=>c.close());chrome.proc.kill();server.close();}}
main().catch(e=>{console.error(e);process.exit(1)});
