// TIDAL: login, search, albums and artists. Opened with the TIDAL icon in the header (like Health).
// Tracks go into the output device's own queue as tidal:// URIs; the Linn device streams them itself
// with the TIDAL account stored on it (see app/tidal.py), so this needs a Linn/OpenHome output device.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

const tidal={status:null,loginTimer:null,stack:[],view:null,device:null};
const fmtSec=s=>s?fmtClock(s):'';
const QUALITY={HI_RES_LOSSLESS:'Hi-Res',HI_RES:'MQA',LOSSLESS:'CD',HIGH:'320k',LOW:'96k'};
const tidalItem=t=>({uri:t.uri,metadata:t.metadata});

async function tidalStatus(){
  try{ tidal.status=await api('/api/tidal/status') }
  catch(e){ tidal.status={available:false,logged_in:false,error:e.message} }
  drawTidalAccount();
  return tidal.status;
}
function drawTidalAccount(){
  const s=tidal.status||{}, login=s.login;
  $('#tidalAccount').textContent=s.logged_in?`Logged in${s.user?' as '+s.user:''}`:'';
  $('#tidalLogout').classList.toggle('hidden',!s.logged_in);
  $('#tidalSearchBar').classList.toggle('hidden',!s.logged_in);
  $('#tidalLogin').classList.toggle('hidden',!!s.logged_in);
  if(s.logged_in){ stopLoginPoll(); return }
  $('#tidalLoginText').textContent=!s.available?(s.error||'TIDAL is not available.')
    :login?'Open the link, log in to TIDAL and confirm the code. This page continues by itself.'
    :'Log in to TIDAL to search its catalogue. Playback runs on the Linn device itself, with the TIDAL account stored on the device.';
  $('#tidalLoginStart').classList.toggle('hidden',!s.available||!!login);
  $('#tidalLoginLink').classList.toggle('hidden',!login);
  if(login){
    $('#tidalLoginUrl').href=login.url; $('#tidalLoginUrl').textContent=login.url.replace(/^https?:\/\//,'');
    $('#tidalLoginCode').textContent=login.code;
  }
  $('#tidalLoginError').textContent=s.error&&s.available?s.error:'';
}
function stopLoginPoll(){ clearInterval(tidal.loginTimer); tidal.loginTimer=null }
$('#tidalLoginStart').onclick=async()=>{
  const b=$('#tidalLoginStart'); setBusy(b,true,'Starting…');
  try{ tidal.status=await api('/api/tidal/login',{method:'POST'}); drawTidalAccount() }
  catch(e){ notify(e.message) }
  finally{ setBusy(b,false) }
  stopLoginPoll();
  tidal.loginTimer=setInterval(async()=>{
    const s=await tidalStatus();
    if(s.logged_in){ showToast('Logged in to TIDAL'); $('#tidalSearch').focus() }
    else if(!s.login) stopLoginPoll();   // expired or failed: the error is shown
  },2000);
};
$('#tidalLoginCopy').onclick=async()=>showToast(await copyText($('#tidalLoginUrl').href)?'Link copied':'Could not copy');
$('#tidalLogout').onclick=async()=>{
  try{ await api('/api/tidal/logout',{method:'POST'}) }catch(e){ notify(e.message) }
  tidal.stack=[]; tidal.view=null; $('#tidalResults').innerHTML=''; tidalStatus();
};

// ---- Is the output device ready for TIDAL? (its own TIDAL login, OpenHome Credentials)
async function tidalDeviceCheck(){
  const d=dev(); tidal.device=null;
  if(!d||isLocal()){ drawTidalDevice(); return }
  try{ tidal.device=await api(`/api/devices/${d}/tidal`) }catch(e){ tidal.device=null }
  drawTidalDevice();
}
function drawTidalDevice(){
  const el=$('#tidalDevice'), d=tidal.device;
  let txt='', warn=false;
  if(!dev()||isLocal()){ txt='Select a Linn/OpenHome output device to play TIDAL.'; warn=true }
  else if(d?.supported&&d.ready) txt=`Device plays TIDAL as ${d.user}`;
  else if(d?.supported){ txt=d.user?`Device TIDAL login: ${d.status||'disabled'}`:'The output device has no TIDAL login -- add TIDAL in the Linn app (Linn Account).'; warn=true }
  el.textContent=txt; el.classList.toggle('warn',warn);
}
$('#renderer').addEventListener('change',()=>{ if(currentTab()==='tidal') tidalDeviceCheck() });

// ---- Views: search results, an album, an artist. Back goes up the stack.
async function tidalOpen(view,push=true){
  if(push&&tidal.view) tidal.stack.push(tidal.view);
  tidal.view=view;
  const box=$('#tidalResults');
  box.innerHTML='<div class="empty"><span class="spinner" aria-hidden="true"></span> Loading…</div>';
  try{
    if(view.type==='search') view.data??=await api('/api/tidal/search?q='+encodeURIComponent(view.q));
    else if(view.type==='album') view.data??=await api('/api/tidal/albums/'+encodeURIComponent(view.id));
    else if(view.type==='artist') view.data??=await api('/api/tidal/artists/'+encodeURIComponent(view.id));
  }catch(e){
    box.innerHTML=`<div class="empty">${esc(e.message)}</div>`;
    if(/not logged in/i.test(e.message)) tidalStatus();
    return;
  }
  if(tidal.view!==view) return;   // another view was opened meanwhile
  drawTidalView();
  $('#tidalScroll').scrollTop=view.scroll||0;
}
function tidalBack(){
  const prev=tidal.stack.pop(); if(!prev) return;
  tidalOpen(prev,false);
}
function tidalCards(list,kind){
  return `<div class="livegrid">${list.map(x=>kind==='artist'
    ?`<div class="livecard" data-tartist="${esc(x.id)}" title="${esc(x.name)}"><div class="cover round" ${cover(x.picture)}>${x.picture?'':'<span class="glyph">♪</span>'}</div><div class="livetitle">${esc(x.name)}</div></div>`
    :`<div class="livecard" data-talbum="${esc(x.id)}" title="${esc(x.title)}"><div class="cover" ${cover(x.album_art)}></div><div class="livetitle">${esc(x.title)}</div><div class="livesub">${esc([x.artist,x.year].filter(Boolean).join(' · '))}</div></div>`).join('')}</div>`;
}
function tidalTracks(list,{showAlbum=true}={}){
  return `<table class="tracks qtable ttable"><tbody>${list.map((t,i)=>`<tr class="clickable${t.available?'':' unavailable'}" data-ti="${i}" title="${t.available?'Double-click to play':'Not available for streaming'}">
    <td class="n">${showAlbum?i+1:(t.track_number||i+1)}</td>${showAlbum?`<td class="qcover"><div ${cover(t.album_art)}></div></td>`:''}
    <td class="title">${esc(t.title)}</td><td class="artist sub">${esc(t.artist)}</td>${showAlbum?`<td class="sub">${esc(t.album)}</td>`:''}
    <td class="quality">${esc(QUALITY[t.quality]||'')}</td><td class="time">${esc(fmtSec(t.duration))}</td>
    <td class="qx"><button type="button" data-tadd="${i}" title="Add to the queue" aria-label="Add to the queue">+</button></td></tr>`).join('')}</tbody></table>`;
}
function drawTidalView(){
  const v=tidal.view, d=v.data, box=$('#tidalResults');
  const back=tidal.stack.length?'<button type="button" class="btn-link" data-tback>← Back</button>':'';
  if(v.type==='search'){
    const parts=[];
    if(d.artists.length) parts.push(`<h4 class="tsect">Artists</h4>`+tidalCards(d.artists.slice(0,12),'artist'));
    if(d.albums.length) parts.push(`<h4 class="tsect">Albums</h4>`+tidalCards(d.albums,'album'));
    if(d.tracks.length) parts.push(`<h4 class="tsect">Tracks</h4>`+tidalTracks(d.tracks));
    box.innerHTML=(back?`<div class="thead">${back}</div>`:'')+(parts.join('')||`<div class="empty">Nothing found for "${esc(v.q)}".</div>`);
  }else if(v.type==='album'){
    const a=d.album, n=d.tracks.length, total=d.tracks.reduce((s,t)=>s+t.duration,0);
    box.innerHTML=`<div class="thead">${back}</div><div class="talbum"><div class="cover" ${cover(a.album_art)}></div><div class="tmeta">
      <div class="ttitle">${esc(a.title)}</div><div class="tsub"><button type="button" class="crumb" data-tartist-name="${esc(a.artist)}">${esc(a.artist)}</button>${a.year?' · '+a.year:''}</div>
      <div class="tsub">${n} track${n===1?'':'s'}${total?' · '+fmtLong(total):''}${QUALITY[a.quality]?' · '+QUALITY[a.quality]:''}</div>
      <div class="tbtns"><button type="button" class="btn-link" data-tplay>▶ Play</button><button type="button" class="btn-link" data-tqueue>+ Queue</button></div></div></div>`
      +tidalTracks(d.tracks,{showAlbum:false});
  }else if(v.type==='artist'){
    box.innerHTML=`<div class="thead">${back}</div><div class="tartist"><div class="cover round" ${cover(d.artist.picture)}></div><div class="ttitle">${esc(d.artist.name)}</div></div>`
      +(d.albums.length?tidalCards(d.albums,'album'):'<div class="empty">No albums.</div>');
  }
}
const tidalShownTracks=()=>tidal.view?.data?.tracks||[];

// ---- Playing: into the device queue, like the library does.
async function tidalCanPlay(){
  if(!dev()||isLocal()){ notify('TIDAL plays on the Linn/OpenHome output device itself -- select one as output device.'); return false }
  if(!queue.supported) await pollQueue(true);   // one failed poll marks the queue unsupported: ask again before giving up
  if(queue.supported) return true;
  notify('The output device has no usable playlist right now (OpenHome Playlist), so TIDAL can\'t play on it. See Diagnostics for details.');
  return false;
}
async function tidalQueue(tracks,{play=false,replace=false,start=0}={}){
  tracks=tracks.filter(t=>t.available);
  if(!tracks.length||!await tidalCanPlay()) return;
  try{
    await queueApi({action:replace?'replace':'insert',items:tracks.map(tidalItem),play,start});
    if(!play&&!replace) showToast(`Added ${tracks.length} track${tracks.length>1?'s':''} to the queue`);
    pollQueue(true);
  }catch(e){ notify(e.message) }
}
$('#tidalResults').addEventListener('click',e=>{
  const v=tidal.view; if(!v) return;
  const t=e.target, add=t.closest('[data-tadd]');
  if(add){ e.stopPropagation(); const tr=tidalShownTracks()[+add.dataset.tadd]; if(tr) tidalQueue([tr],{play:!queue.entries.length||!queue.active}); return }
  if(t.closest('[data-tback]')) return tidalBack();
  if(t.closest('[data-tplay]')) return tidalQueue(tidalShownTracks(),{replace:true});
  if(t.closest('[data-tqueue]')) return tidalQueue(tidalShownTracks(),{play:!queue.entries.length||!queue.active});
  const byName=t.closest('[data-tartist-name]');
  if(byName){ v.scroll=$('#tidalScroll').scrollTop; return tidalOpen({type:'search',q:byName.dataset.tartistName}) }
  const al=t.closest('[data-talbum]'), ar=t.closest('[data-tartist]');
  if(al||ar){ v.scroll=$('#tidalScroll').scrollTop; tidalOpen(al?{type:'album',id:al.dataset.talbum}:{type:'artist',id:ar.dataset.tartist}) }
});
// Double-click: in an album, the whole album plays from that track (as in the library);
// a single search result is added and played without clearing the queue.
$('#tidalResults').addEventListener('dblclick',e=>{
  if(e.target.closest('button')) return;
  const tr=e.target.closest('tr[data-ti]'); if(!tr) return;
  const list=tidalShownTracks(), i=+tr.dataset.ti;
  if(tidal.view.type==='album'){
    const ok=list.filter(t=>t.available), start=ok.indexOf(list[i]);
    if(start>=0) tidalQueue(ok,{replace:true,start});
  }else tidalQueue([list[i]],{play:true});
});
$('#tidalSearchBar').onsubmit=e=>{
  e.preventDefault();
  const q=$('#tidalSearch').value.trim(); if(!q) return;
  tidal.stack=[]; tidal.view=null;
  tidalOpen({type:'search',q});
};

// Called by showTab() when the TIDAL view opens.
async function renderTidal(){
  tidalDeviceCheck();
  const s=await tidalStatus();
  if(s.logged_in&&!tidal.view) $('#tidalSearch').focus();
}
$('#tidalBtn').onclick=()=>showTab(currentTab()==='tidal'?'library':'tidal');
