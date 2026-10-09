const $=s=>document.querySelector(s);
const state={devices:[],tracks:[],filters:{album_artist:'',artist:'',album:'',year:''},nowPlayingId:null,currentPlaylist:[]};
const FACET_ORDER=['album_artist','artist','album','year'];
// The album list is rendered in chunks as you scroll, so even the whole
// unfiltered library can be shown without making the window sluggish.
const ALBUM_CHUNK=40;
const LOCAL_RENDERER_ID='__local__';

const log=x=>{$('#log').textContent=typeof x==='string'?x:JSON.stringify(x,null,2)};

async function api(url,opt){
  let r;
  try{r=await fetch(url,opt)}
  catch(e){throw Error('Lost connection to the Flou Player background service -- please restart Flou Player.')}
  const j=await r.json();if(!r.ok)throw Error(j.detail||r.statusText);return j}
function isLocal(){return $('#renderer').value===LOCAL_RENDERER_ID}

function deviceOption(d){return `<option value="${esc(d.id)}" data-icon="${esc(d.icon||'')}">${esc(d.name)}${d.model?' · '+esc(d.model):''}</option>`}
function populateRendererSelect(devs){
  $('#renderer').innerHTML='<option value="">Select output device</option>'
    +`<option value="${LOCAL_RENDERER_ID}" data-icon="${ICON_LOCAL}">This computer (local speakers)</option>`
    +devs.map(deviceOption).join('');
  rendererPicker.refresh();
}
function populateServerSelect(devs){
  $('#server').innerHTML='<option value="">Select media server</option>'
    +devs.map(deviceOption).join('');
  serverPicker.refresh();
}

// ---------- Device pickers with icons ----------
// Native <select> options can't show images, so each device <select> gets
// a custom dropdown on top that shows the device's own UPnP icon (from its
// description's <iconList>, as the Linn app does). The hidden <select>
// stays the source of truth: the picker only sets its value and fires
// 'change', so everything reading $('#server')/$('#renderer') is unchanged.
const svgIcon=body=>'data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6b7480" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`);
const ICON_SERVER=svgIcon('<rect x="4" y="3" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/><circle cx="8" cy="6.5" r=".8" fill="#6b7480"/><circle cx="8" cy="17.5" r=".8" fill="#6b7480"/>');
const ICON_RENDERER=svgIcon('<rect x="6" y="2" width="12" height="20" rx="2"/><circle cx="12" cy="14.5" r="3.5"/><circle cx="12" cy="6.5" r="1.3"/>');
const ICON_LOCAL=svgIcon('<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>');

function createDevicePicker(select,fallbackIcon){
  const root=document.createElement('div');
  root.className='picker';
  root.innerHTML='<button type="button" class="picker-btn" aria-haspopup="listbox" aria-expanded="false"></button><ul class="picker-menu hidden" role="listbox" tabindex="-1"></ul>';
  select.after(root); select.classList.add('picker-source');
  const btn=root.querySelector('.picker-btn'), menu=root.querySelector('.picker-menu');
  let active=-1;

  function itemHtml(opt){
    const icon=opt.value?(opt.dataset.icon||fallbackIcon):'';
    return (icon?`<img class="picker-icon" alt="" src="${esc(icon)}">`:'<span class="picker-icon"></span>')
      +`<span class="picker-label">${esc(opt.textContent)}</span>`;
  }
  // Unreachable/broken device icons fall back to the generic symbol.
  function guardIcons(el){el.querySelectorAll('img.picker-icon').forEach(img=>img.addEventListener('error',()=>{img.src=fallbackIcon},{once:true}))}
  function refresh(){
    const opt=select.options[select.selectedIndex];
    btn.innerHTML=opt?itemHtml(opt):'';
    btn.classList.toggle('placeholder',!select.value);
    guardIcons(btn);
  }
  function setActive(i){
    const items=menu.children; if(!items.length) return;
    active=Math.max(0,Math.min(items.length-1,i));
    [...items].forEach((li,j)=>li.classList.toggle('active-item',j===active));
    items[active].scrollIntoView({block:'nearest'});
  }
  function open(){
    menu.innerHTML=[...select.options].map((o,i)=>`<li role="option" data-i="${i}" class="${o.value?'':'picker-placeholder'}" aria-selected="${i===select.selectedIndex}">${itemHtml(o)}</li>`).join('');
    guardIcons(menu);
    menu.querySelectorAll('li').forEach(li=>{
      li.onclick=e=>{e.stopPropagation();choose(+li.dataset.i)};
      li.onmousemove=()=>setActive(+li.dataset.i);
    });
    document.querySelectorAll('.picker-menu').forEach(m=>{if(m!==menu)m.classList.add('hidden')});
    menu.classList.remove('hidden'); btn.setAttribute('aria-expanded','true');
    setActive(select.selectedIndex);
  }
  function close(){menu.classList.add('hidden');btn.setAttribute('aria-expanded','false')}
  function choose(i){
    close(); btn.focus();
    if(i===select.selectedIndex) return;
    select.selectedIndex=i; refresh();
    select.dispatchEvent(new Event('change'));
  }
  btn.onclick=e=>{e.stopPropagation();menu.classList.contains('hidden')?open():close()};
  btn.onkeydown=e=>{
    const isOpen=!menu.classList.contains('hidden');
    if(!isOpen&&['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){e.preventDefault();open();return}
    if(!isOpen) return;
    if(e.key==='ArrowDown'){e.preventDefault();setActive(active+1)}
    else if(e.key==='ArrowUp'){e.preventDefault();setActive(active-1)}
    else if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(active)}
    else if(e.key==='Escape'||e.key==='Tab'){close()}
  };
  document.addEventListener('click',close);
  refresh();
  return {refresh};
}
$(`#renderer option[value="${LOCAL_RENDERER_ID}"]`).dataset.icon=ICON_LOCAL; // the initial HTML option
const serverPicker=createDevicePicker($('#server'),ICON_SERVER);
const rendererPicker=createDevicePicker($('#renderer'),ICON_RENDERER);

// Fills in derived fields once per loaded track:
// - year: plain YYYY pulled out of whatever date string the server sent.
// - trims artist/album_artist/album/genre: some taggers leave stray
//   leading/trailing whitespace, which otherwise creates duplicate-looking
//   entries that only differ by an invisible space.
// No computed fallback for album_artist: the column browser shows and
// filters strictly on the tag as delivered by the server, nothing more.
// (iTunes' "infer from Artist" behaviour happens once at library import,
// permanently rewriting its own stored value -- not on every read/filter
// in the browser. MinimServer streams the file tags live and does no such
// import step, so replicating that here would just be guessing on top of
// someone else's data.) If album_artist isn't tagged, the track simply
// doesn't appear under any Album Artist entry, like any other empty field.
function enrichTracks(tracks){
  tracks.forEach(t=>{
    t.year=(t.date||'').match(/\d{4}/)?.[0]||'';
    t.artist=(t.artist||'').trim();
    t.album=(t.album||'').trim();
    t.genre=(t.genre||'').trim();
    t.album_artist=(t.album_artist||'').trim();
  });
  return tracks;
}

// Guidance messages need to be impossible to miss -- the Diagnostics panel
// is collapsed by default, so a plain log() alone can look like nothing
// happened at all. notify() logs AND shows a brief on-screen toast.
let toastTimer;
function showToast(msg){
  const el=$('#toast');
  el.textContent=msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.add('hidden'),Math.max(3200,msg.length*55));
}
function notify(msg){ log(msg); showToast(msg); }

// Dims the transport controls and hints in the display when playback
// can't actually do anything yet (no output device chosen) -- so it's
// visible up front instead of only failing silently on double-click.
function updateReadyState(){
  const ready=!!$('#renderer').value;
  document.querySelectorAll('.transport button, .transport input[type=range]').forEach(el=>el.classList.toggle('disabled',!ready));
  if(!state.nowPlayingId) $('#playingSub').textContent = ready ? 'Local Music Control' : 'Select an output device to enable playback';
}

$('#discover').onclick=async()=>{
  try{
    log('Searching local network ...');
    const x=await api('/api/discover');
    state.devices=x.devices;
    populateServerSelect(x.devices.filter(d=>d.server));
    populateRendererSelect(x.devices.filter(d=>d.renderer));
    log(x.devices);
    updateReadyState();
  }catch(e){log(e.message)}
};

$('#loadLibrary').onclick=async()=>{
  if(!$('#server').value){notify('Please select a media server first.');return}
  const btn=$('#loadLibrary'); const original=btn.textContent;
  btn.disabled=true;
  $('#content').innerHTML='<div class="empty">Loading library ...</div>';

  const poll=setInterval(async()=>{
    try{
      const p=await api('/api/scan/progress');
      if(p.running){
        btn.textContent=`${p.count} tracks ...`;
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
    log(e.message);
    $('#content').innerHTML=`<div class="empty">Failed to load: ${esc(e.message)}</div>`;
  }finally{
    clearInterval(poll);
    btn.textContent=original; btn.disabled=false;
  }
};

// Albums are told apart by name AND album artist, so e.g. several
// "Greatest Hits" by different artists don't merge into one.
function albumKey(t){return (t.album||'Unknown Album')+'\u0001'+(t.album_artist||'')}

function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function cover(uri){return uri?`style="background-image:url('${esc(uri)}')"`:''}

// ---------- Metadata inspector (right-click a track or an album) ----------
function showMetadata(title,text){
  $('#metaTitle').textContent=title;
  $('#metaBody').textContent=text;
  $('#metaModal').classList.remove('hidden');
}
$('#metaClose').onclick=()=>$('#metaModal').classList.add('hidden');
$('#metaModal').onclick=e=>{ if(e.target.id==='metaModal') $('#metaModal').classList.add('hidden') };
document.addEventListener('keydown',e=>{ if(e.key==='Escape') $('#metaModal').classList.add('hidden') });

function formatTrackMeta(t){
  const r=t.resources[0]||{};
  return [
    `Title: ${t.title}`,
    `Artist: ${t.artist||'(not set)'}`,
    `Album Artist (tag): ${t.album_artist||'(not set)'}`,
    `Album: ${t.album||'(not set)'}`,
    `Genre: ${t.genre||'(not set)'}`,
    `Date: ${t.date||'(not set)'}`,
    `Track #: ${t.track_number||'(not set)'}`,
    `Object class: ${t.class||'(not set)'}`,
    `Album art URI: ${t.album_art||'(not set)'}`,
    '',
    `Playback URI: ${r.uri||''}`,
    `Protocol info: ${r.protocol||''}`,
    `Duration: ${r.duration||'(not set)'}`,
    `Sample rate: ${r.sample_rate||'(not set)'}`,
    `Bits per sample: ${r.bits_per_sample||'(not set)'}`,
    `Bitrate (bytes/s): ${r.bitrate||'(not set)'}`,
    '',
    '--- Raw DIDL-Lite XML from the server ---',
    t.metadata||'(none)'
  ].join('\n');
}
function formatAlbumMeta(albumName,ts){
  const lines=[`Album: ${albumName}`,`Tracks: ${ts.length}`,''];
  ts.forEach(t=>{
    lines.push(`#${t.track_number||'?'}  ${t.title}`);
    lines.push(`    Artist: ${t.artist||'(not set)'}    Album Artist (tag): ${t.album_artist||'(not set)'}`);
    lines.push(`    Genre: ${t.genre||'(not set)'}    Date: ${t.date||'(not set)'}`);
  });
  return lines.join('\n');
}
function qualityLabel(res){
  if(!res) return '';
  const parts=[];
  if(res.sample_rate) parts.push(`${(parseInt(res.sample_rate)/1000).toFixed(1)}kHz`);
  if(res.bits_per_sample) parts.push(`${esc(res.bits_per_sample)}bit`);
  if(!parts.length && res.bitrate) parts.push(`${Math.round(parseInt(res.bitrate)*8/1000)}kbps`);
  return parts.join('/');
}
function bitrateLabel(res){
  if(!res||!res.bitrate) return '';
  return `${Math.round(parseInt(res.bitrate)*8/1000)}kbps`;
}

// ---------- Which track-list columns are shown (persisted locally) ----------
const ALL_COLUMNS=[
  {key:'quality',label:'Quality',default:true},
  {key:'bitrate',label:'Bitrate',default:false},
  {key:'time',label:'Time',default:true},
  {key:'artist',label:'Artist',default:true},
  {key:'album_artist',label:'Album Artist',default:false},
  {key:'genre',label:'Genre',default:false},
  {key:'year',label:'Year',default:false},
];
function loadColumnPrefs(){
  try{
    const saved=JSON.parse(localStorage.getItem('flou_columns')||'null');
    if(saved) return saved;
  }catch(e){/* fall through to defaults */}
  const d={}; ALL_COLUMNS.forEach(c=>d[c.key]=c.default); return d;
}
function saveColumnPrefs(){try{localStorage.setItem('flou_columns',JSON.stringify(state.columns))}catch(e){}}
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
  if(!$('#metaModal').classList.contains('hidden')) return;
  const col=facetCurrent||facetHover;
  if(!col) return;
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
  if(c.album_artist) cells+=`<td class="albumartist">${esc(t.album_artist)}</td>`;
  if(c.genre) cells+=`<td class="genre">${esc(t.genre)}</td>`;
  if(c.year) cells+=`<td class="year">${esc(t.year)}</td>`;
  return `<tr class="clickable${playing?' playing':''}" data-item="${esc(t.id)}">${cells}</tr>`;
}

// state.view: what the album list currently shows -- all album groups in
// order (rendered chunk by chunk), plus a lookup of the listed tracks.
state.view={entries:[],groups:{},byId:new Map(),rendered:0};

function albumHtml([key,ts]){
  const album=ts[0].album||'Unknown Album';
  return `
    <div class="album" data-album="${esc(key)}">
      <div class="albuminfo">
        <div class="cover" ${cover(ts[0].album_art)}></div>
        <div>
          <div class="albumtitle">${esc(album)} (${ts.length})</div>
          <div>${esc(ts[0].album_artist)}</div>
          <div class="meta">${esc(ts[0].year)}</div>
        </div>
      </div>
      <table class="tracks"><tbody>
        ${ts.map((t,i)=>trackRowCells(t,i)).join('')}
      </tbody></table>
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
  const c=$('#content');
  const prevRendered=keep?state.view.rendered:0, prevScroll=keep?c.scrollTop:0;
  const filtered=currentlyFiltered();

  const groups={};
  filtered.forEach(t=>(groups[albumKey(t)]??=[]).push(t));
  Object.values(groups).forEach(list=>list.sort((a,b)=>(parseInt(a.track_number)||0)-(parseInt(b.track_number)||0)||a.title.localeCompare(b.title)));
  const entries=Object.entries(groups).sort(([a],[b])=>a.localeCompare(b));
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

// ---------- Local playback: pick a resource the built-in engine can play ----------
// Servers like MinimServer offer several <res> variants per track (the
// original file plus transcoded streams). The app window's web engine (Qt
// WebEngine from PyPI) plays FLAC, WAV, MP3 and Ogg, but not AAC/ALAC
// (.m4a), DSD, AIFF or raw PCM streams (audio/L16) -- and it doesn't
// recognise MIME names like "audio/x-flac" that servers commonly use, so
// they're normalised before asking canPlayType().
const MIME_ALIASES={'audio/x-flac':'audio/flac','audio/x-wav':'audio/wav','audio/wave':'audio/wav','audio/x-ogg':'audio/ogg','audio/x-mp3':'audio/mpeg','audio/mp3':'audio/mpeg'};
const LOCAL_UNPLAYABLE=/^audio\/(mp4|x-m4a|m4a|aac|x-aac|l16|l24|l8|x-dsf|x-dff|dsd|x-dsd|aiff|x-aiff)\b/;
function resourceMime(res){return ((res?.protocol||'').split(':')[2]||'').trim().toLowerCase()}
function localPlayScore(res){
  const mime=resourceMime(res);
  if(!mime||mime==='*') return 1; // unknown: worth a try
  const norm=MIME_ALIASES[mime.split(';')[0]]||mime;
  if(LOCAL_UNPLAYABLE.test(norm)) return 0;
  const c=$('#localAudio').canPlayType(norm);
  return c==='probably'?3:c==='maybe'?2:0;
}
// Direct variants first; as a last resort the backend re-encodes the
// original file to FLAC (/api/transcode) -- that's how .m4a (AAC/ALAC)
// plays. Raw PCM streams (audio/L16) can't be transcoded: they carry no
// format header ffmpeg could read.
const RAW_PCM=/^audio\/l(8|16|20|24)\b/;
function localCandidates(t){
  const res=t.resources||[];
  const direct=res.map((r,i)=>({r,i,score:localPlayScore(r)}))
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.i-b.i).map(x=>x.r);
  const src=res.find(r=>r.uri&&!RAW_PCM.test(resourceMime(r)));
  if(src) direct.push({...src,uri:`/api/transcode?url=${encodeURIComponent(src.uri)}`,protocol:'http-get:*:audio/flac:*',transcoded:true});
  return direct;
}
function formatName(t){
  const mimes=[...new Set((t.resources||[]).map(resourceMime).filter(Boolean))];
  return mimes.length?mimes.join(', '):'unknown format';
}
async function playLocal(t){
  const candidates=localCandidates(t);
  if(!candidates.length) throw Error(`"${t.title}" can't be played on this computer's speakers: its format (${formatName(t)}) isn't supported by the built-in player. Play it on the output device instead.`);
  const audio=$('#localAudio');
  let lastErr;
  for(const res of candidates){ // fall back to the next variant if one fails to load
    try{
      // Transcoded streams don't announce their length; use the server's.
      state.localDurationHint=parseClock(res.duration||'');
      audio.src=res.uri;await audio.play();
      if(res.transcoded) log(`Playing "${t.title}" via transcoding to FLAC (${formatName(t)} isn't supported directly; seeking is not possible).`);
      return;
    }catch(e){lastErr=e;log(`Local playback failed for ${resourceMime(res)||'?'} ${res.uri}: ${e.message}`)}
  }
  throw Error(`"${t.title}" couldn't be played on this computer's speakers (${formatName(t)}): ${lastErr?.message||'unknown error'}`);
}

async function playItem(t){
  if(!$('#renderer').value||!t?.resources?.[0]) return notify('Select an output device above before playing a track.');
  try{
    if(isLocal()){
      await playLocal(t);
    }else{
      await api('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:$('#renderer').value,action:'set_uri',uri:t.resources[0].uri,metadata:t.metadata})});
    }
    const prevId=state.nowPlayingId;
    state.nowPlayingId=t.id;
    $('#jumpNowPlaying').disabled=false;
    $('#playing').textContent=t.title;
    $('#playingSub').textContent=`${t.artist} · ${t.album}`;
    $('#npTitle').textContent=t.title;
    $('#npArtist').textContent=t.artist;
    $('#npCover').style.backgroundImage=t.album_art?`url('${t.album_art}')`:'';
    $('#status').textContent='Now playing';
    markNowPlaying(prevId,t.id); // move the play icon to the now-playing track
  }catch(e){notify(e.message)}
}

// ---------- Jump to the now-playing track ----------
// Scrolls the album list to the current track (rendering further chunks
// if needed). If it's hidden by the current filters/search, switch the
// view to its album first -- like iTunes' "Go to Current Song".
function jumpToNowPlaying(){
  const t=state.tracks.find(x=>x.id===state.nowPlayingId);
  if(!t) return notify('Nothing from the loaded library is playing right now.');
  if(!state.view.byId.has(t.id)){
    $('#search').value='';
    state.filters={album_artist:t.album_artist||'',artist:t.album?'':(t.artist||''),album:t.album||'',year:''};
    render();
    document.querySelectorAll('.facets li.active').forEach(li=>li.scrollIntoView({block:'nearest'}));
  }
  const row=ensureTrackRendered(t.id);
  if(!row) return;
  row.scrollIntoView({block:'center'});
  row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
}
$('#jumpNowPlaying').onclick=jumpToNowPlaying;

function playNextInPlaylist(){
  const list=state.currentPlaylist;
  const idx=list.findIndex(t=>t.id===state.nowPlayingId);
  if(idx<0) return;
  // On the local speakers, skip tracks the built-in player can't play
  // (e.g. .m4a) instead of stopping there.
  const next=list.slice(idx+1).find(t=>!isLocal()||localCandidates(t).length);
  if(next) playItem(next);
}
function playPreviousInPlaylist(){
  const idx=state.currentPlaylist.findIndex(t=>t.id===state.nowPlayingId);
  if(idx<=0) return;
  playItem(state.currentPlaylist[idx-1]);
}

// ---------- Transport buttons ----------
// Next/previous always step through our own currently displayed track list
// -- both for local playback and for UPnP renderers, which in this app
// never get a real server-side queue to step through on their own.
let userInitiatedStop=false;
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=async()=>{
  if(!$('#renderer').value) return notify('Select an output device above first.');
  const action=b.dataset.action;
  if(action==='next') return playNextInPlaylist();
  if(action==='previous') return playPreviousInPlaylist();

  if(isLocal()){
    const audio=$('#localAudio');
    if(action==='play') audio.play().catch(e=>log(e.message));
    else if(action==='pause') audio.pause();
    else if(action==='stop'){audio.pause();audio.currentTime=0}
    return;
  }
  if(action==='stop') userInitiatedStop=true;
  try{await api('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:$('#renderer').value,action})})}
  catch(e){log(e.message)}
});

// ---------- Volume: finer control, with dB readout where available ----------
// For local playback there's no dB service -- just a plain 0-100 gain on
// the <audio> element.
$('#renderer').addEventListener('change',()=>{
  if(!isLocal()) $('#localAudio').pause(); // don't keep playing locally in the background once switched away
  refreshVolume();
  updateReadyState();
});
let volDragging=false;   // user is holding the slider: don't overwrite it from device readbacks
let volCur=null;         // value last sent to the device (what the device is at / heading to)
let volTarget=null;      // where the slider wants the device to go
let volTimer=null;
const VOL_STEP_MAX=2;    // max device steps per tick, so clicks/fast drags ramp instead of jumping
const VOL_TICK_MS=80;
const volLabel=(v)=>v.db!=null ? `${v.db>0?'+':''}${v.db.toFixed(1)} dB` : `${v.percent}%`;
async function refreshVolume(){
  if(!$('#renderer').value) return;
  if(isLocal()){
    const audio=$('#localAudio');
    $('#volume').max=100;
    $('#volume').value=Math.round(audio.volume*100);
    $('#volumeLabel').textContent=`${$('#volume').value}%`;
    return;
  }
  try{
    const v=await api(`/api/devices/${$('#renderer').value}/volume`);
    $('#volume').max=v.max;
    volCur=v.raw;
    if(!volDragging && volTimer===null){ $('#volume').value=v.raw; }
    $('#volumeLabel').textContent=volLabel(v);
  }catch(e){/* volume info is optional, ignore */}
}
function volRamp(){
  if(volTimer!==null) return;
  const tick=async()=>{
    if(volTarget===null || volCur===null || volCur===volTarget){ volTimer=null; refreshVolume(); return; }
    const delta=Math.max(-VOL_STEP_MAX,Math.min(VOL_STEP_MAX,volTarget-volCur));
    const next=volCur+delta;
    try{
      await api('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:$('#renderer').value,action:'volume',value:next})});
      volCur=next;
    }catch(x){log(x.message); volTimer=null; volTarget=null; return}
    volTimer=setTimeout(tick,VOL_TICK_MS);
  };
  volTimer=setTimeout(tick,0);
}
async function setVolumeTarget(val){
  if(volCur===null){ await refreshVolume(); if(volCur===null) return; }
  volTarget=Math.max(0,Math.min(+$('#volume').max,val));
  volRamp();
}
$('#volume').addEventListener('pointerdown',()=>{volDragging=true});
window.addEventListener('pointerup',()=>{ if(volDragging){ volDragging=false; } });
$('#volume').oninput=e=>{
  if(isLocal()){
    $('#localAudio').volume=Math.max(0,Math.min(100,+e.target.value))/100;
    $('#volumeLabel').textContent=`${e.target.value}%`;
    return;
  }
  if(!$('#renderer').value) return;
  setVolumeTarget(+e.target.value);
};
// Mouse wheel: one step at a time (shift = 5), instead of the browser default.
$('#volume').addEventListener('wheel',e=>{
  e.preventDefault();
  const el=e.currentTarget, dir=e.deltaY<0?1:-1, step=e.shiftKey?5:1;
  el.value=Math.max(+el.min,Math.min(+el.max,+el.value+dir*step));
  el.dispatchEvent(new Event('input'));
},{passive:false});

// ---------- Elapsed-time display + auto-advance to the next track ----------
function fmtClock(sec){sec=Math.max(0,Math.round(sec||0));const m=Math.floor(sec/60),ss=sec%60;return `${m}:${String(ss).padStart(2,'0')}`}

// Local playback: the <audio> element already knows exactly when a track
// ends and exactly where it is -- no polling/heuristics needed.
const localAudioEl=$('#localAudio');
localAudioEl.addEventListener('timeupdate',()=>{
  if(!isLocal()) return;
  const d=localAudioEl.duration, dur=Number.isFinite(d)&&d>0?d:state.localDurationHint;
  $('#elapsed').textContent = dur ? `${fmtClock(localAudioEl.currentTime)} / ${fmtClock(dur)}` : fmtClock(localAudioEl.currentTime);
});
localAudioEl.addEventListener('ended',()=>{ if(isLocal()) playNextInPlaylist() });

// UPnP renderers: no direct access to their playback clock, so poll it.
function parseClock(s){
  if(!s) return 0;
  return s.split(':').map(Number).reduce((acc,v)=>acc*60+v,0);
}
let lastPoll={state:null,relSec:0,durSec:0};
async function pollTransport(){
  if(!$('#renderer').value||isLocal()) return;
  try{
    const t=await api(`/api/devices/${$('#renderer').value}/transport`);
    const relSec=parseClock(t.rel_time), durSec=parseClock(t.duration);
    $('#elapsed').textContent = durSec ? `${fmtClock(relSec)} / ${fmtClock(durSec)}` : '';
    const wasNearEnd=lastPoll.durSec>0 && (lastPoll.durSec-lastPoll.relSec)<=3;
    if(t.state==='STOPPED' && lastPoll.state==='PLAYING' && !userInitiatedStop && wasNearEnd && state.nowPlayingId){
      playNextInPlaylist();
    }
    if(t.state!=='STOPPED') userInitiatedStop=false;
    lastPoll={state:t.state,relSec,durSec};
  }catch(e){/* the output device may not support position queries -- ignore */}
}
setInterval(pollTransport,1500);

$('#search').oninput=renderAlbums;
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='f'){e.preventDefault();$('#search').focus()}});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='l'&&state.nowPlayingId){e.preventDefault();jumpToNowPlaying()}});

// ---------- Restore the last scanned library from disk on startup ----------
updateReadyState();
(async function initFromCache(){
  try{
    const cached=await api('/api/library/cached');
    state.tracks=enrichTracks(cached.tracks);
    const when=cached.scanned_at?new Date(cached.scanned_at*1000).toLocaleString():'';
    $('#breadcrumb').textContent=`${cached.count} tracks (cached, ${cached.scan_root}${when?' · '+when:''})`;
    render();
  }catch(e){/* no cached library yet -- that's fine, use Load Library */}
})();
