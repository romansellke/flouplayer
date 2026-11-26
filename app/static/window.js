// The app window and its title bar (app/window.py, desktop.py): the "Hide the title bar" setting, and what stands
// in for a hidden title bar -- dragging the window by the top bar, double-clicking it to maximize, the window
// buttons -- plus window shortcuts. All of it only in Flou Player's own window, not in a normal browser tab.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

let appWindow = { available: false, hide_title_bar: false, frameless: false };
const WINDOW_SHORTCUTS = [
  ['Ctrl/⌘+W', 'Close the window (quits Flou Player)'],
  ['F11', 'Full screen on / off'],
];
async function windowAction(action) {
  try {
    await api('/api/app/window/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  } catch (x) {
    notify(x.message);
  }
}
function applyWindow(s) {
  appWindow = s;
  $('#windowOpts').classList.toggle('hidden', !s.available);
  $('#titleBarToggle').checked = !!s.hide_title_bar;
  $('#titleBarNote').textContent =
    s.available && s.hide_title_bar !== s.frameless ? 'Takes effect the next time Flou Player starts.' : '';
  const frameless = !!(s.available && s.frameless);
  document.documentElement.classList.toggle('frameless', frameless);
  $('#winCtl').classList.toggle('hidden', !frameless);
}
$('#titleBarToggle').addEventListener('change', async (e) => {
  const want = e.target.checked;
  try {
    applyWindow(
      await api('/api/app/window', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hide_title_bar: want }),
      }),
    );
    log(`Title bar: ${want ? 'hidden' : 'shown'} from the next start`);
  } catch (x) {
    e.target.checked = !want;
    notify(x.message);
  }
});
$('#winCtl').addEventListener('click', (e) => {
  const b = e.target.closest('[data-win]');
  if (b) windowAction(b.dataset.win);
});
document.addEventListener('keydown', (e) => {
  if (!appWindow.available || e.defaultPrevented) return;
  const mod = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
  if (mod && e.key.toLowerCase() === 'w') windowAction('close');
  else if (e.key === 'F11' && !e.ctrlKey && !e.metaKey && !e.altKey) windowAction('fullscreen');
  else return;
  e.preventDefault();
});

// Dragging the window: only from the empty parts of the top bar and from the track title -- the element pressed
// itself must be one of these, so a slider or button in the bar still works as usual. The page reports where the
// window should go, at most one report at a time (always the latest position).
const WINDOW_DRAG_FROM = 'header, .lcd, .lcdtext, #playing, #playingSub, #npQuality';
let winDrag = null;
document.addEventListener('mousedown', (e) => {
  if (!appWindow.frameless || e.button !== 0 || e.detail > 1 || !e.target.matches?.(WINDOW_DRAG_FROM)) return;
  winDrag = { sx: e.screenX, sy: e.screenY, wx: window.screenX, wy: window.screenY, next: null, busy: false };
  e.preventDefault(); // no text selection while dragging
});
addEventListener('mousemove', (e) => {
  if (!winDrag) return;
  winDrag.next = { x: winDrag.wx + e.screenX - winDrag.sx, y: winDrag.wy + e.screenY - winDrag.sy };
  sendWindowMove(winDrag);
});
addEventListener('mouseup', () => {
  winDrag = null;
});
async function sendWindowMove(d) {
  if (d.busy || !d.next) return;
  const to = d.next;
  d.next = null;
  d.busy = true;
  try {
    await api('/api/app/window/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(to),
    });
  } catch (x) {}
  d.busy = false;
  sendWindowMove(d); // a position that came in meanwhile (also after the button was released)
}
document.addEventListener('dblclick', (e) => {
  if (appWindow.frameless && e.target.matches?.(WINDOW_DRAG_FROM)) windowAction('maximize');
});

api('/api/app/window').then(applyWindow, () => {});
