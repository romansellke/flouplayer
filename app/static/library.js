// The cached library: scanning, column prefs, column browser, type-ahead, album list rendering, search.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

$('#loadLibrary').onclick=async()=>{
  if(!$('#server').value){notify('Please select a media server first.');return}
  const btn=$('#loadLibrary');
  if(btn.classList.contains('busy')) return;
  setBusy(btn,true,'Loading');
  $('#content').innerHTML='<div class="empty">Loading library ...</div>';

  const poll=setInterval(async()=>{
    try{
      const p=await api('/api/scan/progress');
      if(p.running){
        btn.lastChild.textContent=`${p.count} tracks`;
        $('#content').innerHTML=`<div class="empty">Loading library: ${p.count} tracks found in ${p.containers} folders ... please wait.</div>`;
      }
    }catch(e){/* progress reporting is optional */}
  },800);

  try{
    const x=await api('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:$('#server').value,object_id:'0'})});
    state.tracks=enrichTracks(x.tracks);
    state.filters={album_artist:'',artist:'',album:'',year:''};
    $('#breadcrumb').textContent=`${x.count} tracks (${x.scan_root})`;
    render();
  }catch(e){
    logErr(e.message);
    $('#content').innerHTML=`<div class="empty">Failed to load: ${esc(e.message)}</div>`;
  }finally{
    clearInterval(poll);
    setBusy(btn,false);
  }
};

// ---------- Which track-list columns are shown (persisted locally) ----------
const ALL_COLUMNS=[
  {key:'quality',label:'Quality',default:true},
  {key:'bitrate',label:'Bitrate',default:false},
  {key:'time',label:'Time',default:true},
  {key:'artist',label:'Artist',default:false},   // the Album Artist is shown next to the cover
  {key:'genre',label:'Genre',default:false},
  {key:'year',label:'Year',default:false},
];
function loadColumnPrefs(){
  try{
    const saved=JSON.parse(localStorage.getItem('flou_columns_v2')||'null');
    if(saved) return saved;
  }catch(e){/* fall through to defaults */}
  const d={}; ALL_COLUMNS.forEach(c=>d[c.key]=c.default); return d;
}
function saveColumnPrefs(){try{localStorage.setItem('flou_columns_v2',JSON.stringify(state.columns))}catch(e){}}
state.columns=loadColumnPrefs();

function buildColumnMenu(){
  const menu=$('#colMenu');
  menu.innerHTML=ALL_COLUMNS.map(c=>
    `<label><input type="checkbox" data-col="${c.key}" ${state.columns[c.key]?'checked':''}> ${c.label}</label>`
  ).join('');
  menu.querySelectorAll('input').forEach(cb=>cb.onchange=()=>{
    state.columns[cb.dataset.col]=cb.checked;
    saveColumnPrefs();
    renderAlbums(true);
  });
}
$('#colToggle').onclick=e=>{e.stopPropagation();buildColumnMenu();$('#colMenu').classList.toggle('hidden')};
$('#colMenu').onclick=e=>e.stopPropagation();
document.addEventListener('click',()=>$('#colMenu').classList.add('hidden'));

// Tracks that match every filter EXCEPT the given one -- so each column
// can show its own possible values (with a correct count) without
// restricting itself.
function tracksExcluding(exceptKey){
  return state.tracks.filter(t=>FACET_ORDER.every(k=>{
    const v=state.filters[k];
    if(!v || k===exceptKey) return true;
    return (t[k]||'')===v;
  }));
}

// countBy 'albums': shows the number of distinct ALBUMS (sensible for
// Album Artist/Artist/Year). countBy 'tracks': number of tracks (sensible
// only for the Album column itself, where each entry is already one album).
function facetColumn(containerId,key,label,countBy){
  const base=tracksExcluding(key);
  const perValue=new Map();
  for(const t of base){
    const v=t[key];
    if(!v) continue;
    if(!perValue.has(v)) perValue.set(v, countBy==='albums' ? new Set() : 0);
    if(countBy==='albums') perValue.get(v).add(albumKey(t));
    else perValue.set(v, perValue.get(v)+1);
  }
  const countOf=v=>countBy==='albums' ? perValue.get(v).size : perValue.get(v);
  const values=[...perValue.keys()].sort((a,b)=>a.localeCompare(b));
  // "All X (N)" is the number of distinct entries listed below -- e.g.
  // "All Artists (214)" means 214 different artists, not the album/track
  // count that the individual entries below use for their own counting.
  const totalCount=values.length;

  const current=state.filters[key];
  const el=$(containerId);
  el.innerHTML='<li data-v="" class="'+(current?'':'active')+'">All '+label+` (${totalCount})</li>`
    +values.map(v=>`<li data-v="${esc(v)}" class="${v===current?'active':''}">${esc(v)} (${countOf(v)})</li>`).join('');
  el.querySelectorAll('li').forEach(li=>li.onclick=()=>{
    state.filters[key]=li.dataset.v;
    // Reset downstream columns when an upstream one (Album Artist before
    // Artist before Album) is re-selected.
    const idx=FACET_ORDER.indexOf(key);
    FACET_ORDER.slice(idx+1).forEach(k=>state.filters[k]='');
    render();
  });
}

// ---------- Collapsible column browser ----------
// While collapsed, the label names the active selection so a hidden filter isn't a surprise.
function updateFacetToggle(){
  const on=document.querySelector('.facets').classList.contains('collapsed');
  const sel=Object.values(state.filters).filter(Boolean).join(' · ');
  $('#facetToggle').textContent=on?('Browser ▸'+(sel?` (${sel})`:'')):'Browser ▾';
}
function setFacetsCollapsed(on,save=true){
  document.querySelector('.facets').classList.toggle('collapsed',on);
  updateFacetToggle();
  $('#facetToggle').setAttribute('aria-expanded',String(!on));
  if(save) try{localStorage.setItem('flou_facets_collapsed',on?'1':'0')}catch(e){}
}
function toggleFacets(){ setFacetsCollapsed(!document.querySelector('.facets').classList.contains('collapsed')) }
try{ if(localStorage.getItem('flou_facets_collapsed')==='1') setFacetsCollapsed(true,false) }catch(e){}
$('#facetToggle').onclick=toggleFacets;
document.addEventListener('keydown',e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='b'){ e.preventDefault(); toggleFacets() } });

// ---------- Type-ahead in the column browser ----------
// Typing letters jumps to the first entry starting with them in the column
// that was last clicked (or, failing that, the one under the mouse).
// Enter selects the highlighted entry; Escape clears the highlight.
const facetCols=[...document.querySelectorAll('.facets>div')];
let facetCurrent=null, facetHover=null, typeBuf='', typeTimer=null, typeHit=null;
facetCols.forEach(div=>{
  div.tabIndex=0;
  div.addEventListener('pointerdown',()=>{facetCurrent=div; div.focus({preventScroll:true}); clearTypeHit()});
  div.addEventListener('mouseenter',()=>{facetHover=div});
  div.addEventListener('mouseleave',()=>{if(facetHover===div) facetHover=null});
});
function clearTypeHit(){ if(typeHit) typeHit.classList.remove('typehit'); typeHit=null; typeBuf='' }
const sortKey=s=>s.replace(/^[^\p{L}\p{N}]+/u,'').toLowerCase();
document.addEventListener('keydown',e=>{
  if(e.metaKey||e.ctrlKey||e.altKey) return;
  const t=e.target;
  if(t && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable)) return;
  if(!$('#metaModal').classList.contains('hidden')||!$('#aboutModal').classList.contains('hidden')) return;
  const col=facetCurrent||facetHover;
  if(!col || col.offsetParent===null) return;
  if(e.key==='Escape'){ clearTypeHit(); return }
  if(e.key==='Enter'){
    if(typeHit){ e.preventDefault(); typeHit.click(); }
    return;
  }
  if(e.key.length!==1 || (e.key===' ' && !typeBuf)) return;
  e.preventDefault();
  typeBuf+=e.key.toLowerCase();
  clearTimeout(typeTimer);
  typeTimer=setTimeout(()=>{typeBuf=''},900);
  const items=[...col.querySelectorAll('li')].filter(li=>li.dataset.v);
  const match=items.find(li=>sortKey(li.dataset.v).startsWith(typeBuf));
  if(!match) return;
  if(typeHit) typeHit.classList.remove('typehit');
  typeHit=match; match.classList.add('typehit');
  // Scroll within the column only (not the page), leaving room for the sticky header.
  const head=col.querySelector('b').offsetHeight;
  col.scrollTop=Math.max(0,match.offsetTop-head-4);
});

function render(){
  typeHit=null; typeBuf='';
  updateFacetToggle();
  facetColumn('#albumArtists','album_artist','Album Artists','albums');
  facetColumn('#artists','artist','Artists','albums');
  facetColumn('#albumNames','album','Albums','tracks');
  facetColumn('#years','year','Years','albums');
  renderAlbums();
}

// Search only the visible tag fields -- not the raw DIDL XML, URIs or
// protocol info, which would make terms like "flac" or "http" match
// every track (and serialising every track per keystroke is slow).
const SEARCH_FIELDS=['title','artist','album_artist','album','genre','year'];
function currentlyFiltered(){
  const q=$('#search').value.trim().toLowerCase();
  return state.tracks.filter(t=>FACET_ORDER.every(k=>!state.filters[k]||(t[k]||'')===state.filters[k]))
                      .filter(t=>!q||SEARCH_FIELDS.some(k=>(t[k]||'').toLowerCase().includes(q)));
}

function trackRowCells(t,i){
  const playing=t.id===state.nowPlayingId;
  const c=state.columns;
  let cells=`<td class="n" data-n="${esc(t.track_number||(i+1))}">${playing?'▶':esc(t.track_number||(i+1))}</td><td class="title">${esc(t.title)}</td>`;
  if(c.quality) cells+=`<td class="quality">${qualityLabel(t.resources[0])}</td>`;
  if(c.bitrate) cells+=`<td class="bitrate">${bitrateLabel(t.resources[0])}</td>`;
  if(c.time) cells+=`<td class="time">${esc(t.resources[0]?.duration||'')}</td>`;
  if(c.artist) cells+=`<td class="artist">${esc(t.artist)}</td>`;
  if(c.genre) cells+=`<td class="genre">${esc(t.genre)}</td>`;
  if(c.year) cells+=`<td class="year">${esc(t.year)}</td>`;
  cells+=`<td class="qadd"><button type="button" data-qadd="${esc(t.id)}" title="Add to queue" aria-label="Add to queue">+</button></td>`;
  return `<tr class="clickable${playing?' playing':''}" data-item="${esc(t.id)}">${cells}</tr>`;
}

// state.view: what the album list currently shows -- all album groups in
// order (rendered chunk by chunk), plus a lookup of the listed tracks.
state.view={entries:[],groups:{},byId:new Map(),rendered:0};

// Next to the cover: the Album Artist tag; for untagged albums the artist if all tracks share one.
function albumArtistLabel(ts){
  if(ts[0].album_artist) return ts[0].album_artist;
  const artists=new Set(ts.map(t=>t.artist).filter(Boolean));
  return artists.size===1?[...artists][0]:'';
}

function albumHtml([key,ts]){
  const album=ts[0].album||'Unknown Album';
  return `
    <div class="album" data-album="${esc(key)}">
      <div class="albuminfo">
        <div class="cover" ${cover(ts[0].album_art)}></div>
        <div>
          <div class="albumtitle">${esc(album)} (${ts.length})</div>
          <div class="albumartist">${esc(albumArtistLabel(ts))}</div>
          <div class="meta">${esc(ts[0].year)}</div>
          <div class="albumqueue"><button type="button" data-qplay-album="${esc(key)}" title="Play album (replaces the queue)">▶</button><button type="button" data-qadd-album="${esc(key)}" title="Add album to queue">+ Queue</button></div>
        </div>
      </div>
      <div class="trackscroll"><table class="tracks"><tbody>
        ${ts.map((t,i)=>trackRowCells(t,i)).join('')}
      </tbody></table></div>
    </div>`;
}

// Appends the next `count` albums in front of the sentinel element.
function renderMoreAlbums(count=ALBUM_CHUNK){
  const v=state.view, sentinel=$('#albumSentinel');
  if(!sentinel||v.rendered>=v.entries.length) return false;
  const next=v.entries.slice(v.rendered,v.rendered+count);
  sentinel.insertAdjacentHTML('beforebegin',next.map(albumHtml).join(''));
  v.rendered+=next.length;
  if(v.rendered>=v.entries.length) sentinel.remove();
  return true;
}
// Keep adding chunks while the sentinel is within reach of the visible area.
function fillAlbums(){
  const c=$('#content');
  let s;
  while((s=$('#albumSentinel')) && s.getBoundingClientRect().top < c.getBoundingClientRect().bottom+1500){
    if(!renderMoreAlbums()) break;
  }
}
const albumObserver=new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting)) fillAlbums()},{root:$('#content'),rootMargin:'1500px'});

// keep=true re-renders in place (same albums rendered, same scroll
// position) -- used when only the look changes, e.g. the play marker.
function renderAlbums(keep=false){
  if(isLive()) return renderLive();
  const c=$('#content');
  const prevRendered=keep?state.view.rendered:0, prevScroll=keep?c.scrollTop:0;
  const filtered=currentlyFiltered();

  const groups={};
  filtered.forEach(t=>(groups[albumKey(t)]??=[]).push(t));
  Object.values(groups).forEach(list=>list.sort((a,b)=>(parseInt(a.track_number)||0)-(parseInt(b.track_number)||0)||a.title.localeCompare(b.title)));
  // Order: by Album Artist (the label shown next to the cover), then by album name; albums with no artist at all last.
  const cmp=(x,y)=>x.localeCompare(y,undefined,{sensitivity:'base',numeric:true});
  const entries=Object.entries(groups).map(([k,ts])=>[k,ts,albumArtistLabel(ts)])
    .sort(([ka,a,la],[kb,b,lb])=>(!la-!lb)||cmp(la,lb)||cmp(a[0].album||'',b[0].album||'')||ka.localeCompare(kb))
    .map(([k,ts])=>[k,ts]);
  state.currentPlaylist=entries.flatMap(([,ts])=>ts); // used for next/previous track
  state.view={entries,groups,byId:new Map(filtered.map(t=>[t.id,t])),rendered:0};

  $('#count').textContent=`${entries.length} albums · ${filtered.length} tracks`;
  albumObserver.disconnect();
  if(!entries.length){
    c.innerHTML='<div class="empty">No entries. Did you load the library and check your filters?</div>';
    return;
  }
  c.innerHTML='<div id="albumSentinel" class="sentinel"></div>';
  renderMoreAlbums(Math.max(prevRendered,ALBUM_CHUNK));
  c.scrollTop=prevScroll;
  fillAlbums();
  if($('#albumSentinel')) albumObserver.observe($('#albumSentinel'));
}

// Renders further chunks until the given track's row exists (if it's in
// the current view at all) and returns that row.
function ensureTrackRendered(id){
  const v=state.view;
  if(!v.byId.has(id)) return null;
  const idx=v.entries.findIndex(([,ts])=>ts.some(t=>t.id===id));
  if(idx>=v.rendered) renderMoreAlbums(idx+1-v.rendered+ALBUM_CHUNK); // all at once, plus a little beyond
  return document.querySelector(`#content [data-item="${CSS.escape(id)}"]`);
}

// Moves the ▶ marker between rows without re-rendering the list.
function markNowPlaying(prevId,newId){
  const row=id=>id&&document.querySelector(`#content [data-item="${CSS.escape(id)}"]`);
  const prev=row(prevId), next=row(newId);
  if(prev){prev.classList.remove('playing');const n=prev.querySelector('td.n');n.textContent=n.dataset.n}
  if(next){next.classList.add('playing');next.querySelector('td.n').textContent='▶'}
}

// One set of handlers for all (also later-rendered) rows and albums.
$('#content').addEventListener('dblclick',e=>{
  if(e.target.closest('button')) return;
  const tr=e.target.closest('[data-item]');
  if(tr) playItem(state.view.byId.get(tr.dataset.item));
});
$('#content').addEventListener('contextmenu',e=>{
  const tr=e.target.closest('[data-item]');
  if(tr){
    e.preventDefault();
    const t=state.view.byId.get(tr.dataset.item);
    if(t) showMetadata(`Track: ${t.title}`,formatTrackMeta(t));
    return;
  }
  const al=e.target.closest('.album');
  if(al){
    e.preventDefault();
    const ts=state.view.groups[al.dataset.album];
    const album=ts?.[0].album||'Unknown Album';
    if(ts) showMetadata(`Album: ${album}`,formatAlbumMeta(album,ts));
  }
});

$('#search').oninput=renderAlbums;

// ---------- Restore the last scanned library from disk on startup ----------
updateReadyState();
async function initFromCache(){
  if(state.tracks.length) return render();
  try{
    const cached=await api('/api/library/cached');
    state.tracks=enrichTracks(cached.tracks);
    const when=cached.scanned_at?new Date(cached.scanned_at*1000).toLocaleString():'';
    $('#breadcrumb').textContent=`${cached.count} tracks (cached, ${cached.scan_root}${when?' · '+when:''})`;
    render();
  }catch(e){/* no cached library yet -- that's fine, use Load Library */}
}
