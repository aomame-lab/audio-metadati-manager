<p align="center">
  <img src="web/audio-metadati-manager-logo.png" alt="Audio Metadata Manager" width="180">
</p>

# Audio Metadati Manager

Audio Metadati Manager is a web-based application for managing your music library's metadata and album artwork. Python (via [mutagen](https://mutagen.readthedocs.io/)) performs all the audio operations, while PHP provides the web/API layer and a modern responsive interface built with HTML5, Bootstrap 5 and vanilla JavaScript.

A command-line interface (CLI) for the same Python core is also included.

## Version

**1.2.0** — Added built-in audio player with play/pause, seek, progress bar, time display, volume control; always-visible play button per track; single-track playback.

## Changelog

### 1.2.0
- **Audio player**: global HTML5 player with play/pause, next/previous, seek bar, current time/duration, volume/mute
- **Per-track play button**: dedicated always-visible column with Play/Pause button for each track
- **Single-track playback**: only one track plays at a time; starting a new track stops the previous one
- **Range request support**: audio endpoint serves MP3, FLAC, M4A with HTTP Range for seeking

## Features

- Web-based audio metadata management
- Command-line interface (CLI) included
- MP3, FLAC and M4A support
- Edit metadata: title, artist, album, album artist, track number, total tracks, genre, year
- Bulk editing of multiple tracks at once
- Search across title, artist, album, genre and filename
- Filter by format (MP3/FLAC/M4A) and status (unsaved/saved)
- **Built-in audio player**: play tracks directly from the library with a global HTML5 player (play/pause, next/previous, seek/progress bar, current time/duration, volume/mute); per-track Play/Pause button; single-track playback
- Album-level cover management:
  - A **Scegli copertina** button in every album header in the Artists view
  - The cover selector lists JPEG/JPG images from the folders of the album tracks; **Upload Cover** adds a new JPEG with a free name and never overwrites existing images
  - Confirming the selection applies it to the whole album in one operation: the image is written as the external `cover.jpeg` in every album folder and embedded in the metadata of every album track
  - Previous `cover.*` / `cpver.*` variants are preserved: before installing the new cover, each old variant is renamed to a unique five-letter name with the original extension
  - Cover selection, upload and removal are no longer available in Track Details or Bulk Edit; all other metadata editing in those windows is unchanged
  - No automatic cover downloads from the Internet
- Clear unsaved/saved status indicators
- Elegant, responsive dark UI (desktop, notebook, tablet)
- Usable over a local network (LAN)

## Screenshots

### Main interface

![alt text](screenshots/preview.png)

## Architecture

```
Browser
   |
   v
HTML + Bootstrap + JavaScript
   |
   v
PHP API
   |
   v
Python audio core (mutagen)
   |
   v
Audio files
```

- **Browser** – the responsive interface built with HTML5, Bootstrap 5 and vanilla JavaScript.
- **PHP API** – validates input, secures paths, and executes the Python core as a subprocess. It is the only web-facing layer.
- **Python core** – `python/core.py` reads and writes audio metadata and embedded covers using mutagen. The `python/comm.py` module exposes a JSON command-line interface that PHP calls.
- **Audio files** – never re-encoded; only metadata tags and embedded artwork are modified, and only when you explicitly save.

## Requirements

| Component | Requirement |
|-----------|-------------|
| Python | 3.8 or newer |
| PHP | 8.0 or newer |
| Python package | `mutagen` (see `requirements.txt`) |
| Browser | A modern browser (Chrome, Firefox, Safari, Edge) |
| OS | Linux, macOS, or Windows (PHP and Python must be installed) |

No PHP extensions or Composer are required. The application uses only the PHP built-in web server.

## Installation

### Docker (Recommended for Home Servers)

The easiest way to run the application is using Docker Compose.

#### Quick Start (uses default `./music` folder in the project)

```bash
git clone <repository-url>
cd audio-metadati-manager
mkdir -p music          # create a music folder in the project (or use your own)
docker compose up -d --build
```

Then open [http://localhost:8000](http://localhost:8000) in your browser.

---

### Using Your Own Music Folder (Recommended)

For a persistent library outside the project, configure an absolute path on your host:

1. **Create your local configuration**

   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` and set `MUSIC_PATH` to the absolute path of your music folder**

   ```bash
   # macOS / Linux
   MUSIC_PATH=/home/yourname/audio-metadati-manager/music

   # Windows (use forward slashes)
   MUSIC_PATH=C:/Users/yourname/audio-metadati-manager/music

   # Linux server
   MUSIC_PATH=/srv/audio-metadati-manager/music
   ```

   > **Important:** Use an **absolute path** on the host. Docker Compose does **not** expand `~` (tilde).
   > The folder **must already exist** on the host. If it doesn't exist, Docker will create an empty one.

2. **Start the application**

   ```bash
   docker compose up -d --build
   ```

3. **Access the application**

   Open your browser and go to: [http://localhost:8000](http://localhost:8000)

---

### Portainer Deployment

The application works seamlessly with Portainer. Since Portainer manages Docker Compose stacks, you have two options:

#### Option A: Stack from Repository (Recommended)

1. In Portainer, go to **Stacks** → **Add stack**
2. Set **Name**: `audio-metadati-manager`
3. Set **Build method** to **Repository**
3. Enter your repository URL and branch
4. In **Environment variables**, add:
   - `MUSIC_PATH=/path/to/your/music`  (absolute path on the **Portainer host**)
   - `PORT=8000` (optional, defaults to 8000)
4. Click **Deploy the stack**

> **Important for Portainer:** The `MUSIC_PATH` must be an **absolute path on the Portainer host** (the machine where Docker runs). Portainer does **not** expand `~` (tilde). The folder must exist on the Portainer host and be accessible to Docker.

#### Option B: Stack from Local Compose File

1. In Portainer, go to **Stacks** → **Add stack**
2. Set **Build method** to **Web editor**
3. Copy the contents of `docker-compose.yml` into the editor
3. In **Environment variables**, add:
   - `MUSIC_PATH=/path/to/your/music` (absolute path on the Portainer host)
   - `PORT=8000` (optional)
4. Click **Deploy the stack**

> **Note:** In Portainer, the "Build method: Web editor" uses the Compose file you paste. The `.env` file is **not** automatically read from the repository — you must add environment variables in the Portainer UI (Environment variables section).

---

### Using the Default `./music` Folder (No Configuration)

If you don't create a `.env` file, the application falls back to a `music` folder in the project root:

```bash
git clone <repository-url>
cd audio-metadati-manager
mkdir music        # create a music folder in the project
docker compose up -d --build
```

This is convenient for quick testing but **not recommended for persistent libraries** — the `music` folder lives inside the project directory and may be lost if you remove the project.

---

### Common Docker Commands
- View logs: `docker compose logs -f`
- Stop application: `docker compose down`
- Change host port: set `PORT=8080` in your `.env` (or in your shell) — `docker-compose.yml` already reads `${PORT:-8000}`.

### Multiple music folders

By default the application reads a single music root (`MUSIC_PATH` → `/music`).
If your music is spread over several disks, add the extra paths to `.env`:

```bash
MUSIC_PATH=/mnt/primary-disk/music
MUSIC_PATH_2=/mnt/secondary-disk/albums
MUSIC_PATH_3=/mnt/third-disk/field-recordings
```

Each host path is mounted on its own stable container path, so the application
never confuses them:

| `.env` variable | inside the container |
|-----------------|----------------------|
| `MUSIC_PATH`    | `/music`             |
| `MUSIC_PATH_2`  | `/music-roots/music2`|
| `MUSIC_PATH_3`  | `/music-roots/music3`|

`MUSIC_PATH_2` and `MUSIC_PATH_3` are **optional**: leave them out and everything
behaves exactly as before, with one single root.

**Adding a mount later.** The mounts are fixed when the container starts, so after
adding or changing a host path in `.env` recreate the container:

```bash
docker compose up -d --build     # or simply: docker compose up -d
```

**Selecting the folders.** Open the application and press **Cartelle musicali** in
the toolbar. The dialog lets you:

- browse each mounted root one directory at a time and add the folder you want
  (a sub-folder of the root is enough — the whole root works too);
- give each entry a readable label;
- see at a glance whether a folder is **available** (the disk is mounted) or
  **missing** (unplugged / wrong path);
- remove a folder from the library — this only deletes the entry, never a file.

Once at least one folder is registered, **SCAN** and the reload button read all of
them together; files reachable from two overlapping entries are imported only once.

The selected folders are stored in the `audio-data` Docker volume, so they survive
container restarts and image rebuilds.

#### Diagnosing a folder that is not accessible

| Symptom | Cause | What to do |
|---------|-------|------------|
| `docker compose up` fails with `bind source path does not exist` | the host folder in `MUSIC_PATH_2` / `MUSIC_PATH_3` does not exist | create the folder or fix the path in `.env`, then `docker compose up -d` |
| A root shows *not available* in the dialog | the disk is not mounted in the running container | `docker compose up -d` to recreate it after editing `.env` |
| A folder shows **MISSING** | the disk was unplugged after start-up | reconnect it and press the reload button; nothing is re-registered automatically |
| A folder is registered but the scan returns 0 tracks | the folder has no `.mp3`, `.flac` or `.m4a` files, or they live deeper in sub-folders | check the folder contents; hidden folders (`.something`) are not offered by the browser |
| On macOS the folder is empty | the folder is not shared with Docker Desktop | add it in Docker Desktop → Settings → Resources → File sharing |

Nothing of the host filesystem is exposed beyond the folders you mounted, and the
browser can only navigate inside them: it never sends an absolute path, and the
server re-validates every request with `realpath()`.

### Music folder requirements

- The host folder must **exist**. If it does not, Docker creates an empty one and the
  library will appear empty.
- It must be **accessible to Docker**: on macOS and Windows, share the folder with
  Docker Desktop (`HOME`, `/Volumes` and `/private` are shared by default).
- The container needs **write access** to it, because metadata and embedded cover art
  are written into your audio files. Every music mount (including `MUSIC_PATH_2` and
  `MUSIC_PATH_3`) is therefore read-write; adding `read_only: true` to an entry in
  `docker-compose.yml` makes that root browsable but not editable.

### Permissions

The container runs as root by default to ensure it can write metadata to your mounted music files. If you prefer a specific user, you can add `user: "1000:1000"` (replacing with your UID/GID) to `docker-compose.yml`, provided that user has write access to the music folder on the host.

---

### Portainer Deployment

The application works seamlessly with Portainer. Since Portainer manages Docker Compose stacks, you have two options:

#### Option A: Stack from Repository (Recommended)

1. In Portainer, go to **Stacks** → **Add stack**
2. Set **Name**: `audio-metadati-manager`
3. Set **Build method** to **Repository**
3. Enter your repository URL and branch
4. In **Environment variables**, add:
   - `MUSIC_PATH=/path/to/your/music`  (absolute path on the **Portainer host**)
   - `PORT=8000` (optional, defaults to 8000)
5. Click **Deploy the stack**

> **Important for Portainer:** The `MUSIC_PATH` must be an **absolute path on the Portainer host** (the machine where Docker runs). Portainer does **not** expand `~` (tilde). The folder must exist on the Portainer host and be accessible to Docker.

#### Option B: Stack from Local Compose File

1. In Portainer, go to **Stacks** → **Add stack**
2. Set **Build method** to **Web editor**
3. Copy the contents of `docker-compose.yml` into the editor
3. In **Environment variables**, add:
   - `MUSIC_PATH=/path/to/your/music` (absolute path on the Portainer host)
   - `PORT=8000` (optional)
4. Click **Deploy the stack**

> **Note:** In Portainer, the "Build method: Web editor" uses the Compose file you paste. The `.env` file is **not** automatically read from the repository — you must add environment variables in the Portainer UI (Environment variables section).

---

### Using the Default `./music` Folder (No Configuration)

If you don't create a `.env` file, the application falls back to a `music` folder in the project root:

```bash
git clone <repository-url>
cd audio-metadati-manager
mkdir music        # create a music folder in the project
docker compose up -d --build
```

This is convenient for quick testing but **not recommended for persistent libraries** — the `music` folder lives inside the project directory and may be lost if you remove the project.

---

### Common Docker Commands
- View logs: `docker compose logs -f`
- Stop application: `docker compose down`
- Change host port: set `PORT=8080` in your `.env` (or in your shell) — `docker-compose.yml` already reads `${PORT:-8000}`.

### Multiple music folders

By default the application reads a single music root (`MUSIC_PATH` → `/music`).
If your music is spread over several disks, add the extra paths to `.env`:

```bash
MUSIC_PATH=/mnt/primary-disk/music
MUSIC_PATH_2=/mnt/secondary-disk/albums
MUSIC_PATH_3=/mnt/third-disk/field-recordings
```

Each host path is mounted on its own stable container path, so the application
never confuses them:

| `.env` variable | inside the container |
|-----------------|----------------------|
| `MUSIC_PATH`    | `/music`             |
| `MUSIC_PATH_2`  | `/music-roots/music2`|
| `MUSIC_PATH_3`  | `/music-roots/music3`|

`MUSIC_PATH_2` and `MUSIC_PATH_3` are **optional**: leave them out and everything
behaves exactly as before, with one single root.

**Adding a mount later.** The mounts are fixed when the container starts, so after
adding or changing a host path in `.env` recreate the container:

```bash
docker compose up -d --build     # or simply: docker compose up -d
```

**Selecting the folders.** Open the application and press **Cartelle musicali** in
the toolbar. The dialog lets you:

- browse each mounted root one directory at a time and add the folder you want
  (a sub-folder of the root is enough — the whole root works too);
- give each entry a readable label;
- see at a glance whether a folder is **available** (the disk is mounted) or
  **missing** (unplugged / wrong path);
- remove a folder from the library — this only deletes the entry, never a file.

Once at least one folder is registered, **SCAN** and the reload button read all of
them together; files reachable from two overlapping entries are imported only once.

The selected folders are stored in the `audio-data` Docker volume, so they survive
container restarts and image rebuilds.

#### Diagnosing a folder that is not accessible

| Symptom | Cause | What to do |
|---------|-------|------------|
| `docker compose up` fails with `bind source path does not exist` | the host folder in `MUSIC_PATH_2` / `MUSIC_PATH_3` does not exist | create the folder or fix the path in `.env`, then `docker compose up -d` |
| A root shows *not available* in the dialog | the disk is not mounted in the running container | `docker compose up -d` to recreate it after editing `.env` |
| A folder shows **MISSING** | the disk was unplugged after start-up | reconnect it and press the reload button; nothing is re-registered automatically |
| A folder is registered but the scan returns 0 tracks | the folder has no `.mp3`, `.flac` or `.m4a` files, or they live deeper in sub-folders | check the folder contents; hidden folders (`.something`) are not offered by the browser |
| On macOS the folder is empty | the folder is not shared with Docker Desktop | add it in Docker Desktop → Settings → Resources → File sharing |

Nothing of the host filesystem is exposed beyond the folders you mounted, and the
browser can only navigate inside them: it never sends an absolute path, and the
server re-validates every request with `realpath()`.

### Music folder requirements

- The host folder must **exist**. If it does not, Docker creates an empty one and the
  library will appear empty.
- It must be **accessible to Docker**: on macOS and Windows, share the folder with
  Docker Desktop (`HOME`, `/Volumes` and `/private` are shared by default).
- The container needs **write access** to it, because metadata and embedded cover art
  are written into your audio files. Every music mount (including `MUSIC_PATH_2` and
  `MUSIC_PATH_3`) is therefore read-write; adding `read_only: true` to an entry in
  `docker-compose.yml` makes that root browsable but not editable.

### Permissions

The container runs as root by default to ensure it can write metadata to your mounted music files. If you prefer a specific user, you can add `user: "1000:1000"` (replacing with your UID/GID) to `docker-compose.yml`, provided that user has write access to the music folder on the host.

---

### Portainer Deployment

The application works seamlessly with Portainer. Since Portainer manages Docker Compose stacks, you have two options:

#### Option A: Stack from Repository (Recommended)

1. In Portainer, go to **Stacks** → **Add stack**
2. Set **Name**: `audio-metadati-manager`
3. Set **Build method** to **Repository**
3. Enter your repository URL and branch
4. In **Environment variables**, add:
   - `MUSIC_PATH=/path/to/your/music`  (absolute path on the **Portainer host**)
   - `PORT=8000` (optional, defaults to 8000)
5. Click **Deploy the stack**

> **Important for Portainer:** The `MUSIC_PATH` must be an **absolute path on the Portainer host** (the machine where Docker runs). Portainer does **not** expand `~` (tilde). The folder must exist on the Portainer host and be accessible to Docker.

#### Option B: Stack from Local Compose File

1. In Portainer, go to **Stacks** → **Add stack**
2. Set **Build method** to **Web editor**
3. Copy the contents of `docker-compose.yml` into the editor
3. In **Environment variables**, add:
   - `MUSIC_PATH=/path/to/your/music` (absolute path on the Portainer host)
   - `PORT=8000` (optional)
4. Click **Deploy the stack**

> **Note:** In Portainer, the "Build method: Web editor" uses the Compose file you paste. The `.env` file is **not** automatically read from the repository — you must add environment variables in the Portainer UI (Environment variables section).

---

### Using the Default `./music` Folder (No Configuration)

If you don't create a `.env` file, the application falls back to a `music` folder in the project root:

```bash
git clone <repository-url>
cd audio-metadati-manager
mkdir music        # create a music folder in the project
docker compose up -d --build
```

This is convenient for quick testing but **not recommended for persistent libraries** — the `music` folder lives inside the project directory and may be lost if you remove the project.

---

### Common Docker Commands
- View logs: `docker compose logs -f`
- Stop application: `docker compose down`
- Change host port: set `PORT=8080` in your `.env` (or in your shell) — `docker-compose.yml` already reads `${PORT:-8000}`.

### Multiple music folders

By default the application reads a single music root (`MUSIC_PATH` → `/music`).
If your music is spread over several disks, add the extra paths to `.env`:

```bash
MUSIC_PATH=/mnt/primary-disk/music
MUSIC_PATH_2=/mnt/secondary-disk/albums
MUSIC_PATH_3=/mnt/third-disk/field-recordings
```

Each host path is mounted on its own stable container path, so the application
never confuses them:

| `.env` variable | inside the container |
|-----------------|----------------------|
| `MUSIC_PATH`    | `/music`             |
| `MUSIC_PATH_2`  | `/music-roots/music2`|
| `MUSIC_PATH_3`  | `/music-roots/music3`|

`MUSIC_PATH_2` and `MUSIC_PATH_3` are **optional**: leave them out and everything
behaves exactly as before, with one single root.

**Adding a mount later.** The mounts are fixed when the container starts, so after
adding or changing a host path in `.env` recreate the container:

```bash
docker compose up -d --build     # or simply: docker compose up -d
```

**Selecting the folders.** Open the application and press **Cartelle musicali** in
the toolbar. The dialog lets you:

- browse each mounted root one directory at a time and add the folder you want
  (a sub-folder of the root is enough — the whole root works too);
- give each entry a readable label;
- see at a glance whether a folder is **available** (the disk is mounted) or
  **missing** (unplugged / wrong path);
- remove a folder from the library — this only deletes the entry, never a file.

Once at least one folder is registered, **SCAN** and the reload button read all of
them together; files reachable from two overlapping entries are imported only once.

The selected folders are stored in the `audio-data` Docker volume, so they survive
container restarts and image rebuilds.

#### Diagnosing a folder that is not accessible

| Symptom | Cause | What to do |
|---------|-------|------------|
| `docker compose up` fails with `bind source path does not exist` | the host folder in `MUSIC_PATH_2` / `MUSIC_PATH_3` does not exist | create the folder or fix the path in `.env`, then `docker compose up -d` |
| A root shows *not available* in the dialog | the disk is not mounted in the running container | `docker compose up -d` to recreate it after editing `.env` |
| A folder shows **MISSING** | the disk was unplugged after start-up | reconnect it and press the reload button; nothing is re-registered automatically |
| A folder is registered but the scan returns 0 tracks | the folder has no `.mp3`, `.flac` or `.m4a` files, or they live deeper in sub-folders | check the folder contents; hidden folders (`.something`) are not offered by the browser |
| On macOS the folder is empty | the folder is not shared with Docker Desktop | add it in Docker Desktop → Settings → Resources → File sharing |

Nothing of the host filesystem is exposed beyond the folders you mounted, and the
browser can only navigate inside them: it never sends an absolute path, and the
server re-validates every request with `realpath()`.

### Music folder requirements

- The host folder must **exist**. If it does not, Docker creates an empty one and the
  library will appear empty.
- It must be **accessible to Docker**: on macOS and Windows, share the folder with
  Docker Desktop (`HOME`, `/Volumes` and `/private` are shared by default).
- The container needs **write access** to it, because metadata and embedded cover art
  are written into your audio files. Every music mount (including `MUSIC_PATH_2` and
  `MUSIC_PATH_3`) is therefore read-write; adding `read_only: true` to an entry in
  `docker-compose.yml` makes that root browsable but not editable.

### Permissions

The container runs as root by default to ensure it can write metadata to your mounted music files. If you prefer a specific user, you can add `user: "1000:1000"` (replacing with your UID/GID) to `docker-compose.yml`, provided that user has write access to the music folder on the host.

---

### Portainer Deployment

The application works seamlessly with Portainer. Since Portainer manages Docker Compose stacks, you have two options:

#### Option A: Stack from Repository (Recommended)

1. In Portainer, go to **Stacks** → **Add stack**
2. Set **Name**: `audio-metadati-manager`
3. Set **Build method** to **Repository**
3. Enter your repository URL and branch
4. In **Environment variables**, add:
   - `MUSIC_PATH=/path/to/your/music`  (absolute path on the **Portainer host**)
   - `PORT=8000` (optional, defaults to 8000)
5. Click **Deploy the stack**

> **Important for Portainer:** The `MUSIC_PATH` must be an **absolute path on the Portainer host** (the machine where Docker runs). Portainer does **not** expand `~` (tilde). The folder must exist on the Portainer host and be accessible to Docker.

#### Option B: Stack from Local Compose File

1. In Portainer, go to **Stacks** → **Add stack**
2. Set **Build method** to **Web editor**
3. Copy the contents of `docker-compose.yml` into the editor
3. In **Environment variables**, add:
   - `MUSIC_PATH=/path/to/your/music` (absolute path on the Portainer host)
   - `PORT=8000` (optional)
4. Click **Deploy the stack**

> **Note:** In Portainer, the "Build method: Web editor" uses the Compose file you paste. The `.env` file is **not** automatically read from the repository — you must add environment variables in the Portainer UI (Environment variables section).

---

### Using the Default `./music` Folder (No Configuration)

If you don't create a `.env` file, the application falls back to a `music` folder in the project root:

```bash
git clone <repository-url>
cd audio-metadati-manager
mkdir music        # create a music folder in the project
docker compose up -d --build
```

This is convenient for quick testing but **not recommended for persistent libraries** — the `music` folder lives inside the project directory and may be lost if you remove the project.

---

### Common Docker Commands
- View logs: `docker compose logs -f`
- Stop application: `docker compose down`
- Change host port: set `PORT=8080` in your `.env` (or in your shell) — `docker-compose.yml` already reads `${PORT:-8000}`.

### Multiple music folders

By default the application reads a single music root (`MUSIC_PATH` → `/music`).
If your music is spread over several disks, add the extra paths to `.env`:

```bash
MUSIC_PATH=/mnt/primary-disk/music
MUSIC_PATH_2=/mnt/secondary-disk/albums
MUSIC_PATH_3=/mnt/third-disk/field-recordings
```

Each host path is mounted on its own stable container path, so the application
never confuses them:

| `.env` variable | inside the container |
|-----------------|----------------------|
| `MUSIC_PATH`    | `/music`             |
| `MUSIC_PATH_2`  | `/music-roots/music2`|
| `MUSIC_PATH_3`  | `/music-roots/music3`|

`MUSIC_PATH_2` and `MUSIC_PATH_3` are **optional**: leave them out and everything
behaves exactly as before, with one single root.

**Adding a mount later.** The mounts are fixed when the container starts, so after
adding or changing a host path in `.env` recreate the container:

```bash
docker compose up -d --build     # or simply: docker compose up -d
```

**Selecting the folders.** Open the application and press **Cartelle musicali** in
the toolbar. The dialog lets you:

- browse each mounted root one directory at a time and add the folder you want
  (a sub-folder of the root is enough — the whole root works too);
- give each entry a readable label;
- see at a glance whether a folder is **available** (the disk is mounted) or
  **missing** (unplugged / wrong path);
- remove a folder from the library — this only deletes the entry, never a file.

Once at least one folder is registered, **SCAN** and the reload button read all of
them together; files reachable from two overlapping entries are imported only once.

The selected folders are stored in the `audio-data` Docker volume, so they survive
container restarts and image rebuilds.

#### Diagnosing a folder that is not accessible

| Symptom | Cause | What to do |
|---------|-------|------------|
| `docker compose up` fails with `bind source path does not exist` | the host folder in `MUSIC_PATH_2` / `MUSIC_PATH_3` does not exist | create the folder or fix the path in `.env`, then `docker compose up -d` |
| A root shows *not available* in the dialog | the disk is not mounted in the running container | `docker compose up -d` to recreate it after editing `.env` |
| A folder shows **MISSING** | the disk was unplugged after start-up | reconnect it and press the reload button; nothing is re-registered automatically |
| A folder is registered but the scan returns 0 tracks | the folder has no `.mp3`, `.flac` or `.m4a` files, or they live deeper in sub-folders | check the folder contents; hidden folders (`.something`) are not offered by the browser |
| On macOS the folder is empty | the folder is not shared with Docker Desktop | add it in Docker Desktop → Settings → Resources → File sharing |

Nothing of the host filesystem is exposed beyond the folders you mounted, and the
browser can only navigate inside them: it never sends an absolute path, and the
server re-validates every request with `realpath()`.

### Music folder requirements

- The host folder must **exist**. If it does not, Docker creates an empty one and the
  library will appear empty.
- It must be **accessible to Docker**: on macOS and Windows, share the folder with
  Docker Desktop (`HOME`, `/Volumes` and `/private` are shared by default).
- The container needs **write access** to it, because metadata and embedded cover art
  are written into your audio files. Every music mount (including `MUSIC_PATH_2` and
  `MUSIC_PATH_3`) is therefore read-write; adding `read_only: true` to an entry in
  `docker-compose.yml` makes that root browsable but not editable.

### Permissions

The container runs as root by default to ensure it can write metadata to your mounted music files. If you prefer a specific user, you can add `user: "1000:1000"` (replacing with your UID/GID) to `docker-compose.yml`, provided that user has write access to the music folder on the host.

---

### Portainer Deployment

The application works seamlessly with Portainer. Since Portainer manages Docker Compose stacks, you have two options:

#### Option A: Stack from Repository (Recommended)

1. In Portainer, go to **Stacks** → **Add stack**
2. Set **Name**: `audio-metadati-manager`
3. Set **Build method** to **Repository**
3. Enter your repository URL and branch
4. In **Environment variables**, add:
   - `MUSIC_PATH=/path/to/your/music`  (absolute path on the **Portainer host**)
   - `PORT=8000` (optional, defaults to 8000)
5. Click **Deploy the stack**

> **Important for Portainer:** The `MUSIC_PATH` must be an **absolute path on the Portainer host** (the machine where Docker runs). Portainer does **not** expand `~` (tilde). The folder must exist on the Portainer host and be accessible to Docker.

#### Option B: Stack from Local Compose File

1. In Portainer, go to **Stacks** → **Add stack**
2. Set **Build method** to **Web editor**
3. Copy the contents of `docker-compose.yml` into the editor
3. In **Environment variables**, add:
   - `MUSIC_PATH=/path/to/your/music` (absolute path on the Portainer host)
   - `PORT=8000` (optional)
4. Click **Deploy the stack**

> **Note:** In Portainer, the "Build method: Web editor" uses the Compose file you paste. The `.env` file is **not** automatically read from the repository — you must add environment variables in the Portainer UI (Environment variables section).

---

### Using the Default `./music` Folder (No Configuration)

If you don't create a `.env` file, the application falls back to a `music` folder in the project root:

```bash
git clone <repository-url>
cd audio-metadati-manager
mkdir music        # create a music folder in the project
docker compose up -d --build
```

This is convenient for quick testing but **not recommended for persistent libraries** — the `music` folder lives inside the project directory and may be lost if you remove the project.

---

### Common Docker Commands
- View logs: `docker compose logs -f`
- Stop application: `docker compose down`
- Change host port: set `PORT=8080` in your `.env` (or in your shell) — `docker-compose.yml` already reads `${PORT:-8000}`.

### Multiple music folders

By default the application reads a single music root (`MUSIC_PATH` → `/music`).
If your music is spread over several disks, add the extra paths to `.env`:

```bash
MUSIC_PATH=/mnt/primary-disk/music
MUSIC_PATH_2=/mnt/secondary-disk/albums
MUSIC_PATH_3=/mnt/third-disk/field-recordings
```

Each host path is mounted on its own stable container path, so the application
never confuses them:

| `.env` variable | inside the container |
|-----------------|----------------------|
| `MUSIC_PATH`    | `/music`             |
| `MUSIC_PATH_2`  | `/music-roots/music2`|
| `MUSIC_PATH_3`  | `/music-roots/music3`|

`MUSIC_PATH_2` and `MUSIC_PATH_3` are **optional**: leave them out and everything
behaves exactly as before, with one single root.

**Adding a mount later.** The mounts are fixed when the container starts, so after
adding or changing a host path in `.env` recreate the container:

```bash
docker compose up -d --build     # or simply: docker compose up -d
```

**Selecting the folders.** Open the application and press **Cartelle musicali** in
the toolbar. The dialog lets you:

- browse each mounted root one directory at a time and add the folder you want
  (a sub-folder of the root is enough — the whole root works too);
- give each entry a readable label;
- see at a glance whether a folder is **available** (the disk is mounted) or
  **missing** (unplugged / wrong path);
- remove a folder from the library — this only deletes the entry, never a file.

Once at least one folder is registered, **SCAN** and the reload button read all of
them together; files reachable from two overlapping entries are imported only once.

The selected folders are stored in the `audio-data` Docker volume, so they survive
container restarts and image rebuilds.

#### Diagnosing a folder that is not accessible

| Symptom | Cause | What to do |
|---------|-------|------------|
| `docker compose up` fails with `bind source path does not exist` | the host folder in `MUSIC_PATH_2` / `MUSIC_PATH_3` does not exist | create the folder or fix the path in `.env`, then `docker compose up -d` |
| A root shows *not available* in the dialog | the disk is not mounted in the running container | `docker compose up -d` to recreate it after editing `.env` |
| A folder shows **MISSING** | the disk was unplugged after start-up | reconnect it and press the reload button; nothing is re-registered automatically |
| A folder is registered but the scan returns 0 tracks | the folder has no `.mp3`, `.flac` or `.m4a` files, or they live deeper in sub-folders | check the folder contents; hidden folders (`.something`) are not offered by the browser |
| On macOS the folder is empty | the folder is not shared with Docker Desktop | add it in Docker Desktop → Settings → Resources → File sharing |

Nothing of the host filesystem is exposed beyond the folders you mounted, and the
browser can only navigate inside them: it never sends an absolute path, and the
server re-validates every request with `realpath()`.

### Music folder requirements

- The host folder must **exist**. If it does not, Docker creates an empty one and the
  library will appear empty.
- It must be **accessible to Docker**: on macOS and Windows, share the folder with
  Docker Desktop (`HOME`, `/Volumes` and `/private` are shared by default).
- The container needs **write access** to it, because metadata and embedded cover art
  are written into your audio files. Every music mount (including `MUSIC_PATH_2` and
  `MUSIC_PATH_3`) is therefore read-write; adding `read_only: true` to an entry in
  `docker-compose.yml` makes that root browsable but not editable.

### Permissions

The container runs as root by default to ensure it can write metadata to your mounted music files. If you prefer a specific user, you can add `user: "1000:1000"` (replacing with your UID/GID) to `docker-compose.yml`, provided that user has write access to the music folder on the host.

---

### Portainer Deployment

The application works seamlessly with Portainer. Since Portainer manages Docker Compose stacks, you have two options:

#### Option A: Stack from Repository (Recommended)

1. In Portainer, go to **Stacks** → **Add stack**
2. Set **Name**: `audio-metadati-manager`
3. Set **Build method** to **Repository**
3. Enter your repository URL and branch
4. In **Environment variables**, add:
   - `MUSIC_PATH=/path/to/your/music`  (absolute path on the **Portainer host**)
   - `PORT=8000` (optional, defaults to 8000)
5. Click **Deploy the stack**

> **Important for Portainer:** The `MUSIC_PATH` must be an **absolute path on the Portainer host** (the machine where Docker runs). Portainer does **not** expand `~` (tilde). The folder must exist on the Portainer host and be accessible to Docker.

#### Option B: Stack from Local Compose File

1. In Portainer, go to **Stacks** → **Add stack**
2. Set **Build method** to **Web editor**
3. Copy the contents of `docker-compose.yml` into the editor
3. In **Environment variables**, add:
   - `MUSIC_PATH=/path/to/your/music` (absolute path on the Portainer host)
   - `PORT=8000` (optional)
4. Click **Deploy the stack**

> **Note:** In Portainer, the "Build method: Web editor" uses the Compose file you paste. The `.env` file is **not** automatically read from the repository — you must add environment variables in the Portainer UI (Environment variables section).

---

### Using the Default `./music` Folder (No Configuration)

If you don't create a `.env` file, the application falls back to a `music` folder in the project root:

```bash
git clone <repository-url>
cd audio-metadati-manager
mkdir music        # create a music folder in the project
docker compose up -d --build
```

This is convenient for quick testing but **not recommended for persistent libraries** — the `music` folder lives inside the project directory and may be lost if you remove the project.

---

### Common Docker Commands
- View logs: `docker compose logs -f`
- Stop application: `docker compose down`
- Change host port: set `PORT=8080` in your `.env` (or in your shell) — `docker-compose.yml` already reads `${PORT:-8000}`.

### Multiple music folders

By default the application reads a single music root (`MUSIC_PATH` → `/music`).
If your music is spread over several disks, add the extra paths to `.env`:

```bash
MUSIC_PATH=/mnt/primary-disk/music
MUSIC_PATH_2=/mnt/secondary-disk/albums
MUSIC_PATH_3=/mnt/third-disk/field-recordings
```

Each host path is mounted on its own stable container path, so the application
never confuses them:

| `.env` variable | inside the container |
|-----------------|----------------------|
| `MUSIC_PATH`    | `/music`             |
| `MUSIC_PATH_2`  | `/music-roots/music2`|
| `MUSIC_PATH_3`  | `/music-roots/music3`|

`MUSIC_PATH_2` and `MUSIC_PATH_3` are **optional**: leave them out and everything
behaves exactly as before, with one single root.

**Adding a mount later.** The mounts are fixed when the container starts, so after
adding or changing a host path in `.env` recreate the container:

```bash
docker compose up -d --build     # or simply: docker compose up -d
```

**Selecting the folders.** Open the application and press **Cartelle musicali** in
the toolbar. The dialog lets you:

- browse each mounted root one directory at a time and add the folder you want
  (a sub-folder of the root is enough — the whole root works too);
- give each entry a readable label;
- see at a glance whether a folder is **available** (the disk is mounted) or
  **missing** (unplugged / wrong path);
- remove a folder from the library — this only deletes the entry, never a file.

Once at least one folder is registered, **SCAN** and the reload button read all of
them together; files reachable from two overlapping entries are imported only once.

The selected folders are stored in the `audio-data` Docker volume, so they survive
container restarts and image rebuilds.

#### Diagnosing a folder that is not accessible

| Symptom | Cause | What to do |
|---------|-------|------------|
| `docker compose up` fails with `bind source path does not exist` | the host folder in `MUSIC_PATH_2` / `MUSIC_PATH_3` does not exist | create the folder or fix the path in `.env`, then `docker compose up -d` |
| A root shows *not available* in the dialog | the disk is not mounted in the running container | `docker compose up -d` to recreate it after editing `.env` |
| A folder shows **MISSING** | the disk was unplugged after start-up | reconnect it and press the reload button; nothing is re-registered automatically |
| A folder is registered but the scan returns 0 tracks | the folder has no `.mp3`, `.flac` or `.m4a` files, or they live deeper in sub-folders | check the folder contents; hidden folders (`.something`) are not offered by the browser |
| On macOS the folder is empty | the folder is not shared with Docker Desktop | add it in Docker Desktop → Settings → Resources → File sharing |

Nothing of the host filesystem is exposed beyond the folders you mounted, and the
browser can only navigate inside them: it never sends an absolute path, and the
server re-validates every request with `realpath()`.

### Music folder requirements

- The host folder must **exist**. If it does not, Docker creates an empty one and the
  library will appear empty.
- It must be **accessible to Docker**: on macOS and Windows, share the folder with
  Docker Desktop (`HOME`, `/Volumes` and `/private` are shared by default).
- The container needs **write access** to it, because metadata and embedded cover art
  are written into your audio files. Every music mount (including `MUSIC_PATH_2` and
  `MUSIC_PATH_3`) is therefore read-write; adding `read_only: true` to an entry in
  `docker-compose.yml` makes that root browsable but not editable.

### Permissions

The container runs as root by default to ensure it can write metadata to your mounted music files. If you prefer a specific user, you can add `user: "1000:1000"` (replacing with your UID/GID) to `docker-compose.yml`, provided that user has write access to the music folder on the host.

---

### Manual Installation (Non-Docker)

Create a Python virtual environment and install the dependency:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### PHP installation

- **Debian / Ubuntu**

  ```bash
  sudo apt-get update
  sudo apt-get install php python3 python3-venv python3-pip
  ```

- **macOS**

  ```bash
  brew install php python3
  ```

- **Windows**

  Download and install PHP from [php.net](https://www.php.net/downloads) and Python from [python.org](https://www.python.org/downloads/), then make sure both are available on your `PATH`.

## Configuration

> **With Docker**, you don't need any of the following: set `MUSIC_PATH` in `.env`
> (see [Docker setup](#docker-recommended-for-home-servers)) and your host folder is
> mounted as `/music`, which the application reads automatically.

The application needs to know where your music library is. There are three ways to configure it, in order of precedence:

1. **Local configuration file** – copy the example and edit it:

   ```bash
   cp web/config.example.php web/config.local.php
   ```

   Then set your path in `web/config.local.php`:

   ```php
   define('AUDIO_LIBRARY_PATH', '/path/to/your/music');
   ```

   `web/config.local.php` is ignored by Git and never committed.

2. **Environment variable**

   ```bash
   export AUDIO_LIBRARY_OVERRIDE=/path/to/your/music
   ```

3. **No configuration** – if neither of the above is set, the application starts with an empty library and you can type a path directly in the web interface.

> Replace `/path/to/your/music` with the actual path of your music folder.

**Additional roots without Docker.** The same multi-root logic used in Docker can
be enabled by hand with `AUDIO_MUSIC_ROOTS`, a comma separated list of `id:path`
pairs. `AUDIO_LIBRARY_OVERRIDE` (or `AUDIO_LIBRARY_PATH`) stays the first root and
keeps the identifier `music`:

```bash
export AUDIO_LIBRARY_OVERRIDE=/srv/music
export AUDIO_MUSIC_ROOTS=music2:/mnt/second-disk,music3:/mnt/third-disk
```

Where the registered folders are stored: in `AUDIO_DATA_DIR` when it is set,
otherwise in the `data/` folder of the project. Set it to a persistent location if
you run the application without Docker.

## Starting the application

### Using the script

```bash
./start.sh
```

The server listens on `http://localhost:8000`. To use a different port:

```bash
./start.sh 8080
# or
PORT=8080 ./start.sh
```

### Manually

From the project root:

```bash
php -S 0.0.0.0:8000 -t web
```

- **Local access:** open `http://localhost:8000`
- **LAN access:** open `http://<your-ip>:8000` from another device on the same network (make sure your firewall allows the port)

The document root is the `web/` folder.

## Using the web interface

1. **Open the application** at `http://localhost:8000`.
2. **Configure the library** – the path is shown in the top bar. If it is empty, type your music path and press **SCAN**.
3. **Scan the directory** – click **SCAN** (or press Enter in the path box) to load the tracks.
4. **Browse tracks** – the table shows cover, track number, title, artist, album, genre, year, duration, filename and status.
5. **Search and filter** – type in the search box (title, artist, album, genre, filename) or use the format/status filters.
6. **Select the music folders** (optional, once) – click **Cartelle musicali** in the toolbar to browse the mounted roots and register the folders you want in the library. See [Multiple music folders](#multiple-music-folders).
7. **Play** – press the **Play** button of a track (artist/album tree or flat list) or of an album card. The header mini player takes over: it shows the title, and *Next* / *Previous* walk through the album (or through the visible list, when the playback was started from a single track of the flat list).
8. **Select a track** – click a row to open the details panel (side panel on desktop, off-canvas on mobile).
9. **Edit metadata** – change any field in the details panel. The row is highlighted and marked **UNSAVED**.
10. **Save changes** – click **Save** in the details panel, or use **Save** in the toolbar to save all pending changes at once.
11. **Bulk changes** – tick the checkboxes of several tracks, click **Edit Selected**, fill the metadata fields you want to change and press **Salva modifiche**. The fields are applied and saved in one operation. Cover selection is not part of Bulk Edit.
12. **Manage album covers** – in the Artists view, click **Scegli copertina** in an album header, choose an image (or upload a new one) and press **Apply**; no additional save is required. See [Cover management](#cover-management).

## Cover management

Cover management is centralized at album level in the Artists view.

- Each album card has a **Scegli copertina** button. It opens the shared cover selector and does not expand or collapse the album.
- The selector lists JPEG/JPG images (`.jpg`, `.jpeg`, `.JPG`, `.JPEG`, etc.) detected in the folders of the album tracks. **Upload Cover** adds a new JPEG to the album folder with a free name; existing images are never overwritten, and the upload is not applied automatically.
- Pressing **Apply** performs the only save operation for the cover: the selected image is written as `cover.jpeg` in every folder represented by the album and is embedded in the metadata of every track of that album. No additional single-track save is required.
- Existing `cover.*` / `cpver.*` images (`.jpg`, `.jpeg`, `.png`, `.webp`, case-insensitive) are preserved. Before installing the new external cover, every existing variant is renamed to a unique five-letter name with its original extension, except a `cover.jpeg` that already contains exactly the selected bytes: that file is left in place, other variants are still preserved, and no duplicate backup is created. `cover.jpeg` is the standard external cover filename.
- External updates are transactional: if a folder update fails, the previous covers are restored. If a track cannot be embedded, the operation reports a partial result while the successfully updated tracks keep the new cover.
- Track Details still shows the current cover preview, but it no longer offers cover selection, upload or removal. Bulk Edit has no cover controls; its metadata fields continue to work as before.
- The album selector offers selection and upload, not cover removal. The application never downloads covers from the Internet.

## Command-line interface

The original CLI is still available and uses the same Python core:

```bash
source .venv/bin/activate
python3 metadati.py
```

It asks for a music folder, a global artist/album/year, and then the title and track number for every file, saving the tags directly.

## Project structure

```
.
├── install.sh              # One-shot installation script
├── start.sh                # Web server startup script
├── docker-compose.yml      # Docker Compose configuration (reads MUSIC_PATH*)
├── docker-placeholder/     # Empty folders used when MUSIC_PATH_2/3 are unset
├── .env.example            # Template for .env — committed, no secrets
├── .env                    # Local Docker settings (ignored by Git)
├── requirements.txt        # Python dependencies (mutagen)
├── metadati.py             # Command-line interface
├── python/
│   ├── core.py             # Python audio core (metadata + covers, mutagen)
│   └── comm.py             # JSON command-line bridge used by PHP
└── web/
    ├── index.php           # Main entry point (HTML + Bootstrap UI)
    ├── config.php          # Configuration loader (portable)
    ├── config.example.php  # Template for the local configuration
    └── api/
        ├── bootstrap.php       # Shared helpers (Python bridge, path checks, JSON)
        ├── library-roots.php   # Authorized music roots + safe relative paths
        ├── library-folders.php # Persistent list of registered folders
        #   ^ the three files above are includes, not endpoints: requesting them
        #     directly returns 403 with a JSON error, never an empty 200.
        ├── config.php          # GET  - application configuration (root + roots[])
        ├── browse.php          # GET  - list ONE directory level of a root
        ├── folders.php         # GET/POST - list / add / remove registered folders
        ├── library.php         # GET  - scan every registered folder and merge
        ├── tracks.php          # GET  - list tracks
        ├── metadata.php        # GET  - track metadata
        ├── save.php            # POST - save a track's metadata + optional cover
        ├── scan.php            # POST - scan a folder
        ├── bulk-update.php     # POST - bulk metadata / album cover / remove-cover
        ├── audio.php           # GET  - stream audio with Range support
        └── cover.php           # GET  - serve cover images
    └── assets/
        ├── css/style.css   # Custom dark theme
        └── js/app.js       # Vanilla JavaScript + Fetch API
```

## API

All endpoints return JSON. Success responses use `"success": true`, errors use `"success": false` with an `"error"` message.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/config.php` | Return the application configuration (`library_path`, `roots[]`) |
| `GET` | `/api/browse.php?root=music2&path=Rock` | List one directory level inside an authorized root |
| `GET` | `/api/folders.php` | List the registered music folders |
| `POST` | `/api/folders.php` | `{"action":"add","root":"music2","path":"Rock"}` / `{"action":"remove","id":"f_..."}` |
| `GET` | `/api/library.php` | Scan every registered folder and return the merged, de-duplicated track list |
| `GET` | `/api/tracks.php?path=/folder` | Return the list of tracks in a folder |
| `GET` | `/api/metadata.php?path=/file` | Return the metadata of a single track |
| `POST` | `/api/save.php` | Save metadata (and cover) of a track |
| `POST` | `/api/scan.php` | Scan a folder and return its tracks |
| `POST` | `/api/bulk-update.php` | Bulk metadata save, album cover (`action:"cover"`), remove-cover (`action:"remove_cover"`) |
| `GET` | `/api/cover.php?path=/file` | Serve a cover image (folder JPEG or embedded) |
| `POST` | `/api/upload-album-cover.php` | Store a new JPEG in the album folder (`path`, `cover`); does not embed it |
| `GET` | `/api/audio.php?path=/file` | Stream audio with Range support |

The web interface applies covers only from the album header. The single-track `save.php` cover field and the `bulk-update.php` `remove_cover` action remain available at API level.

## API Examples

List tracks:

```bash
curl "http://localhost:8000/api/tracks.php?path=/path/to/your/music"
```

Get a track's metadata:

```bash
curl "http://localhost:8000/api/metadata.php?path=/path/to/your/music/album/track.m4a"
```

Save metadata (and embed a cover):

```bash
curl -X POST "http://localhost:8000/api/save.php" \
  -H "Content-Type: application/json" \
  -d '{
        "path": "/path/to/your/music/track.m4a",
        "title": "New Title",
        "artist": "Artist Name",
        "album": "Album Name",
        "album_artist": "Artist Name",
        "year": "2024",
        "track": 1,
        "total": 12,
        "genre": "Rock",
        "cover": "/path/to/your/music/cover.jpg"
      }'
```

Bulk save:

```bash
curl -X POST "http://localhost:8000/api/bulk-update.php" \
  -H "Content-Type: application/json" \
  -d '{
        "action": "save",
        "tracks": [
          { "path": "/path/to/your/music/track1.m4a", "album": "Album Name", "artist": "Artist Name" },
          { "path": "/path/to/your/music/track2.m4a", "album": "Album Name", "artist": "Artist Name" }
        ]
      }'
```

Apply one cover to an album (the same operation used by the album header):

```bash
curl -X POST "http://localhost:8000/api/bulk-update.php" \
  -H "Content-Type: application/json" \
  -d '{
        "action": "cover",
        "paths": [
          "/path/to/your/music/album/track1.m4a",
          "/path/to/your/music/album/track2.m4a"
        ],
        "image": "/path/to/your/music/album/new-cover.jpg"
      }'
```

## Security

- **Input validation** – all browser input is validated before reaching Python.
- **Path normalization** – paths are resolved with `realpath()` and rejected if they do not exist.
- **Path traversal protection** – when a library root is configured, only paths inside one of the roots are accepted.
- **Command injection protection** – every argument passed to Python is shell-escaped with `escapeshellarg()`.
- **Explicit writes** – audio files are never re-encoded; metadata and covers are written only when the user saves.
- **Artwork preservation** – applying an album cover never deletes existing artwork: old cover variants are renamed to unique five-letter names, and audio files are never re-encoded.
- **No half-open doors** – the shared include files that live inside the served document root (`web/config.php`, `web/api/bootstrap.php`, `web/api/library-roots.php`, `web/api/library-folders.php`) refuse direct requests with `403` and a JSON error. They used to answer `200` with an empty body, which looks exactly like a silent crash to a client calling `response.json()`.

## Troubleshooting

- **`php: command not found`** – PHP 8.0+ is not installed or not on your `PATH`. See the PHP installation section.
- **`python3: command not found`** – Python 3.8+ is not installed or not on your `PATH`.
- **`No module named 'mutagen'`** – the virtual environment is missing the dependency. Run `./install.sh` or `pip install -r requirements.txt`.
- **`Permission denied` on install/start** – the scripts must be executable: `chmod +x install.sh start.sh`.
- **Music directory inaccessible** – make sure the web server process can read the folder and that the path exists.
- **`Invalid library folder` / empty library** – check the path in `web/config.local.php`, the `AUDIO_LIBRARY_OVERRIDE` environment variable, or the path typed in the interface.
- **Port already in use** – start on another port: `./start.sh 8080`.
- **Browser cannot connect** – make sure the server is running and check the URL/port.
- **LAN access blocked** – allow the port in your firewall, and use your machine's LAN IP address.

## Contributing

The Python core lives in `python/core.py` (metadata and cover logic) and `python/comm.py` (JSON bridge for PHP). The PHP API is in `web/api/`, and the frontend is in `web/index.php` plus `web/assets/`.

To test a change, start the server with `./start.sh` and exercise the interface, or call the Python core directly:

```bash
.venv/bin/python python/comm.py list_tracks /path/to/your/music
```

Please open an issue or a pull request on GitHub for bugs, improvements and documentation fixes.

## License

This project does not currently include a LICENSE file. Before publishing, choose an appropriate open-source license and add it, or contact the author to clarify the licensing terms.