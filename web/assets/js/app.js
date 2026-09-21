/* ============================================================
   Audio Manager — Frontend
   Vanilla JS + Fetch + Bootstrap 5
   ============================================================ */

(() => {
    'use strict';

    /* ---------- State ---------- */
    const state = {
        libraryPath: '',
        tracks: [],
        pending: new Map(),      // path -> { field: value, cover?: path|'__remove__' }
        selected: new Set(),
        currentPath: null,
        searchQuery: '',
        filterFormat: 'all',
        filterStatus: 'all',
        busy: false,
    };

    let coverContext = null;   // { type:'single', path } | { type:'bulk', paths:[] }
    let coverChoice = null;    // path | '__remove__' | null

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

    function formatDuration(sec) {
        const s = Math.round(Number(sec) || 0);
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${m}:${String(r).padStart(2, '0')}`;
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
        ['scanBtn', 'reloadBtn', 'saveAllBtn', 'bulkBtn', 'selectAllBtn', 'deselectAllBtn'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.disabled = on;
        });
    }

    /* ---------- Toast ---------- */
    function toast(message, type = 'info', title = 'Audio Manager') {
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
        if (!res.ok || data.success === false) {
            const err = new Error(data.error || data.detail || `Server error (HTTP ${res.status})`);
            err.detail = data.detail || '';
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
        if (typeof m.cover === 'string' && m.cover && m.cover !== '__embedded__') {
            return `api/cover.php?path=${enc(m.cover)}`;
        }
        if (m.cover === '__embedded__') {
            return `api/cover.php?path=${enc(track.path)}&embedded=1`;
        }
        if (Array.isArray(track.covers) && track.covers.length) {
            return `api/cover.php?path=${enc(track.covers[0])}`;
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

    function updateCounts() {
        $('#trackCount').textContent = state.tracks.length;
        $('#resultInfo').textContent = `${visibleTracks().length} of ${state.tracks.length} results`;
        const unsaved = state.pending.size;
        const saveBtn = $('#saveAllBtn');
        $('#unsavedCount').textContent = unsaved;
        saveBtn.disabled = unsaved === 0 || isBusy();
        $('#libraryInfo').textContent = state.libraryPath ? `Library: ${state.libraryPath}` : '';
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

    function renderTable() {
        const tbody = $('#tracksBody');
        const list = visibleTracks();
        if (state.tracks.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="11" class="text-center py-5">
                    <div class="empty-state"><i class="bi bi-inbox"></i><p>No tracks found. Enter the library path and press SCAN.</p></div>
                </td></tr>`;
            updateCounts();
            return;
        }
        if (list.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="11" class="text-center py-5">
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

    /* ---------- Selection ---------- */
    function toggleSelect(path) {
        if (state.selected.has(path)) state.selected.delete(path);
        else state.selected.add(path);
        renderTable();
        updateBulkBtn();
    }

    function selectAllVisible() {
        visibleTracks().forEach((t) => state.selected.add(t.path));
        renderTable();
        updateBulkBtn();
    }

    function deselectAll() {
        state.selected.clear();
        renderTable();
        updateBulkBtn();
    }

    function updateBulkBtn() {
        const n = state.selected.size;
        const btn = $('#bulkBtn');
        btn.innerHTML = n > 0
            ? `<i class="bi bi-pencil-square me-1"></i>Edit Selected <span class="badge bg-dark-subtle ms-1">${n}</span>`
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
                <div class="col-12">
                    <label class="form-label" for="dAlbumArtist-${esc(track.path)}">Album Artist</label>
                    <input type="text" class="form-control" id="dAlbumArtist-${esc(track.path)}" data-field="album_artist" value="${esc(m.album_artist)}" autocomplete="off">
                </div>
                <div class="col-6">
                    <label class="form-label" for="dTrack-${esc(track.path)}">Track #</label>
                    <input type="number" class="form-control" id="dTrack-${esc(track.path)}" data-field="track" value="${esc(m.tracknumber)}" min="1" inputmode="numeric">
                </div>
                <div class="col-6">
                    <label class="form-label" for="dTotal-${esc(track.path)}">Total tracks</label>
                    <input type="number" class="form-control" id="dTotal-${esc(track.path)}" data-field="total" value="${esc(m.total)}" min="1" inputmode="numeric">
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
                renderTable();
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
        renderTable();
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
            renderTable();
            if (state.currentPath) refreshDetails(state.currentPath);
        } catch (err) {
            toast(`Unable to save changes: ${err.message}`, 'error');
        } finally {
            setBusy(false);
            updateBulkBtn();
        }
    }

    /* ---------- Scan / load ---------- */
    async function loadLibrary() {
        const path = state.libraryPath;
        setBusy(true, 'Loading library...', path || '');
        const tbody = $('#tracksBody');
        tbody.innerHTML = '<tr><td colspan="11" class="text-center py-5"><div class="spinner-border spinner-border-sm me-2" role="status"></div>Scanning...</td></tr>';
        try {
            const res = await api('api/tracks.php?path=' + encodeURIComponent(path));
            state.tracks = res.tracks || [];
            state.pending.clear();
            state.selected.clear();
            state.currentPath = null;
            activeDetailsContainer().innerHTML = '<div class="empty-state"><i class="bi bi-music-note-beamed"></i><p>Select a track to edit it</p></div>';
            renderTable();
            toast(`${state.tracks.length} tracks loaded`, 'success');
            setApiStatus(true);
        } catch (err) {
            state.tracks = [];
            renderTable();
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
            $('#libraryPath').value = state.libraryPath;
            setApiStatus(true);
        } catch (err) {
            setApiStatus(false);
            toast(`Server unreachable: ${err.message}`, 'error');
        }
        if (state.libraryPath) {
            await loadLibrary();
        } else {
            $('#tracksBody').innerHTML = '<tr><td colspan="11" class="text-center py-5"><div class="empty-state"><i class="bi bi-folder2-open"></i><p>Enter the library path and press SCAN.</p></div></td></tr>';
        }
    }

    function setApiStatus(ok) {
        const el = $('#apiStatus');
        el.className = 'badge rounded-pill badge-soft ' + (ok ? 'ok' : 'err');
        el.innerHTML = `<span class="status-dot"></span>${ok ? 'server online' : 'server offline'}`;
    }

    /* ---------- Cover modal ---------- */
    function openCoverModal(ctx) {
        coverContext = ctx;
        coverChoice = null;
        const body = $('#coverModalBody');
        const targets = ctx.type === 'single' ? [findTrack(ctx.path)] : ctx.paths.map(findTrack).filter(Boolean);
        const ref = targets[0];

        const applyAllWrap = $('#coverApplyAllCheckbox').closest('.form-check');
        if (ctx.type === 'single') {
            applyAllWrap.style.display = '';
        } else {
            applyAllWrap.style.display = 'none';
        }

        if (!ref) {
            body.innerHTML = '<div class="empty-state"><i class="bi bi-x-circle"></i><p>Track not found.</p></div>';
            return;
        }

        const options = [];
        if (ref.has_cover) {
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
        if (ref.has_cover) {
            options.push({
                kind: 'remove',
                id: '__remove__',
                url: null,
                name: 'Remove Cover',
                tag: 'remove',
            });
        }

        const targetLabel = ctx.type === 'single'
            ? `Available covers for "${ref.title || ref.filename}"`
            : `Covers — apply to ${targets.length} selected tracks`;

        const current = ctx.type === 'single' ? mergedTrack(ref).cover : null;

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
            ${options.length <= 1 ? '<p class="text-muted small mt-3">No JPEG found in this folder.</p>' : ''}`;

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

        bootstrap.Modal.getOrCreateInstance('#coverModal').show();
    }

    function applyCover() {
        if (coverChoice === null) {
            toast('Select a cover first', 'warning');
            return;
        }
        const ctx = coverContext;
        const targets = ctx.type === 'single'
            ? [ctx.path]
            : ctx.paths.slice();

        if (ctx.type === 'single') {
            const applyAll = $('#coverApplyAllCheckbox').checked;
            if (applyAll) {
                const ref = findTrack(ctx.path);
                const folder = ref ? ref.path.slice(0, ref.path.lastIndexOf('/')) : '';
                const albumTracks = state.tracks
                    .filter((t) => t.path.slice(0, t.path.lastIndexOf('/')) === folder)
                    .map((t) => t.path);
                targets.push(...albumTracks.filter((p) => !targets.includes(p)));
            }
        }

        for (const p of targets) {
            const pend = state.pending.get(p) || {};
            pend.cover = coverChoice;
            state.pending.set(p, pend);
        }
        bootstrap.Modal.getInstance('#coverModal').hide();
        renderTable();
        if (state.currentPath) refreshDetails(state.currentPath);
        toast(`Cover applied to ${targets.length} tracks — press Save to embed it`, 'success', 'Cover');
    }

    /* ---------- Bulk edit ---------- */
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
        $('#bulkTrack').value = '';
        $('#bulkTotal').value = '';
        $('#bulkCoverLabel').textContent = 'Choose cover...';
        bootstrap.Modal.getOrCreateInstance('#bulkModal').show();
    }

    function applyBulk() {
        const selected = state.selected;
        if (selected.size === 0) return;

        const fields = [
            ['album', $('#bulkAlbum').value.trim()],
            ['artist', $('#bulkArtist').value.trim()],
            ['genre', $('#bulkGenre').value.trim()],
            ['year', $('#bulkYear').value.trim()],
            ['track', $('#bulkTrack').value.trim()],
            ['total', $('#bulkTotal').value.trim()],
        ].filter(([, v]) => v !== '');

        let count = 0;
        for (const path of selected) {
            const pend = state.pending.get(path) || {};
            for (const [f, v] of fields) pend[f] = v;
            state.pending.set(path, pend);
            count++;
        }
        bootstrap.Modal.getInstance('#bulkModal').hide();
        renderTable();
        toast(`Changes staged for ${count} tracks — press Save`, 'success', 'Bulk Edit');
    }

    /* ---------- Events ---------- */
    function wireEvents() {
        $('#scanBtn').addEventListener('click', () => {
            if (isBusy()) return;
            const value = $('#libraryPath').value.trim();
            if (!value) {
                toast('Enter the library path', 'warning');
                return;
            }
            state.libraryPath = value;
            loadLibrary();
        });

        $('#libraryPath').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                $('#scanBtn').click();
            }
        });

        $('#reloadBtn').addEventListener('click', () => {
            if (isBusy()) return;
            if (!state.libraryPath) {
                toast('No library loaded', 'warning');
                return;
            }
            loadLibrary();
        });

        let debounceTimer = null;
        $('#searchInput').addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                state.searchQuery = e.target.value;
                $('#clearSearchBtn').classList.toggle('hidden', !e.target.value);
                renderTable();
            }, 150);
        });

        $('#clearSearchBtn').addEventListener('click', () => {
            $('#searchInput').value = '';
            state.searchQuery = '';
            $('#clearSearchBtn').classList.add('hidden');
            renderTable();
        });

        $('#filterFormat').addEventListener('change', (e) => {
            state.filterFormat = e.target.value;
            renderTable();
        });

        $('#filterStatus').addEventListener('change', (e) => {
            state.filterStatus = e.target.value;
            renderTable();
        });

        $('#selectAllCheckbox').addEventListener('change', (e) => {
            if (e.target.checked) selectAllVisible();
            else deselectAll();
        });

        $('#selectAllBtn').addEventListener('click', selectAllVisible);
        $('#deselectAllBtn').addEventListener('click', deselectAll);

        $('#tracksBody').addEventListener('click', (e) => {
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

        $('#saveAllBtn').addEventListener('click', () => {
            saveTracks([...state.pending.keys()]);
        });

        $('#bulkBtn').addEventListener('click', openBulkModal);
        $('#bulkApplyBtn').addEventListener('click', applyBulk);

        $('#bulkCoverBtn').addEventListener('click', () => {
            const first = [...state.selected].map(findTrack).filter(Boolean)[0];
            if (!first) return;
            bootstrap.Modal.getInstance('#bulkModal').hide();
            openCoverModal({ type: 'bulk', paths: [...state.selected] });
        });

        $('#coverApplyBtn').addEventListener('click', applyCover);

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
        wireEvents();
        init();
    });
})();