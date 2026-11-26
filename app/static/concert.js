// Concert mode: a calm full-window display of the playing track for a TV or a screen across the room.
// Big cover, title, artist, album and year, the stream quality as a badge, the position, and what comes next.
// It only reads what the other files already know (mediaTrack, prog, npQuality, queue); nothing is stored but the on/off wish.
// (Classic script: shares one global scope with the other files, loaded in the order given in index.html.)

const concertEl = $('#concert');
let concertIdleTimer = null;
const isConcert = () => !concertEl.classList.contains('hidden');

// The full track record (year, ...) when we have it; mediaTrack() alone is enough for the queue entries.
function concertFullTrack() {
  const id = state.nowPlayingId;
  if (!id) return null;
  return state.view.byId.get(id) || state.tracks.find((x) => x.id === id) || liveSeen.byId.get(id)?.t || null;
}
function concertNext() {
  if (queue.active) {
    const i = queue.entries.findIndex((en) => en.id === queue.currentId);
    return i >= 0 ? queue.entries[i + 1] : null;
  }
  const list = state.currentPlaylist,
    i = list.findIndex((t) => t.id === state.nowPlayingId);
  return i >= 0 ? list[i + 1] : null;
}
// "FLAC · 96 kHz · 24 bit" -> Hi-Res / Lossless / nothing. Same rule as the quality filter: above 16 bit or 48 kHz is Hi-Res.
function concertGrade(q) {
  const khz = +(q.match(/([\d.]+) kHz/) || [])[1],
    bits = +(q.match(/(\d+) bit/) || [])[1];
  const lossy = /\b(mp3|aac|ogg|vorbis|wma|opus)\b/i.test(q); // lossless codecs report a bit rate too
  if (lossy || (!khz && !bits)) return '';
  return bits > 16 || khz > 48 ? 'Hi-Res' : 'Lossless';
}
// Format details (codec, bit rate, genre, track number) are switched on and off with the "i" button; remembered.
let concertDetails = false;
try {
  concertDetails = localStorage.getItem('concert_details') === '1';
} catch (e) {}
// Compact: what a hi-fi display shows (rate and depth, or codec and bit rate for lossy). Details: everything the device reports.
function concertFormat(q) {
  if (concertDetails) return q;
  const parts = q.split(' · ');
  const pcm = parts.filter((x) => /kHz|bit$/.test(x));
  return (pcm.length ? pcm : parts.filter((x) => !/^\d+ kbps$/.test(x) || parts.length < 3)).join(' · ');
}
// What the title display in the header shows right now (also for radio, TIDAL or a track started elsewhere,
// which mediaTrack() doesn't know). The cover is taken from there too, so both always agree.
function concertHeader() {
  const c = $('#npCover'),
    art = c.classList.contains('hidden')
      ? ''
      : (c.style.backgroundImage.match(/url\(["']?(.*?)["']?\)$/) || [])[1] || '';
  const title = $('#playing').textContent;
  return title === 'Flou Player' && !art
    ? null
    : { title, artist: $('#playingSub').textContent, album: '', art_url: art };
}
// The blurred backdrop: the cover blurred once per cover into a canvas of half the window's size and shown
// stretched over the window (see .c-ambient). The same look as a CSS blur, but computed once per cover instead
// of for every frame. The picture is first drawn small (cheap to blur), then smoothly enlarged and blurred once
// more, so no blocks show. A cover from another server makes the canvas unreadable to scripts, which doesn't
// matter: it is only shown.
const AMBIENT_SMALL = 64;
let ambientArt = null,
  ambientImg = null;
function setAmbient(art) {
  if (art === ambientArt) return;
  ambientArt = art;
  ambientImg = null;
  paintAmbient();
  if (!art) return;
  const img = new Image();
  img.onload = () => {
    if (ambientArt !== art) return; // another track meanwhile
    ambientImg = img;
    paintAmbient();
  };
  img.src = art;
}
function paintAmbient() {
  const cv = $('#concertAmbient'),
    W = Math.max(1, Math.round(innerWidth / 2)),
    H = Math.max(1, Math.round(innerHeight / 2));
  if (cv.width !== W || cv.height !== H) Object.assign(cv, { width: W, height: H }); // also clears it
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const img = ambientImg;
  if (!img || !img.naturalWidth) return;
  const small = document.createElement('canvas');
  small.width = AMBIENT_SMALL;
  small.height = Math.max(1, Math.round((AMBIENT_SMALL * H) / W));
  // Cover the small canvas with a little to spare, so the blur has picture to work with at the edges too.
  const pad = 4,
    s = Math.max((small.width + 2 * pad) / img.naturalWidth, (small.height + 2 * pad) / img.naturalHeight),
    w = img.naturalWidth * s,
    h = img.naturalHeight * s,
    sctx = small.getContext('2d');
  sctx.filter = 'blur(2px) saturate(1.2)';
  sctx.drawImage(img, (small.width - w) / 2, (small.height - h) / 2, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = `blur(${Math.round(W / AMBIENT_SMALL)}px)`;
  const m = W / 8; // spare at the edges again, for the second blur
  ctx.drawImage(small, -m, -m * (H / W), W + 2 * m, H + 2 * m * (H / W));
  ctx.filter = 'none';
}
addEventListener('resize', () => {
  if (isConcert()) paintAmbient();
});
let concertKey = '';
function drawConcert() {
  if (!isConcert()) return;
  const hd = concertHeader(),
    m = mediaTrack() ? { ...mediaTrack(), art_url: mediaTrack().art_url || hd?.art_url || '' } : hd,
    full = concertFullTrack();
  const q = $('#npQuality').classList.contains('hidden') ? '' : $('#npQuality').textContent;
  const key = JSON.stringify([m, q, concertNext()?.title || '', concertDetails]);
  if (key !== concertKey) {
    concertKey = key;
    const art = m?.art_url || '';
    concertEl.classList.toggle('idle', !m);
    $('#concertTitle').textContent = m ? m.title : 'Flou Player';
    $('#concertArtist').textContent = m ? m.artist : 'Nothing is playing';
    $('#concertAlbum').textContent = m ? [m.album, (full?.date || '').slice(0, 4)].filter(Boolean).join(' · ') : '';
    $('#concertCover').style.backgroundImage = art ? `url("${cssUrl(art)}")` : '';
    setAmbient(art);
    $('#concertCover').classList.toggle('nocover', !art);
    const grade = concertGrade(q);
    $('#concertQuality').classList.toggle('hidden', !q);
    $('#concertGrade').textContent = grade;
    $('#concertGrade').classList.toggle('hidden', !grade);
    $('#concertFormat').textContent = concertFormat(q);
    const extra =
      concertDetails && full
        ? [full.genre, full.track_number && `Track ${full.track_number}`].filter(Boolean).join(' · ')
        : '';
    $('#concertExtra').textContent = extra;
    $('#concertExtra').classList.toggle('hidden', !extra);
    $('#concertDetails').setAttribute('aria-pressed', String(concertDetails));
    const n = concertNext();
    $('#concertNext').classList.toggle('hidden', !n);
    if (n) $('#concertNextText').textContent = [n.title, n.artist].filter(Boolean).join(' — ');
    $('#concertDevice').textContent = $('#renderer').selectedOptions[0]?.textContent || '';
  }
  // The volume as the header shows it: the device's step in big type, the dB it works out to beside it.
  const step = $('#volumeLabel .volstep')?.textContent || '',
    db = $('#volumeLabel .voldb')?.textContent || '';
  const mutedNow = $('#muteBtn').getAttribute('aria-pressed') === 'true' && !$('#muteBtn').classList.contains('hidden');
  $('#concertVol').classList.toggle('hidden', !step);
  $('#concertVolStep').textContent = mutedNow ? 'Muted' : step;
  $('#concertVolDb').textContent = mutedNow ? '' : db;
  const pos = curPos();
  $('#concertPos').textContent = prog.dur || pos ? fmtClock(pos) : '';
  $('#concertRem').textContent = prog.dur ? '-' + fmtClock(prog.dur - pos) : '';
  const pct = prog.dur ? Math.min(100, (pos / prog.dur) * 100) : 0;
  $('#concertBar').style.transform = `translateX(${(pct - 100).toFixed(2)}%)`;
  concertEl.classList.toggle('paused', !isPlayingNow());
}
// Ticks once a second, only while concert mode is open and the window is shown.
let concertTimer = null;
function concertTick() {
  clearTimeout(concertTimer);
  concertTimer = null;
  if (!isConcert() || document.hidden) return;
  drawConcert();
  concertTimer = setTimeout(concertTick, 1000);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) concertTick();
});

// The pointer and the controls fade away after a few seconds, so nothing but the music stays on the TV.
function concertWake() {
  concertEl.classList.remove('calm');
  clearTimeout(concertIdleTimer);
  concertIdleTimer = setTimeout(() => concertEl.classList.add('calm'), 4000);
}
function setConcert(on = !isConcert()) {
  if (on === isConcert()) return;
  concertEl.classList.toggle('hidden', !on);
  document.activeElement?.blur?.(); // Space must play/pause, not press a button that still has the focus
  if (on) {
    concertKey = '';
    concertTick();
    concertWake();
    concertEl.requestFullscreen?.().catch(() => {}); // best effort: the app window may not allow it
  } else {
    clearTimeout(concertIdleTimer);
    clearTimeout(concertTimer);
    concertTimer = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  try {
    localStorage.setItem('concert', on ? '1' : '');
  } catch (e) {}
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && isConcert()) setConcert(false);
});
concertEl.addEventListener('mousemove', concertWake);
concertEl.addEventListener('pointerdown', concertWake);
$('#concertDetails').onclick = () => {
  concertDetails = !concertDetails;
  try {
    localStorage.setItem('concert_details', concertDetails ? '1' : '');
  } catch (e) {}
  drawConcert();
};
$('#concertClose').onclick = () => setConcert(false);
$('#concertBtn').onclick = () => setConcert(true);
$('#concertPrev').onclick = () => btnFor('previous').click();
$('#concertPlay').onclick = () => togglePlayPause();
$('#concertNextBtn').onclick = () => btnFor('next').click();
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isConcert() && $('#lightbox').classList.contains('hidden')) setConcert(false);
  else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    setConcert();
  }
  if (isConcert()) concertWake();
});
