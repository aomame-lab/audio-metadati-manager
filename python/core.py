import os
import re
import json
import sys
import base64
import secrets
import string
import tempfile
from mutagen.easyid3 import EasyID3
from mutagen.mp3 import MP3
from mutagen.flac import FLAC
from mutagen.mp4 import MP4
from mutagen.id3 import ID3, APIC
from mutagen.flac import Picture
from mutagen.mp4 import MP4Cover

ansi_escape = re.compile(r'\x1B\[[0-?]*[ -/]*[@-~]')

SUPPORTED = (".mp3", ".flac", ".m4a")
COVER_EXTS = (".jpg", ".jpeg")
EXTERNAL_COVER_STEM = "cover"
LEGACY_EXTERNAL_COVER_STEM = "cpver"
EXTERNAL_COVER_EXTS = (".jpg", ".jpeg", ".png", ".webp")
EXTERNAL_COVER_NAME = "cover.jpeg"
COVER_BACKUP_ATTEMPTS = 1000

_covers_cache = {}


def clean_text(text):
    if not text:
        return ""
    return ansi_escape.sub("", str(text)).strip()


def get_music_files(folder):
    files = []
    for root, _, filenames in os.walk(folder):
        for f in filenames:
            if f.lower().endswith(SUPPORTED):
                files.append(os.path.join(root, f))
    return sorted(files)


def read_title(path):
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == ".mp3":
            audio = EasyID3(path)
            return clean_text(audio.get("title", [""])[0])
        elif ext == ".flac":
            audio = FLAC(path)
            return clean_text(audio.get("title", [""])[0])
        elif ext == ".m4a":
            audio = MP4(path)
            return clean_text(audio.get("\xa9nam", [""])[0])
    except Exception:
        pass
    return ""


def save_tags(path, title, artist, album, album_artist, year, track, total, genre=""):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".mp3":
        try:
            audio = EasyID3(path)
        except Exception:
            audio = MP3(path)
            # Only add tags if they don't exist
            if audio.tags is None:
                audio.add_tags()
            audio = EasyID3(path)
        audio["title"] = [title]
        audio["artist"] = [artist]
        audio["album"] = [album]
        audio["albumartist"] = [album_artist]
        audio["date"] = [year]
        audio["genre"] = [genre]
        audio["tracknumber"] = [f"{track}/{total}"]
        audio.save()
    elif ext == ".flac":
        audio = FLAC(path)
        audio["title"] = [title]
        audio["artist"] = [artist]
        audio["album"] = [album]
        audio["albumartist"] = [album_artist]
        audio["date"] = [year]
        audio["genre"] = [genre]
        audio["tracknumber"] = [str(track)]
        audio.save()
    elif ext == ".m4a":
        audio = MP4(path)
        audio["\xa9nam"] = [title]
        audio["\xa9ART"] = [artist]
        audio["\xa9alb"] = [album]
        audio["aART"] = [album_artist]
        audio["\xa9day"] = [year]
        audio["\xa9gen"] = [genre]
        audio["trkn"] = [(track, total)]
        audio.save()


def cli_command(command, *args):
    """Execute a CLI command and return JSON result.
    Used by PHP backend to communicate with Python core.
    """
    try:
        if command == "get_title":
            if len(args) < 1:
                return json.dumps({"success": False, "error": "Missing path argument"})
            path = args[0]
            title = read_title(path)
            return json.dumps({"success": True, "title": title})

        elif command == "save":
            if len(args) < 9:
                return json.dumps({"success": False, "error": "Missing arguments"})
            path = args[0]
            title = args[1]
            artist = args[2]
            album = args[3]
            album_artist = args[4]
            year = args[5]
            track = int(args[6])
            total = int(args[7])
            genre = args[8]
            cover = args[9] if len(args) > 9 else ""
            if not os.path.isfile(path):
                return json.dumps({"success": False, "error": "File not found"})
            save_full(path, title, artist, album, album_artist, year, track, total, genre, cover)
            return json.dumps({"success": True})

        elif command == "scan":
            if len(args) < 1:
                return json.dumps({"success": False, "error": "Missing folder argument"})
            folder = args[0]
            files = get_music_files(folder)
            tracks = [track_info(f) for f in files]
            return json.dumps({"success": True, "tracks": tracks})

        elif command == "list":
            if len(args) < 1:
                return json.dumps({"success": False, "error": "Missing folder argument"})
            folder = args[0]
            files = get_music_files(folder)
            tracks = [track_info(f) for f in files]
            return json.dumps({"success": True, "tracks": tracks})

        elif command == "list_tracks":
            return cli_command("list", *args)

        elif command == "get_info":
            if len(args) < 1:
                return json.dumps({"success": False, "error": "Missing path argument"})
            path = args[0]
            if not os.path.isfile(path):
                return json.dumps({"success": False, "error": "File not found"})
            return json.dumps({"success": True, "track": track_info(path)})

        elif command == "set_cover":
            if len(args) < 2:
                return json.dumps({"success": False, "error": "Missing arguments"})
            path = args[0]
            image = args[1]
            if not os.path.isfile(path):
                return json.dumps({"success": False, "error": "Audio file not found"})
            set_embedded_cover(path, image)
            return json.dumps({"success": True})

        elif command == "remove_cover":
            if len(args) < 1:
                return json.dumps({"success": False, "error": "Missing path argument"})
            path = args[0]
            if not os.path.isfile(path):
                return json.dumps({"success": False, "error": "Audio file not found"})
            remove_embedded_cover(path)
            return json.dumps({"success": True})

        elif command == "get_embedded_cover":
            if len(args) < 1:
                return json.dumps({"success": False, "error": "Missing path argument"})
            path = args[0]
            if not os.path.isfile(path):
                return json.dumps({"success": False, "error": "File not found"})
            info = read_embedded_cover_b64(path)
            if not info:
                return json.dumps({"success": True, "present": False})
            return json.dumps({"success": True, "present": True, "mime": info["mime"], "data": info["data"]})

        elif command == "save_album_cover":
            if len(args) < 2:
                return json.dumps({"success": False, "error": "Missing arguments"})
            image = args[0]
            if not os.path.isfile(image):
                return json.dumps({"success": False, "error": "Cover image not found"})
            return json.dumps(save_album_cover(image, args[1:]))

        else:
            return json.dumps({"success": False, "error": f"Unknown command: {command}"})

    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


def read_artist(path):
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == ".mp3":
            audio = EasyID3(path)
            return clean_text(audio.get("artist", [""])[0])
        elif ext == ".flac":
            audio = FLAC(path)
            return clean_text(audio.get("artist", [""])[0])
        elif ext == ".m4a":
            audio = MP4(path)
            return clean_text(audio.get("\xa9ART", [""])[0])
    except Exception:
        pass
    return ""


def read_album(path):
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == ".mp3":
            audio = EasyID3(path)
            return clean_text(audio.get("album", [""])[0])
        elif ext == ".flac":
            audio = FLAC(path)
            return clean_text(audio.get("album", [""])[0])
        elif ext == ".m4a":
            audio = MP4(path)
            return clean_text(audio.get("\xa9alb", [""])[0])
    except Exception:
        pass
    return ""


def read_tracknumber(path):
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == ".mp3":
            audio = EasyID3(path)
            return clean_text(audio.get("tracknumber", ["0/0"])[0])
        elif ext == ".flac":
            audio = FLAC(path)
            return clean_text(audio.get("tracknumber", ["0"])[0])
        elif ext == ".m4a":
            audio = MP4(path)
            tck = audio.get("trkn", [(0, 1)])
            return clean_text(str(tck[0][0]))
    except Exception:
        pass
    return ""


def read_total_tracks(path):
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == ".mp3":
            audio = EasyID3(path)
            return clean_text(audio.get("totaltracks", ["1"])[0])
        elif ext == ".flac":
            audio = FLAC(path)
            return clean_text(audio.get("totaltracks", ["1"])[0])
        elif ext == ".m4a":
            audio = MP4(path)
            tck = audio.get("trkn", [(0, 1)])
            return clean_text(str(tck[0][1]))
    except Exception:
        pass
    return "1"


def read_year(path):
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == ".mp3":
            audio = EasyID3(path)
            return clean_text(audio.get("date", [""])[0])
        elif ext == ".flac":
            audio = FLAC(path)
            return clean_text(audio.get("date", [""])[0])
        elif ext == ".m4a":
            audio = MP4(path)
            return clean_text(audio.get("\xa9day", [""])[0])
    except Exception:
        pass
    return ""


def read_genre(path):
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == ".mp3":
            audio = EasyID3(path)
            return clean_text(audio.get("genre", [""])[0])
        elif ext == ".flac":
            audio = FLAC(path)
            return clean_text(audio.get("genre", [""])[0])
        elif ext == ".m4a":
            audio = MP4(path)
            return clean_text(audio.get("\xa9gen", [""])[0])
    except Exception:
        pass
    return ""


def read_duration(path):
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == ".mp3":
            audio = MP3(path)
            return round(audio.info.length, 1)
        elif ext == ".flac":
            audio = FLAC(path)
            return round(audio.info.length, 1)
        elif ext == ".m4a":
            audio = MP4(path)
            return round(audio.info.length, 1)
    except Exception:
        pass
    return 0


def read_album_artist(path):
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == ".mp3":
            audio = EasyID3(path)
            return clean_text(audio.get("albumartist", [""])[0])
        elif ext == ".flac":
            audio = FLAC(path)
            return clean_text(audio.get("albumartist", [""])[0])
        elif ext == ".m4a":
            audio = MP4(path)
            return clean_text(audio.get("aART", [""])[0])
    except Exception:
        pass
    return ""


def find_covers(folder):
    """Find JPEG/JPG images (case-insensitive) in the same folder. Never modifies the originals."""
    if not folder or not os.path.isdir(folder):
        return []
    try:
        names = os.listdir(folder)
    except OSError:
        return []
    covers = []
    for name in names:
        ext = os.path.splitext(name)[1].lower()
        if ext in COVER_EXTS:
            p = os.path.join(folder, name)
            if os.path.isfile(p):
                covers.append(p)
    return sorted(covers)


def _random_cover_stem():
    """Five random letters, e.g. aBcDe."""
    return "".join(secrets.choice(string.ascii_letters) for _ in range(5))


def _unique_cover_backup_path(folder, extension):
    reserved = {EXTERNAL_COVER_STEM, LEGACY_EXTERNAL_COVER_STEM}
    for _ in range(COVER_BACKUP_ATTEMPTS):
        stem = _random_cover_stem()
        if stem.lower() in reserved:
            continue
        candidate = os.path.join(folder, stem + extension)
        if not os.path.lexists(candidate):
            return candidate
    raise RuntimeError("Unable to find a unique name for the previous cover")


def _external_cover_files(folder):
    """Return every external cover.* / cpver.* image, case-insensitively."""
    try:
        names = os.listdir(folder)
    except OSError as exc:
        raise RuntimeError(f"Unable to list the album folder: {exc}") from exc

    covers = []
    for name in names:
        stem, extension = os.path.splitext(name)
        if stem.lower() not in (EXTERNAL_COVER_STEM, LEGACY_EXTERNAL_COVER_STEM):
            continue
        if extension.lower() not in EXTERNAL_COVER_EXTS:
            continue
        path = os.path.join(folder, name)
        if os.path.isfile(path):
            covers.append(path)
    return sorted(covers)


def _write_cover_temp(folder, data):
    fd, path = tempfile.mkstemp(prefix=".cover-", suffix=".tmp", dir=folder)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(path, 0o644)
        return path
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.unlink(path)
        except OSError:
            pass
        raise


def _restore_external_cover(result):
    """Undo an update_external_cover result, keeping every old image reachable."""
    target = result.get("path")
    if not target:
        return
    errors = []
    if result.get("changed"):
        try:
            os.unlink(target)
        except FileNotFoundError:
            pass
        except OSError as exc:
            errors.append(f"remove new cover: {exc}")
    for backup, original in reversed(result.get("backups", [])):
        try:
            os.replace(backup, original)
        except OSError as exc:
            errors.append(f"restore {original}: {exc}")
    if errors:
        raise RuntimeError("; ".join(errors))


def _update_external_cover_data(data, folder):
    """Install already-read image bytes as the folder's external cover.jpeg."""
    if not folder or not os.path.isdir(folder):
        raise ValueError(f"Album folder not found: {folder}")
    if not data:
        raise ValueError("Cover image is empty")

    target = os.path.join(folder, EXTERNAL_COVER_NAME)
    existing = _external_cover_files(folder)
    target_is_current = False
    if os.path.isfile(target):
        try:
            with open(target, "rb") as handle:
                target_is_current = handle.read() == data
        except OSError:
            pass

    # Re-saving the same image must not duplicate backups in bulk operations.
    # Other cover variants are still preserved, while cover.jpeg already holds
    # the requested bytes. samefile also covers COVER.JPEG on case-insensitive
    # filesystems.
    to_backup = []
    for path in existing:
        if target_is_current:
            try:
                if os.path.samefile(path, target):
                    continue
            except OSError:
                pass
        to_backup.append(path)
    if target_is_current and not to_backup:
        return {"path": target, "changed": False, "backups": []}

    temp_path = None if target_is_current else _write_cover_temp(folder, data)
    result = {"path": target, "changed": False, "backups": []}
    try:
        for old_path in to_backup:
            extension = os.path.splitext(old_path)[1]
            backup = _unique_cover_backup_path(folder, extension)
            os.rename(old_path, backup)
            result["backups"].append((backup, old_path))

        if temp_path is not None:
            os.replace(temp_path, target)
            result["changed"] = True
        return result
    except Exception as exc:
        try:
            _restore_external_cover(result)
        except Exception as restore_exc:
            raise RuntimeError(f"{exc}; unable to restore the previous cover: {restore_exc}") from exc
        raise
    finally:
        if temp_path is not None and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except OSError:
                pass


def update_external_cover(image_path, folder):
    """Make image_path the album's external cover.jpeg.

    Every existing cover.* or cpver.* image (JPG/JPEG/PNG/WebP, any case) is
    renamed to a unique five-letter name that keeps its original extension.
    The operation is transactional: if anything fails, the previous files are
    restored.
    """
    if not image_path or not os.path.isfile(image_path):
        raise ValueError(f"Cover image not found: {image_path}")
    with open(image_path, "rb") as handle:
        data = handle.read()
    return _update_external_cover_data(data, folder)


def save_album_cover(image_path, track_paths):
    """Apply one cover to every track of an album.

    The image is read once, so it can safely live inside one of the folders
    being updated. Every distinct album folder receives the same external
    cover.jpeg; the embedded cover of every track is then replaced with it.
    External updates are rolled back if a later folder update fails or if no
    track could be embedded. Per-track embedding failures are reported while
    the successfully updated tracks keep the new cover.
    """
    if not image_path or not os.path.isfile(image_path):
        raise ValueError(f"Cover image not found: {image_path}")
    extension = os.path.splitext(image_path)[1].lower()
    if extension not in COVER_EXTS:
        raise ValueError("Only JPEG/JPG covers are supported")

    paths = []
    seen = set()
    for path in track_paths:
        if not path:
            continue
        absolute = os.path.abspath(path)
        if absolute in seen:
            continue
        seen.add(absolute)
        paths.append(absolute)
    if not paths:
        raise ValueError("No tracks specified")
    for path in paths:
        if not os.path.isfile(path):
            raise ValueError(f"Audio file not found: {path}")

    with open(image_path, "rb") as handle:
        data = handle.read()
    if not data:
        raise ValueError("Cover image is empty")

    folders = []
    for path in paths:
        folder = os.path.dirname(path)
        if folder not in folders:
            folders.append(folder)

    external = []
    try:
        for folder in folders:
            external.append(_update_external_cover_data(data, folder))
    except Exception as exc:
        restore_errors = []
        for result in reversed(external):
            try:
                _restore_external_cover(result)
            except Exception as restore_exc:
                restore_errors.append(str(restore_exc))
        message = f"External cover update failed: {exc}"
        if restore_errors:
            message += "; unable to restore the previous cover: " + "; ".join(restore_errors)
        raise RuntimeError(message) from exc

    saved = []
    failed = []
    for path in paths:
        folder = os.path.dirname(path)
        try:
            set_embedded_cover(path, os.path.join(folder, EXTERNAL_COVER_NAME))
        except Exception as exc:
            failed.append({"path": path, "error": str(exc)})
        else:
            saved.append(path)

    # No audio file changed: leave the previous external covers in place too.
    if not saved and failed:
        restore_errors = []
        for result in reversed(external):
            try:
                _restore_external_cover(result)
            except Exception as restore_exc:
                restore_errors.append(str(restore_exc))
        if restore_errors:
            failed.append({
                "path": folders[0],
                "error": "Unable to restore the previous external cover: " + "; ".join(restore_errors),
            })

    return {
        "success": not failed,
        "external": [
            {"folder": os.path.dirname(result["path"]), "changed": bool(result["changed"])}
            for result in external
        ],
        "saved": saved,
        "failed": failed,
    }


def _embedded_cover_info(path):
    """Return a dict {'data': bytes, 'mime': str} or None."""
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == ".mp3":
            audio = ID3(path)
            frames = audio.getall("APIC")
            if frames and frames[0].data:
                return {"data": frames[0].data, "mime": frames[0].mime or "image/jpeg"}
        elif ext == ".flac":
            audio = FLAC(path)
            if audio.pictures:
                pic = audio.pictures[0]
                return {"data": pic.data, "mime": pic.mime or "image/jpeg"}
        elif ext == ".m4a":
            audio = MP4(path)
            covr = audio.tags.get("covr") if audio.tags else None
            if covr:
                mime = "image/jpeg" if covr[0].imageformat == MP4Cover.FORMAT_JPEG else "image/png"
                return {"data": bytes(covr[0]), "mime": mime}
    except Exception:
        pass
    return None


def has_embedded_cover(path):
    return _embedded_cover_info(path) is not None


def read_embedded_cover_b64(path):
    info = _embedded_cover_info(path)
    if not info:
        return None
    return {"mime": info["mime"], "data": base64.b64encode(info["data"]).decode("ascii")}


def set_embedded_cover(path, image_path):
    """Embed an existing JPEG using its original bytes (no recompression)."""
    if not image_path or not os.path.isfile(image_path):
        raise ValueError(f"Cover image not found: {image_path}")
    img_ext = os.path.splitext(image_path)[1].lower()
    if img_ext not in COVER_EXTS:
        raise ValueError("Only JPEG/JPG covers are supported")
    with open(image_path, "rb") as fh:
        data = fh.read()
    if not data:
        raise ValueError("Cover image is empty")

    ext = os.path.splitext(path)[1].lower()
    if ext == ".mp3":
        audio = MP3(path)
        # Only add tags if they don't exist
        if audio.tags is None:
            audio.add_tags()
        audio.tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=data))
        audio.save()
    elif ext == ".flac":
        audio = FLAC(path)
        audio.clear_pictures()
        pic = Picture()
        pic.type = 3
        pic.mime = "image/jpeg"
        pic.data = data
        audio.add_picture(pic)
        audio.save()
    elif ext == ".m4a":
        audio = MP4(path)
        audio["covr"] = [MP4Cover(data, imageformat=MP4Cover.FORMAT_JPEG)]
        audio.save()
    else:
        raise ValueError(f"Unsupported audio format: {ext}")


def remove_embedded_cover(path):
    """Remove the embedded cover without touching the JPEG files on disk."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".mp3":
        try:
            audio = ID3(path)
        except Exception:
            return
        if audio.getall("APIC"):
            audio.delall("APIC")
            audio.save()
    elif ext == ".flac":
        audio = FLAC(path)
        if audio.pictures:
            audio.clear_pictures()
            audio.save()
    elif ext == ".m4a":
        audio = MP4(path)
        if audio.tags and "covr" in audio.tags:
            del audio.tags["covr"]
            audio.save()


def save_full(path, title, artist, album, album_artist, year, track, total, genre, cover=""):
    """Save the metadata and, when requested, embed or remove the cover.

    cover: "" (no change), "__remove__" (remove), or a JPEG path to embed.
    A selected external JPEG also becomes the album's cover.jpeg; every
    existing cover.*/cpver.* image is preserved under a unique random name.
    """
    save_tags(path, title, artist, album, album_artist, year, track, total, genre)
    if cover == "__remove__":
        remove_embedded_cover(path)
    elif cover:
        external = update_external_cover(cover, os.path.dirname(os.path.abspath(path)))
        try:
            set_embedded_cover(path, external["path"])
        except Exception as exc:
            try:
                _restore_external_cover(external)
            except Exception as restore_exc:
                raise RuntimeError(
                    f"{exc}; unable to restore the previous external cover: {restore_exc}"
                ) from exc
            raise


def track_info(path):
    global _covers_cache
    folder = os.path.dirname(path)
    if folder not in _covers_cache:
        _covers_cache[folder] = find_covers(folder)
    covers = _covers_cache[folder]
    return {
        "path": path,
        "filename": os.path.basename(path),
        "title": read_title(path),
        "artist": read_artist(path),
        "album": read_album(path),
        "album_artist": read_album_artist(path),
        "tracknumber": read_tracknumber(path),
        "total": read_total_tracks(path),
        "year": read_year(path),
        "genre": read_genre(path),
        "duration": read_duration(path),
        "extension": os.path.splitext(path)[1].lower(),
        "has_cover": has_embedded_cover(path),
        "covers": covers,
    }