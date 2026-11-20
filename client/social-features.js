import { defaultHouseRules } from '../shared/rules.js';
import { setGameModal } from './interaction-motion.js';
const names={classic:'Classic',flip:'Flip',no_mercy:'No Mercy'};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const historyKey='uno_table_history_v1';
function readHistory(){try{const saved=JSON.parse(localStorage.getItem(historyKey));if(saved?.version===1&&Array.isArray(saved.records)&&Array.isArray(saved.seen)&&saved.modes)return saved;}catch{}return {version:1,games:0,wins:0,modes:{},records:[],seen:[]};}
export function recordMatch(app){
 const s=app.gameState;if(s?.status!=='game_over'||app.clientView?.isSpectator||!s.winnerId)return;
 const me=s.players.find(p=>p.id===app.playerId);if(!me)return;
 const id=s.matchId||`${app.roomId}:${s.roundNumber||1}`;const data=readHistory();if(data.seen.includes(id))return;
 data.seen.push(id);data.seen=data.seen.slice(-200);data.games++;if(s.winnerId===me.id)data.wins++;
 data.modes[s.mode]=(data.modes[s.mode]||0)+1;
 data.records.unshift({id,mode:s.mode,won:s.winnerId===me.id,winner:s.players.find(p=>p.id===s.winnerId)?.name||'Winner',at:Date.now(),players:s.players.length});data.records=data.records.slice(0,50);
 try{localStorage.setItem(historyKey,JSON.stringify(data));}catch{}
}
export async function createInviteCode(url){const {default:qrcode}=await import('./vendor/qrcode.mjs');const code=qrcode(0,'M');code.addData(url);code.make();return code;}
export function rulesPreset(mode,preset){
 const rules=defaultHouseRules(mode);
 if(preset==='quick')Object.assign(rules,{startingHandSize:5,turnDuration:15});
 if(preset==='chaos')Object.assign(rules,{stackingAllowed:true,drawUntilPlayable:true,startingHandSize:10,turnDuration:15,...(mode==='no_mercy'?{sevenZeroSwap:true,mercyKnockoutLimit:25}:mode==='classic'?{sevenZeroSwap:true}:{} )});
 return rules;
}
export function syncRulePresets(mode,readOnly){
 const group=document.getElementById('houseRulePresets');if(!group)return;
 group.querySelectorAll('button').forEach(b=>b.disabled=Boolean(readOnly));
 group.querySelector('[data-preset="standard"]').textContent=mode==='classic'?'Classic rules':'Standard rules';
 group.querySelector('small').textContent=readOnly?'Only the lobby host can change rules before play.':'Presets replace the current rules. You can adjust them below.';
}
function statsMarkup(){const data=readHistory(),favourite=Object.entries(data.modes).sort((a,b)=>b[1]-a[1])[0]?.[0];return `<div class="table-stats-grid"><span><strong>${data.games}</strong>Games</span><span><strong>${data.wins}</strong>Wins</span><span><strong>${names[favourite]||'—'}</strong>Favourite</span></div>`;}
async function renderPanel(app,kind){
 const content=document.getElementById('socialContent'),title=document.getElementById('socialTitle');content.replaceChildren();
 if(kind==='invite'){
   title.textContent='Invite your friends';if(!app.roomId){content.textContent='Create a room to invite friends.';return;}
   const url=new URL(location.pathname,location.origin);url.searchParams.set('room',app.roomId);
   content.textContent='Preparing your invite…';
   let code;try{code=await createInviteCode(url.href);}catch{if(app.socialPanelKind==='invite')content.innerHTML=`<p>QR unavailable. Share this room link instead:</p><input id="qrInviteLink" value="${escape(url.href)}" readonly aria-label="Room invite link">`;return;}if(app.socialPanelKind!=='invite')return;
   const svg=code.createSvgTag({cellSize:5,margin:20,scalable:true});
   content.innerHTML=`<p>Scan to join room <strong>${escape(app.roomId)}</strong>.</p><div class="invite-qr" role="img" aria-label="QR invite for room ${escape(app.roomId)}">${svg}</div><input id="qrInviteLink" value="${escape(url.href)}" readonly aria-label="Room invite link"><button id="qrCopyLink" class="table-feature-btn primary">Copy invite link</button><p class="table-feature-note">Your session details are never included in this link.</p>`;
   document.getElementById('qrCopyLink').onclick=()=>app.copyInviteLink();
 }else if(kind==='history'){
   title.textContent='Your table stats';const data=readHistory();
   content.innerHTML=statsMarkup()+`<p class="table-feature-note">Saved on this browser. Recent 50 completed games.</p><div class="match-history-list">${data.records.map(r=>`<article><span class="history-result ${r.won?'won':''}">${r.won?'WIN':'PLAYED'}</span><div><strong>${escape(names[r.mode]||'UNO')}</strong><small>${escape(r.winner)} won · ${r.players} players</small></div><time>${escape(new Date(r.at).toLocaleDateString())}</time></article>`).join('')||'<p>No completed games yet. Your next result will appear here.</p>'}</div>`;
 }else if(kind==='host'){
   title.textContent='Manage your table';const s=app.gameState,me=s?.players.find(p=>p.id===app.playerId);
   if(s?.status!=='lobby'||!me?.isHost){content.innerHTML='<p>These controls belong to the host and are available before the game starts.</p>';return;}
   content.innerHTML=`<div class="table-lock-row"><div><strong>${s.isLocked?'Room locked':'Room open'}</strong><small>Existing players can always reconnect.</small></div><button id="lockRoomButton" class="table-feature-btn">${s.isLocked?'Unlock room':'Lock room'}</button></div><div class="host-player-list">${s.players.filter(p=>p.id!==me.id).map(p=>`<article><div><strong>${escape(p.name)}</strong><small>${p.isBot?'AI player':p.isConnected?'Connected':'Disconnected'}</small></div><div>${!p.isBot&&p.isConnected?`<button class="table-feature-btn" data-transfer="${escape(p.id)}">Make host</button>`:''}<button class="table-feature-btn danger" data-remove="${escape(p.id)}" data-name="${escape(p.name)}">Remove</button></div></article>`).join('')||'<p>Invite friends or add a bot to get started.</p>'}</div><div id="hostActionConfirm" aria-live="polite"></div>`;
   document.getElementById('lockRoomButton').onclick=()=>app.send({type:'manage_lobby',data:{action:'lock',locked:!s.isLocked}});
   for(const button of content.querySelectorAll('[data-transfer],[data-remove]'))button.onclick=()=>{
     const transfer=Boolean(button.dataset.transfer),target=button.dataset.transfer||button.dataset.remove,player=s.players.find(p=>p.id===target);
     const area=document.getElementById('hostActionConfirm');area.innerHTML=`<p>${transfer?'Give host controls to':'Remove'} <strong>${escape(player.name)}</strong>?</p><button class="table-feature-btn primary" id="confirmHostAction">${transfer?'Transfer host':'Remove player'}</button> <button class="table-feature-btn" id="cancelHostAction">Cancel</button>`;
     document.getElementById('cancelHostAction').onclick=()=>area.replaceChildren();document.getElementById('confirmHostAction').onclick=()=>{app.send({type:'manage_lobby',data:{action:transfer?'transfer':'remove',targetPlayerId:target}});area.replaceChildren();};
   };
 }else{
   title.textContent='A quick table guide';content.innerHTML='<div class="quick-guide-list"><article><b>1 · Play a matching card</b><p>Match the active color, number or symbol. On a phone, tap once to preview, then again to play.</p></article><article><b>2 · Draw when you need to</b><p>Tap the deck. Depending on the room rules, play the drawn card or use Pass Turn.</p></article><article><b>3 · Call UNO</b><p>Call UNO while you have two cards, before playing down to one. Other players can catch a missed call.</p></article></div>';
 }
}
let tutorialStep=0,tutorialRoom=null,tutorialTimer=null;
function endTutorial(){clearTimeout(tutorialTimer);tutorialTimer=null;tutorialRoom=null;document.getElementById('firstGameGuide')?.remove();document.querySelectorAll('.guide-highlight').forEach(n=>n.classList.remove('guide-highlight'));try{localStorage.setItem('uno_quick_guide_seen','true');}catch{}}
function showTutorialStep(app){
 document.querySelectorAll('.guide-highlight').forEach(n=>n.classList.remove('guide-highlight'));
 if(!app.roomId||app.gameState?.status!=='playing')return endTutorial();
 const steps=[['Your hand','Match the active color, number or symbol. On mobile: tap to preview, tap again to play.',app.el.playerHandCards],['The draw pile','Need a card? Tap the deck. Pass Turn appears when your rules allow you to pass.',app.el.drawPile],['Remember UNO','At two cards, call UNO before playing down to one. A missed call can be caught.',app.el.playerHandCards]];
 const [title,text,target]=steps[tutorialStep];target?.classList.add('guide-highlight');
 let guide=document.getElementById('firstGameGuide');if(!guide){guide=document.createElement('aside');guide.id='firstGameGuide';guide.setAttribute('role','region');guide.setAttribute('aria-label','First game guide');document.body.append(guide);}
 guide.innerHTML=`<small>QUICK GUIDE · ${tutorialStep+1}/3</small><strong>${title}</strong><p>${text}</p><div><button class="table-feature-btn" id="skipQuickGuide">Skip</button><button class="table-feature-btn primary" id="nextQuickGuide">${tutorialStep===2?'Got it':'Next'}</button></div>`;
 document.getElementById('skipQuickGuide').onclick=endTutorial;document.getElementById('nextQuickGuide').onclick=()=>{if(++tutorialStep>=3)endTutorial();else showTutorialStep(app);};
}
export function onPong(app,sentAt){if(Number.isFinite(sentAt)&&Date.now()-sentAt>=0&&Date.now()-sentAt<120000){app.networkRtt=Math.round(Date.now()-sentAt);app.lastPongAt=Date.now();updateConnection(app);}}
function updateConnection(app){const indicator=document.getElementById('connectionQuality');if(!indicator)return;indicator.hidden=!app.roomId;const elapsed=Date.now()-(app.lastPongAt||Date.now()),rtt=app.networkRtt;
 const label=app.connectionRecovering?'Reconnecting':elapsed>25000?'Weak network':!Number.isFinite(rtt)?'Measuring…':rtt>800?'Weak network':rtt>250?'Fair connection':'Good connection';
 indicator.dataset.quality=app.connectionRecovering||elapsed>25000||rtt>800?'weak':rtt>250?'fair':'good';indicator.textContent=label;indicator.title=Number.isFinite(rtt)?`Round-trip time: ${rtt} ms`:'Checking connection to the table';}
export function syncSocial(app){
 recordMatch(app);updateConnection(app);
 const summary=document.getElementById('deviceStatsSummary');if(summary)summary.innerHTML=statsMarkup();
 const lock=document.getElementById('roomLockStatus');if(lock){lock.hidden=!app.gameState?.isLocked;lock.textContent='Room locked';}
 const manage=document.getElementById('manageRoomBtn');if(manage)manage.hidden=app.gameState?.status!=='lobby'||!app.gameState.players.some(p=>p.id===app.playerId&&p.isHost);
 if(app.socialPanelKind==='host'&&document.getElementById('socialModal')?.classList.contains('active'))renderPanel(app,'host');
 if(app.gameState?.status==='playing'&&!localStorage.getItem('uno_quick_guide_seen')&&!tutorialRoom){tutorialRoom=app.roomId;tutorialStep=0;tutorialTimer=setTimeout(()=>{tutorialTimer=null;showTutorialStep(app);},500);}
 if(app.gameState?.status!=='playing'&&tutorialRoom)endTutorial();
}
export function initSocial(app){
 const modal=document.createElement('div');modal.id='socialModal';modal.className='modal-overlay';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','socialTitle');modal.innerHTML='<section class="modal-card table-feature-card"><header><h2 id="socialTitle"></h2><button type="button" id="closeSocialPanel" aria-label="Close">×</button></header><div id="socialContent"></div></section>';document.body.append(modal);
 app.openSocialPanel=kind=>{app.socialPanelKind=kind;renderPanel(app,kind);setGameModal(modal,true);};app.closeSocialPanel=()=>{setGameModal(modal,false);app.socialPanelKind=null;};
 document.getElementById('closeSocialPanel').onclick=()=>app.closeSocialPanel();modal.onclick=e=>{if(e.target===modal)app.closeSocialPanel();};modal.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();app.closeSocialPanel();}};
 const qr=document.createElement('button');qr.id='qrInviteBtn';qr.className='table-feature-btn';qr.type='button';qr.setAttribute('aria-label','Open QR invite');qr.title='Open QR invite';qr.innerHTML='<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" aria-hidden="true" focusable="false"><path fill-rule="evenodd" d="M2 2h8v8H2V2Zm2 2v4h4V4H4Zm10-2h8v8h-8V2Zm2 2v4h4V4h-4ZM2 14h8v8H2v-8Zm2 2v4h4v-4H4Z"/><path d="M5 5h2v2H5zm12 0h2v2h-2zM5 17h2v2H5zm7-15h1v4h-1zm0 6h1v5H8v-1h4zM2 11h4v2H2zm10 4h3v-3h3v2h-1v3h-3v2h-2zm7-3h3v3h-2v-1h-1zm-1 5h4v2h-2v3h-2zm-6 4h4v1h-4zm3-3h2v2h-2zm6 3h1v1h-1z"/></svg>';qr.onclick=()=>app.openSocialPanel('invite');document.querySelector('.lobby-invite-actions')?.append(qr);
 const host=document.createElement('button');host.id='manageRoomBtn';host.className='table-feature-btn';host.type='button';host.textContent='Manage table';host.onclick=()=>app.openSocialPanel('host');document.getElementById('lobbyHostControls')?.append(host);
 const locked=document.createElement('span');locked.id='roomLockStatus';locked.className='room-lock-status';locked.hidden=true;document.querySelector('.lobby-invite-actions')?.append(locked);
 const stats=document.createElement('section');stats.className='settings-section';stats.innerHTML='<h4 class="settings-section-title">Your table</h4><div id="deviceStatsSummary"></div><p class="setting-desc">Game history is saved on this browser.</p><div class="table-feature-actions"><button class="table-feature-btn" id="openMatchHistory">Match history</button><button class="table-feature-btn" id="replayQuickGuide">Quick guide</button></div>';app.el.tabContentGeneral?.append(stats);
 document.getElementById('openMatchHistory').onclick=()=>app.openSocialPanel('history');document.getElementById('replayQuickGuide').onclick=()=>app.openSocialPanel('guide');
 const presets=document.createElement('section');presets.id='houseRulePresets';presets.className='settings-section';presets.innerHTML='<h4 class="settings-section-title">Rule presets</h4><div class="rule-presets"><button class="table-feature-btn" data-preset="quick">Quick Match</button><button class="table-feature-btn" data-preset="standard">Classic rules</button><button class="table-feature-btn" data-preset="chaos">Total Chaos</button></div><small></small>';app.el.tabContentGameRules?.prepend(presets);
 presets.onclick=e=>{const button=e.target.closest('[data-preset]');if(!button||button.disabled)return;const mode=app.activeRulesModalMode||app.gameState?.mode||app.selectedSetupMode||'classic',rules=rulesPreset(mode,button.dataset.preset),local=['ai','setup'].includes(app.rulesModalContext);
   if(app.roomId&&!local){app.send({type:'set_rules',data:{houseRules:rules}});}else{app.customHouseRules[mode]=rules;app.syncGameRulesModalInputs(mode,rules,false,true);app.updateAiRulesSummary(mode);}
 };
 const connection=document.createElement('span');connection.id='connectionQuality';connection.setAttribute('aria-label','Connection quality');connection.hidden=true;document.body.append(connection);setInterval(()=>updateConnection(app),5000);
 syncSocial(app);
}
export function stopSocial(app){clearTimeout(tutorialTimer);tutorialTimer=null;tutorialRoom=null;document.getElementById('firstGameGuide')?.remove();document.querySelectorAll('.guide-highlight').forEach(n=>n.classList.remove('guide-highlight'));document.getElementById('connectionQuality').hidden=true;app.closeSocialPanel?.();}
