import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/roomManager.js';
function setup(mode, penalty) {
 const store={loadAllActiveRooms:()=>[],saveRoom(){},saveSession(){}};
 const rm=new RoomManager(store),host=rm.createRoom('Alice',mode,{missedUnoPenalty:penalty});
 rm.joinRoom(host.roomId,'Bob');rm.joinRoom(host.roomId,'Charlie');rm.startGame(host.roomId,host.playerId);
 const room=rm.getRoom(host.roomId),ids=room.players.map(p=>p.id);
 room.pendingAction=null;room.currentTurn=1;
 return {rm,room,ids,id:host.roomId};
}
for(const mode of ['classic','flip','no_mercy']) {
 test(`${mode}: exactly two cards enables UNO off-turn; gaining cards hides it`,()=>{
  const {rm,room,ids,id}=setup(mode,5);
  room.playerHands[ids[0]]=room.drawPile.splice(0,2);
  assert.equal(rm.getClientView(id,ids[0]).canCallUno,true);
  assert.ok(rm.callUno(id,ids[0]).success);
  assert.equal(rm.getClientView(id,ids[0]).canCallUno,false);
  room.playerHands[ids[0]].push(room.drawPile.shift());
  assert.equal(rm.getClientView(id,ids[0]).canCallUno,false);
 });
 for(const penalty of [1,5,10]) test(`${mode}: one-card catch uses configured ${penalty} penalty once`,()=>{
  const {rm,room,ids,id}=setup(mode,penalty);
  room.playerHands[ids[0]]=room.drawPile.splice(0,1);room.players[0].hasCalledUno=false;
  room.unoChallengeWindow=null;room.unoChallengeTargets=[];
  assert.equal(rm.getClientView(id,ids[1]).canCatchUno,ids[0]);
  const result=rm.catchUno(id,ids[1],ids[0]);assert.ok(result.success);
  assert.equal(result.drawnCount,penalty);assert.equal(room.playerHands[ids[0]].length,penalty+1);
  assert.equal(rm.catchUno(id,ids[2],ids[0]).success,false);
 });
 test(`${mode}: declared UNO rejects catch with player name and no penalty`,()=>{
  const {rm,room,ids,id}=setup(mode,5);
  room.playerHands[ids[0]]=room.drawPile.splice(0,2);assert.ok(rm.callUno(id,ids[0]).success);
  room.playerHands[ids[0]].pop();const before=room.drawPile.length;
  const result=rm.catchUno(id,ids[1],ids[0]);assert.equal(result.success,false);
  assert.match(result.error,/Alice already called UNO/);assert.equal(room.playerHands[ids[0]].length,1);assert.equal(room.drawPile.length,before);
 });
}

for(const mode of ['classic','flip','no_mercy'])test(mode+': one-card UNO stays available without a temporary catch window',()=>{
 const {rm,room,ids,id}=setup(mode,5);room.playerHands[ids[0]]=room.drawPile.splice(0,1);room.players[0].hasCalledUno=false;room.players[0].isUnoArmed=false;room.unoChallengeWindow=null;room.unoChallengeTargets=[];
 assert.equal(rm.getClientView(id,ids[0]).canCallUno,true);assert.ok(rm.callUno(id,ids[0]).success);assert.equal(room.players[0].hasCalledUno,true);assert.equal(room.players[0].isUnoArmed,false);assert.equal(rm.getClientView(id,ids[0]).canCallUno,false);assert.equal(rm.callUno(id,ids[0]).success,false);assert.equal(rm.catchUno(id,ids[1],ids[0]).success,false);
 room.players[0].hasCalledUno=false;room.playerHands[ids[0]]=[];assert.equal(rm.getClientView(id,ids[0]).canCallUno,false);assert.equal(rm.callUno(id,ids[0]).success,false);
 room.playerHands[ids[0]]=room.drawPile.splice(0,3);assert.equal(rm.getClientView(id,ids[0]).canCallUno,false);assert.equal(rm.callUno(id,ids[0]).success,false);
});
