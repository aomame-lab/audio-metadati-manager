<?php
/**
 * API endpoint: POST /api/save.php
 * Save the metadata (and optionally the cover) of a single track.
 *
 * JSON body:
 *   - path: audio file path
 *   - title, artist, album, album_artist, year, genre: strings
 *   - track, total: integers
 *   - cover (optional): JPEG path to embed,
 *                       "__remove__" to remove the embedded cover,
 *                       empty/absent to leave the cover unchanged
 */

require_once __DIR__ . '/bootstrap.php';

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    $input = $_POST;
}

$real = resolve_in_library($input['path'] ?? null);
if ($real === null || !is_file($real)) {
    json_out(['success' => false, 'error' => 'Invalid audio file'], 400);
}

$title       = (string) ($input['title'] ?? '');
$artist      = (string) ($input['artist'] ?? '');
$album       = (string) ($input['album'] ?? '');
$albumArtist = (string) ($input['album_artist'] ?? '');
$year        = (string) ($input['year'] ?? '');
$genre       = (string) ($input['genre'] ?? '');
$track       = max(0, (int) ($input['track'] ?? 0));
$total       = max(0, (int) ($input['total'] ?? 0));

$cover = $input['cover'] ?? '';
$coverArg = '';
if ($cover === '__remove__') {
    $coverArg = '__remove__';
} elseif ($cover !== null && $cover !== '') {
    $coverReal = resolve_in_library((string) $cover);
    if ($coverReal === null || !is_file($coverReal)) {
        json_out(['success' => false, 'error' => 'Invalid cover image'], 400);
    }
    $coverArg = $coverReal;
}

$args = [
    'save',
    $real,
    $title,
    $artist,
    $album,
    $albumArtist,
    $year,
    (string) $track,
    (string) $total,
    $genre,
    $coverArg,
];

$result = run_python($args);

if (!$result['success']) {
    json_out($result, 500);
}

json_out(['success' => true]);