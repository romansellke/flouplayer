// OpenHome device controls: mute, standby, source, pins, stream quality, capabilities, firmware.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

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
    setTimeout(()=>{pollSource(); pollStream(); if(typeof pollQueue==='function') pollQueue(true)},1500);
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
    // Playback the device started itself (a pin, radio, another controller): the queue poll doesn't cover it, so follow the device's own title.
    const n=r.supported&&r.now;
    if(n&&!isLocal()&&!(queue.supported&&queue.active)){
      $('#playing').textContent=n.title; $('#playingSub').textContent=[n.artist,n.album].filter(Boolean).join(' · ');
      setNowCover(n.art);
    }
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
    set('pause',c.supported&&deviceOwnsPlayback()&&c.can_pause===false);   // our own track list: CanPause is unreliable, leave Pause usable
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
poll(pollSource,5000);
poll(loadPins,60000);
poll(pollStream,4000);
poll(pollStandby,6000);
poll(pollCaps,3000);
refreshDeviceExtras();
