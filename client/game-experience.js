import { getActiveFace } from '../shared/deck.js';
import { sounds } from './audio.js';
// Shared presentation helpers; authoritative turns and scores stay on the server.
export function updateTurnStatus(app, remaining, critical) {
  let label=document.getElementById('tableTurnStatus');
  const table=document.querySelector('.table-felt');
  if(!table)return;
  if(!label){label=document.createElement('div');label.id='tableTurnStatus';label.className='table-turn-status';label.setAttribute('role','status');table.append(label);}
  const active=app.gameState?.players[app.gameState.currentTurn];
  const playing=app.gameState?.status==='playing';label.hidden=!playing;
  const mine=active?.id===app.playerId;
  const paused=app.gameState?.rouletteInProgress;
  const text=paused?'Roulette in progress':mine?'Your turn':`${active?.name || 'Player'}’s turn`;
  // Only announce a turn change, not every countdown tick.
  if(label.dataset.player!==active?.id||label.dataset.roulette!==String(paused)){label.textContent=text;label.dataset.player=active?.id||'';label.dataset.roulette=String(paused);}
  label.dataset.mine=String(mine);label.classList.toggle('is-urgent',mine&&critical&&!paused);
  label.setAttribute('title',`${remaining} seconds remaining`);
}
export function renderMatchStandings(app, state) {
  const panel=document.getElementById('matchStandings');if(!panel)return;
  panel.replaceChildren();
  const heading=document.createElement('h3');heading.textContent='Table results';panel.append(heading);
  const list=document.createElement('ol');
  const players=[...state.players].sort((a,b)=>{
    if(a.id===state.winnerId)return -1;if(b.id===state.winnerId)return 1;
    if(a.isEliminated!==b.isEliminated)return a.isEliminated?1:-1;
    if(a.isEliminated&&b.isEliminated)return (b.eliminationOrder||0)-(a.eliminationOrder||0);
    return a.cardCount-b.cardCount;
  });
  for(const player of players){
    const row=document.createElement('li'),name=document.createElement('strong'),detail=document.createElement('span');
    name.textContent=player.name;name.title=player.name;
    const winner=player.id===state.winnerId;
    const order=player.eliminationOrder;
    detail.textContent=winner?'Winner':player.isEliminated?`Knocked out${order?` · #${order} out`:''}`:`${player.cardCount} cards left`;
    if(Number.isFinite(player.score)&&state.mode==='classic')detail.textContent+=` · ${player.score} pts`;
    row.dataset.winner=String(winner);row.append(name,detail);list.append(row);
  }
  panel.append(list);
  const status=document.createElement('p');status.id='victoryRematchStatus';status.textContent=app.clientView?.rematchProposal?.status==='responding'?'Rematch requested · waiting for players':'Ready for another round?';panel.append(status);
}

export function playPowerSound(previous,current) {
  if(!current.topDiscard || current.topDiscard.id===previous.topDiscard?.id)return;
  const face=getActiveFace(current.topDiscard,current.mode,previous.flipSide);
  if(!face)return;
  const type=face.type;
  if(type==='number'){if(current.mode==='no_mercy'&&[0,7].includes(face.value))sounds.playPower('swap');return;}
  sounds.playPower(type.includes('reverse')?'reverse':type.includes('skip')?'skip':type.includes('draw')?'draw':type==='flip'?'flip':'wild');
}
