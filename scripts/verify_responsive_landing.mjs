import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9222;

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

  async waitForFunction(fnStr, timeout = 30000) {
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
      '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
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



import assert from 'node:assert/strict';

import {execFileSync} from 'node:child_process';
const MOBILE='(max-width: 640px), (hover: none) and (pointer: coarse) and (max-width: 1024px)';
const DESKTOP='(min-width: 641px) and (hover: hover) and (pointer: fine)';
const original=new Map([['/',execFileSync('git',['show','4ca00fb:client/index.html'])],['/home.css',execFileSync('git',['show','4ca00fb:client/home.css'])]]);
const baseline=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(original.has(p)){res.setHeader('Content-Type',p.endsWith('.css')?'text/css':'text/html');res.end(original.get(p));}else{const r=await fetch('http://localhost:3001'+req.url);res.statusCode=r.status;res.setHeader('Content-Type',r.headers.get('content-type')||'application/octet-stream');res.end(Buffer.from(await r.arrayBuffer()));}}catch(e){res.statusCode=500;res.end(e.message)}});
async function run(){await new Promise(r=>baseline.listen(0,'127.0.0.1',r));const ref='http://127.0.0.1:'+baseline.address().port+'/';const {proc}=await startHeadlessChrome();const {cdp:a}=await createBrowserSession('responsive');fs.mkdirSync('scratch/responsive-restore',{recursive:true});
const load=async url=>{await resetBrowserPage(a,url);await a.send('Page.bringToFront');await a.evaluate('document.fonts.ready');await a.waitForFunction('()=>[...document.images].filter(i=>i.getClientRects().length).every(i=>i.complete)');await a.evaluate('const stop=document.createElement("style");stop.textContent="*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";document.head.append(stop)');};
const image=async name=>{await a.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const r=await a.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync('scratch/responsive-restore/'+name+'.png',Buffer.from(r.data,'base64'));return r.data};
try{
for(const [screenW,screenH]of [[1366,768],[1920,1080]])for(const zoom of [1,1.25,1.5,2]){
// Browser zoom changes the CSS viewport and device pixel ratio together.
const width=Math.round(screenW/zoom),height=Math.round(screenH/zoom);await a.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:zoom,mobile:false});await a.send('Emulation.setTouchEmulationEnabled',{enabled:false});
await load(ref);const before=await image('original-'+screenW+'-zoom-'+Math.round(zoom*100));await load('http://localhost:3001/');
const check=await a.evaluate('({desktop:matchMedia('+JSON.stringify(DESKTOP)+').matches,mobile:matchMedia('+JSON.stringify(MOBILE)+').matches,overflow:document.documentElement.scrollWidth>innerWidth,src:[...document.querySelectorAll(".home-modes img")].map(i=>i.currentSrc.split("/").pop()),fit:getComputedStyle(document.querySelector(".home-modes img")).objectFit,display:getComputedStyle(document.querySelector(".mobile-landing-container")).display})');
assert.ok(check.desktop);assert.equal(check.mobile,false);assert.equal(check.overflow,false);assert.equal(check.display,'none');assert.deepEqual(check.src,['classic-reference.png','flip-reference.png','no-mercy-reference.png']);assert.notEqual(check.fit,'contain');const after=await image('desktop-'+screenW+'-zoom-'+Math.round(zoom*100));assert.ok(after===before,'Original desktop pixel mismatch at '+screenW+' '+zoom);console.log('Desktop restored',screenW,screenH,zoom,JSON.stringify(check));
for(const mode of ['classic','flip','no_mercy']){await a.evaluate('document.querySelector(".home-modes [data-home-mode=\\"'+mode+'\\"]").click()');assert.equal(await a.evaluate('window.app.preferredMode'),mode);await a.evaluate('window.app.showModePicker()');}
}
for(const file of ['index.html','home.css','mobile.css'])original.set(file==='index.html'?'/':'/'+file,execFileSync('git',['show','f5848fb:client/'+file]));
for(const [width,height]of [[360,800],[390,844],[412,915],[768,1024],[1024,600]]){await a.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await a.send('Emulation.setTouchEmulationEnabled',{enabled:true});let beforeMobile;if(width<=640){await load(ref);beforeMobile=await image('mobile-redesign-reference-'+width);}await load('http://localhost:3001/');const check=await a.evaluate('({desktop:matchMedia('+JSON.stringify(DESKTOP)+').matches,mobile:matchMedia('+JSON.stringify(MOBILE)+').matches,overflow:document.documentElement.scrollWidth>innerWidth,display:getComputedStyle(document.querySelector(".mobile-landing-container")).display,src:[...document.querySelectorAll(".mobile-modes-wrap img")].map(i=>i.currentSrc.split("/").pop())})');assert.equal(check.desktop,false);assert.ok(check.mobile);assert.equal(check.overflow,false);assert.equal(check.display,'flex');assert.deepEqual(check.src,['classic-card.png','flip-card.png','no-mercy-card.png']);const mobileImage=await image('mobile-'+width+'x'+height);if(beforeMobile)assert.ok(mobileImage===beforeMobile,'Mobile redesign pixels changed at '+width);console.log('Mobile preserved',width,height,JSON.stringify(check));for(const id of ['mobileModeClassicBtn','mobileModeFlipBtn','mobileModeMercyBtn']){await a.evaluate('document.querySelector("#'+id+'").click()');assert.ok(await a.evaluate('!document.querySelector("#modeSetupSection").hidden'));await a.evaluate('window.app.showModePicker()');}}
console.log('PASS historical desktop pixels, zoom matrix, mobile/coarse selection, overflow, and all mode buttons');
}finally{a.close();proc.kill();baseline.close();}}
run().catch(e=>{console.error(e);process.exitCode=1;baseline.close()});
