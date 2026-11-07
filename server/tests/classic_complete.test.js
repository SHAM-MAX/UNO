import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RoomManager } from '../src/roomManager.js';
import { createClassicDeck } from '../../shared/deck.js';
import { calculateScore } from '../../shared/rules.js';
import { classicSheetFace } from '../../client/cardGraphics.js';
const store = { loadAllActiveRooms: () => [], saveRoom() {}, saveSession() {} };
const number = (id, color = 'red', value = 5) => ({ id, color, type: 'number', value });
function setup(n = 3) {
  const rm = new RoomManager(store);
  const { roomId, playerId } = rm.createRoom('P0');
  for (let i = 1; i < n; i++) assert.ok(rm.joinRoom(roomId, `P${i}`).success);
  rm.startGame(roomId, playerId);
  const r = rm.getRoom(roomId);
  Object.assign(r, { pendingAction: null, activeColor: 'red', topDiscard: number('top'), currentTurn: 0, direction: 1 });
  return { rm, r, ids: r.players.map(p => p.id), roomId };
}
test('Classic: every identity maps to one distinct existing PNG with expected colour/symbol coordinates', () => {
  const deck = createClassicDeck();
  const paths = deck.map(c => {
    const { row, col } = classicSheetFace(c, c);
    const path = `client/assets/classic-cards/r${row}-c${col}.png`;
    assert.ok(fs.existsSync(path));
    if (c.color !== 'wild' && c.value !== 0) assert.equal(row % 4, ['red','yellow','green','blue'].indexOf(c.color));
    if (c.type === 'number' && c.value) assert.equal(col, c.value - 1);
    return path;
  });
  assert.equal(new Set(paths).size, 108);
  assert.equal(new Set(deck.map(c => c.id)).size, 108);
  for (const color of ['red','yellow','green','blue']) {
    const cards = deck.filter(c => c.color === color);
    assert.equal(cards.length, 25);
    for (let value = 0; value <= 9; value++) assert.equal(cards.filter(c => c.type === 'number' && c.value === value).length, value ? 2 : 1);
    for (const type of ['skip','reverse','draw2']) assert.equal(cards.filter(c => c.type === type).length, 2);
  }
});
for (const n of [2,3,6,10]) test(`Classic ${n} players: setup conserves all 108 cards and private sessions`, () => {
  const { rm,r,ids,roomId } = setup(n);
  const all = [...r.drawPile,...r.discardPile,...Object.values(r.playerHands).flat()];
  assert.equal(all.length,108); assert.equal(new Set(all.map(c=>c.id)).size,108);
  assert.ok(Number.isInteger(r.dealerIndex));
  for (const id of ids) {
    const view = rm.getClientView(roomId,id);
    assert.equal(view.myHand.length,r.playerHands[id].length);
    assert.ok(view.gameState.players.every(p=>!p.sessionToken && !p.hand));
  }
  const p = r.players[1];
  assert.equal(rm.joinRoom(roomId,'Reconnect',p.sessionToken).playerId,p.id);
});
for (const n of [2,3]) for (const type of ['number','skip','reverse','draw2','wild']) test(`Classic opening ${type}, ${n} players`,()=>{
 const {rm,r,ids}=setup(n); r.dealerIndex=1; r.direction=1; r.pendingAction=null;
 const before=Object.fromEntries(ids.map(id=>[id,r.playerHands[id].length]));
 rm.applyClassicOpening(r,{type,color:type==='wild'?'wild':'red'});
 const left=2%n;
 assert.equal(r.currentTurn,type==='reverse'?1:['skip','draw2'].includes(type)?(left+1)%n:left);
 assert.equal(r.direction,type==='reverse'?-1:1);
 if(type==='draw2') assert.equal(r.playerHands[ids[left]].length,before[ids[left]]+2);
 if(type==='wild') {assert.equal(r.activeColor,null);assert.equal(r.pendingAction.targetPlayerId,ids[left]);}
});
test('Classic draw: exact identity, optional draw, repeat rejection and pass',()=>{
 const {rm,r,ids,roomId}=setup();
 r.playerHands[ids[0]]=[number('held')]; r.drawPile=[number('new'),number('next')];
 assert.ok(rm.drawCard(roomId,ids[0]).success);
 assert.equal(r.turnDrawnCardId,'new');
 assert.equal(rm.drawCard(roomId,ids[0]).success,false);
 assert.equal(rm.playCard(roomId,ids[0],{cardId:'held'}).success,false);
 assert.deepEqual(rm.getClientView(roomId,ids[0]).canPlayCards,['new']);
 assert.ok(rm.playCard(roomId,ids[0],{cardId:'new'}).success);
 assert.equal(rm.playCard(roomId,ids[0],{cardId:'new'}).success,false);
 assert.equal(r.currentTurn,1);
});
test('Classic unplayable draw ends turn and clears exact identity',()=>{
 const {rm,r,ids,roomId}=setup();r.drawPile=[number('new','blue',9)];
 assert.ok(rm.drawCard(roomId,ids[0]).success); assert.equal(r.currentTurn,1); assert.equal(r.turnDrawnCardId,null);
});
test('Classic UNO catch closes on next accepted action, rejects self and duplicate catches',()=>{
 const {rm,r,ids,roomId}=setup();r.playerHands[ids[0]]=[number('a'),number('b')];
 rm.playCard(roomId,ids[0],{cardId:'a'});
 assert.equal(rm.catchUno(roomId,ids[0],ids[0]).success,false);
 assert.ok(rm.catchUno(roomId,ids[2],ids[0]).success);
 assert.equal(rm.catchUno(roomId,ids[1],ids[0]).success,false);
 r.currentTurn=0;r.playerHands[ids[0]]=[number('c'),number('d')];rm.playCard(roomId,ids[0],{cardId:'c'});
 rm.drawCard(roomId,ids[1]);assert.equal(rm.catchUno(roomId,ids[2],ids[0]).success,false);
});
test('Classic UNO declaration cannot be stockpiled; valid declaration prevents catch',()=>{
 const {rm,r,ids,roomId}=setup();assert.equal(rm.callUno(roomId,ids[0]).success,false);
 r.playerHands[ids[0]]=[number('a'),number('b')];assert.ok(rm.callUno(roomId,ids[0]).success);
 rm.playCard(roomId,ids[0],{cardId:'a'});assert.equal(rm.catchUno(roomId,ids[1],ids[0]).success,false);
});
test('Classic Wild Draw Four legality checks colour, allows number in another colour; failed challenge draws six',()=>{
 const {rm,r,ids,roomId}=setup();
 const wild={id:'w',color:'wild',type:'wild_draw4'};
 r.playerHands[ids[0]]=[wild,number('a','blue')];assert.ok(rm.playCard(roomId,ids[0],{cardId:'w',chosenColor:'blue'}).success);
 assert.equal(rm.getClientView(roomId,ids[1]).gameState.pendingAction.illegal,undefined);
 assert.equal(rm.playCard(roomId,ids[1],{cardId:r.playerHands[ids[1]][0].id}).success,false);
 const before=r.playerHands[ids[1]].length;
 assert.ok(rm.resolveDrawFour(roomId,ids[1],true).success);assert.equal(r.playerHands[ids[1]].length,before+6);assert.equal(r.currentTurn,2);
 assert.equal(rm.resolveDrawFour(roomId,ids[1],true).success,false);
});
test('Classic pending legacy illegal Draw Four challenge penalizes offender and preserves challenger turn',()=>{
 const {rm,r,ids,roomId}=setup();r.currentTurn=1;
 r.pendingAction={type:'draw4_challenge',offenderId:ids[0],targetPlayerId:ids[1],illegal:true};
 const before=r.playerHands[ids[0]].length;
 assert.ok(rm.resolveDrawFour(roomId,ids[1]).success);assert.equal(r.playerHands[ids[0]].length,before+4);assert.equal(r.currentTurn,1);
});
test('Classic scores and next round preserve sessions, rotate dealer and reach 500',()=>{
 const {rm,r,ids,roomId}=setup();r.playerHands[ids[0]]=[number('last')];r.players[0].score=480;
 r.playerHands[ids[1]]=[number('nine','blue',9)];r.playerHands[ids[2]]=[number('seven','green',7)];
 rm.playCard(roomId,ids[0],{cardId:'last'});assert.equal(r.status,'round_over');assert.equal(r.players[0].score,496);
 const dealer=r.dealerIndex,token=r.players[0].sessionToken;
 assert.ok(rm.rematch(roomId,ids[0]).success);assert.equal(r.dealerIndex,(dealer+1)%3);assert.equal(r.players[0].score,496);assert.equal(r.players[0].sessionToken,token);assert.equal(r.roundNumber,2);
 r.pendingAction=null;r.currentTurn=0;r.activeColor='red';r.topDiscard=number('top');r.playerHands[ids[0]]=[number('final')];
 rm.playCard(roomId,ids[0],{cardId:'final'});assert.equal(r.status,'game_over');assert.ok(r.players[0].score>=500);
});
test('Classic score values',()=>assert.equal(calculateScore([number('n','red',9),...['skip','reverse','draw2'].map(type=>({type,color:'red'})),...['wild','wild_draw4'].map(type=>({type,color:'wild'}))]),169));
for(const type of ['draw2','wild_draw4']) test(`Classic final ${type}: penalty counted before scoring`,()=>{
 const {rm,r,ids,roomId}=setup();r.playerHands[ids[0]]=[{id:'last',color:type==='draw2'?'red':'wild',type}];
 r.playerHands[ids[1]]=[number('n','blue',1)];r.playerHands[ids[2]]=[number('m','blue',1)];
 r.drawPile=Array.from({length:8},(_,i)=>number(`d${i}`,'blue',9));
 rm.playCard(roomId,ids[0],{cardId:'last',chosenColor:'blue'});
 if(type==='wild_draw4'){assert.equal(r.status,'playing');rm.resolveDrawFour(roomId,ids[1],false);}
 assert.equal(r.status,'round_over');assert.equal(r.roundResult.points,type==='draw2'?20:38);
});
test('Classic reshuffle during penalty preserves top and all card identities',()=>{
 const {rm,r}=setup();r.drawPile=[number('first')];r.discardPile=[number('a'),number('b'),number('top')];
 const cards=rm.takeCards(r,3);assert.equal(cards.length,3);assert.equal(r.discardPile[0].id,'top');assert.equal(new Set([...cards,...r.discardPile].map(c=>c.id)).size,4);
});
for (const n of [2,3,6,10]) test(`Classic complete simulated ${n}-player match reaches 500 with 108 conserved cards`,()=>{
 const {rm,r,ids,roomId}=setup(n);
 let actions=0;
 while(r.status!=='game_over' && actions++<50000){
  const cards=[...r.drawPile,...r.discardPile,...Object.values(r.playerHands).flat()];
  assert.equal(cards.length,108);assert.equal(new Set(cards.map(c=>c.id)).size,108);
  if(r.status==='round_over'){assert.ok(rm.rematch(roomId,ids[0]).success);continue;}
  const id=r.players[r.currentTurn].id;
  let result;
  if(r.pendingAction?.type==='opening_color')result=rm.chooseOpeningColor(roomId,id,'red');
  else if(r.pendingAction?.type==='draw4_challenge')result=rm.resolveDrawFour(roomId,id,false);
  else {
   const view=rm.getClientView(roomId,id);
   if(view.canPlayCards.length)result=rm.playCard(roomId,id,{cardId:view.canPlayCards[0],chosenColor:'red'});
   else if(r.turnDrawnCard)result=rm.passTurn(roomId,id);
   else result=rm.drawCard(roomId,id);
  }
  assert.ok(result.success,JSON.stringify(result));
 }
 assert.equal(r.status,'game_over');assert.ok(r.players.some(p=>p.score>=500));
});
test('Classic opening never reveals Draw Four and always conserves it in the game deck',()=>{
 for(let i=0;i<100;i++){
  const {r}=setup();assert.notEqual(r.topDiscard.type,'wild_draw4');
  assert.equal([...r.drawPile,...r.discardPile,...Object.values(r.playerHands).flat()].filter(c=>c.type==='wild_draw4').length,4);
 }
});
test('Classic pending UNO has no five-second expiry; illegal moves do not close catch window',()=>{
 const {rm,r,ids,roomId}=setup();r.playerHands[ids[0]]=[number('a'),number('b')];rm.playCard(roomId,ids[0],{cardId:'a'});
 r.unoChallengeWindow.expiresAt=Date.now()-60000;
 assert.equal(rm.getClientView(roomId,ids[1]).canCatchUno,ids[0]);
 assert.equal(rm.playCard(roomId,ids[2],{cardId:'absent'}).success,false);
 assert.ok(rm.catchUno(roomId,ids[2],ids[0]).success);
});
test('Classic drawn Wild Draw Four can be attempted when a matching colour remains',()=>{
 const {rm,r,ids,roomId}=setup();r.playerHands[ids[0]]=[number('red-held')];r.drawPile=[{id:'w',color:'wild',type:'wild_draw4'}];
 assert.ok(rm.drawCard(roomId,ids[0]).success);assert.equal(r.currentTurn,0);assert.equal(r.turnDrawnCard,true);assert.deepEqual(rm.getClientView(roomId,ids[0]).canPlayCards,['w']);
});
test('Classic opening colour is chosen only by first player and rejects invalid colours',()=>{
 const {rm,r,ids,roomId}=setup();r.dealerIndex=0;rm.applyClassicOpening(r,{type:'wild',color:'wild'});
 assert.equal(rm.chooseOpeningColor(roomId,ids[0],'red').success,false);
 assert.equal(rm.chooseOpeningColor(roomId,ids[1],'pink').success,false);
 assert.equal(rm.drawCard(roomId,ids[1]).success,false);
 assert.ok(rm.chooseOpeningColor(roomId,ids[1],'green').success);assert.equal(r.activeColor,'green');assert.equal(r.currentTurn,1);
});
test('Classic stale timer cannot act when the same player has a newer action version',()=>{
 const {rm,r,ids,roomId}=setup(2);rm.resetTurnTimer(r);const version=r.actionVersion;
 r.playerHands[ids[0]]=[{id:'reverse',color:'red',type:'reverse'},number('spare')];
 assert.ok(rm.playCard(roomId,ids[0],{cardId:'reverse'}).success);assert.equal(r.currentTurn,0);
 const count=r.playerHands[ids[0]].length;
 rm.handleTurnTimeout(roomId,0,version);assert.equal(r.playerHands[ids[0]].length,count);assert.equal(r.currentTurn,0);
});
test('Classic opening wild remains pending even if an old timeout fires',()=>{
 const {rm,r,roomId}=setup();r.dealerIndex=0;rm.applyClassicOpening(r,{type:'wild',color:'wild'});rm.resetTurnTimer(r);
 rm.handleTurnTimeout(roomId,r.currentTurn,r.actionVersion);
 assert.equal(r.activeColor,null);assert.equal(r.pendingAction.type,'opening_color');assert.equal(r.turnDeadline,null);
});
test('Classic dealer draw-off repeats only tied players and scores action symbols as zero',()=>{
 const {rm,r}=setup();const drawn=[];
 const decks=[ [number('p2','blue',9),number('p1','green',9),number('p0','red',5)], [number('p2tie','blue',2),{id:'symbol',color:'red',type:'reverse'}] ];
 assert.equal(rm.determineClassicDealer(r,()=>{const d=decks.shift();drawn.push(d.length);return d;}),2);
 assert.deepEqual(drawn,[3,2]);assert.equal(decks.length,0);
 assert.ok(r.eventLogs.some(l=>l.text.includes('draw tied')));
});
for (const n of [2,3]) test(`Classic physical Draw Four bluff succeeds when challenged, ${n} players`,()=>{
 const {rm,r,ids,roomId}=setup(n);const held=number('held','red',7);
 r.playerHands[ids[0]]=[{id:'w',color:'wild',type:'wild_draw4'},held];
 assert.ok(rm.getClientView(roomId,ids[0]).canPlayCards.includes('w'));
 assert.ok(rm.playCard(roomId,ids[0],{cardId:'w',chosenColor:'blue'}).success);
 assert.equal(r.currentTurn,1);assert.equal(r.activeColor,'blue');
 const snapshot=r.pendingAction.handBeforePlay;assert.equal(snapshot.length,2);
 held.color='green'; // Later hand changes must not change the recorded evidence.
 assert.equal(snapshot[1].color,'red');
 for(const id of ids){const publicAction=rm.getClientView(roomId,id).gameState.pendingAction;assert.equal(publicAction.handBeforePlay,undefined);assert.equal(publicAction.illegal,undefined);assert.equal(publicAction.previousColor,undefined);}
 assert.equal(rm.resolveDrawFour(roomId,ids[0]).success,false);
 const before=r.playerHands[ids[0]].length;
 assert.ok(rm.resolveDrawFour(roomId,ids[1],true).success);
 assert.equal(r.playerHands[ids[0]].length,before+4);assert.equal(r.currentTurn,1);assert.equal(r.activeColor,'blue');
 const evidence=rm.getClientView(roomId,ids[1]).drawFourEvidence;
 assert.equal(evidence.hadMatchingColor,true);assert.equal(evidence.activeColorBeforePlay,'red');assert.equal(evidence.matchingColorCount,1);
 assert.equal(rm.getClientView(roomId,ids[0]).drawFourEvidence,null);
 assert.equal(rm.getClientView(roomId,ids[0]).gameState.drawFourResult.evidence,undefined);
 const after=r.playerHands[ids[0]].length;assert.equal(rm.resolveDrawFour(roomId,ids[1],true).success,false);assert.equal(r.playerHands[ids[0]].length,after);
});
test('Classic challenge uses pre-play hand even when UNO penalty subsequently adds matching-colour cards',()=>{
 const {rm,r,ids,roomId}=setup();r.playerHands[ids[0]]=[{id:'w',color:'wild',type:'wild_draw4'},number('held','blue',5)];r.drawPile=[number('uno1'),number('uno2'),...r.drawPile];
 rm.playCard(roomId,ids[0],{cardId:'w',chosenColor:'blue'});assert.ok(rm.catchUno(roomId,ids[2],ids[0]).success);
 assert.ok(r.playerHands[ids[0]].some(c=>c.color==='red'));const before=r.playerHands[ids[1]].length;
 assert.ok(rm.resolveDrawFour(roomId,ids[1],true).success);assert.equal(r.playerHands[ids[1]].length,before+6);assert.equal(r.currentTurn,2);assert.equal(rm.getClientView(roomId,ids[1]).drawFourEvidence.hadMatchingColor,false);
});
for(const bluff of [false,true]) test(`Classic accepts Draw Four ${bluff?'bluff':'legal play'} without checking guilt publicly`,()=>{
 const {rm,r,ids,roomId}=setup();r.playerHands[ids[0]]=[{id:'w',color:'wild',type:'wild_draw4'},number('held',bluff?'red':'blue')];
 rm.playCard(roomId,ids[0],{cardId:'w',chosenColor:'yellow'});const before=r.playerHands[ids[1]].length;
 assert.ok(rm.drawCard(roomId,ids[1]).success);assert.equal(r.playerHands[ids[1]].length,before+4);assert.equal(r.currentTurn,2);
 assert.equal(r.lastDrawFourResult.outcome,'accepted');for(const id of ids)assert.equal(rm.getClientView(roomId,id).drawFourEvidence,null);
 assert.equal(rm.resolveDrawFour(roomId,ids[1]).success,false);
});
test('Classic pending physical challenge survives server rehydration with private pre-play evidence',()=>{
 const saved=new Map();const persistent={loadAllActiveRooms:()=>[...saved].map(([roomId,state])=>({roomId,state:structuredClone(state)})),saveSession(){},saveRoom(roomId,mode,state){saved.set(roomId,structuredClone(state));}};
 const first=new RoomManager(persistent);const host=first.createRoom('Host'),guest=first.joinRoom(host.roomId,'Target');first.startGame(host.roomId,host.playerId);
 const r=first.getRoom(host.roomId);Object.assign(r,{currentTurn:0,pendingAction:null,activeColor:'red',direction:1});r.topDiscard=number('top');r.playerHands[host.playerId]=[{id:'w',color:'wild',type:'wild_draw4'},number('held')];
 assert.ok(first.playCard(host.roomId,host.playerId,{cardId:'w',chosenColor:'yellow'}).success);
 const second=new RoomManager(persistent);assert.ok(second.joinRoom(host.roomId,'Target',guest.sessionToken).success);
 assert.equal(second.getClientView(host.roomId,guest.playerId).gameState.pendingAction.handBeforePlay,undefined);
 const restored=second.getRoom(host.roomId),before=restored.playerHands[host.playerId].length;
 assert.ok(second.resolveDrawFour(host.roomId,guest.playerId,true).success);assert.equal(restored.playerHands[host.playerId].length,before+4);assert.equal(restored.currentTurn,1);
 assert.equal(second.getClientView(host.roomId,guest.playerId).drawFourEvidence.hadMatchingColor,true);
 for(const rm of [first,second])for(const timer of rm.turnTimers.values())clearTimeout(timer);
});
test('Classic Draw Four response does not allow pre-declaring UNO before the response is resolved',()=>{
 const {rm,r,ids,roomId}=setup();r.playerHands[ids[0]]=[{id:'w',color:'wild',type:'wild_draw4'},number('held')];r.playerHands[ids[1]]=[number('a'),number('b')];
 rm.playCard(roomId,ids[0],{cardId:'w',chosenColor:'blue'});assert.equal(rm.getClientView(roomId,ids[1]).canCallUno,false);assert.equal(rm.callUno(roomId,ids[1]).success,false);
 rm.resolveDrawFour(roomId,ids[1],true);assert.equal(rm.getClientView(roomId,ids[1]).canCallUno,true);
});
test('Classic Draw Four challenge follows reversed order and final failed challenge scores all six cards',()=>{
 const {rm,r,ids,roomId}=setup();r.direction=-1;r.playerHands[ids[0]]=[{id:'w',color:'wild',type:'wild_draw4'}];r.playerHands[ids[1]]=[number('b','blue',1)];r.playerHands[ids[2]]=[number('c','blue',1)];r.drawPile=Array.from({length:8},(_,i)=>number(`d${i}`,'blue',9));
 rm.playCard(roomId,ids[0],{cardId:'w',chosenColor:'blue'});assert.equal(r.currentTurn,2);assert.equal(r.winnerId,null);assert.equal(r.pendingRoundWinner,ids[0]);
 assert.ok(rm.resolveDrawFour(roomId,ids[2],true).success);assert.equal(r.roundResult.points,56);assert.equal(r.status,'round_over');assert.equal(r.winnerId,ids[0]);
});
test('Classic repeated UNO and stale catch after declaration do not mutate hand or turn',()=>{
 const {rm,r,ids,roomId}=setup();r.playerHands[ids[0]]=[number('a'),number('b')];
 assert.ok(rm.callUno(roomId,ids[0]).success);const log=r.eventLogs[0].id;
 assert.equal(rm.callUno(roomId,ids[0]).success,false);assert.equal(r.eventLogs[0].id,log);
 rm.playCard(roomId,ids[0],{cardId:'a'});const hands=JSON.stringify(r.playerHands),turn=r.currentTurn;
 const catchResult=rm.catchUno(roomId,ids[1],ids[0]);assert.equal(catchResult.success,false);assert.match(catchResult.error,/CAUGHT FAILED/);
 assert.equal(JSON.stringify(r.playerHands),hands);assert.equal(r.currentTurn,turn);
});
