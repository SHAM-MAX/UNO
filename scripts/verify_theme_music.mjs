import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9596;
const ARTIFACT_DIR = path.resolve('scratch/mode-entrance');

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

async function main() {
  console.log('=== Starting Verification for Room Entry & Mode Selection Flows ===');
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uno-mobile-test-'));
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const { server } = await import('../server/src/index.js');
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  const baseUrl = process.env.ENTRANCE_TEST_URL || `http://localhost:${port}`;
  console.log(`Server running at ${baseUrl}`);

  const { proc: chromeProc, tempDir } = await startHeadlessChrome();
  console.log('Headless Chrome ready.');

  try {
    const { cdp } = await createBrowserSession('Primary');

    // -------------------------------------------------------------
    // Test 1: Direct Create Room -> Lobby with 3 Mode Choices
    // -------------------------------------------------------------
    console.log('\n--- 1. Testing Direct Create Room -> Lobby with 3 Mode Choices ---');
    await cdp.setViewport(1280, 800, false);
    console.log('Set viewport, navigating to baseUrl...');
    if (process.env.ENTRANCE_SLOW_NETWORK) {
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:300,downloadThroughput:600000,uploadThroughput:600000});
    }
    await cdp.navigate(baseUrl);
    console.log('Navigated to baseUrl, waiting for window.app...');
    await cdp.waitForFunction(() => window.app !== undefined && window.app.el !== undefined, 60000);
    console.log('window.app is loaded and ready.');
    await cdp.screenshot(path.join(ARTIFACT_DIR, 'tabletop_brand_landing.png'));





    await cdp.evaluate(async()=>{window.themeTest=(await import('/music.js')).music;});
    if(!await cdp.evaluate(()=>!window.themeTest.unlocked&&window.themeTest.voices.size===0))throw Error('Music autoplayed before interaction');
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:15,y:25,button:'left',clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:15,y:25,button:'left',clickCount:1});
    await cdp.waitForFunction(()=>window.themeTest.voices.size===1,20000);
    const audio=await cdp.evaluate(async()=>{
      const b=await window.themeTest.cache.get('warm'),data=b.getChannelData(0);let peak=0,energy=0;
      for(let i=0;i<data.length;i++){peak=Math.max(peak,Math.abs(data[i]));energy+=data[i]*data[i];}
      return {duration:b.duration,peak,rms:Math.sqrt(energy/data.length),channels:b.numberOfChannels,first:data[0],last:data[data.length-1]};
    });console.log('Theme audio',audio);
    if(audio.duration<45||audio.duration>60||audio.peak>=1||audio.rms<.005||audio.first!==0||audio.last!==0)throw Error('Loop audio invalid');

    if(process.env.MUSIC_PREVIEW_PATH){
      const wav=await cdp.evaluate(async()=>{
        const audio=await window.themeTest.cache.get('warm'),frames=Math.min(audio.length,Math.floor(audio.sampleRate*18.46)),channels=2,bytes=new ArrayBuffer(44+frames*channels*2),view=new DataView(bytes);
        const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
        text(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,audio.sampleRate,true);view.setUint32(28,audio.sampleRate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,frames*channels*2,true);
        const left=audio.getChannelData(0),right=audio.getChannelData(1);
        for(let i=0;i<frames;i++){const fade=Math.min(1,(frames-1-i)/2400);view.setInt16(44+i*4,Math.max(-1,Math.min(1,left[i]*fade))*32767,true);view.setInt16(46+i*4,Math.max(-1,Math.min(1,right[i]*fade))*32767,true);}
        const raw=new Uint8Array(bytes);let binary='';for(let i=0;i<raw.length;i+=8192)binary+=String.fromCharCode(...raw.subarray(i,i+8192));return btoa(binary);
      });
      fs.mkdirSync(path.dirname(process.env.MUSIC_PREVIEW_PATH),{recursive:true});fs.writeFileSync(process.env.MUSIC_PREVIEW_PATH,Buffer.from(wav,'base64'));console.log('Saved theme preview');
    }
    for(const mode of ['flip','no_mercy']){
      await cdp.evaluate(new Function(`window.app.openModeSetup('${mode}')`));
      await cdp.waitForFunction(new Function(`return window.themeTest.currentStyle==='${mode==='flip'?'flip':'mercy'}'`),20000);
      await delay(1100);
      if(!await cdp.evaluate(()=>window.themeTest.voices.size===1&&window.themeTest.cache.size<=2))throw Error('Mode crossfade leaked sources');
    }
    await cdp.evaluate(()=>window.themeTest.setScene('lobby'));await cdp.waitForFunction(()=>window.themeTest.currentStyle==='warm',20000);
    const other=await createBrowserSession('Background-check');await other.cdp.navigate(baseUrl);await other.cdp.send('Page.bringToFront');
    await cdp.waitForFunction(()=>document.hidden);
    if(!await cdp.evaluate(()=>window.themeTest.voices.size===0))throw Error('Background tab still playing');
    await cdp.send('Page.bringToFront');await cdp.waitForFunction(()=>window.themeTest.voices.size===1,20000);other.cdp.close();
    await cdp.evaluate(()=>window.app.openSettingsModal());
    await cdp.evaluate(()=>{const n=document.getElementById('settingMusicToggle');n.checked=false;n.dispatchEvent(new Event('change'));});
    if(!await cdp.evaluate(()=>!window.themeTest.enabled&&window.themeTest.voices.size===0&&localStorage.getItem('uno_music_enabled')==='false'))throw Error('Music mute failed');
    await cdp.evaluate(async()=>{const {sounds}=await import('/audio.js');sounds.setVolume(.71);sounds.setEnabled(false);window.themeTest.setVolume(.19);if(sounds.getVolume()!==.71||sounds.isEnabled())throw Error('Music affected effects settings');});
    await cdp.evaluate(()=>{window.themeTest.setVolume(0);window.themeTest.setEnabled(true);});
    if(!await cdp.evaluate(()=>window.themeTest.voices.size===0))throw Error('Zero music volume ignored');
    await cdp.evaluate(()=>window.themeTest.setVolume(.22));await cdp.waitForFunction(()=>window.themeTest.voices.size===1,20000);
    await cdp.setViewport(390,844,true);await cdp.screenshot(path.join(ARTIFACT_DIR,'music-settings-mobile.png'));
    console.log('PASS original 55-second loop, no clipping, gesture unlock, mode crossfades, bounded sources/cache, background pause/resume and independent persisted controls');cdp.close();
  } finally {
    chromeProc.kill();
    server.close();

  }
}

main().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
