import {getActiveFace} from '../shared/deck.js';
import {renderCardHTML} from './cardGraphics.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function sortedHand(hand,order,mode,side){
 if(!['color','value'].includes(order))return hand;
 const colors=['red','yellow','green','blue','orange','pink','teal','purple','wild'];
 const rank=c=>{const f=getActiveFace(c,mode,side);return [colors.indexOf(f.color),f.type==='number'?Number(f.value):20+['skip','reverse','draw1','draw2','draw5','flip','wild','wild_draw4'].indexOf(f.type),f.type];};
 return hand.map((c,i)=>({c,i,r:rank(c)})).sort((a,b)=>{const x=order==='color'?0:1,y=1-x;return a.r[x]-b.r[x]||a.r[y]-b.r[y]||a.r[2].localeCompare(b.r[2])||a.i-b.i;}).map(x=>x.c);
}
export function initTableTools(app){
 app.handSort=localStorage.getItem('uno_hand_sort')||'dealt';
 const bar=document.createElement('div');bar.id='tableTools';bar.className='table-tools';bar.hidden=true;bar.innerHTML='<button type="button" id="sortHandBtn">Sort: dealt</button><button type="button" id="lastPlayBtn">Last card</button><button type="button" id="roundScoresBtn">Scores</button>';
 document.querySelector('.table-felt')?.append(bar);
 document.getElementById('sortHandBtn').onclick=()=>{const before=[...app.handCardElements.values()].map(n=>[n,n.getBoundingClientRect()]);app.handSort=({dealt:'color',color:'value',value:'dealt'})[app.handSort]||'dealt';localStorage.setItem('uno_hand_sort',app.handSort);app.renderPlayerHand(app.clientView.myHand,app.clientView.canPlayCards,app.gameState.mode,app.gameState.flipSide);syncTableTools(app);if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.body.classList.contains('reduced-motion'))for(const [n,r] of before){const after=n.getBoundingClientRect();n.animate([{translate:(r.x-after.x)+'px '+(r.y-after.y)+'px'},{translate:'0px 0px'}],{duration:220,easing:'ease-out'});}};
 document.getElementById('lastPlayBtn').onclick=()=>app.openSocialPanel('replay');document.getElementById('roundScoresBtn').onclick=()=>app.openSocialPanel('scores');
 const scoreButton=document.createElement('button');scoreButton.id='victoryScoresBtn';scoreButton.type='button';scoreButton.className='table-feature-btn';scoreButton.textContent='Round scores';scoreButton.onclick=()=>app.openSocialPanel('scores');document.getElementById('matchStandings')?.after(scoreButton);
 const prefs=document.createElement('section');prefs.className='settings-section';prefs.innerHTML='<h4 class="settings-section-title">Table atmosphere</h4><p class="setting-desc">Choose your look. Only your screen changes.</p><div id="tableThemes"><button class="table-feature-btn" data-theme="wood">Warm wood</button><button class="table-feature-btn" data-theme="midnight">Midnight</button><button class="table-feature-btn" data-theme="emerald">Emerald</button></div><label class="table-haptics"><input id="tableHaptics" type="checkbox"> Short vibration when your turn starts</label><small>Supported phones only. Sound alerts follow your sound settings.</small>';
 app.el.tabContentGeneral?.append(prefs);const apply=theme=>{document.body.dataset.tableTheme=theme;document.querySelectorAll('[data-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.theme===theme)));};
 const stored=localStorage.getItem('uno_table_theme');apply(['wood','midnight','emerald'].includes(stored)?stored:'wood');prefs.querySelectorAll('[data-theme]').forEach(b=>b.onclick=()=>{apply(b.dataset.theme);localStorage.setItem('uno_table_theme',b.dataset.theme);});
 const haptics=document.getElementById('tableHaptics');haptics.checked=localStorage.getItem('uno_table_haptics')==='true';haptics.onchange=()=>localStorage.setItem('uno_table_haptics',String(haptics.checked));
}
export function syncTableTools(app){
 const s=app.gameState,playing=s?.status==='playing',spectator=app.clientView?.isSpectator;const bar=document.getElementById('tableTools');if(bar)bar.hidden=!playing;
 const sort=document.getElementById('sortHandBtn');if(sort){sort.hidden=Boolean(spectator);sort.textContent='Sort: '+(app.handSort||'dealt');sort.disabled=app.connectionRecovering;}
 const last=document.getElementById('lastPlayBtn');if(last)last.disabled=!s?.lastPlay;
 const key=playing?s.matchId+':'+s.roundNumber+':'+s.turnDeadline+':'+s.currentTurn:null;
 if(app.toolsTurnKey!==key){app.toolsTurnKey=key;app.toolsWarningSeconds=new Set();if(playing&&app.clientView.isMyTurn&&!app.connectionRecovering&&!document.hidden&&localStorage.getItem('uno_table_haptics')==='true')navigator.vibrate?.(35);}
}
export function warnTurn(app,seconds){
 if(!app.clientView?.isMyTurn||app.gameState?.status!=='playing'||app.connectionRecovering||document.hidden||![3,2,1].includes(seconds))return;
 app.toolsWarningSeconds||=new Set();if(app.toolsWarningSeconds.has(seconds))return;app.toolsWarningSeconds.add(seconds);app.playTurnWarning?.(660+(3-seconds)*90);
}
export function renderTablePanel(app,kind,content,title){
 if(!['replay','scores'].includes(kind))return false;
 const s=app.gameState;if(!s){title.textContent='Your table';content.textContent='Join a table to see this view.';return true;}
 if(kind==='replay'){
  title.textContent='Last card played';const p=s.lastPlay;
  if(!p){content.textContent='No card has been played yet.';return true;}
  const f=getActiveFace(p.card,s.mode,p.flipSide);content.innerHTML='<p><strong>'+esc(p.playerName)+'</strong> played '+esc(f.color)+' '+esc(f.type==='number'?f.value:f.type.replaceAll('_',' '))+'.</p><div class="last-play-card">'+renderCardHTML(p.card,{mode:s.mode,flipSide:p.flipSide})+'</div><p class="table-feature-note">A replay of the last public card. The live game continues.</p>';
 }else{
  title.textContent='Round scoreboard';const players=[...s.players].sort((a,b)=>s.mode==='classic'?(b.score||0)-(a.score||0):a.id===s.winnerId?-1:b.id===s.winnerId?1:Number(Boolean(a.isEliminated))-Number(Boolean(b.isEliminated))||a.cardCount-b.cardCount);content.innerHTML='<p>Round '+esc(s.roundNumber||1)+(s.mode==='classic'?' · First to 500 points':' · Table standings')+'</p><ol class="round-score-list">'+players.map(p=>'<li><strong>'+esc(p.name)+'</strong><span>'+esc(s.mode==='classic'?(p.score||0)+' pts':p.isEliminated?'Knocked out':p.cardCount+' cards')+'</span></li>').join('')+'</ol><div class="round-history">'+(s.roundHistory||[]).slice().reverse().map(r=>'<p>Round '+esc(r.round)+' · <strong>'+esc(r.winnerName)+'</strong> +'+esc(r.points)+' points</p>').join('')+'</div>';
 }
 return true;
}
