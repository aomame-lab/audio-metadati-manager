#!/usr/bin/env bash
#
# Audio MetadatiManager - installation script
#
# Sets up the Python virtual environment, installs the required packages
# and prepares the local configuration.
#
# Usage:  ./install.sh
#
set -euo pipefail

# Directory of this script (the project root)
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

say()  { printf "${GREEN}%s${NC}\n" "$*"; }
warn() { printf "${YELLOW}%s${NC}\n" "$*"; }
fail() { printf "${RED}%s${NC}\n" "$*" >&2; exit 1; }

echo
say "=============================================="
say " Audio Manager - installation"
say "=============================================="

# --- Check PHP -------------------------------------------------------------
if command -v php >/dev/null 2>&1; then
    PHP_VERSION="$(php -r 'echo PHP_MAJOR_VERSION;' 2>/dev/null || echo '?')"
    if [ "$PHP_VERSION" -ge 8 ] 2>/dev/null; then
        say "PHP detected: $(php -v | head -n1)"
    else
        fail "PHP 8.0+ is required (found: $(php -v | head -n1)). Please install PHP and re-run."
    fi
else
    fail "PHP was not found. Please install PHP 8.0+ and re-run."
fi

# --- Check Python -----------------------------------------------------------
if command -v python3 >/dev/null 2>&1; then
    PY_VERSION="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo '?')"
    say "Python detected: $(python3 --version)"
else
    fail "Python 3 was not found. Please install Python 3.8+ and re-run."
fi

# --- Create the virtual environment -----------------------------------------
if [ ! -d "$PROJECT_DIR/.venv" ]; then
    say "Creating Python virtual environment (.venv)..."
    python3 -m venv "$PROJECT_DIR/.venv"
else
    say "Virtual environment already exists (.venv)"
fi

PYTHON_BIN="$PROJECT_DIR/.venv/bin/python"
if [ ! -x "$PYTHON_BIN" ]; then
    fail "Virtual environment is broken. Remove the .venv folder and re-run."
fi

# --- Install Python dependencies --------------------------------------------
if [ -f "$PROJECT_DIR/requirements.txt" ]; then
    say "Installing Python dependencies from requirements.txt..."
    "$PYTHON_BIN" -m pip install --upgrade pip >/dev/null
    "$PYTHON_BIN" -m pip install -r "$PROJECT_DIR/requirements.txt"
else
    warn "requirements.txt not found; skipping dependency installation."
fi

# --- Verify mutagen ----------------------------------------------------------
if "$PYTHON_BIN" -c 'import mutagen' >/dev/null 2>&1; then
    say "mutagen installed: $("$PYTHON_BIN" -c 'import mutagen; print(mutagen.version_string)')"
else
    fail "mutagen could not be installed. Check your internet connection and re-run."
fi

# --- Prepare local configuration --------------------------------------------
CONFIG_FILE="$PROJECT_DIR/web/config.local.php"
if [ -f "$CONFIG_FILE" ]; then
    say "Local configuration already exists (web/config.local.php)"
elif [ -f "$PROJECT_DIR/web/config.example.php" ]; then
    cp "$PROJECT_DIR/web/config.example.php" "$CONFIG_FILE"
    warn "Created web/config.local.php from the example."
    warn "Open it and set your music library path in AUDIO_LIBRARY_PATH."
fi

echo
say "=============================================="
say " Installation complete."
say ""
say " Next steps:"
say "   1. Edit web/config.local.php and set your music library path,"
say "      or export AUDIO_LIBRARY_OVERRIDE=/path/to/your/music"
say "   2. Start the web server:  ./start.sh"
say "   3. Open http://localhost:8000 in your browser"
say "=============================================="
echo