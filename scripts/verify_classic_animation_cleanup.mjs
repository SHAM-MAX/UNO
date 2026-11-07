import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 10000 + Math.floor(Math.random() * 40000);

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
      const timer=setTimeout(()=>{this.callbacks.delete(id);reject(new Error(`CDP timeout: ${method}`));},15000);
      this.callbacks.set(id, { resolve:value=>{clearTimeout(timer);resolve(value);}, reject:error=>{clearTimeout(timer);reject(error);} });
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

  async waitForFunction(fnStr, timeout = 12000) {
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
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
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


async function rect(cdp,selector){return cdp.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)}
async function mouse(cdp,kind,x,y){await cdp.send('Input.dispatchMouseEvent',{type:kind,x,y,button:kind==='mouseMoved'?'none':'left',buttons:kind==='mouseReleased'?0:1,clickCount:1});}
async function click(cdp,selector){const p=await rect(cdp,selector);await mouse(cdp,'mousePressed',p.x,p.y);await mouse(cdp,'mouseReleased',p.x,p.y);await wait(220);}
async function drag(cdp,touch=false,target='#discardPile'){const a=await rect(cdp,'[data-card-id="c-2"]'),b=await rect(cdp,target);
 if(touch){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x,y:a.y}]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+(b.x-a.x)*i/8,y:a.y+(b.y-a.y)*i/8}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else{await mouse(cdp,'mouseMoved',a.x,a.y);await wait(120);await mouse(cdp,'mousePressed',a.x,a.y);for(let i=1;i<=8;i++){await mouse(cdp,'mouseMoved',a.x+(b.x-a.x)*i/8,a.y+(b.y-a.y)*i/8);await wait(18);}await mouse(cdp,'mouseReleased',b.x,b.y);}
 await wait(300);
}
process.env.NODE_ENV='test';process.env.DATA_DIR='scratch/refinement-db';
const {server,wss,roomManager:rm}=await import('../server/src/index.js');
// Screenshot encoding can exceed a turn on this host. Keep fixtures deterministic;
// actual timeout behavior is covered by the full server suite. Deadlines still render normally.
rm.handleTurnTimeout=()=>{};
await new Promise(r=>server.listen(3007,r));const {proc:chrome}=await startHeadlessChrome();
const wait=ms=>new Promise(r=>setTimeout(r,ms));const sessions=[],results=[];
fs.mkdirSync('scratch/classic-refinements',{recursive:true});
const ok=(v,message)=>{if(!v)throw Error(message);};
async function shot(cdp,name){const s=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`scratch/classic-refinements/${name}.png`,Buffer.from(s.data,'base64'));}
async function sync(cdp){const rid=await cdp.evaluate('window.app.roomId');const version=rm.getRoom(rid).actionVersion || 0;await cdp.evaluate('window.app.send({type:"ready",data:{isReady:true}})');await cdp.waitForFunction(`()=>window.app.gameState?.actionVersion===${version}`);await wait(650);}
async function press(cdp,selector){await cdp.send('Page.bringToFront');const initial=await rect(cdp,selector);await mouse(cdp,'mouseMoved',initial.x,initial.y);await wait(140);const p=await rect(cdp,selector);await mouse(cdp,'mousePressed',p.x,p.y);await mouse(cdp,'mouseReleased',p.x,p.y);}
function fixture(room,ids){Object.assign(room,{status:'playing',currentTurn:0,direction:1,activeColor:'red',pendingAction:null,unoChallengeWindow:null,turnDrawnCard:false,turnDrawnCardId:null});room.topDiscard={id:'c-10',type:'number',color:'red',value:5};room.discardPile=[room.topDiscard];room.playerHands[ids[0]]=[{id:'c-2',color:'red',type:'number',value:1},{id:'c-52',color:'green',type:'number',value:1}];room.players.forEach(p=>{p.hasCalledUno=false;p.cardCount=room.playerHands[p.id].length;});rm.resetTurnTimer(room);}
async function ghosts(cdp){return cdp.evaluate('Array.from(document.querySelectorAll(".classic-motion-ghost")).map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,src:el.querySelector("img")?.getAttribute("src"),duration:el.getAnimations()[0]?.effect.getTiming().duration,time:el.getAnimations()[0]?.currentTime,state:el.getAnimations()[0]?.playState,frames:el.getAnimations()[0]?.effect.getKeyframes(),transform:getComputedStyle(el).transform}))');}
async function sampleTravel(cdp) {
 return cdp.evaluate(`new Promise((resolve,reject)=>{
  const start=performance.now();let first;
  function tick(){
   const el=document.querySelector('.classic-motion-ghost');
   if(el){const r=el.getBoundingClientRect();const point={x:r.x,y:r.y,src:el.querySelector('img')?.getAttribute('src'),duration:el.getAnimations()[0]?.effect.getTiming().duration};
    if(!first)first=point;
    else if(Math.hypot(first.x-point.x,first.y-point.y)>10){resolve({first,mid:point});return;}
   }
   if(performance.now()-start>4000){reject(new Error('No visible travel between rendered frames: '+JSON.stringify({first,visibility:document.visibilityState,top:window.app.gameState.topDiscard.id,playable:window.app.clientView.canPlayCards,active:window.app.classicAnimationCleanups?.size})));return;}
   requestAnimationFrame(tick);
  }requestAnimationFrame(tick);
 })`);
}
try{
 const host=rm.createRoom('Reconnect host'),guest=rm.joinRoom(host.roomId,'Guest');const ids=[host.playerId,guest.playerId];
 const a=(await createBrowserSession('Cleanup')).cdp;sessions.push(a);await a.navigate('http://localhost:3007');await a.waitForFunction('()=>!!window.app');
 await a.evaluate(`Object.assign(window.app,${JSON.stringify(host)});window.app.connectWebSocket(window.app.roomId,window.app.playerId,window.app.sessionToken,'Host')`);await wait(200);
 rm.startGame(host.roomId,ids[0]);const room=rm.getRoom(host.roomId);fixture(room,ids);room.drawPile.unshift({id:'c-4',color:'red',type:'number',value:2});await sync(a);
 a.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.method==='Page.screencastFrame')a.ws.send(JSON.stringify({id:a.reqId++,method:'Page.screencastFrameAck',params:{sessionId:m.params.sessionId}}));});await a.send('Page.startScreencast',{format:'jpeg',quality:30,maxWidth:320,maxHeight:240});
 await press(a,'#drawPileBtn');await a.waitForFunction('()=>document.querySelectorAll(".classic-motion-ghost").length>0');await a.evaluate('window.app.ws.close()');
 await a.waitForFunction('()=>!document.querySelector(".classic-motion-ghost") && document.getElementById("playerHandCards").hasAttribute("inert")');
 await a.waitForFunction('()=>window.app.ws.readyState===1 && !document.getElementById("playerHandCards").hasAttribute("inert")');
 ok(room.playerHands[ids[0]].length===3 && room.turnDrawnCardId==='c-4','Reconnect changed drawn hand');ok(await a.evaluate('Array.from(document.querySelectorAll("#playerHandCards .game-card")).every(el=>getComputedStyle(el).visibility!=="hidden")'),'Reconnect left hidden card');results.push('Disconnect during draw travel removes ghost, restores target visibility, reconnects same hand and exact drawn card');
 const flip=rm.createRoom('Flip host','flip');rm.joinRoom(flip.roomId,'Flip guest');await a.evaluate(`Object.assign(window.app,${JSON.stringify(flip)});window.app.connectWebSocket(window.app.roomId,window.app.playerId,window.app.sessionToken,'Flip host')`);await wait(250);rm.startGame(flip.roomId,flip.playerId);await sync(a);
 ok(await a.evaluate('window.app.gameState.mode==="flip" && getComputedStyle(document.getElementById("btnDrawAction")).display!=="none" && getComputedStyle(document.getElementById("turnTimerContainer")).display!=="none" && getComputedStyle(document.getElementById("classicLocalControls")).display==="none"'),'Flip controls changed');results.push('Switching from Classic restores original Flip draw control and common timer');
 console.log(JSON.stringify(results));
}catch(e){results.push({error:e.stack});throw e;}
finally{fs.writeFileSync('scratch/classic-refinements/cleanup-results.json',JSON.stringify(results,null,2));sessions.forEach(c=>c.close());chrome.kill();wss.clients.forEach(ws=>ws.terminate());await new Promise(r=>server.close(r));}
