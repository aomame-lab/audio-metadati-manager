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
    viewMode: 'artists',   // 'artists' (Artist->Album->Track) | 'tracks' (flat list)
    expandedArtists: new Set(), // artist keys currently expanded
    expandedAlbums: new Set(),  // album keys currently expanded
    totals: { artists: 0, albums: 0 }, // computed on the WHOLE library, not on filters
};
```

Il modello gerarchico lives in a module-level `libraryModel`, rebuilt by
`buildLibraryModel()` on every full render and dropped when the library reloads.

### Ricerca e filtri:

- `visibleTracks()` returns filtered list based on:
  - `state.searchQuery` — matches against title, artist, album, filename, genre (combined search string)
  - `state.filterFormat` — filters by audio extension
  - `state.filterStatus` — 'unsaved' (tracks with pending changes), 'saved' (tracks without)
- Debounced at 150ms on `#searchInput` input event
- `updateCounts()` shows `visibleCount of state.tracks.length results` in BOTH footers
  (`#resultInfo` flat list, `#treeResultInfo` hierarchy) and fills the **single**
  summary `#libraryStats`, which lives **inside the existing `#trackCountBadge`** of the
  header. There is no second summary area: the old `.library-stats` paragraph under the
  library title was removed.
  - Tracks / artists / albums come from `state.tracks` and `state.totals` (whole
    library, unaffected by filters); `N sel.` appears only when `state.selected.size > 0`;
    `N unsaved` only when `state.pending.size > 0`
  - `.library-badge` keeps the summary on one line and shrinks under 576px

### Modalità visualizzazione:

- **Default**: `viewMode: 'artists'` — the hierarchy is the primary navigation
- **List mode** (`viewMode: 'tracks'`): the original flat table, kept intact
- Toolbar `btn-group` `#viewArtistsBtn` / `#viewTracksBtn` toggles the mode;
  `syncViewUI()` swaps `#artistViewPanel` / `#trackViewPanel` (`hidden`) and the
  `.active` button state
- `renderView()` is the single render entry point: it calls `syncViewUI()`,
  renders the active view, then `updateCounts()`

### Vista gerarchica Artista → Album → Tracce (`app.js`)

**Nessuna modifica al backend e nessuna richiesta HTTP aggiuntiva**: `api/tracks.php`
already returns every metadata field in a single call, so the grouping is computed
in memory from `visibleTracks()`.

**Chiavi di raggruppamento (normalizzate, nessun metadato viene modificato):**

- `foldKey(value)` — NFD + rimozione diacritici, lowercase, spazi collassati, trim.
  Usata sia per il raggruppamento sia per la ricerca, così `"luci"` trova
  `"Luci d'Inverno"` e `"BJÖRK"` trova `"Björk"`.
- Artista: `album_artist` se presente e non vuoto, altrimenti `artist`, altrimenti
  `UNKNOWN_ARTIST` ("Unknown artist"). Chiave `foldKey(nome) || '__unknown__artist'`.
- Album: `albumKeyOf(artistKey, albumName)` = `len(artistKey) + ':' + artistKey + ':' + foldKey(album)`
  (o `'__unknown__album'`). **Il prefisso di lunghezza rende la concatenazione
  iniettiva**: artista `"a b"` + album `"c"` non collide con artista `"a"` + album
  `"b c"`. Vedi la nota sui caratteri di controllo nella sezione 9.
- Un brano senza album non viene nascosto: finisce sotto l'album "Unknown album"
  dello stesso artista.
- Un file compare una sola volta: `buildLibraryModel()` deduplica per `path`.

**Ordinamento:**

- Artisti: `localeCompare(..., {sensitivity:'base', numeric:true})`; "Unknown artist" per ultimo
- Album: per anno crescente, album senza anno in fondo, poi per nome
- Tracce: per numero traccia, poi per filename

**Struttura DOM ed espansione indipendente:**

```
.artist-node
  .artist-row                              <- toggle artista (Bootstrap Collapse)
  .collapse.artist-body                    <- UNICO collapse dell'artista
    .artist-body-grid                      <- griglia: card album (1 cell) + blocchi tracce (1/-1)
      .album-card                          <- copertina + titolo/anno/checkbox/conteggio
      .album-tracks  [hidden]              <- contenitore DEDICATO delle tracce, FRATELLO della card
        .album-tracks-head
        .album-tracks-body                 <- .track-list-compact (lazy)
      .album-card
      .album-tracks  [hidden]
```

- I blocchi tracce **non** stanno dentro `.album-card` (che è larga ~148px) né dentro
  `.artist-children`/`.album-grid`: sono fratelli diretti nella griglia e occupano
  l'intera larghezza (`grid-column: 1 / -1`), così l'ordine visivo è
  artista → album → tracce **del relativo album**, con indentazione chiara.
- **Solo l'artista usa Bootstrap Collapse.** L'espansione di un album è governata
  dall'attributo `hidden` del proprio blocco (`setAlbumTracksVisible()`), quindi:
  - aprire/chiudere un album non ha effetti collaterali sugli album vicini;
  - il collapse dell'artista nasconde visivamente tutta la sezione (album + tracce)
    perché li racchiude entrambi, ma **non** modifica `state.expandedAlbums`;
  - riaprendo l'artista ogni album torna esattamente nello stato precedente e i
    blocchi non vengono ricostruiti (nessuna duplicazione di tracce).
- `ensureAlbumTracks(el)` riempie solo `.album-tracks-body` ed è idempotente
  (`dataset.filled`).

**Rendering lazy (nessun reload di pagina):**

- `renderArtistTree()` renderizza **solo** le righe artista nel contenitore `#artistTree`
- I figli sono materializzati al primo `show.bs.collapse`, che è **delegato** su
  `#artistTree` (gli eventi Bootstrap fanno bubbling, quindi un solo listener):
  - `ensureArtistChildren(el)` → `.artist-body-grid` con le coppie card + blocco tracce
  - `ensureAlbumTracks(el)` → riempie `.album-tracks-body` con `.track-list-compact`
  - entrambe sono idempotenti: `el.dataset.filled === '1'` evita il doppio render
- Il listener `show.bs.collapse` / `hidden.bs.collapse` **ignora** tutto ciò che non è
  `data-children-of="artist"`: non c'è più un collapse annidato da intercettare
- Lo stato di espansione vive in `state.expandedArtists` / `state.expandedAlbums`, quindi
  un re-render (salvataggio, cambio filtro, cambio vista) **ripristina** what was open
- Con una ricerca attiva tutti gli artisti e gli album vengono aperti automaticamente,
  così la traccia che corrisponde è raggiungibile senza espandere a mano
- `cssEscape()` escape solo `"` e `\` per selettori ad attributo quotati: **non**
  delega a `CSS.escape`, che escaperebbe anche gli spazi (legali dentro le virgolette)
  e romperebbe il lookup. Gli `id` DOM (`ar-N`, `al-N`) sono basati sulla posizione,
  mai sulle chiavi, perché una chiave può contenere `:` o virgolette

**Interazione (tutto delegato su `#artistTree`):**

- `.artist-row` → `toggleArtistNode(key)` → `bootstrap.Collapse.toggle()`
- `.album-cover-btn` → `toggleAlbumNode(key)`
- `.tv-edit-btn` o click sulla riga → `showDetails(path)` (pannello dettagli esistente)
- Tastiera: `Enter` / `Spazio` su riga artista e card album
- `.tv-check`, `.artist-check`, `.album-check` → `change` delegato

**Copertine:** riutilizzano `effectiveCoverUrl(track)` e `coverImgHtml()` dell'app
esistente; l'anteprima dell'artista è il primo album con copertina, quella dell'album
è il primo brano con copertina. Nessun secondo sistema di gestione immagini.

### Selezione:

- **Checkbox di brano** (`.tv-check`): `toggleSelect(path)` → `afterSelectionChange()`,
  che NON ricostruisce l'albero ma chiama `syncSelectionUi()` (aggiorna solo i
  checkbox e i contatori già renderizzati) — evita re-render a ogni click
- **Checkbox di artista** (`.artist-check`) e **di album** (`.album-check`):
  `setGroupSelection(key, checked, kind)` seleziona/deseleziona tutti i brani del gruppo,
  con stato *indeterminate* quando la selezione è parziale
- **Contatori**: `.artist-stats` mostra `selezionati/totale`; la card album mostra un badge
- `state.selected` è un `Set` di `path`: espandere/comprimere non lo tocca
- Pulsanti Select / Deselect della toolbar → `selectAllVisible()` / `deselectAll()`
- Il comando "Edit Selected" (`#bulkBtn`) e il relativo dialog funzionano invariati:
  le checkbox della gerarchia alimentano lo stesso `state.selected`

### Modifiche non salvate:

- `state.pending` Map tracks paths to pending field changes
- Riga tabella: classe `dirty-row`; riga gerarchica: classe `tv-dirty` + pallino
  `.tv-dot.is-dirty` + etichetta `UNSAVED`
- `setPendingField(path, field, value)` fa un **patch mirato** nella vista gerarchica
  (`patchTrackNode(path)`) invece di un re-render completo, così la gerarchia non
  collassa mentre si digita; chiama comunque `updateCounts()` per l'indicatore
  "unsaved" dell'intestazione
- `saveTracks()` sends pending changes to API, on success removes paths from
  `state.pending`, recomputes totals and re-renders the active view

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
## 9. Vista libreria Artisti → Album → Brani (2026-10-16)

### Scelte progettuali

- **Frontend-only.** `api/tracks.php` restituisce già tutti i campi metadata in una
  sola richiesta, quindi il raggruppamento avviene in memoria: nessuna nuova API,
  nessun endpoint duplicato, **zero richieste HTTP per brano**.
- **Il backend non è stato toccato.** Nessun file in `web/api/`, `python/` o
  `python/comm.py` è stato modificato.
- **Vista lista conservata.** La gerarchia è la vista predefinita; la tabella piatta
  esistente resta raggiungibile con un toggle, così le funzionalità già valide non
  vengono perse.
- **Nessun secondo sistema di salvataggio o di copertine.** La gerarchia riusa
  `showDetails()`, `saveTracks()`, `setPendingField()`, `mergedTrack()`,
  `effectiveCoverUrl()`, `state.pending` e `state.selected`.
- **Markup sicuro.** Ogni valore proveniente dai metadata passa da `esc()` prima di
  finire in HTML; `highlight()` escapa e poi evidenzia, senza costruire mai markup da
  stringhe grezze.

### Errori trovati e corretti durante il collaudo

1. **Byte NUL (0x00) nella sorgente JS.** Due separatori di chiave album erano byte NUL
   letterali. Nell'HTML un NUL dentro un attributo diventa U+FFFD, quindi la chiave
   letta dal DOM non combaciava più con quella del modello e l'espansione degli album
   non caricava le tracce. Risolto con `albumKeyOf()` a lunghezza prefissata, che è
   iniettiva e usa solo caratteri stampabili.
2. **ID DOM derivati dalle chiavi.** Contenevano `:` e virgolette, quindi erano
   selettori CSS non validi (`querySelector` solleva `SyntaxError`). Gli ID ora sono
   posizionali (`ar-0`, `al-3`); le chiavi restano solo in attributi `data-*`.
3. **`CSS.escape` non adatto.** DelegaProduceva selettori non validi per chiavi con
   spazi. Sostituito da `cssEscape()` che escape solo `"` e `\`.
4. **Contatore "unsaved" fermo nella vista gerarchia.** `setPendingField()` non
   chiamava `updateCounts()` nel ramo artists: l'intestazione non mostrava le
   modifiche non salvate. Corretto.

### Test effettuati

Collaudo reale in **Google Chrome headless** (non simulato), contro una libreria di
test costruita appositamente con 9 brani su 5 artisti, di cui: artista con 2 album,
album con più braci, brano senza artista/album/anno/copertina, album senza anno,
brano senza album, nomi con accenti e nomi simili.

- **Suite interattiva: 63 test, 63 PASS** (espansione/compressione ripetuta,
  selezione multipla tra album diversi, selezione tramite checkbox artista con stato
  indeterminato, modifica singola + scarto, salvataggio reale con verifica del titolo
  aggiornato senza reload, ricerca con rivelazione dei livelli genitori, ricerca senza
  accenti, ricerca case-insensitive, stato vuoto, conteggi, cambio vista)
- **Controllo console: 0 errori JS** dopo un percorso completo (espansione di tutti
  gli artisti, selezione, filtri, ricerca, cambio vista, reload)
- **Prestazioni:** 10 140 brani / 60 artisti → 60 righe artista, 0 album card e 0
  track row al primo render (lazy confermato), ~517 ms totali incluso il parsing del
  JSON da 3,3 MB
- **Docker Compose:** `docker compose build` + `up -d` eseguiti; 17 test di
  interazione sulla libreria reale (Soundgarden) → 17 PASS; nessun file audio
  dell'utente modificato (il test usa Annulla, non Salva)

Limiti dichiarati: il backend impiega ~62 s per restituire 10 140 brani (lettura
mutagen file per file) — è un comportamento preesistente di `list_tracks`, non
introdotto dalla vista. La validazione visiva (layout, responsive, transizioni) è
stata fatta sul DOM e sul comportamento, non con uno screenshot.

### File modificati

- `web/index.php` — intestazione libreria (`#libraryStats` + ricerca), toggle vista,
  pannello gerarchico `#artistViewPanel` con `#artistTree`, lista piatta in
  `#trackViewPanel`
- `web/assets/js/app.js` — stato (`viewMode`, `expandedArtists`, `expandedAlbums`,
  `totals`), `libraryModel`, `foldKey()`, `albumKeyOf()`, `buildLibraryModel()`,
  `renderArtistTree()`, `ensureArtistChildren()`, `ensureAlbumTracks()`,
  `renderView()`, `syncViewUI()`, `syncSelectionUi()`, `patchTrackNode()`,
  `afterSelectionChange()`, `computeTotals()`, `wireLibraryTree()`,
  `toggleArtistNode()`, `toggleAlbumNode()`, `setGroupSelection()`
- `web/assets/css/style.css` — sezione "Library view": intestazione, toggle, righe
  artista, griglia album, tabelle compatte, indicatori di stato

## 10. Espansione album indipendente e conteggi nell'header (2026-10-16)

### Modifiche

**Header e conteggi.** La riga `<p class="library-stats">` sotto il titolo della libreria
è stata rimossa. Il riepilogo vive ora **dentro il badge `#trackCountBadge`** che era già
presente nell'header (`<span id="libraryStats">`), quindi non esiste una seconda area di
riepilogo. Contenuto: `N tracks · N artisti · N albumi`, con `N sel.` quando ci sono
selezioni e `N unsaved` quando ci sono modifiche pendenti. `.library-badge` mantiene il
testo su una riga e riduce font/padding sotto 576px. L'elemento `#trackCount` è stato
rimosso (era un duplicato del conteggio tracce).

Significato dei conteggi invariato:
- tracce / artisti / album = **libreria intera** (`state.tracks`, `state.totals`), non filtrati
- selezionati = `state.selected.size`, non salvati = `state.pending.size`

**Struttura della gerarchia.** I blocchi tracce sono usciti da `.album-card` e dal
contenitore dei figli dell'artista: ora sono elementi dedicati `.album-tracks`, fratelli
diretti delle card dentro `.artist-body-grid`, con `grid-column: 1 / -1`. L'espansione
non usa più Bootstrap Collapse ma l'attributo `hidden`, così ogni album è governato da
solo. Bootstrap Collapse è rimasto solo per l'artista, che racchiude album e tracce.

Conseguenze verificate: aprire/chiudere un album non tocca gli altri; comprimere
un artista nasconde album e tracce senza cancellare `state.expandedAlbums`; riaprendolo
ogni album torna allo stato precedente e i blocchi non vengiono ricreati (nessuna
duplicazione). Non sono stati usati workaround CSS: la separazione è strutturale.

### Bug introdotto e corretto durante il collaudo

Rinominando `.artist-children` → `.artist-body`, `toggleArtistNode()` era rimasta che
cercava la classe vecchia e restituiva subito: **nessun artista era più espandibile**.
Rilevato dal test "l'altro artista indipendente" e corretto verificando l'assenza di
riferimenti obsoleti.

### Test effettuati

Collaudo reale in Google Chrome headless su una libreria di prova (9 brani, 5 artisti,
artisti con più album, album senza anno, brani senza album/artista/copertina).

- **Suite struttura + espansione: 50/50 PASS** — due album aperti insieme, chiusura di
  uno senza effetti sull'altro, chiusura/riapertura ripetuta di album e artisti, stato
  preservato, nessuna duplicazione, selezione su album diversi, editing singolo, scarto,
  bulk (confermato che senza campi compilati non scrive nulla), ricerca in album chiuso,
  conteggi header
- **Console: 0 errori JS** dopo apertura/chiusura ripetuta di ogni album e artista,
  selezioni, filtri, ricerca, cambio vista e reload
- **Prestazioni**: 10 140 brani / 60 artisti → 60 righe artista, 0 album e 0 tracce al
  primo render, ~564 ms incluso il parsing del JSON
- **Docker Compose**: build + `up -d` eseguiti; suite finale **23/23 PASS** sulla
  libreria reale, con asspettative derivate dai dati reali (2 album, 12 + 3 brani)

Nota: i test su Docker usano solo "Annulla"/"Discard", non salvano sui file dell'utente.
Al momento del collaudo la libreria reale conteneva metadata già modificati
(album `test`, genre `Grung`) con mtime delle 13:10:47, valori **assenti da ogni file
del progetto**: non sono stati scritti dai test automatici.

### File modificati

- `web/index.php` — badge `#trackCountBadge` con `#libraryStats`, rimozione del
  `<p class="library-stats">`
- `web/assets/js/app.js` — `updateCounts()` scrive nel badge; `albumTracksHtml()`;
  `setAlbumTracksVisible()`; `toggleAlbumNode()` senza Collapse; `artistRowHtml()` con
  `.artist-body` / `.artist-body-grid`; `ensureArtistChildren()`; `ensureAlbumTracks()`;
  listener `show/hidden.bs.collapse` limitati al livello artista; rimozione di
  `syncAlbumChevron()`
- `web/assets/css/style.css` — `.library-badge`, `.library-stats-inline` (con override
  per schermi stretti), `.artist-body`, `.artist-body-grid`, `.album-tracks[hidden]`,
  `.album-tracks-head/-name/-count`
