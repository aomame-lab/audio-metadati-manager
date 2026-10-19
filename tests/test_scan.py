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

import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"))

try:
    from core import get_music_files, track_info, cli_command, find_covers
except ModuleNotFoundError as exc:                     # pragma: no cover
    print("mutagen is required: {}".format(exc))
    sys.exit(2)

FRAME_HEADER = b"\xFF\xFB\x90\x00"                   # MPEG1 Layer III 128 kbps 44.1 kHz
FRAME = FRAME_HEADER + b"\x00" * 413

ID3_TITLE = "TIT2"


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
