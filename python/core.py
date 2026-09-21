import os
import re
import json
import sys
import base64
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
    """
    save_tags(path, title, artist, album, album_artist, year, track, total, genre)
    if cover == "__remove__":
        remove_embedded_cover(path)
    elif cover:
        set_embedded_cover(path, cover)


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