// Local real WebSocket load check. Run against an isolated temporary database.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
const dir=await mkdtemp(path.join(tmpdir(),'uno-load-'));
process.env.NODE_ENV='test';process.env.DATA_DIR=dir;
const {server,wss,roomManager}=await import('../server/src/index.js');
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const sockets=[],latencies=[],delay=monitorEventLoopDelay({resolution:10});delay.enable();
const rooms=Number(process.env.LOAD_ROOMS||100);
const players=Number(process.env.LOAD_PLAYERS||4);
const mode=process.env.LOAD_MODE||'classic';
const handSize=Number(process.env.LOAD_HAND_SIZE||7);
if(!Number.isInteger(players)||players<2||players>(mode==='classic'?10:6))throw Error('Unsupported player count');
function request(ws,payload,type,predicate=()=>true){return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{ws.off('message',handler);reject(Error('Timed out: '+payload.type));},10000);
 function handler(raw){const msg=JSON.parse(raw);if(msg.type==='error'){clearTimeout(timer);ws.off('message',handler);reject(Error(msg.message));}else if(msg.type===type && predicate(msg)){clearTimeout(timer);ws.off('message',handler);resolve(msg);}}
 ws.on('message',handler);ws.send(JSON.stringify(payload));
});}
try {
 const started=performance.now();
 await Promise.all(Array.from({length:rooms},async(_,i)=>{
  let roomId;const members=[];
  for(let j=0;j<players;j++){
   const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}`);sockets.push(ws);
   await new Promise((r,e)=>{ws.once('open',r);ws.once('error',e);});
   const joined=await request(ws,{type:j?'join':'create',roomId,playerName:`P${i}-${j}`,data:{mode,houseRules:{startingHandSize:handSize,turnDuration:60,mercyKnockoutLimit:50}}},'joined');
   roomId=joined.data.roomId;members.push({ws,...joined.data});
  }
  for(let round=0;round<10;round++)for(const member of members){
   const t=performance.now();await request(member.ws,{type:'ready',roomId,sessionToken:member.sessionToken,data:{isReady:round%2===0}},'room:state',msg=>msg.data.gameState.players.some(p=>p.id===member.playerId && p.isReady===(round%2===0)));latencies.push(performance.now()-t);
  }
  for(const member of members) await request(member.ws,{type:'ready',roomId,data:{isReady:true}},'room:state',msg=>msg.data.gameState.players.some(p=>p.id===member.playerId && p.isReady));
  await request(members[0].ws,{type:'start_game',roomId},'room:state',msg=>msg.data.gameState.status==='playing');
  for(let move=0;move<20;move++){
   const room=roomManager.getRoom(roomId);if(room.status!=='playing')break;const member=members.find(p=>p.playerId===room.players[room.currentTurn].id);
   const view=roomManager.getClientView(roomId,member.playerId);
   const type=['opening_color','color_roulette'].includes(room.pendingAction?.type)?'choose_color':view.canPlayCards.length?'play_card':view.canPass?'pass_turn':'draw_card';
   const chosenColor=mode==='flip'&&room.flipSide==='dark'?'pink':'red';
   const data={chosenColor,cardId:view.canPlayCards[0],targetPlayerId:room.players.find(p=>!p.isEliminated&&p.id!==member.playerId)?.id};
   const version=room.actionVersion||0,beforeState=JSON.stringify(view.gameState),t=performance.now();
   await request(member.ws,{type,roomId,data},'room:state',msg=>mode==='flip'?JSON.stringify(msg.data.gameState)!==beforeState:msg.data.gameState.actionVersion>version);
   latencies.push(performance.now()-t);
  }
 }));
 latencies.sort((a,b)=>a-b);
 console.log(JSON.stringify({rooms,playersPerRoom:players,mode,startingHandSize:handSize,connections:sockets.length,updates:latencies.length,seconds:(performance.now()-started)/1000,p50ms:latencies[Math.floor(latencies.length*.5)],p95ms:latencies[Math.floor(latencies.length*.95)],p99ms:latencies[Math.floor(latencies.length*.99)],eventLoopP99ms:delay.percentile(99)/1e6,rssMB:process.memoryUsage().rss/1048576},null,2));
} finally {
 delay.disable();for(const ws of sockets)ws.terminate();
 await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));
 // Windows may hold SQLite open until process exit; leave only the temporary test directory.
}

