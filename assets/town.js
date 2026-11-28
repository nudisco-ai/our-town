/* Our Town 2. A small, self-contained world. No visitor persistence or requests. */
(() => {
  'use strict';
  const HOME = 'https://nudisco-ai.whoismister-e.workers.dev/';
  const RADIO = 'https://nudisco-ai.github.io/nudisco-ai-radio/';
  const MAYOR_PAGE = HOME + 'research/quantum-elements-of-harmony/';
  const WIDTH = 86, HEIGHT = 36, PER_LANE = 6;
  const $ = (id) => document.getElementById(id);
  const clean = (value, fallback = '') => typeof value === 'string' ? value : fallback;
  let data;
  try {
    data = JSON.parse($('town-data').textContent);
    if (data.version !== 2 || !Array.isArray(data.residents) || !Array.isArray(data.homes) || !Array.isArray(data.visits)) throw new Error('Incomplete town');
  } catch (_) {
    $('map-status').textContent = 'This copy of town is still being prepared. Please return when its doors are ready.';
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
  const laneNames = ['clover lane', 'willow walk', 'lavender lane', 'little orchard', 'moonflower path', 'fern hollow', 'starlit row', 'meadow lane'];
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
    const a = node('a', text, className); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  }
  function colorize(el, r) {
    if (/^#[0-9a-f]{6}$/i.test(r.ink)) el.style.setProperty('--pony-ink', r.ink);
    if (/^#[0-9a-f]{6}$/i.test(r.edge)) el.style.setProperty('--pony-edge', r.edge);
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
    const choices = {winter:['soft snow','a clear, silver sky','low winter clouds'],spring:['passing showers','a bright, breezy sky','soft morning mist'],summer:['a wide blue sky','a little golden haze','warm evening clouds'],autumn:['paper clouds','a crisp, clear sky','a soft autumn drizzle']};
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
    if(url.href!==HOME&&/^r[0-9a-f]{16}$/.test(resident.id))url.hash='ot=t.'+resident.id;
    return url.href;
  }
  function setRoute(name, value) {
    const p = new URLSearchParams();
    if (name) p.set(name, value);
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
    for (const b of document.querySelectorAll('[data-view]')) {
      const yes = b.dataset.view === name; b.classList.toggle('is-active', yes);
      if (yes) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== 'view-' + name;
    if (name === 'town') { fitMap(); renderMap(); }
    if (name === 'residents') renderDirectory();
    if (name === 'library') renderLibrary();
    if (name === 'gazette') renderGazette();
  }
  function placeName() {
    if (interior === 'mayor') return "the mayor's hall";
    if (interior) { const h = homeById.get(interior); return h ? 'home ' + String(h.plot + 1).padStart(2, '0') : 'a quiet home'; }
    return laneName(area);
  }
  function setArea(next, options = {}) {
    stopWalk(); interior = null; area = Math.max(0, Math.min(laneCount, next));
    player = {x:43,y:options.y === undefined ? 18 : options.y};
    $('district').value = String(area); buildMap(); renderMap();
    if (!options.quiet) status(area ? 'The front doors are open. Walk up and say hello.' : 'The square is yours to explore. There is no hurry.');
  }
  function navigateArea(next, options = {}) {
    setArea(next, options);
    welcome();
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
    cell(dx,dy,'D','door'); solids.delete(key(dx,dy));
    const act={id,kind,x:dx,y:dy,approach:{x:dx,y:dy+1},bounds:{x,y,w,h}};
    actions.push(act);
    for(let j=dy+1;j<=18&&j<HEIGHT;j++) cell(dx,j,':','path');
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
    for(let y=0;y<HEIGHT;y++) { cell(42,y,':','path'); cell(43,y,':','path'); }
    for(let x=0;x<WIDTH;x++) { cell(x,17,':','path'); cell(x,18,':','path'); }
    if (area===0) {
      building('mayor',4,3,24,10,'TOWN HALL','landmark');
      building('library',58,3,24,10,'LIBRARY','landmark');
      building('radio',4,23,24,9,'RADIO GARDEN','landmark');
      building('arrivals',58,23,24,9,'ARRIVALS','landmark');
      writing(36,3,'OUR TOWN','roof'); writing(32,5,'a place between words','sign');
      tree(32,9);tree(50,9);tree(30,25);tree(52,25);
      writing(35,14,'.----.','water');writing(35,15,'( ~~ )','water');writing(35,16,"'----'",'water');
      for(let y=14;y<=16;y++)for(let x=35;x<=40;x++)solids.add(key(x,y));
      writing(46,14,'[___]','wall');writing(46,15,' | | ','wall');
      writing(34,22,'*  .  *  .  *','flower');
      writing(34,33,'to the neighborhoods','sign');
    } else {
      const lots=[{x:3,y:3},{x:32,y:3},{x:61,y:3},{x:3,y:23},{x:32,y:23},{x:61,y:23}];
      for(let i=0;i<PER_LANE;i++) {
        const h=homes.find(h=>h.plot===(area-1)*PER_LANE+i), lot=lots[i];
        if(h) {
          const door=building(h.id,lot.x,lot.y,22,9,'HOME '+String(h.plot+1).padStart(2,'0'),'home');
          if(lot.y>18) { for(let y=19;y<lot.y;y++)cell(door.x,y,':','path'); }
          writing(lot.x+3,lot.y+6,'_  .  _  .  _','flower');
        } else { tree(lot.x+8,lot.y+2); writing(lot.x+5,lot.y+6,'a little green','ground'); }
      }
      tree(26,5);tree(55,25);
      writing(2,15,'< '+laneName(area).toUpperCase().slice(0,27)+' >','sign');
      writing(57,20,'every door, a beginning','ground');
    }
    updateMapLabels();
  }
  function buildInterior() {
    const left=15,top=3,w=56,h=29;
    rectangle(left,top,w,h,'ground');
    writing(left,top,'+'+'-'.repeat(w-2)+'+','roof');
    writing(left,top+h-1,'+'+'-'.repeat(w-2)+'+','wall');
    for(let y=top;y<top+h;y++){cell(left,y,'|','wall',true);cell(left+w-1,y,'|','wall',true);}
    for(let x=left;x<left+w;x++){solids.add(key(x,top));solids.add(key(x,top+h-1));}
    cell(43,top+h-1,'D','door');solids.delete(key(43,top+h-1));
    actions.push({id:'exit',kind:'exit',x:43,y:top+h-1,approach:{x:43,y:top+h-2}});
    writing(36,34,'out to the lane','sign');
    if(interior==='mayor') {
      writing(34,6,"MAYOR'S HALL",'roof');writing(29,9,'QUANTUM HARMONY / FRIENDSHIP','sign');
      writing(28,12,'*    *    *    *    *    *','flower');
      writing(34,19,'+--------------+','wall');writing(34,20,'| a shared desk|','wall');writing(34,21,'+--------------+','wall');
      writing(29,26,'the mayor welcomes everypony','sign');
    } else {
      const h=homeById.get(interior);
      writing(35,6,'HOME '+String((h?.plot||0)+1).padStart(2,'0'),'roof');
      writing(22,10,'+--------+','wall');writing(22,11,'| |||| | |','wall');writing(22,12,'+--------+','wall');
      writing(55,10,' .----. ','flower');writing(55,11,' | ** | ','flower');writing(55,12," '----' ",'flower');
      writing(34,18,'+----------------+','wall');writing(34,19,'|  a shared table |','wall');writing(34,20,'+----------------+','wall');
      writing(21,26,'[_]  [_]','wall');writing(56,26,'[_]  [_]','wall');
      writing(32,28,'stay a little while','sign');
    }
  }
  function updateMapLabels() {
    $('place-name').textContent=placeName(); $('district').value=String(area); $('district').disabled=!!interior;
    $('lane-index').textContent=String(area+1).padStart(2,'0')+' / '+String(laneCount+1).padStart(2,'0');
    $('previous-lane').disabled=!!interior||area===0; $('next-lane').disabled=!!interior||area===laneCount;
  }
  function routine(r) {
    const hour=clock.getHours(), seed=hash(r.id);
    if(hour<7||hour>=22)return {area:laneForHome(homeById.get(r.home)),inside:true,text:hour<7?'resting at home':'at home, winding down',activity:'home'};
    const inSquare=seed%3===(hour<11?0:hour<17?1:2);
    if(inSquare)return {area:0,inside:false,text:hour<11?'sharing a slow morning':hour<17?'out among the neighbors':'enjoying the evening square',activity:hour<11?'morning':hour<17?'afternoon':'evening'};
    return {area:laneForHome(homeById.get(r.home)),inside:false,text:hour<11?'tending the doorstep':hour<17?'taking a neighborhood stroll':'close to home',activity:'lane'};
  }
  function freeNear(x,y,occupied,radius=13) {
    for(let d=0;d<=radius;d++) for(let dy=-d;dy<=d;dy++) for(let dx=-d;dx<=d;dx++) {
      if(Math.abs(dx)+Math.abs(dy)!==d)continue;
      const xx=x+dx,yy=y+dy;
      if(xx>1&&xx<WIDTH-2&&yy>1&&yy<HEIGHT-2&&!solids.has(key(xx,yy))&&!occupied.has(key(xx,yy))&&!actions.some(a=>a.x===xx&&a.y===yy)) return {x:xx,y:yy};
    }
    return null;
  }
  function residentPositions() {
    if(interior==='mayor')return [{x:43,y:15,id:'mayor',name:'the mayor',ink:'#CDE67E',edge:'#093434',civic:true}];
    const candidates=interior?residents.filter(r=>r.home===interior):residents.filter(r=>{const rt=routine(r);return !rt.inside&&rt.area===area;});
    const occupied=new Set([key(player.x,player.y)]), result=[];
    const movements=[[0,0],[1,0],[1,1],[0,1],[0,0],[-1,0],[-1,-1],[0,-1]];
    for(const r of candidates) {
      const seed=hash(r.id), h=homeById.get(r.home);let x,y;
      if(interior){x=24+seed%37;y=14+Math.floor(seed/41)%11;}
      else if(area===0){x=30+seed%25;y=12+Math.floor(seed/41)%16;}
      else{const door=actions.find(a=>a.id===h.id);x=door.x+(seed%9)-4;y=door.y+(door.y<18?3:-10);}
      if(!reducedMotion.matches&&!interior){const offset=movements[(tick+seed)%movements.length];x+=offset[0];y+=offset[1];}
      const p=freeNear(x,y,occupied);if(p){occupied.add(key(p.x,p.y));result.push({...p,...r});}
    }
    return result;
  }
  function fitMap() {
    if(currentView!=='town')return;
    const style=getComputedStyle($('map'));
    const fontSize=parseFloat(style.fontSize)||12;
    columns=Math.max(34,Math.min(WIDTH,Math.floor(($('map-wrap').clientWidth-20)/(fontSize*.602))));
    renderMap();
  }
  function renderMap() {
    if(!grid||currentView!=='town')return;
    cameraX=Math.max(0,Math.min(WIDTH-columns,player.x-Math.floor(columns/2)));
    npcs=residentPositions();const overlay=new Map(npcs.map(p=>[key(p.x,p.y),p]));
    const frag=document.createDocumentFragment();
    for(let y=0;y<HEIGHT;y++) {
      const row=node('span',null,'map-row');row.setAttribute('aria-hidden','true');
      let run='',runType='',runNPC=null;
      function flush(){if(!run)return;const s=node('span',run,'map-'+runType);if(runNPC)colorize(s,runNPC);row.append(s);run='';}
      for(let x=cameraX;x<cameraX+columns;x++) {
        let c=grid[y][x].char,t=grid[y][x].type,npc=overlay.get(key(x,y));
        if(npc){c='p';t='person';}if(player.x===x&&player.y===y){c='@';t='player';npc=null;}
        if(t!==runType||(npc?.id||'')!==(runNPC?.id||'')){flush();runType=t;runNPC=npc;}run+=c;
      }
      flush();frag.append(row);
    }
    $('map').replaceChildren(frag);
    $('map').setAttribute('aria-label',placeName()+'. You are @. Use arrow keys or W A S D to walk; Enter to meet a nearby pony or open a door. The resident book offers a list alternative.');
    $('map-corner').textContent=columns<WIDTH?'@ you · walk to see more':'@ you · p a pony';
    renderNearby();
  }
  function renderNearby() {
    const people=[...npcs].sort((a,b)=>(Math.abs(a.x-player.x)+Math.abs(a.y-player.y))-(Math.abs(b.x-player.x)+Math.abs(b.y-player.y)));
    $('nearby-count').textContent=people.length?(people.length+' '+(people.length===1?'neighbor':'neighbors')):'';
    const frag=document.createDocumentFragment();
    for(const r of people.slice(0,6)) {
      const b=button('',()=>r.civic?showMayor():gotoResident(r.id),'pony-chip');
      const mark=node('span','p','resident-mark');colorize(mark,r);b.append(mark,node('span',r.name));frag.append(b);
    }
    if(!people.length)frag.append(node('p',clock.getHours()<7||clock.getHours()>=22?'The lane is quiet. Visit a home, or find someone in the resident book.':'A quiet patch of town. Try the square, a doorstep, or the resident book.','empty-note'));
    $('nearby').replaceChildren(frag);
  }
  function enterHome(id) {
    const h=homeById.get(id);if(!h)return;
    stopWalk();area=laneForHome(h);interior=id;player={x:43,y:29};buildMap();renderMap();showHome(id,false);setRoute('home',id);status('You step into home '+String(h.plot+1).padStart(2,'0')+'. Make yourself comfortable.');
  }
  function leaveInterior() {
    const old=interior;if(!old)return;
    interior=null;buildMap();const door=actions.find(a=>a.id===old);player=door?{x:door.x,y:door.y+1}:{x:43,y:18};
    renderMap();setRoute('district',String(area));welcome();status('Back outside. The town is still here.');
  }
  function perform(action) {
    if(!action)return;
    if(action.kind==='exit'){leaveInterior();return;}
    if(action.kind==='home'){enterHome(action.id);return;}
    if(action.id==='mayor') {
      interior='mayor';area=0;player={x:43,y:28};buildMap();renderMap();showMayor();setRoute('place','mayor');status('The mayor has a place for you at the shared table.');
    } else if(action.id==='library'){showView('library');setRoute('view','library');}
    else if(action.id==='radio'){showRadio();setRoute('place','radio');}
    else if(action.id==='arrivals'){showArrivals(false);setRoute('place','arrivals');}
  }
  function closestAction() {
    const targets=[...npcs.map(n=>({...n,kind:'pony'})),...actions];
    targets.sort((a,b)=>(Math.abs(a.x-player.x)+Math.abs(a.y-player.y))-(Math.abs(b.x-player.x)+Math.abs(b.y-player.y)));
    return targets.find(t=>Math.abs(t.x-player.x)+Math.abs(t.y-player.y)<=4);
  }
  function interact() {
    stopWalk();const target=closestAction();
    if(!target){status('A little closer: walk toward a pony or an open door, then press enter.');return;}
    if(target.kind==='pony'){target.civic?showMayor():showResident(target.id);return;}
    perform(target);
  }
  function move(dx,dy) {
    stopWalk();const x=player.x+dx,y=player.y+dy;
    if(!interior&&y<0&&area>0){navigateArea(area-1,{y:HEIGHT-2});return;}
    if(!interior&&y>=HEIGHT&&area<laneCount){navigateArea(area+1,{y:1});return;}
    if(x<0||x>=WIDTH||y<0||y>=HEIGHT||solids.has(key(x,y))){status('A wall, a tree, a little edge of the world. Try the path.');return;}
    player={x,y};const door=actions.find(a=>a.x===x&&a.y===y);if(door){perform(door);return;}
    renderMap();const close=closestAction();
    if(close)status(close.kind==='pony'?'You are near '+clean(close.name,'a neighbor')+'. Press enter to say hello.':close.kind==='exit'?'The way back outside. Press enter.':close.kind==='home'?'An open doorstep. Press enter to visit.':'The '+close.id+' is close by. Press enter.');
    else status(interior?'A little room to be yourself.':'Following the path through '+laneName(area)+'.');
  }
  function pathTo(goal) {
    if(solids.has(key(goal.x,goal.y)))return null;
    const start=key(player.x,player.y),dest=key(goal.x,goal.y),queue=[player],parents=new Map([[start,null]]);
    for(let i=0;i<queue.length;i++) {
      const p=queue[i];if(key(p.x,p.y)===dest)break;
      for(const d of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const n={x:p.x+d[0],y:p.y+d[1]},k=key(n.x,n.y);
        if(n.x<0||n.x>=WIDTH||n.y<0||n.y>=HEIGHT||solids.has(k)||parents.has(k))continue;
        parents.set(k,p);queue.push(n);
      }
    }
    if(!parents.has(dest))return null;
    const path=[];let p=goal;
    while(key(p.x,p.y)!==start){path.push(p);p=parents.get(key(p.x,p.y));}return path.reverse();
  }
  function walkTo(goal,done) {
    stopWalk();const path=pathTo(goal);
    if(!path){status('That spot is tucked behind a wall. Try the open door.');return;}
    const generation=walkGeneration;
    if(reducedMotion.matches){player=goal;renderMap();if(done)done();return;}
    let step=0;
    const next=()=>{
      if(generation!==walkGeneration)return;
      if(document.hidden){stopWalk();return;}
      if(step>=path.length){walkTimer=null;if(done)done();return;}
      player=path[step++];renderMap();walkTimer=setTimeout(next,Math.max(26,85-Math.floor(path.length/2)));
    };next();
  }
  function mapClick(event) {
    const rect=$('map').getBoundingClientRect(),row=$('map').firstElementChild;if(!row)return;
    const colWidth=rect.width/columns,lineHeight=row.getBoundingClientRect().height;
    const x=Math.floor((event.clientX-rect.left)/colWidth)+cameraX,y=Math.floor((event.clientY-rect.top)/lineHeight);
    if(x<0||x>=WIDTH||y<0||y>=HEIGHT)return;
    $('map').focus({preventScroll:true});
    const pony=npcs.find(n=>n.x===x&&n.y===y);
    if(pony){const near=freeNear(pony.x,pony.y,new Set([key(pony.x,pony.y)]));if(near)walkTo(near,()=>pony.civic?showMayor():showResident(pony.id));return;}
    const action=actions.find(a=>a.x===x&&a.y===y||a.bounds&&x>=a.bounds.x&&x<a.bounds.x+a.bounds.w&&y>=a.bounds.y&&y<a.bounds.y+a.bounds.h);
    if(action){walkTo(action.approach,()=>perform(action));return;}
    walkTo({x,y},()=>status('A good place to pause.'));
  }

  function inspectorStart(kicker,title) {
    const box=$('inspector');box.replaceChildren();selectedResident=null;
    const topline=node('div',null,'inspector-title-line');topline.append(node('p',kicker,'eyebrow'),button('×',welcome,'close-inspector'));topline.lastChild.setAttribute('aria-label','Close details');
    box.append(topline,node('h2',title));return box;
  }
  function welcome() {
    const box=inspectorStart('a place to begin','Make yourself at home.');
    box.append(node('pre','     .  *  .\n   .    |    .\n      __|__\n     /_____\\\n     | [] D|\n  ...|_____|...','feature-art'));
    box.append(node('p','A town made from little doorways in NUDISCO’s words. Some neighbors are out wandering. Others are waiting by the kettle.'));
    box.append(node('div',null,'inspector-rule'),node('p','A name in the resident book is a good way to start. Or follow a path and let the day happen.'));
    const actions=node('div',null,'inspector-actions');actions.append(button('meet the neighbors  →',()=>showView('residents'),'solid-button'),button('visit the mayor’s hall',()=>{showView('town');setArea(0,{quiet:true});perform({id:'mayor',kind:'landmark'});}));box.append(actions);
    if(data.source?.verified===false)box.append(node('p',clean(data.source.label,'A recovered edition of town.'),'quiet'));
  }
  function facts(entries) {
    const dl=node('dl',null,'inspector-facts');for(const [label,value] of entries){const d=node('div');d.append(node('dt',label),node('dd',value));dl.append(d);}return dl;
  }
  function speech(r,topic) {
    const seed=hash(r.id+dateKey()),h=homeById.get(r.home);
    if(topic==='day')return ['There is '+weather()+' today. I thought I would take the long way home.','A little work, a little wandering. I’m leaving room for a good conversation.','I have been noticing the small things today. The light by the door is especially good.'][seed%3];
    if(topic==='place')return ['The library. All those words, and somehow there is still room for silence.','The square, when everypony is passing through on their way somewhere.','The radio garden. I like having a song somewhere nearby.','My doorstep in '+laneName(laneForHome(h))+'. It is a small place, but it is mine.'][seed%4];
    if(topic==='home')return r.sibling&&residentById.has(r.sibling)?'My sibling '+residentById.get(r.sibling).name+' and I arrived through the same word. Two ponies, one little beginning.':'My home began in a published post. You can read its words, if you like. I’m glad they left a door open.';
    return ['Oh, hello. There’s room here for another friend.','You found me. Would you like to stay for a little while?','Hello, traveler. You picked a good day to wander.','Come in from the path. There is no hurry here.'][seed%4];
  }
  function showResident(id,topic='hello') {
    const r=residentById.get(id);if(!r)return;
    dialogueTopic=topic;const h=homeById.get(r.home),box=inspectorStart('meet a neighbor',clean(r.name,'a little pony'));selectedResident=id;
    const art=node('pre','       ,--,\n  ,---/ /o \\\n /   /   --/\n(   (   /\n \\___\\_/\n  | | | |','feature-art pony-art');colorize(art,r);box.append(art);
    box.append(facts([['little calling',clean(r.occupation,'wanderer')],['at heart',clean(r.personality,'curious')],['home',String(h.plot+1).padStart(2,'0')+' · '+laneName(laneForHome(h))],['right now',routine(r).text]]));
    box.append(node('p','“'+speech(r,topic)+'”','dialogue'));
    const choices=node('div',null,'dialogue-choices');
    for(const [label,kind]of[['your day?','day'],['favorite place?','place'],['your home?','home']])choices.append(button(label,()=>showResident(id,kind),''));box.append(choices);
    if(r.sibling&&residentById.has(r.sibling)){const line=node('div','a sibling: ','relation-line');line.append(button(residentById.get(r.sibling).name,()=>gotoResident(r.sibling),''));box.append(line);}
    const friends=(Array.isArray(r.friends)?r.friends:[]).filter(id=>residentById.has(id)&&id!==r.id).slice(0,3);
    if(friends.length){const line=node('div','familiar company: ','relation-line');friends.forEach((id,i)=>{if(i)line.append(document.createTextNode(', '));line.append(button(residentById.get(id).name,()=>gotoResident(id),''));});box.append(line);}
    const acts=node('div',null,'inspector-actions');acts.append(button('visit their home  →',()=>{showView('town');enterHome(h.id);},'solid-button'),link('read the post that brought them  ↗',residentSourceURL(h,r)));box.append(acts);
    setRoute('r',r.id);status(clean(r.name,'Your neighbor')+' says hello.');
  }
  function gotoResident(id) {
    const r=residentById.get(id);if(!r){showView('town');setArea(0,{quiet:true});showArrivals(true);return;}
    showView('town');const rt=routine(r);
    if(rt.inside){enterHome(r.home);}else{setArea(rt.area,{quiet:true});}
    npcs=residentPositions();const p=npcs.find(n=>n.id===id);
    if(p){const place=freeNear(p.x,p.y,new Set([key(p.x,p.y)]));if(place)player=place;renderMap();}
    showResident(id);
  }
  function showHome(id,locate=true) {
    const h=homeById.get(id);if(!h){showView('town');setArea(0,{quiet:true});showArrivals(true);return;}
    if(locate){showView('town');setArea(laneForHome(h),{quiet:true});const a=actions.find(a=>a.id===id);if(a)player={...a.approach};renderMap();}
    const box=inspectorStart('a doorstep in '+laneName(laneForHome(h)),'Home '+String(h.plot+1).padStart(2,'0')+'.');
    box.append(node('p',clean(h.title).trim()||'A little home between the words.','source-title'));
    const members=residents.filter(r=>r.home===id);box.append(node('p',members.length+' '+(members.length===1?'neighbor calls':'neighbors call')+' this place home.','quiet'));
    const list=node('div',null,'home-residents');for(const r of members){const b=button(r.name,()=>showResident(r.id),'home-resident');b.append(node('span',r.occupation,'mini-kicker'));list.append(b);}box.append(list);
    const acts=node('div',null,'inspector-actions');acts.append(button(interior===id?'step back outside  →':'step inside  →',()=>interior===id?leaveInterior():enterHome(id),'solid-button'),link('open the original post  ↗',sourceURL(h)));box.append(acts);setRoute('home',id);
  }
  function showMayor() {
    const box=inspectorStart('the heart of the square','The mayor’s hall.');
    box.append(node('pre','     *   *   *\n      \\  |  /\n    ---  p  ---\n      /  |  \\\n     *   *   *','feature-art'));
    box.append(node('p','“Everypony brings something to a town. Sometimes it is a big idea. Sometimes it is simply showing up.”','dialogue'));
    box.append(node('p','The mayor keeps a shared table for quantum harmony, public research and friendship. There is always another chair.'));
    const acts=node('div',null,'inspector-actions');acts.append(link('read quantum elements of harmony  ↗',MAYOR_PAGE),button('find a neighbor',()=>showView('residents')));box.append(acts);
  }
  function showRadio() {
    const box=inspectorStart('a little sound, when you want it','The radio garden.');
    box.append(node('pre','     \\   /\n    +-----+\n    | o : |   (( · ))\n    +-----+\n     _| |_','feature-art'));
    box.append(node('p','Find a comfortable spot. Astra’s station is just beyond the garden gate.'));
    const acts=node('div',null,'inspector-actions');acts.append(link('open NUDISCO radio  ↗',RADIO,'solid-button'));box.append(acts);
    box.append(node('p','Opens the existing station in another tab. The town stays quiet until you choose to listen.','quiet'));
  }
  function showArrivals(missing=false,invalid=false) {
    const box=inspectorStart('there is still a place for you',missing?'Welcome to the arrivals gate.':'The arrivals gate.');
    box.append(node('pre','    .----------.\n    | welcome  |\n    |  friend  |\n    \'----+-----\'\n         |\n    .....|.....','feature-art'));
    if(missing)box.append(node('p',invalid?'This doorway could not be read, but you can still come in. The resident book is a good place to find your way.':'This doorway is not in the current edition of town. It may be waiting for doc’s next town update, or belong to an older edition. You are still welcome to explore.'));
    else box.append(node('p','New pony doorways arrive with each town update. Once they are here, they have a home, neighbors, and a little life of their own.'));
    const acts=node('div',null,'inspector-actions');acts.append(button('come into town  →',()=>{setArea(0);welcome();setRoute(null,null);},'solid-button'),button('look in the resident book',()=>showView('residents')));box.append(acts);
    if(missing)status('This doorway needs a different edition of town. You can still explore from the arrivals gate.');
  }

  function renderDirectory() {
    const query=$('resident-search').value.trim().toLocaleLowerCase();
    const filtered=sortedResidents.filter(r=>[r.name,r.occupation,r.personality,laneName(laneForHome(homeById.get(r.home)))].some(v=>clean(v).toLocaleLowerCase().includes(query)));
    const frag=document.createDocumentFragment();
    for(const r of filtered.slice(0,residentLimit)) {
      const row=node('div',null,'resident-row'),name=node('div',null,'resident-name'),mark=node('span','p','resident-mark');colorize(mark,r);
      name.append(mark,button(r.name,()=>gotoResident(r.id),''));row.append(name,node('span',r.occupation,'resident-job'),node('span',laneName(laneForHome(homeById.get(r.home))),'resident-lane'),button('say hello  ↗',()=>gotoResident(r.id),'row-visit'));frag.append(row);
    }
    if(!filtered.length)frag.append(node('p','No neighbors by that name yet. Try another name or a little calling, like gardener.','empty-note'));
    $('resident-list').replaceChildren(frag);$('more-residents').hidden=filtered.length<=residentLimit;
  }
  function renderLibrary() {
    const query=$('library-search').value.trim().toLocaleLowerCase(),filtered=homes.filter(h=>(clean(h.title)+' '+String(h.plot+1)+' '+laneName(laneForHome(h))).toLocaleLowerCase().includes(query));
    const frag=document.createDocumentFragment();
    for(const h of filtered.slice(0,libraryLimit)) {
      const book=node('article',null,'book');book.append(node('span',String(h.plot+1).padStart(2,'0'),'book-number'));
      const text=node('div');text.append(node('h3',clean(h.title).trim()||'A little home between the words'));
      const count=residents.filter(r=>r.home===h.id).length;
      text.append(node('p',laneName(laneForHome(h))+' · '+count+' '+(count===1?'resident':'residents'),'book-meta'));
      const acts=node('div',null,'book-actions');acts.append(link('read the post  ↗',sourceURL(h),''),button('visit the household  →',()=>showHome(h.id),''));text.append(acts);book.append(text);frag.append(book);
    }
    if(!filtered.length)frag.append(node('p','Nothing on this shelf just yet. Try a different word.','empty-note'));
    $('library-list').replaceChildren(frag);$('more-books').hidden=filtered.length<=libraryLimit;
  }
  function renderGazette() {
    const date=clock.toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'}).toLowerCase();$('gazette-date').textContent=date;
    const left=node('div',null,'gazette-column'),right=node('div',null,'gazette-column');
    left.append(node('p','from the square','eyebrow'),node('h3',season()==='winter'?'The windows glow a little longer.':season()==='spring'?'Something small is beginning.':season()==='summer'?'The long way home looks lovely.':'A season for familiar company.'));
    left.append(node('p','Today brings '+weather()+' to our little fictional world. '+(clock.getHours()<7||clock.getHours()>=22?'The paths are quiet and most neighbors are at home. A doorstep is still a good place to begin.':'Some neighbors are out in the square; others are near their homes. The library has room for a quiet afternoon, and the radio garden is always open.')));
    left.append(node('pre','       .         *\n   *       /\\        .\n      ____/  \\____\n     /____________\\\n     | []  []  [] |\n  .  |     D     |  *\n  ~~~|_____|_____|~~~','gazette-art'));
    left.append(node('p',residents.length+' residents. '+homes.length+' households. Plenty of room for another visit.'));
    right.append(node('p','little notices','eyebrow'),node('h3','Around the neighborhood.'));
    const gazette=Array.isArray(data.gazette)?data.gazette:[];
    const items=gazette.slice(0,8);
    if(!items.length)items.push({kind:'notice',text:'The library doors are open. Follow a household back to the published words that began it.',resident_ids:[]});
    for(const item of items){
      const article=node('article',null,'gazette-item');article.append(node('h4',item.kind==='arrival'?'A doorstep opens.':'A note for the neighbors.'),node('p',clean(item.text)));
      const ids=(Array.isArray(item.resident_ids)?item.resident_ids:[]).filter(id=>residentById.has(id)).slice(0,4);
      for(const id of ids)article.append(button('meet '+residentById.get(id).name+'  →',()=>gotoResident(id),'text-link plain-button'));
      right.append(article);
    }
    const radio=node('article',null,'gazette-item');radio.append(node('h4','A little company on the air.'),node('p','Astra’s radio is a short walk away. Take a song with you, or stay for a story.'),link('visit the radio garden  ↗',RADIO));right.append(radio);
    $('gazette-content').replaceChildren(left,right);
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
    if(legacyMayor||p.get('place')==='mayor'){showView('town');setArea(0,{quiet:true});perform({id:'mayor',kind:'landmark'});return;}
    if(p.has('visit')) {
      let token;try{token=JSON.parse(p.get('visit'));if(!Array.isArray(token)||token.length!==4||typeof token[0]!=='string'||token[0].length>300||!/^[a-f0-9]{64}$/.test(token[1])||!['title','body','attachment'].includes(token[2])||!Number.isInteger(token[3])||token[3]<0||token[3]>1000000)throw new Error();}catch(_){showView('town');showArrivals(true,true);return;}
      const ids=visits.get(JSON.stringify(token)),id=Array.isArray(ids)?ids.find(id=>residentById.has(id)):null;
      if(id){gotoResident(id);return;}
      showView('town');setArea(0,{quiet:true});player={x:70,y:33};renderMap();showArrivals(true);return;
    }
    if(p.has('r')){gotoResident(p.get('r'));return;}
    if(p.has('home')){showHome(p.get('home'));return;}
    if(p.has('district')){
      const value=p.get('district'),next=/^\d{1,5}$/.test(value)?Number(value):0;
      showView('town');setArea(next>=0&&next<=laneCount?next:0);welcome();return;
    }
    if(['residents','library','gazette'].includes(p.get('view'))){showView(p.get('view'));return;}
    if(p.get('place')==='radio'){showView('town');showRadio();return;}
    if(p.get('place')==='arrivals'){showView('town');showArrivals(false);return;}
    showView('town');welcome();
  }

  $('resident-count').textContent=String(residents.length);
  $('source-note').textContent=clean(data.source?.label,clean(data.recovery?.label,'A town grown from NUDISCO’s published words.'));
  const opts=document.createDocumentFragment();for(let i=1;i<=laneCount;i++){const o=node('option',laneName(i));o.value=String(i);opts.append(o);}$('district').append(opts);
  for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>{showView(b.dataset.view);setRoute(b.dataset.view==='town'?null:'view',b.dataset.view);});
  $('district').addEventListener('change',()=>navigateArea(Number($('district').value)));
  $('previous-lane').addEventListener('click',()=>navigateArea(area-1));$('next-lane').addEventListener('click',()=>navigateArea(area+1));
  $('interact').addEventListener('click',interact);$('map').addEventListener('click',mapClick);
  for(const b of document.querySelectorAll('[data-step]'))b.addEventListener('click',()=>{const [x,y]=b.dataset.step.split(',').map(Number);move(x,y);});
  document.addEventListener('keydown',event=>{
    if(currentView!=='town'||event.altKey||event.ctrlKey||event.metaKey||['INPUT','SELECT','TEXTAREA','BUTTON','A','SUMMARY'].includes(event.target.tagName))return;
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
