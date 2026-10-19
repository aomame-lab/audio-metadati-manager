#!/usr/bin/env bash
#
# Audio Metadati Manager — end-to-end HTTP check
#
# Boots the real PHP development server on a temporary library made of two
# roots (the historical /music plus an extra mount) and exercises the API over
# HTTP, including the JSON request bodies that php://input only exposes through
# a real web server.
#
#   ./tests/check-http.sh
#
# Nothing of the real library is read or written: everything lives in a
# temporary directory that is removed at the end.
#
set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8791}"
WORK_DIR="$(mktemp -d)"
PYTHON_BIN="${AUDIO_PYTHON_BIN:-python3}"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'
FAILURES=0
SERVER_PID=""

cleanup() {
    [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
    rm -rf "$WORK_DIR"
}
trap cleanup EXIT

ok()   { printf '  %-56s%s\n' "$1" "${GREEN}PASS${NC}"; }
bad()  { printf '  %-56s%s\n' "$1" "${RED}FAIL${NC}"; FAILURES=$((FAILURES + 1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi; }
# Pure bash matching: no pipe, so a large body can never cause a SIGPIPE.
contains() { case "$2" in *"$3"*) ok "$1" ;; *) bad "$1 (missing '$3')" ;; esac; }

# ---------------------------------------------------------------- fixtures
mkdir -p "$WORK_DIR/music1/Rock/Album A" "$WORK_DIR/music2/Jazz" "$WORK_DIR/data"

# A valid silent MP3 (ID3v2.3 tag + MPEG frames), built with plain shell tools.
make_mp3() {
    local out="$1"
    printf 'ID3\003\000\000\000\000\000\013TIT2\000\000\000\011\000Fixture' > "$out"
    local i=0
    while [ $i -lt 40 ]; do
        printf '\377\373\220\000' >> "$out"
        head -c 413 /dev/zero >> "$out"
        i=$((i + 1))
    done
}
make_mp3 "$WORK_DIR/music1/Rock/Album A/01.mp3"
make_mp3 "$WORK_DIR/music2/Jazz/02.mp3"

# ---------------------------------------------------------------- server
export AUDIO_LIBRARY_OVERRIDE="$WORK_DIR/music1"
export AUDIO_MUSIC_ROOTS="music2:$WORK_DIR/music2,music3:/mnt/unplugged"
export AUDIO_DATA_DIR="$WORK_DIR/data"
export AUDIO_PYTHON_BIN="$PYTHON_BIN"

php -S "127.0.0.1:$PORT" -t "$PROJECT_DIR/web" > "$WORK_DIR/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:$PORT/api/config.php" > /dev/null 2>&1; then break; fi
    sleep 0.25
done

BASE="http://127.0.0.1:$PORT"
echo "Audio Metadati Manager — HTTP end-to-end check (port $PORT)"
echo

# ---------------------------------------------------------------- frontend
page="$(curl -fsS "$BASE/" 2>/dev/null)"
contains "index.php is served"                    "$page" 'id="foldersBtn"'
contains "folders dialog is in the markup"        "$page" 'id="foldersModal"'
contains "mini player is in the header"           "$page" 'id="miniPlayer"'
contains "mini player has the three controls"     "$page" 'id="miniPlayPauseBtn"'
contains "library reload stays in the header"     "$page" 'id="reloadBtn"'
case "$page" in
    *'id="libraryPath"'*) bad "the old library path input is gone from the header" ;;
    *)                   ok  "the old library path input is gone from the header" ;;
esac
appjs="$(curl -fsS "$BASE/assets/js/app.js" 2>/dev/null)"
contains "assets/js/app.js is served"             "$appjs" 'openFoldersModal'

# ---------------------------------------------------------------- config
cfg="$(curl -fsS "$BASE/api/config.php")"
contains "config exposes the primary root"  "$cfg" '"library_path"'
contains "config exposes music2"            "$cfg" '"id":"music2"'
contains "config exposes the missing root"  "$cfg" '"available":false'

# ---------------------------------------------------------------- explorer
browse="$(curl -fsS "$BASE/api/browse.php?root=music")"
contains "browse lists the first level" "$browse" '"name":"Rock"'
browse2="$(curl -fsS --get --data-urlencode 'root=music2' "$BASE/api/browse.php")"
contains "browse works on the second root" "$browse2" '"name":"Jazz"'

trav="$(curl -fsS --get --data-urlencode 'root=music' --data-urlencode 'path=../music2' "$BASE/api/browse.php")"
contains "browse refuses .."                "$trav" '"success":false'
abs="$(curl -fsS --get --data-urlencode 'root=music' --data-urlencode 'path=/etc' "$BASE/api/browse.php")"
contains "browse refuses an absolute path"  "$abs"  '"success":false'
unknown="$(curl -sS "$BASE/api/browse.php?root=nope")"
contains "browse refuses an unknown root"   "$unknown" 'Unknown root'

unplugged="$(curl -fsS "$BASE/api/browse.php?root=music3")"
contains "unplugged root is reported, not fatal" "$unplugged" 'not available'

# ---------------------------------------------------------------- folders CRUD
add="$(curl -fsS -X POST -H 'Content-Type: application/json' \
    -d "{\"action\":\"add\",\"root\":\"music2\",\"path\":\"Jazz\",\"label\":\"My Jazz\"}" \
    "$BASE/api/folders.php")"
contains "folder added over a real JSON body" "$add" '"success":true'
contains "custom label stored"                "$add" 'My Jazz'

dup="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d '{"action":"add","root":"music2","path":"Jazz/"}' "$BASE/api/folders.php")"
check "duplicate refused with HTTP 409" "$dup" "409"

list="$(curl -fsS "$BASE/api/folders.php")"
contains "folder is listed as available" "$list" '"available":true'

id="$(echo "$list" | sed -n 's/.*"id":"\(f_[a-f0-9]*\)".*/\1/p' | head -n1)"
if [ -n "$id" ]; then
    ok "folder exposes a stable id ($id)"
else
    bad "folder exposes a stable id"
fi

# ---------------------------------------------------------------- library
lib="$(curl -fsS "$BASE/api/library.php")"
contains "library scan reads the registered folder" "$lib" '"filename":"02.mp3"'

# ---------------------------------------------------------------- removal
rm_code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d "{\"action\":\"remove\",\"id\":\"$id\"}" "$BASE/api/folders.php")"
check "folder removed" "$rm_code" "200"
[ -f "$WORK_DIR/music2/Jazz/02.mp3" ] && ok "audio files are untouched by the removal" \
    || bad "audio files are untouched by the removal"

after="$(curl -fsS "$BASE/api/folders.php")"
contains "configuration is empty again" "$after" '"folders":[]'

# ---------------------------------------------------------------- served files
# Include-only files live inside the document root, so they are reachable by
# URL. They must answer with an explicit JSON error, never with an empty 200.
echo
echo "include-only files served by URL:"
for f in api/bootstrap.php api/library-roots.php api/library-folders.php \
         config.php config.example.php; do
    head_tmp="$(curl -sS -o /tmp/amm_body.$$ -w '%{http_code}|%{content_type}|%{size_download}' "$BASE/$f")"
    code="${head_tmp%%|*}"; rest="${head_tmp#*|}"
    ctype="${rest%%|*}"; size="${rest##*|}"
    body="$(cat /tmp/amm_body.$$)"; rm -f /tmp/amm_body.$$
    label="$(printf '%-26s' "$f -> $code")"
    if [ "$code" = "403" ] && [ "$size" -gt 0 ] \
       && case "$body" in *'not an API endpoint'*) true ;; *) false ;; esac; then
        ok "$label (JSON error, ${size} bytes)"
    else
        bad "$f -> http=$code type=$ctype bytes=$size body=${body:0:60}"
    fi
done

# No endpoint may ever answer with an empty body.
echo
echo "no empty bodies from the API:"
for probe in "/api/config.php" "/api/folders.php" "/api/library.php" \
             "/api/browse.php" "/api/browse.php?root=music" \
             "/api/browse.php?root=music&path=../../etc" \
             "/api/tracks.php?path=/nope" "/api/metadata.php?path=/nope.mp3" \
             "/api/cover.php?path=/nope.jpg" "/api/audio.php?path=/nope.mp3"; do
    out="$(curl -sS -w '\n%{http_code}' "$BASE$probe")"
    code="${out##*$'\n'}"; body="${out%$'\n'*}"
    label="$(printf '%-44s' "GET $probe")"
    if [ -n "$body" ] && case "$body" in \{*) true ;; *) false ;; esac; then
        ok "$label (http $code)"
    else
        bad "$label -> http=$code empty_or_non_json=${body:0:60}"
    fi
done

echo
if [ "$FAILURES" -eq 0 ]; then
    echo "HTTP end-to-end: all checks passed"
    exit 0
fi
echo "HTTP end-to-end: $FAILURES check(s) failed"
exit 1
