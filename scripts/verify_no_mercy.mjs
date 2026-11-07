import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = Number(process.env.NO_MERCY_DEBUG_PORT || 9446);

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
      const timeout = setTimeout(()=>reject(Error('CDP timeout: '+method)),15000);
      const originalResolve=resolve; resolve=value=>{clearTimeout(timeout);originalResolve(value);};
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


process.env.NODE_ENV='test';process.env.DATA_DIR='scratch/no-mercy-browser-db';
const {server,wss,roomManager:rm}=await import('../server/src/index.js');
await new Promise(r=>server.listen(0,r));const url=`http://localhost:${server.address().port}`;
const {proc:chrome}=await startHeadlessChrome();const sessions=[],report=[];const out='scratch/no-mercy-verification';fs.mkdirSync(out,{recursive:true});
const wait=delay;
const assert=(condition,text)=>{if(!condition)throw Error(text);};
async function broadcast(room){for(const ws of wss.clients)if(ws.readyState===1&&ws.playerId)ws.send(JSON.stringify({type:'room:state',data:rm.getClientView(ws.roomId,ws.playerId)}));await wait(100);}
async function sync(room){await sessions[0].evaluate(`window.app.send({type:'ready',data:{isReady:true}})`);await sessions[0].waitForFunction(`()=>app.gameState.actionVersion===${room.actionVersion}`);await wait(500);}
async function rect(cdp,selector){return cdp.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);}
async function mouse(cdp,type,x,y){await cdp.send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',buttons:type==='mouseReleased'?0:1,clickCount:1});}
async function click(cdp,selector){const p=await rect(cdp,selector);await mouse(cdp,'mousePressed',p.x,p.y);await mouse(cdp,'mouseReleased',p.x,p.y);await wait(160);}
async function drag(cdp,touch=false,valid=true){const a=await rect(cdp,'[data-card-id="play"]'),b=valid?await rect(cdp,'#discardPile'):{x:15,y:100};if(touch){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+(b.x-a.x)*i/10,y:a.y+(b.y-a.y)*i/10}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else{await mouse(cdp,'mousePressed',a.x,a.y);for(let i=1;i<=10;i++){await mouse(cdp,'mouseMoved',a.x+(b.x-a.x)*i/10,a.y+(b.y-a.y)*i/10);await wait(12);}await mouse(cdp,'mouseReleased',b.x,b.y);}await wait(200);}
const c=(id,color='red',type='number',value=3)=>({id,color,type,...(type==='number'?{value}:{})});
function fixture(room,ids,type='number',value=3){Object.assign(room,{status:'playing',winnerId:null,currentTurn:0,direction:1,pendingAction:null,pendingDrawPenalty:0,turnDrawnCard:false,turnDrawnCardId:null,activeColor:'red',unoChallengeWindow:null});room.topDiscard=c('top');room.discardPile=[room.topDiscard];room.drawPile=Array.from({length:100},(_,i)=>c('fixture-draw'+i,['red','yellow','green','blue'][i%4],'number',i%10));room.mercyPile=[];room.unoChallengeTargets=[];room.players.forEach((p,i)=>{p.isEliminated=false;p.hasCalledUno=false;room.playerHands[p.id]=[c('extra'+i,'blue','number',8),c('other'+i,'green','number',9)];});room.playerHands[ids[0]]=[c('play',type.startsWith('wild')?'wild':'red',type,value),c('extra0','blue','number',8)];room.players.forEach(p=>p.cardCount=room.playerHands[p.id].length);rm.resetTurnTimer(room);}
async function send(cdp,type,data={}){await cdp.evaluate(`window.app.send(${JSON.stringify({type,data})})`);await wait(100);}
function conserve(room){const all=[...Object.values(room.playerHands).flat(),...room.drawPile,...room.discardPile,...room.mercyPile];assert(all.length===168&&new Set(all.map(c=>c.id)).size===168,'Card conservation');}
try{
 for(let i=0;i<6;i++){const {cdp}=await createBrowserSession('NoMercy'+i);sessions.push(cdp);await cdp.navigate(url);await cdp.waitForFunction('()=>!!window.app');}
 for(const n of [2,3,4,6]){
  const created=rm.createRoom('Host','no_mercy'),joined=[created];for(let i=1;i<n;i++)joined.push({...rm.joinRoom(created.roomId,'Player'+i),roomId:created.roomId});
  for(let i=0;i<n;i++){await sessions[i].evaluate(`if(window.app.ws){window.app.ws.onclose=null;window.app.ws.close();}Object.assign(window.app,${JSON.stringify(joined[i])});window.app.connectWebSocket(window.app.roomId,window.app.playerId,window.app.sessionToken,'Player')`);}
  await wait(250);rm.startGame(created.roomId,created.playerId);const room=rm.getRoom(created.roomId);await sync(room);let actions=0;
  while(!process.env.NO_MERCY_INTERACTIONS_ONLY&&room.status==='playing'&&actions++<2000){const index=room.currentTurn,cdp=sessions[index],id=room.players[index].id;const view=rm.getClientView(room.roomId,id);if(room.pendingAction)await send(cdp,'choose_color',{chosenColor:'red'});else if(view.canPlayCards.length){const cardId=view.canPlayCards[Math.floor(Math.random()*view.canPlayCards.length)];await send(cdp,'play_card',{cardId,chosenColor:'red',targetPlayerId:room.players.find(p=>p.id!==id&&!p.isEliminated)?.id});}else await send(cdp,'draw_card');conserve(room);for(let i=0;i<n;i++){await sessions[i].waitForFunction(`()=>app.gameState.actionVersion===${room.actionVersion}`);const observed=await sessions[i].evaluate('({turn:app.gameState.currentTurn,version:app.gameState.actionVersion,counts:app.gameState.players.map(p=>p.cardCount),hand:app.clientView.myHand.map(c=>c.id)})');assert(observed.turn===room.currentTurn&&observed.version===room.actionVersion,`Multiplayer turn/version sync n=${n}, client=${i}, action=${actions}: ${JSON.stringify(observed)} expected=${room.currentTurn}/${room.actionVersion}`);assert(JSON.stringify(observed.counts)===JSON.stringify(room.players.map(p=>p.cardCount)),'Multiplayer count sync');assert(JSON.stringify(observed.hand)===JSON.stringify(room.playerHands[room.players[i].id].map(c=>c.id)),'Private hand sync');}}
  if(!process.env.NO_MERCY_INTERACTIONS_ONLY)assert(room.status==='game_over','Complete game');report.push({players:n,actions,winner:room.winnerId});console.log(report.at(-1));
 }
 if(!process.env.NO_MERCY_MATCHES_ONLY){
 const fresh=rm.createRoom('Interaction host','no_mercy'),freshPlayers=[fresh];for(let i=1;i<6;i++)freshPlayers.push({...rm.joinRoom(fresh.roomId,'Player'+i),roomId:fresh.roomId});
 for(let i=0;i<6;i++)await sessions[i].evaluate(`if(app.ws){app.ws.onclose=null;app.ws.close();}Object.assign(app,${JSON.stringify(freshPlayers[i])});app.connectWebSocket(app.roomId,app.playerId,app.sessionToken,'Interaction player')`);
 await wait(300);rm.startGame(fresh.roomId,fresh.playerId);await sync(rm.getRoom(fresh.roomId));
 const first=await sessions[0].evaluate('({roomId:app.roomId,playerId:app.playerId})');const room=rm.getRoom(first.roomId),ids=room.players.map(p=>p.id);
 console.log('Starting pointer interactions');
 for(const touch of [false,true]){
 console.log('Pointer mode',touch);
  await sessions[0].send('Page.bringToFront');await sessions[0].send('Emulation.setDeviceMetricsOverride',{width:touch?390:1366,height:touch?844:768,deviceScaleFactor:touch?3:1,mobile:touch});await sessions[0].send('Emulation.setTouchEmulationEnabled',{enabled:touch});
  fixture(room,ids);await sync(room);await drag(sessions[0],touch,false);assert(room.topDiscard.id==='top',`Invalid drop mutated game: ${room.topDiscard.id}`);await drag(sessions[0],touch,true);assert(room.topDiscard.id==='play','Drag did not play');
  fixture(room,ids);await sync(room);if(touch){const p=await rect(sessions[0],'[data-card-id="play"]');await sessions[0].send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await sessions[0].send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(200);}else await click(sessions[0],'[data-card-id="play"]');assert(room.topDiscard.id==='play','Single click/tap did not play');
  report.push({interaction:touch?'touch tap/drag':'mouse click/drag',passed:true});
 }
 fixture(room,ids);await sync(room);await sessions[0].send('Emulation.setTouchEmulationEnabled',{enabled:false});await sessions[0].evaluate(`document.querySelector('[data-card-id="play"]').focus()`);await sessions[0].send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await sessions[0].send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await wait(200);assert(room.topDiscard.id==='play','Keyboard play');report.push({interaction:'Keyboard Enter play',passed:true});
 fixture(room,ids,'wild_color_roulette');await sync(room);await send(sessions[0],'play_card',{cardId:'play'});assert(room.pendingAction?.targetPlayerId===ids[1],'Roulette target');assert(await sessions[1].evaluate('document.querySelector("#colorPickerModal").classList.contains("active")'),'Victim picker not open');assert(!await sessions[0].evaluate('document.querySelector("#colorPickerModal").classList.contains("active")'),'Offender picker visible');await click(sessions[1],'[data-color="red"]');assert(!room.pendingAction,'Roulette unresolved');report.push({interaction:'Victim-selected Roulette',passed:true});
 fixture(room,ids,'number',7);await sync(room);await click(sessions[0],'[data-card-id="play"]');await click(sessions[0],`[data-player-id="${ids[1]}"]`);assert(room.playerHands[ids[1]].some(c=>c.id==='extra0'),'Swap modal');

 for (const [type,value] of [['skip'],['reverse'],['skip_everyone'],['discard_all'],['number',0],['draw2'],['draw4'],['wild_reverse_draw4'],['wild_draw6'],['wild_draw10']]) {
  fixture(room,ids,type,value);await sync(room);await click(sessions[0],'[data-card-id="play"]');
  if(type.startsWith('wild')) await click(sessions[0],'[data-color="red"]');
  assert(room.topDiscard.id==='play',`Special card failed: ${type}`);
  assert(room.discardPile.at(-1).id==='play','Discard top mismatch');
  for(let i=0;i<6;i++)await sessions[i].waitForFunction(`()=>app.gameState.topDiscard.id==='play'`);
  report.push({special:type,value,passed:true});
 }
 fixture(room,ids);room.playerHands[ids[0]]=[c('unplayable','blue','number',8)];room.drawPile=[c('unmatch','yellow','number',2),c('drawn','red','number',5)];await sync(room);await click(sessions[0],'#drawPileBtn');assert(room.turnDrawnCardId==='drawn','Browser drawn identity');await click(sessions[0],'[data-card-id="drawn"]');assert(room.topDiscard.id==='drawn','Browser mandatory drawn play');report.push({interaction:'Draw until exact playable card',passed:true});
 fixture(room,ids);await sync(room);await click(sessions[0],'#btnUnoAction');assert(room.players[0].hasCalledUno,'UNO button');await click(sessions[0],'[data-card-id="play"]');assert(!room.unoChallengeWindow,'Declared UNO still catchable');
 fixture(room,ids);await sync(room);await click(sessions[0],'[data-card-id="play"]');await sessions[1].send('Page.bringToFront');await click(sessions[1],'#btnCatchAction');assert(room.playerHands[ids[0]].length===3,'Browser CAUGHT');report.push({interaction:'Call UNO and CAUGHT',passed:true});
 fixture(room,ids);await sync(room);const version=room.actionVersion;rm.handleTurnTimeout(room.roomId,room.currentTurn,version,room.turnTimerGeneration);await sync(room);assert(room.topDiscard.id==='play','Timeout mandatory play');report.push({interaction:'Authoritative timer callback',passed:true});
 fixture(room,ids);await sync(room);const before=room.playerHands[ids[0]].map(c=>c.id).join(',');await sessions[0].send('Page.bringToFront');const dragStart=await rect(sessions[0],'[data-card-id="play"]');await mouse(sessions[0],'mousePressed',dragStart.x,dragStart.y);await mouse(sessions[0],'mouseMoved',dragStart.x+30,dragStart.y-50);assert(await sessions[0].evaluate('!!document.querySelector(".classic-drag-ghost")'),'Reconnect drag did not start');await sessions[0].evaluate('app.ws.close()');await wait(150);assert(!await sessions[0].evaluate('!!document.querySelector(".classic-drag-ghost")'),'Disconnect left drag ghost');await sessions[0].evaluate('app.send({type:"draw_card"})');await mouse(sessions[0],'mouseReleased',dragStart.x+30,dragStart.y-50);await sessions[0].waitForFunction('()=>app.ws?.readyState===WebSocket.OPEN',6000);await sessions[0].waitForFunction('()=>!document.querySelector("#playerHandCards").hasAttribute("inert")');assert(room.playerHands[ids[0]].map(c=>c.id).join(',')===before,'Reconnect changed hand');assert(await sessions[0].evaluate('app.playerId')===ids[0],'Reconnect changed player identity');report.push({interaction:'Session reconnection restores hand',passed:true});
 // Responsive evidence with six seats and a 24-card hand.
 fixture(room,ids);room.playerHands[ids[0]]=Array.from({length:24},(_,i)=>c('large'+i,['red','yellow','green','blue'][i%4],i<10?'number':['draw2','draw4','skip','reverse','discard_all','skip_everyone'][i%6],i%10));room.players[0].cardCount=24;await sync(room);clearTimeout(rm.turnTimers.get(room.roomId));
 for(const [width,height] of [[360,800],[390,844],[412,915],[430,932],[768,1024],[1366,768],[1920,1080],[844,390]]){await sessions[0].send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:width<600?3:1,mobile:width<600});await sessions[0].evaluate('app.renderArena()');await wait(150);const shot=await sessions[0].send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${out}/${width}x${height}.png`,Buffer.from(shot.data,'base64'));report.push({viewport:`${width}x${height}`,overflow:await sessions[0].evaluate('document.documentElement.scrollWidth>innerWidth'),cards:await sessions[0].evaluate('document.querySelectorAll("#playerHandCards .nm-vector-face").length')});}
 assert(await sessions[0].evaluate('app.clientView.myHand.length')===24,'Large hand screenshot lost identity');
 await sessions[0].evaluate(`(async()=>{app.ws.onmessage=null;const {createNoMercyDeck}=await import('/shared/deck.js');const {renderCardHTML,renderCardBackHTML}=await import('/cardGraphics.js');document.body.innerHTML='<div id="sheet" style="display:grid;grid-template-columns:repeat(12,120px);gap:12px;background:#254c40;padding:20px"></div>';document.querySelector('#sheet').innerHTML=[...new Map(createNoMercyDeck().map(c=>[c.color+':'+c.type+':'+c.value,c])).values()].map(c=>'<div style="width:120px;height:180px">'+renderCardHTML(c,{mode:'no_mercy'})+'</div>').join('')+renderCardBackHTML(false,false,'no_mercy');})()`);await sessions[0].send('Emulation.setDeviceMetricsOverride',{width:1620,height:1600,deviceScaleFactor:1,mobile:false});const sheet=await sessions[0].send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${out}/card-contact-sheet.png`,Buffer.from(sheet.data,'base64'));
 }
 console.log(JSON.stringify(report,null,2));
}catch(e){report.push({error:e.stack});throw e;}finally{fs.writeFileSync(`${out}/${process.env.NO_MERCY_MATCHES_ONLY ? 'results-matches' : process.env.NO_MERCY_INTERACTIONS_ONLY ? 'results-interactions' : 'results'}.json`,JSON.stringify(report,null,2));sessions.forEach(c=>c.close());chrome.kill();wss.clients.forEach(ws=>ws.terminate());for(const t of rm.turnTimers.values())clearTimeout(t);await new Promise(r=>server.close(r));}
