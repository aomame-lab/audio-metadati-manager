<?php
/**
 * API endpoint: POST /api/bulk-update.php
 * Bulk operations on multiple tracks.
 *
 * JSON body with "action":
 *
 * 1) action = "save"
 *    { "action": "save", "tracks": [ { path, title, artist, album, album_artist, year, track, total, genre, cover? }, ... ] }
 *    Saves the metadata (and cover) of each listed track.
 *
 * 2) action = "cover"
 *    { "action": "cover", "paths": [...], "image": "/path/to/cover.jpg" }
 *    Applies one cover to a whole album atomically: updates the external
 *    cover.jpeg of every album folder and embeds it into every track.
 *
 * 3) action = "remove_cover"
 *    { "action": "remove_cover", "paths": [...] }
 *    Removes the embedded cover from the listed tracks.
 */

require_once __DIR__ . '/bootstrap.php';

$data = json_decode(file_get_contents('php://input'), true);
if (!is_array($data)) {
    json_out(['success' => false, 'error' => 'Invalid JSON body'], 400);
}

$action = $data['action'] ?? '';
$errors = [];
$modified = 0;

switch ($action) {
    case 'save':
        $tracks = $data['tracks'] ?? [];
        if (!is_array($tracks) || empty($tracks)) {
            json_out(['success' => false, 'error' => 'No tracks specified'], 400);
        }
        foreach ($tracks as $track) {
            if (!is_array($track)) {
                $errors[] = ['path' => 'unknown', 'error' => 'Invalid track'];
                continue;
            }
            $real = resolve_in_library($track['path'] ?? null);
            if ($real === null || !is_file($real)) {
                $errors[] = ['path' => (string) ($track['path'] ?? 'unknown'), 'error' => 'Invalid audio file'];
                continue;
            }
            $coverArg = '';
            $cover = $track['cover'] ?? '';
            if ($cover === '__remove__') {
                $coverArg = '__remove__';
            } elseif ($cover !== null && $cover !== '') {
                $coverReal = resolve_in_library((string) $cover);
                if ($coverReal === null || !is_file($coverReal)) {
                    $errors[] = ['path' => $real, 'error' => 'Invalid cover image'];
                    continue;
                }
                $coverArg = $coverReal;
            }
            $args = [
                'save',
                $real,
                (string) ($track['title'] ?? ''),
                (string) ($track['artist'] ?? ''),
                (string) ($track['album'] ?? ''),
                (string) ($track['album_artist'] ?? ''),
                (string) ($track['year'] ?? ''),
                (string) max(0, (int) ($track['track'] ?? 0)),
                (string) max(0, (int) ($track['total'] ?? 0)),
                (string) ($track['genre'] ?? ''),
                $coverArg,
            ];
            $result = run_python($args);
            if (!empty($result['success'])) {
                $modified++;
            } else {
                $errors[] = ['path' => $real, 'error' => $result['error'] ?? 'Save failed'];
            }
        }
        break;

    case 'cover':
        $paths = $data['paths'] ?? [];
        $image = $data['image'] ?? null;
        $imageReal = resolve_in_library($image);
        if (!is_array($paths) || empty($paths)) {
            json_out(['success' => false, 'error' => 'No tracks specified'], 400);
        }
        if ($imageReal === null || !is_file($imageReal)) {
            json_out(['success' => false, 'error' => 'Invalid cover image'], 400);
        }
        $trackPaths = [];
        foreach ($paths as $p) {
            $real = resolve_in_library($p);
            if ($real === null || !is_file($real)) {
                $errors[] = ['path' => (string) $p, 'error' => 'Invalid audio file'];
                continue;
            }
            $trackPaths[] = $real;
        }
        // Album cover is one atomic operation: never update only the tracks
        // that happen to still exist in a partially stale album.
        if (!empty($errors)) {
            array_unshift($errors, [
                'path' => '',
                'error' => 'One or more album tracks are no longer available',
            ]);
            json_out([
                'success' => false,
                'error' => 'One or more album tracks are no longer available',
                'modified' => 0,
                'failed' => count($errors),
                'errors' => $errors,
            ]);
        }
        $result = run_python(array_merge(['save_album_cover', $imageReal], $trackPaths));
        $errors = [];
        foreach (($result['failed'] ?? []) as $failure) {
            if (!is_array($failure)) {
                continue;
            }
            $errors[] = [
                'path' => (string) ($failure['path'] ?? 'unknown'),
                'error' => (string) ($failure['error'] ?? 'Cover operation failed'),
            ];
        }
        if (empty($result['success'])) {
            if (!empty($result['error'])) {
                array_unshift($errors, ['path' => '', 'error' => (string) $result['error']]);
            }
            if (empty($errors)) {
                $errors[] = ['path' => '', 'error' => 'Album cover operation failed'];
            }
            json_out([
                'success' => false,
                'error' => $errors[0]['error'],
                'modified' => count($result['saved'] ?? []),
                'failed' => count($errors),
                'errors' => $errors,
                'external' => $result['external'] ?? [],
            ]);
        }
        $modified = count($result['saved'] ?? []);
        json_out([
            'success' => true,
            'modified' => $modified,
            'failed' => 0,
            'errors' => [],
            'external' => $result['external'] ?? [],
        ]);
        break;

    case 'remove_cover':
        $paths = $data['paths'] ?? [];
        if (!is_array($paths) || empty($paths)) {
            json_out(['success' => false, 'error' => 'No tracks specified'], 400);
        }
        foreach ($paths as $p) {
            $real = resolve_in_library($p);
            if ($real === null || !is_file($real)) {
                $errors[] = ['path' => (string) $p, 'error' => 'Invalid audio file'];
                continue;
            }
            $result = run_python(['remove_cover', $real]);
            if (!empty($result['success'])) {
                $modified++;
            } else {
                $errors[] = ['path' => $real, 'error' => $result['error'] ?? 'Cover removal failed'];
            }
        }
        break;

    default:
        json_out(['success' => false, 'error' => 'Invalid action'], 400);
}

json_out([
    'success' => empty($errors),
    'modified' => $modified,
    'failed' => count($errors),
    'errors' => $errors,
]);