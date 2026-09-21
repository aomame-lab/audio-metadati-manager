<?php
/**
 * API endpoint: GET /api/tracks.php
 * Return the list of tracks in the music library.
 *
 * Optional parameters:
 *   - path: a subfolder of the library (defaults to the configured root)
 */

require_once __DIR__ . '/bootstrap.php';

$path = $_GET['path'] ?? null;

if ($path === null || $path === '') {
    $root = library_root();
    if ($root === '') {
        json_out(['success' => false, 'error' => 'No library configured'], 400);
    }
    $real = realpath($root);
    if ($real === false) {
        json_out(['success' => false, 'error' => 'No library configured'], 400);
    }
} else {
    $real = resolve_in_library($path);
}

if ($real === false || $real === null || !is_dir($real)) {
    json_out(['success' => false, 'error' => 'Invalid library folder'], 400);
}

$result = run_python(['list_tracks', $real]);

if (!$result['success']) {
    json_out($result, 500);
}

json_out($result);