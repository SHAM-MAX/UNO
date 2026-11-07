import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WebSocket} from 'ws';
process.env.NODE_ENV='test';process.env.DATA_DIR=mkdtempSync(path.join(tmpdir(),'uno-mercy-ws-'));
const {server,wss,roomManager:rm}=await import('../src/index.js');
function peer(port){const ws=new WebSocket(`ws://localhost:${port}`),q=[],listeners=[];ws.on('message',raw=>{const m=JSON.parse(raw),i=listeners.findIndex(l=>l.p(m));if(i<0)q.push(m);else{const l=listeners.splice(i,1)[0];clearTimeout(l.timer);l.r(m);}});return{ws,open:new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);}),send:m=>ws.send(JSON.stringify(m)),next(p){const i=q.findIndex(p);if(i>=0)return Promise.resolve(q.splice(i,1)[0]);return new Promise((r,j)=>listeners.push({p,r,timer:setTimeout(()=>j(Error('No Mercy synchronization timeout')),3000)}));}};}
const c=(id,color='red',type='number',value=3)=>({id,color,type,...(type==='number'?{value}:{})});
test('No Mercy authenticated three-client Roulette: target-only, stale/replay protection, reconnect, privacy and synchronized penalty',async()=>{
 await new Promise(r=>server.listen(0,r));const port=server.address().port,clients=[peer(port),peer(port),peer(port)];
 try{
  await Promise.all(clients.map(c=>c.open));clients[0].send({type:'create',playerName:'Host',data:{mode:'no_mercy'}});const host=(await clients[0].next(m=>m.type==='joined')).data;
  const joined=[host];for(let i=1;i<3;i++){clients[i].send({type:'join',roomId:host.roomId,playerName:'Guest'+i});joined.push((await clients[i].next(m=>m.type==='joined')).data);}
  const ids=joined.map(p=>p.playerId);rm.startGame(host.roomId,ids[0]);const room=rm.getRoom(host.roomId);Object.assign(room,{currentTurn:0,pendingAction:null,pendingDrawPenalty:0,activeColor:'red',topDiscard:c('top'),discardPile:[c('top')],turnDrawnCard:false});
  room.playerHands[ids[0]]=[c('roulette','wild','wild_color_roulette'),c('private-offender','blue')];room.playerHands[ids[1]]=[c('private-victim','green')];room.drawPile=[c('revealed-wild','wild','wild_draw6'),c('revealed-yellow','yellow'),c('revealed-red')];room.players.forEach(p=>p.cardCount=room.playerHands[p.id].length);rm.resetTurnTimer(room);
  clients[0].send({type:'play_card',actionId:'roulette-once',expectedActionVersion:room.actionVersion,data:{cardId:'roulette'}});
  const views=await Promise.all(clients.map(client=>client.next(m=>m.type==='room:state'&&m.data.gameState.pendingAction?.type==='color_roulette')));
  assert.ok(views.every(v=>v.data.gameState.pendingAction.targetPlayerId===ids[1]));assert.ok(!JSON.stringify(views[2]).includes('private-offender'));assert.ok(!JSON.stringify(views[2]).includes('private-victim'));assert.ok(!JSON.stringify(views[2]).includes('revealed-red'));
  clients[0].send({type:'choose_color',data:{chosenColor:'red'}});assert.match((await clients[0].next(m=>m.type==='error')).message,/Invalid Roulette/);
  clients[1].send({type:'choose_color',expectedActionVersion:room.actionVersion-1,data:{chosenColor:'red'}});assert.match((await clients[1].next(m=>m.type==='error')).message,/turn changed/);
  clients[1].ws.terminate();await new Promise(r=>clients[1].ws.once('close',r));const recovered=peer(port);clients.push(recovered);await recovered.open;recovered.send({type:'join',roomId:host.roomId,sessionToken:joined[1].sessionToken});await recovered.next(m=>m.type==='joined');const restored=await recovered.next(m=>m.type==='room:state'&&m.data.gameState.pendingAction?.type==='color_roulette');assert.equal(restored.data.myHand[0].id,'private-victim');
  recovered.send({type:'choose_color',actionId:'choice-once',expectedActionVersion:room.actionVersion,data:{chosenColor:'red'}});
  const resolved=await Promise.all([clients[0],recovered,clients[2]].map(client=>client.next(m=>m.type==='room:state'&&m.data.gameState.rouletteResult?.revealed.length===3)));
  for(const view of resolved){assert.equal(view.data.gameState.currentTurn,2);assert.equal(view.data.gameState.players[1].cardCount,4);assert.equal(view.data.gameState.pendingAction,null);assert.equal(view.data.gameState.activeColor,'red');}
  const count=room.playerHands[ids[1]].length;recovered.send({type:'choose_color',actionId:'choice-once',data:{chosenColor:'red'}});await recovered.next(m=>m.type==='room:state'&&m.data.gameState.rouletteResult);assert.equal(room.playerHands[ids[1]].length,count);
  recovered.send({type:'choose_color',actionId:'second-choice',data:{chosenColor:'red'}});assert.match((await recovered.next(m=>m.type==='error')).message,/Invalid Roulette/);assert.equal(room.playerHands[ids[1]].length,count);
 }finally{clients.forEach(c=>c.ws.terminate());wss.clients.forEach(ws=>ws.terminate());for(const timer of rm.turnTimers.values())clearTimeout(timer);await new Promise(r=>server.close(r));}
});
