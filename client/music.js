import { sounds } from './audio.js';

// Original 24-bar composition: Cmaj9 / Am7 / Fmaj7 / G6 with a playful mallet lead.
// No external recordings, copied melodies, downloads or network requests.
const melody = [
  [76,79,81,79,74,76,72,74], [76,79,84,81,79,76,74,null],
  [76,81,83,81,79,76,74,72], [71,74,79,76,74,null,72,74],
  [77,81,84,81,79,77,76,72], [74,77,81,79,77,74,72,null],
  [74,79,83,81,79,74,76,74], [71,74,79,76,74,71,72,null],
];
const chords = [[48,55,59,64],[45,52,55,60],[41,48,52,57],[43,50,55,59]];
const hz = midi => 440 * 2 ** ((midi-69)/12);
const nextTask = () => new Promise(resolve => setTimeout(resolve,0));

export async function composeTheme(style='warm') {
  const bpm=style==='mercy'?120:style==='flip'?112:104;
  const beat=60/bpm, bars=24, duration=bars*4*beat;
  const Offline=window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if(!Offline)throw Error('Offline audio is unavailable');
  const ctx=new Offline(2,Math.ceil(duration*24000),24000);
  const output=ctx.createGain();output.gain.value=.7;output.connect(ctx.destination);
  function tone(midi,time,length,volume,type='sine',bend) {
    const oscillator=ctx.createOscillator(),gain=ctx.createGain();
    oscillator.type=type;oscillator.frequency.setValueAtTime(hz(midi),time);
    if(bend)oscillator.frequency.exponentialRampToValueAtTime(hz(bend),time+length);
    gain.gain.setValueAtTime(.0001,time);gain.gain.exponentialRampToValueAtTime(volume,time+.009);
    gain.gain.exponentialRampToValueAtTime(.0001,time+length);
    oscillator.connect(gain);gain.connect(output);oscillator.start(time);oscillator.stop(time+length+.01);
  }
  const noise=ctx.createBuffer(1,2400,24000),data=noise.getChannelData(0);
  let seed=731;for(let i=0;i<data.length;i++){seed=(seed*16807)%2147483647;data[i]=(seed/2147483647*2-1);}
  function percussion(time,snare=false) {
    const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    source.buffer=noise;filter.type=snare?'bandpass':'highpass';filter.frequency.value=snare?1800:6500;
    gain.gain.setValueAtTime(snare?.055:.023,time);gain.gain.exponentialRampToValueAtTime(.0001,time+(snare?.095:.045));
    source.connect(filter);filter.connect(gain);gain.connect(output);source.start(time);source.stop(time+.1);
  }
  for(let bar=0;bar<bars;bar++) {
    const start=bar*4*beat,chord=chords[Math.floor((bar%8)/2)];
    for(let step=0;step<8;step++) {
      // Slight eighth-note swing gives the phrase a relaxed, bouncing rhythm.
      const time=start+step*beat/2+(step%2?beat*.065:0);
      const note=melody[bar%8][step];
      if(note!==null){tone(note,time,beat*.58,.2,'sine');tone(note+12,time,beat*.18,.035,'sine');}
      if(step%2===1)chord.slice(1).forEach(n=>tone(n+12,time,beat*.28,.025,'triangle'));
      percussion(time);
      if(style==='flip' && step%2===0)tone(chord[(step/2)%4]+24,time,beat*.3,.055,'triangle');
    }
    for(let step=0;step<4;step++) {
      const time=start+step*beat;
      tone(chord[0]+(step===2?7:0),time,beat*.65,.18,'sine');
      if(step%2===0 || style==='mercy')tone(43,time,.11,.18,'sine',25);
      else percussion(time,true);
      if(style==='mercy' && step%2===1)percussion(time,true);
    }
    if(bar%4===3)await nextTask();
  }
  const buffer=await ctx.startRendering();
  // Finish the final release at zero so looping never clicks.
  for(let channel=0;channel<buffer.numberOfChannels;channel++){
    const samples=buffer.getChannelData(channel),fade=240;
    for(let i=0;i<fade;i++){samples[i]*=i/fade;samples[samples.length-1-i]*=i/fade;}
  }
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
      if(!this.cache.has(style))this.cache.set(style,composeTheme(style));
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
