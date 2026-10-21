// Shared setup: state, the diagnostics log, the API helper and small helpers used by every other file.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

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
  catch(e){ if(e.name==='AbortError') throw e; throw Error('Lost connection to the Flou Player background service -- please restart Flou Player.') }
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
    t.quality=qualityClass(t);
  });
  return tracks;
}

// Audio quality of a track's first (= original) resource, for the quality filter:
//   'lossy'  MP3, AAC, Ogg/Opus, WMA ...      'cd'  lossless, up to 16 bit and 48 kHz
//   'hires'  lossless above 16 bit or 48 kHz  ''    can't tell (shown only under "All qualities")
const LOSSY_MIME=/^audio\/(mpeg|mp3|x-mp3|mpeg3|aac|x-aac|ogg|x-ogg|opus|vorbis|x-vorbis|x-ms-wma)\b/;
function qualityClass(t){
  const res=t.resources?.[0]; if(!res) return '';
  const mime=((res.protocol||'').split(':')[2]||'').trim().toLowerCase();
  const rate=parseInt(res.sample_rate)||0, bits=parseInt(res.bits_per_sample)||0;
  if(LOSSY_MIME.test(mime)) return 'lossy';
  if(/^audio\/(mp4|x-m4a|m4a)\b/.test(mime)&&!bits) return 'lossy';   // AAC; ALAC states its bit depth
  if(bits>16||rate>48000) return 'hires';
  if(bits||rate||/^audio\/(x-)?(flac|wav|wave|aiff|dsf|dff)/.test(mime)) return 'cd';
  return '';
}
// Does the track pass the quality dropdown? ('lossless' = cd + hires)
function qualityMatch(t){
  const f=$('#qualityFilter').value;
  return !f||(f==='lossless'?t.quality==='cd'||t.quality==='hires':t.quality===f);
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

// Albums are told apart by name AND album artist, so e.g. several
// "Greatest Hits" by different artists don't merge into one.
function albumKey(t){return (t.album||'Unknown Album')+'\u0001'+(t.album_artist||'')}

function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function cover(uri){return uri?`style="background-image:url('${esc(uri)}')"`:''}

// ---------- Interface zoom ----------
// The whole page can be scaled (Ctrl/⌘ + / - / 0, remembered), for screens where the desktop's own scaling
// doesn't reach the app window and everything looks tiny (for example HiDPI under GNOME).
// html{zoom} scales the layout; the CSS compensates viewport units with var(--z).
const ZOOM_STEPS=[0.75,0.9,1,1.1,1.25,1.5,1.75,2,2.5,3];
function loadZoom(){ try{ const z=parseFloat(localStorage.getItem('flou_zoom')); return ZOOM_STEPS.includes(z)?z:1 }catch(e){ return 1 } }
let uiZoom=1;
function setZoom(z,{save=true,toast=false}={}){
  uiZoom=z;
  document.documentElement.style.setProperty('--z',z);
  document.documentElement.style.zoom=z===1?'':z;
  if(save) try{ localStorage.setItem('flou_zoom',z) }catch(e){}
  if(toast) showToast(`Zoom ${Math.round(z*100)}%`);
}
function stepZoom(dir){   // dir: +1 / -1; 0 resets
  const i=ZOOM_STEPS.indexOf(uiZoom);
  setZoom(dir===0?1:ZOOM_STEPS[Math.max(0,Math.min(ZOOM_STEPS.length-1,i+dir))],{toast:true});
}
setZoom(loadZoom(),{save:false});
