import {cardAtlases} from './card-atlas-manifest.js';
const loaded=new Set(),pending=new Map(),retained=new Map();
export function cardArtReady(mode){return loaded.has(mode);}
export function prepareCardArt(mode){
 if(loaded.has(mode))return Promise.resolve();if(pending.has(mode))return pending.get(mode);
 const atlas=cardAtlases[mode];if(!atlas)return Promise.reject(new Error('Unknown card artwork'));
 const task=(async()=>{const image=new Image();image.decoding='async';image.src=atlas.url;await image.decode();retained.set(mode,image);loaded.add(mode);})();
 pending.set(mode,task);task.catch(()=>pending.delete(mode));return task;
}
export function atlasFace(mode,path){
 const atlas=cardAtlases[mode],index=atlas?.paths.indexOf(path);if(index===undefined||index<0)return null;
 const x=index%atlas.cols,y=Math.floor(index/atlas.cols);
 return '<span class="card-atlas-face" data-art-src="'+path+'" aria-hidden="true" style="background-image:url('+atlas.url+');background-size:'+atlas.cols*100+'% '+atlas.rows*100+'%;background-position:'+x/(atlas.cols-1)*100+'% '+(atlas.rows===1?0:y/(atlas.rows-1)*100)+'%"></span>';
}
export function gateCardArt(app,view){
 const mode=view.gameState.mode;
 if(view.gameState.status==='lobby'){prepareCardArt(mode).catch(()=>{});return false;}
 if(cardArtReady(mode)&&!app.pendingArtworkView)return false;
 if(view.gameState.status!=='playing'&&!app.pendingArtworkView)return false;
 app.pendingArtworkView=view;
 let overlay=document.getElementById('cardArtworkLoading');if(!overlay){overlay=document.createElement('div');overlay.id='cardArtworkLoading';overlay.setAttribute('role','status');overlay.innerHTML='<div><span class="art-loading-ring"></span><strong>Preparing your table</strong><p>Loading the complete card artwork once for smooth play.</p><button type="button" hidden>Retry artwork</button><button type="button" data-art-leave>Leave table</button></div>';document.body.append(overlay);}
 overlay.querySelector('[data-art-leave]').onclick=()=>app.confirmLeaveRoom();
 overlay.hidden=false;
 if(app.artworkLoadingMode===mode)return true;
 app.artworkLoadingMode=mode;const roomId=app.roomId;
 const load=()=>{overlay.querySelector('button').hidden=true;prepareCardArt(mode).then(()=>{if(app.artworkLoadingMode!==mode)return;app.artworkLoadingMode=null;const latest=app.pendingArtworkView;app.pendingArtworkView=null;overlay.hidden=true;if(app.roomId===roomId&&latest)app.handleRoomState(latest);}).catch(()=>{if(app.artworkLoadingMode!==mode||app.roomId!==roomId)return;overlay.querySelector('p').textContent='Card artwork could not load. Check your connection and retry.';const retry=overlay.querySelector('button');retry.hidden=false;retry.onclick=load;});};load();return true;
}
export function clearCardArtGate(app){app.pendingArtworkView=null;app.artworkLoadingMode=null;const overlay=document.getElementById('cardArtworkLoading');if(overlay)overlay.hidden=true;}
