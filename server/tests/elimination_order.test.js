import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomManager} from '../src/roomManager.js';
test('No Mercy records knockout order once, shares it and resets it for the next game',()=>{
 const rm=new RoomManager({loadAllActiveRooms:()=>[],saveRoom(){},saveSession(){}});
 const host=rm.createRoom('Host','no_mercy');rm.joinRoom(host.roomId,'Second');rm.joinRoom(host.roomId,'Third');
 rm.startGame(host.roomId,host.playerId);const room=rm.getRoom(host.roomId),[a,b,c]=room.players;
 for(const player of [c,b]){room.playerHands[player.id]=Array.from({length:25},(_,i)=>({id:player.id+i,type:'number',color:'red',value:2}));assert.equal(rm.checkKnockout(room,player),true);}
 assert.equal(c.eliminationOrder,1);assert.equal(b.eliminationOrder,2);
 rm.checkKnockout(room,c);assert.equal(c.eliminationOrder,1);
 const view=rm.getClientView(host.roomId,a.id);assert.equal(view.gameState.players.find(p=>p.id===b.id).eliminationOrder,2);
 room.status='lobby';rm.startGame(host.roomId,a.id);assert.ok(room.players.every(p=>p.eliminationOrder===null));
});
