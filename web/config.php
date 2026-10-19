<?php
/**
 * Audio Metadati Manager - Configuration loader
 *
 * This file is portable and safe to commit to version control.
 * It loads an optional local configuration file (web/config.local.php,
 * which is Git-ignored) and otherwise falls back to environment variables.
 *
 * Precedence:
 *   1. web/config.local.php          (local, not committed)
 *   2. AUDIO_LIBRARY_OVERRIDE        (environment variable)
 *   3. empty value                   (the path can be typed in the web UI)
 *
 * To set a fixed music library, copy web/config.example.php to
 * web/config.local.php and edit the path, or export:
 *
 *   export AUDIO_LIBRARY_OVERRIDE=/path/to/your/music
 */

// Direct access guard. This file lives inside the served document root but it
// is an include, not an endpoint: answering with an empty "200 text/html" is
// indistinguishable from a silent failure for a client calling fetch().json(),
// so answer with an explicit JSON error instead. Declared here (and in the
// other include-only files) instead of in a shared helper because a shared
// helper would be reachable in exactly the same way.
if (isset($_SERVER['SCRIPT_FILENAME'])
    && @realpath((string) $_SERVER['SCRIPT_FILENAME']) !== false
    && @realpath((string) $_SERVER['SCRIPT_FILENAME']) === @realpath(__FILE__)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'error' => 'Internal file, not an API endpoint']);
    exit;
}

$localConfigFile = __DIR__ . '/config.local.php';

if (is_file($localConfigFile)) {
    require_once $localConfigFile;
}

if (!defined('AUDIO_LIBRARY_PATH')) {
    $envOverride = getenv('AUDIO_LIBRARY_OVERRIDE');
    if ($envOverride) {
        $resolved = realpath($envOverride);
        define('AUDIO_LIBRARY_PATH', $resolved !== false ? $resolved : $envOverride);
    } else {
        define('AUDIO_LIBRARY_PATH', '');
    }
}