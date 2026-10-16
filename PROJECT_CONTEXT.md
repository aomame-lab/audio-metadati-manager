# Audio Metadati Manager - PROJECT CONTEXT

## 1. Panoramica, scopo e tecnologie

**Project**: Audio Metadati Manager
**Purpose**: Web-based application for managing music library metadata and album artwork
**Version**: 1.2.0 (as per README)
**Architecture**: Full-stack web application with a clear separation of concerns:
- **Frontend**: HTML5 + Bootstrap 5.3 + vanilla JavaScript (ES6, IIFE pattern)
- **Backend PHP**: Thin API layer that validates input, secures paths, and executes Python as subprocess
- **Python core**: `mutagen` library for reading/writing audio metadata and embedded artwork
- **Audio formats supported**: MP3, FLAC, M4A

The application is designed to be lightweight — no PHP extensions or Composer required, runs on the PHP built-in web server. Python virtual environment (`./.venv/`) contains `mutagen>=1.46`.

## 2. Struttura directory e file principali

```
/Users/macbookpro/Desktop/metadati/
├── metadati.py           # CLI entry point (asks for folder, artist, album, year, saves tags per file)
├── python/
│   ├── core.py           # Core logic: get_music_files(), read_title(), save_tags(), read_artist(), read_album(),
│   │                     read_tracknumber(), read_total_tracks(), read_year(), read_genre(), read_duration(),
│   │                     read_album_artist(), find_covers(), track_info(), _embedded_cover_info(),
│   │                     has_embedded_cover(), read_embedded_cover_b64(), set_embedded_cover(),
│   │                     remove_embedded_cover(), save_full(), track_info(), cli_command()
│   └── comm.py           # JSON CLI bridge called by PHP via shell_exec()
├── music/                # Sample music library (Soundgarden - Superunknown)
├── web/
│   ├── index.php         # Main HTML page + Bootstrap UI
│   ├── assets/
│   │   ├── css/style.css   # Custom dark theme (Bootstrap vars overridden)
│   │   └── js/app.js       # Vanilla JS + Fetch + Bootstrap 5 (IIFE, state management)
│   ├── api/              # PHP API endpoints (all return JSON)
│   │   ├── bootstrap.php # Shared: Python interpreter detection, run_python(), library_root(), resolve_in_library(),
│   │                     #         json_out(), library_local_path
│   │   ├── config.php          # GET  - application configuration (library_path)
│   │   ├── tracks.php        # GET  - list tracks in folder
│   │   ├── metadata.php      # GET  - metadata of a single file
│   │   ├── save.php          # POST - save metadata + cover of a track
│   │   ├── bulk-update.php   # POST - bulk metadata / cover / remove-cover operations
│   │   ├── scan.php          # POST - scan a folder and return its tracks
│   │   ├── cover.php         # GET  - serve cover image (folder JPEG or embedded)
│   │   ├── audio.php         # GET  - stream audio with HTTP Range support
│   │   └── config.php        # Configuration loader (config.local.php > AUDIO_LIBRARY_OVERRIDE env > "")
├── config.example.php    # Template for local config (not committed)
├── Dockerfile            # Docker setup
├── docker-compose.yml    # Docker Compose configuration
├── .env.example          # Template for the Docker env variables (committed, no secrets)
├── .env                  # Local Docker env (NOT committed — machine-specific MUSIC_PATH)
├── start.sh              # PHP built-in web server starter
├── install.sh            # Installation script
├── requirements.txt      # Python: mutagen>=1.46
├── package.json          # (not present — vanilla JS, no build step)
└── PROJECT_CONTEXT.md    # ← This file (technical memory for future sessions)
```

## 3. Flusso frontend JavaScript → API PHP → backend Python

### Data flow (load library):

1. User enters library path in `#libraryPath` and presses **SCAN**
2. `loadLibrary()` in `app.js` → `fetch('api/tracks.php?path=' + encodeURIComponent(path))`
3. `tracks.php` → `resolve_in_library()` → validates path is inside configured library root
4. `run_python(['list_tracks', realpath])` via `comm.py` → `python/core.py:cli_command('list_tracks')`
5. `core.py:get_music_files(folder)` walks directory recursively (`os.walk`), finds files with extensions `.mp3`, `.flac`, `.m4a`
6. For each file, `track_info(path)` reads all metadata via `mutagen` (EasyID3 for MP3, FLAC/MP4 for others):
   - title, artist, album, album_artist, tracknumber, total, year, genre, duration
   - has_embedded_cover, covers (folder JPEG images, case-insensitive)
7. PHP returns JSON `{success:true, tracks:[...]}`
8. Frontend: `state.tracks = res.tracks`, `renderTable()` generates `<tr>` HTML, inserts into `#tracksBody`

### Data flow (save metadata):

1. User edits fields in details panel → `setPendingField(path, field, value)` → `state.pending.set(path, {...})`
2. Row gets `dirty-row` class, badge shows "UNSAVED"
3. User clicks **Save** → `saveTracks([...state.pending.keys()])`
4. `POST api/bulk-update.php` → `action: 'save'` + JSON body with tracks array
5. PHP iterates tracks → `run_python(['save', ...])` → `python/core.py:save_full()` writes tags + embeds cover if requested
6. On success: `state.pending.delete(path)`, `renderTable()` re-renders row with "SAVED" badge

### Player flow:

1. `buildPlaylistFromVisible()` → `visibleTracks()` → `playerState.playlist = list.map(t => t.path)`
2. `playTrack(index)` → `loadTrack(index)` → `audio.src = api/audio.php?path=...` (Range request support)
3. `updatePlayerTrackInfo(track)` → `mergedTrack(track)` merges original + pending, sets player UI
4. Global HTML5 player with play/pause, seek, next/previous, volume control
5. Per-track Play/Pause button (`btn-play-row`) per row

## 4. Lettura/salvataggio metadati, file audio, copertine e riproduzione

### Metadata fields (per format):

| Field | MP3 (.metadata key) | FLAC (.metadata key) | M4A (.metadata key) |
|-------|----------------------|----------------------|---------------------|
| Title | `title` | `title` | `\xa9nam` |
| Artist | `artist` | `artist` | `\xa9ART` |
| Album | `album` | `album` | `\xa9alb` |
| Album Artist | `albumartist` | `albumartist` | `aART` |
| Track # | `tracknumber` | `tracknumber` | `trkn` (track, total) |
| Total Tracks | `totaltracks` | `totaltracks` | not directly supported |
| Year | `date` | `date` | `\xa9day` |
| Genre | `genre` | `genre` | `\xa9gen` |
| Duration | `info.length` (MP3/FLAC) | `info.length` | `info.length` |

### Cover management:

- Folder JPEG/JPG images (case-insensitive) in same directory as audio file are detected automatically via `find_covers()`
- Covers are **never** re-encoded or modified on disk — only embedded into audio files when saving
- Embedded covers read via `mutagen` (APIC for MP3, pictures for FLAC, covr for M4A)
- "Remove Cover" deletes embedded artwork without touching source JPEG
- Cover modal shows: embedded current, folder JPEGs, option to remove

### Audio playback:

- PHP `audio.php` serves audio with HTTP Range request support for seeking
- Streamed via `<audio>` HTML5 element
- Preload metadata only (`audio.preload = 'metadata'`)
- Single-track playback only (stop previous when starting new)

## 5. Stato frontend, ricerca, filtri, modalità Lista e Artisti

### State object (`app.js`):

```javascript
const state = {
    libraryPath: '',       // configured music folder path
    tracks: [],            // array of track objects from backend (source of truth)
    pending: new Map(),    // path -> { field: value, cover?: path|'__remove__' }  (unsaved changes)
    selected: new Set(),   // Set of track paths currently selected (multi-select)
    currentPath: null,     // path of track whose details panel is open
    searchQuery: '',       // debounced search input value
    filterFormat: 'all',   // '.mp3', '.flac', '.m4a', or 'all'
    filterStatus: 'all',   // 'all', 'unsaved', 'saved'
    busy: false,           // whether a save/scan operation is in progress
    viewMode: 'tree',      // 'list' or 'tree' — default is 'tree' per requirement
    treeCache: null,       // cached tree structure for Artist->Album->Tracks grouping
};
```

### Ricerca e filtri:

- `visibleTracks()` returns filtered list based on:
  - `state.searchQuery` — matches against title, artist, album, filename, genre (combined search string)
  - `state.filterFormat` — filters by audio extension
  - `state.filterStatus` — 'unsaved' (tracks with pending changes), 'saved' (tracks without)
- Debounced at 150ms on `#searchInput` input event
- `updateCounts()` shows `visibleCount of state.tracks.length results`

### Modalità visualizzazione:

- **Default**: `viewMode: 'tree'` per requirement — shows Artist → Album → Tracks accordion tree
- **List mode** (`viewMode: 'table'`): shows original flat table (toggle via toolbar buttons)
- `syncViewUI()` updates visibility of `#listViewSection` / `#treeViewSection` and button active states
- On initial load with no library: `render()` → `renderTree()` shows "No tracks found" in tree view

### Raggruppamento Artista → Album → Tracce (tree view):

**Grouping keys (normalized, no metadata modification):**

- `norm(str)` — lowercase, trim, remove leading "The"/"A"/"An"
- `getArtistKey(track)` — `album_artist` if present and non-empty, otherwise `artist`; normalized
- `getAlbumKey(track)` — `artistKey + '\0' + albumNormalized` — distinguishes same-named albums by different artists
- Missing artist → `__unknown_artist__`; missing album → `__unknown_album__`

**Sorting (per requirement):**

- Artists: alphabetical by name
- Albums: by year ascending (albums without year at end), then by name
- Tracks: by tracknumber, then by filename

**Tree rendering structure (Bootstrap Collapse):**

- `#libraryTree` container with `role="tree"`
- **Artist nodes** (`artist-node`): expanded/collapsed viachevron, show cover thumbnail, album count + track count + total duration, checkbox to select/deselect all descendant tracks, play-all button
- **Album nodes** (`album-node`): nested inside artist, chevron to expand/collapse, show cover thumbnail, track count + duration + year, checkbox to select/deselect all tracks in album, play-all button
- **Lazy rendering**: album tracks `<table>` rendered only on first `shown.bs.collapse` event per album (via `renderAlbumTracks(albumKey)`). Placeholder shows "Loading tracks..." until then.
- **One-level-at-a-time accordion**: `data-bs-parent="#libraryTree"` on collapse elements ensures only one artist and one album per artist can be expanded simultaneously

### Selezione:

- **Track checkboxes** (`.select-track`): toggle individual track selection, call `toggleSelect(path)` → `render()` → `updateBulkBtn()`
- **Artist checkbox** (`.select-artist`): selects/deselects all tracks by that artist; indeterminate state for partial selection
- **Album checkbox** (`.select-album`): selects/deselects all tracks in that album; indeterminate state for partial selection
- **Album tracks header checkbox** (`.select-album-tracks`, lazy-rendered): selects/deselects all tracks in the lazy-loaded album table
- **Select All / Deselect All** toolbar buttons: call `selectAllVisible()` / `deselectAll()` → `visibleTracks()` → add/remove from `state.selected`
- `state.selected` is a `Set` of track `path` values — no duplication, selection is purely path-based
- Bulk edit modal pre-fills with values from `mergedTrack()` (pending + original); applying stages changes to `state.pending`

### Modifiche non salvate:

- `state.pending` Map tracks paths to pending field changes
- Row gets `dirty-row` CSS class, badge shows "UNSAVED"
- `setPendingField(path, field, value)` updates `state.pending` and re-renders table
- Details panel badge and "Discard Changes" button reset `state.pending.delete(path)` and re-render
- `saveTracks()` sends pending changes to API, on success removes paths from `state.pending`, re-renders tree

### Player / Playlist:

- `buildPlaylistFromVisible()` uses `visibleTracks()` respecting current search/filters
- `buildPlaylistFromArtist(artistKey)` / `buildPlaylistFromAlbum(albumKey)` build playlist from grouped view
- Play buttons on artist/album nodes set playlist and play first track
- `playTrackByPath(path)` finds track in visible list and plays it
- Next/previous wraps around playlist length
- Player state (`playerState`) is shared globally: `audio`, `currentIndex`, `playlist`, `isPlaying`, `volume`, `muted`

## 6. Endpoint API verificati, parametri, responsabilità e formati audio/metadati supportati

### Endpoint GET (no state mutation):

| Endpoint | Parametri | Restituisce | Note |
|----------|-----------|-------------|------|
| `api/config.php` | none | `{success:true, library_path: string}` | Library root path |
| `api/tracks.php?path=/folder` | `path` (optional) | `{success:true, tracks: [...]}` | Calls `cli_command('list_tracks', folder)` |
| `api/metadata.php?path=/file` | `path` | `{success:true, track: track_info}` | Calls `cli_command('get_info', file)` |
| `api/cover.php?path=/file` | `path`, `embedded=1` | cover image (base64 or JPEG) | `embedded=1` returns embedded cover of audio file |
| `api/audio.php?path=/file` | `path` | Audio stream with HTTP Range support | Preload metadata only |

### Endpoint POST (state mutation):

| Endpoint | Body | Responsabilità |
|----------|------|----------------|
| `api/save.php` | JSON: `{path, title, artist, album, album_artist, year, track, total, genre, cover?}` | Saves metadata + embeds cover if provided. Validates file exists via `resolve_in_library()`. |
| `api/bulk-update.php` | JSON: `{action: 'save'\|'cover'\|'remove_cover', tracks?: [...], paths? [...], image?}` | `action='save'`: saves metadata for multiple tracks; `action='cover'`: embeds same image into listed tracks; `action='remove_cover'`: removes embedded cover from listed tracks |
| `api/scan.php` | JSON or form: `{path: folder}` | Scans folder, returns tracks JSON (same format as `tracks.php`) |

**Tutte le risposte JSON usano pattern**: `{success: true/false, error?: string, detail?: string}`. Errori restituiscono HTTP 400/500 con JSON descrittivo.

### Responsabilità di sicurezza (PHP):

- `realpath()` + `resolve_in_library()` blocca path traversal fuori dalla libreria configurata
- `escapeshellarg()` su ogni argomento passato a Python
- Input validation before reaching Python
- Nessuna eliminazione, rinomina o cancellazione distruttiva di file audio o cover JPEG source

## 7. Configurazione, dipendenze e avvio

### 7.1 Variabile d'ambiente `MUSIC_PATH` (Docker)

Il percorso della libreria musicale **sul PC host** è configurabile tramite variabile
d'ambiente, così il repository può essere clonato e avviato su un PC diverso senza
modificare `docker-compose.yml`.

- **`docker-compose.yml`** monta la cartella host dentro il container:

  ```yaml
  volumes:
    - ${MUSIC_PATH:-./music}:/music
  ```

  - `MUSIC_PATH` = percorso **assoluto** sul host della cartella con la musica
  - il mount nel container resta `/music`, invariato
  - fallback `:-./music`: se `MUSIC_PATH` non è impostata (o è vuota) viene usata
    `./music`, cioè la cartella `music/` nella radice del progetto. Un percorso
    relativo in `.env` viene risolto rispetto alla cartella del progetto.
- **`AUDIO_LIBRARY_OVERRIDE=/music`** (in `docker-compose.yml`) è la radice libreria
  letta dal backend: `library_root()` in `web/api/bootstrap.php` dà precedenza a questa
  variabile, poi ad `AUDIO_LIBRARY_PATH` in `web/config.local.php`.

### 7.2 Ruolo di `.env` e `.env.example`

| File | Tracciato in Git | Contenuto |
|------|-----------------|-----------|
| `.env.example` | **sì** | Solo segnaposto documentato, nessuna credenziale |
| `.env` | **no** (`.gitignore:25`) | Valore reale di `MUSIC_PATH` per il PC locale |

Precedenza di Compose: variabile d'ambiente della shell **>** `.env` **>** fallback
`${MUSIC_PATH:-./music}`. Una shell con `MUSIC_PATH` vuota è trattata come non
impostata, quindi ricade su `.env`.

`.env` è escluso anche da `.dockerignore`, quindi il percorso locale non finisce
nell'immagine (come già accade per `web/config.local.php`).

### 7.3 Procedura di avvio su un nuovo PC

```bash
git clone <url-del-repository>
cd audio-metadati-manager
cp .env.example .env
# editare .env: MUSIC_PATH=/percorso/assoluto/della/musica
docker compose up -d --build
```

Poi aprire `http://localhost:8000`.

**Requisiti del percorso host:**

- la cartella **deve esistere**: se non esiste Docker crea una cartella vuota e la
  libreria risulterà vuota;
- **deve essere accessibile a Docker**: su macOS e Windows la cartella deve essere
  condivisa con Docker Desktop (le directory `HOME`, `/Volumes` e `/private` sono
  già condivise per impostazione predefinita);
- il container deve potervi **scrivere**: i metadati e la copertina incorporata
  vengono scritti nei file audio.

### 7.4 Configurazione non-Docker

La logica PHP/JS/Python non è stata modificata. Senza Docker il percorso si imposta
come prima: `web/config.local.php` (non tracciato) oppure la variabile
`AUDIO_LIBRARY_OVERRIDE` / il percorso digitato nell'interfaccia.

## 8. Player audio migliorie (2026-10-15)

### Miglioramenti al player musicale

- **Pulsante Chiudi (X)**: aggiunto `#playerCloseBtn` nella barra player (`index.php:207`). Cliccando la X si nasconde il pannello player senza interrompere la riproduzione audio. Per riaprirlo basta cliccare una traccia della lista/albero (il player ripristina lo stato corrente senza riavviare). Il pulsante ha `aria-label="Chiudi player"` e un'etichetta visiva nascosta (`<.visually-hidden>`) per l'accessibilità. Il layout è stato riorganizzato usando Flexbox: il bottone si posiziona a destra della riga dei controlli, sulla stessa linea di titolo e altri pulsanti, senza andare a capo.

- **Colore della X**: il pulsante `.btn-close-player` usa ora il colore oro `var(--gold)` con un contrasto sufficiente sullo sfondo scuro. Al passaggio del mouse il colore diventa `var(--gold-soft)` (più chiaro), mentre al focus compare un bordo oro spesso (`outline: 2px solid var(--gold)`) per migliorare l'accessibilità. I valori `var(--gold)` e `var(--gold-soft)` sono definiti nelle variabili CSS del tema scuro.

- **Equalizzatore animato**: 5 barre `.equalizer-bar` animate con keyframe `pulse`. L'animazione parte automaticamente quando la traccia inizia a suonare (`audio.addEventListener('play')`), si ferma in pausa (`audio.addEventListener('pause')`) e quando la traccia finisce (`audio.addEventListener('ended')). Rispetta `prefers-reduced-motion`: le barre si disattivano immediatamente se l'utente ha richiesto la riduzione dei movimenti (`@media (prefers-reduced-motion: reduce)`). L'aggiornamento dello stato è sincronizzato con gli eventi `timeupdate` dell'audio e con i cambi di stato di `playerState.isPlaying`. Le barre sono visibili accanto ai controlli del player e animarsi quando la musica è in riproduzione.

### Test effettuati

- `node --check` su `app.js`: Syntax OK
- Test unitari Node.js: lookup chiavi safe, alberi filtrati, edge cases — TUTTI PASSANO
- Test BUG 2: sync artist/album_artist — 6 casi — TUTTI PASSANO
- End-to-end: salvataggio tag + lettura Mutagen + API confermata
- Verifica struttura HTML player: pulsante close presente, equalizer bars presenti, ARIA labels corrette
- Verifica CSS: equalizer animation, prefers-reduced-motion media query, close button styling
- Verifica server: HTML served correttamente con tutti gli elementi, CSS e JS inclusi
- Verifica comportamentale: ricaricamento cartella predefinita, player controls, equalizer animation, pulsante floating

### File modificati

- `web/index.php`: removed `#saveAllBtn` toolbar button, added `onclick="discardBulkChanges()"` to bulk modal Annulla button, changed bulk Apply button text to "Salva modifiche"
- `web/assets/js/app.js`: 
  - `.badge-app-dark` class added to badges on Edit Selected and Save-area buttons for dark background
  - `applyBulk()` now saves changes directly via `saveTracks()` instead of just staging them
  - `discardBulkChanges()` function added to clear pending changes without saving
  - `applyCover()` no longer auto-closes the cover modal — selection keeps dialog open
  - removed `#saveAllBtn` click handler and related code
- `web/assets/css/style.css`: added `.badge-app-dark` with dark background (`var(--bg)`), hover/focus states, and gold outline for accessibility

### Vincoli rispettati

✓ Vista List invariata
✓ Vista Artists invariata
✓ Albero Artists/List invariato
✓ Selezione invariata
✓ Filtri e ricerca invariati
✓ Track Details invariato
✓ Player enhancements (nuove funzionalità sopra l'esistente)
✓ Playlist invariata
✓ Copertine invariato
✓ Nessuna nuova dipendenza
✓ Nessun commit/push