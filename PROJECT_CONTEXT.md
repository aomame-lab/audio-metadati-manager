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

## 11. Cartelle musicali — mount multipli e persistenza (2026-10-19)

### Punto di partenza verificato

Il progetto **non usa alcun database**: nessun SQLite, nessun PDO, nessuna
migrazione. La libreria vive in memoria nel browser (`state.tracks`) e viene
ricostruita rilanciando la scansione Mutagen. L'unico stato persistente era
l'assenza di stato. I file sono identificati dal **percorso assoluto** (`track.path`),
validato lato server da `resolve_in_library()`.

### Scelte progettuali

- **Nessuna dipendenza nuova.** Il progetto dichiara esplicitamente «no PHP
  extensions or Composer required»: la persistenza delle cartelle è un file JSON
  (`data/music-folders.json`, o `AUDIO_DATA_DIR` / volume `audio-data`) scritto in
  modo atomico (tmp + rename) sotto `flock()`. SQLite era disponibile
  (`pdo_sqlite` è compilato in `php:8.2-cli`) ma avrebbe aggiunto uno schema e
  una migrazione per una dozzina di record. Il campo `version` nel JSON è
  l'hook per una futura migrazione: le versioni successive normalizzano in
  lettura e lasciano intatti i file esistenti.
- **Compose non ha mount condizionali.** Verificato con `docker compose config`:
  una variabile vuota ricade sul default (`${MUSIC_PATH_2:-./x}`), e un default
  vuoto è un errore fatale (`empty section between colons`). I mount extra usano
  quindi la **sintassi lunga** con `bind.create_host_path: false`: se
  `MUSIC_PATH_2` punta a una cartella inesistente Docker **fallisce rumorosamente**
  invece di creare silenziosamente una cartella vuota. Il default è
  `docker-placeholder/musicN`, cartella vuota presente nel repo.
- **I mount sono read-write, anche quelli extra.** Prima versione di questa
  modifica montava `MUSIC_PATH_2` con `read_only: true`: la collaudo reale su
  Docker l'ha mostrato subito — `save.php` sul secondo mount rispondeva
  `[Errno 30] Read-only file system`. L'applicazione *scrive* i tag e la
  copertina incorporata dentro i file audio, quindi read-only non è possibile
  senza rompere una funzione esistente: tutti i mount musicali sono rw, come
  `/music` lo è sempre stato, e il README spiega come dichiarare `read_only`
  volendolo. `cover_storage_root()` mette comunque le copertine temporanee di
  `upload-cover.php` nella **prima root scrivibile`, così un mount che l'utente
  ha reso read-only non rompe il caricamento multiplo.
- **Il browser non invia mai un percorso assoluto.** `browse.php` accetta
  `root` (identificatore) + `path` (relativo). `normalize_music_rel_path()`
  rifiuta assoluti, `..`, byte NUL e percorsi troppo lunghi; `resolve_music_rel()`
  valida con `realpath()` e controlla il prefisso sulla root canonica, quindi un
  symlink che esce dal mount viene rifiutato. L'elenco delle directory non offre
  neppure i symlink che sfuggono: ogni voce è validata con `realpath()`.
- **Nessuna seconda implementazione di scansione.** `library.php` riusa
  `run_python(['list_tracks', <dir>])`, cioè lo stesso identico chiamato di
  `tracks.php`/`scan.php`. Il merge e il de-duplicato stanno in PHP.
- **Identità del file = `realpath()`.** Due cartelle sovrapposte (padre e figlio,
  o due root sullo stesso disco) producono lo stesso percorso canonico: la
  chiave `realpath → track` in `library.php` garantisce una sola importazione
  senza dipendere dall'ordine dei mount. I path restano assoluti: nessuna
  migrazione dello schema esistente e nessun cambiamento lato frontend
  (`api/cover.php`, `api/audio.php`, `api/save.php` continuano a funzionare).
- **`resolve_in_library()` generalizzato, non sostituito.** Accetta l'unione di
  tutte le root. Se **nessuna** root configurata è risolvibile (setup vecchio
  senza root, o root inesistente) mantiene il comportamento preesistente
  (accetta qualunque percorso esistente): è la condizione in cui il progetto
  storico era permissivo, e rimuoverla avrebbe rotto quegli utenti.
- **Rimozione = solo record.** `library_folders_remove()` toglie una riga dal
  JSON. Nessun file, metadato, copertina o directory host viene toccato. Quando
  una cartella non è più registrata i record spariscono dal prossimo scan perché
  la libreria *è* la lista delle cartelle registrate; le voci già in memoria nel
  browser restano visibili fino al reload successivo (comportamento
  conservativo, nessuna cancellazione distruttiva).

### File aggiunti

- `web/api/library-roots.php` — root autorizzate, normalizzazione percorsi
  relativi, validazione canonica, listing incrementale
- `web/api/library-folders.php` — store JSON persistente (add/remove/list)
- `web/api/browse.php` — endpoint esploratore (una directory per volta)
- `web/api/folders.php` — CRUD delle cartelle registrate
- `web/api/library.php` — scansione multi-cartella con merge e de-duplicato
- `tests/run-tests.php`, `tests/_endpoint_runner.php` — suite PHP senza dipendenze
- `tests/test_scan.py` — suite Python (mutagen) su fixture MP3 silenti
- `tests/check-compose.sh`, `tests/check-http.sh` — validazione Compose e HTTP
- `docker-placeholder/music2/.gitkeep`, `docker-placeholder/music3/.gitkeep`

### File modificati

- `docker-compose.yml` — 2 mount extra (sintassi lunga, `create_host_path:false`),
  volume `audio-data`, `AUDIO_MUSIC_ROOTS`, `AUDIO_DATA_DIR`
- `.env.example`, `README.md` — `MUSIC_PATH_2/3`, diagnostica, sezione Tests
- `web/api/bootstrap.php` — require dei due moduli, `library_root()` delegata,
  `resolve_in_library()` su tutte le root, `cover_storage_root()`
- `web/api/config.php` — aggiunge `roots[]` e `folders_configured`
- `web/api/upload-cover.php` — usa `cover_storage_root()`
- `web/index.php` — pulsante `#foldersBtn` nel **toolbar** (header invariato) e
  modale `#foldersModal`
- `web/assets/js/app.js` — stato `roots`/`folders`, sezione "Music folders dialog",
  `loadLibrary()` sceglie `api/library.php` quando esistono cartelle registrate
  e altrimenti mantiene `api/tracks.php`; `setBusy()` include `foldersBtn`;
  `api()` espone `err.status`
- `web/assets/css/style.css` — pannelli, voci cartella, stato, browser directory,
  regole per schermi < 576px
- `.gitignore` / `.dockerignore` — `data/` escluso

### Test effettuati (risultati reali)

- `php tests/run-tests.php` → **32/32 PASS** (con `AUDIO_PYTHON_BIN` puntato
  a un venv con mutagen 1.48.1). Copre: solo `MUSIC_PATH`, mount multipli,
  voci malformate, eredità senza root, root scrivibile, listing/navigazione,
  `..`/percorsi assoluti, symlink che esce dalla root, root scollegata,
  id root ignoto, add/remove/persistenza tra processi, duplicati con varianti
  di percorso, padre+figlio senza doppia importazione, store corrotto,
  regressione `config.php` / `tracks.php` / `metadata.php` / `save.php`.
- `.venv/bin/python tests/test_scan.py` → **8/8 OK**.
- `./tests/check-compose.sh` → **4/4 PASS** (`docker compose config` in 4 scenari).
- `AUDIO_PYTHON_BIN=... ./tests/check-http.sh` → **24/24 PASS** (server PHP reale,
  body JSON via `php://input`, inclusi).
- Chrome headless (CDP, driver senza npm) → **21/21 PASS** sul dialog ( apertura,
  navigazione su/giù, cambio root, aggiunta, duplicato respinto con toast,
  rimozione con conferma, badge) e **11/11 PASS** sul flusso completo
  (2 cartelle su 2 root → 4 brani merged senza duplicati, root scollegata,
  stats, footer).
- Chrome headless, viewport 375px → il modale entra nello schermo
  (359px, nessun elemento del modale fuori viewport). **Limite preesistente
  non introdotto qui**: `document.scrollWidth` = 577px a 375px per l'offcanvas
  `#detailsOffcanvas` (confermato anche in `HEAD:web/index.php`), non toccato
  in questa modifica.

### Limiti dichiarati

- `library.php` lancia un processo Python per cartella registrata: con molte
  cartelle il tempo di scansione cresce linearmente. È il comportamento
  preesistente di `list_tracks` (già nota: ~62 s per 10 140 brani), non una
  nuova introduzione; il parallelismo non è stato aggiunto per non cambiare la
  pipeline esistente.
- La persistenza è su file: adatta a decine di cartelle, non a migliaia.
- La validazione visiva è fatta sul DOM e sul comportamento reale in Chrome
  headless, non su screenshot.

## 12. Guard di accesso diretto sui file interni (2026-10-19)

### Causa verificata

`web/api/library-roots.php` e `web/api/library-folders.php` rispondevano
**HTTP 200 con body vuoto e `Content-Type: text/html`**. Verificato che **non
era un errore fatale**:

- `php -l` pulito sui tre file dentro il container;
- `display_errors=1` dentro il container, e un errore fatale di prova
  (`Call to undefined function`) produce un body da **220 byte** con il
  messaggio: quindi un body da **0 byte** non può essere un fatale nascosto;
- i tre file sono **solo dichiarazioni** (funzioni, costanti): non emettono
  output quando vengono inclusi;
- sono inclusi **solo** da `web/api/bootstrap.php`; il frontend non li richiede
  mai (`grep` su `app.js` e `index.php`: nessun riferimento).

Il `Content-Type: text/html` è il default del server PHP integrato: a differenza
di `bootstrap.php`, i due moduli non chiamano mai `header()`.

La causa è quindi strutturale: **i file di libreria vivono dentro la document
root** servita da `php -S -t /app/web`, quindi sono raggiungibili via URL anche
se non sono endpoint.

### Difetto reale (e non è la feature "Cartelle musicali")

Un `200` con body vuoto è la **peggiore firma di guasto** possibile: il client
fa `fetch(...).then(r => r.json())` e riceve `SyntaxError: Unexpected end of
JSON input` senza alcun messaggio utile, mentre un monitor vede "200 = healthy".
In produzione, dove `display_errors=Off`, un vero errore fatale produce esattamente
lo stesso body vuoto: le due situazioni erano indistinguibili.

L'insieme di file interessati era **più ampio** di quanto segnalato:
`web/config.php`, `web/config.example.php` e `web/api/bootstrap.php` avevano lo
stesso problema.

### Correzione minima applicata

Un guard di accesso diretto identico in ciascuno dei 5 file include-only:

```php
if (isset($_SERVER['SCRIPT_FILENAME'])
    && @realpath((string) $_SERVER['SCRIPT_FILENAME']) !== false
    && @realpath((string) $_SERVER['SCRIPT_FILENAME']) === @realpath(__FILE__)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'error' => 'Internal file, not an API endpoint']);
    exit;
}
```

- Rilevato con `SCRIPT_FILENAME === __FILE__`, che è la condizione esatta usata
  dal server PHP integrato (verificata dentro il container), e che **non**
  scatta quando il file è incluso da un endpoint né in CLI (suite di test).
- Il guard è dichiarato **in ciascun file** e non in un helper condiviso: un
  helper dentro la document root sarebbe raggiungibile esattamente come gli
  altri, quindi si riprodurrebbe il problema.
- Nessun endpoint è stato toccato: il comportamento di `config.php`,
  `folders.php`, `browse.php`, `library.php`, `tracks.php`, `save.php`,
  `cover.php` e `audio.php` è identico a prima.

### Test aggiunti

- `every include-only file refuses direct access with an explicit JSON error` —
  i 5 file rispondono 403 + JSON con messaggio.
- `the guard does not break the normal include chain` — config/roots/funzioni
  ancora disponibili dopo il guard.
- `every PHP file under web/api is either an endpoint or guarded` — un nuovo
  file in `web/api` deve essere dichiarato endpoint o interno, altrimenti il
  test fallisce (previene la regressione futura).
- `no endpoint ever answers with an empty body, on success or on error` — 13
  probe su successo e errore di ogni endpoint.
- `a POST to an endpoint answers with JSON, never with an empty body` — 7 POST
  malformate.
- `the data volume is not touched by a refused or empty request`.
- `run_api_file()` in `tests/run-tests.php` **fallisce su body vuoto**: la
  garanzia è ora nel codice di test, non solo nelle asserzioni.
- `tests/_endpoint_runner.php` ha il flag `direct`, che riproduce
  `SCRIPT_FILENAME = <file richiesto>` come fa il server reale.
- `tests/check-http.sh`: 5 check sui file interni serviti + 10 probe "no empty
  bodies" su server PHP reale.

### Test effettuati (risultati reali)

- `php tests/run-tests.php` → **38/38 PASS** (con mutagen), **38/38 con 6 skip**
  (senza mutagen). Erano 32/32: +6 test.
- `.venv/bin/python tests/test_scan.py` → **8/8 OK**.
- `./tests/check-compose.sh` → **4/4 PASS**.
- `AUDIO_PYTHON_BIN=… ./tests/check-http.sh` → **tutti PASS** (era 24/24, ora
  include le 15 nuove asserzioni sui file serviti).
- lint PHP/JS/Python/shell + `docker compose config --quiet` → OK.
- **Container reale**: `docker compose up -d --build` (senza toccare `.env`, senza
  rimuovere volumi) → `healthy`. Chrome headless sul container ricostruito →
  **21/21 PASS** sul dialog.

### Persistenza verificata durante il collaudo

Prima della ricostruzione è stata registrata una cartella di prova
(`Persistence probe`), poi `docker compose up -d --build`, poi la cartella era
**ancora lì**: il volume `audio-data` sopravvive a ricreazione del container e
ricostruzione dell'immagine. La cartella di prova è stata poi rimossa, quindi
`/api/folders.php` è tornato a `{"success":true,"folders":[]}`, lo stato
iniziale. Nessun file audio è stato toccato
(`find music -name '*.mp3' -newermt '-2 hours'` → 0).

### Limiti dichiarati

- Il guard è replicato in 5 file: è una duplicazione **voluta** (nessun helper
  condiviso, per il motivo sopra). Se in futuro i file interni aumentano, la
  soluzione strutturale è un router script per `php -S` che neghi `/api/` con
  nome noto: non applicata qui perché cambierebbe il `CMD` del Dockerfile e il
  modo in cui sono serviti gli asset statici, ben oltre una correzione minima.
- La verifica del frontend resta su Chrome headless (DOM e comportamento reale),
  non su screenshot.

## 13. Mini player nell'header (2026-10-19)

### Cosa e' stato rimosso e perche'

L'header conteneva un `input` di testo libero (`#libraryPath`) con il bottone
**SCAN**, dentro `.input-group-path`. Occorreva verificare che l'input non fosse
usato altrove: le occorrenze erano **solo** lo scan libero, e sono state
aggiornate di conseguenza.

- `state.libraryPath` **resta**: e' la root restituita da `api/config.php` e
  viene ancora usata da `loadLibrary()` (fallback a `api/tracks.php`) e da
  `#libraryInfo`. Non e' piu' un input di DOM.
- `useConfiguredFolders()` ora e' `state.folders.length > 0`: prima confrontava
  anche il testo digitato con la root configurata.
- I listener di `#scanBtn` e di `#libraryPath` sono stati rimossi e `#scanBtn`
  tolto dalla lista dei bottoni disabilitati in `setBusy()`.
- **Capacita' conservata**: ricaricare/riscansionare la libreria resta possibile
  con `#reloadBtn` (header) e con **Scan folders** nel dialog *Cartelle
  musicali*. L'unica cosa che perde il campo e' la scansione di un percorso
  assoluto digitato a mano, che in Docker era gia' impossibile (il path doveva
  essere dentro una root montata) e che il dialog delle cartelle sostituisce.

### Difetto scoperto durante il lavoro: l'header non era un flex container

`.container-fluid` dell'header **non** aveva `d-flex`, quindi i suffissi
`order-lg-2`, `order-lg-3` e `ms-lg-auto` dei figli erano **ineri**: il brand,
il badge con il reload e il campo percorso finivano su righe diverse, nonostante
il CSS fissasse `.app-toolbar { top: 80px }` assumendo un header da ~69px.
Applicando il mini player il difetto era gia' visibile (il mini player finiva
sotto gli altri elementi).

Correzione: `.header-row { display:flex; flex-wrap:wrap; align-items:center; gap:... }`.
Ora su lg l'header e' **una riga** (80px misurati) e sotto lg va a capo in modo
controllato (2 righe, 125px a 375px, artista nascosto sotto 576px).

### Altezza dell'header: una sola sorgente

`top: 80px` / `top: 65px` erano due numeri magici che dipendevano dal wrap.
Ora `syncHeaderHeight()` pubblica l'altezza reale in `--app-header-h` tramite
`ResizeObserver` (evento, **nessun polling**), e `.app-toolbar` usa la variabile
in entrambe le media query.

### Un solo player

Il mini player e' una **vista** del player gia' esistente: stesso elemento
`<audio>` creato in `initPlayer()`, stesso `playerState`, stesse funzioni
`togglePlayPause` / `playNext` / `playPrev`, stessi handler `play`, `pause`,
`ended`, `error`. Nessun secondo `Audio`, nessun endpoint nuovo, nessun
polling. I test lo verificano: `window.Audio` viene intercettato **dall'esterno**
(prima che gli script della pagina girino) e il test asserisce che ne viene
creato **esattamente uno**.

- `updateMiniPlayerMeta(track)` scrive titolo e artista (chiamata da
  `loadTrack()`, quindi a ogni cambio traccia).
- `updateMiniPlayerState()` gestisce disabled e animazione ed e' chiamata da
  `updatePlayPauseBtn()` — cioe' **dagli eventi audio reali** — e da
  `renderView()`, cosi' "Riproduci" segue i filtri correnti.

**Stati disabilitati**: senza traccia caricata Precedente/Successivo sono
disabilitati; Riproduci resta attivo se la libreria visibile ha tracce, perche
`togglePlayPause()` sa gia' avviare la prima traccia visibile. Disabilitare
anche Play avrebbe tolto una funziona che funzionava.

**Animazione**: 4 barre in `transform: scaleY()` (nessun layout), keyframe
`mini-eq-bounce`. L'animazione e' legata a `.mini-player.is-playing`, che il JS
imposta/toglie dagli eventi `play`/`pause`/`ended`/`error`. Da spenta le barre
restano visibili ma statiche e in `var(--gold-muted)`. `prefers-reduced-motion`
e' gia' gestito dal blocco globale del tema: le barre restano statiche.

**Larghezza stabile**: `flex: 0 1 380px` invece di `max-width` da solo, altrimenti
il box cresceva e si restringeva a seconda della lunghezza del titolo e faceva
"saltare" l'header. Titoli lunghi: ellipsis su `.mini-title` e `.mini-artist`
(il `title` attributo mostra il testo completo all'hover).

### Difetto secondario corretto

`playTrack()` e `togglePlayPause()` avevano `.catch(() => {})`: se `play()`
falliva (file rimosso, policy di autoplay) nessun evento `play` arrivava e lo
stato poteva restare incoerente. Ora il catch forza `isPlaying = false` e
riallinea il mini player.

### Test

- `tests/check-ui.js` + `tests/run-ui.sh` — **53 asserzioni** su Chrome headless
  reale, senza dipendenze npm (client WebSocket minimale in `tests/ws_min.js`).
  Copre: nessuna traccia, play, pausa, animazione on/off legata agli eventi reali,
 successivo/precedente, evento `ended` (con auto-avanzamento), evento `error` (toast +
  animazione ferma + recupero con la traccia successiva), titolo lungo, assenza di
  overflow, layout 1440px e 375px, offset sticky, e non regressione di ricerca,
  dialog cartelle, pannello dettagli e player in basso.
- Skip pulito se mancano Chrome, node o un python con mutagen.
- Suite esistenti invariate e ancora verdi: 38/38 PHP, 8/8 Python, 4/4 Compose,
  HTTP end-to-end.

### File modificati

- `web/index.php` — `#libraryPath` + `#scanBtn` sostituiti da `#miniPlayer`;
  `id="headerActions"` sulle azioni; `header-row` sul contenitore
- `web/assets/css/style.css` — `.header-row`, `.mini-player` e figli,
  `@keyframes mini-eq-bounce`, regole < 576px, `--app-header-h`,
  rimosso `.input-group-path` (orfano)
- `web/assets/js/app.js` — `syncHeaderHeight()`, `updateMiniPlayerMeta()`,
  `updateMiniPlayerState()`, wiring dei tre bottoni, rimozione dei riferimenti
  a `#libraryPath`/`#scanBtn`, `play().catch()` che riallinea lo stato
- `tests/check-ui.js`, `tests/run-ui.sh`, `tests/ws_min.js` — nuovi
- `tests/check-http.sh` — asserzioni sulla nuova intestazione
- `README.md` — sezione Tests

### Limiti dichiarati

- Su schermi < 576px l'artista del mini player e' nascosto per far spazio al
  titolo (il titolo e' l'informazione utile).
- La larghezza massima del mini player e' 380px: con un brand molto largo e un
  badge pieno su schermi 992-1100px puo' restringersi (ellipsis), ma non
  spezzarsi.
- Verifica visiva fatta su DOM, comportamento reale in Chrome headless e
  `getBoundingClientRect`, non su screenshot.

## 14. Play per traccia e per album, rimozione del player in basso (2026-10-19)

### Stato trovato

- La **vista piatta** (`api/tracks.php` → tabella) aveva gia' il bottone
  `.btn-play-row` (colonna `col-play`), collegato a `playTrackByPath()`.
- La **vista ad albero** (artista → album → tracce) **non aveva nessun bottone
  Play**: le tracce erano solo cliccabili per aprire i dettagli.
- Nessun bottone Play sugli **album**.
- Il player in fondo pagina (`#audioPlayerPanel`) conteneva i controlli
  duplicati (precedente/riproduci/successivo) piu' volume e barra di
  seek, ed era l'unica UI di riproduzione insieme al mini player.

### Modello di sequenza (il cuore del comportamento)

`playerState.playlist` e' la sequenza che **Successivo/Precedente** percorrono.
Viene ricostruita **ogni volta** che si avvia una traccia, cosi' corrisponde
sempre al contesto da cui l'utente e' partito:

- `sequenceKind: 'library'` — le tracce **visibili** della vista attiva, nel
  suo ordine. Usata quando si avvia una singola traccia dalla vista piatta.
- `sequenceKind: 'album'` — le tracce **di un album**, in ordine di album
  (`sortTracks()`: numero di traccia, poi nome del file). `sequenceId` ricorda
  l'album, cosi' il suo bottone puo' mostrare lo stato di pausa.

Regola applicata:

- **Play su un album** → sequenza dell'album, parte dalla **prima** traccia.
  Premendolo di nuovo riparte dalla prima traccia dell'album (comportamento
  esplicito, non una pausa: il requisito e' "deve partire la prima traccia").
- **Play su una traccia dentro un blocco album** → sequenza di **qu quell'album**.
- **Play su una traccia della vista piatta** → sequenza della **lista visibile**.
- **Play sulla traccia gia' in riproduzione** → la **mette in pausa** (come ogni
  player), e la preme di nuovo la riprende.
- Il tasto **Play di un album** e' disabilitato quando l'album non ha tracce.

### Rimozione del player in fondo pagina

- `web/index.php`: rimossa l'intera `<section class="audio-player-panel">`.
  **Attenzione**: nella stessa sezione c'era anche il `<footer class="app-footer">`
  con `#apiStatus`; la prima rimozione lo aveva portato via e l'app non
  caricava piu' la libreria (`setApiStatus()` su un elemento inesistente).
  Il footer e' stato ripristinato e la struttura verificata.
- `web/assets/css/style.css`: rimossi 270+ righe (`.audio-player-panel`,
  `.audio-player-inner`, `.player-*`, `.btn-player`, `.player-progress*`,
  `.player-volume*`) e il `padding-bottom: 110px` (100px sotto 576px) che
  riservava lo spazio del player fisso.
- `web/assets/js/app.js`: rimossi `updatePlayerTrackInfo()`,
  `updatePlayerProgress()`, `updatePlayerDuration()`, `updatePlayPauseBtn()`,
  `updateVolumeUI()`, `setVolume()`, `toggleMute()`, `seekProgress()`,
  `seekRelative()` e i listener dei controlli del pannello.
- **Il motore audio NON e' stato toccato**: l'elemento `<audio>` era gia'
  creato in JS (`new Audio()` in `initPlayer()`), quindi non era nel markup
  del pannello. Esiste **un solo** `<audio>`: il test lo verifica intercettando
  `window.Audio` dall'esterno e contando gli elementi creati (1).

### Cosa e' rimasto nel mini player dell'header

Solo l'interfaccia di riproduzione richiesta: equalizzatore, titolo (+ artista),
precedente/riproduci/successivo. **Con la rimozione del player in basso sono
scomparsi anche lo slider del volume e la barra di seek**, che vivevano solo
li: non esisteva un duplicato nell'header. Se servono, si possono reintrodurre
compatte nel mini player.

### UI aggiunta

- **Vista ad albero**: bottone Play in ogni riga di traccia (`.tv-play-btn`),
  nella cella `.tv-actions` accanto al bottone di modifica.
- **Card album**: bottone Play accanto al titolo (`.album-play-btn`), dentro
  `.album-title-row`. Icona `bi-play-fill` / `bi-pause-fill` come nel resto
  dell'app.
- **Evidenziazione discreta** della traccia in riproduzione: bordo oro a
  sinistra e titolo in oro (`.is-playing`), in entrambe le viste.
- Il click sul Play **non** apre il pannello dei dettagli ne' seleziona la
  riga: i gestori delegati controllano i bottoni Play **prima** del click sulla
  riga, e fanno `stopPropagation()`.
- `updatePlaybackUi()` e' l'unico punto che aggiorna mini player, bottoni Play
  ed evidenziazione; viene chiamato dagli eventi audio reali (`play`, `pause`,
  `ended`, `error`), dal cambio traccia e da `renderView()`.

### Test

`tests/check-ui.js` (Chrome headless reale, senza dipendenze npm): **55
asserzioni**, library-agnostiche (l'album di riferimento e' quello con piu'
brani, letto dalla card, quindi il test gira anche sulla libreria reale).

Copre: assenza del player in basso nel DOM e nello spazio riservato, un solo
elemento audio, Play su traccia (titolo, audio in riproduzione, riga
evidenziata, icona pausa, dettagli non aperti), Successivo/Precedente, Play su
album (prima traccia, ordine dell'album, wrap interno all'album), play di un
altro brano senza sovrapposizioni, pausa/ripresa dall'header, evento `ended`,
vista piatta (play, evidenziazione, pausa/ripresa, dettagli, checkbox),
titolo lungo, file non piu' disponibile (toast + nessun crash), layout 375px.

`tests/run-ui.sh`: fixture con 4 album e 7 tracce MP3 reali (tag TIT2/TPE1/TALB/
TRCK), avvio del server PHP, skip pulito se mancano Chrome, node o mutagen.

### File modificati

- `web/index.php` — rimosso il player in basso (footer ripristinato)
- `web/assets/css/style.css` — rimossi gli stili del player, aggiunti
  `.album-play-btn`, `.tv-play-btn`, `.album-title-row`, `.is-playing`
- `web/assets/js/app.js` — sequenza, `playTrackByPath(path, albumId)`,
  `toggleTrack()`, `playAlbum()`, `currentPlayingPath()`,
  `updateRowPlayButtons()`, `updatePlayingHighlight()`,
  `updatePlaybackUi()`, bottoni Play, rimozione della logica del player in basso
- `tests/check-ui.js`, `tests/run-ui.sh` — test aggiornati
- `README.md` — uso del Play per traccia e album

### Limiti dichiarati

- Slider del volume e barra di seek: rimossi con il player in basso (non
  esistevano nell'header). Reintroducibili nel mini player.
- La sequenza 'library' segue le tracce **visibili**: se un filtro e' attivo,
  Successivo/Precedente camminano tra le tracce filtrate.
- Il wrap in coda e' circolare (ultima traccia -> prima), come gia' era.

## 15. Rifinitura estetica del mini player (2026-10-19)

Intervento **solo di aspetto**: nessuna modifica alla logica di riproduzione.
`web/assets/js/app.js` **non e' stato toccato** (i mtime confermano: la
logica di riproduzione resta quella della sezione 14).

### Modifiche

- **Bordo sottile e discreto**: `1px solid var(--border)` — lo stesso token
  usato da `.panel`, `.album-card`, `.btn-icon`. Non e' il colore d'accento
  (`--gold`), quindi non risulta marcato.
- **Raggio leggero**: `var(--radius-sm)` (6.4px), non `--radius` (9.6px) delle
  card grandi.
- **Padding compatto**: `0.25rem 0.45rem` (4px / 7.2px): il player resta un
  componente piccolo, non una card (altezza totale 42px).
- **Sfondo**: `var(--surface)`, lo stesso dei pannelli: si stacca appena dal
  nero dell'header.
- **Spazi ridotti**: il `gap` del contenitore passa da `0.55rem` a `0.4rem`
  (6.4px) fra equalizer, titolo e controlli. Il **gap fra i pulsanti non e'
  stato ridotto** (0.3rem, ~5px): restano comodi da cliccare.
- **Allineamento verticale**: l'equalizer ha `align-self: center` e il blocco
  titolo/artista `justify-content: center`: i tre elementi condividono lo
  stesso centro verticale (misurato: eq=40, meta=40, ctl=40).
- **Ellipsis**: invariati su `.mini-title` e `.mini-artist`
  (`white-space:nowrap; overflow:hidden; text-overflow:ellipsis`).

### Effetto collaterale sui telefoni (375px)

Con il player piu' compatto il titolo si e' ridotto a **20px** nella riga
condivisa con brand e badge: illeggibile. Correzione: sotto 576px il mini
player passa **in ordine 3** (dopo brand e badge) e prende **una riga tutta
sua** (`flex: 1 1 100%`), mentre il brand usa `flex: 1 1 0` (base zero: non
spinge mai a capo il badge e cresce solo con lo spazio libero).

- header a 375px: **due righe** (129px, contro i 125px precedenti);
- larghezza del mini player: 333px → **titolo 194px** (circa 20 caratteri);
- nessun overflow orizzontale, nessuna sovrapposizione con brand/badge/reload.

### Test

`tests/check-ui.js` e' stato esteso con **17 asserzioni** dedicate all'aspetto
(72 in totale): bordo visibile euguale al token del tema e diverso dal colore
d'accento, raggio <= 8px, padding <= 5px/10px, altezza <= 46px (non una
card), gap equalizer-titolo e titolo-controlli <= 8px, gap fra pulsanti >= 4px,
centri verticali coincidenti entro 2px, ellipsis preservati, titolo e artista
non collassati; a 375px: titolo con almeno 24px, controlli che non
sovrappongono il titolo, player che non sovrappone il brand, header al
massimo due righe.

Su **fixture** e sul **container ricostruito** (libreria reale): **72/72 PASS**,
0 errori JavaScript (gli unici 404 sono quelli preesistenti di `favicon.ico`).

### File modificati

- `web/assets/css/style.css` — regole `.mini-player`, `.mini-meta`,
  `.mini-controls`, `.mini-btn`, `.mini-eq` e la media query < 576px
- `web/index.php` — solo un commento ormai superato (il player in basso non
  esiste piu')
- `tests/check-ui.js` — le nuove asserzioni di aspetto

### Limiti dichiarati

- Sotto 576px l'artista resta nascosto (scelta della sezione 13): con il
  player su una riga intera ci sarebbe spazio, ma cambiare l'informazione
  mostrata su un breakpoint non rientrava in questo intervento.
- Il bordo usa `var(--border)`: in un eventuale tema chiaro andrà verificato
  il contrasto (il progetto ha oggi solo il tema scuro, `data-theme="dark"`).
