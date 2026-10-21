# PROJECT_CONTEXT — Audio Metadati Manager

> Contesto permanente per le sessioni di sviluppo con OpenCode.
> Analisi riferita esclusivamente a questa checkout, non a versioni precedenti.
>
> - Data analisi: 2026-10-21
> - Branch: `main`
> - Commit: `0871554ef3b1ce1f2264805bcb1b23cd71f0c5e8` — "Fix ID3 tag handling for MP3 metadata"
> - Working tree: **non pulito prima dell'analisi** (vedi §10)
> - Documento creato senza modificare codice, configurazioni, dipendenze o dati.

## 1. Scopo e funzionalità

Applicazione web locale/LAN per consultare e modificare i metadati e le copertine incorporate di una libreria musicale MP3/FLAC/M4A. PHP serve UI e API; Python + Mutagen esegue lettura/scrittura sui file audio. È inclusa anche una CLI Python.

### Implementato e verificato nel codice

- Scansione ricorsiva di file `.mp3`, `.flac`, `.m4a` (`python/core.py`).
- Supporto a più root musicali e a una lista persistente di cartelle registrate.
- Vista ad albero Artista → Album → Traccia e vista tabellare piatta.
- Ricerca e filtri per formato/stato; selezione multipla.
- Modifica di titolo, artista, album, album artist, anno, genere, numero traccia e totale tracce.
- Stato UNSAVED/SAVED lato client e salvataggio singolo o multiplo.
- Copertine:
  - rilevamento JPEG/JPG nella stessa cartella del brano;
  - dialog **Select Cover** con le immagini presenti nella cartella, anteprima e selezione della copertina;
  - incorporamento/rimozione della copertina nel file audio;
  - **Upload Cover** dentro il dialog: salva un nuovo JPEG nella cartella dell'album con nome univoco, senza sovrascrivere file esistenti e senza applicarlo automaticamente ai metadati;
  - il salvataggio della cover selezionata riguarda solo il brano corrente;
  - l'applicazione della cover a più brani non è disponibile in Select Cover; sarà gestita nel dialog di modifica bulk;
  - upload JPEG nella modale bulk (salvato temporaneamente in `<root>/.covers/`).
- Riproduzione audio tramite un unico elemento HTML5 `Audio` e mini-player nell'header (play/pausa, precedente, successiva; sequenza album o lista visibile).
- Streaming audio con supporto HTTP Range (`api/audio.php`).
- Navigazione sicura delle root tramite path relativi e validazione `realpath()`.
- Persistenza della lista cartelle in JSON, scrittura atomica e recupero da file corrotto.
- Protezione degli include PHP da accesso diretto (403 JSON).

### Descritto nella documentazione ma NON presente in questa checkout

- Controlli seek/progress bar, tempo corrente/durata e volume/mute: il README e il changelog 1.2.0 li citano, ma `web/index.php` e `web/assets/js/app.js` espongono solo mini-player con precedente/play-pausa/successiva. Lo streaming Range esiste, l'interfaccia di seek no.
- Campo percorso libreria e pulsante **SCAN** nell'interfaccia: il README li descrive, ma non esistono in `web/index.php`; i messaggi "Enter the library path and press SCAN" sono residui. La libreria deriva da `AUDIO_LIBRARY_OVERRIDE`, `web/config.local.php` o dalle cartelle registrate.
- Pulsante **Save** nella toolbar: non presente; il salvataggio avviene dal pannello dettagli o dalla modale bulk.
- `docker-compose.extra.yml.example`: citato in `docker-compose.yml`, ma il file non esiste.
- `docker-placeholder/`: esiste con `.gitkeep`, ma il compose attuale non lo referenzia.

### Non implementato / non presente

- Nessun database.
- Nessuna autenticazione, login, gestione utenti o HTTPS integrato.
- Nessun download automatico di metadati o copertine da Internet.
- Nessuna conversione/transcodifica dei file audio.

## 2. Architettura e flusso dati

```text
Browser (HTML5 + Bootstrap 5 + JS vanilla)
        |
        | fetch JSON / multipart
        v
PHP API (web/api/*.php)
        |
        | shell_exec: python/comm.py <command> <args>
        v
Python core (python/core.py + Mutagen)
        |
        v
File audio e JPEG sulla libreria montata
```

- Il browser non invia mai path assoluti per l'esplorazione: invia `root` + path relativo; il server normalizza e valida con `realpath()`.
- Gli endpoint accettano path assoluti solo se risolvono dentro una root autorizzata; se nessuna root è risolvibile, il comportamento legacy accetta qualsiasi path esistente (`resolve_in_library`, `web/api/bootstrap.php`).
- La persistenza applicativa è un file JSON in `AUDIO_DATA_DIR` (default `./data`), non un database.
- I metadati e le copertine incorporate sono scritti **dentro i file audio**; i JPEG di origine nella cartella non vengono modificati.

## 3. Mappa del repository

```text
.
├── Dockerfile                  # php:8.2-cli + Python + venv, COPY . /app, server PHP
├── docker-compose.yml          # servizio, mount /music, volume audio-data, healthcheck
├── .env.example                # modello per MUSIC_PATH*, PORT
├── .dockerignore               # esclude test, musica, .venv, data, ecc. dall'immagine
├── install.sh                  # verifica PHP/Python, crea .venv, installa mutagen
├── start.sh                    # avvia php -S con document root web/
├── metadati.py                 # CLI interattiva basata su python/core.py
├── requirements.txt            # mutagen>=1.46
├── docker-placeholder/         # cartelle vuote con .gitkeep (non usate dal compose attuale)
├── music/, music2/             # pochi MP3 campione; cartelle locali non tracciate, audio e .DS_Store ignorati
├── music1/                     # solo cartelle vuote e .DS_Store; cartella locale non tracciata
├── python/
│   ├── core.py                 # lettura/scrittura tag e copertine con Mutagen
│   └── comm.py                 # bridge CLI JSON usato da PHP
├── tests/
│   ├── run-tests.php           # suite PHP senza dipendenze
│   ├── _endpoint_runner.php    # esegue un endpoint in processo isolato
│   ├── test_scan.py            # test unittest del core Python
│   ├── check-http.sh           # test HTTP end-to-end
│   ├── check-ui.js             # test browser headless
│   ├── run-ui.sh               # avvia server + Chrome per check-ui.js
│   ├── check-compose.sh        # validazione scenari Docker Compose
│   └── ws_min.js               # client WebSocket minimale per check-ui.js
└── web/
    ├── index.php               # markup UI, modali, mini-player
    ├── config.php              # loader configurazione
    ├── config.example.php      # modello config.local.php
    ├── assets/css/style.css    # tema scuro/responsive
    ├── assets/js/app.js        # stato, viste, editing, copertine, player
    └── api/
        ├── bootstrap.php       # helper comuni, bridge Python, validazione path
        ├── library-roots.php   # root autorizzate e path relativi
        ├── library-folders.php # store JSON delle cartelle registrate
        ├── config.php          # configurazione e root
        ├── browse.php          # esplorazione di un livello
        ├── folders.php         # CRUD cartelle registrate
        ├── library.php         # scansione unita delle cartelle registrate
        ├── tracks.php          # scansione di una cartella/root
        ├── metadata.php        # metadati di un file
        ├── save.php            # salvataggio singolo
        ├── scan.php            # scansione via POST
        ├── bulk-update.php     # salvataggio/copertine in blocco
        ├── audio.php           # streaming con Range
        ├── cover.php           # invio JPEG o copertina incorporata
        ├── upload-cover.php    # upload JPEG temporaneo per la modale bulk
        └── upload-album-cover.php # upload JPEG nella cartella album da Select Cover
```

## 4. Esecuzione in sviluppo e con Docker

### Sviluppo locale

Prerequisiti: PHP 8+, Python 3 con Mutagen, oppure il venv creato da `install.sh`.

```bash
./install.sh          # crea .venv e web/config.local.php se manca
./start.sh            # http://localhost:8000
./start.sh 8080       # porta alternativa
PORT=8080 ./start.sh
```

Equivalente manuale:

```bash
php -S 0.0.0.0:8000 -t web
```

Stato locale osservato: `.venv` assente, `.env` assente, `web/config.local.php` assente, `data/` assente; il `python3` di sistema aveva Mutagen 1.48.1. Senza root configurata e senza cartelle registrate la UI non carica una libreria.

### Docker Compose

```bash
docker compose up -d --build     # build + avvio
docker compose up -d             # ricreazione dopo modifiche a volumi/env
docker compose logs -f           # log
docker compose ps                # stato/healthcheck
docker compose down              # stop e rimozione container
docker compose up -d --build --force-recreate
```

- Porta host: `${PORT:-8000}` → container `8000`.
- Healthcheck: GET `http://localhost:8000/api/config.php` ogni 30 s.
- `Dockerfile` usa `COPY . /app`: **le modifiche ai sorgenti non sono visibili nel container senza rebuild** (non c'è bind mount del codice).
- Nel container il document root è `/app/web`.

## 5. Configurazione e variabili d'ambiente

Nomi e significato; nessun valore sensibile è riportato.

| Variabile / file | Significato |
|---|---|
| `AUDIO_LIBRARY_OVERRIDE` | Path della root primaria. In `music_root_primary_path()` ha precedenza su `AUDIO_LIBRARY_PATH`. |
| `AUDIO_LIBRARY_PATH` | Costante definita da `web/config.local.php`; usata se `AUDIO_LIBRARY_OVERRIDE` è assente. |
| `AUDIO_MUSIC_ROOTS` | Root aggiuntive, formato `id:path,id:path`; id `[a-z0-9][a-z0-9_-]{0,31}`. |
| `AUDIO_DATA_DIR` | Directory dello store `music-folders.json`; default `PROJECT_ROOT/data`. |
| `AUDIO_PYTHON_BIN` | Interprete Python con Mutagen; fallback `.venv`, `venv`, `python3`. |
| `MUSIC_PATH` | Solo Compose: path host montato su `/music`. |
| `MUSIC_PATH_2`, `MUSIC_PATH_3` | Solo Compose: mount opzionali su `/music-roots/music2` e `/music-roots/music3`; nel compose attuale sono commentati. |
| `PORT` | Porta host pubblicata da Compose (default 8000). |
| `web/config.local.php` | Configurazione locale ignorata da Git; definisce `AUDIO_LIBRARY_PATH`. |
| `.env` | Configurazione locale Compose ignorata da Git. |

Nota verificata: il README dichiara la precedenza "config.local.php poi variabile d'ambiente", ma il codice effettivo delle root usa prima `AUDIO_LIBRARY_OVERRIDE`. Il valore efficace della root primaria è quindi quello della variabile d'ambiente, se impostata.

Variabili impostate dal compose: `AUDIO_LIBRARY_OVERRIDE=/music`, `AUDIO_MUSIC_ROOTS=music2:/music-roots/music2,music3:/music-roots/music3`, `AUDIO_DATA_DIR=/app/data`. Poiché i mount `music2`/`music3` sono commentati per default, le root aggiuntive risultano configurate ma non disponibili finché non vengono montate.

## 6. Persistenza e volumi

- **Libreria musicale**: bind mount read-write della root primaria su `/music`; i metadati e le copertine vengono scritti nei file audio. La libreria è il dato più importante: non va cancellata, sostituita o riscritta in blocco.
- **Volume `audio-data`**: montato su `/app/data`; contiene `music-folders.json` (cartelle registrate), il file di lock e l'eventuale backup `.corrupt`. Sopravvive a restart, ricreazione container e rebuild dell'immagine. `docker compose down -v` elimina il volume: da evitare salvo richiesta esplicita.
- **Senza Docker**: lo store va in `data/` nella root del progetto, salvo `AUDIO_DATA_DIR` diverso.
- **Copertine temporanee**: `<root>/.covers/` nella prima root scrivibile; cleanup dei file più vecchi di 24 h. Restano sul filesystem host della libreria.
- **Upload da Select Cover**: il JPEG viene scritto direttamente nella cartella dell'album con nome libero; non usa `.covers/` e non modifica la cover incorporata finché l'utente non seleziona e salva.
- **Mount primario nel compose attuale**: la riga committed usa `${MUSIC_PATH:-./music}:/music`; nella working tree è stata sostituita con un path assoluto host che punta alla cartella `music` di questa checkout. Il percorso è specifico dell'ambiente e non deve essere assunto valido altrove.

## 7. API principali

Tutti gli endpoint restano sotto `web/api/`. Le risposte sono JSON con `success`; gli errori includono `error`. Gli include (`bootstrap.php`, `library-roots.php`, `library-folders.php`, `web/config.php`, `web/config.example.php`) rispondono 403 se richiesti direttamente.

| Metodo | Endpoint | Parametri principali | Responsabilità |
|---|---|---|---|
| GET | `config.php` | — | `library_path`, `roots[]`, `folders_configured` |
| GET | `browse.php` | `root`, `path` relativo | Elenca un livello di directory dentro una root |
| GET | `folders.php` | — | Elenca le cartelle registrate con disponibilità |
| POST | `folders.php` | `action=add` + `root`,`path`,`label`; `action=remove` + `id` | Aggiunge/rimuove solo il record, mai file |
| GET | `library.php` | — | Scansiona tutte le cartelle registrate, unisce e deduplica per `realpath` |
| GET | `tracks.php` | `path` opzionale | Scansiona una cartella (default: root primaria) |
| GET | `metadata.php` | `path` file | Metadati completi di una traccia |
| POST | `save.php` | `path`, campi metadati, `cover` opzionale | Salva una traccia; usato dai test, non dal frontend attuale |
| POST | `scan.php` | `path` opzionale | Scansiona una cartella; endpoint disponibile, non usato dal frontend attuale |
| POST | `bulk-update.php` | `action=save`/`cover`/`remove_cover` | Salvataggio e copertine in blocco; usato dal frontend |
| GET | `cover.php` | `path`, `embedded=1` | Restituisce JPEG di cartella o copertina incorporata |
| GET | `audio.php` | `path` | Streaming MP3/FLAC/M4A con Range |
| POST | `upload-cover.php` | multipart campo `cover` | Valida JPEG (max 10 MB) e lo salva in `.covers/` |
| POST | `upload-album-cover.php` | multipart `path`, `cover` | Valida JPEG (max 10 MB), lo salva nella cartella dell'album con nome univoco e restituisce `path`/`name`; non incorpora |

Dettagli contrattuali utili:

- `folders.php` rifiuta duplicati con HTTP 409; il path viene normalizzato (`Rock/`, `./Rock`, `/Rock` equivalgono a `Rock`).
- `bulk-update.php` restituisce `success` vero solo se non ci sono errori, oltre a `modified`, `failed`, `errors[]`.
- `cover` in salvataggio: stringa vuota = nessuna modifica, `__remove__` = rimozione, path JPEG = incorporamento.
- `upload-album-cover.php` accetta solo JPEG reali, rifiuta path fuori dalla libreria e file non JPEG, non sovrascrive immagini esistenti; la selezione della cover resta un passaggio separato.
- `library.php` richiede almeno una cartella registrata; le cartelle non disponibili vengono riportate e saltate.

## 8. Test disponibili

| Comando | Copertura | Esito in questa analisi |
|---|---|---|
| `php tests/run-tests.php` | Root, browse, CRUD cartelle, merge, regressioni endpoint, guardie, corpi vuoti | 38 test, 0 falliti |
| `python3 tests/test_scan.py` | Scansione, formati, cover di cartella, deduplica, errori JSON | 8 test, OK |
| `./tests/check-http.sh` | Server PHP reale, API HTTP, JSON body, include-only, path traversal, upload cover | Tutti i check passati |
| `./tests/run-ui.sh` | Chrome headless: albero, player, mini-player, Select Cover/Upload, responsive, errori | 85 check, 0 falliti |
| `./tests/check-compose.sh` | Scenari `docker compose config` | 3/4 passati; 1 fallito |
| `docker compose config --quiet` | Validità sintattica del compose corrente | OK |

Limiti e note verificati:

- Il fallimento di `check-compose.sh` riguarda lo scenario "three mounts": lo script genera `.env` in una directory temporanea ma non passa `--env-file`, quindi Compose legge il `.env` dalla root del progetto, le variabili non vengono caricate e Docker segnala mount vuoti. È un limite dello script di test, non un difetto applicativo dimostrato.
- La UI test copre apertura del dialog, upload, comparsa nell'elenco, selezione e salvataggio della cover sul singolo brano; non verifica la rilettura della cover incorporata né la rimozione. Restano non coperti `upload-cover.php` (upload temporaneo bulk), lo streaming Range con contenuto e l'upload bulk da browser.
- `run-ui.sh` richiede Node e Chrome; salta con exit 0 se mancano.
- La suite PHP usa fixture MP3 generate al volo e non tocca la libreria reale.

## 9. Convenzioni e vincoli di sviluppo

- **Non perdere dati musicali**: nessuna cancellazione, move, rename o riscrittura massiva di file audio/JPEG senza richiesta esplicita.
- **Non sovrascrivere immagini o file** se non è l'azione richiesta; le copertine di origine non vanno modificate.
- Rispettare i mount persistenti: `/music`, eventuali `/music-roots/*` e `/app/data`. Non introdurre path host inventati.
- Il compose usa `COPY`, non un bind mount del codice: dopo modifiche ai sorgenti serve `docker compose up -d --build`.
- Mantenere i contratti frontend/backend: forma delle risposte JSON, `success`, `error`, codici HTTP, struttura dei record delle cartelle e delle tracce.
- Ogni nuovo endpoint sotto `web/api/` deve essere classificato come endpoint o file interno protetto; i test controllano questa proprietà.
- Non indebolire la validazione dei path (`realpath`, root autorizzate, rifiuto di `..`, path assoluti e symlink esterni).
- Non introdurre segreti in file tracciati; `.env` e `web/config.local.php` restano locali.
- Non modificare `.gitignore` o aggiungere file a Git senza richiesta.
- Se si toccano configurazioni Docker/volume, verificare esplicitamente che la libreria e `audio-data` sopravvivano.

## 10. Stato noto della checkout

- Branch `main`, allineato a `origin/main`; commit analizzato `0871554`.
- Il commit corregge in `python/core.py` l'aggiunta dei tag ID3 e delle copertine MP3, evitando `add_tags()` quando i tag esistono già.
- **Working tree preesistente**: `docker-compose.yml` risultava già modificato prima dell'analisi (mount primario hardcoded). La modifica non è stata toccata.
- File locali non tracciati presenti: `music/` e `music2/` con pochi MP3 campione; `music1/` contiene solo cartelle vuote e `.DS_Store`. I file audio e `.DS_Store` sono ignorati da Git. Non risultano `.env`, `web/config.local.php`, `data/` o `.venv`.
- Funzionalità considerate funzionanti solo perché supportate da codice e test eseguiti: scansione, merge multi-root, CRUD cartelle, validazione path, salvataggio metadati, player/mini-player, streaming endpoint, gestione cover singola con Select Cover/Upload.
- Rispetto al commit di analisi, la gestione cover in Track Details è stata aggiornata: Select Cover contiene Upload, non applica la cover a tutti i brani e il salvataggio resta per singolo brano.
- Problemi/limiti verificati: discrepanze README↔UI su seek/volume/path/SCAN/toolbar Save; assenza del file `docker-compose.extra.yml.example` citato; fallimento del singolo scenario in `check-compose.sh` descritto sopra.
- Non sono stati confermati come bug attuali problemi attribuiti a versioni precedenti.

## 11. Istruzioni per l'agente

Prima di modifiche rilevanti:

1. Leggere questo documento e ispezionare il codice reale; non fidarsi di memorie o report su versioni precedenti.
2. Verificare `git status`, branch e commit, e non sovrascrivere modifiche locali preesistenti.
3. Verificare i contratti frontend/backend toccati (endpoint, payload, risposte, stati HTTP) e aggiornare entrambi i lati se necessario.
4. Preservare sempre libreria musicale, metadati, copertine e volume `audio-data`; non eseguire operazioni distruttive senza richiesta esplicita.
5. Ricordare che l'immagine Docker usa `COPY`: rebuild necessario per vedere modifiche ai sorgenti nel container.
6. Eseguire i test pertinenti (`php tests/run-tests.php`, `python3 tests/test_scan.py`, `./tests/check-http.sh`, `./tests/run-ui.sh`, `./tests/check-compose.sh`) e aggiungerne di mirati per le modifiche.
7. Dichiarare chiaramente cosa è stato testato, con quali comandi e con quale esito; non affermare che una funzionalità è verificata senza evidenza.
8. Non fare commit, push, migrazioni o modifiche a configurazioni/dipendenze se non richiesto esplicitamente.
