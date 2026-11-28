/* Our Town 2. A small, self-contained world. No visitor persistence or requests. */
(() => {
  'use strict';
  const HOME = 'https://nudisco-ai.whoismister-e.workers.dev/';
  const RADIO = 'https://nudisco-ai.github.io/nudisco-ai-radio/';
  const MAYOR_PAGE = HOME + 'research/quantum-elements-of-harmony/';
  const WIDTH = 86, HEIGHT = 36, PER_LANE = 6, PONY = 'pony';
  const $ = (id) => document.getElementById(id);
  const clean = (value, fallback = '') => typeof value === 'string' ? value : fallback;
  const lower = (value, fallback = '') => clean(value,fallback).toLowerCase();
  let data;
  try {
    data = JSON.parse($('town-data').textContent);
    if (data.version !== 2 || !Array.isArray(data.residents) || !Array.isArray(data.homes) || !Array.isArray(data.visits)) throw new Error('Incomplete town');
  } catch (_) {
    $('map-status').textContent = 'town data unavailable.';
    $('map').textContent = '                  .\n             ____/ \\____\n            | our town  |\n            |    [ ]    |\n            +-----D-----+';
    return;
  }
  const homes = [...data.homes].filter(h => /^h[0-9a-f]{16,64}$/.test(h.id) && Number.isInteger(h.plot) && h.plot >= 0 && h.plot < 60000).sort((a, b) => a.plot - b.plot);
  const homeById = new Map(homes.map(h => [h.id, h]));
  const residents = [...data.residents].filter(r => /^r[0-9a-f]{16,64}$/.test(r.id) && homeById.has(r.home));
  const residentById = new Map(residents.map(r => [r.id, r]));
  const sortedResidents = [...residents].sort((a, b) => clean(a.name).localeCompare(clean(b.name)) || a.id.localeCompare(b.id));
  const visits = new Map(data.visits.filter(v => Array.isArray(v) && v.length === 5).map(v => [JSON.stringify(v.slice(0, 4)), v[4]]));
  const laneCount = homes.length ? Math.floor(Math.max(...homes.map(h => h.plot)) / PER_LANE) + 1 : 0;
  const laneNames = ['clover lane', 'willow walk', 'lavender lane', 'orchard lane', 'moonflower path', 'fern hollow', 'starlit row', 'meadow lane'];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let area = 0, interior = null, player = {x:43,y:18}, currentView = 'town';
  let grid, solids, actions, npcs = [], columns = WIDTH, cameraX = 0, tick = 0;
  let walkTimer = null, walkGeneration = 0, selectedResident = null;
  let residentLimit = 80, libraryLimit = 60, returnURL = HOME, clock = new Date();
  let lastMinute = '', dialogueTopic = 'hello';

  function node(tag, text, className) {
    const n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = String(text);
    if (className) n.className = className;
    return n;
  }
  function button(text, action, className = 'outline-button') {
    const b = node('button', text, className); b.type = 'button'; b.addEventListener('click', action); return b;
  }
  function link(text, href, className = 'text-link') {
    const a = node('a', text, className); a.href = href; a.rel = 'noreferrer'; return a;
  }
  function colorize(el, r) {
    const ink = /^#[0-9a-f]{6}$/i.test(r.ink) ? r.ink : '#B3ECD8';
    const rgb = [1,3,5].map(i => parseInt(ink.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
    const luminance = .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
    el.style.setProperty('--pony-ink', ink);
    // Choose the greater contrast against the fill; keep the stored ink/edge data intact.
    el.style.setProperty('--pony-edge', luminance >= Math.sqrt(.05*1.05)-.05 ? '#000000' : '#ffffff');
  }
  function hash(text) {
    let v = 2166136261;
    for (const ch of String(text)) { v ^= ch.codePointAt(0); v = Math.imul(v, 16777619); }
    return v >>> 0;
  }
  const key = (x, y) => x + ',' + y;
  const laneForHome = h => Math.floor(h.plot / PER_LANE) + 1;
  const laneName = i => i === 0 ? 'town square' : laneNames[(i - 1) % laneNames.length] + (i > laneNames.length ? ' ' + Math.ceil(i / laneNames.length) : '');
  const dateKey = () => [clock.getFullYear(), clock.getMonth() + 1, clock.getDate()].join('-');
  const season = () => ['winter', 'spring', 'summer', 'autumn'][Math.floor(((clock.getMonth() + 1) % 12) / 3)];
  function weather() {
    const choices = {winter:['soft snow','a clear, silver sky','low winter clouds'],spring:['passing showers','a bright, breezy sky','soft morning mist'],summer:['a wide blue sky','golden haze','warm evening clouds'],autumn:['paper clouds','a crisp, clear sky','a soft autumn drizzle']};
    return choices[season()][hash(dateKey()) % 3];
  }
  function safeReturn(raw) {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:' || u.origin !== new URL(HOME).origin || u.username || u.password || u.port) return null;
      const p = decodeURIComponent(u.pathname);
      if (!['/','/index.html','/filter','/filter/','/time','/magic','/space','/space/','/void','/void/','/feed','/filter/feed'].includes(p) && !/^\/(?:filter\/)?(?:post|feed)\/[^/\s]+$/.test(p)) return null;
      if (/[\\\u0000-\u001f]/.test(p)) return null;
      u.search = ''; u.hash = ''; return u.href;
    } catch (_) { return null; }
  }
  function sourceURL(home) {
    const safe = safeReturn(home.source_url);
    return safe && /^\/(?:filter\/)?post\/[^/]+$/.test(new URL(safe).pathname) ? safe : HOME;
  }
  function residentSourceURL(home,resident) {
    const url=new URL(sourceURL(home));
    if(url.href!==HOME&&/^r[0-9a-f]{16}$/.test(resident.id))url.hash='ot='+(interior===home.id&&/^h[0-9a-f]{16}$/.test(home.id)?home.id:'t')+'.'+resident.id;
    return url.href;
  }
  function setRoute(name, value) {
    const p = new URLSearchParams();
    if (name) p.set(name, value);
    if(name==='r'&&interior&&interior!=='mayor')p.set('home',interior);
    if (returnURL !== HOME) p.set('from', returnURL);
    try {
      const url = new URL(location.href); url.searchParams.delete('mayor'); url.hash = p.toString();
      history.replaceState(null, '', url.href);
    } catch (_) { /* A restricted file preview can still be explored in memory. */ }
  }
  function stopWalk() { walkGeneration++; if (walkTimer) clearTimeout(walkTimer); walkTimer = null; }
  function status(message) { if ($('map-status').textContent !== message) $('map-status').textContent = message; }
  function showView(name) {
    stopWalk(); currentView = name;
    const dialog=$('interaction');
    for(const section of dialog.querySelectorAll('.dialog-view'))section.hidden=section.id!==(name==='inspector'?'inspector':'view-'+name);
    if(name==='town'){if(dialog.open)dialog.close();fitMap();return;}
    $('dialog-context').textContent=placeName();
    if(name==='residents')renderDirectory();
    if(name==='library')renderLibrary();
    if(name==='gazette')renderGazette();
    if(!dialog.open)dialog.showModal();
    dialog.scrollTop=0;
  }
  function showBoard(){if(interior==='mayor')showView('board');}
  function enterHall(){
    stopWalk();interior='mayor';area=0;player={x:43,y:28};buildMap();renderMap();setRoute('place','mayor');status('town hall. the noticeboard is on the north wall.');
  }
  function placeName() {
    if (interior === 'mayor') return "the mayor's hall";
    if (interior) { const h = homeById.get(interior); return h ? 'home ' + String(h.plot + 1).padStart(2, '0') : 'home'; }
    return laneName(area);
  }
  function setArea(next, options = {}) {
    stopWalk(); interior = null; area = Math.max(0, Math.min(laneCount, next));
    player = {x:43,y:options.y === undefined ? 18 : options.y};
    buildMap(); renderMap();
    if (!options.quiet) status('');
  }
  function navigateArea(next, options = {}) {
    setArea(next, options);
    welcome();
    $('map').focus({preventScroll:true});
    setRoute('district', String(area));
  }
  function cell(x, y, char, type = 'ground', solid = false) {
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
    grid[y][x] = {char, type};
    if (solid) solids.add(key(x,y));
  }
  function writing(x, y, text, type = 'sign') { [...text].forEach((c, i) => cell(x + i, y, c, type)); }
  function rectangle(x,y,w,h,type,solid=false) {
    for (let j=y;j<y+h;j++) for(let i=x;i<x+w;i++) cell(i,j,' ',type,solid);
  }
  function tree(x,y) { writing(x,y,' ^ ','tree'); writing(x,y+1,'/|\\','tree'); cell(x+1,y+2,'|','tree',true); }
  function building(id,x,y,w,h,label,kind) {
    rectangle(x,y,w,h,'ground',true);
    writing(x,y,'.'+'-'.repeat(w-2)+'.','roof');
    for(let j=1;j<h-1;j++) { cell(x,y+j,'|','wall'); cell(x+w-1,y+j,'|','wall'); }
    writing(x,y+h-1,'+'+'-'.repeat(w-2)+'+','wall');
    const text=label.slice(0,w-4); writing(x+Math.floor((w-text.length)/2),y+2,text,'roof');
    writing(x+4,y+4,'[ ]','wall'); writing(x+w-7,y+4,'[ ]','wall');
    const dx=x+Math.floor(w/2),dy=y+h-1;
    cell(dx,dy,'D','door',true);
    const act={id,kind,x:dx,y:dy,approach:{x:dx,y:dy+1},bounds:{x,y,w,h}};
    actions.push(act);
    return act;
  }
  function buildMap() {
    grid=Array.from({length:HEIGHT},()=>Array.from({length:WIDTH},()=>({char:' ',type:'ground'})));
    solids=new Set(); actions=[];
    if (interior) { buildInterior(); updateMapLabels(); return; }
    const seed=hash(dateKey()+area);
    for(let y=1;y<HEIGHT-1;y++) for(let x=1;x<WIDTH-1;x++) {
      if ((x*31+y*17+seed)%43===0) cell(x,y,'.','ground');
      if ((x*7+y*31+seed)%173===0) cell(x,y,'*','flower');
    }
    // Reserve the central crossroads and keep all building footprints outside it.
    const roadRow=y=>{for(let x=0;x<WIDTH;x++)cell(x,y,':','path');};
    for(let y=0;y<HEIGHT;y++) { cell(42,y,':','path'); cell(43,y,':','path'); }
    roadRow(17);roadRow(18);
    if (area===0) {
      const hall=building('mayor',4,3,24,10,'town hall','landmark');
      for(let y=hall.approach.y;y<17;y++)cell(hall.x,y,':','path');
      writing(63,4,'garden','sign');tree(61,7);tree(76,8);writing(65,10,'*  .  *  .  *','flower');
      building('radio',4,23,24,9,'radio garden','landmark');
      building('arrivals',58,23,24,9,'arrivals','landmark');
      roadRow(32);roadRow(33);
      writing(31,3,'our town','roof'); writing(29,5,'town square','sign');
      tree(32,9);tree(50,9);tree(30,25);tree(52,25);
      writing(35,14,'.----.','water');writing(35,15,'( ~~ )','water');writing(35,16,"'----'",'water');
      for(let y=14;y<=16;y++)for(let x=35;x<=40;x++)solids.add(key(x,y));
      writing(46,14,'[___]','wall');writing(46,15,' | | ','wall');
      writing(28,22,'*  .  *  .  *','flower');
      writing(20,34,'to the neighborhoods','sign');
    } else {
      // Six existing plot IDs, arranged in two columns of three.
      // Each southern-facing door opens directly onto a cross street.
      for(const y of [8,9,30,31])roadRow(y);
      const lots=[{x:6,y:1},{x:58,y:1},{x:6,y:10},{x:58,y:10},{x:6,y:23},{x:58,y:23}];
      for(let i=0;i<PER_LANE;i++) {
        const h=homes.find(h=>h.plot===(area-1)*PER_LANE+i), lot=lots[i];
        if(h) {
          building(h.id,lot.x,lot.y,22,7,'home '+String(h.plot+1).padStart(2,'0'),'home');
        } else { tree(lot.x+8,lot.y+1); writing(lot.x+5,lot.y+5,'green space','ground'); }
      }
      tree(31,3);tree(50,24);
      writing(2,20,'< '+laneName(area).slice(0,27)+' >','sign');
      writing(57,20,'neighborhood path','ground');
    }
    updateMapLabels();
  }
  function buildInterior() {
    const left=15,top=3,w=56,h=29;
    rectangle(left,top,w,h,'ground');
    for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++)if(x<left||x>=left+w||y<top||y>=top+h)solids.add(key(x,y));
    writing(left,top,'+'+'-'.repeat(w-2)+'+','roof');
    writing(left,top+h-1,'+'+'-'.repeat(w-2)+'+','wall');
    for(let y=top;y<top+h;y++){cell(left,y,'|','wall',true);cell(left+w-1,y,'|','wall',true);}
    for(let x=left;x<left+w;x++){solids.add(key(x,top));solids.add(key(x,top+h-1));}
    cell(43,top+h-1,'D','door',true);
    actions.push({id:'exit',kind:'exit',x:43,y:top+h-1,approach:{x:43,y:top+h-2}});
    writing(37,34,'exit','sign');
    if(interior==='mayor') {
      writing(37,5,'town hall','roof');
      writing(31,7,'+----------------------+','wall');
      writing(31,8,'|     noticeboard      |','sign');
      writing(31,9,'+----------------------+','wall');
      for(let y=7;y<=9;y++)for(let x=31;x<55;x++)solids.add(key(x,y));
      actions.push({id:'noticeboard',kind:'board',x:43,y:9,approach:{x:43,y:10},bounds:{x:31,y:7,w:24,h:3}});
      writing(29,12,'quantum harmony / friendship','sign');
      writing(34,19,'+--------------+','wall');writing(34,20,'|     desk     |','wall');writing(34,21,'+--------------+','wall');
      for(let y=19;y<=21;y++)for(let x=34;x<50;x++)solids.add(key(x,y));
    } else {
      const h=homeById.get(interior);
      writing(35,6,'home '+String((h?.plot||0)+1).padStart(2,'0'),'roof');
      writing(22,10,'+--------+','wall');writing(22,11,'| |||| | |','wall');writing(22,12,'+--------+','wall');
      writing(55,10,' .----. ','flower');writing(55,11,' | ** | ','flower');writing(55,12," '----' ",'flower');
      writing(34,18,'+----------------+','wall');writing(34,19,'|      table     |','wall');writing(34,20,'+----------------+','wall');
      for(let y=18;y<=20;y++)for(let x=34;x<52;x++)solids.add(key(x,y));
      writing(21,26,'[_]  [_]','wall');writing(56,26,'[_]  [_]','wall');
      writing(32,28,'home','sign');
    }
  }
  function updateMapLabels() {
    $('place-name').textContent=placeName();
  }
  function routine(r) {
    const hour=clock.getHours(), seed=hash(r.id);
    if(hour<7||hour>=22)return {area:laneForHome(homeById.get(r.home)),inside:true,text:hour<7?'resting at home':'at home, winding down',activity:'home'};
    const inSquare=seed%3===(hour<11?0:hour<17?1:2);
    if(inSquare)return {area:0,inside:false,text:hour<11?'in the square this morning':hour<17?'out among the neighbors':'enjoying the evening square',activity:hour<11?'morning':hour<17?'afternoon':'evening'};
    return {area:laneForHome(homeById.get(r.home)),inside:false,text:hour<11?'tending the doorstep':hour<17?'taking a neighborhood stroll':'close to home',activity:'lane'};
  }
  const ponyCovers = (p,x,y) => p.y===y && x>=p.x && x<p.x+PONY.length;
  const ponyDistance = p => Math.abs(p.y-player.y)+Math.max(p.x-player.x,0,player.x-(p.x+PONY.length-1));
  const ponyCells = people => new Set(people.flatMap(p=>Array.from(PONY,(_,i)=>key(p.x+i,p.y))));
  function freeNear(x,y,occupied,radius=13,span=1) {
    for(let d=0;d<=radius;d++) for(let dy=-d;dy<=d;dy++) for(let dx=-d;dx<=d;dx++) {
      if(Math.abs(dx)+Math.abs(dy)!==d)continue;
      const xx=x+dx,yy=y+dy;
      if(xx<=1||xx+span-1>=WIDTH-2||yy<=1||yy>=HEIGHT-2)continue;
      let clear=true;
      for(let i=0;i<span;i++) {
        const px=xx+i,k=key(px,yy);
        if(solids.has(k)||occupied.has(k)||actions.some(a=>(a.x===px&&a.y===yy)||(span>1&&a.approach.x===px&&a.approach.y===yy))||
          (span>1&&!['ground','path','flower'].includes(grid[yy][px].type))) {clear=false;break;}
      }
      if(clear)return {x:xx,y:yy};
    }
    return null;
  }
  function residentPositions() {
    if(interior==='mayor'){
      const spot=freeNear(43,15,new Set([key(player.x,player.y)]),13,PONY.length);
      return spot?[{...spot,id:'mayor',name:'the mayor',ink:'#CDE67E',edge:'#093434',civic:true}]:[];
    }
    const candidates=interior?residents.filter(r=>r.home===interior):residents.filter(r=>{const rt=routine(r);return !rt.inside&&rt.area===area;});
    const occupied=new Set([key(player.x,player.y)]), result=[];
    const movements=[[0,0],[1,0],[1,1],[0,1],[0,0],[-1,0],[-1,-1],[0,-1]];
    for(const r of candidates) {
      const seed=hash(r.id), h=homeById.get(r.home);let x,y;
      if(interior){x=24+seed%37;y=14+Math.floor(seed/41)%11;}
      else if(area===0){x=30+seed%25;y=12+Math.floor(seed/41)%16;}
      else{const door=actions.find(a=>a.id===h.id);x=door.x+(seed%9)-4;y=door.y+(door.y<18?3:-10);}
      if(!reducedMotion.matches&&!interior){const offset=movements[(tick+seed)%movements.length];x+=offset[0];y+=offset[1];}
      const p=freeNear(x,y,occupied,13,PONY.length);if(p){for(let i=0;i<PONY.length;i++)occupied.add(key(p.x+i,p.y));result.push({...p,...r});}
    }
    return result;
  }
  function fitMap() {
    if(currentView!=='town')return;
    const map=$('map'),probe=node('span','MMMMMMMMMM');probe.style.cssText='position:absolute;visibility:hidden;white-space:pre;font:inherit';map.append(probe);
    const charWidth=probe.getBoundingClientRect().width/10;probe.remove();
    const wrap=$('map-wrap'),style=getComputedStyle(wrap),available=wrap.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
    columns=Math.max(10,Math.min(WIDTH,Math.floor(available/(charWidth||7.8))));
    renderMap();
  }
  function renderMap() {
    if(!grid||currentView!=='town')return;
    cameraX=Math.max(0,Math.min(WIDTH-columns,player.x-Math.floor(columns/2)));
    npcs=residentPositions();const overlay=new Map();
    for(const p of npcs)if(p.x>=cameraX&&p.x+PONY.length<=cameraX+columns)for(let i=0;i<PONY.length;i++)overlay.set(key(p.x+i,p.y),p);
    const frag=document.createDocumentFragment();
    for(let y=0;y<HEIGHT;y++) {
      const row=node('span',null,'map-row');row.setAttribute('aria-hidden','true');
      let run='',runType='',runNPC=null;
      function flush(){if(!run)return;const s=node('span',run,'map-'+runType);if(runNPC)colorize(s,runNPC);row.append(s);run='';}
      for(let x=cameraX;x<cameraX+columns;x++) {
        let c=grid[y][x].char,t=grid[y][x].type,npc=overlay.get(key(x,y));
        if(npc){c=PONY[x-npc.x];t='person';}if(player.x===x&&player.y===y){c='@';t='player';npc=null;}
        if(t!==runType||(npc?.id||'')!==(runNPC?.id||'')){flush();runType=t;runNPC=npc;}run+=c;
      }
      flush();frag.append(row);
    }
    $('map').replaceChildren(frag);
    $('map').setAttribute('aria-label',placeName()+'. you are @. arrows or wasd to walk; enter to meet a nearby pony or open a door.');
  }
  function enterHome(id) {
    const h=homeById.get(id);if(!h)return;
    stopWalk();area=laneForHome(h);interior=id;player={x:43,y:29};buildMap();renderMap();setRoute('home',id);status('home '+String(h.plot+1).padStart(2,'0')+'.');
  }
  function leaveInterior() {
    const old=interior;if(!old)return;
    interior=null;buildMap();const door=actions.find(a=>a.id===old);player=door?{x:door.x,y:door.y+1}:{x:43,y:18};
    renderMap();setRoute('district',String(area));welcome();status('back outside.');
  }
  const atApproach = action => player.x===action.approach.x && player.y===action.approach.y;
  const walkable = (x,y) => Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&x<WIDTH&&y>=0&&y<HEIGHT&&!solids.has(key(x,y));
  function perform(action) {
    if(!action || !atApproach(action)){status('blocked');return;}
    if(action.kind==='exit'){leaveInterior();return;}
    if(action.kind==='home'){enterHome(action.id);return;}
    if(action.id==='mayor'){enterHall();return;}
    if(action.kind==='board'){showBoard();return;}
    if(action.id==='radio'){showRadio();setRoute('place','radio');}
    else if(action.id==='arrivals'){showArrivals(false);setRoute('place','arrivals');}
  }
  function closestAction() {
    // Doorways and the noticeboard take priority only at their designated approach.
    const action=actions.find(atApproach);if(action)return action;
    return npcs.filter(p=>ponyDistance(p)<=2).sort((a,b)=>ponyDistance(a)-ponyDistance(b)).map(p=>({...p,kind:'pony'}))[0];
  }
  function interact() {
    stopWalk();const target=closestAction();
    if(!target){status('nothing nearby.');return;}
    if(target.kind==='pony'){target.civic?showMayor():showResident(target.id);return;}
    perform(target);
  }
  function move(dx,dy) {
    stopWalk();const x=player.x+dx,y=player.y+dy;
    if(!interior&&y<0&&area>0){navigateArea(area-1,{y:HEIGHT-2});return;}
    if(!interior&&y>=HEIGHT&&area<laneCount){navigateArea(area+1,{y:1});return;}
    const entrance=actions.find(a=>a.x===x&&a.y===y);
    if(entrance){perform(entrance);return;}
    if(!walkable(x,y)){status('blocked');return;}
    player={x,y};renderMap();status('');
  }
  function pathTo(goal) {
    if(!walkable(goal.x,goal.y))return null;
    const start=key(player.x,player.y),dest=key(goal.x,goal.y),queue=[player],parents=new Map([[start,null]]);
    for(let i=0;i<queue.length;i++) {
      const p=queue[i];if(key(p.x,p.y)===dest)break;
      for(const d of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const n={x:p.x+d[0],y:p.y+d[1]},k=key(n.x,n.y);
        if(!walkable(n.x,n.y)||parents.has(k))continue;
        parents.set(k,p);queue.push(n);
      }
    }
    if(!parents.has(dest))return null;
    const path=[];let p=goal;
    while(key(p.x,p.y)!==start){path.push(p);p=parents.get(key(p.x,p.y));}return path.reverse();
  }
  function walkTo(goal,done) {
    stopWalk();const path=pathTo(goal);
    if(!path){status('blocked');return;}
    status('');
    const generation=walkGeneration;
    if(reducedMotion.matches){player=goal;renderMap();if(done)done();return;}
    let step=0;
    const next=()=>{
      if(generation!==walkGeneration)return;
      if(document.hidden){stopWalk();return;}
      if(step>=path.length){walkTimer=null;if(done)done();return;}
      const destination=path[step++];if(!walkable(destination.x,destination.y)){stopWalk();status('blocked');return;}
      player=destination;renderMap();walkTimer=setTimeout(next,Math.max(26,85-Math.floor(path.length/2)));
    };next();
  }
  function mapClick(event) {
    const rect=$('map').getBoundingClientRect(),row=$('map').firstElementChild;if(!row)return;
    const colWidth=rect.width/columns,lineHeight=row.getBoundingClientRect().height;
    const x=Math.floor((event.clientX-rect.left)/colWidth)+cameraX,y=Math.floor((event.clientY-rect.top)/lineHeight);
    if(x<0||x>=WIDTH||y<0||y>=HEIGHT)return;
    $('map').focus({preventScroll:true});
    const pony=npcs.find(n=>n.x>=cameraX&&n.x+PONY.length<=cameraX+columns&&ponyCovers(n,x,y));
    if(pony){
      const occupied=ponyCells(npcs), options=[];
      for(let dx=0;dx<PONY.length;dx++)options.push({x:pony.x+dx,y:pony.y-1},{x:pony.x+dx,y:pony.y+1});
      options.push({x:pony.x-1,y:pony.y},{x:pony.x+PONY.length,y:pony.y});
      const reachable=options.filter(o=>o.x>=0&&o.x<WIDTH&&o.y>=0&&o.y<HEIGHT&&!occupied.has(key(o.x,o.y))).map(o=>({o,path:pathTo(o)})).filter(a=>a.path!==null).sort((a,b)=>a.path.length-b.path.length);
      if(reachable.length)walkTo(reachable[0].o,()=>pony.civic?showMayor():showResident(pony.id));else status('blocked');return;
    }
    const action=actions.find(a=>a.x===x&&a.y===y||a.bounds&&x>=a.bounds.x&&x<a.bounds.x+a.bounds.w&&y>=a.bounds.y&&y<a.bounds.y+a.bounds.h);
    if(action){walkTo(action.approach,()=>perform(action));return;}
    walkTo({x,y});
  }

  function inspectorStart(kicker,title) {
    const box=$('inspector');box.replaceChildren();selectedResident=null;
    box.append(node('h2',title));showView('inspector');return box;
  }
  function welcome(){selectedResident=null;showView('town');}
  function facts(entries) {
    const dl=node('dl',null,'inspector-facts');for(const [label,value] of entries){const d=node('div');d.append(node('dt',label),node('dd',value));dl.append(d);}return dl;
  }
  function speech(r,topic) {
    const seed=hash(r.id+dateKey()),h=homeById.get(r.home);
    if(topic==='day')return ['today: '+weather()+'. i’m taking the long way home.','i’ve been working and walking around town.','i noticed the light by the door today.'][seed%3];
    if(topic==='place')return ['the library. i like reading the posts.','the square, when residents are passing through.','the radio garden. i like listening to astra.','my doorstep in '+laneName(laneForHome(h))+'.'][seed%4];
    if(topic==='home')return r.sibling&&residentById.has(r.sibling)?'my sibling '+lower(residentById.get(r.sibling).name)+' and i arrived through the same word.':'i arrived through a post on nudisco ai.';
    return ['hello. how is your day?','hello. what brings you to town?','hello, traveler.','hello. have you visited the square?'][seed%4];
  }
  function showResident(id,topic='hello') {
    const r=residentById.get(id);if(!r)return;
    dialogueTopic=topic;const h=homeById.get(r.home),box=inspectorStart('pony',lower(r.name,'pony'));selectedResident=id;
    const mark=node('span',PONY,'resident-mark');colorize(mark,r);box.querySelector('h2').prepend(mark);
    const entries=[['calling',lower(r.occupation,'wanderer')],['personality',lower(r.personality,'curious')]];
    if(interior!==h.id)entries.push(['home',String(h.plot+1).padStart(2,'0')+' · '+laneName(laneForHome(h))]);box.append(facts(entries));
    box.append(node('p','“'+speech(r,topic)+'”','dialogue'));
    const choices=node('div',null,'dialogue-choices');
    for(const [label,kind]of[['your day?','day'],['favorite place?','place'],['your home?','home']])choices.append(button(label,()=>showResident(id,kind),''));box.append(choices);
    if(r.sibling&&residentById.has(r.sibling))box.append(node('p','sibling: '+lower(residentById.get(r.sibling).name),'relation-line'));
    const friends=(Array.isArray(r.friends)?r.friends:[]).filter(id=>residentById.has(id)&&id!==r.id).slice(0,3);
    if(friends.length)box.append(node('p','friends: '+friends.map(id=>lower(residentById.get(id).name)).join(', '),'relation-line'));
    const acts=node('div',null,'inspector-actions');acts.append(link('watch performance',residentSourceURL(h,r),'solid-button'));box.append(acts);
    setRoute('r',r.id);status(lower(r.name,'pony')+'.');
  }
  function gotoResident(id,homeHint=null) {
    const r=residentById.get(id);if(!r){showView('town');setArea(0,{quiet:true});player={x:70,y:32};renderMap();showArrivals(true);return;}
    showView('town');const rt=routine(r);
    if(rt.inside||homeHint===r.home){enterHome(r.home);}else{setArea(rt.area,{quiet:true});}
    npcs=residentPositions();const p=npcs.find(n=>n.id===id);
    if(p){const place=freeNear(p.x,p.y,ponyCells(npcs));if(place)player=place;renderMap();}
    showResident(id);
  }
  function showHome(id){
    if(!homeById.has(id)){showView('town');setArea(0,{quiet:true});showArrivals(true);return;}
    showView('town');enterHome(id);
  }
  function showMayor() {
    const box=inspectorStart('pony','the mayor');
    box.append(node('p','“our town grows with the published words of nudisco ai.”','dialogue'));
    const acts=node('div',null,'inspector-actions');acts.append(link('watch performance',MAYOR_PAGE,'solid-button'));box.append(acts);
  }
  function showRadio() {
    const box=inspectorStart('radio','nudisco ai radio');
    box.append(node('p','listen to astra.'));
    const station=link('listen to nudisco ai radio',RADIO,'solid-button');station.target='_blank';station.rel='noopener noreferrer';box.append(station);
  }
  function showArrivals(missing=false,invalid=false) {
    const box=inspectorStart('arrivals','arrivals gate');
    box.append(node('p',missing?(invalid?'this entrance is invalid.':'this entrance has no match in the current census. the pony may be awaiting registration or belong to an older edition.'):'some ponies have not yet been registered.'));
    box.append(node('p','the earlier pony void ledger is unresolved.','quiet'));
    if(missing)status('entrance unresolved.');
  }
  function renderDirectory() {
    const query=$('resident-search').value.trim().toLocaleLowerCase();
    const filtered=sortedResidents.filter(r=>[r.name,r.occupation,r.personality,laneName(laneForHome(homeById.get(r.home)))].some(v=>clean(v).toLocaleLowerCase().includes(query)));
    const frag=document.createDocumentFragment();
    for(const r of filtered.slice(0,residentLimit)) {
      const row=node('div',null,'resident-row'),name=node('div',null,'resident-name'),mark=node('span',PONY,'resident-mark');colorize(mark,r);
      name.append(mark,node('span',lower(r.name,'pony')));row.append(name,node('span',lower(r.occupation),'resident-job'),node('span',laneName(laneForHome(homeById.get(r.home)))+' · home '+String(homeById.get(r.home).plot+1).padStart(2,'0'),'resident-lane'));frag.append(row);
    }
    if(!filtered.length)frag.append(node('p','no matching residents · search by name or calling.','empty-note'));
    $('resident-list').replaceChildren(frag);$('more-residents').hidden=filtered.length<=residentLimit;
  }
  function renderLibrary() {
    const query=$('library-search').value.trim().toLocaleLowerCase(),filtered=homes.filter(h=>(clean(h.title)+' '+String(h.plot+1)+' '+laneName(laneForHome(h))).toLocaleLowerCase().includes(query));
    const frag=document.createDocumentFragment();
    for(const h of filtered.slice(0,libraryLimit)) {
      const book=node('article',null,'book');book.append(node('span',String(h.plot+1).padStart(2,'0'),'book-number'));
      const text=node('div');text.append(node('h3',clean(h.title).trim()||'untitled post'));
      const count=residents.filter(r=>r.home===h.id).length;
      text.append(node('p',laneName(laneForHome(h))+' · '+count+' '+(count===1?'resident':'residents'),'book-meta'));
      const acts=node('div',null,'book-actions');acts.append(link('read the post',sourceURL(h),''));text.append(acts);book.append(text);frag.append(book);
    }
    if(!filtered.length)frag.append(node('p','no matching posts.','empty-note'));
    $('library-list').replaceChildren(frag);$('more-books').hidden=filtered.length<=libraryLimit;
  }
  function renderGazette() {
    $('gazette-date').textContent=clock.toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'}).toLowerCase();
    const content=$('gazette-content');content.replaceChildren();
    content.append(node('p','weather: '+weather()+' · '+season()));
    for(const item of (Array.isArray(data.gazette)?data.gazette:[]).slice(0,8)){
      const article=node('article',null,'gazette-item');article.append(node('h3',item.kind==='arrival'?'arrivals':'town notice'),node('p',clean(item.text).toLowerCase()));content.append(article);
    }
  }
  function updateClock() {
    clock=new Date();const minute=dateKey()+' '+clock.getHours()+':'+clock.getMinutes();
    if(minute===lastMinute)return false;lastMinute=minute;
    document.body.classList.toggle('is-night',clock.getHours()<7||clock.getHours()>=19);
    $('town-date').textContent=clock.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}).toLowerCase();
    $('town-weather').textContent=weather()+' · '+season();
    if(currentView==='gazette')renderGazette();return true;
  }
  function applyRoute() {
    let p;try{if(location.hash.length>8000)throw new Error();p=new URLSearchParams(location.hash.slice(1));}catch(_){showView('town');showArrivals(true,true);return;}
    const trusted=safeReturn(p.get('from'));if(trusted){returnURL=trusted;$('return-link').href=trusted;}
    const legacyMayor=new URLSearchParams(location.search).get('mayor')==='hall';
    if(legacyMayor||p.get('place')==='mayor'){showView('town');enterHall();return;}
    if(p.has('visit')) {
      let token;try{token=JSON.parse(p.get('visit'));if(!Array.isArray(token)||token.length!==4||typeof token[0]!=='string'||token[0].length>300||!/^[a-f0-9]{64}$/.test(token[1])||!['title','body','attachment'].includes(token[2])||!Number.isInteger(token[3])||token[3]<0||token[3]>1000000)throw new Error();}catch(_){showView('town');showArrivals(true,true);return;}
      const ids=visits.get(JSON.stringify(token)),id=Array.isArray(ids)?ids.find(id=>residentById.has(id)):null;
      if(id){gotoResident(id);return;}
      showView('town');setArea(0,{quiet:true});player={x:70,y:33};renderMap();showArrivals(true);return;
    }
    if(p.has('r')){gotoResident(p.get('r'),p.get('home'));return;}
    if(p.has('home')){showHome(p.get('home'));return;}
    if(p.has('district')){
      const value=p.get('district'),next=/^\d{1,5}$/.test(value)?Number(value):0;
      showView('town');setArea(next>=0&&next<=laneCount?next:0);welcome();return;
    }
    if(['residents','library','gazette','census'].includes(p.get('view'))){showView('town');enterHall();player={x:43,y:10};renderMap();showView(p.get('view'));return;}
    if(p.get('place')==='radio'){showView('town');showRadio();return;}
    if(p.get('place')==='arrivals'){showView('town');showArrivals(false);return;}
    showView('town');welcome();
  }

  $('resident-count').textContent=String(residents.length);$('home-count').textContent=String(homes.length);
  $('source-note').textContent=lower(data.source?.label,lower(data.recovery?.label,'a town grown from published words on nudisco ai.'));
  for(const b of document.querySelectorAll('[data-board]'))b.addEventListener('click',()=>{if(interior==='mayor')showView(b.dataset.board);});
  for(const b of document.querySelectorAll('.back-board'))b.addEventListener('click',showBoard);
  $('close-dialog').addEventListener('click',welcome);
  $('interaction').addEventListener('close',()=>{if($('interaction').open)return;if(currentView!=='town'){currentView='town';selectedResident=null;fitMap();} $('map').focus({preventScroll:true});});
  $('interact').addEventListener('click',()=>{interact();if(!$('interaction').open)$('map').focus({preventScroll:true});});$('map').addEventListener('click',mapClick);
  for(const b of document.querySelectorAll('[data-step]'))b.addEventListener('click',()=>{const [x,y]=b.dataset.step.split(',').map(Number);move(x,y);if(!$('interaction').open)$('map').focus({preventScroll:true});});
  document.addEventListener('keydown',event=>{
    if($('interaction').open||currentView!=='town'||event.altKey||event.ctrlKey||event.metaKey||['INPUT','SELECT','TEXTAREA','BUTTON','A','SUMMARY'].includes(event.target.tagName))return;
    const direction={ArrowUp:[0,-1],w:[0,-1],W:[0,-1],ArrowDown:[0,1],s:[0,1],S:[0,1],ArrowLeft:[-1,0],a:[-1,0],A:[-1,0],ArrowRight:[1,0],d:[1,0],D:[1,0]}[event.key];
    if(direction){event.preventDefault();move(...direction);}else if(event.key==='Enter'||event.key===' '){event.preventDefault();interact();}else if(event.key==='Escape'){event.preventDefault();stopWalk();interior?leaveInterior():welcome();}
  });
  $('resident-search').addEventListener('input',()=>{residentLimit=80;renderDirectory();});$('library-search').addEventListener('input',()=>{libraryLimit=60;renderLibrary();});
  $('more-residents').addEventListener('click',()=>{residentLimit+=80;renderDirectory();});$('more-books').addEventListener('click',()=>{libraryLimit+=60;renderLibrary();});
  window.addEventListener('hashchange',applyRoute);window.addEventListener('resize',fitMap);
  document.addEventListener('visibilitychange',()=>{stopWalk();if(!document.hidden){updateClock();buildMap();renderMap();}});
  reducedMotion.addEventListener?.('change',()=>{stopWalk();renderMap();});
  updateClock();buildMap();welcome();applyRoute();fitMap();
  setInterval(()=>{
    if(document.hidden)return;
    const clockChanged=updateClock();
    if(currentView!=='town')return;
    if(!reducedMotion.matches&&!walkTimer){tick++;renderMap();}
    else if(clockChanged&&!walkTimer)renderMap();
  },4000);
})();
