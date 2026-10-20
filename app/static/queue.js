// The device queue (OpenHome Playlist): Queue tab, add/play, polling.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

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
// The queue is the output device's own playlist, not a list kept by this app.
const QUEUE_HELP='The queue is the playlist stored on the output device itself (OpenHome Playlist), '
  +'so it only exists on Linn/OpenHome devices. The device plays it by itself: tracks keep playing in order '
  +'even if Flou Player is closed, and other control apps (e.g. Linn app) see and change the same queue. '
  +'Add tracks with + or + Queue, reorder, remove, shuffle and repeat here.';
function renderQueue(){
  const usable=queue.supported&&!isLocal();
  $('#tabQueue').disabled=!usable;
  $('#tabQueue').title=QUEUE_HELP+(usable?'':'\n\nNot available now: select a Linn/OpenHome output device (not "This computer") to use it.');
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
// Live / Library / Queue are one row: Live and Library are the two ways to browse (live vs. the cached scan).
function drawTabs(){
  const name=currentTab(), lib=name==='library', live=typeof isLive==='function'&&isLive();
  for(const [id,on] of [['Live',lib&&live],['Library',lib&&!live],['Queue',name==='queue']]){
    $('#tab'+id).classList.toggle('active',on); $('#tab'+id).setAttribute('aria-selected',String(on));
  }
}
function showTab(name){
  if(name==='queue' && $('#tabQueue').disabled) return;
  document.querySelector('main').dataset.tab=name;
  drawTabs();
  if(name==='queue'){ renderQueue(); pollQueue(true); scrollToCurrentQueue(false) }
  $('#healthBtn').classList.toggle('active',name==='health'); $('#healthBtn').setAttribute('aria-pressed',String(name==='health'));
  if(name==='health') renderHealth();
}
function scrollToCurrentQueue(smooth=true){
  const row=document.querySelector('#queueList tr.playing');
  if(row) row.scrollIntoView({block:'center',behavior:smooth?'smooth':'auto'});
}
$('#tabLive').onclick=()=>{ setLibMode('live'); showTab('library') };
$('#tabLibrary').onclick=()=>{ setLibMode('cached'); showTab('library') };
$('#tabQueue').onclick=()=>showTab('queue');
// The Health view is opened from the icon in the header (a toggle: click again to go back to the library).
$('#healthBtn').onclick=()=>showTab(currentTab()==='health'?'library':'health');
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
