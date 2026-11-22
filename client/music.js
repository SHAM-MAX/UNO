import { sounds } from './audio.js';

// Original late-night lounge groove: Dm9 / Bbmaj9 / Gm9 / A7(b9).
// Sparse electric-piano phrases, syncopated bass, dry drums; no borrowed recordings.
const harmony=[{root:38,notes:[53,57,60,64]},{root:34,notes:[53,57,60,62]},{root:43,notes:[53,58,62,69]},{root:33,notes:[55,58,61,64]}];
const phrase=[[null,null,69,null,null,67,null,null],[65,null,null,null,null,null,64,null],[null,65,null,null,69,null,null,null],[null,null,72,null,null,69,null,null],[null,null,70,null,null,null,69,null],[67,null,null,null,null,65,null,null],[null,64,null,null,null,null,61,null],[64,null,null,null,null,null,null,null]];
const hz=midi=>440*2**((midi-69)/12);
const nextTask=()=>new Promise(resolve=>setTimeout(resolve,0));
const idleTask=()=>new Promise(resolve=>{if(window.requestIdleCallback)requestIdleCallback(resolve,{timeout:1200});else setTimeout(resolve,50);});
export async function composeTheme(style='warm') {
  const bpm=style==='mercy'?112:style==='flip'?108:98;
  const beat=60/bpm,duration=24*4*beat,rate=24000,frames=Math.ceil(duration*rate);
  const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
  if(!Offline)throw Error('Offline audio is unavailable');
  const ctx=new Offline(2,frames+rate*2,rate),bus=ctx.createGain();bus.gain.value=.8;
  const glue=ctx.createDynamicsCompressor();glue.threshold.value=-16;glue.knee.value=16;glue.ratio.value=2;glue.attack.value=.015;glue.release.value=.16;bus.connect(glue);glue.connect(ctx.destination);
  function note(midi,time,length,volume,type='sine',pan=0,partial=1) {
    const osc=ctx.createOscillator(),amp=ctx.createGain(),position=ctx.createStereoPanner();
    osc.type=type;osc.frequency.setValueAtTime(hz(midi)*partial,time);position.pan.value=pan;
    amp.gain.setValueAtTime(.0001,time);amp.gain.exponentialRampToValueAtTime(volume,time+.018);amp.gain.exponentialRampToValueAtTime(.0001,time+length);
    osc.connect(amp);amp.connect(position);position.connect(bus);osc.start(time);osc.stop(time+length+.02);
  }
  function keys(notes,time,length,volume=.055) {
    notes.forEach((m,i)=>{const pan=(i%2?1:-1)*.28;note(m,time+i*.007,length,volume,'sine',pan);note(m,time+i*.007,length*.45,volume*.17,'sine',pan,2.003);note(m,time+i*.007,length*.22,volume*.045,'sine',pan,3.99);});
  }
  const noise=ctx.createBuffer(1,rate/4,rate),samples=noise.getChannelData(0);let seed=4291;
  for(let i=0;i<samples.length;i++){seed=seed*16807%2147483647;samples[i]=seed/2147483647*2-1;}
  function drum(time,kind,accent=1) {
    if(kind==='kick'){
      const osc=ctx.createOscillator(),amp=ctx.createGain();osc.frequency.setValueAtTime(115,time);osc.frequency.exponentialRampToValueAtTime(43,time+.075);
      amp.gain.setValueAtTime(.3*accent,time);amp.gain.exponentialRampToValueAtTime(.0001,time+.23);osc.connect(amp);amp.connect(bus);osc.start(time);osc.stop(time+.24);return;
    }
    const src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),amp=ctx.createGain(),pan=ctx.createStereoPanner();src.buffer=noise;
    const snare=kind==='snare';filter.type=snare?'bandpass':'highpass';filter.frequency.value=snare?1650:7200;filter.Q.value=snare?.65:.4;
    pan.pan.value=snare?-.08:.25;amp.gain.setValueAtTime((snare?.13:.032)*accent,time);amp.gain.exponentialRampToValueAtTime(.0001,time+(snare?.13:.045));
    src.connect(filter);filter.connect(amp);amp.connect(pan);pan.connect(bus);src.start(time);src.stop(time+.15);
    if(snare)note(50,time,.06,.055,'triangle');
  }
  for(let bar=0;bar<24;bar++){
    const start=bar*4*beat,chord=harmony[Math.floor((bar%8)/2)],next=harmony[(Math.floor((bar%8)/2)+1)%4];
    // Chord stabs leave room for conversation and game effects.
    keys(chord.notes,start+.12*beat,beat*2.5);
    if(bar%2===1)keys(chord.notes,start+2.75*beat,beat*.9,.038);
    const bassSteps=bar%2===0?[0,3,7,10,14]:[0,6,9,12,15];
    bassSteps.forEach((step,i)=>{
      const m=step===15?next.root-1:chord.root+(i===2?7:0),time=start+step*beat/4;
      note(m,time,beat*(step===15?.22:.52),.22,'sine');note(m,time,beat*.25,.025,'triangle');
    });
    for(let step=0;step<8;step++){
      const time=start+step*beat/2+(step%2?beat*.055:0);
      drum(time,'hat',step%2?.7:1);
      const lead=phrase[bar%8][step];
      if(lead!==null && bar%8>=2)keys([lead],time,beat*.9,.045);
      if(style==='flip'&&[3,7].includes(step))note(chord.notes[step===3?1:3],time,beat*.3,.035,'triangle',-.35);
    }
    for(const step of (style==='mercy'?[0,1.5,2,2.75,3.5]:[0,1.75,2.5]))drum(start+step*beat,'kick',step===0?1:.75);
    drum(start+beat,'snare');drum(start+3*beat,'snare');
    if(bar%4===3)drum(start+3.75*beat,'snare',.28);
    if(bar%4===3)await nextTask();
  }
  const rendered=await ctx.startRendering(),buffer=ctx.createBuffer(2,frames,rate);
  let peak=0,energy=0;
  for(let ch=0;ch<2;ch++){
    const source=rendered.getChannelData(ch),out=buffer.getChannelData(ch);out.set(source.subarray(0,frames));
    // Carry the final chord release across the loop boundary.
    for(let i=frames;i<source.length;i++)out[i-frames]+=source[i];
    for(let i=0;i<frames;i++){peak=Math.max(peak,Math.abs(out[i]));energy+=out[i]*out[i];if(i>0&&i%65536===0)await nextTask();}
  }
  const rms=Math.sqrt(energy/(frames*2)),gain=Math.min(.85/Math.max(peak,.001),.095/Math.max(rms,.001));
  for(let ch=0;ch<2;ch++){const out=buffer.getChannelData(ch);for(let i=0;i<frames;i++){out[i]*=gain;if(i>0&&i%65536===0)await nextTask();}for(let i=0;i<120;i++){out[i]*=i/120;out[frames-1-i]*=i/120;}}
  return buffer;
}

class ThemeMusic {
  constructor(){
    this.enabled=localStorage.getItem('uno_music_enabled')!=='false';
    const saved=localStorage.getItem('uno_music_volume');this.volume=saved===null?.22:Math.max(0,Math.min(1,Number(saved)||0));
    this.scene='lobby';this.cache=new Map();this.voices=new Set();this.token=0;this.unlocked=false;
  }
  init(){
    const toggle=document.getElementById('settingMusicToggle'),slider=document.getElementById('settingMusicVolumeSlider');
    toggle?.addEventListener('change',()=>this.setEnabled(toggle.checked));
    slider?.addEventListener('input',()=>{this.setVolume(Number(slider.value)/100);this.syncControls();});
    this.syncControls();
    const unlock=()=>{if(!this.unlocked){sounds.init();if(sounds.ctx){this.unlocked=true;this.update();}}};
    document.addEventListener('pointerdown',unlock,{passive:true});document.addEventListener('keydown',unlock);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stop();else this.update();});
    window.addEventListener('pagehide',()=>this.stop());
    window.addEventListener('pageshow',()=>this.update());
  }
  syncControls(){
    const toggle=document.getElementById('settingMusicToggle'),slider=document.getElementById('settingMusicVolumeSlider'),value=document.getElementById('settingMusicVolumeValue');
    if(toggle)toggle.checked=this.enabled;if(slider)slider.value=String(Math.round(this.volume*100));if(value)value.textContent=Math.round(this.volume*100)+'%';
  }
  setScene(scene){if(this.scene===scene)return;this.scene=scene;this.update();}
  setEnabled(value){this.enabled=Boolean(value);localStorage.setItem('uno_music_enabled',String(this.enabled));this.update();}
  setVolume(value){this.volume=Math.max(0,Math.min(1,Number(value)||0));localStorage.setItem('uno_music_volume',String(this.volume));const now=sounds.ctx?.currentTime||0;for(const voice of this.voices)if(!voice.retiring)voice.gain.gain.setTargetAtTime(this.level(),now,.08);if(!this.voices.size&&this.enabled&&this.volume)this.update();}
  level(){return this.volume*(this.scene==='lobby'?1:this.scene==='victory'?.35:.75);}
  stop(){this.token++;for(const voice of this.voices){try{voice.source.stop();}catch{}voice.source.disconnect();voice.gain.disconnect();}this.voices.clear();this.currentStyle=null;}
  async update(){
    const token=++this.token;
    if(!this.unlocked||!this.enabled||!this.volume||document.hidden){this.stop();return;}
    const style=this.scene==='no_mercy'?'mercy':this.scene==='flip'?'flip':'warm';
    if(this.currentStyle===style&&this.voices.size){this.setVolume(this.volume);return;}
    try{
      if(!this.cache.has(style)){await idleTask();if(token!==this.token||document.hidden)return;this.cache.set(style,composeTheme(style));}
      const buffer=await this.cache.get(style);
      if(token!==this.token||document.hidden||!this.enabled)return;
      sounds.init();const ctx=sounds.ctx;if(!ctx)return;
      await ctx.resume();if(token!==this.token)return;
      const now=ctx.currentTime;
      for(const voice of this.voices){voice.retiring=true;voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setTargetAtTime(0,now,.2);try{voice.source.stop(now+.85);}catch{}}
      const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;source.loop=true;
      source.connect(gain);gain.connect(ctx.destination);gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(this.level(),now+.8);
      const voice={source,gain,retiring:false};this.voices.add(voice);this.currentStyle=style;
      source.onended=()=>{source.disconnect();gain.disconnect();this.voices.delete(voice);};source.start();
      // Retain at most two decoded themes on mobile.
      for(const key of this.cache.keys())if(this.cache.size>2&&key!==style)this.cache.delete(key);
    }catch{this.cache.delete(style);this.currentStyle=null;}
  }
}
export const music=new ThemeMusic();
