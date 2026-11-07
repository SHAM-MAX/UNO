import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'uno-draw4-'));
const { server, wss, roomManager: rm } = await import('../src/index.js');
function peer(port) {
 const ws=new WebSocket(`ws://localhost:${port}`), queue=[], waiters=[];
 ws.on('message',raw=>{const m=JSON.parse(raw);const index=waiters.findIndex(w=>w.p(m));if(index>=0){const w=waiters.splice(index,1)[0];clearTimeout(w.timer);w.resolve(m);}else queue.push(m);});
 return {ws,open:new Promise((res,rej)=>{ws.once('open',res);ws.once('error',rej);}),send:m=>ws.send(JSON.stringify(m)),next(p){const index=queue.findIndex(p);if(index>=0)return Promise.resolve(queue.splice(index,1)[0]);return new Promise((resolve,reject)=>{const w={p,resolve,timer:setTimeout(()=>reject(new Error('Timed out waiting for synchronized Draw Four state')),3000)};waiters.push(w);});}};
}
test('Physical Draw Four: three authenticated clients synchronize success, failure, acceptance, replay and private evidence',async()=>{
 await new Promise(r=>server.listen(0,r));const peers=Array.from({length:3},()=>peer(server.address().port));
 try {
  await Promise.all(peers.map(p=>p.open));const host=rm.createRoom('Host');const guests=[rm.joinRoom(host.roomId,'Target'),rm.joinRoom(host.roomId,'Observer')];
  const sessions=[host,...guests];const ids=sessions.map(s=>s.playerId);
  peers.forEach((p,i)=>p.send({type:'join',roomId:host.roomId,sessionToken:sessions[i].sessionToken}));await Promise.all(peers.map(p=>p.next(m=>m.type==='joined')));
  rm.startGame(host.roomId,ids[0]);const room=rm.getRoom(host.roomId);
  for(const [index,outcome] of ['successful','failed','accepted'].entries()){
   Object.assign(room,{status:'playing',currentTurn:0,direction:1,activeColor:'red',pendingAction:null,turnDrawnCard:false,turnDrawnCardId:null,unoChallengeWindow:null});
   room.topDiscard={id:'top',color:'red',type:'number',value:5};room.discardPile=[room.topDiscard];
   room.playerHands[ids[0]]=[{id:`wild-${index}`,color:'wild',type:'wild_draw4'},{id:`held-${index}`,color:outcome==='failed'?'blue':'red',type:'number',value:5}];
   rm.resetTurnTimer(room);const oldVersion=room.actionVersion;
   peers[0].send({type:'play_card',actionId:`play-${index}`,expectedActionVersion:oldVersion,data:{cardId:`wild-${index}`,chosenColor:'blue'}});
   const pending=await Promise.all(peers.map(p=>p.next(m=>m.type==='room:state'&&m.data.gameState.pendingAction?.offenderId===ids[0]&&m.data.gameState.topDiscard?.id===`wild-${index}`)));
   for(const m of pending){assert.equal(m.data.gameState.pendingAction.handBeforePlay,undefined);assert.equal(m.data.gameState.pendingAction.illegal,undefined);assert.equal(m.data.gameState.playerHands,undefined);}
   peers[2].send({type:'challenge_draw4',actionId:`observer-${index}`});await peers[2].next(m=>m.type==='error');assert.ok(room.pendingAction);
   const version=room.actionVersion,offenderBefore=room.playerHands[ids[0]].length,targetBefore=room.playerHands[ids[1]].length;
   const type=outcome==='accepted'?'draw_card':'challenge_draw4',actionId=`resolve-${index}`;
   peers[1].send({type,actionId,expectedActionVersion:version});
   const result=await Promise.all(peers.map(p=>p.next(m=>m.type==='room:state'&&m.data.gameState.drawFourResult?.id===pending[0].data.gameState.pendingAction.id)));
   for(const m of result){assert.equal(m.data.gameState.drawFourResult.outcome,outcome);assert.equal(m.data.gameState.pendingAction,null);assert.equal(m.data.gameState.drawFourResult.evidence,undefined);assert.equal(m.data.gameState.currentTurn,outcome==='successful'?1:2);}
   assert.equal(room.playerHands[ids[0]].length,offenderBefore+(outcome==='successful'?4:0));assert.equal(room.playerHands[ids[1]].length,targetBefore+(outcome==='successful'?0:outcome==='failed'?6:4));
   assert.equal(result[0].data.drawFourEvidence,null);assert.equal(result[2].data.drawFourEvidence,null);assert.equal(Boolean(result[1].data.drawFourEvidence),outcome!=='accepted');
   peers[1].send({type,actionId,expectedActionVersion:version});await peers[1].next(m=>m.type==='room:state'&&m.data.gameState.drawFourResult?.id===pending[0].data.gameState.pendingAction.id);
   assert.equal(room.playerHands[ids[0]].length,offenderBefore+(outcome==='successful'?4:0));assert.equal(room.playerHands[ids[1]].length,targetBefore+(outcome==='successful'?0:outcome==='failed'?6:4));
   peers[1].send({type:'challenge_draw4',actionId:`stale-${index}`,expectedActionVersion:version});await peers[1].next(m=>m.type==='error'&&/turn changed/.test(m.message));
  }
 }finally{peers.forEach(p=>p.ws.terminate());wss.clients.forEach(ws=>ws.terminate());await new Promise(r=>server.close(r));}
});
