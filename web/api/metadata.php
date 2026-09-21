<?php
/**
 * API endpoint: GET /api/metadata.php
 * Return the complete metadata of a single track.
 *
 * Parameters:
 *   - path: audio file path (inside the library)
 */

require_once __DIR__ . '/bootstrap.php';

$path = $_GET['path'] ?? null;
$real = resolve_in_library($path);

if ($real === null || !is_file($real)) {
    json_out(['success' => false, 'error' => 'Invalid audio file'], 400);
}

$result = run_python(['get_info', $real]);

if (!$result['success']) {
    json_out($result, 500);
}

json_out($result);