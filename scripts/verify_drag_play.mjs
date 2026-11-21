import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9596;
const ARTIFACT_DIR = path.resolve('scratch/play-motion');

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




async function main(){process.env.NODE_ENV='test';process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'uno-drag-'));fs.mkdirSync(ARTIFACT_DIR,{recursive:true});const {server,roomManager}=await import('../server/src/index.js');await new Promise(r=>server.listen(0,r));const base='http://localhost:'+server.address().port,chrome=await startHeadlessChrome(),sessions=[];try{for(const mode of ['classic','flip','no_mercy']){const {cdp}=await createBrowserSession(mode);sessions.push(cdp);await cdp.setViewport(1366,768,false);await cdp.navigate(base);await cdp.waitForFunction(()=>!!window.app);await cdp.evaluate(()=>localStorage.setItem('uno_quick_guide_seen','true'));await cdp.evaluate(mode=>window.app.createRoom('Drag Host',mode,undefined,'fixed'),mode);await cdp.waitForFunction(()=>window.app.gameState?.status==='lobby');const code=await cdp.evaluate(()=>window.app.roomId),room=roomManager.getRoom(code);roomManager.joinRoom(code,'Opponent');room.players.forEach(p=>p.isReady=true);await cdp.evaluate(()=>window.app.send({type:'start_game'}));await cdp.waitForFunction(()=>window.app.gameState.status==='playing');await cdp.evaluate(()=>{const send=window.app.send.bind(window.app);window.dropSends=0;window.app.send=m=>{if(m.type==='play_card')window.dropSends++;return send(m);};});
 const rig=async id=>{const card=(id,color='red',value=5)=>mode==='flip'?{id,light:{color,type:'number',value},dark:{color:'purple',type:'number',value:5}}:{id,color,type:'number',value};room.currentTurn=0;room.pendingAction=null;room.roulettePauseUntil=null;room.pendingDrawPenalty=0;room.activeColor='red';room.topDiscard=card('top-'+id);room.flipSide='light';room.playerHands[room.players[0].id]=[card(id),card('keep-'+id,'blue',8)];room.players[0].cardCount=2;roomManager.resetTurnTimer(room);room.players[0].socket.send(JSON.stringify({type:'room:state',data:roomManager.getClientView(code,room.players[0].id)}));await cdp.waitForFunction(()=>window.app.clientView.myHand.some(c=>c.id===window.testCard));};
 for(const touch of [false,true]){await cdp.setViewport(touch?844:1366,touch?390:768,touch);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:touch});const id=mode+(touch?'touch':'mouse');await cdp.evaluate(id=>window.testCard=id,id);await rig(id);await delay(220);const points=await cdp.evaluate(id=>{const r=document.querySelector('[data-card-id="'+id+'"]').getBoundingClientRect(),b=document.querySelector('.table-felt').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,tx:b.x+b.width/2,ty:b.y+b.height/2};},id);
 const move=async(x,y,phase)=>touch?cdp.send('Input.dispatchTouchEvent',{type:phase==='down'?'touchStart':phase==='up'?'touchEnd':'touchMove',touchPoints:phase==='up'?[]:[{x,y,id:1}]}):cdp.send('Input.dispatchMouseEvent',{type:phase==='down'?'mousePressed':phase==='up'?'mouseReleased':'mouseMoved',x,y,button:phase==='move'?'none':'left',buttons:phase==='up'?0:1,clickCount:1});
 await move(points.x,points.y,'down');await move(points.x+30,points.y-15,'move');await delay(30);await move(points.x+30,points.y-15,'up');await delay(220);if(await cdp.evaluate(()=>window.dropSends)!==(touch?1:0))throw Error('Outside drop played a card');
 await move(points.x,points.y,'down');for(let i=1;i<=8;i++){await move(points.x+(points.tx-points.x)*i/8,points.y+(points.ty-points.y)*i/8,'move');await delay(12);}if(!await cdp.evaluate(()=>!!document.querySelector('.play-drag-ghost')&&!!document.querySelector('.card-drop-ready')))throw Error('Drag does not follow/highlight '+mode+touch);await move(points.tx,points.ty,'up');await cdp.waitForFunction(()=>window.app.gameState.topDiscard.id===window.testCard);await delay(400);if(!await cdp.evaluate(()=>!document.querySelector('.play-drag-ghost')))throw Error('Drag ghost leaked');await cdp.screenshot(path.join(ARTIFACT_DIR,mode+'-'+(touch?'touch':'mouse')+'.png'));}
 if(await cdp.evaluate(()=>window.dropSends)!==2)throw Error('Drag duplicated play');room.direction=-1;room.players[0].socket.send(JSON.stringify({type:'room:state',data:roomManager.getClientView(code,room.players[0].id)}));await cdp.waitForFunction(()=>document.querySelector('.play-direction-label').textContent.includes('ANTICLOCKWISE'));if(!await cdp.evaluate(()=>document.querySelectorAll('#playDirection animateMotion').length===6&&!document.querySelector('#playDirection svg').animationsPaused()))throw Error('Direction arrows not animated');await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await cdp.evaluate(()=>{const v=structuredClone(window.app.clientView);window.app.handleRoomState(v);});if(!await cdp.evaluate(()=>document.querySelector('#playDirection svg').animationsPaused()))throw Error('Reduced motion ignored');console.log('PASS desktop + native touch drag, one send per drop, animated reversal and reduced motion',mode);
 }}finally{sessions.forEach(c=>c.close());chrome.proc.kill();server.close();}}
main().catch(e=>{console.error(e);process.exit(1)});
