import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomConnections, sendRoomMessage } from '../src/roomConnections.js';
test('room index isolates recipients and cleans up replacement, leave and clear', () => {
 const index=new RoomConnections(), a={},b={};
 index.set(a,{roomId:'A'}).set(b,{roomId:'B'});
 assert.deepEqual([...index.forRoom('A').keys()],[a]);
 index.set(a,{roomId:'B'}); assert.equal(index.rooms.has('A'),false);
 assert.equal(index.forRoom('B').size,2); index.delete(b);index.delete(a);
 assert.equal(index.rooms.size,0);index.set(a,{roomId:'A'});index.clear();assert.equal(index.rooms.size,0);
});
test('stalled sockets reconnect instead of accumulating unbounded state', () => {
 let terminated=false,sent=0;
 const socket={readyState:1,bufferedAmount:1048577,terminate(){terminated=true;},send(){sent++;}};
 assert.equal(sendRoomMessage(socket,'state'),false);assert.ok(terminated);assert.equal(sent,0);
 socket.bufferedAmount=0;assert.equal(sendRoomMessage(socket,'state'),true);assert.equal(sent,1);
});
