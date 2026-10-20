// Live browsing of the media server (folder by folder) and the Live/Cached switch.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

// ---------- Live browsing (like the Linn app) ----------
// Instead of scanning the whole library, walk the media server's own
// folder tree: Artists / Albums / Genres / Folders ... as the server
// organises them. Containers are shown as cards, tracks as an album block
// (the same rendering, play, queue and now-playing code as the cached view).
const LIVE_PAGE=300;
const liveSeen={byUri:new Map(),byId:new Map()};   // every live track seen so far -> {t,stack}
const live={stack:[],containers:[],tracks:[],loaded:0,total:0,loading:false,seq:0};
function isLive(){return document.documentElement.dataset.libmode==='live'}
function libMode(){try{return localStorage.getItem('flou_libmode')==='cached'?'cached':'live'}catch(e){return 'live'}}

async function liveOpen(stack){
  const server=$('#server').value;
  if(!server){ $('#content').innerHTML='<div class="empty">Search for devices, then select a media server.</div>'; return }
  const seq=++live.seq;
  live.stack=stack; live.containers=[]; live.tracks=[]; live.loaded=0; live.total=0;
  $('#content').innerHTML='<div class="empty">Loading ...</div>';
  await liveMore(seq);
}
async function liveMore(seq=live.seq){
  const server=$('#server').value, id=live.stack[live.stack.length-1].id;
  if(live.loading===seq) return;   // this very load is already running (a newer navigation may start its own)
  live.loading=seq;
  try{
    const r=await api('/api/browse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:server,object_id:id,start:live.loaded,count:LIVE_PAGE})});
    if(seq!==live.seq) return; // navigated away meanwhile
    const items=r.items||[];
    live.containers.push(...items.filter(i=>i.type==='container'));
    const tr=items.filter(i=>i.type!=='container'&&i.resources?.length&&(!i.class||i.class.startsWith('object.item.audioItem')));
    live.tracks.push(...enrichTracks(tr));
    live.loaded+=r.number_returned||items.length;
    live.total=r.total_matches||0;
    if(!r.number_returned) live.total=live.loaded; // nothing more to fetch
  }catch(e){
    if(seq===live.seq){ logErr(e.message); $('#content').innerHTML=`<div class="empty">Failed to load: ${esc(e.message)}</div>`; }
    return;
  }finally{ if(live.loading===seq) live.loading=false }
  if(seq===live.seq) renderLive();
}
function liveCrumbs(){
  return live.stack.map((c,i)=>i===live.stack.length-1
    ?`<span class="crumb cur">${esc(c.title)}</span>`
    :`<button type="button" class="crumb" data-depth="${i}">${esc(c.title)}</button>`).join('<span class="sep">›</span>');
}
function renderLive(){
  const c=$('#content');
  if(!live.stack.length) return;
  live.tracks.forEach(t=>{ const e={t,stack:live.stack}; liveSeen.byId.set(t.id,e); const u=t.resources?.[0]?.uri; if(u) liveSeen.byUri.set(u,e) });
  const q=$('#search').value.trim().toLowerCase();
  const conts=live.containers.filter(x=>!q||x.title.toLowerCase().includes(q)||(x.artist||'').toLowerCase().includes(q));
  const tracks=live.tracks.filter(t=>!q||SEARCH_FIELDS.some(k=>(t[k]||'').toLowerCase().includes(q))).filter(qualityMatch);
  // tracks grouped by album, in server order (a folder is usually one album)
  const groups={}; tracks.forEach(t=>(groups[albumKey(t)]??=[]).push(t));
  const entries=Object.entries(groups);
  state.currentPlaylist=entries.flatMap(([,ts])=>ts);
  state.view={entries,groups,byId:new Map(tracks.map(t=>[t.id,t])),rendered:entries.length};
  $('#count').textContent=[conts.length?`${conts.length} folders`:'',tracks.length?`${tracks.length} tracks`:''].filter(Boolean).join(' · ');
  document.querySelector('#libTitle').textContent=live.stack[live.stack.length-1].title;
  $('#breadcrumb').textContent='Live · '+($('#server').selectedOptions[0]?.textContent||'');
  const cards=conts.map(x=>`<div class="livecard" data-cid="${esc(x.id)}" title="${esc(x.title)}"><div class="cover" ${cover(x.album_art)}>${x.album_art?'':'<span class="glyph">▤</span>'}</div><div class="livetitle">${esc(x.title)}</div>${x.artist?`<div class="livesub">${esc(x.artist)}</div>`:''}</div>`).join('');
  const more=live.loaded<live.total?`<div class="livemore"><button type="button" id="liveMore" class="btn-link">Load more (${live.loaded} of ${live.total})</button></div>`:'';
  const empty=(!conts.length&&!tracks.length)?`<div class="empty">${q||$('#qualityFilter').value?'Nothing matches the search or filter.':'This folder is empty.'}</div>`:'';
  c.innerHTML=`<div class="crumbs">${liveCrumbs()}</div>${cards?`<div class="livegrid">${cards}</div>`:''}${entries.map(albumHtml).join('')}${more}${empty}`;
}
$('#content').addEventListener('click',e=>{
  if(!isLive()) return;
  const card=e.target.closest('[data-cid]');
  if(card){
    const x=live.containers.find(k=>k.id===card.dataset.cid);
    if(x){ $('#search').value=''; liveOpen([...live.stack,{id:x.id,title:x.title}]) }
    return;
  }
  const crumb=e.target.closest('.crumb[data-depth]');
  if(crumb){ $('#search').value=''; liveOpen(live.stack.slice(0,+crumb.dataset.depth+1)) ; return }
  if(e.target.closest('#liveMore')) liveMore();
});
// Backspace / Alt+Left: one folder up
document.addEventListener('keydown',e=>{
  if(!isLive()||live.stack.length<2) return;
  const typing=/^(input|textarea|select)$/i.test(e.target.tagName);
  if((e.key==='Backspace'&&!typing)||(e.altKey&&e.key==='ArrowLeft')){ e.preventDefault(); liveOpen(live.stack.slice(0,-1)) }
});
$('#server').addEventListener('change',()=>{ if(isLive()) liveOpen($('#server').value?[{id:'0',title:'Home'}]:[]) });

function setLibMode(mode,save=true){
  document.documentElement.dataset.libmode=mode;
  $('#libMode').classList.toggle('active',mode==='live'); $('#libMode').setAttribute('aria-pressed',String(mode==='live'));
  if(save) try{localStorage.setItem('flou_libmode',mode)}catch(e){}
  $('#search').value='';
  if(mode==='live'){
    $('#libTitle').textContent='Library';
    if($('#server').value) liveOpen([{id:'0',title:'Home'}]);
    else{ state.view={entries:[],groups:{},byId:new Map(),rendered:0}; state.currentPlaylist=[]; $('#count').textContent=''; $('#breadcrumb').textContent='Live'; $('#content').innerHTML='<div class="empty">Search for devices, then select a media server.</div>' }
  }else{
    live.seq++; $('#libTitle').textContent='Albums by Artist'; $('#breadcrumb').textContent='Not loaded';
    initFromCache().then(()=>{ if(!state.tracks.length){ state.view={entries:[],groups:{},byId:new Map(),rendered:0}; state.currentPlaylist=[]; $('#count').textContent=''; $('#content').innerHTML='<div class="empty">Click "Load library" to scan the media server, or switch to Live to browse it directly.</div>' } });
  }
}
$('#libMode').onclick=()=>setLibMode(isLive()?'cached':'live');
setLibMode(libMode(),false);
