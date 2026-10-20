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
let mediaSent='', mediaSentAt=0;
async function pushMediaState(){
  const s=mediaState(), key=JSON.stringify({...s,position:0});
  if(key===mediaSent && performance.now()-mediaSentAt<10000) return;   // unchanged: refresh the position now and then only
  mediaSent=key; mediaSentAt=performance.now();
  try{ await api('/api/media/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)}) }catch(e){ mediaSent='' }
}
setInterval(pushMediaState,1000);

function runMediaCommand(cmd){
  if(!$('#renderer').value) return;
  if(cmd==='play_pause') return togglePlayPause();
  if(cmd==='play'){ if(!isPlayingNow()) btnFor('play').click(); return }
  if(cmd==='pause'){ if(isPlayingNow()) togglePlayPause(); return }
  const b=btnFor(cmd);
  if(b && !b.classList.contains('nocap')) b.click();
}
// Long poll: the backend answers as soon as a media key is pressed.
(async function mediaCommands(){
  for(;;){
    try{
      const r=await api('/api/media/command?wait=25');
      if(r.command) runMediaCommand(r.command);
      else await new Promise(res=>setTimeout(res,500));   // never spin if an answer comes back early
    }
    catch(e){ await new Promise(res=>setTimeout(res,5000)) }   // backend gone or restarting: try again later
  }
})();
