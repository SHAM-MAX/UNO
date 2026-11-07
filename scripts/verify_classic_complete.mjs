import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9335;

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


process.env.NODE_ENV = 'test';
process.env.DATA_DIR = 'scratch/classic-browser-db';
const {server, wss, roomManager: rm} = await import('../server/src/index.js');
await new Promise(resolve => server.listen(3005, resolve));
const {proc:chrome} = await startHeadlessChrome();
fs.mkdirSync('scratch/classic-verification', {recursive:true});
const sessions=[];
const report=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(room, ids, type='number') {
 room.status='playing'; room.pendingAction=null; room.currentTurn=0;room.direction=1; room.activeColor='red';room.turnDrawnCard=false;room.turnDrawnCardId=null;room.unoChallengeWindow=null;
 room.topDiscard={id:'c-10',color:'red',type:'number',value:5};room.discardPile=[room.topDiscard];
 room.playerHands[ids[0]]=[{id:'c-2',color:'red',type:'number',value:1},{id:'c-52',color:'green',type:'number',value:1}];
 if(type==='wild')room.playerHands[ids[0]][0]={id:'c-101',color:'wild',type:'wild'};
 room.players.forEach(p=>p.cardCount=room.playerHands[p.id].length); rm.resetTurnTimer(room);
}
async function sync(cdp, roomId) {

 // Ready is harmless and broadcasts the authoritative snapshot even in play.
 await cdp.evaluate(`window.app.send({type:'ready',data:{isReady:true}})`);await wait(500);
}
async function rect(cdp,selector){return cdp.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)}
async function mouse(cdp,kind,x,y){await cdp.send('Input.dispatchMouseEvent',{type:kind,x,y,button:kind==='mouseMoved'?'none':'left',buttons:kind==='mouseReleased'?0:1,clickCount:1});}
async function click(cdp,selector){const p=await rect(cdp,selector);await mouse(cdp,'mousePressed',p.x,p.y);await mouse(cdp,'mouseReleased',p.x,p.y);await wait(220);}
async function drag(cdp,touch=false,target='#discardPile'){const a=await rect(cdp,'[data-card-id="c-2"]'),b=await rect(cdp,target);
 if(touch){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x,y:a.y}]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+(b.x-a.x)*i/8,y:a.y+(b.y-a.y)*i/8}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else{await mouse(cdp,'mouseMoved',a.x,a.y);await wait(120);await mouse(cdp,'mousePressed',a.x,a.y);for(let i=1;i<=8;i++){await mouse(cdp,'mouseMoved',a.x+(b.x-a.x)*i/8,a.y+(b.y-a.y)*i/8);await wait(18);}await mouse(cdp,'mouseReleased',b.x,b.y);}
 await wait(300);
}
try{
 const {cdp}=await createBrowserSession('Classic');sessions.push(cdp);
 await cdp.navigate('http://localhost:3005');await cdp.waitForFunction('()=>!!window.app');
 const created=rm.createRoom('Browser host');const {roomId,playerId}=created;
 const guest=rm.joinRoom(roomId,'Guest');const ids=[playerId,guest.playerId];
 await cdp.evaluate(`Object.assign(window.app,${JSON.stringify({...created,playerName:'Browser host'})});window.app.connectWebSocket(window.app.roomId,window.app.playerId,window.app.sessionToken,"Browser host")`);
 await wait(500);
 rm.startGame(roomId,playerId);const room=rm.getRoom(roomId);
 fixture(room,ids);await sync(cdp,roomId);
 for(const [w,h] of [[360,800],[390,844],[412,915],[768,1024],[1366,768],[1920,1080]]){
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:w<600});
  await cdp.evaluate('window.app.renderArena()');await wait(150);
  const shot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`scratch/classic-verification/${w}x${h}.png`,Buffer.from(shot.data,'base64'));
  report.push({viewport:`${w}x${h}`,images:await cdp.evaluate('Array.from(document.querySelectorAll("#playerHandCards img")).every(i=>i.complete&&i.naturalWidth>0)'),overflow:await cdp.evaluate('document.documentElement.scrollWidth>innerWidth')});
 }
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});await cdp.evaluate('window.app.renderArena()');await wait(100);
 await click(cdp,'[data-card-id="c-2"]');if(room.topDiscard.id!=='c-2')throw Error('Mouse click failed');report.push('Mouse click changes server state');
 fixture(room,ids);await sync(cdp,roomId);await drag(cdp);if(room.topDiscard.id!=='c-2')throw Error('Mouse drag failed');report.push('Mouse drag changes server state');
 fixture(room,ids);await sync(cdp,roomId);await drag(cdp,false,'.top-nav');if(room.topDiscard.id!=='c-10')throw Error('Invalid drop mutated state');report.push('Invalid drop returns without server mutation');
 fixture(room,ids);await sync(cdp,roomId);await cdp.evaluate(`document.querySelector('[data-card-id="c-2"]').focus()`);await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await wait(220);if(room.topDiscard.id!=='c-2')throw Error('Keyboard failed');report.push('Keyboard activation changes server state');
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 fixture(room,ids);await sync(cdp,roomId);await drag(cdp,true);if(room.topDiscard.id!=='c-2')throw Error('Touch drag failed');report.push('Touch drag changes server state');
 fixture(room,ids);await sync(cdp,roomId);const tap=await rect(cdp,'[data-card-id="c-2"]');await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[tap]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(250);if(room.topDiscard.id!=='c-2')throw Error('Tap failed');report.push('Touch tap changes server state');
 fixture(room,ids);await sync(cdp,roomId);
 const dragStart=await rect(cdp,'[data-card-id="c-2"]');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[dragStart]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:dragStart.x,y:dragStart.y-45}]});
 await wait(40);
 if(!await cdp.evaluate('!!document.querySelector(".classic-drag-ghost")'))throw Error('Reconnect test did not begin drag');
 const originalIds=room.playerHands[ids[0]].map(c=>c.id).join(',');
 await cdp.evaluate('window.app.ws.close()');
 await cdp.waitForFunction('()=>window.app.el.playerHandCards.hasAttribute("inert") && !document.querySelector(".classic-drag-ghost")');
 await cdp.evaluate('window.app.send({type:"draw_card"})');
 if(await cdp.evaluate('(window.app.pendingMessages||[]).some(m=>m.type==="draw_card")'))throw Error('Offline action queued');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await cdp.waitForFunction('()=>window.app.ws.readyState===1 && !window.app.el.playerHandCards.hasAttribute("inert")');
 if(room.playerHands[ids[0]].map(c=>c.id).join(',')!==originalIds)throw Error('Reconnect mutated hand');
 if(await cdp.evaluate('window.app.playerId')!==ids[0])throw Error('Reconnect changed identity');
 report.push('Connection interrupted during touch drag: ghost removed, offline move blocked, session and hand restored');
 fixture(room,ids,'wild');await sync(cdp,roomId);await click(cdp,'[data-card-id="c-101"]');await click(cdp,'[data-color="blue"]');if(room.activeColor!=='blue')throw Error('Colour picker failed');report.push('Wild colour validated on server');
 // Run complete natural rounds through the rendered client against a second authenticated socket.
 const bot=new WebSocket('ws://localhost:3005');await new Promise(r=>bot.on('open',r));bot.send(JSON.stringify({type:'join',roomId,sessionToken:guest.sessionToken}));await wait(150);
 fixture(room,ids);room.playerHands[ids[0]]=[{id:'c-2',color:'red',type:'number',value:1}];await sync(cdp,roomId);await click(cdp,'[data-card-id="c-2"]');if(room.status!=='round_over')throw Error('Round result failed');report.push('Final browser play produces authoritative round result');
 await click(cdp,'#rematchBtn');if(room.status!=='playing'||room.roundNumber!==2)throw Error('Next round failed');report.push('Next round keeps sessions and scores');bot.close();


 fixture(room,ids);room.drawPile=[{id:'c-4',color:'red',type:'number',value:2},...room.drawPile];await sync(cdp,roomId);const beforeDraw=room.playerHands[ids[0]].length;await click(cdp,'#drawPileBtn');if(room.playerHands[ids[0]].length!==beforeDraw+1||room.turnDrawnCardId!=='c-4')throw Error('Draw pile failed');report.push('Draw pile adds the exact server-authorized card');
 fixture(room,ids);room.dealerIndex=1;rm.applyClassicOpening(room,{type:'wild',color:'wild'});await sync(cdp,roomId);await click(cdp,'[data-color="green"]');if(room.activeColor!=='green'||room.pendingAction)throw Error('Opening colour failed');report.push('Opening wild waits for first-player colour choice');
 fixture(room,ids);room.pendingAction={type:'draw4_challenge',offenderId:ids[1],targetPlayerId:ids[0],illegal:false};await sync(cdp,roomId);const challengeBefore=room.playerHands[ids[0]].length;await click(cdp,'#classicChallenge');if(room.playerHands[ids[0]].length!==challengeBefore+6)throw Error('Browser challenge failed');report.push('Draw Four challenge button applies six-card server penalty');

 for(const accept of [false,true]) {
  fixture(room,ids);room.currentTurn=1;
  room.playerHands[ids[1]]=[{id:'c-105',color:'wild',type:'wild_draw4'},{id:'c-2',color:'red',type:'number',value:1}];
  if(!rm.playCard(roomId,ids[1],{cardId:'c-105',chosenColor:'blue'}).success)throw Error('Physical bluff rejected');
  await sync(cdp,roomId);
  if(!accept){await wait(3200);const shot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('scratch/classic-verification/draw4-choice-mobile.png',Buffer.from(shot.data,'base64'));}
  const hostCount=room.playerHands[ids[0]].length,guestCount=room.playerHands[ids[1]].length;
  await click(cdp,accept?'#classicAcceptDrawFour':'#classicChallenge');
  if(accept){if(room.playerHands[ids[0]].length!==hostCount+4||room.currentTurn!==1)throw Error('Bluff acceptance penalty incorrect');}
  else{if(room.playerHands[ids[1]].length!==guestCount+4||room.currentTurn!==0)throw Error('Successful physical challenge penalty incorrect');if(!await cdp.evaluate('window.app.clientView.drawFourEvidence?.hadMatchingColor'))throw Error('Challenger evidence missing');}
  report.push(accept?'Browser ACCEPT applies four-card penalty and skips target':'Browser CHALLENGE catches a real bluff and preserves challenger turn with private evidence');
 }
 for (const n of (process.env.CLASSIC_BROWSER_INTERACTIONS_ONLY ? [10] : [2,3,6,10])) {
  const created=rm.createRoom(`Natural host ${n}`), rid=created.roomId;
  const peers=[];
  for(let i=1;i<n;i++) { const joined=rm.joinRoom(rid,`Opponent ${i}`);const ws=new WebSocket('ws://localhost:3005');await new Promise(r=>ws.on('open',r));ws.send(JSON.stringify({type:'join',roomId:rid,sessionToken:joined.sessionToken}));peers.push({ws,id:joined.playerId}); }
  await cdp.evaluate(`Object.assign(window.app,${JSON.stringify(created)});window.app.el.gameOverModal.classList.remove('active');window.app.connectWebSocket(window.app.roomId,window.app.playerId,window.app.sessionToken,'Natural host')`);await wait(180);
  rm.startGame(rid,created.playerId);await sync(cdp,rid);
  const natural=rm.getRoom(rid);
  if(n===10){
   for(const [w,h] of [[360,800],[390,844],[412,915],[768,1024],[1366,768],[1920,1080],[844,390]]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:w<900});await cdp.evaluate('window.app.renderArena()');await wait(150);
    const shot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`scratch/classic-verification/10players-${w}x${h}.png`,Buffer.from(shot.data,'base64'));
   }
   report.push('Ten-player rendered snapshots at six requested sizes plus landscape');
  }
  if(process.env.CLASSIC_BROWSER_INTERACTIONS_ONLY){peers.forEach(p=>p.ws.close());continue;}
  {
   let turns=0;
   while(natural.status!=='game_over' && turns++<15000){
    if(natural.status==='round_over') {
      await cdp.evaluate(`window.app.send({type:'rematch'})`);
      await wait(35);
      continue;
    }
    const id=natural.players[natural.currentTurn].id, view=rm.getClientView(rid,id);
    let type='draw_card',data={};
    if(natural.pendingAction?.type==='opening_color'){type='choose_color';data={chosenColor:'red'};}
    else if(natural.pendingAction?.type==='draw4_challenge')type='draw_card';
    else if(view.canPlayCards.length){type='play_card';data={cardId:view.canPlayCards[0],chosenColor:'red'};}
    else if(natural.turnDrawnCard)type='pass_turn';
    if(id===created.playerId){
      await cdp.waitForFunction(`()=>window.app.clientView?.isMyTurn`);
      await cdp.evaluate(`window.app.send(${JSON.stringify({type,data})})`);
    }else peers.find(p=>p.id===id).ws.send(JSON.stringify({type,data,roomId:rid,actionId:`natural-${turns}`}));
    await wait(22);
   }
   if(natural.status!=='game_over')throw Error(`${n}-player natural match failed to finish`);
   if(!natural.roundResult?.points)throw Error('Natural round did not score');
   report.push(`Full natural ${n}-player match: ${turns} actions, ${natural.roundNumber} rounds, winner ${natural.roundResult.total} points, browser and WebSocket peers`);
   console.log(report.at(-1));
  }
  peers.forEach(p=>p.ws.close());
 }
 console.log(JSON.stringify(report,null,2));
}catch(e){report.push({error:e.stack});throw e;}
finally{fs.writeFileSync(process.env.CLASSIC_BROWSER_INTERACTIONS_ONLY ? 'scratch/classic-verification/results-interactions.json' : 'scratch/classic-verification/results.json',JSON.stringify(report,null,2));sessions.forEach(c=>c.close());chrome.kill();wss.clients.forEach(ws=>ws.terminate());await new Promise(r=>server.close(r));}
