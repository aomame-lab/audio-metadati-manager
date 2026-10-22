#!/usr/bin/env python3
"""Audio Metadati Manager — Python pipeline tests (mutagen).

Verifies the scan pipeline the PHP layer relies on for the multi folder
library: discovery of audio files, nested folders, folder covers and the
guarantee that the same file is never returned twice when two registered
folders overlap.

    python3 tests/test_scan.py          # or: .venv/bin/python tests/test_scan.py

Every fixture is a valid, silent MPEG-1 Layer III file built on the fly, so the
real music library of the user is never needed.
"""

import base64
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"))

try:
    import core
    from core import (
        get_music_files, track_info, cli_command, find_covers,
        read_embedded_cover_b64, save_full, update_external_cover,
        save_album_cover,
    )
except ModuleNotFoundError as exc:                     # pragma: no cover
    print("mutagen is required: {}".format(exc))
    sys.exit(2)

FRAME_HEADER = b"\xFF\xFB\x90\x00"                   # MPEG1 Layer III 128 kbps 44.1 kHz
FRAME = FRAME_HEADER + b"\x00" * 413

ID3_TITLE = "TIT2"
JPEG_OLD = b"\xff\xd8\xff\xe0OLD-COVER\xff\xd9"
JPEG_NEW = b"\xff\xd8\xff\xe0NEW-COVER\xff\xd9"


def write_bytes(path: str, data: bytes) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data)
    return path


def read_bytes(path: str) -> bytes:
    with open(path, "rb") as handle:
        return handle.read()


def random_cover_backups(folder: str):
    return sorted(
        name for name in os.listdir(folder)
        if os.path.splitext(name)[0].lower() not in ("cover", "cpver", "front")
        and re.fullmatch(r"[A-Za-z]{5}\.(?:jpe?g|png|webp)", name, re.IGNORECASE)
    )


def _id3v23(title: str) -> bytes:
    """Minimal, valid ID3v2.3 tag holding a single TIT2 frame."""
    payload = b"\x00" + title.encode("latin-1", "replace")
    frame = ID3_TITLE.encode("ascii") + len(payload).to_bytes(4, "big") + b"\x00\x00" + payload
    size = len(frame)
    syncsafe = bytes(
        [
            (size >> 21) & 0x7F,
            (size >> 14) & 0x7F,
            (size >> 7) & 0x7F,
            size & 0x7F,
        ]
    )
    return b"ID3\x03\x00\x00" + syncsafe + frame


def make_mp3(path: str, title: str = "") -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(_id3v23(title) + FRAME * 40)
    return path


class ScanPipelineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="amm-py-test-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def root(self, name="root"):
        path = os.path.join(self.tmp, name)
        os.makedirs(path, exist_ok=True)
        return path

    # ------------------------------------------------------------------
    def test_finds_supported_formats_recursively(self):
        root = self.root()
        make_mp3(os.path.join(root, "a.mp3"))
        make_mp3(os.path.join(root, "Album", "b.flac"))      # extension only, not a real FLAC
        make_mp3(os.path.join(root, "Album", "Deep", "c.m4a"))
        with open(os.path.join(root, "notes.txt"), "w", encoding="utf-8") as handle:
            handle.write("ignored")

        found = get_music_files(root)
        names = sorted(os.path.basename(f) for f in found)
        self.assertEqual(["a.mp3", "b.flac", "c.m4a"], names)

    def test_result_is_sorted_and_stable(self):
        root = self.root()
        make_mp3(os.path.join(root, "z.mp3"))
        make_mp3(os.path.join(root, "Album", "a.mp3"))
        first = get_music_files(root)
        self.assertEqual(first, get_music_files(root), "two scans return the same order")

    def test_track_info_is_complete_for_a_real_file(self):
        root = self.root()
        path = make_mp3(os.path.join(root, "song.mp3"), "Real Title")
        info = track_info(path)
        for key in ("path", "filename", "title", "artist", "album", "duration", "has_cover", "covers"):
            self.assertIn(key, info)
        self.assertEqual("Real Title", info["title"])
        self.assertEqual("song.mp3", info["filename"])
        self.assertGreater(info["duration"], 0)
        self.assertEqual(root, os.path.dirname(info["covers"][0]) if info["covers"] else root)

    def test_folder_jpeg_is_reported_as_cover(self):
        root = self.root()
        make_mp3(os.path.join(root, "song.mp3"), "Covered")
        with open(os.path.join(root, "cover.jpg"), "wb") as handle:
            handle.write(b"\xff\xd8\xff\xd9")
        info = track_info(os.path.join(root, "song.mp3"))
        self.assertEqual(1, len(info["covers"]))
        self.assertEqual("cover.jpg", os.path.basename(info["covers"][0]))
        self.assertFalse(info["has_cover"], "a folder JPEG is not an embedded cover")

    def test_find_covers_is_case_insensitive_and_never_walks(self):
        root = self.root()
        for name in ("Cover.JPG", "front.jpeg", "art.png"):
            with open(os.path.join(root, name), "wb") as handle:
                handle.write(b"\xff\xd8")
        os.makedirs(os.path.join(root, "Sub"), exist_ok=True)
        with open(os.path.join(root, "Sub", "hidden.jpg"), "wb") as handle:
            handle.write(b"\xff\xd8")

        covers = [os.path.basename(c) for c in find_covers(root)]
        self.assertEqual(["Cover.JPG", "front.jpeg"], sorted(covers))


    # ------------------------------------------------------------------
    # External album cover update on save
    # ------------------------------------------------------------------
    def album(self):
        path = self.root("album")
        return path

    def test_first_save_promotes_the_selected_image_to_cover_jpeg(self):
        album = self.album()
        track = make_mp3(os.path.join(album, "01.mp3"), "First")
        selected = write_bytes(os.path.join(album, "front.jpg"), JPEG_NEW)

        save_full(track, "First", "Artist", "Album", "Artist", "2024", 1, 1, "Rock", selected)

        self.assertEqual(JPEG_NEW, read_bytes(os.path.join(album, "cover.jpeg")))
        self.assertEqual(JPEG_NEW, read_bytes(selected), "the source image is kept")
        embedded = read_embedded_cover_b64(track)
        self.assertIsNotNone(embedded)
        self.assertEqual(JPEG_NEW, base64.b64decode(embedded["data"]),
                         "the external cover and the embedded cover stay distinct")
        backups = random_cover_backups(album)
        self.assertEqual([], backups, "the first save has no previous cover to preserve")

    def test_replacing_cover_jpg_keeps_the_jpg_extension(self):
        album = self.album()
        write_bytes(os.path.join(album, "cover.jpg"), JPEG_OLD)
        selected = write_bytes(os.path.join(album, "front.jpg"), JPEG_NEW)

        result = update_external_cover(selected, album)

        self.assertTrue(result["changed"])
        self.assertEqual(JPEG_NEW, read_bytes(os.path.join(album, "cover.jpeg")))
        backups = random_cover_backups(album)
        self.assertEqual(1, len(backups), backups)
        self.assertEqual(".jpg", os.path.splitext(backups[0])[1])
        self.assertEqual(JPEG_OLD, read_bytes(os.path.join(album, backups[0])))
        self.assertEqual([os.path.join(album, backups[0])],
                         [backup for backup, _original in result["backups"]])

    def test_replacing_cover_jpeg_keeps_the_jpeg_extension(self):
        album = self.album()
        write_bytes(os.path.join(album, "cover.jpeg"), JPEG_OLD)
        selected = write_bytes(os.path.join(album, "front.jpg"), JPEG_NEW)

        result = update_external_cover(selected, album)

        self.assertTrue(result["changed"])
        self.assertEqual(JPEG_NEW, read_bytes(os.path.join(album, "cover.jpeg")))
        self.assertEqual(JPEG_NEW, read_bytes(selected))
        backups = random_cover_backups(album)
        self.assertEqual(1, len(backups), backups)
        self.assertEqual(".jpeg", os.path.splitext(backups[0])[1])
        self.assertEqual(JPEG_OLD, read_bytes(os.path.join(album, backups[0])))
        self.assertEqual([os.path.join(album, backups[0])],
                         [backup for backup, _original in result["backups"]])

    def test_all_cover_variants_are_preserved_case_insensitively(self):
        album = self.album()
        variants = {
            "cover.jpg": b"old-jpg",
            "COVER.JPEG": b"old-jpeg",
            "Cover.PnG": b"old-png",
            "cOvEr.WeBp": b"old-webp",
            "cpver.jpeg": JPEG_OLD + b"-legacy",
        }
        for name, data in variants.items():
            write_bytes(os.path.join(album, name), data)
        selected = write_bytes(os.path.join(album, "front.jpg"), JPEG_NEW)

        update_external_cover(selected, album)

        self.assertEqual(JPEG_NEW, read_bytes(os.path.join(album, "cover.jpeg")))
        backups = random_cover_backups(album)
        self.assertEqual(len(variants), len(backups), backups)
        actual = {
            read_bytes(os.path.join(album, name)): os.path.splitext(name)[1]
            for name in backups
        }
        expected = {
            data: os.path.splitext(name)[1]
            for name, data in variants.items()
        }
        self.assertEqual(expected, actual)

    def test_legacy_cpver_is_preserved_with_the_same_criterion(self):
        album = self.album()
        write_bytes(os.path.join(album, "cover.jpeg"), JPEG_OLD)
        write_bytes(os.path.join(album, "cpver.jpeg"), JPEG_OLD + b"-legacy")
        selected = write_bytes(os.path.join(album, "front.jpg"), JPEG_NEW)

        update_external_cover(selected, album)

        self.assertFalse(os.path.exists(os.path.join(album, "cpver.jpeg")))
        self.assertEqual(JPEG_NEW, read_bytes(os.path.join(album, "cover.jpeg")))
        backups = random_cover_backups(album)
        self.assertEqual(2, len(backups), backups)
        preserved = sorted(read_bytes(os.path.join(album, n)) for n in backups)
        self.assertEqual(sorted([JPEG_OLD, JPEG_OLD + b"-legacy"]), preserved)
        self.assertEqual({".jpeg"}, {os.path.splitext(n)[1] for n in backups})

    def test_random_backup_names_skip_existing_files(self):
        album = self.album()
        write_bytes(os.path.join(album, "cover.jpeg"), JPEG_OLD)
        sentinel = write_bytes(os.path.join(album, "AAAAA.jpeg"), b"do-not-touch")
        selected = write_bytes(os.path.join(album, "front.jpg"), JPEG_NEW)
        names = iter(["AAAAA", "BBBBB"])

        with mock.patch.object(core, "_random_cover_stem", side_effect=lambda: next(names)):
            update_external_cover(selected, album)

        self.assertEqual(b"do-not-touch", read_bytes(sentinel))
        backup = os.path.join(album, "BBBBB.jpeg")
        self.assertTrue(os.path.isfile(backup))
        self.assertEqual(JPEG_OLD, read_bytes(backup))
        self.assertEqual(JPEG_NEW, read_bytes(os.path.join(album, "cover.jpeg")))

    def test_random_backup_names_never_reuse_reserved_cover_names(self):
        album = self.album()
        write_bytes(os.path.join(album, "cpver.jpeg"), JPEG_OLD)
        selected = write_bytes(os.path.join(album, "front.jpg"), JPEG_NEW)
        names = iter(["cover", "cpver", "BBBBB"])

        with mock.patch.object(core, "_random_cover_stem", side_effect=lambda: next(names)):
            update_external_cover(selected, album)

        self.assertEqual(JPEG_NEW, read_bytes(os.path.join(album, "cover.jpeg")))
        self.assertEqual(JPEG_OLD, read_bytes(os.path.join(album, "BBBBB.jpeg")))
        self.assertFalse(os.path.exists(os.path.join(album, "cpver.jpeg")))

    def test_install_error_restores_the_previous_cover_and_removes_partial_state(self):
        album = self.album()
        old_cover = write_bytes(os.path.join(album, "cover.jpeg"), JPEG_OLD)
        selected = write_bytes(os.path.join(album, "front.jpg"), JPEG_NEW)
        target = os.path.join(album, "cover.jpeg")
        real_replace = os.replace

        def fail_install(src, dst):
            if dst == target and os.path.basename(src).startswith(".cover-"):
                raise OSError("injected install failure")
            return real_replace(src, dst)

        with mock.patch.object(core.os, "replace", side_effect=fail_install):
            with self.assertRaises(OSError):
                update_external_cover(selected, album)

        self.assertEqual(JPEG_OLD, read_bytes(old_cover))
        self.assertEqual(JPEG_NEW, read_bytes(selected))
        self.assertEqual([], [n for n in os.listdir(album) if n.startswith(".cover-")])
        self.assertEqual([], random_cover_backups(album))

    def test_embedding_error_rolls_back_the_external_cover(self):
        album = self.album()
        old_cover = write_bytes(os.path.join(album, "cover.jpeg"), JPEG_OLD)
        selected = write_bytes(os.path.join(album, "front.jpg"), JPEG_NEW)
        track = make_mp3(os.path.join(album, "01.mp3"), "First")

        with mock.patch.object(core, "set_embedded_cover", side_effect=OSError("injected embed failure")):
            with self.assertRaises(OSError):
                save_full(track, "First", "Artist", "Album", "Artist", "2024", 1, 1, "Rock", selected)

        self.assertEqual(JPEG_OLD, read_bytes(old_cover))
        self.assertEqual(JPEG_NEW, read_bytes(selected))
        self.assertEqual([], random_cover_backups(album))

    def test_missing_image_does_not_touch_the_previous_cover(self):
        album = self.album()
        old_cover = write_bytes(os.path.join(album, "cover.jpeg"), JPEG_OLD)

        with self.assertRaises(ValueError):
            update_external_cover(os.path.join(album, "missing.jpg"), album)

        self.assertEqual(JPEG_OLD, read_bytes(old_cover))

    # ------------------------------------------------------------------
    # Album-level cover operation
    # ------------------------------------------------------------------
    def test_album_cover_is_embedded_in_all_tracks_from_one_source(self):
        album = self.album()
        tracks = [
            make_mp3(os.path.join(album, "01.mp3"), "One"),
            make_mp3(os.path.join(album, "02.mp3"), "Two"),
            make_mp3(os.path.join(album, "03.mp3"), "Three"),
        ]
        selected = write_bytes(os.path.join(album, "cover.jpg"), JPEG_NEW)

        result = save_album_cover(selected, tracks)

        self.assertTrue(result["success"], result)
        self.assertEqual(3, len(result["saved"]))
        self.assertFalse(os.path.exists(selected), "the selected variant was renamed")
        self.assertEqual(JPEG_NEW, read_bytes(os.path.join(album, "cover.jpeg")))
        for track in tracks:
            embedded = read_embedded_cover_b64(track)
            self.assertIsNotNone(embedded)
            self.assertEqual(JPEG_NEW, base64.b64decode(embedded["data"]))
        self.assertEqual(1, len(random_cover_backups(album)))

    def test_album_cover_updates_every_folder_of_a_multi_folder_album(self):
        album_a = self.root("album-a")
        album_b = self.root("album-b")
        tracks = [
            make_mp3(os.path.join(album_a, "01.mp3"), "One"),
            make_mp3(os.path.join(album_b, "02.mp3"), "Two"),
        ]
        selected = write_bytes(os.path.join(self.root(), "selected.jpg"), JPEG_NEW)

        result = save_album_cover(selected, tracks)

        self.assertTrue(result["success"], result)
        self.assertEqual({album_a, album_b}, {entry["folder"] for entry in result["external"]})
        for folder in (album_a, album_b):
            self.assertEqual(JPEG_NEW, read_bytes(os.path.join(folder, "cover.jpeg")))
        for track in tracks:
            embedded = read_embedded_cover_b64(track)
            self.assertEqual(JPEG_NEW, base64.b64decode(embedded["data"]))

    def test_album_cover_reports_partial_embedding_and_keeps_external_cover(self):
        album = self.album()
        tracks = [
            make_mp3(os.path.join(album, "01.mp3"), "One"),
            make_mp3(os.path.join(album, "02.mp3"), "Two"),
            make_mp3(os.path.join(album, "03.mp3"), "Three"),
        ]
        selected = write_bytes(os.path.join(album, "front.jpg"), JPEG_NEW)
        real_embed = core.set_embedded_cover

        def embed(path, image):
            if path == tracks[1]:
                raise OSError("injected embed failure")
            return real_embed(path, image)

        with mock.patch.object(core, "set_embedded_cover", side_effect=embed):
            result = save_album_cover(selected, tracks)

        self.assertFalse(result["success"])
        self.assertEqual(2, len(result["saved"]))
        self.assertEqual([tracks[1]], [entry["path"] for entry in result["failed"]])
        self.assertEqual(JPEG_NEW, read_bytes(os.path.join(album, "cover.jpeg")))
        self.assertIsNotNone(read_embedded_cover_b64(tracks[0]))
        self.assertIsNone(read_embedded_cover_b64(tracks[1]))

    def test_album_cover_restores_old_cover_when_no_track_can_be_embedded(self):
        album = self.album()
        old_cover = write_bytes(os.path.join(album, "cover.jpeg"), JPEG_OLD)
        tracks = [make_mp3(os.path.join(album, "01.mp3"), "One")]
        selected = write_bytes(os.path.join(album, "front.jpg"), JPEG_NEW)

        with mock.patch.object(core, "set_embedded_cover", side_effect=OSError("injected embed failure")):
            result = save_album_cover(selected, tracks)

        self.assertFalse(result["success"])
        self.assertEqual(JPEG_OLD, read_bytes(old_cover))
        self.assertEqual([], random_cover_backups(album))

    def test_album_cover_rolls_back_previous_folders_when_a_later_update_fails(self):
        album_a = self.root("album-a")
        album_b = self.root("album-b")
        old_a = write_bytes(os.path.join(album_a, "cover.jpeg"), JPEG_OLD)
        write_bytes(os.path.join(album_b, "cover.jpeg"), JPEG_OLD + b"-b")
        tracks = [
            make_mp3(os.path.join(album_a, "01.mp3"), "One"),
            make_mp3(os.path.join(album_b, "02.mp3"), "Two"),
        ]
        selected = write_bytes(os.path.join(self.root(), "selected.jpg"), JPEG_NEW)
        real_update = core._update_external_cover_data
        calls = {"n": 0}

        def update(data, folder):
            calls["n"] += 1
            if calls["n"] == 2:
                raise OSError("injected folder failure")
            return real_update(data, folder)

        with mock.patch.object(core, "_update_external_cover_data", side_effect=update):
            with self.assertRaises(RuntimeError):
                save_album_cover(selected, tracks)

        self.assertEqual(JPEG_OLD, read_bytes(old_a))
        self.assertEqual(JPEG_OLD + b"-b", read_bytes(os.path.join(album_b, "cover.jpeg")))
        self.assertEqual([], random_cover_backups(album_a))

    def test_album_cover_rejects_non_jpeg_before_touching_anything(self):
        album = self.album()
        old_cover = write_bytes(os.path.join(album, "cover.jpeg"), JPEG_OLD)
        track = make_mp3(os.path.join(album, "01.mp3"), "One")
        selected = write_bytes(os.path.join(album, "front.png"), b"not-a-jpeg")

        with self.assertRaises(ValueError):
            save_album_cover(selected, [track])

        self.assertEqual(JPEG_OLD, read_bytes(old_cover))
        self.assertIsNone(read_embedded_cover_b64(track))

    def test_cli_list_tracks_over_two_folders_never_duplicates_a_file(self):
        """Parent + child folders: the same file appears in both walks."""
        root = self.root()
        make_mp3(os.path.join(root, "Rock", "Album A", "01.mp3"), "One")
        make_mp3(os.path.join(root, "Rock", "Album B", "02.mp3"), "Two")

        parent = os.path.join(root, "Rock")                 # registered twice, on purpose
        child = os.path.join(root, "Rock", "Album A")

        seen = {}
        duplicated = 0
        for folder in (root, parent, child):
            result = json.loads(cli_command("list_tracks", folder))
            self.assertTrue(result["success"], result)
            for track in result["tracks"]:
                real = os.path.realpath(track["path"])
                if real in seen:
                    duplicated += 1
                seen[real] = track["path"]

        self.assertEqual(2, len(seen), "only the two real tracks are imported")
        # root -> 2 files, Rock -> 2 files, Rock/Album A -> 1 file
        self.assertEqual(3, duplicated, "overlapping folders revisit the same files")

    def test_cli_reports_errors_as_json_not_exceptions(self):
        result = json.loads(cli_command("get_info", os.path.join(self.tmp, "missing.mp3")))
        self.assertFalse(result["success"])
        self.assertIn("error", result)

        unknown = json.loads(cli_command("definitely_not_a_command"))
        self.assertFalse(unknown["success"])

    def test_empty_folder_returns_an_empty_list(self):
        result = json.loads(cli_command("list_tracks", self.root("empty")))
        self.assertTrue(result["success"])
        self.assertEqual([], result["tracks"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
