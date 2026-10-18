const $=s=>document.querySelector(s);
const state={devices:[],tracks:[],filters:{album_artist:'',artist:'',album:'',year:''},nowPlayingId:null,currentPlaylist:[]};
const FACET_ORDER=['album_artist','artist','album','year'];
// The album list is rendered in chunks as you scroll, so even the whole
// unfiltered library can be shown without making the window sluggish.
const ALBUM_CHUNK=40;
const LOCAL_RENDERER_ID='__local__';

// ---------- Diagnostics log ----------
// Keeps the last LOG_MAX entries (timestamp, level, text) instead of only
// the latest message; the Diagnostics dialog shows them, can copy a
// complete report, and a badge counts errors that arrived unseen.
const LOG_MAX=300;
const logEntries=[]; let logUnseenErrors=0;
function log(x,level='info'){
  const msg=typeof x==='string'?x:JSON.stringify(x,null,2);
  logEntries.push({t:new Date(),level,msg});
  if(logEntries.length>LOG_MAX) logEntries.shift();
  if(level==='error' && $('#diagModal').classList.contains('hidden')) logUnseenErrors++;
  drawDiagBadge(); if(!$('#diagModal').classList.contains('hidden')) drawDiag();
}
const logErr=x=>log(x,'error');
const hhmmss=d=>d.toTimeString().slice(0,8);
function drawDiagBadge(){
  const b=$('#diagBadge'); if(!b) return;
  b.textContent=logUnseenErrors; b.classList.toggle('hidden',!logUnseenErrors);
}
function drawDiag(){
  const errOnly=$('#diagErrOnly').checked;
  const rows=logEntries.filter(e=>!errOnly||e.level==='error');
  $('#diagList').innerHTML=rows.length
    ? rows.map(e=>`<li class="${e.level}"><time>${hhmmss(e.t)}</time><span class="lv">${e.level}</span><span class="msg">${esc(e.msg)}</span></li>`).join('')
    : '<li class="empty">Nothing logged yet.</li>';
  const l=$('#diagList'); l.scrollTop=l.scrollHeight;
}
$('#diagBtn').onclick=()=>{ logUnseenErrors=0; drawDiagBadge(); $('#diagModal').classList.remove('hidden'); drawDiag() };
$('#diagClose').onclick=()=>$('#diagModal').classList.add('hidden');
$('#diagModal').addEventListener('click',e=>{ if(e.target===$('#diagModal')) $('#diagModal').classList.add('hidden') });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') $('#diagModal').classList.add('hidden') });
$('#diagClear').onclick=()=>{ logEntries.length=0; logUnseenErrors=0; drawDiagBadge(); drawDiag() };
$('#diagErrOnly').onchange=drawDiag;
async function copyText(text){
  try{ await navigator.clipboard.writeText(text); return true }catch(e){}
  const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.select();
  let ok=false; try{ ok=document.execCommand('copy') }catch(e){}
  ta.remove(); return ok;
}
async function buildReport(){
  const lines=[];
  try{
    const a=await api('/api/app/about');
    lines.push(`Flou Player ${a.version} (build ${a.build}${a.source?.describe?', '+a.source.describe:''})`,`Python ${a.python} on ${a.platform}`,
      'Dependencies: '+Object.entries(a.dependencies).map(([k,v])=>`${k} ${v}`).join(', '));
  }catch(e){ lines.push('(about info unavailable: '+e.message+')') }
  const d=dev();
  if(d && !isLocal()){
    try{
      const x=await api(`/api/devices/${encodeURIComponent(d)}/services`);
      lines.push('',`Output device: ${x.name} (${x.model||'?'})`);
      const fw=await firmwareLine(d); if(fw) lines.push(fw);
      (x.peers||[]).forEach(p=>lines.push(`  ${p.name} @ ${p.location}`,...p.service_types.map(t=>'    '+t)));
    }catch(e){ lines.push('(device info unavailable: '+e.message+')') }
  }
  lines.push('','Log:',...logEntries.map(e=>`${hhmmss(e.t)} ${e.level.toUpperCase()} ${e.msg}`));
  return lines.join('\n');
}
$('#diagCopy').onclick=async()=>{
  const ok=await copyText(await buildReport());
  showToast(ok?'Report copied to the clipboard':'Could not copy -- please select the log text manually');
};
$('#diagDevice').onclick=async()=>{
  const d=dev();
  if(!d||isLocal()) return log('Select an output device first.','warn');
  try{
    const x=await api(`/api/devices/${encodeURIComponent(d)}/services`);
    const fw=await firmwareLine(d);
    log(`Output device: ${x.name}\n`+(fw?fw+'\n':'')+(x.peers||[]).map(p=>`${p.name} @ ${p.location}\n`+p.service_types.map(t=>'  '+t).join('\n')).join('\n'));
  }catch(e){ logErr(e.message) }
};

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
    if(i===select.selectedIndex){ refresh(); return }   // already selected: just make sure the button shows it
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

// Guidance messages need to be impossible to miss -- the Diagnostics dialog
// is closed by default, so a plain log() alone can look like nothing
// happened at all. notify() logs AND shows a brief on-screen toast.
let toastTimer;
function showToast(msg){
  const el=$('#toast');
  el.textContent=msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.add('hidden'),Math.max(3200,msg.length*55));
}
function notify(msg){ log(msg,'warn'); showToast(msg); }

// Dims the transport controls and hints in the display when playback
// can't actually do anything yet (no output device chosen) -- so it's
// visible up front instead of only failing silently on double-click.
function updateReadyState(){
  const ready=!!$('#renderer').value;
  document.querySelectorAll('.transport button, .transport input[type=range]').forEach(el=>el.classList.toggle('disabled',!ready));
  if(!state.nowPlayingId) $('#playingSub').textContent = ready ? 'Local Music Control' : 'Select an output device to enable playback';
}

// Busy state for toolbar buttons: a spinner and new label, same width (no
// layout jump), no focus ring left behind; the button ignores clicks meanwhile.
function setBusy(btn,on,label){
  if(on){
    btn._label=btn.textContent; btn.style.minWidth=btn.offsetWidth+'px';
    btn.innerHTML=`<span class="spinner" aria-hidden="true"></span>${esc(label)}`;
    btn.classList.add('busy'); btn.setAttribute('aria-busy','true'); btn.blur();
  }else{
    btn.textContent=btn._label??btn.textContent; btn.style.minWidth='';
    btn.classList.remove('busy'); btn.removeAttribute('aria-busy');
  }
}
$('#discover').onclick=async()=>{
  const btn=$('#discover');
  if(btn.classList.contains('busy')) return;
  setBusy(btn,true,'Searching');
  try{
    log('Searching local network ...');
    const x=await api('/api/discover');
    state.devices=x.devices;
    populateServerSelect(x.devices.filter(d=>d.server));
    populateRendererSelect(x.devices.filter(d=>d.renderer));
    applySavedDevices();
    for(const k of ['server','renderer']){ const w=savedDev(k); if(w&&w!==LOCAL_RENDERER_ID&&$('#'+k).value!==w) log(`Remembered ${k} (${w}) was not found in this search`,'warn') }
    log(`Found ${x.devices.length} device(s): `+x.devices.map(d=>d.name+(d.server?' [server]':'')+(d.renderer?' [output]':'')).join(', '));
    updateReadyState();
  }catch(e){logErr(e.message)}
  finally{ setBusy(btn,false) }
};

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

// ---------- About ----------
$('#aboutBtn').onclick=async()=>{
  $('#aboutModal').classList.remove('hidden');
  try{
    const a=await api('/api/app/about');
    $('#aboutVersion').textContent=`Version ${a.version}`;
    const src=a.source||{};
    const rows=[['Build',a.build],...(src.describe?[['Source',[src.describe,src.date].filter(Boolean).join(' · ')]]:[]),['License',a.license],['Python',a.python],['System',a.platform],...Object.entries(a.dependencies).map(([k,v])=>[k,v])];
    $('#aboutTable').innerHTML=rows.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
    $('#aboutRepo').textContent=a.repo; $('#aboutRepo').href=a.repo;
    $('#aboutChangelog').href=a.changelog;
  }catch(e){ $('#aboutVersion').textContent=e.message }
};
$('#aboutClose').onclick=()=>$('#aboutModal').classList.add('hidden');
$('#aboutModal').addEventListener('click',e=>{ if(e.target===$('#aboutModal')) $('#aboutModal').classList.add('hidden') });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') $('#aboutModal').classList.add('hidden') });

// ---------- Cover size + full-size cover view ----------
function applyCoverSize(px){
  const c=$('#content');
  c.style.setProperty('--cover',px+'px');
  c.classList.toggle('bigcovers',px>=140);
}
(function(){
  let v=88; try{v=+localStorage.getItem('flou_cover_size')||88}catch(e){}
  $('#coverSize').value=v; applyCoverSize(v);
})();
$('#coverSize').oninput=e=>{
  const v=+e.target.value; applyCoverSize(v);
  try{localStorage.setItem('flou_cover_size',v)}catch(x){}
};
function openCover(el,caption){
  const m=/url\(["']?(.*?)["']?\)/.exec(el.style.backgroundImage||'');
  if(!m) return;
  const lb=$('#lightbox');
  lb.querySelector('img').src=m[1];
  lb.querySelector('span').textContent=caption||'';
  lb.classList.remove('hidden');
}
$('#lightbox').onclick=()=>$('#lightbox').classList.add('hidden');
document.addEventListener('keydown',e=>{ if(e.key==='Escape') $('#lightbox').classList.add('hidden') });
$('#content').addEventListener('click',e=>{
  const cv=e.target.closest('.cover'); if(!cv||cv.closest('.livecard')) return;
  const al=cv.closest('.album'); const ts=al&&state.view.groups[al.dataset.album];
  openCover(cv,ts?`${ts[0].album||'Unknown Album'} · ${ts[0].album_artist||''}`:'');
});
$('#npCover').onclick=()=>openCover($('#npCover'),`${$('#playing').textContent} · ${$('#playingSub').textContent}`);
// The cover thumbnail in the title display: hidden while there is no cover.
function setNowCover(uri){ const c=$('#npCover'); c.style.backgroundImage=uri?`url('${uri}')`:''; c.classList.toggle('hidden',!uri) }

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
    }catch(e){lastErr=e;logErr(`Local playback failed for ${resourceMime(res)||'?'} ${res.uri}: ${e.message}`)}
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
    setNowCover(t.album_art);
    markNowPlaying(prevId,t.id); // move the play icon to the now-playing track
  }catch(e){notify(e.message)}
}

// ---------- Jump to the now-playing track ----------
// Scrolls the album list to the current track (rendering further chunks
// if needed). If it's hidden by the current filters/search, switch the
// view to its album first -- like iTunes' "Go to Current Song".
async function jumpToNowPlaying(){
  const id=state.nowPlayingId;
  const seen=liveSeen.byId.get(id);   // live browsing: the track and the folder it was seen in
  const t=state.view.byId.get(id)||state.tracks.find(x=>x.id===id)||(isLive()&&seen?.t);
  if(!t) return notify('Nothing from the library is playing right now.');
  if(!state.view.byId.has(t.id)){
    if(isLive()){
      if(!seen) return notify('The playing track is not in the browsed folders.');
      $('#search').value=''; await liveOpen(seen.stack);   // go back to its folder first
    }else{
      $('#search').value='';
      state.filters={album_artist:t.album_artist||'',artist:t.album?'':(t.artist||''),album:t.album||'',year:''};
      render();
      document.querySelectorAll('.facets li.active').forEach(li=>li.scrollIntoView({block:'nearest'}));
    }
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
  if(!isLocal() && queue.supported && queue.active){ // the device's own queue is the active source
    try{await queueApi({action}); pollQueue(true)}catch(x){notify(x.message)}
    return;
  }
  if(!deviceOwnsPlayback()){
    if(action==='next') return playNextInPlaylist();
    if(action==='previous') return playPreviousInPlaylist();
  }

  if(isLocal()){
    const audio=$('#localAudio');
    if(action==='play') audio.play().catch(e=>logErr(e.message));
    else if(action==='pause') audio.pause();
    else if(action==='stop'){audio.pause();audio.currentTime=0}
    return;
  }
  if(action==='stop') userInitiatedStop=true;
  try{await api('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:$('#renderer').value,action})})}
  catch(e){logErr(e.message)}
});

// ---------- Volume: finer control, with dB readout where available ----------
// For local playback there's no dB service -- just a plain 0-100 gain on
// the <audio> element.
$('#renderer').addEventListener('change',()=>{
  if(!isLocal()) $('#localAudio').pause(); // don't keep playing locally in the background once switched away
  refreshVolume();
  refreshDeviceExtras();
  updateReadyState();
});
let volDragging=false;   // user is holding the slider: don't overwrite it from device readbacks
let volCur=null;         // value last sent to the device (what the device is at / heading to)
let volTarget=null;      // where the slider wants the device to go
let volTimer=null;
const VOL_STEP_MAX=2;    // max device steps per tick, so clicks/fast drags ramp instead of jumping
const VOL_TICK_MS=80;
let volInfo=null;        // {unity, dbPerStep} of the OpenHome device, for a live dB label while dragging
const volDb=raw=>volInfo?(raw-volInfo.unity)*volInfo.dbPerStep:null;
const fmtDb=db=>`${db>0?'+':''}${db.toFixed(1)} dB`;
const volLabel=(v)=>v.db!=null ? `${v.db>0?'+':''}${v.db.toFixed(1)} dB` : `${v.percent}%`;
async function refreshVolume(){
  if(!$('#renderer').value) return;
  if(isLocal()){
    const audio=$('#localAudio');
    $('#volume').max=100;
    $('#volume').value=Math.round(audio.volume*100);
    $('#volumeLabel').textContent=`${$('#volume').value}%`;
    drawMute(null);
    return;
  }
  try{
    const v=await api(`/api/devices/${$('#renderer').value}/volume`);
    $('#volume').max=v.max;
    volCur=v.raw;
    volInfo=v.db!=null?{unity:v.unity,dbPerStep:v.db_per_step}:null;
    if(!volDragging && volTimer===null){ $('#volume').value=v.raw; }
    $('#volumeLabel').textContent=volLabel(v);
    drawMute(v.muted);
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
    }catch(x){logErr(x.message); volTimer=null; volTarget=null; return}
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
  const db=volDb(+e.target.value);
  if(db!==null) $('#volumeLabel').textContent=fmtDb(db);
  setVolumeTarget(+e.target.value);
};
// Keep the slider in sync with changes made elsewhere (remote, Linn app).
setInterval(()=>{ if(!isLocal() && !volDragging && volTimer===null) refreshVolume() },4000);
// Mouse wheel: one step at a time (shift = 5), instead of the browser default.
$('#volume').addEventListener('wheel',e=>{
  e.preventDefault();
  const el=e.currentTarget, dir=e.deltaY<0?1:-1, step=e.shiftKey?5:1;
  el.value=Math.max(+el.min,Math.min(+el.max,+el.value+dir*step));
  el.dispatchEvent(new Event('input'));
},{passive:false});

// ---------- Position display: elapsed / remaining + seek bar ----------
// Whatever the source (local <audio>, UPnP renderer poll, device queue),
// it calls setProgress(seconds, duration, playing). Between polls the
// position is extrapolated so the bar moves smoothly.
const prog={base:0,at:0,dur:0,playing:false,seeking:false,seekable:false};
function setProgress(sec,dur,playing=true,seekable=true){
  Object.assign(prog,{base:sec||0,at:performance.now(),dur:dur||0,playing,seekable});
  drawProgress();
}
const PROG_MAX_EXTRAPOLATE_S=6;   // longest the clock runs on its own between readings
function curPos(){
  const age=Math.min((performance.now()-prog.at)/1000,PROG_MAX_EXTRAPOLATE_S);
  const p=prog.base+(prog.playing?age:0);
  return prog.dur?Math.min(p,prog.dur):p;
}
function drawProgress(){
  const seek=$('#seek');
  const pos=prog.seeking?+seek.value/1000*prog.dur:curPos();
  $('#elapsedL').textContent=prog.dur||pos?fmtClock(pos):'';
  $('#elapsedR').textContent=prog.dur?'-'+fmtClock(prog.dur-pos):'';
  seek.disabled=!(prog.dur&&prog.seekable);
  if(!prog.seeking) seek.value=prog.dur?Math.round(pos/prog.dur*1000):0;
  // Fill follows the handle; the time grid ticks every minute (5 / 10 min for long tracks).
  seek.style.setProperty('--pct',(+seek.value/10)+'%');
  if(prog.dur!==seek._gridDur){
    seek._gridDur=prog.dur;
    const step=prog.dur>3600?600:prog.dur>1200?300:60;
    seek.style.setProperty('--tick',prog.dur?(step/prog.dur*100)+'%':'100%');
  }
}
function clearProgress(){ setProgress(0,0,false,false) }
setInterval(()=>{ if(prog.playing&&!prog.seeking) drawProgress() },250);
$('#seek').addEventListener('pointerdown',()=>{prog.seeking=true});
$('#seek').addEventListener('input',drawProgress);
$('#seek').addEventListener('change',async e=>{
  const sec=Math.round(+e.target.value/1000*prog.dur);
  prog.seeking=false;
  try{
    if(isLocal()) $('#localAudio').currentTime=sec;
    else if(queue.supported&&queue.active) await queueApi({action:'seek_time',seconds:sec});
    else await api('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:dev(),action:'seek',value:sec})});
    setProgress(sec,prog.dur,prog.playing,true);
  }catch(x){notify(x.message); prog.seeking=false}
});
window.addEventListener('pointerup',()=>{ if(prog.seeking&&$('#seek').disabled) prog.seeking=false });

// ---------- Device queue (OpenHome Playlist) ----------
const queue={supported:false,active:false,token:null,entries:[],currentId:0,state:'',repeat:false,shuffle:false};
const dev=()=>$('#renderer').value;
async function queueApi(body){
  return api(`/api/devices/${dev()}/queue`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}
const queueItem=t=>({uri:t.resources[0].uri,metadata:t.metadata});
function tracksOfAlbum(key){return (state.view.groups[key]||[]).filter(t=>t.resources?.[0])}
async function queueAdd(tracks,play=false,replace=false){
  if(!dev()||isLocal()) return notify('The queue needs a Linn/OpenHome output device.');
  if(!tracks.length) return;
  try{
    await queueApi({action:replace?'replace':'insert',items:tracks.map(queueItem),play});
    notify(replace?`Playing ${tracks.length} track${tracks.length>1?'s':''}`:`Added ${tracks.length} track${tracks.length>1?'s':''} to the queue`);
    pollQueue(true);
  }catch(e){notify(e.message)}
}
$('#content').addEventListener('click',e=>{
  const add=e.target.closest('[data-qadd]'), addA=e.target.closest('[data-qadd-album]'), playA=e.target.closest('[data-qplay-album]');
  if(add){ e.stopPropagation(); const t=state.view.byId.get(add.dataset.qadd); if(t) queueAdd([t],!queue.entries.length||!queue.active); }
  else if(addA){ queueAdd(tracksOfAlbum(addA.dataset.qaddAlbum),!queue.entries.length||!queue.active); }
  else if(playA){ queueAdd(tracksOfAlbum(playA.dataset.qplayAlbum),true,true); }
});
// Everything currently listed (respects the column selection and search),
// in the order shown: album by album, tracks in album order.
const shownTracks=()=>state.currentPlaylist.filter(t=>t.resources?.[0]);
$('#qAddAll').onclick=()=>queueAdd(shownTracks(),!queue.entries.length||!queue.active);
$('#qPlayAll').onclick=()=>queueAdd(shownTracks(),true,true);
const fmtDurClock=d=>{const n=parseClock(d||''); return n?fmtClock(n):''};
function renderQueue(){
  const usable=queue.supported&&!isLocal();
  $('#tabQueue').disabled=!usable;
  $('#tabQueue').title=usable?'':'Select a Linn/OpenHome output device to use the queue';
  if(!usable && currentTab()==='queue') showTab('library');
  const n=queue.entries.length;
  $('#queueCount').textContent=n; $('#queueCount').classList.toggle('hidden',!n);
  $('#queueEmpty').classList.toggle('hidden',n>0);
  $('#qShuffle').classList.toggle('on',queue.shuffle);
  $('#qRepeat').classList.toggle('on',queue.repeat);
  const total=queue.entries.reduce((a,en)=>a+parseClock(en.duration||''),0);
  $('#queueInfo').textContent=n?`${n} track${n>1?'s':''}${total?' · '+fmtLong(total):''}`:'';
  if(currentTab()!=='queue') return;
  $('#queueList').innerHTML=queue.entries.map((en,i)=>{
    const cur=queue.active&&en.id===queue.currentId;
    return `<tr class="clickable${cur?' playing':''}" data-id="${en.id}"><td class="n">${cur?'▶':i+1}</td><td class="qcover"><div ${cover(en.album_art)}></div></td><td class="title">${esc(en.title)}</td><td class="artist sub">${esc(en.artist)}</td><td class="sub">${esc(en.album)}</td><td class="time">${esc(fmtDurClock(en.duration))}</td><td class="qx"><button type="button" data-qdel="${en.id}" title="Remove from queue" aria-label="Remove">×</button></td></tr>`;
  }).join('');
}
const fmtLong=sec=>{const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60);return h?`${h} h ${m} min`:`${m} min`};
// ---- Tabs: Library <-> Queue
const currentTab=()=>document.querySelector('main').dataset.tab;
function showTab(name){
  if(name==='queue' && $('#tabQueue').disabled) return;
  document.querySelector('main').dataset.tab=name;
  for(const t of ['Library','Queue']){
    const on=t.toLowerCase()===name;
    $('#tab'+t).classList.toggle('active',on); $('#tab'+t).setAttribute('aria-selected',String(on));
  }
  if(name==='queue'){ renderQueue(); pollQueue(true); scrollToCurrentQueue(false) }
}
function scrollToCurrentQueue(smooth=true){
  const row=document.querySelector('#queueList tr.playing');
  if(row) row.scrollIntoView({block:'center',behavior:smooth?'smooth':'auto'});
}
$('#tabLibrary').onclick=()=>showTab('library');
$('#tabQueue').onclick=()=>showTab('queue');
$('#qCurrent').onclick=()=>scrollToCurrentQueue();
document.addEventListener('keydown',e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='q'){ e.preventDefault(); showTab(currentTab()==='queue'?'library':'queue') } });
$('#queueList').addEventListener('click',async e=>{
  const del=e.target.closest('[data-qdel]');
  if(!del) return;
  try{ await queueApi({action:'delete',id:+del.dataset.qdel}); pollQueue(true) }catch(x){notify(x.message)}
});
$('#queueList').addEventListener('dblclick',async e=>{
  if(e.target.closest('button')) return;
  const tr=e.target.closest('tr[data-id]');
  if(!tr) return;
  try{ await queueApi({action:'seek',id:+tr.dataset.id}); pollQueue(true) }catch(x){notify(x.message)}
});
$('#qClear').onclick=async()=>{try{await queueApi({action:'clear'});pollQueue(true)}catch(x){notify(x.message)}};
$('#qShuffle').onclick=async()=>{try{await queueApi({action:'shuffle',value:!queue.shuffle});pollQueue(true)}catch(x){notify(x.message)}};
$('#qRepeat').onclick=async()=>{try{await queueApi({action:'repeat',value:!queue.repeat});pollQueue(true)}catch(x){notify(x.message)}};
let queueBusy=false;
// Playback started from the device queue (▶ Play all, + Queue ...) never goes through playItem:
// find the library track by its URI so the ▶ marker and the Now Playing button work too.
function syncNowPlayingFromQueue(cur){
  if(!cur.uri) return;
  const hit=t=>t.resources?.some(r=>r.uri===cur.uri);
  const t=[...state.view.byId.values()].find(hit)||state.tracks.find(hit)||liveSeen.byUri.get(cur.uri)?.t;
  if(!t||t.id===state.nowPlayingId) return;
  const prev=state.nowPlayingId; state.nowPlayingId=t.id;
  $('#jumpNowPlaying').disabled=false;
  markNowPlaying(prev,t.id);
}
async function pollQueue(force=false){
  if(!dev()||isLocal()){ queue.supported=false; queue.active=false; renderQueue(); return; }
  if(queueBusy) return; queueBusy=true;
  try{
    const r=await api(`/api/devices/${dev()}/queue`+(!force&&queue.token!=null?`?token=${encodeURIComponent(queue.token)}`:''));
    queue.supported=true; queue.active=r.active; queue.token=r.token;
    queue.currentId=r.current_id; queue.state=r.state||''; queue.repeat=!!r.repeat; queue.shuffle=!!r.shuffle;
    if(r.entries) queue.entries=r.entries;
    renderQueue();
    const cur=queue.entries.find(en=>en.id===queue.currentId);
    if(queue.active && cur){
      $('#playing').textContent=cur.title; $('#playingSub').textContent=[cur.artist,cur.album].filter(Boolean).join(' · ');
      setNowCover(cur.album_art);
      syncNowPlayingFromQueue(cur);
      if(r.duration) setProgress(r.seconds,r.duration,queue.state==='Playing');
      else clearProgress();
    }else if(queue.active){
      // Empty queue (or no current track): nothing is playing, so stop the clock.
      clearProgress();
    }
  }catch(e){ queue.supported=false; queue.active=false; queue.entries=[]; queue.token=null; renderQueue(); if(!isLocal()) prog.playing=false; }
  finally{ queueBusy=false }
}
$('#renderer').addEventListener('change',()=>{queue.token=null;queue.entries=[];pollQueue(true)});
setInterval(()=>pollQueue(),2000);

// ---------- Elapsed-time display + auto-advance to the next track ----------
function fmtClock(sec){sec=Math.max(0,Math.round(sec||0));const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),ss=sec%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`:`${m}:${String(ss).padStart(2,'0')}`}

// Local playback: the <audio> element already knows exactly when a track
// ends and exactly where it is -- no polling/heuristics needed.
const localAudioEl=$('#localAudio');
localAudioEl.addEventListener('timeupdate',()=>{
  if(!isLocal()) return;
  const d=localAudioEl.duration, dur=Number.isFinite(d)&&d>0?d:state.localDurationHint;
  // Transcoded streams (no known length / not seekable) just show the clock.
  setProgress(localAudioEl.currentTime,dur,!localAudioEl.paused,Number.isFinite(d)&&d>0&&localAudioEl.seekable.length>0);
});
localAudioEl.addEventListener('ended',()=>{ if(isLocal()) playNextInPlaylist() });
for(const ev of ['pause','ended','emptied']) localAudioEl.addEventListener(ev,()=>{
  if(!isLocal()) return;
  const d=localAudioEl.duration;
  const known=Number.isFinite(d)&&d>0;
  setProgress(ev==='emptied'?0:localAudioEl.currentTime,known?d:state.localDurationHint,false,known&&localAudioEl.seekable.length>0);
});

// UPnP renderers: no direct access to their playback clock, so poll it.
function parseClock(s){
  if(!s) return 0;
  return s.split(':').map(Number).reduce((acc,v)=>acc*60+v,0);
}
let lastPoll={state:null,relSec:0,durSec:0};
async function pollTransport(){
  if(!$('#renderer').value||isLocal()||(queue.supported&&queue.active)) return; // an active device queue advances and reports by itself
  try{
    const t=await api(`/api/devices/${$('#renderer').value}/transport`);
    const relSec=parseClock(t.rel_time), durSec=parseClock(t.duration);
    if(durSec) setProgress(relSec,durSec,t.state==='PLAYING'); else clearProgress();
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
  const tracks=live.tracks.filter(t=>!q||SEARCH_FIELDS.some(k=>(t[k]||'').toLowerCase().includes(q)));
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
  const empty=(!conts.length&&!tracks.length)?`<div class="empty">${q?'Nothing matches the search.':'This folder is empty.'}</div>`:'';
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
  document.querySelectorAll('#libMode button').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
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
document.querySelectorAll('#libMode button').forEach(b=>b.onclick=()=>{ if(b.dataset.mode!==libMode()||document.documentElement.dataset.libmode!==b.dataset.mode) setLibMode(b.dataset.mode) });
setLibMode(libMode(),false);

// ---------- Device extras (OpenHome): mute, source, pins, stream quality ----------
// All of these only exist on Linn/OpenHome devices; each part hides itself
// where the device doesn't offer it. Not verified against real hardware.
let muted=false;
function drawMute(m){
  const b=$('#muteBtn');
  b.classList.toggle('hidden',m==null);   // null: no mute available (local speakers, plain UPnP)
  muted=!!m;
  b.setAttribute('aria-pressed',String(muted));
  b.title=muted?'Unmute':'Mute';
}
$('#muteBtn').onclick=async()=>{
  if(!$('#renderer').value||isLocal()) return;
  try{
    await api('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:$('#renderer').value,action:'mute',value:muted?0:1})});
    drawMute(!muted);
  }catch(e){logErr(e.message)}
};

const dev2=()=>(!$('#renderer').value||isLocal())?null:$('#renderer').value;
let sourceCount=0, sourceTypes={}, sourceNow=null;
// The device's active source is something other than its Playlist (Radio, AirPlay, an input ...):
// then the transport buttons control the device itself, not our track list.
const deviceOwnsPlayback=()=>!isLocal()&&sourceNow!=null&&(sourceTypes[sourceNow]||'Playlist')!=='Playlist';
async function loadSources(){
  const d=dev2(); const box=$('#sourceSel');
  if(!d){ box.classList.add('hidden'); updateDevTools(); return }
  try{
    const r=await api(`/api/devices/${encodeURIComponent(d)}/sources`);
    $('#sourceSel').innerHTML=r.sources.map(s=>`<option value="${s.index}">${esc(s.name)}${s.type&&s.type!==s.name?' ('+esc(s.type)+')':''}</option>`).join('');
    $('#sourceSel').value=String(r.current);
    sourceCount=r.sources.length; sourceTypes=Object.fromEntries(r.sources.map(s=>[s.index,s.type])); sourceNow=r.current;
    box.classList.toggle('hidden',!sourceCount);
  }catch(e){ box.classList.add('hidden') }  // no Product service: no source switching
  updateDevTools();
}
let sourceChangedAt=0;   // the device takes a moment to switch; don't let the poll snap the dropdown back meanwhile
$('#sourceSel').onchange=async e=>{
  const d=dev2(); if(!d) return;
  sourceChangedAt=Date.now(); sourceNow=+e.target.value;
  try{
    await api('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:d,action:'set_source',value:+e.target.value})});
    showToast(`Source: ${e.target.selectedOptions[0].textContent}`); log(`Source: ${e.target.selectedOptions[0].textContent}`);
    setTimeout(pollSource,3000);
    if(typeof pollQueue==='function') pollQueue(true);
  }catch(x){ notify(x.message); loadSources() }
};
async function pollSource(){   // follow changes made from other controllers
  const d=dev2(); if(!d||!sourceCount||document.activeElement===$('#sourceSel')||Date.now()-sourceChangedAt<2500) return;
  try{ const r=await api(`/api/devices/${encodeURIComponent(d)}/sources?light=true`); $('#sourceSel').value=String(r.current); sourceNow=r.current }catch(e){}
}

async function loadPins(){
  const d=dev2(); const box=$('#pinsBox');
  if(!d){ box.classList.add('hidden'); updateDevTools(); return }
  try{
    const r=await api(`/api/devices/${encodeURIComponent(d)}/pins`);
    const art=u=>/^https?:/i.test(u||'')?` style="background-image:url('${esc(u)}')"`:'';
    $('#pinList').innerHTML=r.pins.map(p=>`<button type="button" class="pin" data-slot="${p.slot}" title="${esc(p.title)}"><span class="pinart"${art(p.artwork)}></span><span class="pintitle">${esc(p.title)}</span></button>`).join('');
    box.classList.toggle('hidden',!(r.supported&&r.pins.length));
  }catch(e){ box.classList.add('hidden') }
  updateDevTools();
}
// The toolbar group next to the output device (standby, source dropdown, pins button) shows only when one of them has something to offer.
function updateDevTools(){ $('#devTools').classList.toggle('hidden',['#powerBtn','#sourceSel','#pinsBox'].every(s=>$(s).classList.contains('hidden'))) }
function setPinMenu(open){ $('#pinList').classList.toggle('hidden',!open); $('#pinsBtn').setAttribute('aria-expanded',String(open)) }
$('#pinsBtn').onclick=e=>{ e.stopPropagation(); setPinMenu($('#pinList').classList.contains('hidden')) };
document.addEventListener('click',e=>{ if(!e.target.closest('.pinpicker')) setPinMenu(false) });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') setPinMenu(false) });
$('#pinList').addEventListener('click',async e=>{
  const b=e.target.closest('.pin'); const d=dev2(); if(!b||!d) return;
  setPinMenu(false);
  try{
    await api('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:d,action:'invoke_pin',value:+b.dataset.slot})});
    showToast(`Playing pin: ${b.title}`); log(`Pin: ${b.title}`);
    setTimeout(()=>{pollSource(); if(typeof pollQueue==='function') pollQueue(true)},1500);
  }catch(x){ notify(x.message) }
});

// What the device really plays: codec / sample rate / bit depth / bit rate.
const fmtKhz=hz=>`${+(hz/1000).toFixed(1)} kHz`;
async function pollStream(){
  const d=dev2(), el=$('#npQuality');
  if(!d){ el.classList.add('hidden'); return }
  try{
    const r=await api(`/api/devices/${encodeURIComponent(d)}/stream`);
    const parts=r.supported?[r.codec,r.sample_rate&&fmtKhz(r.sample_rate),r.bit_depth&&`${r.bit_depth} bit`,r.bit_rate&&`${Math.round(r.bit_rate/1000)} kbps`].filter(Boolean):[];
    el.textContent=parts.join(' · '); el.classList.toggle('hidden',!parts.length);
  }catch(e){ el.classList.add('hidden') }
}

// Standby / wake (OpenHome Product service).
let standby=false;
function drawPower(s){
  const b=$('#powerBtn');
  b.classList.toggle('hidden',s==null);
  if(s!=null){ standby=s; b.classList.toggle('standby',s); b.setAttribute('aria-pressed',String(!s)); b.title=s?'In standby -- click to wake up':'On -- click for standby' }
  updateDevTools();
}
async function pollStandby(){
  const d=dev2(); if(!d){ drawPower(null); return }
  try{ const r=await api(`/api/devices/${encodeURIComponent(d)}/standby`); drawPower(r.supported?r.standby:null) }catch(e){ drawPower(null) }
}
$('#powerBtn').onclick=async()=>{
  const d=dev2(); if(!d) return;
  const want=!standby;
  try{
    await api('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:d,action:'standby',value:want?1:0})});
    drawPower(want); showToast(want?'Standby':'Waking up');
    setTimeout(pollStandby,2500);
  }catch(e){ notify(e.message) }
};

// Grey out what the active source can't do (e.g. pause / skip on live radio). Unknown stays enabled.
// Next/previous only count when the device does the skipping, not our own track list.
async function pollCaps(){
  const d=dev2(); const el=s=>document.querySelector(`.transport [data-action=${s}]`);
  const set=(s,off)=>el(s).classList.toggle('nocap',!!off);
  if(!d){ ['pause','next','previous'].forEach(s=>set(s,false)); return }
  try{
    const c=await api(`/api/devices/${encodeURIComponent(d)}/capabilities`);
    const device=deviceOwnsPlayback()||(queue.supported&&queue.active);
    set('pause',c.supported&&c.can_pause===false);
    set('next',c.supported&&device&&c.can_skip_next===false);
    set('previous',c.supported&&device&&c.can_skip_previous===false);
  }catch(e){ ['pause','next','previous'].forEach(s=>set(s,false)) }
}

// Firmware (Linn Update service), shown in the Device info log and the report.
async function firmwareLine(d){
  try{
    const f=await api(`/api/devices/${encodeURIComponent(d)}/firmware`);
    if(!f.supported) return '';
    return `Firmware: ${f.version||'?'}${f.channel?' ('+f.channel+')':''}`+(f.update?` -- update available: ${f.update.version}${f.update.date?' ('+f.update.date+')':''}`:(f.status==='update_available'?' -- update available':' -- up to date'));
  }catch(e){ return '' }
}

function refreshDeviceExtras(){ loadSources(); loadPins(); pollStream(); pollStandby(); pollCaps(); if(!dev2()) drawMute(null) }
setInterval(pollSource,5000);
setInterval(loadPins,60000);
setInterval(pollStream,4000);
setInterval(pollStandby,6000);
setInterval(pollCaps,3000);
refreshDeviceExtras();

// ---------- Remember the chosen media server and output device ----------
// The choice is saved when you pick; at startup the app reconnects to the devices it knew
// (backend: /api/devices/restore, no network search) and selects them again.
const savedDev=k=>{ try{ return localStorage.getItem('flou_'+k)||'' }catch(e){ return '' } };
const saveDev=(k,v)=>{ try{ localStorage.setItem('flou_'+k,v) }catch(e){} };
$('#server').addEventListener('change',()=>saveDev('server',$('#server').value));
$('#renderer').addEventListener('change',()=>saveDev('renderer',$('#renderer').value));
function applySavedDevices(){
  for(const [id,key] of [['#server','server'],['#renderer','renderer']]){
    const sel=$(id), want=savedDev(key);
    if(!want||sel.value===want||![...sel.options].some(o=>o.value===want)) continue;
    sel.value=want;
    (sel.id==='server'?serverPicker:rendererPicker).refresh();   // the picker shows the select's value only when told to
    sel.dispatchEvent(new Event('change'));   // loads what depends on it
  }
}
(async function restoreDevices(){
  try{
    const x=await api('/api/devices/restore',{method:'POST'});
    if(x.devices.length){
      state.devices=x.devices;
      populateServerSelect(x.devices.filter(d=>d.server));
      populateRendererSelect(x.devices.filter(d=>d.renderer));
      log(`Reconnected to ${x.devices.length} saved device(s)`);
    }
  }catch(e){/* nothing saved yet, or the backend can't restore -- use Search devices */}
  applySavedDevices();
  updateReadyState();
  // A remembered device didn't come back (e.g. you changed network, or it was slow): search once instead of waiting for a click.
  const missing=['server','renderer'].filter(k=>{ const want=savedDev(k); return want&&want!==LOCAL_RENDERER_ID&&$('#'+k).value!==want });
  if(missing.length){ log(`Remembered ${missing.join(' and ')} not reconnected -- searching the network`,'warn'); $('#discover').click() }
})();

// ---------- Keyboard control ----------
// Space play/pause, Shift+←/→ seek, Ctrl+←/→ previous/next, Ctrl+↑/↓ volume (Shift = bigger steps),
// Ctrl+M mute, Ctrl+. stop. Plain arrow keys stay free for scrolling the lists, and plain letters for
// the column type-ahead and the search field.
const btnFor=a=>document.querySelector(`.transport [data-action=${a}]`);
function isPlayingNow(){
  if(isLocal()) return !$('#localAudio').paused;
  if(queue.supported&&queue.active) return queue.state==='Playing';
  return lastPoll.state==='PLAYING'||prog.playing;
}
function togglePlayPause(){
  if(isPlayingNow()) (btnFor('pause').classList.contains('nocap')?btnFor('stop'):btnFor('pause')).click();   // live radio can't pause: stop instead
  else btnFor('play').click();
}
function seekBy(delta){
  if(!prog.dur||!prog.seekable) return;
  const sec=Math.max(0,Math.min(prog.dur-1,curPos()+delta));
  const seek=$('#seek'); seek.value=Math.round(sec/prog.dur*1000);
  seek.dispatchEvent(new Event('change'));
}
function volumeBy(steps){
  const v=$('#volume'); if(v.classList.contains('disabled')) return;
  v.value=Math.max(+v.min,Math.min(+v.max,+v.value+steps)); v.dispatchEvent(new Event('input'));
}
function toggleMute(){
  if(isLocal()){ const a=$('#localAudio'); a.muted=!a.muted; showToast(a.muted?'Muted':'Unmuted'); return }
  if(!$('#muteBtn').classList.contains('hidden')) $('#muteBtn').click();
}
document.addEventListener('keydown',e=>{
  if(e.defaultPrevented) return;
  const t=e.target;
  if(t&&(/^(input|textarea|select)$/i.test(t.tagName)||t.isContentEditable||t.closest?.('.picker'))) return;
  if(['diagModal','metaModal','aboutModal'].some(id=>!$('#'+id).classList.contains('hidden'))||!$('#lightbox').classList.contains('hidden')) return;
  const mod=e.ctrlKey||e.metaKey, k=e.key;
  let act=null;
  if(k===' '&&!mod&&!e.shiftKey&&!e.altKey){ if(t&&t.tagName==='BUTTON') return; act=togglePlayPause }   // Space on a focused button presses it
  else if(e.shiftKey&&!mod&&!e.altKey&&(k==='ArrowLeft'||k==='ArrowRight')) act=()=>seekBy(k==='ArrowRight'?10:-10);
  else if(mod&&!e.altKey&&(k==='ArrowLeft'||k==='ArrowRight')) act=()=>{ const b=btnFor(k==='ArrowRight'?'next':'previous'); if(!b.classList.contains('nocap')) b.click() };
  else if(mod&&!e.altKey&&(k==='ArrowUp'||k==='ArrowDown')) act=()=>volumeBy((k==='ArrowUp'?1:-1)*(e.shiftKey?5:1));
  else if(mod&&!e.altKey&&!e.shiftKey&&k.toLowerCase()==='m') act=toggleMute;
  else if(mod&&!e.altKey&&!e.shiftKey&&k==='.') act=()=>btnFor('stop').click();
  if(!act) return;
  e.preventDefault(); act();
});
