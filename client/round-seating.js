// Seats run clockwise around the table; the local hand stays at the bottom.
export function opponentSeats(count){
 const maps={1:[[50,16]],2:[[11,44],[89,44]],3:[[11,44],[50,16],[89,44]],4:[[11,44],[36,16],[64,16],[89,44]],5:[[11,44],[28,16],[50,16],[72,16],[89,44]],6:[[11,60],[11,31],[36,16],[64,16],[89,31],[89,60]],7:[[11,60],[11,31],[28,16],[50,16],[72,16],[89,31],[89,60]],8:[[10,69],[10,43],[10,18],[40,16],[60,16],[90,18],[90,43],[90,69]],9:[[10,69],[10,43],[10,18],[34,16],[50,16],[66,16],[90,18],[90,43],[90,69]]};
 return maps[count]||[];
}
export function syncRoundSeating(app){
 const wide=innerWidth>innerHeight;
 document.body.classList.toggle('round-table-layout',Boolean(wide&&app.roomId&&!app.clientView?.isSpectator));
 const tools=document.getElementById('tableTools'),round=document.body.classList.contains('round-table-layout');if(tools){const target=round?document.body:document.querySelector('.table-felt');if(target&&tools.parentElement!==target)target.append(tools);}
 const row=app.el.opponentsRow;if(!row)return;
 const seats=opponentSeats(row.children.length);row.dataset.seatDensity=row.children.length>5?'compact':'normal';
 [...row.children].forEach((node,i)=>{const seat=seats[i];if(seat){node.style.setProperty('--seat-x',seat[0]+'%');node.style.setProperty('--seat-y',seat[1]+'%');node.dataset.seatSide=seat[0]<20?'left':seat[0]>80?'right':'top';}});
}
