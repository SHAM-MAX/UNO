import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WebSocket} from 'ws';
process.env.NODE_ENV='test';process.env.DATA_DIR=mkdtempSync(path.join(tmpdir(),'uno-rematch-'));
const {server,wss,roomManager:rm}=await import('../src/index.js');
function peer(port){const ws=new WebSocket(`ws://localhost:${port}`),q=[],listeners=[];ws.on('message',raw=>{const m=JSON.parse(raw),i=listeners.findIndex(l=>l.p(m));if(i<0)q.push(m);else{const l=listeners.splice(i,1)[0];clearTimeout(l.timer);l.r(m);}});return{ws,open:new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);}),send:m=>ws.send(JSON.stringify(m)),next(p){const i=q.findIndex(p);if(i>=0)return Promise.resolve(q.splice(i,1)[0]);return new Promise((r,j)=>listeners.push({p,r,timer:setTimeout(()=>j(Error('Rematch synchronization timeout')),3000)}));}};}
test('Authenticated multiplayer rematch notifies losers/knockouts, recovers invitations, synchronizes roster and preserves declined sessions',async()=>{
 await new Promise(r=>server.listen(0,r));const port=server.address().port,clients=[peer(port),peer(port),peer(port)];
 try{
  await Promise.all(clients.map(c=>c.open));clients[0].send({type:'create',playerName:'Host',data:{mode:'no_mercy'}});const host=(await clients[0].next(m=>m.type==='joined')).data;
  for(let i=1;i<3;i++){clients[i].send({type:'join',roomId:host.roomId,playerName:`Player ${i}`});}
  const joined=[host,...await Promise.all(clients.slice(1).map(c=>c.next(m=>m.type==='joined').then(m=>m.data)))];const ids=joined.map(p=>p.playerId),room=rm.getRoom(host.roomId);
  rm.startGame(host.roomId,ids[0]);room.status='game_over';room.winnerId=ids[1];room.winReason='Player 1 wins';room.players[2].isEliminated=true;rm.resetTurnTimer(room);
  clients[0].send({type:'rematch_propose',playerId:ids[1]});assert.match((await clients[0].next(m=>m.type==='error')).message,/winner/);
  clients[2].ws.close();await new Promise(r=>clients[2].ws.once('close',r));
  clients[1].send({type:'rematch_propose'});const request=await clients[0].next(m=>m.type==='room:state'&&m.data.rematchProposal?.status==='responding'),p=request.data.rematchProposal;assert.deepEqual(p.originalParticipantIds,ids);assert.deepEqual(p.acceptedPlayerIds,[ids[1]]);
  const recovered=peer(port);clients.push(recovered);await recovered.open;recovered.send({type:'join',roomId:host.roomId,sessionToken:joined[2].sessionToken});await recovered.next(m=>m.type==='joined');const invitation=await recovered.next(m=>m.type==='room:state'&&m.data.rematchProposal?.id===p.id);assert.ok(invitation.data.rematchProposal.pendingPlayerIds.includes(ids[2]));
  clients[0].send({type:'rematch_vote',data:{proposalId:p.id,mode:'classic'}});assert.match((await clients[0].next(m=>m.type==='error')).message,/Accept/);
  clients[0].send({type:'rematch_respond',data:{proposalId:p.id,accept:false}});recovered.send({type:'rematch_respond',data:{proposalId:p.id,accept:true}});await clients[1].next(m=>m.type==='room:state'&&m.data.rematchProposal?.status==='voting');
  for(const client of [clients[1],recovered])client.send({type:'rematch_vote',data:{proposalId:p.id,mode:'classic'}});
  await clients[0].next(m=>m.type==='room:state'&&Object.keys(m.data.rematchProposal?.modeVotes||{}).length===2);
  const active=room.rematchProposal;rm.advanceRematch(host.roomId,active.votingDeadline);await clients[0].next(m=>m.type==='room:state'&&m.data.rematchProposal?.status==='resolved');rm.advanceRematch(host.roomId,active.startAt);
  const views=await Promise.all([clients[0],clients[1],recovered].map(c=>c.next(m=>m.type==='room:state'&&m.data.rematchProposal?.status==='started')));
  assert.equal(room.mode,'classic');assert.deepEqual(room.players.map(p=>p.id),[ids[1],ids[2]]);assert.equal(room.players.find(p=>p.isHost).id,ids[1]);assert.ok(room.players.every(p=>p.score===0&&!p.isEliminated));
  assert.equal(views[0].data.isSpectator,true);assert.deepEqual(views[0].data.myHand,[]);assert.ok(views.slice(1).every(m=>!m.data.isSpectator&&[7,9].includes(m.data.myHand.length)));
  for(const view of views){assert.equal(view.data.gameState.mode,'classic');assert.ok(!JSON.stringify(view).includes(joined[0].sessionToken));}
  clients[0].send({type:'rematch_respond',data:{proposalId:p.id,accept:true}});assert.match((await clients[0].next(m=>m.type==='error')).message,/closed/);assert.equal(room.players.length,2);
  room.status='game_over';room.winnerId=ids[1];rm.resetTurnTimer(room);
  clients[1].send({type:'rematch_propose',actionId:'proposal-once',data:{matchId:room.matchId}});
  const fresh=await clients[1].next(m=>m.type==='room:state'&&m.data.rematchProposal?.status==='responding'&&m.data.rematchProposal.id!==p.id);
  const freshId=fresh.data.rematchProposal.id;
  clients[1].send({type:'rematch_cancel',actionId:'cancel-once',data:{proposalId:freshId}});await clients[1].next(m=>m.type==='room:state'&&m.data.rematchProposal?.status==='cancelled');
  clients[1].send({type:'rematch_propose',actionId:'proposal-once',data:{matchId:room.matchId}});await clients[1].next(m=>m.type==='room:state'&&m.data.rematchProposal?.id===freshId&&m.data.rematchProposal.status==='cancelled');
  assert.equal(room.rematchProposal.id,freshId,'Replayed proposal must not create a second invitation');
 }finally{clients.forEach(c=>c.ws.terminate());wss.clients.forEach(ws=>ws.terminate());for(const timer of rm.rematchTimers.values())clearTimeout(timer);await new Promise(r=>server.close(r));}
});
