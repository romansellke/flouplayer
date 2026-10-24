// Device search and the two device dropdowns (media server / output device) with their icons.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

// ---------- Device pickers with icons ----------
// Native <select> options can't show images, so each device <select> gets
// a custom dropdown on top that shows the device's own UPnP icon (from its
// description's <iconList>, as the Linn app does). The hidden <select>
// stays the source of truth: the picker only sets its value and fires
// 'change', so everything reading $('#server')/$('#renderer') is unchanged.
const svgIcon=body=>'data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6b7480" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`);
const ICON_SERVER=svgIcon('<rect x="4" y="3" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/><circle cx="8" cy="6.5" r=".8" fill="#6b7480"/><circle cx="8" cy="17.5" r=".8" fill="#6b7480"/>');
const ICON_RENDERER=svgIcon('<rect x="6" y="2" width="12" height="20" rx="2"/><circle cx="12" cy="14.5" r="3.5"/><circle cx="12" cy="6.5" r="1.3"/>');
const ICON_LOCAL=svgIcon('<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>');

function createDevicePicker(select,fallbackIcon){
  const root=document.createElement('div');
  root.className='picker';
  root.innerHTML='<button type="button" class="picker-btn" aria-haspopup="listbox" aria-expanded="false"></button><ul class="picker-menu hidden" role="listbox" tabindex="-1"></ul>';
  select.after(root); select.classList.add('picker-source');
  const btn=root.querySelector('.picker-btn'), menu=root.querySelector('.picker-menu');
  let active=-1;

  function itemHtml(opt){
    const icon=opt.value?(opt.dataset.icon||fallbackIcon):'';
    return (icon?`<img class="picker-icon" alt="" src="${esc(icon)}">`:'<span class="picker-icon"></span>')
      +`<span class="picker-label">${esc(opt.textContent)}</span>`;
  }
  // Unreachable/broken device icons fall back to the generic symbol.
  function guardIcons(el){el.querySelectorAll('img.picker-icon').forEach(img=>img.addEventListener('error',()=>{img.src=fallbackIcon},{once:true}))}
  function refresh(){
    const opt=select.options[select.selectedIndex];
    btn.innerHTML=opt?itemHtml(opt):'';
    btn.classList.toggle('placeholder',!select.value);
    guardIcons(btn);
  }
  function setActive(i){
    const items=menu.children; if(!items.length) return;
    active=Math.max(0,Math.min(items.length-1,i));
    [...items].forEach((li,j)=>li.classList.toggle('active-item',j===active));
    items[active].scrollIntoView({block:'nearest'});
  }
  function open(){
    menu.innerHTML=[...select.options].map((o,i)=>`<li role="option" data-i="${i}" class="${o.value?'':'picker-placeholder'}" aria-selected="${i===select.selectedIndex}">${itemHtml(o)}</li>`).join('');
    guardIcons(menu);
    menu.querySelectorAll('li').forEach(li=>{
      li.onclick=e=>{e.stopPropagation();choose(+li.dataset.i)};
      li.onmousemove=()=>setActive(+li.dataset.i);
    });
    document.querySelectorAll('.picker-menu').forEach(m=>{if(m!==menu)m.classList.add('hidden')});
    menu.classList.remove('hidden'); btn.setAttribute('aria-expanded','true');
    setActive(select.selectedIndex);
  }
  function close(){menu.classList.add('hidden');btn.setAttribute('aria-expanded','false')}
  function choose(i){
    close(); btn.focus();
    if(i===select.selectedIndex){ refresh(); return }   // already selected: just make sure the button shows it
    select.selectedIndex=i; refresh();
    select.dispatchEvent(new Event('change'));
  }
  btn.onclick=e=>{e.stopPropagation();menu.classList.contains('hidden')?open():close()};
  btn.onkeydown=e=>{
    const isOpen=!menu.classList.contains('hidden');
    if(!isOpen&&['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){e.preventDefault();open();return}
    if(!isOpen) return;
    if(e.key==='ArrowDown'){e.preventDefault();setActive(active+1)}
    else if(e.key==='ArrowUp'){e.preventDefault();setActive(active-1)}
    else if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(active)}
    else if(e.key==='Escape'||e.key==='Tab'){close()}
  };
  document.addEventListener('click',close);
  refresh();
  return {refresh};
}
$(`#renderer option[value="${LOCAL_RENDERER_ID}"]`).dataset.icon=ICON_LOCAL; // the initial HTML option
const serverPicker=createDevicePicker($('#server'),ICON_SERVER);
const rendererPicker=createDevicePicker($('#renderer'),ICON_RENDERER);

// While a search runs the button turns into "Cancel": a click gives up the request (the backend limits itself too,
// see DISCOVER_LOAD_SECONDS) so the UI is never stuck "Searching" -- e.g. after a network outage.
let discoverAbort=null;
$('#discover').onclick=async()=>{
  const btn=$('#discover');
  if(discoverAbort){ discoverAbort.abort(); return }
  const ctl=discoverAbort=new AbortController();
  btn._label=btn.textContent; btn.style.minWidth=btn.offsetWidth+'px';
  btn.innerHTML='<span class="spinner" aria-hidden="true"></span>Cancel search'; btn.title='Stop searching';
  try{
    log('Searching local network ...');
    const x=await api('/api/discover',{signal:ctl.signal});
    state.devices=x.devices;
    populateServerSelect(x.devices.filter(d=>d.server));
    populateRendererSelect(x.devices.filter(d=>d.renderer));
    applySavedDevices();
    for(const k of ['server','renderer']){ const w=savedDev(k); if(w&&w!==LOCAL_RENDERER_ID&&$('#'+k).value!==w) log(`Remembered ${k} (${w}) was not found in this search`,'warn') }
    log(`Found ${x.devices.length} device(s): `+x.devices.map(d=>d.name+(d.server?' [server]':'')+(d.renderer?' [output]':'')).join(', '));
    updateReadyState();
  }catch(e){ if(ctl.signal.aborted) log('Device search cancelled'); else logErr(e.message) }
  finally{ discoverAbort=null; btn.textContent=btn._label; btn.style.minWidth=''; btn.title='' }
};

// Fold the whole device/search bar away to leave the room to the list; the tabs stay.
function toolbarSummary(){
  const label=id=>{ const b=document.querySelector(`#${id} + .picker .picker-btn`); return b&&!b.classList.contains('placeholder')?b.textContent.trim():'' };
  return [label('server'),label('renderer')].filter(Boolean).join('  →  ');
}
function toolbarFold(fold,save=true){
  const bar=document.querySelector('.toolbar'), b=$('#toolbarFold'), sum=$('#toolbarSummary');
  bar.classList.toggle('folded',fold);
  b.textContent=fold?'▾':'▴'; b.setAttribute('aria-expanded',String(!fold));
  const text=fold?'Show the device and search bar':'Hide the device and search bar (keeps the tabs)';
  b.title=text; b.setAttribute('aria-label',text);
  sum.textContent=toolbarSummary(); sum.classList.toggle('hidden',!fold);
  if(save) try{ localStorage.setItem('flou_toolbar_folded',fold?'1':'0') }catch(e){}
}
$('#toolbarFold').onclick=()=>toolbarFold(!document.querySelector('.toolbar').classList.contains('folded'));
// The summary follows device changes while folded (the pickers redraw their labels).
new MutationObserver(()=>{
  const sum=$('#toolbarSummary'), t=toolbarSummary();
  if(document.querySelector('.toolbar').classList.contains('folded')&&sum.textContent!==t) sum.textContent=t;   // (writing it is a change too: only when it differs)
})
  .observe(document.querySelector('.toolbar'),{subtree:true,childList:true,characterData:true});
try{ if(localStorage.getItem('flou_toolbar_folded')==='1') toolbarFold(true,false) }catch(e){}
