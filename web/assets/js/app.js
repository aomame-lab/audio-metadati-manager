/* ============================================================
   Audio Metadati Manager — Frontend
   Vanilla JS + Fetch + Bootstrap 5
   ============================================================ */

(() => {
    'use strict';

    /* ---------- State ---------- */
    const state = {
        libraryPath: '',
        roots: [],               // authorized mounts [{id,label,path,primary,available}]
        folders: [],             // registered music folders (persisted server side)
        tracks: [],
        pending: new Map(),      // path -> { field: value, cover?: path|'__remove__' }
        selected: new Set(),
        currentPath: null,
        searchQuery: '',
        filterFormat: 'all',
        filterStatus: 'all',
        busy: false,
        viewMode: 'artists',        // 'artists' (Artist->Album->Track) | 'tracks' (flat list)
        expandedArtists: new Set(), // artist keys currently expanded
        expandedAlbums: new Set(),  // album keys currently expanded
        totals: { artists: 0, albums: 0 }, // computed on the WHOLE library, not on filters
    };

    /* ---------- Music folders dialog state ---------- */
    const foldersState = {
        root: '',        // selected root id
        rel: '',         // current relative path inside that root
        target: null,    // directory the user is about to add {name, rel}
        loading: false,  // guards against double clicks while a request is running
    };

    /* ---------- Audio Player State ---------- */
    const playerState = {
        audio: null,
        currentIndex: -1,
        playlist: [],          // navigation sequence walked by Next/Previous
        sequenceKind: 'library',   // 'library' (visible list) | 'album'
        sequenceId: '',            // key of the album, when the sequence is an album
        isPlaying: false,
        volume: 1,
        muted: false,
    };

    let coverContext = null;   // { type:'single', path } | { type:'bulk', paths:[] }
    let coverChoice = null;    // path | '__remove__' | null
    let bulkDraft = null;      // { cover: path, name: string } — copertina scelta nella finestra multipla, non ancora salvata

    /* ---------- Helpers ---------- */
    const $ = (sel, root = document) => root.querySelector(sel);

    const esc = (value) => {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    const basename = (p) => String(p || '').split(/[\\/]/).pop();
    const dirnameOf = (p) => {
        const s = String(p || '');
        const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
        return i >= 0 ? s.slice(0, i) : '';
    };

    function commonFolderForPaths(paths) {
        const folders = new Set();
        for (const path of paths) {
            const track = findTrack(path);
            if (!track) return null;
            folders.add(dirnameOf(track.path));
        }
        return paths.length > 0 && folders.size === 1 ? [...folders][0] : null;
    }

    function formatDuration(sec) {
        const s = Math.round(Number(sec) || 0);
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${m}:${String(r).padStart(2, '0')}`;
    }

    function isBusy() {
        return state.busy;
    }

    /* ---------- Header height ----------
       The toolbar is sticky right below the header, and the header wraps to
       1, 2 or 3 rows depending on the width. The real height is published to
       a CSS variable instead of being hardcoded in two magic numbers.
       ResizeObserver is event driven: there is no polling here. */
    function syncHeaderHeight() {
        const header = document.querySelector('.app-header');
        if (!header) return;
        const apply = () => {
            const height = Math.round(header.getBoundingClientRect().height);
            if (height > 0) {
                document.documentElement.style.setProperty('--app-header-h', height + 'px');
            }
        };
        apply();
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(apply).observe(header);
        } else {
            window.addEventListener('resize', apply);
        }
    }

    /* ---------- Audio Player ----------
       The engine: ONE <audio> element and one playerState, shared by the
       header mini player and by the play buttons of the tracks and of the
       albums. The fixed player at the bottom of the page has been removed:
       the header mini player is the only playback interface. */
    function initPlayer() {
        const audio = new Audio();
        audio.preload = 'metadata';
        audio.volume = playerState.volume;
        playerState.audio = audio;

        audio.addEventListener('ended', () => {
            playNext();
        });
        audio.addEventListener('play', () => {
            playerState.isPlaying = true;
            updatePlaybackUi();
        });
        audio.addEventListener('pause', () => {
            playerState.isPlaying = false;
            updatePlaybackUi();
        });
        audio.addEventListener('error', (e) => {
            console.error('Audio error:', e);
            toast('Playback error', 'error');
            playerState.isPlaying = false;
            updatePlaybackUi();
        });

        // Mini player (header): same audio element, same handlers, no polling.
        $('#miniPlayPauseBtn').addEventListener('click', togglePlayPause);
        $('#miniNextBtn').addEventListener('click', playNext);
        $('#miniPrevBtn').addEventListener('click', playPrev);
        updateMiniPlayerMeta(null);
        updatePlaybackUi();
    }

    /* ---------- Playback sequence ----------
       playerState.playlist is the sequence Next/Previous walk through. It is
       rebuilt every time a track is started, so it always matches the context
       the user started from:
         - 'library': the tracks visible in the active view, in view order;
         - 'album':   the tracks of one album, in album order.
       The identifier of the album is kept in sequenceId, so the album button
       can show the pause state while its own album is playing. */

    function buildPlaylistFromVisible(startIndex = 0) {
        const list = visibleTracks();
        playerState.playlist = list.map(t => t.path);
        playerState.sequenceKind = 'library';
        playerState.sequenceId = '';
        playerState.currentIndex = Math.max(0, Math.min(startIndex, playerState.playlist.length - 1));
    }

    function buildPlaylistFromAlbum(tracks, albumId) {
        playerState.playlist = tracks.map(t => t.path);
        playerState.sequenceKind = 'album';
        playerState.sequenceId = albumId || '';
        playerState.currentIndex = 0;
    }

    /** Tracks of an album in album order (track number, then file name). */
    function albumTracksInOrder(album) {
        return sortTracks(album.tracks);
    }

    function loadTrack(index) {
        if (index < 0 || index >= playerState.playlist.length) return;
        const path = playerState.playlist[index];
        const track = findTrack(path);
        if (!track) return;

        playerState.currentIndex = index;
        const audio = playerState.audio;
        const src = `api/audio.php?path=${encodeURIComponent(path)}`;
        audio.src = src;
        audio.load();

        updateMiniPlayerMeta(track);
        updatePlaybackUi();
    }

    function playTrack(index) {
        loadTrack(index);
        playerState.audio.play().catch(() => {
            // play() can be refused (policy, removed file): no "play" event will
            // arrive, so the state is forced back here instead of getting stuck.
            playerState.isPlaying = false;
            updatePlaybackUi();
        });
    }

    function togglePlayPause() {
        const audio = playerState.audio;
        if (!audio.src) {
            if (playerState.playlist.length === 0) {
                buildPlaylistFromVisible(0);
            }
            if (playerState.playlist.length > 0) {
                playTrack(playerState.currentIndex);
            }
            return;
        }
        if (playerState.isPlaying) {
            audio.pause();
        } else {
            audio.play().catch(() => {
                playerState.isPlaying = false;
                updatePlaybackUi();
            });
        }
    }

    function playNext() {
        if (playerState.playlist.length === 0) return;
        const next = (playerState.currentIndex + 1) % playerState.playlist.length;
        playTrack(next);
    }

    function playPrev() {
        if (playerState.playlist.length === 0) return;
        const prev = (playerState.currentIndex - 1 + playerState.playlist.length) % playerState.playlist.length;
        playTrack(prev);
    }


    /* ---------- Playback UI ----------
       One entry point for everything the playback touches: the header mini
       player, the play button of every track and the play button of every
       album. It is called from the real audio events (play, pause, ended,
       error), when a track is loaded and when the view is rendered. */
    function updatePlaybackUi() {
        updateMiniPlayerState();
        updateRowPlayButtons();
        updatePlayingHighlight();
    }

    /* ---------- Mini player (header) ----------
       It is a view of the SAME <audio> element and of the same playerState as
       the play buttons of the tracks and of the albums: no second player, no
       polling. Everything is driven by the real audio events already wired in
       initPlayer(). */
    const MINI_EMPTY_LABEL = 'Nessuna traccia in riproduzione';

    /** True when a track is loaded in the shared audio element. */
    function miniHasTrack() {
        const audio = playerState.audio;
        return !!(audio && audio.src && playerState.playlist.length > 0);
    }

    /** Title + artist of the loaded track (called when the track changes). */
    function updateMiniPlayerMeta(track) {
        const titleEl = $('#miniTitle');
        const artistEl = $('#miniArtist');
        if (!titleEl || !artistEl) return;

        if (!track) {
            titleEl.textContent = MINI_EMPTY_LABEL;
            titleEl.title = MINI_EMPTY_LABEL;
            titleEl.classList.add('is-empty');
            artistEl.textContent = '';
            artistEl.title = '';
            return;
        }

        const m = mergedTrack(track);
        const title = m.title || track.filename || MINI_EMPTY_LABEL;
        const artist = (m.artist || '').trim();

        titleEl.textContent = title;
        titleEl.title = title;            // full text on hover for long titles
        titleEl.classList.toggle('is-empty', !m.title && !track.filename);
        artistEl.textContent = artist;
        artistEl.title = artist;
    }

    /**
     * Disabled states + animation. Called from updatePlaybackUi(), i.e. on the
     * real play/pause/ended/error events, and whenever the visible list
     * changes (renderView) so "Play" follows the current filters.
     */
    function updateMiniPlayerState() {
        const root = $('#miniPlayer');
        if (!root) return;

        const hasTrack = miniHasTrack();
        const canStart = hasTrack || visibleTracks().length > 0;

        // With nothing loaded Play can still start the first visible track
        // (togglePlayPause already does that), while Prev/Next need a playlist.
        $('#miniPlayPauseBtn').disabled = !canStart;
        $('#miniPrevBtn').disabled = !hasTrack;
        $('#miniNextBtn').disabled = !hasTrack;

        root.classList.toggle('is-playing', hasTrack && playerState.isPlaying);

        const playBtn = $('#miniPlayPauseBtn');
        const icon = playBtn.querySelector('i');
        if (playerState.isPlaying) {
            icon.className = 'bi bi-pause-fill';
            playBtn.setAttribute('aria-label', 'Pausa');
            playBtn.title = 'Pausa';
        } else {
            icon.className = 'bi bi-play-fill';
            playBtn.setAttribute('aria-label', 'Riproduci');
            playBtn.title = 'Riproduci';
        }
    }

    /**
     * Start a single track.
     *
     * The navigation sequence follows the context of the button that was
     * pressed: a track inside an album block keeps the sequence inside that
     * album, a track of the flat list keeps the sequence of the visible
     * library. In both cases Next/Previous stay meaningful.
     */
    function playTrackByPath(path, albumId) {
        const album = albumId ? findAlbum(albumId) : null;
        if (album && album.tracks.length) {
            const ordered = albumTracksInOrder(album);
            const idx = ordered.findIndex((t) => t.path === path);
            if (idx >= 0) {
                buildPlaylistFromAlbum(ordered, album.key);
                playTrack(idx);
                return;
            }
        }

        const list = visibleTracks();
        const idx = list.findIndex((t) => t.path === path);
        if (idx < 0) {
            toast('This track is not available', 'warning');
            return;
        }
        buildPlaylistFromVisible(idx);
        playTrack(idx);
    }

    /**
     * Play button of a track: pressing it while that very track is playing
     * pauses it, like every other player.
     */
    function toggleTrack(path, albumId) {
        if (currentPlayingPath() === path && playerState.isPlaying) {
            playerState.audio.pause();
            return;
        }
        playTrackByPath(path, albumId);
    }

    /**
     * Play button of an album: starts the FIRST track of the album and keeps
     * the sequence inside the album, so Next/Previous walk through it in
     * album order. Pressing it again restarts the album from its first track.
     */
    function playAlbum(albumId) {
        const album = findAlbum(albumId);
        if (!album || !album.tracks.length) {
            toast('This album has no tracks', 'warning');
            return;
        }
        const ordered = albumTracksInOrder(album);
        buildPlaylistFromAlbum(ordered, album.key);
        playTrack(0);
    }

    /** Path of the file currently loaded in the shared audio element. */
    function currentPlayingPath() {
        const audio = playerState.audio;
        if (!audio || !audio.src) return null;
        const match = audio.src.match(/[?&]path=([^&]*)/);
        return match ? decodeURIComponent(match[1]) : null;
    }

    function isBusy() {
        return state.busy;
    }

    function setBusy(on, text = 'Working...', sub = '') {
        state.busy = on;
        const overlay = $('#loadingOverlay');
        if (on) {
            $('#loadingText').textContent = text;
            $('#loadingSub').textContent = sub || '';
            overlay.classList.remove('d-none');
        } else {
            overlay.classList.add('d-none');
        }
        ['reloadBtn', 'bulkBtn', 'selectAllBtn', 'deselectAllBtn', 'foldersBtn'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.disabled = on;
        });
    }

    /* ---------- Toast ---------- */
    function toast(message, type = 'info', title = 'Audio Metadati Manager') {
        const container = $('#toastContainer');
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.setAttribute('role', 'status');
        const icon = type === 'success' ? 'check-circle-fill'
            : type === 'error' ? 'x-circle-fill'
            : type === 'warning' ? 'exclamation-triangle-fill' : 'info-circle-fill';
        el.innerHTML = `
            <div class="toast-header">
                <i class="bi bi-${icon} me-2 ${type === 'success' ? 'text-success' : type === 'error' ? 'text-danger' : 'text-warning'}"></i>
                <strong class="me-auto">${esc(title)}</strong>
                <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">${esc(message)}</div>`;
        container.appendChild(el);
        const instance = new bootstrap.Toast(el, { delay: type === 'error' ? 6000 : 3500 });
        el.addEventListener('hidden.bs.toast', () => el.remove());
        instance.show();
    }

    /* ---------- Confirm modal ---------- */
    function confirmDialog(text) {
        return new Promise((resolve) => {
            $('#confirmText').textContent = text;
            const modalEl = $('#confirmModal');
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            const onOk = () => {
                $('#confirmOkBtn').removeEventListener('click', onOk);
                modal.hide();
                resolve(true);
            };
            modalEl.addEventListener('hidden.bs.modal', () => {
                $('#confirmOkBtn').removeEventListener('click', onOk);
            }, { once: true });
            $('#confirmOkBtn').addEventListener('click', onOk);
            modal.show();
        });
    }

    /* ---------- API ---------- */
    async function api(path, options = {}) {
        const res = await fetch(path, options);
        let data = null;
        try {
            data = await res.json();
        } catch (err) {
            throw new Error(`Invalid server response (HTTP ${res.status})`);
        }
        // tolerateFailure: la risposta può riportare success:false con un elenco
        // di errori per singolo elemento (es. bulk-update parziale). In quel caso
        // l'errore va gestito dal chiamante, che conosce il dettaglio.
        const tolerateFailure = options.tolerateFailure === true;
        if (!res.ok || (data.success === false && !tolerateFailure)) {
            const err = new Error(data.error || data.detail || `Server error (HTTP ${res.status})`);
            err.detail = data.detail || '';
            err.status = res.status;
            throw err;
        }
        return data;
    }

    /* ---------- Data / merge ---------- */
    function findTrack(path) {
        return state.tracks.find((t) => t.path === path);
    }

    function pendingOf(path) {
        return state.pending.get(path) || {};
    }

    function mergedTrack(track) {
        const p = pendingOf(track.path);
        const trackNum = parseInt(String(track.tracknumber || '').split('/')[0], 10) || 0;
        return {
            ...track,
            title: p.title !== undefined ? p.title : (track.title || ''),
            artist: p.artist !== undefined ? p.artist : (track.artist || ''),
            album: p.album !== undefined ? p.album : (track.album || ''),
            album_artist: p.album_artist !== undefined ? p.album_artist : (track.album_artist || ''),
            genre: p.genre !== undefined ? p.genre : (track.genre || ''),
            year: p.year !== undefined ? p.year : (track.year || ''),
            tracknumber: p.track !== undefined ? String(p.track) : (trackNum ? String(trackNum) : ''),
            total: p.total !== undefined ? String(p.total) : String(track.total || 0),
            cover: p.cover !== undefined ? p.cover : (track.has_cover ? '__embedded__' : null),
        };
    }

    function effectiveCoverUrl(track) {
        const m = mergedTrack(track);
        const enc = encodeURIComponent;
        // Parametro di versione: dopo un salvataggio il brano ottiene una versione
        // maggiore, quindi il browser richiede la nuova immagine invece di riusare
        // quella in cache. Stesso meccanismo usato dal resto dell'app.
        const v = track.coverVersion ? `&v=${enc(track.coverVersion)}` : '';
        if (typeof m.cover === 'string' && m.cover && m.cover !== '__embedded__') {
            return `api/cover.php?path=${enc(m.cover)}${v}`;
        }
        if (m.cover === '__embedded__') {
            return `api/cover.php?path=${enc(track.path)}&embedded=1${v}`;
        }
        if (Array.isArray(track.covers) && track.covers.length) {
            return `api/cover.php?path=${enc(track.covers[0])}${v}`;
        }
        return null;
    }

    /* ---------- Filters / search ---------- */
    function visibleTracks() {
        let list = state.tracks;
        const q = state.searchQuery.trim().toLowerCase();
        if (q) {
            list = list.filter((t) => {
                const m = mergedTrack(t);
                const hay = [m.title, m.artist, m.album, t.filename, m.genre].join(' ').toLowerCase();
                return hay.includes(q);
            });
        }
        if (state.filterFormat !== 'all') {
            list = list.filter((t) => (t.extension || '').toLowerCase() === state.filterFormat);
        }
        if (state.filterStatus === 'unsaved') {
            list = list.filter((t) => state.pending.has(t.path));
        } else if (state.filterStatus === 'saved') {
            list = list.filter((t) => !state.pending.has(t.path));
        }
        return list;
    }

    /* ---------- Ricerca ---------- */
    // Unico punto di ingresso per la ricerca: allinea campo, stato, visibilita' della X
    // personalizzata e classe .has-clear (usata dal CSS per chiudere il gruppo a destra).
    function setSearchQuery(value, render = true) {
        const input = $('#searchInput');
        const clearBtn = $('#clearSearchBtn');
        const group = input ? input.closest('.input-group') : null;
        state.searchQuery = value;
        if (input && input.value !== value) input.value = value;
        if (clearBtn) clearBtn.classList.toggle('hidden', !value);
        if (group) group.classList.toggle('has-clear', !!value);
        if (render) renderView();
    }

    function updateCounts() {
        const list = visibleTracks();
        const label = `${list.length} of ${state.tracks.length} results`;
        $('#resultInfo').textContent = label;
        const treeInfo = $('#treeResultInfo');
        if (treeInfo) treeInfo.textContent = label;
        $('#libraryInfo').textContent = state.folders.length > 0
            ? `${state.folders.length} folder${state.folders.length === 1 ? '' : 's'}`
            : (state.libraryPath ? `Library: ${state.libraryPath}` : '');

        // Riepilogo unico: vive nel badge #trackCountBadge dell'header, non in una
        // seconda area separata. I conteggi artisti/albumi sono sempre quelli
        // dell'INTERA libreria (state.totals), i selezionati e le modifiche
        // pendenti dipendono dallo stato corrente.
        const stats = $('#libraryStats');
        if (!stats) return;
        if (state.tracks.length === 0) {
            stats.textContent = 'No library';
            return;
        }
        const nA = state.totals.artists;
        const nB = state.totals.albums;
        const nT = state.tracks.length;
        const parts = [
            `<span class="stat-strong">${nT}</span> track${nT === 1 ? '' : 's'}`,
            `<span class="stat-sep">·</span><span class="stat-strong">${nA}</span> artist${nA === 1 ? '' : 'i'}`,
            `<span class="stat-sep">·</span><span class="stat-strong">${nB}</span> album${nB === 1 ? '' : 'i'}`,
        ];
        if (state.selected.size > 0) {
            parts.push(`<span class="stat-sep">·</span><span class="stat-strong">${state.selected.size}</span> sel.`);
        }
        if (state.pending.size > 0) {
            parts.push(`<span class="stat-sep">·</span><span class="stat-dirty">${state.pending.size} unsaved</span>`);
        }
        stats.innerHTML = parts.join(' ');
    }

    /* ============================================================
       Library hierarchy — Artist -> Album -> Track
       Built once from the in-memory track list (no extra HTTP call:
       api/tracks.php already returns every metadata field at once).
       Children are rendered lazily: an artist only materialises its albums
       when expanded, and an album only its track table when expanded.
       ============================================================ */
    const UNKNOWN_ARTIST = 'Unknown artist';
    const UNKNOWN_ALBUM = 'Unknown album';
    const UNKNOWN_KEY = '__unknown__';
    let libraryModel = [];        // [{ key, name, unknown, albums:[...], tracks:[...] }]

    // Normalisation used for grouping AND for search: accent/case insensitive.
    function foldKey(value) {
        return String(value ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Display name for the artist of a track: album_artist wins over artist.
    function artistNameOf(track) {
        const m = mergedTrack(track);
        return (m.album_artist || '').trim() || (m.artist || '').trim();
    }

    function albumNameOf(track) {
        return (mergedTrack(track).album || '').trim();
    }

    function trackNoOf(track) {
        const n = parseInt(String(track.tracknumber || '').split('/')[0], 10);
        return Number.isFinite(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER;
    }

    function byName(a, b) {
        return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
    }

    function sortTracks(list) {
        return list.slice().sort((a, b) => {
            const na = trackNoOf(a);
            const nb = trackNoOf(b);
            if (na !== nb) return na - nb;
            return byName(a.filename || '', b.filename || '');
        });
    }

    // Composite album key. The artist length is prefixed so the join is unambiguous
// (artist "a b" + album "c" cannot collide with artist "a" + album "b c"), and the
// result is plain printable text: control characters are not valid in HTML
// attributes (a NUL would be turned into U+FFFD and break every lookup).
function albumKeyOf(artistKey, albumName) {
    const a = String(artistKey || '');
    return a.length + ':' + a + ':' + (foldKey(albumName) || UNKNOWN_KEY + 'album');
}

function buildLibraryModel() {
        const artists = new Map();
        const seen = new Set();          // guards against the same file appearing twice

        for (const track of visibleTracks()) {
            if (seen.has(track.path)) continue;
            seen.add(track.path);

            const artistName = artistNameOf(track);
            const artistKey = foldKey(artistName) || UNKNOWN_KEY + 'artist';
            let artist = artists.get(artistKey);
            if (!artist) {
                artist = { key: artistKey, name: artistName || UNKNOWN_ARTIST, unknown: !artistName, albums: new Map(), tracks: [] };
                artists.set(artistKey, artist);
            }
            artist.tracks.push(track);

            const albumName = albumNameOf(track);
            const albumKey = albumKeyOf(artistKey, albumName);
            let album = artist.albums.get(albumKey);
            if (!album) {
                album = { key: albumKey, name: albumName || UNKNOWN_ALBUM, unknown: !albumName, year: '', tracks: [] };
                artist.albums.set(albumKey, album);
            }
            album.tracks.push(track);

            const year = String(track.year || '').trim();
            if (!album.year && year) album.year = year;
        }

        const list = [...artists.values()].map((artist) => {
            const albums = [...artist.albums.values()].map((album) => {
                const tracks = sortTracks(album.tracks);
                // Representative cover: first track of the album that exposes one.
                const coverTrack = tracks.find((t) => effectiveCoverUrl(t)) || null;
                return { ...album, tracks, coverTrack, trackCount: tracks.length };
            });
            albums.sort((a, b) => {
                const ya = parseInt(a.year, 10) || 0;
                const yb = parseInt(b.year, 10) || 0;
                if (ya && yb && ya !== yb) return ya - yb;      // chronological
                if (ya && !yb) return -1;                       // dated albums first
                if (!ya && yb) return 1;
                return byName(a.name, b.name);
            });
            artist.tracks = sortTracks(artist.tracks);
            // Representative cover for the artist row: first album cover available.
            artist.coverTrack = albums.find((a) => a.coverTrack)?.coverTrack || null;
            return {
                key: artist.key,
                name: artist.name,
                unknown: artist.unknown,
                albums,
                tracks: artist.tracks,
                coverTrack: artist.coverTrack,
                albumCount: albums.length,
                trackCount: artist.tracks.length,
            };
        });

        list.sort((a, b) => {
            if (a.unknown !== b.unknown) return a.unknown ? 1 : -1;   // "Unknown artist" last
            return byName(a.name, b.name);
        });
        // Stable DOM ids: derived from the position, never from the metadata, because a
        // key may contain characters (':', quotes, spaces) that are illegal in a CSS
        // selector. Keys stay in data-* attributes, which are always safe.
        let albumSeq = 0;
        list.forEach((artist, i) => {
            artist.domId = 'ar-' + i;
            artist.albums.forEach((album) => { album.domId = 'al-' + (albumSeq++); });
        });
        return list;
    }

    /* ---------- Markup helpers (all values escaped) ---------- */
    function coverImgHtml(url, alt, cls) {
        if (!url) return `<i class="bi bi-music-note-beamed"></i>`;
        return `<img src="${esc(url)}" alt="${esc(alt || '')}" loading="lazy">`;
    }

    function highlight(text, query) {
        const safe = esc(text);
        const q = foldKey(query).trim();
        if (!q) return safe;
        // Escape first, then match on the escaped string using a plain index scan
        // on the folded form; matched substrings are wrapped.
        const folded = String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const idx = folded.indexOf(q);
        if (idx < 0) return safe;
        // Map folded index back to the original string (1:1 for the chars we keep).
        const before = String(text ?? '').slice(0, idx);
        const matchLen = String(text ?? '').slice(idx).normalize('NFD').replace(/[\u0300-\u036f]/g, '').length;
        const match = String(text ?? '').substr(idx, matchLen);
        return `${esc(before)}<mark class="tv-mark">${esc(match)}</mark>${esc(String(text ?? '').slice(idx + matchLen))}`;
    }

    function artistRowHtml(artist) {
        const cover = artist.coverTrack ? effectiveCoverUrl(artist.coverTrack) : null;
        const selN = artist.tracks.filter((t) => state.selected.has(t.path)).length;
        const cls = ['artist-node'];
        if (state.expandedArtists.has(artist.key)) cls.push('expanded');
        return `
            <div class="${cls.join(' ')}" data-artist-node="${esc(artist.key)}">
                <div class="artist-row" role="button" tabindex="0"
                     data-action="toggle-artist" data-artist="${esc(artist.key)}"
                     aria-expanded="${state.expandedArtists.has(artist.key)}"
                     aria-controls="${esc(artist.domId)}">
                    <span class="artist-chevron" aria-hidden="true"><i class="bi bi-chevron-right"></i></span>
                    <span class="artist-cover" aria-hidden="true">${coverImgHtml(cover, '')}</span>
                    <span class="artist-info">
                        <span class="artist-name ${artist.unknown ? 'is-unknown' : ''}" title="${esc(artist.name)}">${highlight(artist.name, state.searchQuery)}</span>
                        <span class="artist-meta">${artist.albumCount} album${artist.albumCount === 1 ? '' : 's'} · ${artist.trackCount} track${artist.trackCount === 1 ? '' : 's'}</span>
                    </span>
                    <span class="artist-stats" data-artist-stats="${esc(artist.key)}">${selN}/${artist.trackCount}</span>
                    <input type="checkbox" class="form-check-input artist-check" data-artist="${esc(artist.key)}"
                           aria-label="Select all tracks by ${esc(artist.name)}"
                           ${selN === artist.tracks.length && artist.trackCount > 0 ? 'checked' : ''}
                           ${selN > 0 && selN < artist.tracks.length ? 'data-indeterminate="1"' : ''}>
                </div>
                <div class="collapse artist-body" id="${esc(artist.domId)}" data-children-of="artist" data-artist="${esc(artist.key)}">
                    <div class="artist-body-grid"></div>
                </div>
            </div>`;
    }

    function albumCardHtml(album) {
        const cover = album.coverTrack ? effectiveCoverUrl(album.coverTrack) : null;
        const selN = album.tracks.filter((t) => state.selected.has(t.path)).length;
        const expanded = state.expandedAlbums.has(album.key);
        const year = album.year ? esc(album.year) : '<span class="text-faint">—</span>';
        const firstTrack = album.tracks[0];
        return `
            <div class="album-card ${selN ? 'has-selection' : ''}" data-album-card="${esc(album.key)}">
                <button type="button" class="album-cover-btn"
                        data-action="toggle-album" data-album="${esc(album.key)}"
                        aria-expanded="${expanded}" aria-controls="${esc(album.domId)}"
                        title="${esc(album.name)} — show tracks">
                    <span class="album-cover" aria-hidden="true">${coverImgHtml(cover, '')}</span>
                    <span class="album-play" aria-hidden="true"><i class="bi ${expanded ? 'bi-chevron-up' : 'bi-chevron-down'}"></i></span>
                    ${selN ? `<span class="album-cover-badge">${selN}</span>` : ''}
                </button>
                <div class="album-info">
                    <div class="album-title-row">
                        <span class="album-title ${album.unknown ? 'is-unknown' : ''}" title="${esc(album.name)}">${highlight(album.name, state.searchQuery)}</span>
                        <button type="button" class="album-play-btn" data-action="play-album" data-album="${esc(album.key)}"
                                data-label="${esc(album.name)}" aria-label="Riproduci album ${esc(album.name)}" title="Riproduci album"
                                ${album.tracks.length ? '' : 'disabled'}>
                            <i class="bi bi-play-fill"></i>
                        </button>
                    </div>
                    <span class="album-sub">
                        <span class="album-year">${year}</span>
                        <input type="checkbox" class="form-check-input album-check" data-album="${esc(album.key)}"
                               aria-label="Select all tracks of ${esc(album.name)}"
                               ${selN === album.trackCount && album.trackCount > 0 ? 'checked' : ''}
                               ${selN > 0 && selN < album.trackCount ? 'data-indeterminate="1"' : ''}>
                        <span class="album-count">${album.trackCount}</span>
                    </span>
                </div>
            </div>`;
    }

    // Blocco tracce: contenitore DEDICATO, fratello della card album nella griglia
    // dell'artista (non dentro la card, che e' larga ~148px, e non dentro
    // .artist-body-grid/.album-list). Espansione governata dall'attributo `hidden`,
    // quindi indipendente dal collapse Bootstrap dell'artista e degli altri album.
    function albumTracksHtml(album) {
        const expanded = state.expandedAlbums.has(album.key);
        return `
            <div class="album-tracks" id="${esc(album.domId)}" data-children-of="album" data-album="${esc(album.key)}"${expanded ? '' : ' hidden'}>
                <div class="album-tracks-head">
                    <i class="bi bi-music-note-list" aria-hidden="true"></i>
                    <span class="album-tracks-name ${album.unknown ? 'is-unknown' : ''}">${highlight(album.name, state.searchQuery)}</span>
                    <span class="album-tracks-count">${album.trackCount} track${album.trackCount === 1 ? '' : 's'}</span>
                </div>
                <div class="album-tracks-body"></div>
            </div>`;
    }

    function trackRowHtml(track, album) {
        const m = mergedTrack(track);
        const dirty = state.pending.has(track.path);
        const selected = state.selected.has(track.path);
        const title = m.title || track.filename;
        const num = trackNoOf(track) !== Number.MAX_SAFE_INTEGER ? String(trackNoOf(track)) : '';
        const fmt = String(track.extension || '').replace('.', '').toUpperCase();
        return `
            <tr class="${dirty ? 'tv-dirty' : ''} ${selected ? 'tv-selected' : ''}" data-track-row="${esc(track.path)}">
                <td class="tv-check-cell">
                    <input type="checkbox" class="form-check-input tv-check" data-path="${esc(track.path)}"
                           aria-label="Select ${esc(title)}" ${selected ? 'checked' : ''}>
                </td>
                <td class="tv-num">${esc(num)}</td>
                <td class="tv-title ${m.title ? '' : 'is-unknown'}">${highlight(title, state.searchQuery)}</td>
                <td class="tv-dur">${formatDuration(track.duration)}</td>
                <td class="tv-fmt">${fmt ? `<span class="tv-fmt-badge">${esc(fmt)}</span>` : ''}</td>
                <td class="tv-status">
                    <span class="tv-dot ${dirty ? 'is-dirty' : ''}" aria-hidden="true"></span>
                    <span class="tv-status-label">${dirty ? 'UNSAVED' : 'SAVED'}</span>
                </td>
                <td class="tv-actions">
                    <button type="button" class="tv-play-btn" data-action="play-track" data-path="${esc(track.path)}"
                            data-album="${album ? esc(album.key) : ''}" data-label="${esc(title)}"
                            aria-label="Riproduci ${esc(title)}" title="Riproduci">
                        <i class="bi bi-play-fill"></i>
                    </button>
                    <button type="button" class="tv-edit-btn" data-action="edit-track" data-path="${esc(track.path)}"
                            aria-label="Edit ${esc(title)}" title="Edit metadata">
                        <i class="bi bi-pencil"></i>
                    </button>
                </td>
            </tr>`;
    }

    function trackTableHtml(album) {
        return `
            <table class="track-list-compact">
                <caption class="visually-hidden">Tracks of ${esc(album.name)}</caption>
                <tbody>${album.tracks.map((t) => trackRowHtml(t, album)).join('')}</tbody>
            </table>`;
    }

    /* ---------- Lazy materialisation of children ---------- */
    function findArtist(key) {
        return libraryModel.find((a) => a.key === key) || null;
    }

    function findAlbum(key) {
        for (const artist of libraryModel) {
            const hit = artist.albums.find((a) => a.key === key);
            if (hit) return hit;
        }
        return null;
    }

    function ensureArtistChildren(el) {
        if (el.dataset.filled === '1') return;
        const artist = findArtist(el.dataset.artist);
        if (!artist) return;
        el.innerHTML = `<div class="artist-body-grid">${
            artist.albums.map((a) => albumCardHtml(a) + albumTracksHtml(a)).join('')
        }</div>`;
        el.dataset.filled = '1';
        syncIndeterminate(el);
    }

    function ensureAlbumTracks(el) {
        if (el.dataset.filled === '1') return;
        const album = findAlbum(el.dataset.album);
        if (!album) return;
        const body = el.querySelector('.album-tracks-body');
        if (body) body.innerHTML = trackTableHtml(album);
        el.dataset.filled = '1';
        syncIndeterminate(el);
        updatePlaybackUi();
    }

    // Mostra/nasconde il blocco tracce di un album. L'attributo `hidden` e' lo stato
    // visivo: nonDipende dal collapse dell'artista ne' da quello degli altri album.
    function setAlbumTracksVisible(el, visible) {
        if (!el) return;
        el.hidden = !visible;
        const btn = document.querySelector(`[data-action="toggle-album"][data-album="${cssEscape(el.dataset.album)}"]`);
        if (btn) btn.setAttribute('aria-expanded', String(visible));
        const icon = btn ? btn.querySelector('.album-play i') : null;
        if (icon) icon.className = 'bi ' + (visible ? 'bi-chevron-up' : 'bi-chevron-down');
    }

    // Reflect "partially selected" on group checkboxes after children are built.
    function syncIndeterminate(root) {
        root.querySelectorAll('input[data-indeterminate="1"]').forEach((cb) => { cb.indeterminate = true; });
    }

    /* ---------- Full render of the hierarchy ---------- */
    function renderArtistTree() {
        const host = $('#artistTree');
        if (!host) return;
        libraryModel = buildLibraryModel();

        if (state.tracks.length === 0) {
            host.innerHTML = `<div class="empty-state"><i class="bi bi-inbox"></i><p>No tracks found. Enter the library path and press SCAN.</p></div>`;
            return;
        }
        if (libraryModel.length === 0) {
            host.innerHTML = `<div class="empty-state"><i class="bi bi-search"></i><p>No results for the current search or filters.</p></div>`;
            return;
        }

        host.innerHTML = libraryModel.map(artistRowHtml).join('');
        // Restore (or force, when searching) the expansion state.
        if (state.searchQuery) {
            libraryModel.forEach((a) => state.expandedArtists.add(a.key));
            libraryModel.forEach((a) => a.albums.forEach((al) => state.expandedAlbums.add(al.key)));
        }
        libraryModel.forEach((artist) => {
            if (!state.expandedArtists.has(artist.key)) return;
            const el = host.querySelector(`[data-children-of="artist"][data-artist="${cssEscape(artist.key)}"]`);
            if (!el) return;
            ensureArtistChildren(el);
            bootstrap.Collapse.getOrCreateInstance(el).show();
            // Ripristina solo gli album che erano aperti: lo stato vive in
            // state.expandedAlbums e non viene toccato dal collapse dell'artista.
            artist.albums.forEach((album) => {
                if (!state.expandedAlbums.has(album.key)) return;
                const alEl = el.querySelector(`[data-children-of="album"][data-album="${cssEscape(album.key)}"]`);
                if (!alEl) return;
                ensureAlbumTracks(alEl);
                setAlbumTracksVisible(alEl, true);
            });
        });
        syncIndeterminate(host);
    }

    // Escape for use inside a QUOTED attribute selector value.
// Deliberately not CSS.escape: that escapes characters (spaces) that are
// perfectly legal inside quotes and would break the lookup.
    function cssEscape(value) {
        return String(value).replace(/["\\]/g, '\\$&');
    }



    /* ---------- Targeted updates (no full rebuild while typing) ---------- */
    function patchTrackNode(path) {
        const track = findTrack(path);
        if (!track) return;
        document.querySelectorAll(`[data-track-row="${cssEscape(path)}"]`).forEach((row) => {
            const dirty = state.pending.has(path);
            const selected = state.selected.has(path);
            row.classList.toggle('tv-dirty', dirty);
            row.classList.toggle('tv-selected', selected);
            const dot = row.querySelector('.tv-dot');
            const label = row.querySelector('.tv-status-label');
            if (dot) dot.classList.toggle('is-dirty', dirty);
            if (label) label.textContent = dirty ? 'UNSAVED' : 'SAVED';
            const cb = row.querySelector('.tv-check');
            if (cb) cb.checked = selected;
        });
    }

    function syncSelectionUi() {
        // Track checkboxes
        document.querySelectorAll('.tv-check').forEach((cb) => {
            cb.checked = state.selected.has(cb.dataset.path);
        });
        // Group checkboxes + counters
        const recount = (nodes, set) => {
            nodes.forEach((cb) => {
                const key = cb.dataset[set];
                const group = set === 'artist'
                    ? (findArtist(key)?.tracks || [])
                    : (findAlbum(key)?.tracks || []);
                const n = group.filter((t) => state.selected.has(t.path)).length;
                cb.checked = group.length > 0 && n === group.length;
                cb.indeterminate = n > 0 && n < group.length;
                const counter = document.querySelector(
                    set === 'artist' ? `[data-artist-stats="${cssEscape(key)}"]` : `[data-album-card="${cssEscape(key)}"] .album-cover-badge`
                );
                if (set === 'artist') {
                    if (counter) counter.textContent = `${n}/${group.length}`;
                } else if (counter) {
                    counter.textContent = String(n);
                    counter.style.display = n ? '' : 'none';
                }
                if (set === 'album') {
                    const card = document.querySelector(`[data-album-card="${cssEscape(key)}"]`);
                    if (card) card.classList.toggle('has-selection', n > 0);
                }
            });
        };
        recount(document.querySelectorAll('.artist-check'), 'artist');
        recount(document.querySelectorAll('.album-check'), 'album');
        // Flat list header checkbox
        const list = visibleTracks();
        const selVisible = list.filter((t) => state.selected.has(t.path)).length;
        const header = $('#selectAllCheckbox');
        if (header) {
            header.checked = list.length > 0 && selVisible === list.length;
            header.indeterminate = selVisible > 0 && selVisible < list.length;
        }
    }

    /* ---------- View switching ---------- */
    // Artists/albums totals over the whole library (filters must not change the header).
    function computeTotals() {
        const artists = new Set();
        const albums = new Set();
for (const t of state.tracks) {
            const a = foldKey(artistNameOf(t));
            artists.add(a || '');
            // An album group always exists (the tree falls back to "Unknown album"),
            // so it must be counted here too or the header would disagree with the tree.
            albums.add(albumKeyOf(a, albumNameOf(t)));
        }
        state.totals = { artists: artists.size, albums: albums.size };
    }

    // Single entry point: renders whichever view is active.
    function renderView() {
        syncViewUI();
        if (state.viewMode === 'artists') {
            renderArtistTree();
        } else {
            libraryModel = buildLibraryModel();
            renderTrackTable();
        }
        updateCounts();
        updatePlaybackUi();
    }

    function syncViewUI() {
        const isArtists = state.viewMode === 'artists';
        const aBtn = $('#viewArtistsBtn');
        const tBtn = $('#viewTracksBtn');
        if (aBtn) { aBtn.classList.toggle('active', isArtists); aBtn.setAttribute('aria-pressed', String(isArtists)); }
        if (tBtn) { tBtn.classList.toggle('active', !isArtists); tBtn.setAttribute('aria-pressed', String(!isArtists)); }
        const aPanel = $('#artistViewPanel');
        const tPanel = $('#trackViewPanel');
        if (aPanel) aPanel.hidden = !isArtists;
        if (tPanel) tPanel.hidden = isArtists;
    }

    /* ---------- Render table ---------- */
    function coverThumb(track) {
        const url = effectiveCoverUrl(track);
        if (url) {
            return `<div class="cover-thumb" aria-hidden="true"><img src="${esc(url)}" alt="" loading="lazy"></div>`;
        }
        return `<div class="cover-thumb" aria-hidden="true"><i class="bi bi-music-note"></i></div>`;
    }

    function statusBadge(track) {
        if (state.pending.has(track.path)) {
            return '<span class="badge badge-status badge-unsaved"><i class="bi bi-circle-fill me-1" style="font-size:0.5rem;"></i>UNSAVED</span>';
        }
        return '<span class="badge badge-status badge-saved"><i class="bi bi-check-circle me-1"></i>SAVED</span>';
    }

    function renderTrackTable() {
        const tbody = $('#tracksBody');
        const list = visibleTracks();
        if (state.tracks.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="12" class="text-center py-5">
                    <div class="empty-state"><i class="bi bi-inbox"></i><p>No tracks found. Enter the library path and press SCAN.</p></div>
                </td></tr>`;
            updateCounts();
            return;
        }
        if (list.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="12" class="text-center py-5">
                    <div class="empty-state"><i class="bi bi-search"></i><p>No results for the current search or filters.</p></div>
                </td></tr>`;
            updateCounts();
            return;
        }

        const visiblePaths = new Set(list.map((t) => t.path));
        const selectedVisible = [...visiblePaths].filter((p) => state.selected.has(p)).length;

        tbody.innerHTML = list.map((track) => {
            const m = mergedTrack(track);
            const isSelected = state.selected.has(track.path);
            const isCurrent = state.currentPath === track.path;
            const isDirty = state.pending.has(track.path);
            const isPlaying = playerState.isPlaying && playerState.audio && playerState.audio.src && playerState.audio.src.includes(encodeURIComponent(track.path));
            const cls = [
                'track-row',
                isSelected ? 'selected' : '',
                isCurrent ? 'selected' : '',
                isDirty ? 'dirty-row' : '',
            ].filter(Boolean).join(' ');
            return `
                <tr class="${cls}" data-path="${esc(track.path)}" aria-selected="${isSelected || isCurrent}">
                    <td class="col-check" onclick="event.stopPropagation()">
                        <input type="checkbox" class="form-check-input select-track" data-path="${esc(track.path)}" aria-label="Select ${esc(m.title || track.filename)}" ${isSelected ? 'checked' : ''}>
                    </td>
                    <td class="col-cover">${coverThumb(track)}</td>
                    <td class="col-play">
                        <button type="button" class="btn-play-row" data-path="${esc(track.path)}" data-label="${esc(m.title || track.filename)}"
                                aria-label="${isPlaying ? 'Pausa' : 'Riproduci'} ${esc(m.title || track.filename)}" title="${isPlaying ? 'Pausa' : 'Riproduci'}">
                            <i class="bi ${isPlaying ? 'bi-pause-fill' : 'bi-play-fill'}"></i>
                        </button>
                    </td>
                    <td class="col-num text-muted">${m.tracknumber || ''}</td>
                    <td><span class="track-title d-inline-block">${esc(m.title || track.filename)}</span></td>
                    <td><span class="track-meta d-inline-block">${esc(m.artist || '—')}</span></td>
                    <td class="d-none d-xl-table-cell"><span class="track-meta d-inline-block">${esc(m.album || '—')}</span></td>
                    <td class="d-none d-md-table-cell"><span class="track-meta d-inline-block">${esc(m.genre || '—')}</span></td>
                    <td class="d-none d-lg-table-cell text-muted">${esc(m.year || '')}</td>
                    <td class="d-none d-lg-table-cell text-muted">${formatDuration(track.duration)}</td>
                    <td><span class="filename-cell d-inline-block" title="${esc(track.filename)}">${esc(track.filename)}</span></td>
                    <td class="col-status">${statusBadge(track)}</td>
                </tr>`;
        }).join('');

        const headerCheck = $('#selectAllCheckbox');
        headerCheck.checked = list.length > 0 && selectedVisible === list.length;
        headerCheck.indeterminate = selectedVisible > 0 && selectedVisible < list.length;

        updateCounts();
    }

    /**
     * Play button of every track (flat list and album blocks) and of every
     * album: the icon and the accessible name follow the real playback state.
     */
    function updateRowPlayButtons() {
        const playingPath = playerState.isPlaying ? currentPlayingPath() : null;

        document.querySelectorAll('.btn-play-row, .tv-play-btn').forEach((btn) => {
            const path = btn.dataset.path;
            const isPlaying = !!path && path === playingPath;
            const icon = btn.querySelector('i');
            const name = btn.dataset.label || '';
            if (isPlaying) {
                icon.className = 'bi bi-pause-fill';
                btn.setAttribute('aria-label', 'Pausa ' + name);
                btn.title = 'Pausa';
            } else {
                icon.className = 'bi bi-play-fill';
                btn.setAttribute('aria-label', 'Riproduci ' + name);
                btn.title = 'Riproduci';
            }
        });

        document.querySelectorAll('.album-play-btn').forEach((btn) => {
            const isPlaying = playerState.isPlaying
                && playerState.sequenceKind === 'album'
                && playerState.sequenceId === btn.dataset.album;
            const icon = btn.querySelector('i');
            const name = btn.dataset.label || '';
            if (isPlaying) {
                icon.className = 'bi bi-pause-fill';
                btn.setAttribute('aria-label', 'Pausa album ' + name);
                btn.title = 'Pausa album';
            } else {
                icon.className = 'bi bi-play-fill';
                btn.setAttribute('aria-label', 'Riproduci album ' + name);
                btn.title = 'Riproduci album';
            }
        });
    }

    /**
     * Discreet highlight of the row of the track that is playing, in both
     * views (flat list and album blocks).
     */
    function updatePlayingHighlight() {
        const path = playerState.isPlaying ? currentPlayingPath() : null;
        document.querySelectorAll('.track-row, [data-track-row]').forEach((row) => {
            const rowPath = row.dataset.path || row.dataset.trackRow;
            row.classList.toggle('is-playing', !!path && rowPath === path);
        });
    }

    /* ---------- Selection ---------- */
    function afterSelectionChange() {
        if (state.viewMode === 'tracks') renderTrackTable();
        else syncSelectionUi();
        updateCounts();
        updateBulkBtn();
    }

    function toggleSelect(path) {
        if (state.selected.has(path)) state.selected.delete(path);
        else state.selected.add(path);
        afterSelectionChange();
        updateBulkBtn();
    }

    function selectAllVisible() {
        visibleTracks().forEach((t) => state.selected.add(t.path));
        renderView();
        updateBulkBtn();
    }

    function deselectAll() {
        state.selected.clear();
        renderView();
        updateBulkBtn();
    }

    function updateBulkBtn() {
        const n = state.selected.size;
        const btn = $('#bulkBtn');
        btn.innerHTML = n > 0
            ? `<i class="bi bi-pencil-square me-1"></i>Edit Selected <span class="badge bg-dark-subtle ms-1 badge-app-dark">${n}</span>`
            : '<i class="bi bi-pencil-square me-1"></i>Edit Selected';
        btn.classList.toggle('btn-gold', n > 0);
        btn.classList.toggle('btn-outline-secondary', n === 0);
        btn.disabled = isBusy();
    }

    /* ---------- Details ---------- */
    function isDesktop() {
        return window.matchMedia('(min-width: 992px)').matches;
    }

    function activeDetailsContainer() {
        return isDesktop()
            ? document.getElementById('detailsPanel')
            : document.getElementById('offcanvasDetailsBody');
    }

    function detailsCoverHtml(track) {
        const url = effectiveCoverUrl(track);
        const inner = url
            ? `<img src="${esc(url)}" alt="Cover of ${esc(track.title || track.filename)}">`
            : `<div class="cover-placeholder"><i class="bi bi-music-note-beamed"></i><span>NO COVER</span></div>`;
        return `
            <div class="details-cover" tabindex="0" role="button" aria-label="Open cover selection">
                ${inner}
                <button type="button" class="cover-change-btn" data-action="open-cover"><i class="bi bi-images me-1"></i>Select Cover</button>
            </div>`;
    }

    function buildDetailsForm(track) {
        const m = mergedTrack(track);
        const isDirty = state.pending.has(track.path);
        return `
            ${detailsCoverHtml(track)}
            <div class="row g-3">
                <div class="col-12">
                    <label class="form-label" for="dTitle-${esc(track.path)}">Title</label>
                    <input type="text" class="form-control" id="dTitle-${esc(track.path)}" data-field="title" value="${esc(m.title)}" autocomplete="off">
                </div>
                <div class="col-12">
                    <label class="form-label" for="dArtist-${esc(track.path)}">Artist</label>
                    <input type="text" class="form-control" id="dArtist-${esc(track.path)}" data-field="artist" value="${esc(m.artist)}" autocomplete="off">
                </div>
                <div class="col-12">
                    <label class="form-label" for="dAlbum-${esc(track.path)}">Album</label>
                    <input type="text" class="form-control" id="dAlbum-${esc(track.path)}" data-field="album" value="${esc(m.album)}" autocomplete="off">
                </div>
                <div class="col-6">
                    <label class="form-label" for="dTrack-${esc(track.path)}">Track #</label>
                    <input type="number" class="form-control" id="dTrack-${esc(track.path)}" data-field="track" value="${esc(m.tracknumber)}" min="1" inputmode="numeric">
                </div>
                <div class="col-12">
                    <label class="form-label" for="dGenre-${esc(track.path)}">Genre</label>
                    <input type="text" class="form-control" id="dGenre-${esc(track.path)}" data-field="genre" value="${esc(m.genre)}" autocomplete="off">
                </div>
                <div class="col-12">
                    <label class="form-label" for="dYear-${esc(track.path)}">Year</label>
                    <input type="number" class="form-control" id="dYear-${esc(track.path)}" data-field="year" value="${esc(m.year)}" min="1000" max="2100" inputmode="numeric">
                </div>
                <div class="col-12">
                    <label class="form-label">File</label>
                    <div class="detail-file">${esc(track.filename)}</div>
                </div>
                <div class="col-12 d-flex align-items-center justify-content-between gap-2 mt-1">
                    <span>${isDirty
                        ? '<span class="badge badge-status badge-unsaved">UNSAVED</span>'
                        : '<span class="badge badge-status badge-saved">SAVED</span>'}</span>
                    <span class="text-muted small"><i class="bi bi-clock me-1"></i>${formatDuration(track.duration)}</span>
                </div>
                <div class="col-12 d-grid gap-2">
                    <button type="button" class="btn btn-gold btn-save" data-action="save"><i class="bi bi-cloud-arrow-up me-1"></i>Save Changes</button>
                    <button type="button" class="btn btn-outline-secondary btn-reset ${isDirty ? '' : 'd-none'}" data-action="reset"><i class="bi bi-arrow-counterclockwise me-1"></i>Discard Changes</button>
                </div>
            </div>`;
    }

    function wireDetailsEvents(container, path) {
        container.querySelectorAll('[data-field]').forEach((input) => {
            input.addEventListener('input', () => {
                setPendingField(path, input.dataset.field, input.value);
            });
            input.addEventListener('change', () => {
                setPendingField(path, input.dataset.field, input.value);
            });
        });

        container.querySelector('[data-action="save"]').addEventListener('click', () => saveTracks([path]));

        const resetBtn = container.querySelector('[data-action="reset"]');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                state.pending.delete(path);
                renderView();
                refreshDetails(path);
                toast('Changes discarded', 'info');
            });
        }

        const coverBtn = container.querySelector('[data-action="open-cover"]');
        if (coverBtn) {
            coverBtn.addEventListener('click', (e) => {
                e.preventDefault();
                openCoverModal({ type: 'single', path });
            });
        }
        const coverBox = container.querySelector('.details-cover');
        if (coverBox) {
            coverBox.addEventListener('click', (e) => {
                if (e.target.closest('[data-action="open-cover"]')) return;
                openCoverModal({ type: 'single', path });
            });
        }
    }

    function showDetails(path, force) {
        if (state.currentPath === path && !force) return;
        state.currentPath = path;
        refreshDetails(path);
        if (!isDesktop()) {
            const oc = bootstrap.Offcanvas.getOrCreateInstance('#detailsOffcanvas');
            oc.show();
        } else {
            const oc = bootstrap.Offcanvas.getInstance('#detailsOffcanvas');
            if (oc) oc.hide();
        }
    }

    function refreshDetails(path) {
        const track = findTrack(path);
        if (!track) return;
        const container = activeDetailsContainer();
        container.innerHTML = buildDetailsForm(track);
        wireDetailsEvents(container, path);
    }

    function setPendingField(path, field, value) {
        const p = state.pending.get(path) || {};
        p[field] = value;
        state.pending.set(path, p);
        if (state.viewMode === 'tracks') renderTrackTable(); else patchTrackNode(path);
        updateCounts();   // keeps the header "unsaved" counter live in both views
        updateDetailsStatus(path);
    }

    function updateDetailsStatus(path) {
        const container = activeDetailsContainer();
        if (!container || state.currentPath !== path) return;
        const badge = container.querySelector('.d-flex .badge-status');
        if (!badge) return;
        const dirty = state.pending.has(path);
        badge.outerHTML = dirty
            ? '<span class="badge badge-status badge-unsaved">UNSAVED</span>'
            : '<span class="badge badge-status badge-saved">SAVED</span>';
        const reset = container.querySelector('.btn-reset');
        if (reset) reset.classList.toggle('d-none', !dirty);
        // refresh cover preview without rebuilding the button (keeps its listener)
        const track = findTrack(path);
        const coverEl = container.querySelector('.details-cover');
        if (track && coverEl) {
            const url = effectiveCoverUrl(track);
            const img = coverEl.querySelector('img');
            const ph = coverEl.querySelector('.cover-placeholder');
            if (url) {
                if (ph) ph.remove();
                if (img) {
                    img.src = url;
                } else {
                    coverEl.insertAdjacentHTML('afterbegin', `<img src="${esc(url)}" alt="">`);
                }
            } else {
                if (img) img.remove();
                if (!ph) {
                    coverEl.insertAdjacentHTML('afterbegin', '<div class="cover-placeholder"><i class="bi bi-music-note-beamed"></i><span>NO COVER</span></div>');
                }
            }
        }
    }

    /* ---------- Save ---------- */
    function savePayload(track) {
        const m = mergedTrack(track);
        const p = pendingOf(track.path);
        return {
            path: track.path,
            title: m.title,
            artist: m.artist,
            album: m.album,
            album_artist: m.album_artist,
            year: m.year,
            genre: m.genre,
            track: parseInt(m.tracknumber, 10) || 0,
            total: parseInt(m.total, 10) || 0,
            cover: p.cover === '__remove__' ? '__remove__' : (typeof p.cover === 'string' && p.cover ? p.cover : ''),
        };
    }

    async function saveTracks(paths) {
        if (isBusy()) return;
        const dirty = paths.filter((p) => state.pending.has(p));
        if (dirty.length === 0) {
            toast('Nothing to save', 'info');
            return;
        }
        const list = dirty.map(findTrack).filter(Boolean);

        setBusy(true, 'Saving...', `0 / ${list.length}`);
        try {
            const res = await api('api/bulk-update.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'save', tracks: list.map(savePayload) }),
                tolerateFailure: true,   // gestisce qui gli errori per singola traccia
            });

            const failed = new Map((res.errors || []).map((e) => [e.path, e.error]));
            let savedCount = 0;
            for (const t of list) {
                if (failed.has(t.path)) continue;
                const m = mergedTrack(t);
                const p = pendingOf(t.path);
                t.title = m.title;
                t.artist = m.artist;
                t.album = m.album;
                t.album_artist = m.album_artist;
                t.genre = m.genre;
                t.year = m.year;
                t.tracknumber = parseInt(m.tracknumber, 10) ? String(parseInt(m.tracknumber, 10)) : '';
                t.total = parseInt(m.total, 10) ? String(parseInt(m.total, 10)) : '0';
                if (p.cover === '__remove__') t.has_cover = false;
                else if (typeof p.cover === 'string' && p.cover) t.has_cover = true;
                // La copertina è stata riscritta: invalida la cache del browser.
                // Eseguito solo per le tracce salvate, mai in caso di errore.
                if (p.cover !== undefined) t.coverVersion = (t.coverVersion || 0) + 1;
                state.pending.delete(t.path);
                savedCount++;
            }

            if (failed.size === 0) {
                toast(`Changes saved: ${savedCount} tracks`, 'success');
            } else {
                const firstErr = [...failed.values()][0];
                toast(`Partial save: ${savedCount} saved, ${failed.size} failed. ${firstErr}`, 'error');
                state.selected.clear();
            }
            computeTotals();
            renderView();
            if (state.currentPath) refreshDetails(state.currentPath);
        } catch (err) {
            toast(`Unable to save changes: ${err.message}`, 'error');
        } finally {
            setBusy(false);
            updateBulkBtn();
        }
    }

    /* ---------- Scan / load ---------- */
    // The registered folders win over the plain root: as soon as at least one
    // folder is registered, the library is the union of those folders and their
    // tracks are merged (and de-duplicated) server side. Otherwise the single
    // root returned by api/config.php is scanned, as it always was.
    function useConfiguredFolders() {
        return state.folders.length > 0;
    }

    async function loadLibrary() {
        const viaFolders = useConfiguredFolders();
        const path = state.libraryPath;
        setBusy(true, 'Loading library...', viaFolders ? `${state.folders.length} folder(s)` : (path || ''));
        const tbody = $('#tracksBody');
        const tree = $('#artistTree');
        const loadingRow = '<tr><td colspan="12" class="text-center py-5"><div class="spinner-border spinner-border-sm me-2" role="status"></div>Scanning...</td></tr>';
        tbody.innerHTML = loadingRow;
        if (tree) {
            tree.innerHTML = '<div class="empty-state"><div class="spinner-border spinner-border-sm me-2" role="status"></div>Scanning...</div>';
        }
        try {
            const res = viaFolders
                ? await api('api/library.php')
                : await api('api/tracks.php?path=' + encodeURIComponent(path));
            state.tracks = res.tracks || [];
            state.pending.clear();
            state.selected.clear();
            state.currentPath = null;
            state.expandedArtists.clear();
            state.expandedAlbums.clear();
            computeTotals();
            activeDetailsContainer().innerHTML = '<div class="empty-state"><i class="bi bi-music-note-beamed"></i><p>Select a track to edit it</p></div>';
            renderView();
            const unavailable = viaFolders ? (res.folders || []).filter((f) => !f.available) : [];
            if (state.tracks.length === 0) {
                toast(viaFolders ? 'No tracks found in the registered folders' : 'No tracks found in this folder', 'warning');
            } else {
                toast(`${state.tracks.length} tracks loaded`, 'success');
            }
            unavailable.forEach((f) => toast(`Folder not available: ${f.label || f.display}`, 'warning'));
            setApiStatus(true);
        } catch (err) {
            state.tracks = [];
            computeTotals();
            renderView();
            toast(`Unable to load library: ${err.message}`, 'error');
            setApiStatus(false);
        } finally {
            setBusy(false);
            updateBulkBtn();
        }
    }

    async function init() {
        try {
            const cfg = await api('api/config.php');
            state.libraryPath = cfg.library_path || '';
            state.roots = cfg.roots || [];
            state.folders = await fetchFolders();
            updateFoldersBadge();
            setApiStatus(true);
        } catch (err) {
            setApiStatus(false);
            toast(`Server unreachable: ${err.message}`, 'error');
        }
        if (useConfiguredFolders() || state.libraryPath) {
            await loadLibrary();
        } else {
            const emptyRow = '<tr><td colspan="12" class="text-center py-5"><div class="empty-state"><i class="bi bi-folder2-open"></i><p>Enter the library path and press SCAN.</p></div></td></tr>';
            $('#tracksBody').innerHTML = emptyRow;
            const tree = $('#artistTree');
            if (tree) tree.innerHTML = '<div class="empty-state"><i class="bi bi-folder2-open"></i><p>Enter the library path and press SCAN.</p></div>';
            syncViewUI();
            updateCounts();
        }
    }

    function setApiStatus(ok) {
        const el = $('#apiStatus');
        el.className = 'badge rounded-pill badge-soft ' + (ok ? 'ok' : 'err');
        el.innerHTML = `<span class="status-dot"></span>${ok ? 'server online' : 'server offline'}`;
    }

    /* ============================================================
       Music folders dialog
       The browser only ever sends a root identifier and a relative
       path: absolute paths are never accepted server side, so this
       dialog cannot read anything outside the mounted roots.
       ============================================================ */

    const foldersApi = {
        list: () => api('api/folders.php'),
        add: (root, path, label) => api('api/folders.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add', root, path, label }),
        }),
        remove: (id) => api('api/folders.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'remove', id }),
        }),
        // tolerateFailure: an unreachable folder is a state to show inline,
        // not an error that deserves a toast.
        browse: (root, path) => api(`api/browse.php?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`, { tolerateFailure: true }),
    };

    async function fetchFolders() {
        try {
            const res = await foldersApi.list();
            return res.folders || [];
        } catch (err) {
            return [];
        }
    }

    function updateFoldersBadge() {
        const badge = $('#foldersCountBadge');
        if (!badge) return;
        const n = state.folders.length;
        badge.textContent = String(n);
        badge.classList.toggle('d-none', n === 0);
    }

    function foldersStatus(message, tone = '') {
        const el = $('#foldersStatus');
        if (!el) return;
        el.className = 'text-muted small' + (tone ? ` text-${tone}` : '');
        el.textContent = message || '';
    }

    function renderFoldersList() {
        const box = $('#foldersList');
        if (!box) return;
        if (state.folders.length === 0) {
            box.innerHTML = '<div class="empty-state py-4"><i class="bi bi-folder-plus"></i><p>No folder registered yet.<br>Pick one on the right.</p></div>';
            return;
        }
        box.innerHTML = state.folders.map((f) => `
            <div class="folder-item ${f.available ? '' : 'is-missing'}">
                <div class="folder-item-main">
                    <span class="folder-item-label" title="${esc(f.label)}">${esc(f.label)}</span>
                    <span class="folder-item-path" title="${esc(f.display)}">${esc(f.display)}</span>
                </div>
                <span class="folder-state ${f.available ? 'ok' : 'err'}"
                      title="${esc(f.available ? 'Available' : (f.error || 'Not available'))}">
                    ${f.available ? 'AVAILABLE' : 'MISSING'}
                </span>
                <button type="button" class="btn btn-icon btn-icon-sm" data-remove-folder="${esc(f.id)}"
                        aria-label="Remove ${esc(f.label)}" title="Remove from the library">
                    <i class="bi bi-trash3"></i>
                </button>
            </div>`).join('');

        box.querySelectorAll('[data-remove-folder]').forEach((btn) => {
            btn.addEventListener('click', () => removeFolder(btn.dataset.removeFolder));
        });
    }

    function renderRootsSelect() {
        const select = $('#folderRootSelect');
        if (!select) return;
        const previous = foldersState.root;
        select.innerHTML = state.roots.map((r) => {
            const suffix = r.available ? (r.path || '') : 'not available';
            return `<option value="${esc(r.id)}">${esc(r.label)} — ${esc(suffix)}</option>`;
        }).join('');
        if (state.roots.length === 0) {
            foldersState.root = '';
            select.innerHTML = '<option value="">No root configured</option>';
            select.disabled = true;
            return;
        }
        select.disabled = false;
        const found = state.roots.some((r) => r.id === previous);
        foldersState.root = found ? previous : state.roots[0].id;
        select.value = foldersState.root;
    }

    async function browseInto(rel) {
        const box = $('#folderBrowser');
        const pathLabel = $('#folderCurrentPath');
        const upBtn = $('#folderUpBtn');
        if (!foldersState.root) {
            box.innerHTML = '<div class="empty-state py-4"><i class="bi bi-exclamation-triangle"></i><p>No music folder is mounted.</p></div>';
            if (pathLabel) pathLabel.textContent = '—';
            if (upBtn) upBtn.disabled = true;
            return;
        }

        foldersState.target = null;
        foldersState.rel = rel || '';
        if (pathLabel) pathLabel.textContent = '/' + (foldersState.root + '/' + foldersState.rel).replace(/\/+$/, '');
        if (upBtn) upBtn.disabled = foldersState.rel === '';
        box.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div></div>';

        let res;
        try {
            res = await foldersApi.browse(foldersState.root, foldersState.rel);
        } catch (err) {
            box.innerHTML = `<div class="empty-state py-4"><i class="bi bi-exclamation-triangle"></i><p>${esc(err.message)}</p></div>`;
            foldersStatus(err.message, 'danger');
            return;
        }

        if (!res.success) {
            box.innerHTML = `<div class="empty-state py-4"><i class="bi bi-exclamation-triangle"></i><p>${esc(res.error || 'Folder not available')}</p></div>`;
            foldersStatus(res.error || 'Folder not available', 'danger');
            return;
        }

        foldersStatus('');
        const currentName = foldersState.rel === '' ? res.root.label : basename(foldersState.rel);
        foldersState.target = { name: currentName, rel: res.path || '' };

        if (!res.entries.length) {
            box.innerHTML = '<div class="empty-state py-4"><i class="bi bi-inbox"></i><p>This folder has no sub-folders.<br>The current folder can still be added.</p></div>';
        } else {
            box.innerHTML = res.entries.map((e) => `
                <button type="button" class="folder-dir" data-dir="${esc(e.rel)}" title="${esc(e.rel)}">
                    <i class="bi bi-folder-fill"></i>
                    <span class="folder-dir-name">${esc(e.name)}</span>
                    <i class="bi bi-chevron-right folder-dir-go" aria-hidden="true"></i>
                </button>`).join('');
            box.querySelectorAll('[data-dir]').forEach((btn) => {
                btn.addEventListener('click', () => browseInto(btn.dataset.dir));
            });
        }
    }

    async function openFoldersModal() {
        if (isBusy()) return;
        const modalEl = $('#foldersModal');
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
        foldersStatus('Loading folders...');
        renderFoldersList();
        renderRootsSelect();
        await browseInto('');
        await refreshFolders();
    }

    async function refreshFolders() {
        state.folders = await fetchFolders();
        renderFoldersList();
        updateFoldersBadge();
        updateCounts();
    }

    async function addCurrentFolder() {
        if (foldersState.loading) return;
        if (!foldersState.root) {
            toast('Select a root first', 'warning');
            return;
        }
        const target = foldersState.target;
        if (!target) {
            toast('Select a folder to add', 'warning');
            return;
        }

        foldersState.loading = true;
        const btn = $('#folderAddBtn');
        btn.disabled = true;
        try {
            const res = await foldersApi.add(foldersState.root, target.rel, $('#folderLabelInput').value.trim());
            toast(`Folder added: ${res.folder.label}`, 'success');
            $('#folderLabelInput').value = '';
            await refreshFolders();
            await browseInto(target.rel);
        } catch (err) {
            if (err.status === 409) {
                toast('This folder is already registered', 'warning');
            } else {
                toast(`Unable to add the folder: ${err.message}`, 'error');
            }
        } finally {
            foldersState.loading = false;
            btn.disabled = false;
        }
    }

    async function removeFolder(id) {
        if (foldersState.loading) return;
        const folder = state.folders.find((f) => f.id === id);
        if (!folder) return;

        const ok = await confirmDialog(
            `Remove "${folder.label}" from the library? Files and metadata on disk are not touched.`
        );
        if (!ok) return;

        foldersState.loading = true;
        try {
            await foldersApi.remove(id);
            toast('Folder removed from the library', 'success');
            await refreshFolders();
        } catch (err) {
            toast(`Unable to remove the folder: ${err.message}`, 'error');
        } finally {
            foldersState.loading = false;
        }
    }

    async function scanFolders() {
        if (isBusy()) return;
        if (state.folders.length === 0) {
            toast('Add at least one folder first', 'warning');
            return;
        }
        bootstrap.Modal.getOrCreateInstance('#foldersModal').hide();
        await loadLibrary();
    }

    /* ---------- Cover modal ---------- */
    function showCoverModal() {
        const stacked = coverContext && coverContext.type === 'bulk'
            && !!document.querySelector('#bulkModal.show');
        document.body.classList.toggle('cover-modal-stacked', stacked);
        bootstrap.Modal.getOrCreateInstance('#coverModal').show();
    }

    function openCoverModal(ctx) {
        const isBulk = ctx.type === 'bulk';
        coverContext = ctx;
        coverChoice = null;
        const body = $('#coverModalBody');
        const targets = isBulk ? ctx.paths.map(findTrack).filter(Boolean) : [findTrack(ctx.path)];
        const ref = targets[0];

        if (!ref) {
            body.innerHTML = '<div class="empty-state"><i class="bi bi-x-circle"></i><p>Track not found.</p></div>';
            return;
        }

        if (isBulk && commonFolderForPaths(ctx.paths) === null) {
            body.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>Cover selection is available only when all selected tracks are in the same folder.</p></div>';
            showCoverModal();
            return;
        }

        const options = [];
        if (!isBulk && ref.has_cover) {
            options.push({
                kind: 'embedded',
                id: '__embedded__',
                url: `api/cover.php?path=${encodeURIComponent(ref.path)}&embedded=1`,
                name: 'Embedded (current)',
                tag: 'embedded',
            });
        }
        (ref.covers || []).forEach((img) => {
            options.push({
                kind: 'image',
                id: img,
                url: `api/cover.php?path=${encodeURIComponent(img)}`,
                name: basename(img),
                tag: null,
            });
        });
        if (!isBulk && ref.has_cover) {
            options.push({
                kind: 'remove',
                id: '__remove__',
                url: null,
                name: 'Remove Cover',
                tag: 'remove',
            });
        }

        const targetLabel = isBulk
            ? `Covers — apply to ${targets.length} selected tracks`
            : `Available covers for "${ref.title || ref.filename}"`;

        const current = isBulk
            ? (bulkDraft && bulkDraft.cover ? bulkDraft.cover : null)
            : mergedTrack(ref).cover;
        if (isBulk && current !== null) coverChoice = current;

        body.innerHTML = `
            <p class="text-muted small mb-3">${esc(targetLabel)}</p>
            <div class="cover-grid">
                ${options.map((opt) => {
                    const selected = current === opt.id || (current === '__embedded__' && opt.id === '__embedded__')
                        || (current === null && opt.id === '__embedded__');
                    return `
                        <div class="cover-option ${selected ? 'selected' : ''}" data-choice="${esc(opt.id)}" role="button" tabindex="0" aria-label="${esc(opt.name)}">
                            <div class="thumb">${opt.url ? `<img src="${esc(opt.url)}" alt="" loading="lazy">` : '<i class="bi bi-trash3"></i>'}</div>
                            <div class="name" title="${esc(opt.name)}">${esc(opt.name)}</div>
                            ${opt.tag ? `<span class="tag ${opt.tag}">${opt.tag === 'embedded' ? 'EMBEDDED' : 'REMOVE'}</span>` : ''}
                        </div>`;
                }).join('')}
            </div>
            ${options.some((opt) => opt.kind === 'image') ? '' : '<p class="text-muted small mt-3">No JPEG found in this folder.</p>'}`;

        body.querySelectorAll('.cover-option').forEach((opt) => {
            const apply = () => {
                coverChoice = opt.dataset.choice;
                body.querySelectorAll('.cover-option').forEach((o) => o.classList.toggle('selected', o === opt));
            };
            opt.addEventListener('click', apply);
            opt.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    apply();
                }
            });
        });

        showCoverModal();
    }

    function applyCover() {
        if (coverChoice === null) {
            toast('Select a cover first', 'warning');
            return;
        }
        const ctx = coverContext;
        if (ctx.type === 'bulk') {
            bulkDraft = { cover: coverChoice, name: basename(coverChoice) };
            renderBulkCover();
            bootstrap.Modal.getInstance('#coverModal').hide();
            toast('Cover selected — press "Salva modifiche" to apply it', 'success', 'Cover');
            return;
        }
        const pend = state.pending.get(ctx.path) || {};
        pend.cover = coverChoice;
        state.pending.set(ctx.path, pend);
        renderView();
        if (state.currentPath) refreshDetails(state.currentPath);
        bootstrap.Modal.getInstance('#coverModal').hide();
        toast('Cover selected — press "Save Changes" to embed it', 'success', 'Cover');
    }

    async function uploadAlbumCover(file) {
        const isJpeg = file && (
            /image\/jpe?g/i.test(file.type || '') || /\.(jpe?g)$/i.test(file.name || '')
        );
        if (!isJpeg) {
            toast('Only JPEG images (.jpg / .jpeg) are supported', 'error', 'Cover');
            return;
        }
        if (isBusy()) return;

        const ctx = coverContext;
        if (!ctx) return;

        let refPath = null;
        if (ctx.type === 'single') {
            refPath = ctx.path;
        } else if (ctx.type === 'bulk') {
            const folder = commonFolderForPaths(ctx.paths);
            if (folder === null) {
                toast('Cover selection is available only when all selected tracks are in the same folder', 'error', 'Cover');
                return;
            }
            const ref = ctx.paths.map(findTrack).find((t) => t && dirnameOf(t.path) === folder);
            refPath = ref ? ref.path : null;
        }

        const track = refPath ? findTrack(refPath) : null;
        if (!track) return;

        setBusy(true, 'Uploading cover...', file.name || '');
        try {
            const fd = new FormData();
            fd.append('path', refPath);
            fd.append('cover', file, file.name || 'cover.jpg');
            const res = await api('api/upload-album-cover.php', { method: 'POST', body: fd });
            if (!res || !res.path) throw new Error('Upload response missing the cover path');

            const folder = dirnameOf(track.path);
            state.tracks.forEach((t) => {
                if (dirnameOf(t.path) !== folder) return;
                if (!Array.isArray(t.covers)) t.covers = [];
                if (!t.covers.includes(res.path)) t.covers.push(res.path);
                t.covers.sort((a, b) => String(a).localeCompare(String(b)));
            });

            if (state.currentPath === refPath) refreshDetails(refPath);
            if (bootstrap.Modal.getInstance('#coverModal') && coverContext === ctx) {
                openCoverModal(ctx);
            }
            toast(`Cover image uploaded: ${res.name || basename(res.path)}. Select it in the dialog to use it.`, 'success', 'Cover');
        } catch (err) {
            toast(`Unable to upload cover: ${err.message}`, 'error', 'Cover');
        } finally {
            setBusy(false);
        }
    }

/* ---------- Bulk edit ---------- */
    function renderBulkCover() {
        const img = $('#bulkCoverPreview');
        const ph = $('#bulkCoverPlaceholder');
        const pickLabel = $('#bulkCoverPickLabel');
        const fileLabel = $('#bulkCoverLabel');
        const clearBtn = $('#bulkCoverClearBtn');
        if (!img || !ph) return;

        if (bulkDraft && bulkDraft.cover) {
            img.src = `api/cover.php?path=${encodeURIComponent(bulkDraft.cover)}`;
            img.hidden = false;
            ph.classList.add('d-none');
            if (pickLabel) pickLabel.textContent = 'Change Cover';
            if (fileLabel) {
                fileLabel.textContent = bulkDraft.name || basename(bulkDraft.cover);
                fileLabel.title = fileLabel.textContent;
            }
            if (clearBtn) clearBtn.classList.remove('d-none');
        } else {
            img.removeAttribute('src');
            img.hidden = true;
            ph.classList.remove('d-none');
            if (pickLabel) pickLabel.textContent = 'Select Cover';
            if (fileLabel) {
                fileLabel.textContent = 'No cover selected.';
                fileLabel.removeAttribute('title');
            }
            if (clearBtn) clearBtn.classList.add('d-none');
        }
    }

    function clearBulkCover() {
        bulkDraft = null;
        renderBulkCover();
    }

    function bulkCoverAllowed() {
        return commonFolderForPaths([...state.selected]) !== null;
    }

    function updateBulkCoverAvailability() {
        const allowed = bulkCoverAllowed();
        const btn = $('#bulkCoverPickBtn');
        const warning = $('#bulkCoverWarning');
        if (btn) btn.disabled = !allowed;
        if (warning) warning.classList.toggle('d-none', allowed);
        return allowed;
    }

    function openBulkCoverModal() {
        if (!updateBulkCoverAvailability()) {
            toast('Cover selection is available only when all selected tracks are in the same folder', 'warning', 'Cover');
            return;
        }
        openCoverModal({ type: 'bulk', paths: [...state.selected] });
    }

    function discardBulkChanges() {
        // Scarta solo le scelte della finestra multipla: non tocca i pending preesistenti
        // (es. modifiche già aperte nel pannello dettagli) né i dati già salvati su disco.
        clearBulkCover();
        renderView();
        toast('Bulk changes discarded', 'info', 'Bulk Edit');
    }

    function openBulkModal() {
        if (state.selected.size === 0) {
            toast('No tracks selected', 'warning');
            return;
        }
        $('#bulkCount').textContent = state.selected.size;
        $('#bulkAlbum').value = '';
        $('#bulkArtist').value = '';
        $('#bulkGenre').value = '';
        $('#bulkYear').value = '';
        clearBulkCover();
        updateBulkCoverAvailability();
        bootstrap.Modal.getOrCreateInstance('#bulkModal').show();
    }

    async function applyBulk() {
        if (isBusy()) return;
        const selected = state.selected;
        if (selected.size === 0) return;

        const fields = [
            ['album', $('#bulkAlbum').value.trim()],
            ['artist', $('#bulkArtist').value.trim()],
            ['genre', $('#bulkGenre').value.trim()],
            ['year', $('#bulkYear').value.trim()],
        ].filter(([, v]) => v !== '');

        const coverPath = bulkDraft && bulkDraft.cover ? bulkDraft.cover : '';

        let count = 0;
        for (const path of selected) {
            const pend = state.pending.get(path) || {};
            for (const [f, v] of fields) pend[f] = v;
            if (coverPath) pend.cover = coverPath;
            if (Object.keys(pend).length === 0) continue;
            state.pending.set(path, pend);
            count++;
        }
        clearBulkCover();

        if (count === 0) {
            bootstrap.Modal.getInstance('#bulkModal').hide();
            toast('Nothing to save', 'info', 'Bulk Edit');
            return;
        }

        // Un solo salvataggio: applyBulk committa i pending, saveTracks esegue la chiamata.
        // saveTracks segnala già successo/errore (anche il fallimento parziale della copertina).
        await saveTracks([...selected]);
        bootstrap.Modal.getInstance('#bulkModal').hide();
    }

    /* ---------- Library tree interactions ---------- */
    function toggleArtistNode(key) {
        const node = document.querySelector(`[data-artist-node="${cssEscape(key)}"]`);
        if (!node) return;
        const target = node.querySelector('.artist-body');
        if (!target) return;
        if (state.expandedArtists.has(key)) state.expandedArtists.delete(key);
        else state.expandedArtists.add(key);
        bootstrap.Collapse.getOrCreateInstance(target).toggle();
    }

    function toggleAlbumNode(key) {
        const el = document.querySelector(`[data-children-of="album"][data-album="${cssEscape(key)}"]`);
        if (!el) return;
        const willOpen = !state.expandedAlbums.has(key);
        if (willOpen) {
            ensureAlbumTracks(el);
            state.expandedAlbums.add(key);
        } else {
            state.expandedAlbums.delete(key);
        }
        // Nessun effetto collaterale: tocca solo questo album.
        setAlbumTracksVisible(el, willOpen);
    }

    function setGroupSelection(key, checked, kind) {
        const group = kind === 'artist'
            ? (findArtist(key) ? findArtist(key).tracks : [])
            : (findAlbum(key) ? findAlbum(key).tracks : []);
        for (const t of group) {
            if (checked) state.selected.add(t.path);
            else state.selected.delete(t.path);
        }
        afterSelectionChange();
    }

    function wireLibraryTree() {
        const tree = $('#artistTree');
        if (!tree) return;

        // Bootstrap collapse events bubble: one delegated listener for both levels.
        // Solo il livello artista usa Bootstrap Collapse: cosi' nessun evento di
        // transizione puo' interferire con l'espansione dei singoli album.
        tree.addEventListener('show.bs.collapse', (e) => {
            const el = e.target;
            if (el.dataset.childrenOf !== 'artist') return;
            ensureArtistChildren(el);
            const node = el.parentElement;
            node.classList.add('expanded');
            const row = node.querySelector('.artist-row');
            if (row) row.setAttribute('aria-expanded', 'true');
        });
        tree.addEventListener('hidden.bs.collapse', (e) => {
            const el = e.target;
            if (el.dataset.childrenOf !== 'artist') return;
            const node = el.parentElement;
            node.classList.remove('expanded');
            const row = node.querySelector('.artist-row');
            if (row) row.setAttribute('aria-expanded', 'false');
            // Lo stato degli album NON viene modificato: riaprendo l'artista i
            // blocchi tracce ritornano visibili esattamente come erano.
        });

        tree.addEventListener('click', (e) => {
            if (e.target.closest('.artist-check, .album-check, .tv-check')) return;
            // I pulsanti Play hanno la precedenza: il click non deve aprire il
            // pannello dei dettagli ne' selezionare la riga.
            const playBtn = e.target.closest('[data-action="play-track"], [data-action="play-album"]');
            if (playBtn) {
                e.preventDefault();
                e.stopPropagation();
                if (playBtn.dataset.action === 'play-album') {
                    playAlbum(playBtn.dataset.album);
                } else {
                    toggleTrack(playBtn.dataset.path, playBtn.dataset.album);
                }
                return;
            }
            const editBtn = e.target.closest('[data-action="edit-track"]');
            if (editBtn) {
                e.preventDefault();
                showDetails(editBtn.dataset.path);
                return;
            }
            const artistToggle = e.target.closest('[data-action="toggle-artist"]');
            if (artistToggle) {
                e.preventDefault();
                toggleArtistNode(artistToggle.dataset.artist);
                return;
            }
            const albumToggle = e.target.closest('[data-action="toggle-album"]');
            if (albumToggle) {
                e.preventDefault();
                toggleAlbumNode(albumToggle.dataset.album);
                return;
            }
            const row = e.target.closest('[data-track-row]');
            if (row) {
                e.preventDefault();
                showDetails(row.dataset.trackRow);
            }
        });

        tree.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const a = e.target.closest('[data-action="toggle-artist"]');
            const b = e.target.closest('[data-action="toggle-album"]');
            if (!a && !b) return;
            e.preventDefault();
            if (a) toggleArtistNode(a.dataset.artist);
            else toggleAlbumNode(b.dataset.album);
        });

        tree.addEventListener('change', (e) => {
            const cb = e.target.closest('.tv-check');
            if (cb) { toggleSelect(cb.dataset.path); return; }
            const ac = e.target.closest('.artist-check');
            if (ac) { setGroupSelection(ac.dataset.artist, ac.checked, 'artist'); return; }
            const alc = e.target.closest('.album-check');
            if (alc) setGroupSelection(alc.dataset.album, alc.checked, 'album');
        });
    }

    /* ---------- Events ---------- */
    function wireEvents() {
        $('#reloadBtn').addEventListener('click', () => {
            if (isBusy()) return;
            if (!useConfiguredFolders() && !state.libraryPath) {
                toast('No library loaded', 'warning');
                return;
            }
            loadLibrary();
        });

        $('#foldersBtn').addEventListener('click', openFoldersModal);

        $('#folderRootSelect').addEventListener('change', (e) => {
            foldersState.root = e.target.value;
            $('#folderLabelInput').value = '';
            browseInto('');
        });

        $('#folderUpBtn').addEventListener('click', () => {
            if (!foldersState.rel) return;
            const cut = foldersState.rel.lastIndexOf('/');
            browseInto(cut === -1 ? '' : foldersState.rel.slice(0, cut));
        });

        $('#folderAddBtn').addEventListener('click', addCurrentFolder);
        $('#foldersScanBtn').addEventListener('click', scanFolders);

        $('#foldersModal').addEventListener('hidden.bs.modal', () => {
            foldersState.loading = false;
        });

        let debounceTimer = null;
        $('#searchInput').addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            const value = e.target.value;
            debounceTimer = setTimeout(() => setSearchQuery(value), 150);
        });

        $('#clearSearchBtn').addEventListener('click', () => {
            setSearchQuery('');
            $('#searchInput').focus();
        });

        $('#filterFormat').addEventListener('change', (e) => {
            state.filterFormat = e.target.value;
            renderView();
        });

        $('#filterStatus').addEventListener('change', (e) => {
            state.filterStatus = e.target.value;
            renderView();
        });

        $('#selectAllCheckbox').addEventListener('change', (e) => {
            if (e.target.checked) selectAllVisible();
            else deselectAll();
        });

        $('#selectAllBtn').addEventListener('click', selectAllVisible);
        $('#deselectAllBtn').addEventListener('click', deselectAll);

        $('#viewArtistsBtn').addEventListener('click', () => {
            if (state.viewMode === 'artists') return;
            state.viewMode = 'artists';
            renderView();
        });
        $('#viewTracksBtn').addEventListener('click', () => {
            if (state.viewMode === 'tracks') return;
            state.viewMode = 'tracks';
            renderView();
        });

        wireLibraryTree();

        $('#tracksBody').addEventListener('click', (e) => {
            const playBtn = e.target.closest('.btn-play-row');
            if (playBtn) {
                e.preventDefault();
                e.stopPropagation();
                toggleTrack(playBtn.dataset.path);
                return;
            }
            const row = e.target.closest('.track-row');
            if (!row) return;
            const path = row.dataset.path;
            if (e.target.closest('.select-track')) return;
            showDetails(path);
        });

        $('#tracksBody').addEventListener('change', (e) => {
            const cb = e.target.closest('.select-track');
            if (!cb) return;
            toggleSelect(cb.dataset.path);
        });

        $('#bulkBtn').addEventListener('click', openBulkModal);
        $('#bulkApplyBtn').addEventListener('click', applyBulk);
        $('#bulkCancelBtn').addEventListener('click', discardBulkChanges);

        $('#bulkCoverPickBtn').addEventListener('click', openBulkCoverModal);

        $('#bulkCoverClearBtn').addEventListener('click', clearBulkCover);

        $('#coverApplyBtn').addEventListener('click', applyCover);

        $('#coverModal').addEventListener('hidden.bs.modal', () => {
            document.body.classList.remove('cover-modal-stacked');
            const bulkEl = $('#bulkModal');
            if (bulkEl && bulkEl.classList.contains('show')) {
                document.body.classList.add('modal-open');
            }
        });

        const coverUploadBtn = $('#coverUploadBtn');
        const coverUploadInput = $('#coverUploadInput');
        if (coverUploadBtn && coverUploadInput) {
            coverUploadBtn.addEventListener('click', () => coverUploadInput.click());
            coverUploadInput.addEventListener('change', () => {
                const file = coverUploadInput.files && coverUploadInput.files[0];
                coverUploadInput.value = '';
                if (!file || !coverContext) return;
                uploadAlbumCover(file);
            });
        }

        window.matchMedia('(min-width: 992px)').addEventListener('change', () => {
            if (state.currentPath) {
                const oc = bootstrap.Offcanvas.getInstance('#detailsOffcanvas');
                if (isDesktop()) { if (oc) oc.hide(); }
                refreshDetails(state.currentPath);
            }
        });

        // Enable tooltips
        document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
            new bootstrap.Tooltip(el);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        syncHeaderHeight();
        wireEvents();
        initPlayer();
        init();
    });
})();