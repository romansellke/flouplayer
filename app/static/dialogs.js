// Dialogs and overlays: metadata inspector (right-click), About, cover size and the full-size cover.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

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
