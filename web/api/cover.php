<?php
/**
 * API endpoint: GET /api/cover.php
 * Return a cover image.
 *
 * Parameters:
 *   - path: file path (a JPEG inside the library, or an audio file)
 *   - embedded=1 : interpret "path" as an audio file and return its embedded cover
 */

require_once __DIR__ . '/bootstrap.php';

$real = resolve_in_library($_GET['path'] ?? null);
if ($real === null || !file_exists($real)) {
    json_out(['success' => false, 'error' => 'Image not found'], 404);
}

$ext = strtolower(pathinfo($real, PATHINFO_EXTENSION));
$embedded = ($_GET['embedded'] ?? '') === '1';

if ($embedded || !in_array($ext, ['jpg', 'jpeg'], true)) {
    $result = run_python(['get_embedded_cover', $real]);
    if (empty($result['success']) || empty($result['present']) || empty($result['data'])) {
        json_out(['success' => false, 'error' => 'No embedded cover'], 404);
    }
    $raw = base64_decode($result['data'], true);
    if ($raw === false) {
        json_out(['success' => false, 'error' => 'Invalid cover data'], 500);
    }
    header('Content-Type: ' . ($result['mime'] ?? 'image/jpeg'));
    header('Content-Length: ' . strlen($raw));
    echo $raw;
    exit;
}

$data = @file_get_contents($real);
if ($data === false) {
    json_out(['success' => false, 'error' => 'Unable to read image'], 500);
}

header('Content-Type: image/jpeg');
header('Content-Length: ' . strlen($data));
echo $data;
exit;