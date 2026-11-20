import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import {RoomManager} from '../src/roomManager.js';
import {createInviteCode,rulesPreset} from '../../client/social-features.js';
function setup(){const rm=new RoomManager({loadAllActiveRooms:()=>[],saveRoom(){},saveSession(){},deleteRoom(){}}),host=rm.createRoom('Host','classic'),guest=rm.joinRoom(host.roomId,'Guest');return {rm,host,guest,room:rm.getRoom(host.roomId)};}
test('Room lock blocks new joins but permits an existing session to reconnect',()=>{
 const {rm,host,guest,room}=setup();
 assert.equal(rm.manageLobby(host.roomId,guest.playerId,'lock',null,true).success,false);
 assert.equal(rm.manageLobby(host.roomId,host.playerId,'lock',null,'yes').success,false);
 assert.ok(rm.manageLobby(host.roomId,host.playerId,'lock',null,true).success);
 assert.equal(rm.joinRoom(host.roomId,'New').success,false);assert.ok(rm.joinRoom(host.roomId,'Guest',guest.sessionToken).success);
 assert.equal(rm.getClientView(host.roomId,host.playerId).gameState.isLocked,true);
 rm.manageLobby(host.roomId,host.playerId,'lock',null,false);assert.ok(rm.joinRoom(host.roomId,'New').success);assert.equal(room.isLocked,false);
});
test('Host transfer and removal enforce roles and lobby status',()=>{
 const {rm,host,guest,room}=setup();
 assert.equal(rm.manageLobby(host.roomId,host.playerId,'remove',host.playerId).success,false);
 assert.ok(rm.manageLobby(host.roomId,host.playerId,'transfer',guest.playerId).success);assert.equal(room.players.filter(p=>p.isHost).length,1);
 assert.equal(rm.manageLobby(host.roomId,host.playerId,'remove',guest.playerId).success,false);
 assert.ok(rm.manageLobby(host.roomId,guest.playerId,'remove',host.playerId).success);
 assert.equal(room.players.some(p=>p.id===host.playerId),false);assert.equal(rm.joinRoom(host.roomId,'Host',host.sessionToken).success,false);
 room.status='playing';assert.equal(rm.manageLobby(host.roomId,guest.playerId,'lock',null,true).success,false);
});
test('QR invitation decodes to the exact link without a third-party service',async()=>{
 const url='https://uno-arena-6uk9.onrender.com/?room=ABC123',code=await createInviteCode(url),scale=6,padding=4,n=code.getModuleCount(),width=(n+padding*2)*scale,data=new Uint8ClampedArray(width*width*4);data.fill(255);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(code.isDark(y,x))for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const i=(((y+padding)*scale+dy)*width+(x+padding)*scale+dx)*4;data[i]=data[i+1]=data[i+2]=0;}
 assert.equal(jsQR(data,width,width)?.data,url);
});
for(const mode of ['classic','flip','no_mercy'])test(mode+' rule presets preserve the selected mode rules',()=>{
 const quick=rulesPreset(mode,'quick');assert.equal(quick.startingHandSize,5);assert.equal(quick.turnDuration,15);
 const standard=rulesPreset(mode,'standard');assert.equal(standard.startingHandSize,7);
 const {rm,host}=setup();assert.ok(rm.setHouseRules(host.roomId,host.playerId,quick).success);assert.equal(rm.getRoom(host.roomId).houseRules.turnDuration,15);
 const chaos=rulesPreset(mode,'chaos');assert.equal(chaos.startingHandSize,10);assert.equal(chaos.stackingAllowed,true);
 if(mode==='no_mercy')assert.equal(chaos.mercyKnockoutLimit,25);
});
