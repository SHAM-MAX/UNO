// Native install prompts must follow a user click; other browsers get instructions.
let deferredPrompt = null;
let installedThisVisit = false;
let dismissedThisVisit = false;
let ready = false;
const standalone = matchMedia('(display-mode: standalone)');
const fullscreen = matchMedia('(display-mode: fullscreen)');
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const banner = document.createElement('aside');
banner.id = 'installSuggestion';
banner.hidden = true;
banner.setAttribute('aria-label', 'Install UNO Arena');
banner.innerHTML = `<img src="./assets/uno-brand-v4-192.png" alt="" width="44" height="44">
  <div class="install-copy"><strong>Keep UNO one tap away</strong><p id="installSuggestionText">Add the game to your home screen.</p>
  <p id="installSuggestionHelp" hidden></p></div>
  <button id="installSuggestionAction" type="button">How to install</button>
  <button id="installSuggestionClose" type="button" aria-label="Dismiss install suggestion">×</button>`;
document.body.appendChild(banner);
const action = banner.querySelector('#installSuggestionAction');
const help = banner.querySelector('#installSuggestionHelp');

function dismiss() {
  dismissedThisVisit = true;
  banner.hidden = true;
}
function update() {
  const mobile = innerWidth <= 800 || (navigator.maxTouchPoints > 0 && innerWidth <= 1024);
  const inGameFlow = document.body.matches('.in-room, .in-arena, .in-mode-setup');
  banner.hidden = !ready || !mobile || inGameFlow || installedThisVisit || dismissedThisVisit ||
    standalone.matches || fullscreen.matches || navigator.standalone === true;
  action.textContent = deferredPrompt ? 'Install game' : 'How to install';
}
banner.querySelector('#installSuggestionClose').addEventListener('click', dismiss);
action.addEventListener('click', async () => {
  if (!deferredPrompt) {
    help.textContent = isIOS
      ? 'Tap your browser’s Share button, choose Add to Home Screen, then tap Add.'
      : 'Open your browser menu (⋮) and choose Install app or Add to Home screen. If unavailable, open this page in Chrome or Safari.';
    help.hidden = false;
    return;
  }
  const prompt = deferredPrompt;
  deferredPrompt = null;
  action.disabled = true;
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') installedThisVisit = true;
    dismiss();
  } catch {
    help.textContent = 'Open your browser menu and choose Install app or Add to Home screen.';
    help.hidden = false;
  } finally {
    action.disabled = false;
    update();
  }
});
window.addEventListener('beforeinstallprompt', event => {
  if (isIOS) return;
  deferredPrompt = event;
  // Preserve the browser's own desktop install experience.
  if (innerWidth <= 800 || navigator.maxTouchPoints > 0) event.preventDefault();
  update();
});
window.addEventListener('appinstalled', () => {
  installedThisVisit = true;
  deferredPrompt = null;
  update();
});
standalone.addEventListener('change', update);
fullscreen.addEventListener('change', update);
window.addEventListener('resize', update);
// A dismissal lasts only for this visit, including a return from browser history.
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    dismissedThisVisit = false;
    help.hidden = true;
    update();
  }
});
new MutationObserver(update).observe(document.body, { attributes: true, attributeFilter: ['class'] });
setTimeout(() => { ready = true; update(); }, 1800);
