// Radio: search internet radio stations (radio-browser.info), keep favourites and own stream URLs.
// A station goes into the output device's own queue as a live item; the Linn device fetches the stream
// itself (see app/radio.py), so this needs a Linn/OpenHome output device.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

const radio={favs:[],found:null,query:''};
const radioItem=s=>({uri:s.uri,metadata:s.metadata});
const isFav=s=>radio.favs.some(f=>f.url===s.url);

function drawRadioDevice(){
  const el=$('#radioDevice'), ok=dev()&&!isLocal();
  el.textContent=ok?'':'Select a Linn/OpenHome output device to play radio.';
  el.classList.toggle('warn',!ok);
}
$('#renderer').addEventListener('change',()=>{ if(currentTab()==='radio') drawRadioDevice() });

async function radioLoadFavs(){
  try{ radio.favs=(await api('/api/radio/favourites')).stations }catch(e){ radio.favs=[] }
}
function radioTable(list,key){
  if(!list.length) return '';
  return `<table class="tracks qtable ttable rtable"><tbody>${list.map((s,i)=>`<tr class="clickable" data-${key}="${i}" title="Double-click to play">
    <td class="rlogo"><div ${cover(s.logo)}></div></td><td class="title">${esc(s.name)}</td>
    <td class="artist sub">${esc([s.country,s.tags].filter(Boolean).join(' · '))}</td>
    <td class="quality">${esc([s.codec,s.bitrate?s.bitrate+'k':''].filter(Boolean).join(' '))}</td>
    <td class="qx"><button type="button" class="fav${isFav(s)?' on':''}" data-rfav="${key}:${i}" title="${isFav(s)?'Remove from favourites':'Add to favourites'}" aria-label="Favourite">${isFav(s)?'★':'☆'}</button><button type="button" data-radd="${key}:${i}" title="Add to the queue" aria-label="Add to the queue">+</button></td></tr>`).join('')}</tbody></table>`;
}
function drawRadio(){
  const box=$('#radioResults'), parts=[];
  if(radio.found){
    parts.push(`<h4 class="tsect">Results for "${esc(radio.query)}"</h4>`+(radio.found.length?radioTable(radio.found,'rs'):'<div class="empty">No stations found.</div>'));
  }
  if(radio.favs.length) parts.push(`<h4 class="tsect">Favourites</h4>`+radioTable(radio.favs,'rf'));
  box.innerHTML=parts.join('')||'<div class="empty">Search for a station, or add a stream URL of your own.</div>';
}
const radioPick=ref=>{ const [k,i]=ref.split(':'); return (k==='rs'?radio.found:radio.favs)?.[+i] };

async function radioCanPlay(){
  if(!dev()||isLocal()){ notify('Radio plays on the Linn/OpenHome output device itself -- select one as output device.'); return false }
  if(!queue.supported) await pollQueue(true);
  if(queue.supported) return true;
  notify('The output device has no usable playlist right now (OpenHome Playlist), so radio can\'t play on it. See Diagnostics for details.');
  return false;
}
async function radioQueue(s,{replace=false}={}){
  if(!s||!await radioCanPlay()) return;
  const play=replace||!queue.entries.length||!queue.active;
  try{
    await queueApi({action:replace?'replace':'insert',items:[radioItem(s)],play});
    if(!play) showToast(`Added ${s.name} to the queue`);
    pollQueue(true);
  }catch(e){ notify(e.message) }
}
async function radioToggleFav(s){
  try{
    if(isFav(s)){ const f=radio.favs.find(f=>f.url===s.url); await api('/api/radio/favourites/'+encodeURIComponent(f.id),{method:'DELETE'}) }
    else await api('/api/radio/favourites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:s.name,url:s.url,id:s.id,codec:s.codec,bitrate:s.bitrate,country:s.country,tags:s.tags,logo:s.logo})});
  }catch(e){ notify(e.message) }
  await radioLoadFavs(); drawRadio();
}
$('#radioResults').addEventListener('click',e=>{
  const fav=e.target.closest('[data-rfav]'), add=e.target.closest('[data-radd]');
  if(fav){ e.stopPropagation(); radioToggleFav(radioPick(fav.dataset.rfav)) }
  else if(add){ e.stopPropagation(); radioQueue(radioPick(add.dataset.radd)) }
});
$('#radioResults').addEventListener('dblclick',e=>{
  if(e.target.closest('button')) return;
  const tr=e.target.closest('tr[data-rs],tr[data-rf]'); if(!tr) return;
  radioQueue(radioPick(tr.dataset.rs!==undefined?'rs:'+tr.dataset.rs:'rf:'+tr.dataset.rf),{replace:true});
});
function radioReset(){
  $('#radioSearch').value=''; radio.found=null; radio.query='';
  $('#radioClear').classList.add('hidden');
  drawRadio(); $('#radioSearch').focus();
}
$('#radioClear').onclick=radioReset;
$('#radioSearch').addEventListener('keydown',e=>{ if(e.key==='Escape'&&(e.target.value||radio.found)){ e.preventDefault(); e.stopPropagation(); radioReset() } });
// Emptying the box (also with the field's own x) shows the favourites again.
$('#radioSearch').addEventListener('input',e=>{ if(!e.target.value&&radio.found){ radio.found=null; $('#radioClear').classList.add('hidden'); drawRadio() } });
$('#radioSearchBar').onsubmit=async e=>{
  e.preventDefault();
  const q=$('#radioSearch').value.trim();
  if(!q){ radioReset(); return }
  $('#radioClear').classList.remove('hidden');
  radio.query=q;
  $('#radioResults').innerHTML='<div class="empty"><span class="spinner" aria-hidden="true"></span> Loading…</div>';
  try{ radio.found=(await api(`/api/radio/search?q=${encodeURIComponent(q)}&by=${$('#radioBy').value}`)).stations }
  catch(err){ radio.found=null; drawRadio(); notify(err.message); return }
  drawRadio();
};
$('#radioAddUrl').onclick=()=>{ $('#radioUrlBar').classList.toggle('hidden'); if(!$('#radioUrlBar').classList.contains('hidden')) $('#radioUrl').focus() };
$('#radioUrlBar').onsubmit=async e=>{
  e.preventDefault();
  try{
    await api('/api/radio/favourites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('#radioUrlName').value.trim(),url:$('#radioUrl').value.trim()})});
    $('#radioUrlName').value=''; $('#radioUrl').value=''; $('#radioUrlBar').classList.add('hidden');
    showToast('Saved to the favourites');
  }catch(err){ notify(err.message) }
  await radioLoadFavs(); drawRadio();
};

// Called by showTab() when the Radio view opens.
async function renderRadio(){
  drawRadioDevice();
  await radioLoadFavs(); drawRadio();
  if(!radio.found) $('#radioSearch').focus();
}
$('#radioBtn').onclick=()=>showTab(currentTab()==='radio'?'library':'radio');
