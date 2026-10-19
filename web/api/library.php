<?php
/**
 * API endpoint: GET /api/library.php
 * Scan every registered music folder and return the merged track list.
 *
 * This is not a second scanner: each folder goes through the same
 * run_python(['list_tracks', <dir>]) call used by tracks.php and scan.php, so
 * mutagen behaves exactly as before. Merging happens here.
 *
 * Merging rules:
 *  - a file is identified by its canonical (realpath) path, never by the order
 *    of the mounts;
 *  - a file reachable through several registered folders (parent + child, or
 *    two roots pointing at the same disk) is imported ONCE;
 *  - a folder whose mount disappeared is reported as unavailable and skipped
 *    instead of breaking the whole scan.
 *
 * Response:
 *   { success:true, total:N, tracks:[...],
 *     folders:[{id,label,display,available,count,error}] }
 */

require_once __DIR__ . '/bootstrap.php';

$stored = library_folders_load();
$folders = $stored['folders'];

if (empty($folders)) {
    json_out([
        'success' => false,
        'error'   => 'No music folder registered yet',
    ], 400);
}

/** Canonical absolute path -> track payload. */
$tracksByPath = [];
$report = [];

foreach ($folders as $folder) {
    $resolved = resolve_music_rel($folder['root_id'], $folder['rel_path']);

    if (empty($resolved['ok'])) {
        $report[] = library_folder_public($folder) + ['count' => 0];
        continue;
    }

    $dir = $resolved['path'];
    $result = run_python(['list_tracks', $dir]);

    if (empty($result['success'])) {
        $entry = library_folder_public($folder) + ['count' => 0];
        $entry['available'] = true;
        $entry['error'] = $result['error'] ?? 'Scan failed';
        $report[] = $entry;
        continue;
    }

    $count = 0;
    foreach ((array) ($result['tracks'] ?? []) as $track) {
        if (!is_array($track) || !isset($track['path'])) {
            continue;
        }
        $real = realpath((string) $track['path']);
        if ($real === false || resolve_in_library($real) === null) {
            continue;   // defensive: never let a foreign path into the library
        }
        if (isset($tracksByPath[$real])) {
            continue;   // already imported through another registered folder
        }
        $tracksByPath[$real] = $track;
        $count++;
    }

    $entry = library_folder_public($folder) + ['count' => $count];
    $report[] = $entry;
}

// Stable order: by file name, as get_music_files() already does per folder.
$tracks = array_values($tracksByPath);
usort($tracks, static function (array $a, array $b): int {
    return strcmp((string) ($a['path'] ?? ''), (string) ($b['path'] ?? ''));
});

json_out([
    'success' => true,
    'total'   => count($tracks),
    'tracks'  => $tracks,
    'folders' => $report,
    'warning' => $stored['warning'],
]);
