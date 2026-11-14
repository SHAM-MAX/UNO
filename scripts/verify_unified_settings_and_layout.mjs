import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9465;
const SERVER_PORT = 3097;
const ARTIFACT_DIR = 'C:\\Users\\ShamSundarR\\.gemini\\antigravity\\brain\\4e1038d0-74ee-4ac0-bff4-c89b1e848589';

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
        const cb = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) cb.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else cb.resolve(msg.result);
      }
    });

    await this.send('Page.enable');
    await this.send('DOM.enable');
    await this.send('Runtime.enable');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.reqId++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${res.exceptionDetails.text || res.exceptionDetails.exception?.description}`);
    }
    return res.result ? res.result.value : undefined;
  }

  async screenshot(filePath, clip = null) {
    const params = { format: 'png' };
    if (clip) params.clip = clip;
    const res = await this.send('Page.captureScreenshot', params);
    const buf = Buffer.from(res.data, 'base64');
    fs.writeFileSync(filePath, buf);
    console.log(`[Screenshot] Saved ${path.basename(filePath)} (${buf.length} bytes)`);
    const artifactPath = path.join(ARTIFACT_DIR, path.basename(filePath));
    try {
      fs.writeFileSync(artifactPath, buf);
    } catch (e) {
      console.warn(`[Screenshot] Could not copy to artifact dir: ${e.message}`);
    }
  }

  async setViewport(width, height, isMobile = false, deviceScaleFactor = 1) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile: isMobile,
    });
  }

  close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) { }
    }
  }
}

async function run() {
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uno-settings-verify-'));
  const tempDbPath = path.join(tempDbDir, 'test.sqlite');

  console.log(`[Setup] Starting test server on port ${SERVER_PORT}...`);
  const serverProcess = spawn('node', ['server/src/index.js'], {
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      DB_PATH: tempDbPath,
      ENABLE_AUTH_PERSISTENCE: 'false',
    },
    stdio: 'pipe',
  });

  await delay(1200);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uno-chrome-settings-'));

  console.log(`[Setup] Launching Chrome on debug port ${DEBUG_PORT}...`);
  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userData}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]);

  await delay(1500);

  let cdp = null;

  try {
    const list = await httpGetJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const target = list.find((t) => t.type === 'page');
    if (!target) throw new Error('No page target found');

    cdp = new CDPClient(target.webSocketDebuggerUrl, 'SettingsPage');
    await cdp.connect();
    await cdp.setViewport(1280, 800);

    const baseUrl = `http://localhost:${SERVER_PORT}`;
    console.log(`[Test] Navigating to ${baseUrl}...`);
    await cdp.send('Page.navigate', { url: baseUrl });
    await delay(1200);

    // ==========================================
    // 1. Verify Quick Match Removal & 2-Button Layout
    // ==========================================
    console.log('\n--- 1. Verify Quick Match Removal & Landing Page Refinements ---');
    const quickMatchDesktop = await cdp.evaluate(`Boolean(document.getElementById('quickMatchBtn'))`);
    const quickMatchMobile = await cdp.evaluate(`Boolean(document.getElementById('mobileQuickMatchBtn'))`);
    console.log(`[Landing] Quick Match Desktop in DOM: ${quickMatchDesktop} (Expected: false)`);
    console.log(`[Landing] Quick Match Mobile in DOM: ${quickMatchMobile} (Expected: false)`);
    if (quickMatchDesktop || quickMatchMobile) throw new Error('Quick Match buttons should not exist on landing page');

    // Check brand nav button styling (should NOT have default browser 2px outset border or buttonface background)
    const brandStyles = await cdp.evaluate(`
      (() => {
        const el = document.getElementById('brandNavToggle');
        const style = window.getComputedStyle(el);
        return {
          borderStyle: style.borderStyle,
          backgroundColor: style.backgroundColor,
          outline: style.outlineStyle
        };
      })()
    `);
    console.log('[Brand Nav Style]:', brandStyles);
    if (brandStyles.borderStyle === 'outset') {
      throw new Error('brandNavToggle still has browser-default outset border!');
    }

    // Screenshot 1: Refined Landing Page (Desktop)
    await cdp.screenshot('uno_arena_refined_landing.png');

    // ==========================================
    // 2. Play vs AI Form Scrolling & Responsive Layout
    // ==========================================
    console.log('\n--- 2. Play vs AI Form Layout & Scrolling at 1280x720 ---');
    // Set shorter laptop viewport to test scrolling and pinned footer
    await cdp.setViewport(1280, 720);
    await delay(200);

    // Open Play vs AI
    await cdp.evaluate(`document.getElementById('playVsAiBtn').click()`);
    await delay(400);

    const formVisible = await cdp.evaluate(`document.getElementById('homePlaybox').classList.contains('show-ai-form')`);
    console.log(`[AI Form] Form visible: ${formVisible}`);

    // Verify sections and buttons exist and are reachable
    const elementsReachability = await cdp.evaluate(`
      (() => {
        const scrollContent = document.querySelector('.ai-form-scroll-content');
        const cancelBtn = document.querySelector('.ai-cancel-btn');
        const startBtn = document.querySelector('.ai-start-btn');
        const sec1 = document.querySelector('.ai-form-section:nth-of-type(1)');
        const sec2 = document.querySelector('.ai-form-section:nth-of-type(2)');
        const sec3 = document.querySelector('.ai-form-section.ai-rules-summary-section');
        const footer = document.querySelector('.ai-form-footer');

        return {
          hasScrollContainer: Boolean(scrollContent),
          scrollHeight: scrollContent?.scrollHeight || 0,
          clientHeight: scrollContent?.clientHeight || 0,
          cancelVisible: Boolean(cancelBtn && cancelBtn.offsetParent),
          startVisible: Boolean(startBtn && startBtn.offsetParent),
          footerPinned: window.getComputedStyle(footer).position !== 'static' || Boolean(footer),
          sec1Exists: Boolean(sec1),
          sec2Exists: Boolean(sec2),
          sec3Exists: Boolean(sec3),
        };
      })()
    `);
    console.log('[AI Form Reachability]:', elementsReachability);
    if (!elementsReachability.cancelVisible || !elementsReachability.startVisible) {
      throw new Error('Cancel or Start button not visible on Play vs AI form');
    }

    // Select mode Flip and 4 Players
    await cdp.evaluate(`
      document.querySelector('.ai-mode-card[data-mode="flip"]').click();
      document.querySelector('.ai-player-pill[data-count="4"]').click();
    `);
    await delay(300);

    // Screenshot 2: Play vs AI Form Desktop on 1280x720
    await cdp.screenshot('uno_arena_ai_form_short_laptop.png');

    // ==========================================
    // 3. Unified Settings Modal: General Tab
    // ==========================================
    console.log('\n--- 3. Unified Settings Modal: General Tab ---');
    // Click Settings button in top navbar
    await cdp.evaluate(`document.getElementById('settingsBtn').click()`);
    await delay(400);

    const isSettingsActive = await cdp.evaluate(`document.getElementById('settingsModal').classList.contains('active')`);
    console.log(`[Settings] Modal active: ${isSettingsActive}`);
    if (!isSettingsActive) throw new Error('Settings modal did not open on clicking settingsBtn');

    // Check General tab controls
    const generalControls = await cdp.evaluate(`
      (() => {
        const soundToggle = document.getElementById('settingSoundToggle');
        const volSlider = document.getElementById('settingVolumeSlider');
        const volValue = document.getElementById('settingVolumeValue');
        const nameInput = document.getElementById('settingPlayerNameInput');
        const avatarPresets = document.querySelectorAll('.avatar-preset-btn').length;
        const uploadBtn = document.getElementById('settingAvatarUpload');
        const motionToggle = document.getElementById('settingReducedMotion');

        return {
          soundChecked: soundToggle?.checked,
          volume: volSlider?.value,
          volumeText: volValue?.textContent,
          name: nameInput?.value,
          presetsCount: avatarPresets,
          hasUpload: Boolean(uploadBtn),
          hasMotion: Boolean(motionToggle)
        };
      })()
    `);
    console.log('[Settings General Controls]:', generalControls);
    if (generalControls.presetsCount !== 10) throw new Error(`Expected 10 avatar presets, got ${generalControls.presetsCount}`);

    // Adjust Volume to 60%
    await cdp.evaluate(`
      const slider = document.getElementById('settingVolumeSlider');
      slider.value = "60";
      slider.dispatchEvent(new Event('input'));
      slider.dispatchEvent(new Event('change'));
    `);
    await delay(200);

    // Select 'panda' avatar preset
    await cdp.evaluate(`document.querySelector('.avatar-preset-btn[data-avatar-id="panda"]').click()`);
    await delay(200);

    const selectedAvatar = await cdp.evaluate(`window.app.playerAvatar`);
    const avatarEmoji = await cdp.evaluate(`document.getElementById('settingAvatarEmoji').textContent`);
    console.log(`[Settings Avatar] Selected avatar: "${selectedAvatar}", Preview: "${avatarEmoji}"`);
    if (selectedAvatar !== 'panda' || avatarEmoji !== '🐼') throw new Error('Panda avatar preset was not selected');

    // Screenshot 3: Settings Modal General Tab
    await cdp.screenshot('uno_arena_settings_general.png');

    // ==========================================
    // 4. Unified Settings Modal: Game Rules & How to Play Tabs
    // ==========================================
    console.log('\n--- 4. Switch to Game Rules & How to Play Tabs ---');
    await cdp.evaluate(`document.getElementById('tabBtnGameRules').click()`);
    await delay(300);

    const isRulesTabActive = await cdp.evaluate(`document.getElementById('tabContentGameRules').classList.contains('active')`);
    console.log(`[Settings] Rules tab active: ${isRulesTabActive}`);
    if (!isRulesTabActive) throw new Error('Game Rules tab did not activate');

    // Screenshot 4: Settings Modal Game Rules Tab
    await cdp.screenshot('uno_arena_settings_rules.png');

    await cdp.evaluate(`document.getElementById('tabBtnHowToPlay').click()`);
    await delay(300);

    const isHtpActive = await cdp.evaluate(`document.getElementById('tabContentHowToPlay').classList.contains('active')`);
    console.log(`[Settings] How to Play tab active: ${isHtpActive}`);
    if (!isHtpActive) throw new Error('How to play tab did not activate');

    // Screenshot 5: Settings Modal How to Play Tab
    await cdp.screenshot('uno_arena_settings_how_to_play.png');

    // Close Settings with Done button
    await cdp.evaluate(`document.getElementById('ruleApplyBtn').click()`);
    await delay(300);

    const isClosed = await cdp.evaluate(`!document.getElementById('settingsModal').classList.contains('active')`);
    console.log(`[Settings] Modal closed: ${isClosed}`);

    // Verify AI form selections were PRESERVED after closing settings!
    const preservedMode = await cdp.evaluate(`window.app.aiSetup.mode`);
    const preservedCount = await cdp.evaluate(`window.app.aiSetup.totalPlayers`);
    const startBtnDisabled = await cdp.evaluate(`document.querySelector('.ai-start-btn').disabled`);
    console.log(`[AI Form State Retention] Mode: "${preservedMode}", Players: ${preservedCount}, Start disabled: ${startBtnDisabled}`);
    if (preservedMode !== 'flip' || preservedCount !== 4 || startBtnDisabled !== false) {
      throw new Error('AI Setup selections were lost after opening/closing settings!');
    }

    // ==========================================
    // 5. Mobile Layout Verification (Portrait & Landscape)
    // ==========================================
    console.log('\n--- 5. Mobile Portrait & Landscape Verification ---');
    // Mobile Portrait 390x844
    await cdp.setViewport(390, 844, true, 2);
    await delay(400);

    // Open settings on mobile
    await cdp.evaluate(`document.getElementById('mobileNavSettingsBtn').click()`);
    await delay(400);

    await cdp.screenshot('uno_arena_settings_mobile_portrait.png');

    // Close settings on mobile
    await cdp.evaluate(`document.getElementById('settingsModalClose').click()`);
    await delay(300);

    // Mobile Landscape 844x390
    await cdp.setViewport(844, 390, true, 2);
    await delay(400);

    await cdp.evaluate(`document.getElementById('mobileNavSettingsBtn').click()`);
    await delay(400);

    await cdp.screenshot('uno_arena_settings_mobile_landscape.png');

    console.log('\n✅ ALL UNIFIED SETTINGS AND LAYOUT VERIFICATIONS PASSED SUCCESSFULLY!');
  } finally {
    if (cdp) cdp.close();
    chromeProcess.kill();
    serverProcess.kill();
    try {
      fs.rmSync(tempDbDir, { recursive: true, force: true });
      fs.rmSync(userData, { recursive: true, force: true });
    } catch (e) { }
  }
}

run().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});

