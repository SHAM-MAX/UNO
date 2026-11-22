// Bounded, local-only diagnostics. No analytics or player data leaves the browser.
export function initPerformance(app){
 const samples={paint:[],ack:[],render:[],frame:[]},counters={handRenders:0,handSkips:0,stateSkips:0,longTasks:0,resyncs:0,frames:0,delayedFrames:0};
 const record=(kind,value)=>{if(!samples[kind]||!Number.isFinite(value))return;samples[kind].push(Math.max(0,value));if(samples[kind].length>120)samples[kind].shift();};
 app.performanceMetrics={record,bump:name=>{counters[name]=(counters[name]||0)+1;},snapshot:()=>{const result={quality:document.body.classList.contains('performance-lite')?'lite':'full',counters:{...counters}};for(const [kind,values]of Object.entries(samples)){const sorted=[...values].sort((a,b)=>a-b);result[kind]={count:values.length,p50:sorted[Math.floor(sorted.length*.5)]||0,p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]||0};}return result;}};
 if(navigator.connection?.saveData||(navigator.deviceMemory&&navigator.deviceMemory<=4)||(navigator.hardwareConcurrency&&navigator.hardwareConcurrency<=4))document.body.classList.add('performance-lite');
 let frame=0,last=0,windowFrames=[];
 const tick=now=>{frame=0;if(document.hidden||app.gameState?.status!=='playing'){last=0;return;}if(last){const delta=now-last;if(delta<2000){counters.frames++;if(delta>25)counters.delayedFrames++;record('frame',delta);windowFrames.push(delta);if(windowFrames.length===180){if(windowFrames.filter(ms=>ms>25).length>54)document.body.classList.add('performance-lite');windowFrames=[];}}}last=now;frame=requestAnimationFrame(tick);};
 app.syncPerformance=()=>{if(!frame&&!document.hidden&&app.gameState?.status==='playing')frame=requestAnimationFrame(tick);};
 try{const observer=new PerformanceObserver(list=>{if(document.hidden||app.gameState?.status!=='playing')return;counters.longTasks+=list.getEntries().length;});observer.observe({type:'longtask',buffered:false});}catch{}
 document.addEventListener('visibilitychange',()=>{cancelAnimationFrame(frame);frame=0;last=0;windowFrames=[];if(document.hidden){app.skipNextStateAnimations=true;app.cancelCardDrag?.();app.clearClassicAnimations?.();}else{if(app.backgroundRoomView){const latest=app.backgroundRoomView;app.backgroundRoomView=null;app.skipNextStateAnimations=true;app.handleRoomState(latest);}app.syncPerformance();}});
}
