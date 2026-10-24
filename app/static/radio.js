// Radio: search internet radio stations (radio-browser.info), keep favourites and own stream URLs.
// A station goes into the output device's own queue as a live item; the Linn device fetches the stream
// itself (see app/radio.py), so this needs a Linn/OpenHome output device.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

const radio={favs:[],found:null,query:'',filters:{country:'',tag:'',language:''},facets:{},kind:'country',shown:[]};
const RADIO_KINDS={country:'Country',tag:'Genre',language:'Language'};
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
const radioQuality=()=>({bitrate_min:+$('#radioMinRate').value||0,codec:$('#radioCodec').value});
const radioQualityOn=()=>{ const q=radioQuality(); return !!(q.bitrate_min||q.codec) };
const radioActive=()=>Object.entries(radio.filters).filter(([,v])=>v);
// Shows the Clear button and the chips of the chosen country/genre/language only while there is something to clear.
function radioSync(){
  const act=radioActive(), chips=$('#radioChips');
  $('#radioClear').classList.toggle('hidden',!($('#radioSearch').value||act.length||radioQualityOn()||radio.found));
  chips.classList.toggle('hidden',!act.length);
  chips.innerHTML=act.map(([k,v])=>`<span class="rchip">${RADIO_KINDS[k]}: ${esc(v)}<button type="button" data-rchip="${k}" title="Remove" aria-label="Remove ${RADIO_KINDS[k]} ${esc(v)}">×</button></span>`).join('');
}
function radioReset(){
  $('#radioSearch').value=''; radio.found=null; radio.query='';
  radio.filters={country:'',tag:'',language:''}; $('#radioMinRate').value=''; $('#radioCodec').value='';
  radioSync(); drawRadioFacets(); drawRadio(); $('#radioSearch').focus();
}
async function radioSearch(){
  const q=$('#radioSearch').value.trim(), act=radioActive();
  const qual=radioQuality();
  if(!q&&!act.length&&!radioQualityOn()){ radio.found=null; radio.query=''; radioSync(); drawRadio(); return }
  radio.query=[q,...act.map(([,v])=>v),qual.bitrate_min?'≥ '+qual.bitrate_min+' kbit/s':'',qual.codec].filter(Boolean).join(' · ');
  radioSync();
  $('#radioResults').innerHTML='<div class="empty"><span class="spinner" aria-hidden="true"></span> Loading…</div>';
  const params=new URLSearchParams({q,by:$('#radioBy').value,limit:q?40:100,...radio.filters,bitrate_min:qual.bitrate_min,codec:qual.codec});
  try{ radio.found=(await api('/api/radio/search?'+params)).stations }
  catch(err){ radio.found=null; drawRadio(); notify(err.message); return }
  radioSync(); drawRadio();
}
$('#radioClear').onclick=radioReset;
$('#radioSearch').addEventListener('keydown',e=>{
  if(e.key==='Escape'&&(e.target.value||radio.found||radioActive().length)){ e.preventDefault(); e.stopPropagation(); radioReset() }
});
// Emptying the box (also with the field's own x) drops the results of the words; a chosen country/genre/language stays.
$('#radioSearch').addEventListener('input',e=>{ if(!e.target.value&&radio.found) radioSearch(); else radioSync() });
$('#radioMinRate').onchange=$('#radioCodec').onchange=radioSearch;
$('#radioSearchBar').onsubmit=e=>{ e.preventDefault(); radioSearch() };

// ---------- Browsing by country, genre or language ----------
async function radioLoadFacets(kind){
  if(radio.facets[kind]) return;
  $('#radioFacets').innerHTML='<div class="empty"><span class="spinner" aria-hidden="true"></span> Loading…</div>';
  try{ radio.facets[kind]=(await api('/api/radio/facets?kind='+kind)).items }
  catch(err){ notify(err.message) }
}
function drawRadioFacets(){
  const box=$('#radioFacets'), kind=radio.kind, all=radio.facets[kind];
  document.querySelectorAll('#radioBrowser [data-rkind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.rkind===kind)));
  if(!all){ box.innerHTML='<div class="empty">The list could not be loaded.</div>'; return }
  const f=$('#radioFacetFilter').value.trim().toLowerCase();
  radio.shown=f?all.filter(x=>x.name.toLowerCase().includes(f)):all;
  box.innerHTML=radio.shown.length?radio.shown.map((x,i)=>`<button type="button" class="rfacet${radio.filters[kind]===x.name?' on':''}" data-rfacet="${i}">${esc(x.name)}<i>${x.count}</i></button>`).join(''):'<div class="empty">Nothing found.</div>';
}
async function radioShowKind(kind){
  radio.kind=kind; await radioLoadFacets(kind); drawRadioFacets();
}
$('#radioBrowse').onclick=async()=>{
  const box=$('#radioBrowser'), open=box.classList.toggle('hidden')===false;
  $('#radioBrowse').setAttribute('aria-expanded',String(open));
  if(open){ await radioShowKind(radio.kind); $('#radioFacetFilter').focus() }
};
document.querySelectorAll('#radioBrowser [data-rkind]').forEach(b=>b.onclick=()=>{ $('#radioFacetFilter').value=''; radioShowKind(b.dataset.rkind) });
$('#radioFacetFilter').addEventListener('input',drawRadioFacets);
$('#radioFacets').addEventListener('click',e=>{
  const b=e.target.closest('[data-rfacet]'); if(!b) return;
  const name=radio.shown[+b.dataset.rfacet].name;
  radio.filters[radio.kind]=radio.filters[radio.kind]===name?'':name;       // a second click on the chosen one lets go of it
  $('#radioBrowser').classList.add('hidden'); $('#radioBrowse').setAttribute('aria-expanded','false');
  radioSearch();
});
$('#radioChips').addEventListener('click',e=>{
  const b=e.target.closest('[data-rchip]'); if(!b) return;
  radio.filters[b.dataset.rchip]=''; drawRadioFacets(); radioSearch();
});
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

// The search bar, the stream URL form and the browser can be folded away to leave the room to the list.
function radioFold(fold,save=true){
  $('#radioControls').classList.toggle('collapsed',fold);
  const b=$('#radioCollapse'); b.textContent=fold?'Show search ▾':'Hide search ▴'; b.setAttribute('aria-expanded',String(!fold));
  if(save) try{ localStorage.setItem('flou_radio_folded',fold?'1':'0') }catch(e){}
  if(!fold) $('#radioSearch').focus();
}
$('#radioCollapse').onclick=()=>radioFold(!$('#radioControls').classList.contains('collapsed'));
try{ if(localStorage.getItem('flou_radio_folded')==='1') radioFold(true,false) }catch(e){}

// Called by showTab() when the Radio view opens.
async function renderRadio(){
  drawRadioDevice();
  await radioLoadFavs(); drawRadio();
  if(!radio.found) $('#radioSearch').focus();
}
$('#radioBtn').onclick=()=>showTab(currentTab()==='radio'?'library':'radio');
