<?php
/**
 * API endpoint: POST /api/scan.php
 * Scan a folder (inside the library) and return its tracks.
 *
 * JSON body or form-data:
 *   - path: folder to scan (defaults to the configured root)
 */

require_once __DIR__ . '/bootstrap.php';

$input = json_decode(file_get_contents('php://input'), true);
$path = is_array($input) ? ($input['path'] ?? null) : ($_POST['path'] ?? null);

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