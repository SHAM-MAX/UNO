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
await new Promise(r=>server.listen(3006,r));const {proc:chrome}=await startHeadlessChrome();
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
 const host=rm.createRoom('Alice Smith'),guest=rm.joinRoom(host.roomId,'Bob Jones');const ids=[host.playerId,guest.playerId];
 const a=(await createBrowserSession('Alice')).cdp,b=(await createBrowserSession('Bob')).cdp;sessions.push(a,b);
 for(const [cdp,session,origin] of [[a,host,'localhost'],[b,guest,'127.0.0.1']]){
  await cdp.navigate(`http://${origin}:3006`);await cdp.waitForFunction('()=>!!window.app');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
  await cdp.evaluate(`Object.assign(window.app,${JSON.stringify({...session,roomId:host.roomId})});window.app.connectWebSocket(window.app.roomId,window.app.playerId,window.app.sessionToken,'Player')`);
 }
 let recorded=0;
 a.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.method==='Page.screencastFrame'){a.ws.send(JSON.stringify({id:a.reqId++,method:'Page.screencastFrameAck',params:{sessionId:m.params.sessionId}}));if(recorded<90)fs.writeFileSync(`scratch/classic-refinements/recording-${String(recorded++).padStart(3,'0')}.jpg`,Buffer.from(m.params.data,'base64'));}});
 b.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.method==='Page.screencastFrame')b.ws.send(JSON.stringify({id:b.reqId++,method:'Page.screencastFrameAck',params:{sessionId:m.params.sessionId}}));});
 await b.send('Page.startScreencast',{format:'jpeg',quality:35,maxWidth:680,maxHeight:384,everyNthFrame:2});
 await a.send('Page.startScreencast',{format:'jpeg',quality:65,maxWidth:1366,maxHeight:768,everyNthFrame:1});
 await wait(300);rm.startGame(host.roomId,ids[0]);const room=rm.getRoom(host.roomId);fixture(room,ids);await sync(a);
 for(const cdp of [a,b]){await cdp.waitForFunction(`()=>window.app.gameState?.actionVersion===${room.actionVersion}`);ok(await cdp.evaluate(`document.querySelectorAll('.classic-profile-ring').length===1 && document.querySelector('.classic-profile-ring').closest('[data-profile-id]').dataset.profileId===${JSON.stringify(ids[0])}`),'Two-player timer not on active avatar');}
 results.push('Two rendered clients: countdown uses same active avatar and deadline');
 ok(await a.evaluate('getComputedStyle(document.getElementById("btnDrawAction")).display==="none" && getComputedStyle(document.getElementById("actionBanner")).display==="none" && !document.getElementById("drawPileBtn").disabled'),'Redundant controls still visible');
 ok(await b.evaluate('document.getElementById("drawPileBtn").disabled'),'Out-of-turn deck enabled');
 ok(await a.evaluate('getComputedStyle(document.getElementById("btnUnoAction")).display!=="none"'),'Two-card UNO missing');
 ok(await b.evaluate('getComputedStyle(document.getElementById("btnUnoAction")).display==="none"'),'Opponent UNO action visible');
 // Observe authoritative play and continuous travel, not just opacity.
 await press(a,'[data-card-id="c-2"]');const play=await sampleTravel(a);ok(play.first.duration>=300 && play.first.duration<=450,'Unexpected play duration');await shot(a,'play-mid');await wait(650);ok(room.topDiscard.id==='c-2' && (await ghosts(a)).length===0,'Play did not settle');results.push({play});
 ok(await b.evaluate('document.getElementById("btnCatchAction").textContent==="CAUGHT" && getComputedStyle(document.getElementById("btnCatchAction")).display!=="none"'),'Catch action missing');
 const before=room.playerHands[ids[0]].length;for(const cdp of [a,b]) await cdp.evaluate('window.maxPenaltyGhosts=0;window.penaltyObserver?.disconnect();window.penaltyObserver=new MutationObserver(()=>{window.maxPenaltyGhosts=Math.max(window.maxPenaltyGhosts,document.querySelectorAll(".classic-motion-ghost").length)});window.penaltyObserver.observe(document.body,{childList:true})');await press(b,'#btnCatchAction');await a.waitForFunction('()=>window.maxPenaltyGhosts===2');await b.waitForFunction('()=>window.maxPenaltyGhosts===2');await shot(a,'caught-penalty');await wait(750);ok(room.playerHands[ids[0]].length===before+2,'Catch penalty incorrect');console.log('Play and catch travel verified');results.push('Catch animates exactly two cards locally and toward opponent fan; counts synchronized');
 for(const cdp of [a,b])ok(await cdp.evaluate(`document.querySelectorAll('.classic-profile-ring').length===1 && document.querySelector('.classic-profile-ring').closest('[data-profile-id]').dataset.profileId===${JSON.stringify(ids[1])}`),'Timer did not move to next avatar');
 // Correct UNO declaration and stale catch rejection.
 fixture(room,ids);await sync(a);await press(a,'#btnUnoAction');await a.waitForFunction('()=>window.app.gameState.players.find(p=>p.id===window.app.playerId).hasCalledUno && getComputedStyle(document.getElementById("btnUnoAction")).display==="none"');ok(room.players[0].hasCalledUno,'UNO not confirmed');ok(await a.evaluate('getComputedStyle(document.getElementById("btnUnoAction")).display==="none"'),'UNO remained visible after call');await press(a,'[data-card-id="c-2"]');await b.waitForFunction('()=>!!document.querySelector(".classic-caught-failed")');await wait(500);
 ok(await b.evaluate('!!document.querySelector(".classic-caught-failed") && getComputedStyle(document.getElementById("btnCatchAction")).display==="none"'),`Called UNO not marked CAUGHT FAILED: ${JSON.stringify({players:room.players.map(p=>({name:p.name,count:p.cardCount,uno:p.hasCalledUno})),top:room.topDiscard.id,guest:await b.evaluate('document.getElementById("opponentsRow").innerHTML')})}`);await shot(b,'caught-failed');
 const unchanged=JSON.stringify(room.playerHands),turn=room.currentTurn;await b.evaluate(`window.app.send({type:'catch_uno',data:{targetPlayerId:${JSON.stringify(ids[0])}}})`);await wait(150);ok(JSON.stringify(room.playerHands)===unchanged && room.currentTurn===turn,'Stale catch changed game');ok(await b.evaluate('document.getElementById("toast").textContent.includes("CAUGHT FAILED")'),'Failed catch feedback missing');
 console.log('UNO and failed catch verified');
 // Draw from deck, back first and exact face revealed at arrival.
 fixture(room,ids);room.drawPile.unshift({id:'c-4',color:'red',type:'number',value:2});await sync(a);await press(a,'#drawPileBtn');const draw=await sampleTravel(a);ok(draw.first.src.includes('back'),'Draw must start with back');await shot(a,'draw-mid');await wait(650);ok(room.turnDrawnCardId==='c-4' && (await ghosts(a)).length===0,'Draw did not settle exact card');results.push({draw});console.log('Draw travel verified');
 await a.send('Page.stopScreencast');await b.send('Page.stopScreencast');
 // Three connected players and catch expiry without automatic penalty.
 room.status='lobby';const observer=rm.joinRoom(host.roomId,'Cara Lee');room.status='playing';ids.push(observer.playerId);room.playerHands[observer.playerId]=[{id:'c-80',color:'blue',type:'number',value:2}];
 const ws=new WebSocket('ws://localhost:3006');await new Promise(r=>ws.once('open',r));ws.send(JSON.stringify({type:'join',roomId:host.roomId,sessionToken:observer.sessionToken}));await wait(100);
 fixture(room,ids);room.drawPile.unshift({id:'c-90',color:'blue',type:'number',value:9});await sync(a);await press(a,'[data-card-id="c-2"]');await wait(500);const single=room.playerHands[ids[0]].length;await press(b,'#drawPileBtn');await wait(650);ok(room.unoChallengeWindow===null && room.playerHands[ids[0]].length===single,'Expired catch penalized player');results.push('Three connected players: next action closes catch window without automatic penalty');
 // Drag/tap remain functional.
 fixture(room,ids);await sync(a);await a.send('Page.bringToFront');await wait(200);await drag(a);ok(room.topDiscard.id==='c-2',`Mouse drag regression: ${room.currentTurn} ${room.topDiscard.id} ${await a.evaluate('window.app.clientView.canPlayCards.join(",")')}`);
 await a.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await a.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});fixture(room,ids);await sync(a);await a.send('Page.bringToFront');await wait(200);await drag(a,true);ok(room.topDiscard.id==='c-2','Touch drag regression');
 fixture(room,ids);await sync(a);const tap=await rect(a,'[data-card-id="c-2"]');await a.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[tap]});await a.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(500);ok(room.topDiscard.id==='c-2','Tap regression');results.push('Mouse drag, touch drag and direct tap preserved');
 // Pending Draw Four requires response buttons, never the deck.
 fixture(room,ids);room.currentTurn=ids.length-1;room.playerHands[ids.at(-1)]=[{id:'c-105',color:'wild',type:'wild_draw4'},{id:'c-2',color:'red',type:'number',value:1}];rm.playCard(host.roomId,ids.at(-1),{cardId:'c-105',chosenColor:'blue'});await sync(a);ok(await a.evaluate('document.getElementById("drawPileBtn").disabled && !document.getElementById("classicAcceptDrawFour").hidden'),'Pending challenge deck not disabled');await press(a,'#classicChallenge');await wait(650);ok(room.currentTurn===0 && room.lastDrawFourResult.outcome==='successful','Draw Four regression');results.push('Draw pile disabled during Draw Four response; separate Challenge preserves physical rules');
 room.status='round_over';room.winnerId=ids[0];await sync(a);ok(await a.evaluate('window.app.turnTimerInterval===null && document.querySelectorAll(".classic-profile-ring").length===0'),'Timer continued after round');
 await a.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});fixture(room,ids);room.drawPile.unshift({id:'c-4',color:'red',type:'number',value:2});await sync(a);await press(a,'#drawPileBtn');await wait(100);ok((await ghosts(a)).length===0 && room.turnDrawnCardId==='c-4','Reduced motion failed');await a.send('Emulation.setEmulatedMedia',{features:[]});results.push('Reduced motion skips ghosts; timer interval and ring stop at round completion');
 // Screenshots preserve tabletop, hand, art and avatar profiles.
 for(const [w,h] of [[360,800],[390,844],[412,915],[1366,768],[1920,1080]]){
  fixture(room,ids);await a.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:w<600});await sync(a);await shot(a,`${w}x${h}`);
  ok(await a.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Horizontal overflow');
 }
 ws.close();console.log(JSON.stringify(results,null,2));
}catch(e){results.push({error:e.stack});throw e;}
finally{fs.writeFileSync('scratch/classic-refinements/results.json',JSON.stringify(results,null,2));sessions.forEach(c=>c.close());chrome.kill();wss.clients.forEach(ws=>ws.terminate());await new Promise(r=>server.close(r));}
