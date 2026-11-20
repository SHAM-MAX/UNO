import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9596;
const ARTIFACT_DIR = path.resolve('scratch/table-tools');

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
 process.env.NODE_ENV='test';process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'uno-tools-'));fs.mkdirSync(ARTIFACT_DIR,{recursive:true});const {server,roomManager}=await import('../server/src/index.js');await new Promise(r=>server.listen(0,r));const base='http://localhost:'+server.address().port,chrome=await startHeadlessChrome();let cdp,peer;const check=async(fn,msg)=>{if(!await cdp.evaluate(fn))throw Error(msg);};
 try{
 ({cdp}=await createBrowserSession('Tools'));await cdp.setViewport(1280,800);await cdp.navigate(base);await cdp.waitForFunction(()=>!!window.app);await cdp.evaluate(()=>{localStorage.setItem('uno_quick_guide_seen','true');window.app.createRoom('Tools Host','classic',undefined,'fixed');});await cdp.waitForFunction(()=>window.app.gameState?.status==='lobby');const roomId=await cdp.evaluate(()=>window.app.roomId);peer=new WebSocket(base.replace('http','ws')+'/ws');await new Promise(r=>peer.once('open',r));peer.send(JSON.stringify({type:'join',roomId,playerName:'Tools Guest'}));await cdp.waitForFunction(()=>window.app.gameState.players.length===2);peer.send(JSON.stringify({type:'ready',data:{isReady:true}}));await cdp.waitForFunction(()=>window.app.gameState.players.every(p=>p.isReady));await cdp.evaluate(()=>window.app.send({type:'start_game'}));await cdp.waitForFunction(()=>window.app.gameState.status==='playing');
 const room=roomManager.getRoom(roomId),host=room.players[0],guest=room.players[1],card=(id,color,value)=>({id,color,type:'number',value});Object.assign(room,{currentTurn:0,pendingAction:null,activeColor:'red',topDiscard:card('top','red',5),pendingDrawPenalty:0});room.playerHands[host.id]=[card('blue9','blue',9),card('red5','red',5),card('green1','green',1)];host.cardCount=3;host.socket.send(JSON.stringify({type:'room:state',data:roomManager.getClientView(roomId,host.id)}));await cdp.waitForFunction(()=>window.app.clientView.myHand.length===3);
 await cdp.evaluate(()=>{document.querySelector('.round-tools-toggle')?.click();document.getElementById('sortHandBtn').click();});await check(()=>window.app.handSort==='color'&&document.querySelector('[data-card-id="red5"]')&&window.app.clientView.myHand[0].id==='blue9','Sorting changed authoritative hand');
 await cdp.evaluate(()=>window.app.send({type:'play_card',data:{cardId:'red5'}}));await cdp.waitForFunction(()=>window.app.gameState.lastPlay?.card.id==='red5');await cdp.evaluate(()=>document.getElementById('lastPlayBtn').click());await check(()=>document.getElementById('socialTitle').textContent==='Last card played'&&document.querySelector('.last-play-card .game-card')&&document.getElementById('socialContent').innerText.includes('Tools Host'),'Last card replay missing');await cdp.evaluate(()=>window.app.closeSocialPanel());await cdp.waitForFunction(()=>!history.state.modal);
 const before=await cdp.evaluate(()=>({player:window.app.playerId,ids:window.app.clientView.myHand.map(c=>c.id)}));await cdp.evaluate(()=>window.app.ws.close());await cdp.waitForFunction(()=>window.app.connectionRecovering);await cdp.waitForFunction(()=>!window.app.connectionRecovering&&window.app.ws.readyState===1,10000);await check(()=>window.app.clientView.myHand.length===2,'Reconnect lost cards');const after=await cdp.evaluate(()=>({player:window.app.playerId,ids:window.app.clientView.myHand.map(c=>c.id)}));if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Seat or hand changed during reconnect');
 await cdp.evaluate(()=>window.app.openSettingsModal());await cdp.evaluate(()=>document.querySelector('[data-theme="midnight"]').click());await check(()=>document.body.dataset.tableTheme==='midnight'&&localStorage.getItem('uno_table_theme')==='midnight','Theme not saved');await cdp.evaluate(()=>document.getElementById('tableHaptics').click());await check(()=>localStorage.getItem('uno_table_haptics')==='true','Haptic preference not saved');await cdp.evaluate(()=>window.app.closeSettingsModal());await cdp.waitForFunction(()=>!history.state.modal);
 await cdp.evaluate(async()=>{const {warnTurn}=await import('./table-tools.js');window.warningCount=0;const app={gameState:{status:'playing'},clientView:{isMyTurn:true},playTurnWarning:()=>window.warningCount++};warnTurn(app,3);warnTurn(app,3);warnTurn(app,2);warnTurn(app,1);app.clientView.isMyTurn=false;warnTurn(app,1);});await check(()=>window.warningCount===3,'Turn alerts repeat or trigger for wrong player');
 for(const [w,h,m] of [[1280,800,false],[390,844,true],[844,390,true]]){await cdp.setViewport(w,h,m);await delay(250);await check(()=>{const r=document.getElementById('tableTools').getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;},'Toolbar outside viewport');await check(()=>[...document.querySelectorAll('#tableTools button')].filter(b=>b.getClientRects().length).every(b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'Toolbar is covered by another control: '+JSON.stringify(await cdp.evaluate(()=>[...document.querySelectorAll('#tableTools button')].filter(b=>b.getClientRects().length).map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,rect:{x:r.x,y:r.y,w:r.width,h:r.height},hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,180),z:getComputedStyle(b.parentElement).zIndex};}))));await cdp.screenshot(path.join(ARTIFACT_DIR,'tools-'+w+'.png'));}
 roomManager.finishClassicRound(room,guest.id);host.socket.send(JSON.stringify({type:'room:state',data:roomManager.getClientView(roomId,host.id)}));await cdp.waitForFunction(()=>window.app.gameState.status==='round_over');await cdp.evaluate(()=>document.getElementById('victoryScoresBtn').click());await check(()=>document.querySelector('.round-history').innerText.includes('Tools Guest'),'Round scoreboard missing');await cdp.screenshot(path.join(ARTIFACT_DIR,'round-scores.png'));
 console.log('PASS hand sorting, public replay, real reconnect/seat restoration, saved themes, haptics preference, deduplicated turn warnings, responsive toolbar and round scoreboard');
 }finally{peer?.terminate();cdp?.close();chrome.proc.kill();server.close();}
}
main().catch(e=>{console.error(e);process.exit(1)});
