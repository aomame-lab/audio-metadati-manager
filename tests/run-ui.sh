#!/usr/bin/env bash
#
# Audio Metadati Manager — header / mini player UI check
#
# Boots the real PHP server on a temporary library (four silent MP3 built on the
# fly, ~8 s each so a test pause can never reach the end of a track) and drives
# a real headless Chrome through tests/check-ui.js.
#
#   ./tests/run-ui.sh
#
# Needs: node, php, Google Chrome. Skips (exit 0) with a clear message when
# Chrome or node is not installed, so it is safe in CI without a browser.
#
set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${UI_TEST_PORT:-8799}"
WORK_DIR="$(mktemp -d)"
SERVER_PID=""

GREEN='\033[0;32m'
NC='\033[0m'

cleanup() {
    [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
    sleep 0.3
    # Chrome writes read-only files inside its profile: make them removable.
    chmod -R u+w "$WORK_DIR" 2>/dev/null
    rm -rf "$WORK_DIR" 2>/dev/null
    return 0
}
trap cleanup EXIT

if ! command -v node >/dev/null 2>&1; then
    echo "node is not installed: UI check skipped."
    exit 0
fi

CHROME="${AMM_CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME" ]; then
    for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
        if command -v "$candidate" >/dev/null 2>&1; then
            CHROME="$(command -v "$candidate")"
            break
        fi
    done
fi
if [ ! -x "$CHROME" ]; then
    echo "Google Chrome is not installed: UI check skipped."
    echo "Set AMM_CHROME=/path/to/chrome to run it anyway."
    exit 0
fi

# One valid silent MPEG-1 Layer III file with an ID3v2.3 tag
# (TIT2 title, TPE1 artist, TALB album, TRCK track number).
make_mp3() {
    php -r '
        [$path, $title, $artist, $album, $track] = [$argv[1], $argv[2], $argv[3], $argv[4], $argv[5]];
        @mkdir(dirname($path), 0775, true);
        $frame = function ($id, $text) {
            $payload = "\x00" . $text;
            return $id . pack("N", strlen($payload)) . "\x00\x00" . $payload;
        };
        $frames = $frame("TIT2", $title) . $frame("TPE1", $artist)
                . $frame("TALB", $album) . $frame("TRCK", $track);
        $n = strlen($frames);
        $sync = chr(($n >> 21) & 0x7F) . chr(($n >> 14) & 0x7F) . chr(($n >> 7) & 0x7F) . chr($n & 0x7F);
        $mpeg = str_repeat("\xFF\xFB\x90\x00" . str_repeat("\x00", 413), 300);   // ~7.8 s
        file_put_contents($path, "ID3\x03\x00\x00" . $sync . $frames . $mpeg);
    ' "$1" "$2" "$3" "$4" "$5"
}

# Rock Artist: "Album One" (3 tracks) and "Album Two" (2 tracks)
# Jazz Artist: "Album Three" (1 track)   Other Artist: "Album Four" (1 track)
mkdir -p "$WORK_DIR/music1/Rock/Album One" "$WORK_DIR/music1/Rock/Album Two" \
         "$WORK_DIR/music1/Jazz" "$WORK_DIR/music2" "$WORK_DIR/data"
make_mp3 "$WORK_DIR/music1/Rock/Album One/01.mp3" "Alpha"   "Rock Artist"  "Album One"   "1"
make_mp3 "$WORK_DIR/music1/Rock/Album One/02.mp3" "Beta"    "Rock Artist"  "Album One"   "2"
make_mp3 "$WORK_DIR/music1/Rock/Album One/03.mp3" "Gamma"   "Rock Artist"  "Album One"   "3"
make_mp3 "$WORK_DIR/music1/Rock/Album Two/01.mp3" "Delta"   "Rock Artist"  "Album Two"   "1"
make_mp3 "$WORK_DIR/music1/Rock/Album Two/02.mp3" "Epsilon" "Rock Artist"  "Album Two"   "2"
make_mp3 "$WORK_DIR/music1/Jazz/01.mp3"           "Zeta"    "Jazz Artist"  "Album Three" "1"
make_mp3 "$WORK_DIR/music2/04.mp3"                "Omega"   "Other Artist" "Album Four"  "1"

export AUDIO_LIBRARY_OVERRIDE="$WORK_DIR/music1"
export AUDIO_MUSIC_ROOTS="music2:$WORK_DIR/music2"
export AUDIO_DATA_DIR="$WORK_DIR/data"

# The UI check needs a working scan, so it needs mutagen. Prefer the project
# virtualenv, then whatever AUDIO_PYTHON_BIN points at, then a system python3.
if [ -z "${AUDIO_PYTHON_BIN:-}" ]; then
    for candidate in "$PROJECT_DIR/.venv/bin/python" "$PROJECT_DIR/venv/bin/python" python3; do
        if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import mutagen' >/dev/null 2>&1; then
            AUDIO_PYTHON_BIN="$candidate"
            break
        fi
    done
fi
if [ -z "${AUDIO_PYTHON_BIN:-}" ]; then
    echo "No python interpreter with mutagen was found: UI check skipped."
    echo "Create .venv (./install.sh) or set AUDIO_PYTHON_BIN to run it."
    exit 0
fi
export AUDIO_PYTHON_BIN

php -S "127.0.0.1:$PORT" -t "$PROJECT_DIR/web" > "$WORK_DIR/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:$PORT/api/config.php" > /dev/null 2>&1; then break; fi
    sleep 0.25
done

echo "Audio Metadati Manager — header / mini player UI check"
echo

AMM_CHROME="$CHROME" AMM_CHROME_PROFILE="$WORK_DIR/chrome-profile" \
    AMM_FIXTURE_DIR="$WORK_DIR" \
    node "$PROJECT_DIR/tests/check-ui.js" "http://127.0.0.1:$PORT/"
status=$?

echo
if [ "$status" -eq 0 ]; then
    echo -e "${GREEN}UI check: all expectations passed${NC}"
else
    echo "UI check: FAILED (exit $status)"
fi
exit "$status"
