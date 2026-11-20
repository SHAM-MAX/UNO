// Inline, network-independent faces keep every move readable before artwork arrives.
const colors={red:'#e52731',yellow:'#f4cb28',green:'#159747',blue:'#1672c9',teal:'#078d91',orange:'#ee7425',pink:'#d9388e',purple:'#8825ae',wild:'#15171b'};
export function instantFace(face,back=false){
 const color=colors[face?.color]||colors.wild,type=face?.type||'wild';
 let label=back?'UNO':type==='number'?String(Number(face.value)||0):type.includes('draw10')?'+10':type.includes('draw6')?'+6':type.includes('draw5')?'+5':type.includes('draw4')?'+4':type.includes('draw2')?'+2':type.includes('draw1')?'+1':type.includes('draw_color')?'+' : type.includes('roulette')?'?':type==='discard_all'?'×':type.includes('skip')?'⊘':type.includes('reverse')?'↔':type==='flip'?'↶':'W';
 const subtitle=back||type==='number'?'':type.includes('roulette')?'ROULETTE':type==='wild_draw_color'?'DRAW COLOR':type.includes('reverse')?'REVERSE':type==='discard_all'?'DISCARD ALL':type==='skip_everyone'?'SKIP ALL':type.includes('skip')?'SKIP':type==='flip'?'FLIP':type.includes('draw')?'DRAW':'WILD';
 const ink=face?.color==='yellow'?'#111':'#fff';
 const wild=!back&&face?.color==='wild'?'<path d="M50 75V27a48 48 0 0 1 0 96Z" fill="#1870c9"/><path d="M50 75H18a32 48 0 0 1 32-48Z" fill="#df2435"/><path d="M50 75v48a32 48 0 0 1-32-48Z" fill="#eac92d"/><path d="M50 75h32a32 48 0 0 1-32 48Z" fill="#159747"/>':'';
 return `<svg class="card-instant-face" viewBox="0 0 100 150" aria-hidden="true"><rect x="1.5" y="1.5" width="97" height="147" rx="10" fill="#fff"/><rect x="6" y="6" width="88" height="138" rx="7" fill="${back?'#171717':color}"/><ellipse cx="50" cy="75" rx="33" ry="54" transform="rotate(27 50 75)" fill="${back?'#df2435':'#ffffff24'}" stroke="#fff" stroke-width="2"/>${wild}<text x="50" y="90" text-anchor="middle" font-family="Arial,sans-serif" font-size="${label.length>2?31:43}" font-weight="900" fill="${back?'#ffe234':ink}" stroke="#111" stroke-width="1" paint-order="stroke">${label}</text>${subtitle?`<text x="50" y="113" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="900" fill="${ink}">${subtitle}</text>`:''}${back?'':`<text x="12" y="24" font-family="Arial,sans-serif" font-size="16" font-weight="900" fill="${ink}">${label}</text>`}</svg>`;
}
// Capture load events for all freshly rendered cards, including animation ghosts.
if(typeof document!=='undefined'){
 document.addEventListener('load',event=>{if(event.target.matches?.('.game-card img'))event.target.classList.add('card-art-ready');},true);
 document.addEventListener('error',event=>{if(event.target.matches?.('.game-card img'))event.target.classList.remove('card-art-ready');},true);
}
