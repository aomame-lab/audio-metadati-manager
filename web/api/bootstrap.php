<?php
/**
 * Audio MetadatiManager - Shared API bootstrap
 *
 * Common setup for every API endpoint:
 *  - JSON response headers
 *  - Python interpreter detection (project venv with mutagen)
 *  - safe execution of commands against python/comm.py
 *  - library path validation across every authorized music root
 *  - persistent list of the music folders registered by the user
 */

declare(strict_types=1);

// Direct access guard: this file is the shared include of every endpoint, not
// an endpoint itself. See the same guard in web/config.php for the rationale:
// an empty "200" is the worst possible failure signature for the browser,
// because response.json() rejects it without saying anything useful.
if (isset($_SERVER['SCRIPT_FILENAME'])
    && @realpath((string) $_SERVER['SCRIPT_FILENAME']) !== false
    && @realpath((string) $_SERVER['SCRIPT_FILENAME']) === @realpath(__FILE__)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'error' => 'Internal file, not an API endpoint']);
    exit;
}

define('PROJECT_ROOT', dirname(__DIR__, 2));
define('COMM_SCRIPT', PROJECT_ROOT . '/python/comm.py');

require_once PROJECT_ROOT . '/web/config.php';
require_once __DIR__ . '/library-roots.php';
require_once __DIR__ . '/library-folders.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

/**
 * Detect the Python interpreter that has mutagen installed.
 * Priority: AUDIO_PYTHON_BIN (env) -> project venv -> system python3.
 */
function py_interpreter(): string
{
    $env = getenv('AUDIO_PYTHON_BIN');
    if ($env && is_executable($env)) {
        return $env;
    }
    $candidates = [
        PROJECT_ROOT . '/.venv/bin/python',
        PROJECT_ROOT . '/.venv/bin/python3',
        PROJECT_ROOT . '/venv/bin/python',
        PROJECT_ROOT . '/venv/bin/python3',
    ];
    foreach ($candidates as $c) {
        if (is_executable($c)) {
            return $c;
        }
    }
    return 'python3';
}

/**
 * Run a command against the Python core and return the decoded JSON.
 * Every argument is passed safely (shell escaping).
 */
function run_python(array $args): array
{
    $cmd = escapeshellarg(py_interpreter()) . ' ' . escapeshellarg(COMM_SCRIPT);
    foreach ($args as $arg) {
        $cmd .= ' ' . escapeshellarg((string) $arg);
    }
    $output = shell_exec($cmd . ' 2>&1');

    if ($output === null || $output === false) {
        return ['success' => false, 'error' => 'Unable to run Python (' . py_interpreter() . ')'];
    }

    $trimmed = trim($output);
    $decoded = json_decode($trimmed, true);

    if (!is_array($decoded)) {
        return [
            'success' => false,
            'error' => 'Invalid Python response',
            'detail' => mb_substr($trimmed, 0, 400),
        ];
    }
    return $decoded;
}

/**
 * Return the configured music library root (from the environment override
 * or the local configuration file). Returns an empty string when unset.
 * This is the historical single root and stays the default of the API.
 */
function library_root(): string
{
    return music_root_primary_path();
}

/**
 * Resolve a path and verify that it exists.
 *
 * A path is accepted when it lives inside ANY configured music root (the
 * primary one plus the additional mounts), which keeps the previous behaviour
 * for single-root installations and widens it to the new multi-folder ones.
 *
 * When no root can be resolved at all (no root configured, or a configured
 * root that does not exist), any existing path is accepted, exactly as before:
 * a brand new user can point the application at their music directory.
 */
function resolve_in_library(?string $path): ?string
{
    if ($path === null || $path === '') {
        return null;
    }
    $real = realpath($path);
    if ($real === false) {
        return null;
    }

    $anyRootResolved = false;
    foreach (music_roots() as $root) {
        $rootReal = realpath($root['path']);
        if ($rootReal === false || $rootReal === '') {
            continue;
        }
        $anyRootResolved = true;
        if (music_path_in_root($rootReal, $real)) {
            return $real;
        }
    }

    return $anyRootResolved ? null : $real;
}

/**
 * Directory where temporary uploaded covers are stored.
 * The first writable root wins, so a read-only secondary mount never breaks
 * the bulk cover upload. Returns null when nothing is writable.
 */
function cover_storage_root(): ?string
{
    foreach (music_roots() as $root) {
        $real = realpath($root['path']);
        if ($real !== false && is_dir($real) && is_writable($real)) {
            return $real;
        }
    }
    return null;
}

/**
 * Send a standardised JSON response.
 */
function json_out(array $data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}