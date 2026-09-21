<?php
/**
 * Audio Manager - Shared API bootstrap
 *
 * Common setup for every API endpoint:
 *  - JSON response headers
 *  - Python interpreter detection (project venv with mutagen)
 *  - safe execution of commands against python/comm.py
 *  - library path validation
 */

declare(strict_types=1);

define('PROJECT_ROOT', dirname(__DIR__, 2));
define('COMM_SCRIPT', PROJECT_ROOT . '/python/comm.py');

require_once PROJECT_ROOT . '/web/config.php';

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
 */
function library_root(): string
{
    $root = getenv('AUDIO_LIBRARY_OVERRIDE');
    if ($root === false || $root === '') {
        $root = defined('AUDIO_LIBRARY_PATH') ? AUDIO_LIBRARY_PATH : '';
    }
    if ($root === '' || $root === false) {
        return '';
    }
    $real = realpath($root);
    return $real !== false ? $real : $root;
}

/**
 * Resolve a path and verify that it exists.
 *
 * When a library root is configured, the path must live inside it (this
 * blocks path traversal outside the music library). When no root is
 * configured yet, any existing path is accepted so that a new user can
 * point the application at their music directory directly.
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

    $root = library_root();
    if ($root === '') {
        return $real;
    }

    $rootReal = realpath($root);
    if ($rootReal === false || $rootReal === '') {
        return $real;
    }

    if ($real === $rootReal) {
        return $real;
    }
    $rootNormalized = rtrim($rootReal, DIRECTORY_SEPARATOR);
    if ($rootNormalized !== '' && strpos($real, $rootNormalized . DIRECTORY_SEPARATOR) === 0) {
        return $real;
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