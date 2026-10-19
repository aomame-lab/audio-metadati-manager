<?php
/**
 * Audio Metadati Manager - Example local configuration
 *
 * Copy this file to web/config.local.php and set the path of your music
 * library:
 *
 *   cp web/config.example.php web/config.local.php
 *
 * The file web/config.local.php is ignored by Git and will not be
 * committed to the repository.
 *
 * Alternatively you can use the environment variable instead of editing
 * a file (useful for scripts and containers):
 *
 *   export AUDIO_LIBRARY_OVERRIDE=/path/to/your/music
 *
 * If neither this file nor the environment variable is set, the
 * application starts with an empty library and you can type a path
 * directly in the web interface.
 */

// Direct access guard: this file is a template, not an endpoint. It lives
// inside the served document root, so answering with an empty "200 text/html"
// would look like a broken application to anybody who opens the URL.
if (isset($_SERVER['SCRIPT_FILENAME'])
    && @realpath((string) $_SERVER['SCRIPT_FILENAME']) !== false
    && @realpath((string) $_SERVER['SCRIPT_FILENAME']) === @realpath(__FILE__)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'error' => 'Internal file, not an API endpoint']);
    exit;
}

define('AUDIO_LIBRARY_PATH', '/path/to/your/music');