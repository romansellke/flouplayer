// Playback: local audio, play/jump to the playing track, transport buttons, volume, position bar, polling.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

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
      $('#search').value=''; $('#qualityFilter').value='';   // neither may hide the track
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
    try{await queueApi({action}); if(action==='pause') log('Pause sent to the device queue.'); pollQueue(true)}catch(x){notify(x.message)}
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
  try{ await api('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:$('#renderer').value,action})}); if(action==='pause') log('Pause sent to the device.') }
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
// The volume label: the step number as the Linn shows it (bold, larger), then the dB it works out to
// (from the device's own characteristics, smaller). Without dB values just the number / percentage.
function setVolumeLabel(step,db=null){
  $('#volumeLabel').innerHTML=`<b class="volstep">${esc(step)}</b>`+(db==null?'':`<span class="voldb">${esc(fmtDb(db))}</span>`);
}
async function refreshVolume(){
  if(!$('#renderer').value) return;
  if(isLocal()){
    const audio=$('#localAudio');
    $('#volume').max=100;
    $('#volume').value=Math.round(audio.volume*100);
    setVolumeLabel(`${$('#volume').value}%`);
    drawMute(null);
    return;
  }
  try{
    const v=await api(`/api/devices/${$('#renderer').value}/volume`);
    $('#volume').max=v.max;
    volCur=v.raw;
    volInfo=v.db!=null?{unity:v.unity,dbPerStep:v.db_per_step}:null;
    if(!volDragging && volTimer===null){ $('#volume').value=v.raw; }
    setVolumeLabel(v.db!=null?v.raw:`${v.percent}%`,v.db);
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
    setVolumeLabel(`${e.target.value}%`);
    return;
  }
  if(!$('#renderer').value) return;
  const db=volDb(+e.target.value);
  if(db!==null) setVolumeLabel(+e.target.value,db);
  setVolumeTarget(+e.target.value);
};
// Keep the slider in sync with changes made elsewhere (remote, Linn app).
poll(()=>{ if(!isLocal() && !volDragging && volTimer===null) return refreshVolume() },4000);
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
  scheduleProgress();
  pushMediaSoon();
}
const PROG_MAX_EXTRAPOLATE_S=6;   // longest the clock runs on its own between readings
function curPos(){
  const age=Math.min((performance.now()-prog.at)/1000,PROG_MAX_EXTRAPOLATE_S);
  const p=prog.base+(prog.playing?age:0);
  return prog.dur?Math.min(p,prog.dur):p;
}
// The times are drawn as a 5x7 dot matrix (LCD style): lit dots in the text colour, unlit ones faintly visible.
// The text stays in the element (screen readers, copy), the SVG is only the picture of it.
const PIX_GLYPHS={
  '0':['01110','10001','10011','10101','11001','10001','01110'],'1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],'3':['11110','00001','00001','01110','00001','00001','11110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],'5':['11111','10000','11110','00001','00001','10001','01110'],
  '6':['00110','01000','10000','11110','10001','10001','01110'],'7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],'9':['01110','10001','10001','01111','00001','00010','01100'],
  ':':['0','0','1','0','1','0','0'],'-':['000','000','000','111','000','000','000']};
function pixelSvg(text){
  let x=0, on='', off='';
  for(const ch of text){
    const g=PIX_GLYPHS[ch]; if(!g) continue;
    g[0].split('').forEach((_,c)=>g.forEach((row,r)=>{ const sq=`M${x+c} ${r}h.86v.86h-.86z`; if(row[c]==='1') on+=sq; else off+=sq }));
    x+=g[0].length+1;
  }
  const w=Math.max(x-1,1);
  return `<svg class="pix" viewBox="0 0 ${w} 7" width="${w*PIX}" height="${7*PIX}" aria-hidden="true"><path class="off" d="${off}"/><path d="${on}"/></svg>`;
}
const PIX=3;   // screen pixels per dot
function setPixelText(el,text){
  if(el._pix===text) return; el._pix=text;
  el.innerHTML=`<span class="sr">${esc(text)}</span>`+(text?pixelSvg(text):'');
}
function drawProgress(){
  const seek=$('#seek');
  const pos=prog.seeking?+seek.value/1000*prog.dur:curPos();
  setPixelText($('#elapsedL'),prog.dur||pos?fmtClock(pos):'');
  setPixelText($('#elapsedR'),prog.dur?'-'+fmtClock(prog.dur-pos):'');
  seek.disabled=!(prog.dur&&prog.seekable);
  if(!prog.seeking) seek.value=prog.dur?Math.round(pos/prog.dur*1000):0;
  const pct=(+seek.value/10)+'%';
  if(seek._pct!==pct){ seek._pct=pct; seek.style.setProperty('--pct',pct) }   // the fill follows the handle
}
function clearProgress(){ setProgress(0,0,false,false) }
// The clock shows whole seconds, so wake up once per second, just after the display would change (fmtClock rounds),
// and not at all while nothing runs (the position stops extrapolating after PROG_MAX_EXTRAPOLATE_S anyway).
let progTimer=null;
function scheduleProgress(){
  clearTimeout(progTimer); progTimer=null;
  if(!prog.playing||document.hidden) return;
  const age=(performance.now()-prog.at)/1000;
  if(age>PROG_MAX_EXTRAPOLATE_S) return;
  const pos=prog.base+age;
  progTimer=setTimeout(()=>{ progTimer=null; if(!prog.seeking) drawProgress(); scheduleProgress() },(1-(pos+.5)%1)*1000+20);
}
document.addEventListener('visibilitychange',()=>{ if(!document.hidden){ drawProgress(); scheduleProgress() } });
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

// ---------- Elapsed-time display + auto-advance to the next track ----------
function fmtClock(sec){sec=Math.max(0,Math.round(sec||0));const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),ss=sec%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`:`${m}:${String(ss).padStart(2,'0')}`}

// Local playback: the <audio> element already knows exactly when a track
// ends and exactly where it is -- no polling/heuristics needed.
const localAudioEl=$('#localAudio');
localAudioEl.addEventListener('timeupdate',()=>{
  if(!isLocal()) return;
  if(prog.playing&&!localAudioEl.paused&&performance.now()-prog.at<900) return;   // the browser reports ~4x/s; the clock shows whole seconds
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
poll(pollTransport,1500,1);
