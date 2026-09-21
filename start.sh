#!/usr/bin/env bash
#
# Audio Metadati Manager - startup script
#
# Starts the PHP built-in web server with the web/ folder as document root.
#
# Usage:  ./start.sh [port]
#   The default port is 8000. Override with the PORT environment variable
#   or a command-line argument, e.g.:  ./start.sh 8080
#
set -euo pipefail

# Directory of this script (the project root)
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$PROJECT_DIR/web"

if [ ! -f "$WEB_DIR/index.php" ]; then
    echo "Error: web/index.php not found. Run this script from the project root." >&2
    exit 1
fi

PORT="${PORT:-}"
if [ -z "$PORT" ] && [ $# -ge 1 ]; then
    PORT="$1"
fi
PORT="${PORT:-8000}"

HOST="${HOST:-0.0.0.0}"

echo "=============================================="
echo " Audio Metadati Manager"
echo "=============================================="
echo " Server   : http://localhost:${PORT}"
echo " LAN      : http://<your-ip>:${PORT}"
echo " Library  : ${AUDIO_LIBRARY_OVERRIDE:-configured in web/config.local.php}"
echo " Press Ctrl+C to stop."
echo "=============================================="

exec php -S "${HOST}:${PORT}" -t "$WEB_DIR"