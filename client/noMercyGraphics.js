const COLORS = { red: '#ed252a', yellow: '#ffd326', green: '#15964b', blue: '#1686d0', wild: '#101012' };
const TYPES = new Set(['number','skip','reverse','draw2','draw4','discard_all','skip_everyone','wild_reverse_draw4','wild_draw6','wild_draw10','wild_color_roulette']);
const LABELS = {skip:'Skip',reverse:'Reverse',draw2:'Draw two',draw4:'Draw four',discard_all:'Discard all',skip_everyone:'Skip everyone',wild_reverse_draw4:'Wild reverse draw four',wild_draw6:'Wild draw six',wild_draw10:'Wild draw ten',wild_color_roulette:'Wild color roulette'};
const outline = 'stroke="#111" stroke-width="3" stroke-linejoin="round"';
function packet(x,y,color,angle=0) { return `<g transform="translate(${x} ${y}) rotate(${angle})"><rect width="24" height="37" rx="3" fill="${color}" ${outline}/></g>`; }
function reverse() {return '<path d="M-29 -9 4 -36 4 -21 27 -21 27 -5 4 -5 4 10ZM29 10-4 37-4 22-27 22-27 6-4 6-4-9Z" fill="white" stroke="#111" stroke-width="3" stroke-linejoin="round"/>';}
function skip(all=false) {return `<g fill="none" stroke="#111" stroke-width="9"><circle r="29"/><path d="M-21 21 21-21${all?'M-21-21 21 21':''}"/></g>`;}
function artwork(face) {
  if(face.type==='number') return `<text y="32" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="90" font-style="italic" fill="${face.color==='yellow'?'#f7c919':COLORS[face.color]}" stroke="#111" stroke-width="3" paint-order="stroke">${face.value}</text>`;
  if(face.type==='skip'||face.type==='skip_everyone') return skip(face.type==='skip_everyone');
  if(face.type==='reverse') return reverse();
  if(face.type==='discard_all') return `${packet(-35,-18,COLORS[face.color],-18)}${packet(-11,-24,COLORS[face.color],8)}<path d="M-26 33H24M5 19 24 33 5 47" fill="none" stroke="#111" stroke-width="7" stroke-linejoin="round"/>`;
  if(face.type==='wild_color_roulette') return ['#ed252a','#1686d0','#15964b','#ffd326'].map((c,i)=>`<g transform="rotate(${i*90})">${packet(-12,-42,c)}<circle cx="-4" cy="-29" r="2"/><circle cx="4" cy="-29" r="2"/><path d="M-5-22Q0-18 5-22" fill="none" stroke="#111" stroke-width="2"/></g>`).join('');
  const count=({draw2:2,draw4:4,wild_reverse_draw4:4,wild_draw6:6,wild_draw10:10})[face.type];
  const palettes=['#ed252a','#1686d0','#ffd326','#15964b'];
  const cards=Array.from({length:count},(_,i)=>packet(-35+(i%4)*16,-35+Math.floor(i/4)*24,face.color==='wild'?palettes[i%4]:COLORS[face.color],i%2?8:-8)).join('');
  return cards+(face.type==='wild_reverse_draw4'?`<g transform="scale(.72)">${reverse()}</g>`:'');
}
export function noMercyFaceKey(face) {
  if(!face || !TYPES.has(face.type) || !COLORS[face.color]) throw new Error('Unknown No Mercy card face');
  if(face.type==='number' && (!Number.isInteger(face.value)||face.value<0||face.value>9||face.color==='wild')) throw new Error('Invalid No Mercy number');
  if(face.type.startsWith('wild_') !== (face.color==='wild')) throw new Error('Invalid No Mercy colour/type');
  return `${face.color}:${face.type}${face.type==='number'?`:${face.value}`:''}`;
}
export function renderNoMercyFace(face) {
  const key=noMercyFaceKey(face);
  const label=face.type==='number'?`${face.color} ${face.value}`:`${face.color==='wild'?'':face.color+' '}${LABELS[face.type]}`;
  const amount=({draw2:'+2',draw4:'+4',wild_draw6:'+6',wild_draw10:'+10',wild_reverse_draw4:'↔+4'})[face.type];
  const corner=face.type==='number'?String(face.value):amount;
  const mark=corner?`<text x="10" y="25" fill="white" stroke="#111" stroke-width=".9" paint-order="stroke" font-size="20" font-weight="900" font-style="italic">${corner}</text>`:`<g transform="translate(23 23) scale(.28)">${artwork(face)}</g>`;
  return `<svg class="nm-vector-face" data-face="${key}" viewBox="0 0 120 180" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="118" height="178" rx="10" fill="#faf9f3" stroke="#191919" stroke-width="1.5"/><rect x="6" y="6" width="108" height="168" rx="7" fill="${COLORS[face.color]}"/><ellipse cx="60" cy="90" rx="43" ry="67" transform="rotate(25 60 90)" fill="#fffdf6"/><g transform="translate(60 90)">${artwork(face)}</g><g font-family="Arial,sans-serif">${mark}<g transform="rotate(180 60 90)">${mark}</g></g></svg>`;
}
export function renderNoMercyBack() { return '<svg class="nm-vector-face" viewBox="0 0 120 180" role="img" aria-label="No Mercy card back" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="118" height="178" rx="10" fill="#faf9f3" stroke="#111"/><rect x="6" y="6" width="108" height="168" rx="7" fill="#b91520"/><path d="M8 125 95 8H112L26 172H8Z" fill="#e72a2c"/><ellipse cx="60" cy="83" rx="49" ry="35" transform="rotate(-28 60 83)" fill="#171517"/><g transform="rotate(-17 60 90)" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-style="italic" font-weight="900"><text x="60" y="91" font-size="39" fill="#ffd32b" stroke="#fff" stroke-width="1" paint-order="stroke">UNO</text><text x="60" y="115" font-size="15" fill="white" stroke="#111" stroke-width="3" paint-order="stroke">NO MERCY</text></g></svg>'; }
