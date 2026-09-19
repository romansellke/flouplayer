const $=s=>document.querySelector(s);
const state={devices:[],tracks:[],filters:{album_artist:'',artist:'',album:'',year:''},nowPlayingId:null,currentPlaylist:[]};
const FACET_ORDER=['album_artist','artist','album','year'];
const MAX_UNFILTERED_TRACKS=1500; // brake: only render once the selection is small enough
const LOCAL_RENDERER_ID='__local__';

const log=x=>{$('#log').textContent=typeof x==='string'?x:JSON.stringify(x,null,2)};

async function api(url,opt){const r=await fetch(url,opt);const j=await r.json();if(!r.ok)throw Error(j.detail||r.statusText);return j}
function isLocal(){return $('#renderer').value===LOCAL_RENDERER_ID}

function populateRendererSelect(devs){
  $('#renderer').innerHTML='<option value="">Select output device</option>'
    +`<option value="${LOCAL_RENDERER_ID}">This computer (local speakers)</option>`
    +devs.map(d=>`<option value="${d.id}">${d.name}${d.model?' · '+d.model:''}</option>`).join('');
}
function populateServerSelect(devs){
  $('#server').innerHTML='<option value="">Select media server</option>'
    +devs.map(d=>`<option value="${d.id}">${d.name}${d.model?' · '+d.model:''}</option>`).join('');
}

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
  toastTimer=setTimeout(()=>el.classList.add('hidden'),3200);
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
    $('#content').innerHTML=`<div class="empty">Failed to load: ${e.message}</div>`;
  }finally{
    clearInterval(poll);
    btn.textContent=original; btn.disabled=false;
  }
};

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
  if(res.bits_per_sample) parts.push(`${res.bits_per_sample}bit`);
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
    renderAlbums();
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
    if(countBy==='albums') perValue.get(v).add(t.album||'');
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

function render(){
  facetColumn('#albumArtists','album_artist','Album Artists','albums');
  facetColumn('#artists','artist','Artists','albums');
  facetColumn('#albumNames','album','Albums','tracks');
  facetColumn('#years','year','Years','albums');
  renderAlbums();
}

function currentlyFiltered(){
  const q=$('#search').value.toLowerCase();
  return state.tracks.filter(t=>FACET_ORDER.every(k=>!state.filters[k]||(t[k]||'')===state.filters[k]))
                      .filter(t=>!q||JSON.stringify(t).toLowerCase().includes(q));
}

function trackRowCells(t,i){
  const playing=t.id===state.nowPlayingId;
  const c=state.columns;
  let cells=`<td class="n">${playing?'▶':(t.track_number||(i+1))}</td><td class="title">${esc(t.title)}</td>`;
  if(c.quality) cells+=`<td class="quality">${qualityLabel(t.resources[0])}</td>`;
  if(c.bitrate) cells+=`<td class="bitrate">${bitrateLabel(t.resources[0])}</td>`;
  if(c.time) cells+=`<td class="time">${esc(t.resources[0]?.duration||'')}</td>`;
  if(c.artist) cells+=`<td class="artist">${esc(t.artist)}</td>`;
  if(c.album_artist) cells+=`<td class="albumartist">${esc(t.album_artist)}</td>`;
  if(c.genre) cells+=`<td class="genre">${esc(t.genre)}</td>`;
  if(c.year) cells+=`<td class="year">${esc(t.year)}</td>`;
  return `<tr class="clickable${playing?' playing':''}" data-item="${esc(t.id)}">${cells}</tr>`;
}

function renderAlbums(){
  const filtered=currentlyFiltered();
  const anyFilterActive=FACET_ORDER.some(k=>state.filters[k])||$('#search').value.trim();

  // Brake: on very large libraries, don't dump the whole unfiltered
  // library into the DOM (that makes the page noticeably sluggish) --
  // ask the user to narrow it down instead.
  if(!anyFilterActive && filtered.length>MAX_UNFILTERED_TRACKS){
    $('#content').innerHTML=`<div class="empty">${filtered.length} tracks in total -- please choose an Album Artist/Artist/Album on the left, or search above, to show the album list.</div>`;
    $('#count').textContent=`${filtered.length} tracks (unfiltered)`;
    state.currentPlaylist=[];
    return;
  }

  const groups={};
  filtered.forEach(t=>{const key=t.album||'Unknown Album';(groups[key]??=[]).push(t)});
  Object.values(groups).forEach(list=>list.sort((a,b)=>(parseInt(a.track_number)||0)-(parseInt(b.track_number)||0)||a.title.localeCompare(b.title)));

  const orderedEntries=Object.entries(groups).sort(([a],[b])=>a.localeCompare(b));
  state.currentPlaylist=orderedEntries.flatMap(([,ts])=>ts); // used for next/previous track

  const html=orderedEntries.map(([album,ts])=>`
    <div class="album" data-album="${esc(album)}">
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
    </div>`).join('');

  $('#content').innerHTML=html||'<div class="empty">No entries. Did you load the library and check your filters?</div>';
  $('#count').textContent=`${Object.keys(groups).length} albums · ${filtered.length} tracks`;
  document.querySelectorAll('[data-item]').forEach(e=>{
    e.ondblclick=()=>playItem(filtered.find(x=>x.id===e.dataset.item));
    e.oncontextmenu=ev=>{
      ev.preventDefault(); ev.stopPropagation();
      const t=filtered.find(x=>x.id===e.dataset.item);
      if(t) showMetadata(`Track: ${t.title}`,formatTrackMeta(t));
    };
  });
  document.querySelectorAll('.album').forEach(e=>{
    e.oncontextmenu=ev=>{
      ev.preventDefault();
      const ts=groups[e.dataset.album];
      if(ts) showMetadata(`Album: ${e.dataset.album}`,formatAlbumMeta(e.dataset.album,ts));
    };
  });
}

async function playItem(t){
  if(!$('#renderer').value||!t?.resources?.[0]) return notify('Select an output device above before playing a track.');
  try{
    if(isLocal()){
      const audio=$('#localAudio');
      audio.src=t.resources[0].uri;
      await audio.play();
    }else{
      await api('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:$('#renderer').value,action:'set_uri',uri:t.resources[0].uri,metadata:t.metadata})});
    }
    state.nowPlayingId=t.id;
    $('#playing').textContent=t.title;
    $('#playingSub').textContent=`${t.artist} · ${t.album}`;
    $('#npTitle').textContent=t.title;
    $('#npArtist').textContent=t.artist;
    $('#npCover').style.backgroundImage=t.album_art?`url('${t.album_art}')`:'';
    $('#status').textContent='Now playing';
    renderAlbums(); // update the play icon on the now-playing track
  }catch(e){log(e.message)}
}

function playNextInPlaylist(){
  const idx=state.currentPlaylist.findIndex(t=>t.id===state.nowPlayingId);
  if(idx<0||idx+1>=state.currentPlaylist.length) return;
  playItem(state.currentPlaylist[idx+1]);
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
async function refreshVolume(){
  if(!$('#renderer').value) return;
  if(isLocal()){
    const audio=$('#localAudio');
    $('#volume').max=100;
    $('#volume').value=Math.round((audio.volume||1)*100);
    $('#volumeLabel').textContent=`${$('#volume').value}%`;
    return;
  }
  try{
    const v=await api(`/api/devices/${$('#renderer').value}/volume`);
    $('#volume').max=v.max; $('#volume').value=v.raw;
    $('#volumeLabel').textContent = v.db!=null ? `${v.db>0?'+':''}${v.db.toFixed(1)} dB` : `${v.percent}%`;
  }catch(e){/* volume info is optional, ignore */}
}
let volDebounce;
$('#volume').oninput=e=>{
  if(isLocal()){
    $('#localAudio').volume=Math.max(0,Math.min(100,+e.target.value))/100;
    $('#volumeLabel').textContent=`${e.target.value}%`;
    return;
  }
  clearTimeout(volDebounce);
  volDebounce=setTimeout(async()=>{
    if(!$('#renderer').value) return;
    try{
      await api('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:$('#renderer').value,action:'volume',value:+e.target.value})});
      refreshVolume();
    }catch(x){log(x.message)}
  },150);
};

// ---------- Elapsed-time display + auto-advance to the next track ----------
function fmtClock(sec){sec=Math.max(0,Math.round(sec||0));const m=Math.floor(sec/60),ss=sec%60;return `${m}:${String(ss).padStart(2,'0')}`}

// Local playback: the <audio> element already knows exactly when a track
// ends and exactly where it is -- no polling/heuristics needed.
const localAudioEl=$('#localAudio');
localAudioEl.addEventListener('timeupdate',()=>{
  if(!isLocal()) return;
  $('#elapsed').textContent = localAudioEl.duration ? `${fmtClock(localAudioEl.currentTime)} / ${fmtClock(localAudioEl.duration)}` : '';
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
