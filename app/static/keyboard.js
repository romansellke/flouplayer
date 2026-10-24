// Keyboard shortcuts: search/jump shortcuts and keyboard control of playback.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='f'){e.preventDefault();$('#search').focus()}});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='l'&&state.nowPlayingId){e.preventDefault();jumpToNowPlaying()}});

// ---------- Keyboard control ----------
// Space play/pause, Shift+←/→ seek, Ctrl+←/→ previous/next, Ctrl+↑/↓ volume (Shift = bigger steps),
// Ctrl+M mute, Ctrl+. stop. Plain arrow keys stay free for scrolling the lists, and plain letters for
// the column type-ahead and the search field.
const btnFor=a=>document.querySelector(`.transport [data-action=${a}]`);
function isPlayingNow(){
  if(isLocal()) return !$('#localAudio').paused;
  if(queue.supported&&queue.active) return queue.state==='Playing';
  return lastPoll.state==='PLAYING'||prog.playing;
}
function togglePlayPause(){
  if(isPlayingNow()) (btnFor('pause').classList.contains('nocap')?btnFor('stop'):btnFor('pause')).click();   // live radio can't pause: stop instead
  else btnFor('play').click();
}
function seekBy(delta){
  if(!prog.dur||!prog.seekable) return;
  const sec=Math.max(0,Math.min(prog.dur-1,curPos()+delta));
  const seek=$('#seek'); seek.value=Math.round(sec/prog.dur*1000);
  seek.dispatchEvent(new Event('change'));
}
function volumeBy(steps){
  const v=$('#volume'); if(v.classList.contains('disabled')) return;
  v.value=Math.max(+v.min,Math.min(+v.max,+v.value+steps)); v.dispatchEvent(new Event('input'));
}
function toggleMute(){
  if(isLocal()){ const a=$('#localAudio'); a.muted=!a.muted; showToast(a.muted?'Muted':'Unmuted'); return }
  if(!$('#muteBtn').classList.contains('hidden')) $('#muteBtn').click();
}
document.addEventListener('keydown',e=>{
  if(e.defaultPrevented) return;
  const t=e.target;
  if(t&&(/^(input|textarea|select)$/i.test(t.tagName)||t.isContentEditable||t.closest?.('.picker'))) return;
  if(['diagModal','metaModal','aboutModal','keysModal'].some(id=>!$('#'+id).classList.contains('hidden'))||!$('#lightbox').classList.contains('hidden')) return;
  const mod=e.ctrlKey||e.metaKey, k=e.key;
  let act=null;
  if(k===' '&&!mod&&!e.shiftKey&&!e.altKey){ if(t&&t.tagName==='BUTTON') return; act=togglePlayPause }   // Space on a focused button presses it
  else if(e.shiftKey&&!mod&&!e.altKey&&(k==='ArrowLeft'||k==='ArrowRight')) act=()=>seekBy(k==='ArrowRight'?10:-10);
  else if(mod&&!e.altKey&&(k==='ArrowLeft'||k==='ArrowRight')) act=()=>{ const b=btnFor(k==='ArrowRight'?'next':'previous'); if(!b.classList.contains('nocap')) b.click() };
  else if(mod&&!e.altKey&&(k==='ArrowUp'||k==='ArrowDown')) act=()=>volumeBy((k==='ArrowUp'?1:-1)*(e.shiftKey?5:1));
  else if(mod&&!e.altKey&&!e.shiftKey&&k.toLowerCase()==='m') act=toggleMute;
  else if(mod&&!e.altKey&&!e.shiftKey&&k==='.') act=()=>btnFor('stop').click();
  if(!act) return;
  e.preventDefault(); act();
});
// Interface zoom: works whatever the focus is (also in dialogs and text fields).
document.addEventListener('keydown',e=>{
  if(!(e.ctrlKey||e.metaKey)||e.altKey) return;
  if(e.key==='+'||e.key==='=') stepZoom(1);
  else if(e.key==='-'||e.key==='_') stepZoom(-1);
  else if(e.key==='0') stepZoom(0);
  else return;
  e.preventDefault();
});

// ---------- Shortcut overview (Ctrl/⌘+/ or F1) ----------
// One list drives the overview; keep it in step with the handlers above and docs/user-guide.md.
// "A / B" means alternatives, "+" joins the keys of one combination.
const SHORTCUTS=[
  ['Playback',[
    ['Space','Play / pause'],
    ['Shift+← / Shift+→','Seek 10 seconds back / forward'],
    ['Ctrl/⌘+← / Ctrl/⌘+→','Previous / next track'],
    ['Ctrl/⌘+↑ / Ctrl/⌘+↓','Volume up / down (add Shift for 5 steps)'],
    ['Ctrl/⌘+M','Mute / unmute'],
    ['Ctrl/⌘+.','Stop'],
  ]],
  ['Library',[
    ['Ctrl/⌘+F','Focus the search field'],
    ['Esc in the search field','Clear the search (in Live mode: back to the folder before the server search)'],
    ['Ctrl/⌘+L','Jump to the playing track'],
    ['Ctrl/⌘+B','Show / hide the column browser'],
    ['Ctrl/⌘+Q','Switch between Library and Queue'],
    ['Ctrl/⌘+K','Concert mode: the playing track full screen, for a TV (Esc leaves it)'],
    ['Backspace / Alt+←','One folder up (Live mode)'],
    ['A-Z in a column','Type-ahead in the column browser (Enter selects, Esc clears)'],
  ]],
  ['General',[
    ['Ctrl/⌘+Plus / Ctrl/⌘+Minus','Zoom the interface in / out (for tiny or huge screens)'],
    ['Ctrl/⌘+0','Reset the zoom'],
    ['Ctrl/⌘+/ / F1','Show this overview'],
    ['Esc','Close a dialog or the full-size cover'],
  ]],
];
const KEY_LABEL={Plus:'+',Minus:'−'};
const keysHtml=combo=>combo.split(' / ').map(alt=>alt.split('+').map(k=>`<kbd>${esc(KEY_LABEL[k]||k)}</kbd>`).join('+')).join('<span class="alt">or</span>');
function drawShortcuts(){
  $('#keysBody').innerHTML=SHORTCUTS.map(([title,rows])=>`<h4>${esc(title)}</h4><table>${rows.map(([keys,what])=>`<tr><td>${keysHtml(keys)}</td><td>${esc(what)}</td></tr>`).join('')}</table>`).join('');
}
function toggleShortcuts(open=$('#keysModal').classList.contains('hidden')){
  if(open) drawShortcuts();
  $('#keysModal').classList.toggle('hidden',!open);
}
$('#keysBtn').onclick=()=>toggleShortcuts();
$('#keysClose').onclick=()=>toggleShortcuts(false);
$('#keysModal').addEventListener('click',e=>{ if(e.target===$('#keysModal')) toggleShortcuts(false) });
document.addEventListener('keydown',e=>{
  if(e.key==='F1'||((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key==='/')){ e.preventDefault(); toggleShortcuts() }
  else if(e.key==='Escape') toggleShortcuts(false);
});
