<?php
/**
 * API endpoint: GET /api/audio.php
 * Stream an audio file with HTTP Range request support.
 *
 * Parameters:
 *   - path: audio file path (inside the library)
 *
 * Supports: MP3, FLAC, M4A
 * Returns correct MIME type and handles Range headers for seeking.
 */

require_once __DIR__ . '/bootstrap.php';

$path = $_GET['path'] ?? null;
$real = resolve_in_library($path);

if ($real === null || !is_file($real)) {
    json_out(['success' => false, 'error' => 'Audio file not found'], 404);
}

$ext = strtolower(pathinfo($real, PATHINFO_EXTENSION));
$mimeTypes = [
    'mp3'  => 'audio/mpeg',
    'flac' => 'audio/flac',
    'm4a'  => 'audio/mp4',
];
$mime = $mimeTypes[$ext] ?? 'application/octet-stream';

$size = filesize($real);
if ($size === false) {
    json_out(['success' => false, 'error' => 'Unable to read file'], 500);
}

$start = 0;
$end = $size - 1;
$statusCode = 200;

if (isset($_SERVER['HTTP_RANGE'])) {
    $rangeHeader = $_SERVER['HTTP_RANGE'];
    if (preg_match('/bytes=(\d+)-(\d*)/', $rangeHeader, $matches)) {
        $start = (int)$matches[1];
        $end = $matches[2] !== '' ? (int)$matches[2] : $size - 1;
        if ($start >= $size || $end >= $size || $start > $end) {
            header('Content-Range: bytes */' . $size);
            json_out(['success' => false, 'error' => 'Range not satisfiable'], 416);
        }
        $statusCode = 206;
    }
}

$length = $end - $start + 1;

header('Content-Type: ' . $mime);
header('Content-Length: ' . $length);
header('Accept-Ranges: bytes');
header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
header('Cache-Control: public, max-age=3600');
http_response_code($statusCode);

$fp = fopen($real, 'rb');
if (!$fp) {
    json_out(['success' => false, 'error' => 'Unable to open file'], 500);
}

fseek($fp, $start);
$bufferSize = 8192;
$bytesRemaining = $length;
while ($bytesRemaining > 0 && !feof($fp) && connection_status() === CONNECTION_NORMAL) {
    $readSize = min($bufferSize, $bytesRemaining);
    $data = fread($fp, $readSize);
    if ($data === false || $data === '') {
        break;
    }
    echo $data;
    $bytesRemaining -= strlen($data);
    flush();
}
fclose($fp);
exit;