// Remembering the chosen media server and output device, and reconnecting at startup.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

// ---------- Remember the chosen media server and output device ----------
// The choice is saved when you pick; at startup the app reconnects to the devices it knew
// (backend: /api/devices/restore, no network search) and selects them again.
const savedDev=k=>{ try{ return localStorage.getItem('flou_'+k)||'' }catch(e){ return '' } };
const saveDev=(k,v)=>{ try{ localStorage.setItem('flou_'+k,v) }catch(e){} };
$('#server').addEventListener('change',()=>saveDev('server',$('#server').value));
$('#renderer').addEventListener('change',()=>saveDev('renderer',$('#renderer').value));
function applySavedDevices(){
  for(const [id,key] of [['#server','server'],['#renderer','renderer']]){
    const sel=$(id), want=savedDev(key);
    if(!want||sel.value===want||![...sel.options].some(o=>o.value===want)) continue;
    sel.value=want;
    (sel.id==='server'?serverPicker:rendererPicker).refresh();   // the picker shows the select's value only when told to
    sel.dispatchEvent(new Event('change'));   // loads what depends on it
  }
}
(async function restoreDevices(){
  try{
    const x=await api('/api/devices/restore',{method:'POST'});
    if(x.devices.length){
      state.devices=x.devices;
      populateServerSelect(x.devices.filter(d=>d.server));
      populateRendererSelect(x.devices.filter(d=>d.renderer));
      log(`Reconnected to ${x.devices.length} saved device(s)`);
    }
  }catch(e){/* nothing saved yet, or the backend can't restore -- use Search devices */}
  applySavedDevices();
  updateReadyState();
  // A remembered device didn't come back (e.g. you changed network, or it was slow): search once instead of waiting for a click.
  const missing=['server','renderer'].filter(k=>{ const want=savedDev(k); return want&&want!==LOCAL_RENDERER_ID&&$('#'+k).value!==want });
  if(missing.length){ log(`Remembered ${missing.join(' and ')} not reconnected -- searching the network`,'warn'); $('#discover').click() }
})();
