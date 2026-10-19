#!/usr/bin/env bash
#
# Audio Metadati Manager — Docker Compose validation
#
# Checks that the multi-mount setup is valid in every configuration a user can
# realistically have:
#   1. the historical single MUSIC_PATH (no extra variable at all)
#   2. three music mounts on different host disks
#   3. MUSIC_PATH_2 present but empty (falls back to the placeholder)
#
# It only runs `docker compose config`, so nothing is built, started or written
# outside a temporary directory.
#
#   ./tests/check-compose.sh
#
set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

FAILURES=0

cleanup_workdir() {
    rm -rf "${WORK_DIR:?}/app"
}

if ! command -v docker >/dev/null 2>&1; then
    echo "docker is not installed: compose validation skipped."
    exit 0
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose (v2) is not available: compose validation skipped."
    exit 0
fi

mkdir -p "$WORK_DIR/app"
cp "$PROJECT_DIR/docker-compose.yml" "$WORK_DIR/app/"
cp -R "$PROJECT_DIR/docker-placeholder" "$WORK_DIR/app/"
mkdir -p "$WORK_DIR/host/music-a" "$WORK_DIR/host/disk-b" "$WORK_DIR/host/disk-c"

check() {
    local label="$1"
    local expected="$2"      # substring that must appear in the resolved config
    local output

    printf '  %-52s' "$label"
    output="$(cd "$WORK_DIR/app" && docker compose config 2>&1)"
    if [ $? -ne 0 ]; then
        printf "${RED}FAIL${NC} (invalid compose file)\n"
        printf '        %s\n' "$(echo "$output" | head -n 3)"
        FAILURES=$((FAILURES + 1))
        return
    fi
    if [ -n "$expected" ] && ! echo "$output" | grep -q -- "$expected"; then
        printf "${RED}FAIL${NC} (missing %s)\n" "$expected"
        FAILURES=$((FAILURES + 1))
        return
    fi
    printf "${GREEN}PASS${NC}\n"
}

echo "Audio Metadati Manager — docker compose validation"
echo

# 1. Existing installation: only MUSIC_PATH, no MUSIC_PATH_2 / MUSIC_PATH_3.
printf 'MUSIC_PATH=%s\n' "$WORK_DIR/host/music-a" > "$WORK_DIR/app/.env"
check "single MUSIC_PATH (existing installations)" "target: /music"

# 2. Three music roots on three different host disks.
printf 'MUSIC_PATH=%s\nMUSIC_PATH_2=%s\nMUSIC_PATH_3=%s\n' \
    "$WORK_DIR/host/music-a" "$WORK_DIR/host/disk-b" "$WORK_DIR/host/disk-c" > "$WORK_DIR/app/.env"
check "three mounts on different disks" "target: /music-roots/music3"

# 3. MUSIC_PATH_2 declared but empty: must fall back to the placeholder.
printf 'MUSIC_PATH=%s\nMUSIC_PATH_2=\n' "$WORK_DIR/host/music-a" > "$WORK_DIR/app/.env"
check "empty MUSIC_PATH_2 falls back to the placeholder" "docker-placeholder/music2"

# 4. No .env at all: the defaults must still be valid.
rm -f "$WORK_DIR/app/.env"
check "no .env file (project defaults)" "target: /music"

echo
if [ "$FAILURES" -eq 0 ]; then
    echo "compose validation: all checks passed"
    exit 0
fi
echo "compose validation: $FAILURES check(s) failed"
exit 1
