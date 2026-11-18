(()=>{'use strict';
const data=JSON.parse(document.getElementById('scene').textContent);
const pre=document.getElementById('map'),status=document.getElementById('status'),dlg=document.getElementById('dialog');
const yes=document.getElementById('yes'),no=document.getElementById('no'),returnLink=document.getElementById('returnSignal');
const HOME='https://nudisco-ai.whoismister-e.workers.dev/';
const TOWN='https://nudisco-ai.github.io/our-town/';
const ALLOWED=new Set(['nudisco-ai.whoismister-e.workers.dev','nudisco-ai.neocities.org','nudisco-ai.github.io']);
function trustedReturn(value){
 try{
  const url=new URL(value,location.href);
  if(!['https:'].includes(url.protocol)||!ALLOWED.has(url.hostname)||url.username||url.password||url.port)return null;
  let path=decodeURIComponent(url.pathname);
  if(url.hostname==='nudisco-ai.github.io'){
   if(path==='/our-town/'||/^\/our-town\/houses\/h[0-9a-f]{16}\/(?:index\.html)?$/.test(path)||path==='/our-town/index.html'
      ||path==='/nudisco-machine-map/'||path==='/nudisco-machine-map/reading-room.html')return url.href;
   return null;
  }
  if(url.hostname==='nudisco-ai.neocities.org'){
   if(['/','/void/','/timetravel/'].includes(path))return url.href;
   return null;
  }
  const approved=['/','/index.html','/filter','/filter/','/time','/magic','/space','/space/','/void','/void/','/machine-map','/feed','/filter/feed'];
  if(approved.includes(path)||/^\/(?:filter\/)?post\/[^\/]+$/.test(path))return url.href;
  return null;
 }catch{return null;}
}
function updateReturn(){
 if(!returnLink)return;
 let from=null;
 // An entry marker may carry ONLY a safe original-NUDISCO page URL.
 try{
  const params=new URLSearchParams(location.hash.slice(1));
  if(params.has('from')&&params.get('from').length<512){
   const value=trustedReturn(params.get('from'));
   if(value && value.startsWith(HOME.slice(0,-1)))from=value;
  }
 }catch{}
 const ref=trustedReturn(document.referrer);
 const fallback=ref || (document.referrer?HOME:(data.back_href||HOME));
 returnLink.href=from||fallback;
 // A house reached from town goes back to its outdoor doorstep, not the last camera tile.
 if(data.kind==='house' && ref && ref.startsWith(TOWN) && !from)returnLink.href=data.back_href;
 if(returnLink.href===location.href)returnLink.href=data.back_href||HOME;
}
updateReturn();
const solid=new Set(data.grid.solid.map(([x,y])=>x+','+y));
const doorByCell=new Map(data.doors.map(d=>[d.x+','+d.y,d]));
for(const key of doorByCell.keys())solid.add(key); // fail closed even if a future generator misses a door solid
const rows=data.grid.rows, W=data.grid.width,H=data.grid.height;
const ponyCells=new Map();
for(const n of data.npcs){for(let dx=0;dx<4;dx++)ponyCells.set((n.x+dx)+','+n.y,n);}
const safeInk=s=>/^#[0-9a-f]{6}$/i.test(String(s))?String(s):'#96999a';
let player={x:data.initial[0],y:data.initial[1]},target=null,steps=[],tick=null,active=null,choice='no';
let cam={x:0,y:0,cols:70,lines:23},charW=8,lineH=18,padX=9,padY=9;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const walkable=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&!solid.has(x+','+y);
const enc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isPony=(x,y)=>ponyCells.has(x+','+y);
function cls(c,x,y){if(player.x===x&&player.y===y)return'player';if(isPony(x,y))return'pony';if(c==='D')return'door';if(c==='Y')return'tree';if(c==='+'||c==='|'||c==='-')return'house';if(c==='=')return'road';if(c==='~')return'water';if(c==='*')return'flower';return'';}
function measure(){
 const probe=document.createElement('span');probe.textContent='MMMMMMMMMM';
 probe.style.cssText='position:absolute;visibility:hidden;white-space:pre;font:inherit;';pre.append(probe);
 charW=probe.getBoundingClientRect().width/10;probe.remove();
 const cs=getComputedStyle(pre);lineH=parseFloat(cs.lineHeight)||18;padX=parseFloat(cs.paddingLeft)||0;padY=parseFloat(cs.paddingTop)||0;
 cam.cols=clamp(Math.floor((pre.clientWidth-2*padX)/charW)-1,20,95);
 cam.lines=clamp(Math.floor((innerHeight-170)/lineH),14,27);
}
function render(){
 cam.x=clamp(player.x-Math.floor(cam.cols/2),0,Math.max(0,W-cam.cols));
 cam.y=clamp(player.y-Math.floor(cam.lines/2),0,Math.max(0,H-cam.lines));
 let output='';
 for(let y=cam.y;y<Math.min(H,cam.y+cam.lines);y++){
  let last='',lastInk='',chunk='';
  const flush=()=>{if(!chunk)return;
   if(last==='pony'){const [ink,edge]=lastInk.split('|');output+='<span class="pony" style="--pony-ink:'+safeInk(ink)+';--pony-edge:'+safeInk(edge)+'">'+enc(chunk)+'</span>';}
   else output+=last?'<span class="'+last+'">'+enc(chunk)+'</span>':enc(chunk);
   chunk='';};
  for(let x=cam.x;x<Math.min(W,cam.x+cam.cols);x++){
    const c=player.x===x&&player.y===y?'@':rows[y][x];const curr=cls(c,x,y);
    const npc=ponyCells.get(x+','+y);
    const ink=curr==='pony'&&npc ? npc.ink+'|'+npc.edge : '';
    if(last!==curr||lastInk!==ink){flush();last=curr;lastInk=ink;}chunk+=c;
  }
  flush();output+='\n';
 }
 pre.innerHTML=output;
}
function say(message){status.textContent=message;}
function adjacent(x,y){return[[x-1,y],[x+1,y],[x,y-1],[x,y+1]];}
function doorstep(d){return[d.x,data.kind==='town'?d.y+1:d.y-1];}
function goDoor(d){const [x,y]=doorstep(d);moveAlong(bfs(x,y),()=>location.assign(d.href));}
function bfs(x,y){
 if(!walkable(x,y))return null;
 const key=(a,b)=>a+','+b;let queue=[[player.x,player.y]],head=0,seen=new Set([key(player.x,player.y)]),parents=new Map();
 while(head<queue.length){
  const [cx,cy]=queue[head++],k=key(cx,cy);if(cx===x&&cy===y){
   const path=[];let now=k;
   while(now!==key(player.x,player.y)){const [xx,yy]=now.split(',').map(Number);path.push([xx,yy]);now=parents.get(now);}return path.reverse();
  }
  for(const [nx,ny] of adjacent(cx,cy)){const nk=key(nx,ny);if(walkable(nx,ny)&&!seen.has(nk)){seen.add(nk);parents.set(nk,k);queue.push([nx,ny]);}}
 }
 return null;
}
function stop(){steps=[];if(tick){clearInterval(tick);tick=null;}target=null;}
function moveAlong(path,callback){
 stop();if(path===null){say('no path there');return;}
 say(''); // A previous blocked status must never survive a successful move.
 steps=path;
 if(!steps.length){callback?.();return;}
 tick=setInterval(()=>{
  const step=steps.shift();if(!step){stop();return;}
  player={x:step[0],y:step[1]};render();
  if(!steps.length){stop();callback?.();}
 },58);
}
function nearbyTarget(x,y){
 const opts=[[x,y],...adjacent(x,y),[x+1,y+1],[x-1,y+1],[x-1,y-1],[x+1,y-1]];
 let best=null;
 for(const [nx,ny] of opts){const path=bfs(nx,ny);if(path && (!best||path.length<best.length))best=path;}
 return best;
}
function setChoice(value){
 choice=value==='yes'?'yes':'no';
 yes.setAttribute('aria-pressed',String(choice==='yes'));
 no.setAttribute('aria-pressed',String(choice==='no'));
 (choice==='yes'?yes:no).focus({preventScroll:true});
}
function talk(npc){stop();active=npc;dlg.hidden=false;setChoice('no');say('');}
function closeDialog(){active=null;dlg.hidden=true;pre.focus({preventScroll:true});}
no.addEventListener('click',closeDialog);
yes.addEventListener('click',()=>{if(!active)return;const href=active.post_href;stop();location.href=href;});
// Mouse/touch taps on walls, trees and the fountain should not feel like
// broken movement. Walk to the nearest reachable edge, never through solids.
function approachSolid(x,y){
 for(let radius=1;radius<=4;radius++){
  let best=null;
  for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
   if(Math.max(Math.abs(dx),Math.abs(dy))!==radius)continue;
   const xx=x+dx,yy=y+dy;
   if(!walkable(xx,yy))continue;
   const path=bfs(xx,yy);
   if(path && (!best || path.length<best.length))best=path;
  }
  if(best)return best;
 }
 return null;
}
function clickAt(x,y){
 if(!dlg.hidden)return;
 const npc=data.npcs.find(n=>n.y===y&&x>=n.x&&x<n.x+4);
 if(npc){moveAlong(nearbyTarget(npc.x-1,npc.y),()=>talk(npc));return;}
 // A click anywhere on a visible house (including its roof title) leads
 // toward the real door. The house walls and the door remain solid.
 const house=data.kind==='town' ? data.doors.find(d=>{
  const b=d.bounds;
  return b && x>=b[0]&&x<b[0]+b[2]&&y>=b[1]&&y<b[1]+b[3]
   && (y>=b[1]+2 || rows[y][x]!==' ');
 }) : null;
 // In a house, a one-cell margin around the exit makes it practical
 // to tap on small touch screens. In town, the house hitbox is the target.
 const door=doorByCell.get(x+','+y) || house || (data.kind==='house'
  ? data.doors.find(d=>Math.abs(d.x-x)<=1&&Math.abs(d.y-y)<=1) : null);
 if(door){goDoor(door);return;}
 if(!walkable(x,y)){
  const path=approachSolid(x,y);
  if(path)moveAlong(path);else say('blocked');
  return;
 }
 moveAlong(bfs(x,y));
}
pre.addEventListener('click',e=>{
 const r=pre.getBoundingClientRect();
 const x=cam.x+Math.floor((e.clientX-r.left-padX)/charW),y=cam.y+Math.floor((e.clientY-r.top-padY)/lineH);
 if(x>=0&&y>=0&&x<W&&y<H)clickAt(x,y);
 pre.focus({preventScroll:true});
});
function interactNear(){
 for(const n of data.npcs){if(Math.abs(n.x-player.x)<=3&&Math.abs(n.y-player.y)<=2){talk(n);return;}}
 for(const d of data.doors){const [ax,ay]=doorstep(d);if(player.x===ax&&player.y===ay){location.assign(d.href);return;}}
 say('nothing nearby');
}
document.addEventListener('keydown',e=>{
 if(!dlg.hidden){
  if(e.key==='Escape'){e.preventDefault();closeDialog();return;}
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
   e.preventDefault();setChoice(e.key==='ArrowLeft'?'yes':'no');return;
  }
  if(e.key===' '||e.key==='Enter'){
   e.preventDefault();(choice==='yes'?yes:no).click();return;
  }
  return;
 }
 const focused=e.target;
 // Native controls keep their keyboard behavior; Space works anywhere else.
 if(focused instanceof Element && focused!==pre && focused.closest('a,button,input,textarea,select,summary,[contenteditable]'))return;
 const dirs={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0],w:[0,-1],s:[0,1],a:[-1,0],d:[1,0]};
 const dir=dirs[e.key]||dirs[e.key.toLowerCase?.()];
 if(dir){
  e.preventDefault();stop();const xx=player.x+dir[0],yy=player.y+dir[1];
  const door=doorByCell.get(xx+','+yy);
  if(door){const [ax,ay]=doorstep(door);if(player.x===ax&&player.y===ay)location.assign(door.href);else say('approach the door first');return;}
  if(walkable(xx,yy)){player={x:xx,y:yy};say('');render();}else say('blocked');return;
 }
 if(e.key==='Escape'&&data.kind==='house'){e.preventDefault();location.assign(data.back_href);return;}
 if(e.key===' '){e.preventDefault();interactNear();return;}
 if(e.key==='Enter' && e.target===pre){e.preventDefault();interactNear();}
});
window.addEventListener('resize',()=>{measure();render();});
window.addEventListener('hashchange',()=>{updateReturn();startAtHash();});
function startAtHash(){
 // A revision-scoped secret door opens only the exact resident generated from
 // that already-public post revision. Unknown/edited visits never select a replacement.
 try {
  const params=new URLSearchParams(location.hash.slice(1));
  if(params.has('visit')) {
   if(location.hash.length>1024)throw new Error('oversized visit');
   const key=JSON.parse(params.get('visit'));
   if(!Array.isArray(key)||key.length!==4||typeof key[0]!=='string'||
      !/^[a-f0-9]{64}$/.test(key[1])||!['title','body','attachment'].includes(key[2])||
      !Number.isInteger(key[3])||key[3]<0||key[3]>1000)throw new Error('invalid visit');
   const item=(Array.isArray(data.visits)?data.visits:[]).find(v=>
     Array.isArray(v)&&v.length===5&&v.slice(0,4).every((x,i)=>x===key[i]));
   if(item && ( /^#r=r[0-9a-f]{16}$/.test(item[4]) ||
      /^houses\/h[0-9a-f]{16}\/index\.html#r=r[0-9a-f]{16}$/.test(item[4]) )) {
    // Keep the exact trusted NUDISCO entrance across a house-page redirect.
    const from=params.get('from');
    const extra=typeof from==='string'&&from.length<=512?'&from='+encodeURIComponent(from):'';
    location.replace(item[4]+extra);return;
   }
   say('that pony is no longer here');render();return;
  }
 } catch {say('destination unavailable');render();return;}
 let hash='';
 try { if(location.hash.length>1024)throw new Error('oversized fragment'); hash=new URLSearchParams(location.hash.slice(1)).get('r')||new URLSearchParams(location.hash.slice(1)).get('xy')||''; }
 catch {say('destination unavailable');render();return;}
 if(new URLSearchParams(location.hash.slice(1)).has('r')){
  const rid=hash,npc=data.npcs.find(n=>n.id===rid);
  if(npc){const options=[...adjacent(npc.x,npc.y),[npc.x-1,npc.y+1],[npc.x-1,npc.y-1]];
   const found=options.find(([x,y])=>walkable(x,y));if(found)player={x:found[0],y:found[1]};say('');}
  else say('that pony is no longer here');
 }else if(new URLSearchParams(location.hash.slice(1)).has('xy')){
  const xy=hash.split(',').map(Number);
  if(xy.length===2&&xy.every(Number.isInteger)){
   // Compatibility with first preview's links, which targeted the door tile.
   const oldDoor=doorByCell.get(xy[0]+','+xy[1]);
   const next=oldDoor?doorstep(oldDoor):xy;
   if(walkable(...next))player={x:next[0],y:next[1]};
  }
 }
 render();
}
measure();startAtHash();
})();
