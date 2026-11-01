// Media keys and the desktop's player controls (MPRIS, see app/media.py): report what is playing,
// and carry out play/pause/next/... the way the transport buttons do.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

function mediaTrack(){
  const q=queue.active&&queue.entries.find(en=>en.id===queue.currentId);
  if(q) return {title:q.title,artist:q.artist,album:q.album,art_url:q.album_art||'',track_id:'q'+q.id};
  const id=state.nowPlayingId; if(!id) return null;
  const t=state.view.byId.get(id)||state.tracks.find(x=>x.id===id)||liveSeen.byId.get(id)?.t;
  return t?{title:t.title||'',artist:t.artist||'',album:t.album||'',art_url:t.album_art||'',track_id:String(t.id)}:null;
}
function mediaState(){
  const t=mediaTrack();
  const status=!t?'Stopped':isPlayingNow()?'Playing':(prog.dur||curPos())?'Paused':'Stopped';
  const nocap=a=>btnFor(a).classList.contains('nocap');
  return {status,...(t||{}),length:prog.dur||0,position:t?curPos():0,
          can_next:!nocap('next'),can_previous:!nocap('previous'),can_pause:!nocap('pause')};
}
// Off by default: switched on in the Keyboard shortcuts dialog (the setting lives in the backend, which publishes
// the MPRIS player). While it is off nothing is reported and no commands are asked for -- no requests, no timers.
let mediaOn=false;
let mediaSent='', mediaSentAt=0;
async function pushMediaState(){
  if(!mediaOn) return;
  const s=mediaState(), key=JSON.stringify({...s,position:0});
  if(key===mediaSent && performance.now()-mediaSentAt<10000) return;   // unchanged: refresh the position now and then only
  mediaSent=key; mediaSentAt=performance.now();
  try{ await api('/api/media/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)}) }catch(e){ mediaSent='' }
}
// Sent soon after something changes (setProgress and markNowPlaying call pushMediaSoon), plus a slow safety net
// for changes that don't pass there. The backend runs the position on by itself for the panel (see media.py).
let mediaSoonTimer=null;
function pushMediaSoon(){ if(mediaOn&&mediaSoonTimer===null) mediaSoonTimer=setTimeout(()=>{ mediaSoonTimer=null; pushMediaState() },150) }
const mediaPoller=poll(pushMediaState,5000,2,{on:false});

function runMediaCommand(cmd){
  if(!$('#renderer').value) return;
  if(cmd==='play_pause') return togglePlayPause();
  if(cmd==='play'){ if(!isPlayingNow()) btnFor('play').click(); return }
  if(cmd==='pause'){ if(isPlayingNow()) togglePlayPause(); return }
  const b=btnFor(cmd);
  if(b && !b.classList.contains('nocap')) b.click();
}
// Long poll: the backend answers as soon as a media key is pressed. One loop at a time: switching off and on
// again starts a new one, and the old one ends when its open request comes back.
let mediaLoop=0;
async function mediaCommands(gen){
  while(mediaOn&&gen===mediaLoop){
    try{
      const r=await api('/api/media/command?wait=25');
      if(r.command&&mediaOn) runMediaCommand(r.command);
      else if(!r.command) await new Promise(res=>setTimeout(res,500));   // never spin if an answer comes back early
    }
    catch(e){ await new Promise(res=>setTimeout(res,5000)) }   // backend gone or restarting: try again later
  }
}
function applyMediaSettings(s){
  const on=!!s?.mpris;
  const box=$('#mprisToggle');
  box.checked=on;
  box.disabled=s?.available===false;
  $('#mprisNote').textContent=s?.available===false?'Only available on Linux.'
    :on&&!s.active?`Switched on, but the desktop doesn't offer it right now${s.error?' ('+s.error+')':''}.`:'';
  if(on===mediaOn) return;
  mediaOn=on;
  if(on){ mediaSent=''; mediaPoller.start(); mediaCommands(++mediaLoop) }
  else{ mediaPoller.stop(); clearTimeout(mediaSoonTimer); mediaSoonTimer=null; mediaLoop++ }
}
$('#mprisToggle').addEventListener('change',async e=>{
  const want=e.target.checked;
  try{
    const s=await api('/api/media/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mpris:want})});
    applyMediaSettings(s);
    log(`Media keys and panel player controls (MPRIS): ${want?'on':'off'}${want&&!s.active?' -- not available: '+(s.error||'no desktop session'):''}`);
  }catch(x){ e.target.checked=!want; notify(x.message) }
});
api('/api/media/settings').then(applyMediaSettings,()=>applyMediaSettings(null));
