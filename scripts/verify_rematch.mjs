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
process.env.NODE_ENV='test';process.env.DATA_DIR='scratch/rematch-browser-db';
const {server,wss,roomManager:rm}=await import('../server/src/index.js');await new Promise(r=>server.listen(3008,r));
const {proc:chrome}=await startHeadlessChrome();const sessions=[],results=[];const wait=ms=>new Promise(r=>setTimeout(r,ms));fs.mkdirSync('scratch/rematch-verification',{recursive:true});
const ok=(value,message)=>{if(!value)throw Error(message);};
async function press(cdp,selector){await cdp.send('Page.bringToFront');await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);const p=await rect(cdp,selector);await mouse(cdp,'mousePressed',p.x,p.y);await mouse(cdp,'mouseReleased',p.x,p.y);await wait(160);}
async function shot(cdp,name){await cdp.send('Page.bringToFront');const image=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`scratch/rematch-verification/${name}.png`,Buffer.from(image.data,'base64'));}
async function connect(cdp,credentials){await cdp.evaluate(`Object.assign(window.app,${JSON.stringify(credentials)});window.app.connectWebSocket(window.app.roomId,window.app.playerId,window.app.sessionToken,'Tester')`);await cdp.waitForFunction(`()=>window.app.clientView?.myPlayerId===${JSON.stringify(credentials.playerId)} && window.app.gameState.roomId===${JSON.stringify(credentials.roomId)}`);}
async function sync(cdp){await cdp.evaluate('window.app.send({type:"ready",data:{isReady:true}})');await wait(200);}
async function completed(clients,mode='classic'){
 const host=rm.createRoom('Alice Winner',mode),others=[rm.joinRoom(host.roomId,'Bob Player'),rm.joinRoom(host.roomId,'Cara Player')];const credentials=[host,...others.map(p=>({...p,roomId:host.roomId}))];
 for(let i=0;i<3;i++)await connect(clients[i],credentials[i]);
 rm.startGame(host.roomId,host.playerId);const room=rm.getRoom(host.roomId);Object.assign(room,{status:'game_over',winnerId:host.playerId,winReason:'Alice won the completed match',pendingAction:null});room.players.forEach((p,i)=>p.score=i===0?520:80);rm.resetTurnTimer(room);await sync(clients[0]);await clients[0].waitForFunction('()=>window.app.gameState.status==="game_over"');return {room,id:host.roomId,credentials,ids:credentials.map(p=>p.playerId)};
}
async function propose(cdp){await press(cdp,'#rematchBtn');await cdp.waitForFunction('()=>window.app.clientView.rematchProposal?.status==="responding"');}
async function verifyAcceptedClose(clients) {
 const [a,b,c]=clients,ctx=await completed(clients);await propose(a);
 await press(b,'[data-rematch-response="accept"]');await press(b,'[data-rematch-mode="flip"]');await press(c,'[data-rematch-response="accept"]');
 await press(a,'[data-rematch-mode="classic"]');await press(c,'[data-rematch-mode="classic"]');await press(b,'#rematchCloseBtn');
 await a.waitForFunction('()=>window.app.clientView.rematchProposal.acceptedPlayerIds.length===2');
 await b.waitForFunction('()=>!document.getElementById("rematchProposalModal").classList.contains("active")');
 const p=ctx.room.rematchProposal;ok(p.declinedPlayerIds.includes(ctx.ids[1]) && p.modeVotes[ctx.ids[1]]===undefined,'Accepted close did not withdraw vote');
 await shot(a,'accepted-player-withdrawal');rm.advanceRematch(ctx.id,p.votingDeadline);rm.advanceRematch(ctx.id,p.startAt);
 await b.waitForFunction('()=>window.app.clientView.isSpectator');ok(ctx.room.players.length===2&&!ctx.room.players.some(player=>player.id===ctx.ids[1]),'Withdrawn player started');
 results.push('Accepted player close X records decline, removes their vote, closes their dialog after confirmation and excludes them from the new roster');
}
try{
 for(const [i,origin] of ['localhost','127.0.0.1','[::1]'].entries()){const cdp=(await createBrowserSession(`Rematch ${i}`)).cdp;sessions.push(cdp);await cdp.navigate(`http://${origin}:3008`);await cdp.waitForFunction('()=>!!window.app');await cdp.send('Emulation.setDeviceMetricsOverride',{width:i===2?390:1366,height:i===2?844:768,deviceScaleFactor:1,mobile:i===2});}
 const [a,b,c]=sessions;
 if(process.env.REMATCH_CLOSE_ONLY) await verifyAcceptedClose(sessions);
 else {
 let ctx=await completed(sessions);await propose(a);const proposalId=ctx.room.rematchProposal.id;
 for(const client of sessions)await client.waitForFunction(`()=>window.app.clientView.rematchProposal?.id===${JSON.stringify(proposalId)}`);
 await shot(a,'winner-proposal');await shot(b,'invitation-desktop');await shot(c,'invitation-mobile');
 await press(a,'[data-rematch-mode="flip"]');await press(b,'[data-rematch-response="accept"]');await press(b,'[data-rematch-mode="classic"]');await press(c,'[data-rematch-response="accept"]');await press(c,'[data-rematch-mode="flip"]');
 ok(ctx.room.rematchProposal.status==='voting','Voting phase did not open');await shot(a,'mode-voting');
 // First scenario uses the real shared 30-second voting deadline and automatic server timers.
 await a.waitForFunction('()=>["resolved","started"].includes(window.app.clientView.rematchProposal?.status)',40000);
 ok(ctx.room.rematchProposal.selectedMode==='flip','Incorrect majority mode');await shot(a,'vote-result');
 for(const client of sessions)await client.waitForFunction('()=>window.app.gameState.status==="playing" && window.app.gameState.mode==="flip"');await shot(a,'new-game');results.push('Three real browser/WebSocket clients: winner votes Flip, Bob Classic, Cara Flip; server deadline selects Flip and all start together');
 ctx=await completed(sessions);await propose(a);await press(a,'[data-rematch-mode="classic"]');await press(b,'[data-rematch-response="accept"]');await press(b,'[data-rematch-mode="classic"]');await press(c,'[data-rematch-response="decline"]');await shot(a,'accepted-declined');let p=ctx.room.rematchProposal;rm.advanceRematch(ctx.id,p.votingDeadline);rm.advanceRematch(ctx.id,p.startAt);await c.waitForFunction('()=>window.app.clientView.isSpectator');ok(ctx.room.players.length===2,'Declined player was not excluded');ok(ctx.room.players.every(player=>player.id!==ctx.ids[2]),'Declined identity remained active');results.push('Declined player excluded; same session remains connected as spectator');
 ctx=await completed(sessions);await propose(a);await press(b,'#rematchCloseBtn');ok(ctx.room.rematchProposal.declinedPlayerIds.includes(ctx.ids[1]),'Receiver close did not decline');await press(c,'#rematchCloseBtn');ok(ctx.room.rematchProposal.status==='cancelled','All declines did not cancel');await shot(a,'cancelled-proposal');results.push('Both receiving close buttons decline; nobody accepting cancels and preserves winner/scores');
 ctx=await completed(sessions);await propose(a);await press(b,'[data-rematch-response="accept"]');await press(a,'#rematchCloseBtn');ok(ctx.room.rematchProposal.status==='cancelled','Initiator close did not cancel');for(const client of sessions)await client.waitForFunction('()=>window.app.clientView.rematchProposal?.status==="cancelled"');results.push('Initiator close cancels the proposal on all three clients');
 ctx=await completed(sessions);await c.evaluate('window.app.ws.close()');await c.waitForFunction('()=>window.app.ws.readyState!==1');await propose(a);await press(b,'[data-rematch-response="accept"]');await c.waitForFunction('()=>window.app.ws.readyState===1 && window.app.clientView.rematchProposal?.status==="responding"');await press(c,'[data-rematch-response="accept"]');ok(ctx.room.rematchProposal.acceptedPlayerIds.length===3,'Reconnect lost invitation/response');await shot(c,'reconnected-voting-mobile');results.push('Disconnected participant reconnects with original session, receives pending invitation, accepts and joins voting');
 p=ctx.room.rematchProposal;rm.cancelRematch(ctx.id,ctx.ids[0],{proposalId:p.id});await sync(a);
 // UI scroll/overflow inspection at narrow and desktop sizes.
 ctx=await completed(sessions);await propose(a);for(const [w,h] of [[360,800],[390,844],[412,915],[1366,768],[1920,1080]]){await a.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:w<600});await shot(a,`voting-${w}x${h}`);ok(await a.evaluate('document.getElementById("rematchProposalModal").scrollWidth<=innerWidth'),'Modal horizontal overflow');}
 await verifyAcceptedClose(sessions);
 }
 console.log(JSON.stringify(results,null,2));
}catch(error){results.push({error:error.stack});throw error;}
finally{fs.writeFileSync(process.env.REMATCH_CLOSE_ONLY?'scratch/rematch-verification/close-results.json':'scratch/rematch-verification/results.json',JSON.stringify(results,null,2));sessions.forEach(client=>client.close());chrome.kill();wss.clients.forEach(ws=>ws.terminate());for(const timer of rm.rematchTimers.values())clearTimeout(timer);await new Promise(r=>server.close(r));}
