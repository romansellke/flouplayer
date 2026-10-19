// Library health: checks on the scanned (cached) library for incomplete or inconsistent tags --
// Album Artist without Artist (or the other way round), missing covers, years, track numbers, ...
// analyzeLibrary() is a pure function over the track list; the rest draws the Health view (opened with the header icon).

// Compare names ignoring case, accents, a leading "The" and punctuation: "The Beatles" ~ "beatles".
const nameKey=s=>(s||'').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/^the\s+/,'').replace(/[^\p{L}\p{N}]+/gu,'');

const HEALTH_CHECKS=[
  // id, title, severity ('warn' = probably wrong, 'info' = good to know), what it means
  ['aa_no_artist','Album Artist, but Artist missing','warn','Tracks that have an Album Artist tag but no Artist tag.'],
  ['artist_no_aa','Artist, but Album Artist missing','info','Albums whose tracks have an Artist but no Album Artist tag at all.'],
  ['no_artist','Neither Artist nor Album Artist','warn','Albums with no artist information in any track.'],
  ['no_album','Album title missing','warn','Tracks without an album title (shown as "Unknown Album").'],
  ['no_cover','No cover art','warn','Albums where no track has cover art.'],
  ['partial_cover','Cover art on some tracks only','warn','Albums where only some tracks have cover art.'],
  ['track_numbers','Track numbers missing, duplicated or with gaps','warn','Albums whose track numbers are incomplete or repeat.'],
  ['dup_titles','Same title twice in one album','warn','Possible duplicate files.'],
  ['split_aa','Same album with and without Album Artist','warn','The album exists twice: some tracks have an Album Artist tag, others do not.'],
  ['variant_names','Names that differ only by spelling','warn','For example "The Beatles" and "Beatles", or different capitalisation.'],
  ['mixed_quality','Lossless and lossy tracks mixed','warn','Albums that contain both lossless and lossy files.'],
  ['no_year','Year missing','info','Albums where no track has a year.'],
  ['mixed_year','Different years within one album','info','Tracks of one album that carry different years.'],
  ['no_genre','Genre missing','info','Albums where no track has a genre.'],
  ['single_track','Only one track','info','Albums with a single track (singles, or an incomplete album?).'],
  ['no_tech_info','No format information','info','Tracks for which the server reports neither sample rate nor bit depth.'],
];

function analyzeLibrary(tracks){
  const groups=new Map();                               // albums, told apart by title AND Album Artist (see albumKey)
  for(const t of tracks){ const k=albumKey(t); if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(t) }
  const found=Object.fromEntries(HEALTH_CHECKS.map(c=>[c[0],[]]));
  const item=(ts,note,extra={})=>({album:ts[0].album||'',albumArtist:ts[0].album_artist||'',artist:[...new Set(ts.map(t=>t.artist).filter(Boolean))].join(', '),
    tracks:ts.length,note,search:ts[0].album||ts[0].album_artist||ts[0].artist||'',...extra});
  const count=(ts,f)=>ts.filter(f).length;
  for(const ts of groups.values()){
    const n=ts.length, add=(id,note)=>found[id].push(item(ts,note));
    const noArtist=count(ts,t=>t.album_artist&&!t.artist);
    if(noArtist) add('aa_no_artist',`${noArtist} of ${n} track${n>1?'s':''} without Artist`);
    if(ts.every(t=>!t.album_artist)&&ts.some(t=>t.artist)) add('artist_no_aa','');
    if(ts.every(t=>!t.album_artist&&!t.artist)) add('no_artist','');
    if(!ts[0].album) add('no_album',`${n} track${n>1?'s':''}`);
    const covers=count(ts,t=>t.album_art);
    if(!covers) add('no_cover',''); else if(covers<n) add('partial_cover',`${n-covers} of ${n} tracks without`);
    if(n>1){
      const nums=ts.map(t=>parseInt(t.track_number)||0), valid=nums.filter(x=>x>0), problems=[];
      if(valid.length<n) problems.push(`${n-valid.length} without number`);
      const dups=[...new Set(valid.filter((x,i)=>valid.indexOf(x)!==i))].sort((a,b)=>a-b);
      if(dups.length) problems.push(`repeated: ${dups.join(', ')}`);
      const uniq=[...new Set(valid)].sort((a,b)=>a-b), gaps=[];
      for(let i=1;i<(uniq[uniq.length-1]||0);i++) if(!uniq.includes(i)) gaps.push(i);
      if(gaps.length) problems.push(`missing: ${gaps.length>6?gaps.slice(0,6).join(', ')+' ...':gaps.join(', ')}`);
      if(problems.length) add('track_numbers',problems.join('; '));
      const titles=ts.map(t=>nameKey(t.title)), dupT=[...new Set(titles.filter((x,i)=>x&&titles.indexOf(x)!==i))];
      if(dupT.length) add('dup_titles',dupT.map(k=>ts.find(t=>nameKey(t.title)===k).title).join(', '));
    }
    const q=new Set(ts.map(t=>t.quality));
    if(q.has('lossy')&&(q.has('cd')||q.has('hires'))) add('mixed_quality',`${count(ts,t=>t.quality==='lossy')} lossy, ${count(ts,t=>t.quality==='cd'||t.quality==='hires')} lossless`);
    if(ts.every(t=>!t.year)) add('no_year','');
    else{ const years=[...new Set(ts.map(t=>t.year).filter(Boolean))].sort(); if(years.length>1) add('mixed_year',years.join(', ')) }
    if(ts.every(t=>!t.genre)) add('no_genre','');
    if(n===1) add('single_track','');
    const noTech=count(ts,t=>!t.quality);
    if(noTech) add('no_tech_info',`${noTech} of ${n} track${n>1?'s':''}`);
  }
  // the same album title with and without Album Artist, where an artist appears in both
  const byTitle=new Map();
  for(const ts of groups.values()){ if(!ts[0].album) continue; const k=nameKey(ts[0].album); if(!byTitle.has(k)) byTitle.set(k,[]); byTitle.get(k).push(ts) }
  for(const list of byTitle.values()){
    const bare=list.filter(ts=>!ts[0].album_artist), tagged=list.filter(ts=>ts[0].album_artist);
    for(const b of bare){
      const arts=new Set(b.map(t=>t.artist).filter(Boolean));
      const twin=tagged.find(ts=>ts.some(t=>arts.has(t.artist)||[...arts].some(x=>nameKey(x)===nameKey(t.album_artist))));
      if(twin) found.split_aa.push(item(b,`also exists with Album Artist "${twin[0].album_artist}"`));
    }
  }
  // artist names that are the same apart from spelling
  for(const field of ['album_artist','artist']){
    const names=new Map();
    for(const t of tracks){ const v=t[field]; if(!v) continue; const k=nameKey(v); if(!k) continue; if(!names.has(k)) names.set(k,new Set()); names.get(k).add(v) }
    for(const set of names.values()) if(set.size>1){ const list=[...set].sort();
      found.variant_names.push({album:'',albumArtist:field==='album_artist'?list.join('  |  '):'',artist:field==='artist'?list.join('  |  '):'',tracks:tracks.filter(t=>set.has(t[field])).length,note:field==='album_artist'?'Album Artist spellings':'Artist spellings',search:list[0]}) }
  }
  const sortItems=l=>l.sort((a,b)=>(a.albumArtist||a.artist).localeCompare(b.albumArtist||b.artist,undefined,{sensitivity:'base'})||a.album.localeCompare(b.album,undefined,{sensitivity:'base'}));
  return {albums:groups.size,tracks:tracks.length,
    checks:HEALTH_CHECKS.map(([id,title,severity,help])=>({id,title,severity,help,items:sortItems(found[id])}))};
}

// ---------- The Health view ----------
let health=null, healthSel='aa_no_artist';
function healthText(check){
  return [`${check.title} (${check.items.length})`,...check.items.map(i=>[i.albumArtist,i.artist,i.album,i.note].join('\t'))].join('\n');
}
function renderHealth(){
  const have=state.tracks.length>0, body=$('#healthBody'), empty=$('#healthEmpty');
  empty.classList.toggle('hidden',have); body.classList.toggle('hidden',!have);
  $('#healthCopy').disabled=!have; $('#healthRerun').disabled=!have;
  if(!have){ $('#healthInfo').textContent=''; health=null; return }
  health=analyzeLibrary(state.tracks);
  const warn=health.checks.filter(c=>c.severity==='warn'&&c.items.length).length;
  $('#healthInfo').textContent=`${health.albums} albums · ${health.tracks} tracks · ${warn?`${warn} check${warn>1?'s':''} with findings`:'no problems found'}`;
  $('#healthChecks').innerHTML=health.checks.map(c=>`<button type="button" class="hcheck ${c.id===healthSel?'active':''}" data-check="${c.id}" title="${esc(c.help)}">
      <span class="hdot ${c.items.length?c.severity:'ok'}"></span><span class="hname">${esc(c.title)}</span><span class="hcount">${c.items.length||'✓'}</span></button>`).join('');
  drawHealthDetail();
}
function drawHealthDetail(){
  const c=health?.checks.find(x=>x.id===healthSel); if(!c) return;
  const LIMIT=500, rows=c.items.slice(0,LIMIT);
  $('#healthDetail').innerHTML=`<h4>${esc(c.title)}</h4><p class="hhelp">${esc(c.help)}</p>`+(c.items.length?
    `<table class="htable"><thead><tr><th>Album Artist</th><th>Artist</th><th>Album</th><th>Tracks</th><th>Detail</th></tr></thead><tbody>${rows.map((i,n)=>
      `<tr data-row="${n}" class="clickable" title="Show in the library"><td>${esc(i.albumArtist)}</td><td>${esc(i.artist)}</td><td>${esc(i.album)}</td><td class="num">${i.tracks}</td><td>${esc(i.note)}</td></tr>`).join('')}</tbody></table>`
    +(c.items.length>LIMIT?`<p class="hhelp">Showing the first ${LIMIT} of ${c.items.length}. "Copy list" copies all of them.</p>`:'')
    :'<p class="hok">Nothing found.</p>');
}
$('#healthChecks').addEventListener('click',e=>{
  const b=e.target.closest('[data-check]'); if(!b) return;
  healthSel=b.dataset.check;
  document.querySelectorAll('#healthChecks .hcheck').forEach(x=>x.classList.toggle('active',x===b));
  drawHealthDetail();
});
function showInLibrary(item){
  if(isLive()) setLibMode('cached');
  $('#search').value=item.search; state.filters={album_artist:'',artist:'',album:'',year:''};
  showTab('library'); render();
}
$('#healthDetail').addEventListener('click',e=>{
  const tr=e.target.closest('tr[data-row]'); if(!tr) return;
  const c=health?.checks.find(x=>x.id===healthSel); const item=c?.items[+tr.dataset.row]; if(item) showInLibrary(item);
});
$('#healthRerun').onclick=renderHealth;
$('#healthCopy').onclick=async()=>{
  const c=health?.checks.find(x=>x.id===healthSel); if(!c) return;
  showToast(await copyText(healthText(c))?`Copied ${c.items.length} row${c.items.length===1?'':'s'}`:'Could not copy');
};
$('#healthGoCached').onclick=()=>{ setLibMode('cached'); showTab('library') };
