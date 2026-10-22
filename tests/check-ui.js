/* Audio Metadati Manager — playback / mini player UI test.
 *
 * Drives a real Google Chrome through the DevTools Protocol (no npm dependency)
 * against the app served by tests/run-ui.sh on a temporary library.
 *
 * The single <audio> element created by the app is captured from the outside,
 * by wrapping window.Audio before any page script runs: the application code is
 * not modified and not instrumented.
 *
 *   node tests/check-ui.js http://127.0.0.1:8799/
 *
 * Environment:
 *   AMM_CHROME            path of the Chrome binary
 *   AMM_CHROME_PROFILE    temporary profile directory
 *   AMM_CDP_PORT          DevTools port (default 9337)
 *   AMM_FIXTURE_DIR       library directory, used to simulate a broken file
 *
 * Exits non-zero on the first failing expectation or on any console error.
 */
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.AMM_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profileDir = process.env.AMM_CHROME_PROFILE || ('/tmp/amm-chrome-' + process.pid);
// Fixed by default, overridable: a leftover Chrome on the port would break the run.
const PORT = parseInt(process.env.AMM_CDP_PORT || '9337', 10);
const FIXTURE_DIR = process.env.AMM_FIXTURE_DIR || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p },
    (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(d)); }).on('error', rej));

async function waitFor(fn, tries = 60, delay = 250) {
    for (let i = 0; i < tries; i++) {
        try { const r = await fn(); if (r) return r; } catch (e) { /* retry */ }
        await sleep(delay);
    }
    return null;
}

(async () => {
    const url = process.argv[2];
    const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: 'ignore' });

    const v = await waitFor(async () => JSON.parse(await get('/json/version')).webSocketDebuggerUrl);
    if (!v) { console.log('FAIL: chrome did not start'); chrome.kill(); process.exit(1); }

    const WS = require('./ws_min.js');
    const ws = new WS(v);
    await ws.ready;
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.onmessage = (raw) => {
        const m = JSON.parse(raw);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else events.push(m);
    };
    const send = (method, params, sessionId) => new Promise((r) => {
        const i = ++id; pending.set(i, r);
        ws.send(JSON.stringify({ id: i, method, params: params || {}, sessionId }));
    });

    const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
    const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    await send('Log.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);
    await send('DOM.enable', {}, sessionId);
    // Capture the <audio> object created by the app without touching app code.
    await send('Page.addScriptToEvaluateOnNewDocument', { source:
        "window.__ammAudio=[];const _A=window.Audio;window.Audio=function(...a){const e=new _A(...a);window.__ammAudio.push(e);return e;};" }, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Page.navigate', { url }, sessionId);
    await sleep(3200);

    const ev = async (expr) => {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
        if (r.result && r.result.exceptionDetails) {
            throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
        }
        return r.result.result.value;
    };

    /* ---------------------------------------------------------------
       Part 1 — desktop, playback from the track and album buttons
       --------------------------------------------------------------- */
    const out = await ev(`(async()=>{
  const res=[];const push=(n,ok,x)=>res.push({n,ok,extra:x||''});
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const A=()=>window.__ammAudio[0];
  const title=()=>$('#miniTitle').textContent;
  const anim=()=>{const b=$('#miniEq > span');return b?getComputedStyle(b).animationName:'no-bars';};
  const isPlaying=()=>$('#miniPlayer').classList.contains('is-playing');

  /* ---- the bottom player must be gone ---- */
  push('no bottom player in the DOM', !$('#audioPlayerPanel') && !$('.audio-player-panel'));
  push('no bottom player controls in the DOM', !$('#playerPlayPause') && !$('#playerProgress') && !$('#playerVolume'));
  // The fixed player used to reserve 110px (100px on phones) at the bottom of
  // the page: only the normal Bootstrap padding must be left.
  const pad = parseFloat(getComputedStyle($('.app-main')).paddingBottom);
  push('no space reserved for a fixed player', pad < 40, 'padding-bottom='+pad+'px');
  push('exactly one audio element', window.__ammAudio.length===1, 'count='+window.__ammAudio.length);

  /* ---- library loaded ---- */
  push('artist tree rendered', $$('#artistTree .artist-row').length>0, $$('#artistTree .artist-row').length+' artists');
  push('no album card before the artist is expanded', $$('#artistTree .album-card').length===0);

  // expand every artist, then the first album of the first artist
  $$('#artistTree .artist-row').forEach(r=>r.click()); await sleep(900);
  push('album cards rendered', $$('#artistTree .album-card').length>0, $$('#artistTree .album-card').length+' albums');
  push('album play buttons rendered', $$('#artistTree .album-play-btn').length>0, $$('#artistTree .album-play-btn').length+' buttons');
  push('album play buttons have an accessible name',
       $$('#artistTree .album-play-btn').every(b=>(b.getAttribute('aria-label')||'').length>5));
  push('album play buttons enabled (albums are not empty)',
       $$('#artistTree .album-play-btn').every(b=>!b.disabled));

  // The reference album is the one with the most tracks: the test must not
  // depend on the names of the fixture, so it also runs on a real library.
  const albumInfo = () => $$('#artistTree .album-card').map(c => {
      const btn = c.querySelector('.album-play-btn');
      if (!btn) return null;
      const block = $$('#artistTree .album-tracks').find(b => b.dataset.album === btn.dataset.album);
      const titles = block ? [...block.querySelectorAll('.tv-title')].map(e => e.textContent.trim()) : [];
      // The track count is on the card, so the album can be chosen BEFORE it
      // is expanded (the blocks are materialised lazily).
      const countEl = c.querySelector('.album-count');
      const count = countEl ? (parseInt(countEl.textContent, 10) || 0) : titles.length;
      return { card: c, btn: btn, block: block, titles: titles, count: count,
               name: btn.dataset.label, key: btn.dataset.album };
  }).filter(Boolean);
  const pickAlbum = () => albumInfo().filter(a => a.count >= 2)
      .sort((a, b) => b.count - a.count)[0];
  const oneCard = pickAlbum();
  push('an album with several tracks is present', !!oneCard, oneCard ? oneCard.name + ' (' + oneCard.count + ' tracks)' : '');
  oneCard.card.querySelector('[data-action="toggle-album"]').click(); await sleep(900);
  const oneBlock = $$('#artistTree .album-tracks').find(b => b.dataset.album === oneCard.key);
  const rows = oneBlock ? [...oneBlock.querySelectorAll('tbody tr')] : [];
  oneCard.titles = rows.map(r => r.querySelector('.tv-title').textContent.trim());
  push('album track rows rendered', rows.length >= 2, rows.length + ' rows');
  push('track play buttons in the album blocks', $$('#artistTree .tv-play-btn').length>0, $$('#artistTree .tv-play-btn').length+' buttons');
  push('track play buttons have an accessible name',
       $$('#artistTree .tv-play-btn').every(b=>(b.getAttribute('aria-label')||'').length>5));

  /* ---- play a single track from the album block ---- */
  const second = rows[1];
  const secondTitle = second.querySelector('.tv-title').textContent.trim();
  const detailsBefore = $('#detailsPanel').textContent;
  second.querySelector('.tv-play-btn').click(); await sleep(1500);
  push('track play starts the right track', title()===secondTitle, title()+' (expected '+secondTitle+')');
  push('the audio element is really playing', A().paused===false);
  push('the mini player animates', isPlaying() && anim()!=='none', 'anim='+anim());
  push('the playing row is highlighted', second.classList.contains('is-playing'), second.className);
  push('the play button becomes a pause button', second.querySelector('.tv-play-btn i').className.includes('pause-fill'));
  push('the details panel is NOT opened by the play click', $('#detailsPanel').textContent===detailsBefore);

  /* ---- next / previous stay inside the album ---- */
  const beforeNext=title();
  $('#miniNextBtn').click(); await sleep(1300);
  const afterNext=title();
  push('next moves to the following track', afterNext!==beforeNext, beforeNext+' -> '+afterNext);
  $('#miniPrevBtn').click(); await sleep(1300);
  push('previous goes back', title()===beforeNext, beforeNext+' -> '+title());

  /* ---- play an album from its play button ---- */
  const albumBtn = oneCard.btn;
  const albumName = oneCard.name;
  albumBtn.click(); await sleep(1500);
  const albumFirst=title();
  const albumTitles = oneCard.titles;
  push('album play starts the FIRST track of that album', albumFirst===albumTitles[0],
       albumName+' -> '+albumFirst+' | first='+albumTitles[0]);
  push('the album play button becomes a pause button', albumBtn.querySelector('i').className.includes('pause-fill'));
  push('the album has tracks to walk through', albumTitles.length>0, albumTitles.join(' | '));

  // next must follow the album order, and wrap INSIDE the album
  const seen=[albumFirst];
  for (let i=0;i<Math.max(1,albumTitles.length);i++){ $('#miniNextBtn').click(); await sleep(1200); seen.push(title()); }
  push('next/previous stay inside the album', seen.every(t=>albumTitles.includes(t)),
       'sequence='+seen.join(' > ')+' | album='+albumTitles.join(' > '));
  const expectedOrder = albumTitles.map((_,i)=>albumTitles[(i+1)%albumTitles.length]);
  push('the album sequence follows the album order',
       seen[0]===albumTitles[0] && seen[1]===expectedOrder[0] && seen[2]===expectedOrder[1],
       seen.slice(0,3).join(' > ')+' | album='+albumTitles.join(' > '));

  /* ---- play another track while one is playing ---- */
  $('#miniPlayPauseBtn').click(); await sleep(500);       // pause
  const other = [...oneBlock.querySelectorAll('.tv-play-btn')][0];
  const otherTitle = other.closest('tr').querySelector('.tv-title').textContent.trim();
  other.click(); await sleep(1500);
  push('another track can be started while one is loaded', title()===otherTitle, title()+' (expected '+otherTitle+')');
  push('no second audio element was created', window.__ammAudio.length===1, 'count='+window.__ammAudio.length);
  push('the previous track is not playing any more', A().src.includes(encodeURIComponent(other.closest('tr').dataset.trackRow)));

  /* ---- pause and resume from the header ---- */
  $('#miniPlayPauseBtn').click(); await sleep(600);
  push('pause from the header stops the audio', A().paused===true);
  push('pause stops the animation', !isPlaying() && anim()==='none');
  $('#miniPlayPauseBtn').click(); await sleep(800);
  push('resume from the header restarts the audio', A().paused===false);
  push('resume restarts the animation', isPlaying());

  /* ---- end of a track advances to the next one ---- */
  const beforeEnd=title();
  A().dispatchEvent(new Event('ended')); await sleep(1500);
  push('the end of a track advances to the next one', title()!==beforeEnd, beforeEnd+' -> '+title());

  /* ---- flat list view ---- */
  $('#viewTracksBtn').click(); await sleep(800);
  push('flat list play buttons', $$('#tracksBody .btn-play-row').length>0, $$('#tracksBody .btn-play-row').length+' buttons');
  // Pick a row that is NOT the one already playing: pressing the play button
  // of the current track pauses it (checked separately below).
  const currentPath = decodeURIComponent((A().src.match(/path=([^&]*)/)||[])[1]||'');
  const fr = $$('#tracksBody .track-row').find(r => r.dataset.path !== currentPath);
  const ft = fr.querySelector('.track-title').textContent.trim();
  fr.querySelector('.btn-play-row').click(); await sleep(1500);
  push('flat list play starts the right track', title()===ft, title()+' (expected '+ft+')');
  push('the flat row is highlighted', fr.classList.contains('is-playing'), fr.className);
  push('the flat play button becomes a pause button', fr.querySelector('.btn-play-row i').className.includes('pause-fill'));

  // pressing the play button of the track that is playing pauses it
  const cur = $$('#tracksBody .track-row').find(r => r.classList.contains('is-playing'));
  cur.querySelector('.btn-play-row').click(); await sleep(900);
  push('the play button of the playing track pauses it', A().paused===true && !cur.classList.contains('is-playing'));
  cur.querySelector('.btn-play-row').click(); await sleep(900);
  push('pressing it again resumes it', A().paused===false && cur.classList.contains('is-playing'));
  // the flat list row click must still open the details panel
  fr.click(); await sleep(800);
  push('the row still opens the details panel', $('#detailsPanel').textContent.trim().length>0);
  // the checkbox must still work
  const cb = $$('#tracksBody .select-track')[0];
  cb.click(); await sleep(400);
  push('the selection checkbox still works', $('#resultInfo').textContent.indexOf('results')>0, $('#resultInfo').textContent);
  $('#viewArtistsBtn').click(); await sleep(600);

  /* ---- look and feel of the mini player (header) ---- */
  const mp=$('#miniPlayer'), eq=$('#miniEq'), meta=mp.querySelector('.mini-meta'),
        miniTitle=mp.querySelector('.mini-title'), artist=mp.querySelector('.mini-artist'),
        ctl=mp.querySelector('.mini-controls'), playBtn=mp.querySelector('.mini-btn-play'),
        nextBtn=mp.querySelectorAll('.mini-btn')[2];
  const mpCs=e=>getComputedStyle(e), mpR=e=>e.getBoundingClientRect();
  const mpGap=(a,b)=>Math.round(mpR(b).left-mpR(a).right);
  const mpCenter=e=>Math.round(mpR(e).top+mpR(e).height/2);

  push('the mini player has a visible border', mpCs(mp).borderTopWidth==='1px' && mpCs(mp).borderTopStyle==='solid',
       mpCs(mp).borderTopWidth+' '+mpCs(mp).borderTopStyle);
  // the border must use the same discreet token as the other components:
  // resolved through a probe element, so it does not depend on the selection
  // state of an album card
  const probe=document.createElement('div');
  probe.style.borderTopColor='var(--border)';
  probe.style.borderTopWidth='1px';
  document.body.appendChild(probe);
  const themeBorder=mpCs(probe).borderTopColor;
  probe.remove();
  push('the border uses the discreet theme token', mpCs(mp).borderTopColor===themeBorder,
       'mini='+mpCs(mp).borderTopColor+' --border='+themeBorder);
  push('the border is not the accent colour', mpCs(mp).borderTopColor!==mpCs(document.documentElement).getPropertyValue('--gold').trim());
  push('the radius is slightly rounded', (()=>{ const v=parseFloat(mpCs(mp).borderTopLeftRadius); return v>0 && v<=8; })(),
       mpCs(mp).borderTopLeftRadius);
  const padT=parseFloat(mpCs(mp).paddingTop), padX=parseFloat(mpCs(mp).paddingRight);
  push('the padding is compact', padT<=5 && padX<=10, 'v='+padT+' h='+padX);
  push('the mini player is a small component, not a big card', mpR(mp).height<=46, 'h='+Math.round(mpR(mp).height));
  push('the equalizer is close to the title', mpGap(eq,miniTitle)<=8, mpGap(eq,miniTitle)+'px');
  push('the title is close to the controls', mpGap(meta,ctl)<=8, mpGap(meta,ctl)+'px');
  push('the buttons keep an easy gap', mpGap(playBtn,nextBtn)>=4, mpGap(playBtn,nextBtn)+'px');
  push('equalizer, title and controls are vertically aligned',
       Math.abs(mpCenter(eq)-mpCenter(meta))<=2 && Math.abs(mpCenter(ctl)-mpCenter(meta))<=2,
       'eq='+mpCenter(eq)+' meta='+mpCenter(meta)+' ctl='+mpCenter(ctl));
  push('the title keeps the ellipsis', mpCs(miniTitle).textOverflow==='ellipsis' && mpCs(miniTitle).whiteSpace==='nowrap');
  push('the artist keeps the ellipsis', mpCs(artist).textOverflow==='ellipsis' && mpCs(artist).whiteSpace==='nowrap');
  push('the title and the artist are not collapsed', mpR(miniTitle).width>0 && mpR(artist).width>0,
       'title='+Math.round(mpR(miniTitle).width)+' artist='+Math.round(mpR(artist).width));

  /* ---- long title ---- */
  const long='Titolo incredibilmente lungo che non deve mai far crescere la larghezza del pannello';
  const wShort=$('#miniPlayer').getBoundingClientRect().width;
  $('#miniTitle').textContent=long; $('#miniTitle').title=long; await sleep(300);
  const wLong=$('#miniPlayer').getBoundingClientRect().width;
  push('the mini player width is stable with a long title', Math.abs(wLong-wShort)<1, wShort+' -> '+wLong);
  const cs=getComputedStyle($('#miniTitle'));
  push('the title is clipped with an ellipsis', cs.textOverflow==='ellipsis' && cs.whiteSpace==='nowrap');
  push('the header does not overflow horizontally',
       document.querySelector('.app-header').scrollWidth<=document.querySelector('.app-header').clientWidth+1);

  return res;
})()`);

    console.log('');
    let fails = 0;
    for (const r of out) { if (!r.ok) fails++; console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.extra ? '  [' + r.extra + ']' : ''}`); }

    /* ---------------------------------------------------------------
       Part 1b — the album header owns the whole cover operation
       --------------------------------------------------------------- */
    const coverFile = path.join(require('os').tmpdir(), 'ui-album-upload.jpg');
    fs.writeFileSync(coverFile, Buffer.from(
        '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==',
        'base64'));

    const albumCoverBefore = await ev(`(async()=>{
  const res=[];const push=(n,ok,x)=>res.push({n,ok,extra:x||''});
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  $('#viewArtistsBtn').click(); await sleep(600);
  if($$('#artistTree .album-card').length===0){ $$('#artistTree .artist-row').forEach(r=>r.click()); await sleep(800); }
  const cards=$$('#artistTree .album-card');
  const coverBtns=$$('#artistTree [data-action="choose-album-cover"]');
  push('every album header has a cover button', cards.length>0 && coverBtns.length===cards.length,
       coverBtns.length+' / '+cards.length);
  push('album cover buttons are labelled "Scegli copertina"',
       coverBtns.every(b=>/scegli copertina/i.test(b.textContent) && (b.getAttribute('aria-label')||'').length>5));
  const card=cards.find(c=>{const l=c.querySelector('.album-play-btn');return l && l.dataset.label==='Album One';})
      || cards.slice().sort((a,b)=>(parseInt(b.querySelector('.album-count').textContent,10)||0)-(parseInt(a.querySelector('.album-count').textContent,10)||0))[0];
  const key=card.dataset.albumCard;
  const toggle=card.querySelector('[data-action="toggle-album"]');
  if(toggle.getAttribute('aria-expanded')!=='true'){ toggle.click(); await sleep(700); }
  const block=$$('#artistTree .album-tracks').find(b=>b.dataset.album===key);
  const paths=block ? [...block.querySelectorAll('tbody tr')].map(r=>r.dataset.trackRow) : [];
  const expandedBefore=toggle.getAttribute('aria-expanded');
  const btn=card.querySelector('[data-action="choose-album-cover"]');
  btn.click(); await sleep(700);
  push('the album cover button opens the shared dialog', $('#coverModal').classList.contains('show'));
  push('the album cover button does not collapse the album',
       toggle.getAttribute('aria-expanded')===expandedBefore);
  push('the dialog names the whole album scope',
       new RegExp('all '+paths.length+' tracks', 'i').test($('#coverModalBody').textContent),
       $('#coverModalBody').textContent.trim().slice(0,120));
  const names=$$('#coverModalBody .cover-option .name').map(e=>e.textContent.trim());
  push('the album selector does not offer the embedded cover', !names.includes('Embedded (current)'));
  push('the album selector does not offer Remove Cover', !names.includes('Remove Cover'));
  push('an album without JPEGs shows the upload hint', /No JPEG found/i.test($('#coverModalBody').textContent));

  $('#viewTracksBtn').click(); await sleep(500);
  const row=$$('#tracksBody .track-row')[0];
  if(row){ row.click(); await sleep(600); }
  push('track details no longer offer cover selection', !$('#detailsPanel [data-action="open-cover"]'));
  push('track details no longer have a cover button', !$('#detailsPanel .cover-change-btn'));
  $('#viewArtistsBtn').click(); await sleep(600);
  if($$('#artistTree .album-card').length===0){ $$('#artistTree .artist-row').forEach(r=>r.click()); await sleep(800); }
  const cardAgain=$$('#artistTree .album-card').find(c=>c.dataset.albumCard===key);
  if(cardAgain){ cardAgain.querySelector('[data-action="choose-album-cover"]').click(); await sleep(600); }
  return {checks:res,key:key,paths:paths};
})()`);

    let coverChecks = 0;
    for (const r of albumCoverBefore.checks) { if (!r.ok) fails++; console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.extra ? '  [' + r.extra + ']' : ''}`); }
    coverChecks += albumCoverBefore.checks.length;

    const coverDoc = await send('DOM.getDocument', {}, sessionId);
    const coverInput = await send('DOM.querySelector', {
        nodeId: coverDoc.result.root.nodeId,
        selector: '#coverUploadInput'
    }, sessionId);
    if (coverInput.result && coverInput.result.nodeId) {
        await send('DOM.setFileInputFiles', {
            nodeId: coverInput.result.nodeId,
            files: [coverFile]
        }, sessionId);
    } else {
        fails++;
        coverChecks++;
        console.log('  FAIL  the album dialog exposes a file input');
    }

    const albumCoverAfter = await ev(`(async()=>{
  const res=[];const push=(n,ok,x)=>res.push({n,ok,extra:x||''});
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let option=null;
  for(let i=0;i<60 && !option;i++){
    await sleep(250);
    option=$$('#coverModalBody .cover-option').find(o=>o.querySelector('.name') && o.querySelector('.name').textContent.trim()==='ui-album-upload.jpg');
  }
  push('the uploaded image appears in the album dialog', !!option);
  if(!option) return res;
  option.click(); await sleep(250);
  push('the uploaded image can be selected', option.classList.contains('selected'));
  $('#coverApplyBtn').click();
  let closed=false;
  for(let i=0;i<120 && !closed;i++){ await sleep(250); closed=!$('#coverModal').classList.contains('show'); }
  push('Apply closes the album dialog after saving', closed);
  await sleep(900);
  push('Apply leaves no unsaved album tracks',
       $$('#artistTree .tv-dirty').length===0, $$('#artistTree .tv-dirty').length+' dirty');
  const paths=${JSON.stringify(albumCoverBefore.paths)};
  const embedded=await Promise.all(paths.map(async p=>{
    const r=await fetch('api/cover.php?path='+encodeURIComponent(p)+'&embedded=1');
    return r.ok;
  }));
  push('the cover is embedded in every album track',
       paths.length>0 && embedded.every(Boolean), embedded.filter(Boolean).length+' / '+paths.length);
  const other=$$('#artistTree .album-card').find(c=>c.dataset.albumCard!==${JSON.stringify(albumCoverBefore.key)});
  const otherPath=other ? (()=>{const k=other.dataset.albumCard;const b=$$('#artistTree .album-tracks').find(x=>x.dataset.album===k);return b?b.querySelector('tbody tr')?.dataset.trackRow:null;})() : null;
  if(otherPath){
    const r=await fetch('api/cover.php?path='+encodeURIComponent(otherPath)+'&embedded=1');
    push('other albums are not touched by the album cover save', !r.ok);
  }
  const cardAgain=$$('#artistTree .album-card').find(c=>c.dataset.albumCard===${JSON.stringify(albumCoverBefore.key)});
  if(cardAgain){
    cardAgain.querySelector('[data-action="choose-album-cover"]').click(); await sleep(600);
    const names=$$('#coverModalBody .cover-option .name').map(e=>e.textContent.trim());
    push('reopening the dialog lists the new cover.jpeg', names.includes('cover.jpeg'), names.join(' | '));
    $('#coverModal .btn-close').click(); await sleep(500);
  }
  return res;
})()`);
    for (const r of albumCoverAfter) { if (!r.ok) fails++; console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.extra ? '  [' + r.extra + ']' : ''}`); }
    coverChecks += albumCoverAfter.length;

    if (albumCoverBefore.paths.length) {
        const albumDir = path.dirname(albumCoverBefore.paths[0]);
        const externalCover = path.join(albumDir, 'cover.jpeg');
        const uploadedCover = path.join(albumDir, 'ui-album-upload.jpg');
        const fileChecks = [
            ['the album save creates the external cover.jpeg', fs.existsSync(externalCover)],
            ['the external cover matches the selected image',
                fs.existsSync(externalCover) && fs.existsSync(uploadedCover)
                && fs.readFileSync(externalCover).equals(fs.readFileSync(uploadedCover))],
            ['the uploaded source image is preserved', fs.existsSync(uploadedCover)],
        ];
        for (const [name, ok] of fileChecks) { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); }
        coverChecks += fileChecks.length;
    }

    const bulkWithoutCover = await ev(`(async()=>{
  const res=[];const push=(n,ok,x)=>res.push({n,ok,extra:x||''});
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  $('#viewTracksBtn').click(); await sleep(600);
  $$('.select-track').slice(0,2).forEach(cb=>{ if(!cb.checked) cb.click(); });
  await sleep(200);
  $('#bulkBtn').click(); await sleep(600);
  push('bulk dialog still opens', $('#bulkModal').classList.contains('show'));
  push('bulk dialog no longer contains a cover picker', !$('#bulkCoverPickBtn'));
  push('bulk dialog no longer contains cover preview controls', !$('#bulkCoverPreview') && !$('#bulkCoverLabel'));
  push('bulk metadata fields are still available',
       !!$('#bulkAlbum') && !!$('#bulkArtist') && !!$('#bulkGenre') && !!$('#bulkYear'));
  const checked=$$('.select-track').find(cb=>cb.checked);
  const selectedPath=checked ? checked.dataset.path : null;
  $('#bulkGenre').value='BulkGenre';
  $('#bulkApplyBtn').click();
  let closed=false;
  for(let i=0;i<100 && !closed;i++){ await sleep(250); closed=!$('#bulkModal').classList.contains('show'); }
  push('bulk metadata save still closes the dialog', closed);
  if(selectedPath){
    const meta=await (await fetch('api/metadata.php?path='+encodeURIComponent(selectedPath))).json();
    push('bulk metadata save still updates the selected tracks',
         !!meta && meta.success && meta.track && meta.track.genre==='BulkGenre',
         meta && meta.track ? meta.track.genre : 'no metadata');
  }
  $('#viewArtistsBtn').click(); await sleep(500);
  return res;
})()`);
    let bulkChecks = 0;
    for (const r of bulkWithoutCover) { if (!r.ok) fails++; console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.extra ? '  [' + r.extra + ']' : ''}`); }
    bulkChecks += bulkWithoutCover.length;

    try { fs.unlinkSync(coverFile); } catch (e) { /* best effort */ }

    /* ---------------------------------------------------------------
       Part 2 — a track whose file is not available any more
       --------------------------------------------------------------- */
    if (FIXTURE_DIR) {
        // A track that has not been used by the playback checks above, so the
        // media cache cannot satisfy the request after the file is removed.
        const broken = path.join(FIXTURE_DIR, 'music1', 'Rock', 'Album Two', '01.mp3');
        if (fs.existsSync(broken)) {
            fs.unlinkSync(broken);
            const brokenRes = await ev(`(async()=>{
  const res=[];const push=(n,ok,x)=>res.push({n,ok,extra:x||''});
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  $('#viewTracksBtn').click(); await sleep(600);
  const btn = $$('#tracksBody .btn-play-row').find(b=>b.dataset.path && b.dataset.path.endsWith('Album Two/01.mp3'));
  if(!btn){
      push('the broken track is still listed in the view', false,
           $$('#tracksBody .btn-play-row').map(b=>b.dataset.path).join(' | ') || 'no play buttons');
      $('#viewArtistsBtn').click(); await sleep(600);
      return res;
  }
  push('the broken track is still listed in the view', true, btn.dataset.path);
  const before = document.querySelectorAll('#toastContainer .toast').length;
  btn.click();
  let after = before;
  for (let i = 0; i < 20 && after <= before; i++) {
      await sleep(250);
      after = document.querySelectorAll('#toastContainer .toast').length;
  }
  push('a missing file does not break the interface', $('#miniPlayer')!==null && $('#miniTitle').textContent.length>0);
  push('a missing file is reported to the user', after>before, 'toasts='+after);
  push('the animation is stopped after the error', !$('#miniPlayer').classList.contains('is-playing'));
  push('the player stays usable after the error', !$('#miniPlayPauseBtn').disabled);
  $('#viewArtistsBtn').click(); await sleep(600);
  return res;
})()`);
            for (const r of brokenRes) { if (!r.ok) fails++; console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.extra ? '  [' + r.extra + ']' : ''}`); }
        }
    }

    /* ---------------------------------------------------------------
       Part 3 — mobile layout at 375 px
       --------------------------------------------------------------- */
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 720, deviceScaleFactor: 2, mobile: false }, sessionId);
    await sleep(900);
    const mob = await ev(`(async()=>{
  const res=[];const push=(n,ok,x)=>res.push({n,ok,extra:x||''});
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const h=$('.app-header'), mp=$('#miniPlayer');
  const rect=e=>e.getBoundingClientRect();
  const vOverlap=(a,b)=>!(a.bottom<=b.top||b.bottom<=a.top);
  push('mobile: no bottom player', !$('#audioPlayerPanel') && !$('.audio-player-panel'));
  push('mobile: the mini player is visible', rect(mp).width>100 && rect(mp).height>0, 'w='+Math.round(rect(mp).width));
  push('mobile: the header does not scroll horizontally', h.scrollWidth<=h.clientWidth+1, 'scrollW='+h.scrollWidth);
  push('mobile: the header is at most two rows', rect(h).height<140, 'h='+Math.round(rect(h).height));
  // On a phone the mini player takes its own row: the title needs the room.
  push('mobile: the mini player is on its own row, below the brand',
       rect(mp).top>=rect($('.navbar-brand')).bottom-1 || rect(mp).left>=rect($('.navbar-brand')).right,
       'miniTop='+Math.round(rect(mp).top)+' brandBottom='+Math.round(rect($('.navbar-brand')).bottom));
  push('mobile: the album play button is reachable', rect($('#artistTree .album-play-btn')).width>=20);
  push('mobile: the track play button is reachable', rect($('#artistTree .tv-play-btn')).width>=20);
  push('mobile: the header height is published to the CSS variable',
       getComputedStyle(document.documentElement).getPropertyValue('--app-header-h').trim()===Math.round(rect(h).height)+'px');
  push('mobile: the title is still visible', $('#miniTitle').textContent.trim().length>0, $('#miniTitle').textContent);
  push('mobile: the title still has room for the ellipsis', rect($('#miniTitle')).width>=24,
       'titleW='+Math.round(rect($('#miniTitle')).width));
  push('mobile: the border is still discreet', getComputedStyle($('#miniPlayer')).borderTopWidth==='1px');
  push('mobile: the controls do not overlap the title',
       rect($('#miniTitle')).right <= rect($('#miniPlayer .mini-controls')).left+1,
       'titleRight='+Math.round(rect($('#miniTitle')).right)+' ctlLeft='+Math.round(rect($('#miniPlayer .mini-controls')).left));
  push('mobile: the player does not overlap the brand',
       rect(mp).left >= rect($('.navbar-brand')).right-1 || rect(mp).top >= rect($('.navbar-brand')).bottom-1,
       'miniLeft='+Math.round(rect(mp).left)+' brandRight='+Math.round(rect($('.navbar-brand')).right));
  return res;
})()`);
    for (const r of mob) { if (!r.ok) fails++; console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.extra ? '  [' + r.extra + ']' : ''}`); }

    // The "broken file" scenario deletes a track on purpose: the 404 of that
    // request is expected and is not a JavaScript error.
    const expected404 = FIXTURE_DIR ? encodeURIComponent(path.join(FIXTURE_DIR, 'music1', 'Rock', 'Album Two', '01.mp3')) : '';
    const errs = events.filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
        .filter((e) => !(expected404 && (e.params.entry.url || '').includes(expected404)))
        .map((e) => e.params.entry.url ? e.params.entry.text + ' <- ' + e.params.entry.url : e.params.entry.text);
    console.log(`\n  console errors: ${errs.length}`);
    errs.slice(0, 6).forEach((e) => console.log('    ' + e));
    console.log(`\n  UI checks: ${out.length + coverChecks + bulkChecks + mob.length}, failed: ${fails}`);
    ws.close(); chrome.kill();
    process.exit(fails || errs.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR', e); process.exit(2); });
