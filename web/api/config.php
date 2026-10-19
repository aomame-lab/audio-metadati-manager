<?php
/**
 * API endpoint: GET /api/config.php
 * Return the application configuration.
 *
 * library_path is the historical field and is unchanged: it stays the primary
 * root, so old frontends keep working. roots[] describes every authorized mount
 * (including the extra MUSIC_PATH_2 / MUSIC_PATH_3 ones) and folders_configured
 * tells the interface whether the "Cartelle musicali" dialog has entries to show.
 */

require_once __DIR__ . '/bootstrap.php';

$roots = [];
foreach (music_roots() as $root) {
    $roots[] = music_root_public($root);
}

$stored = library_folders_load();

json_out([
    'success'            => true,
    'library_path'       => library_root(),
    'roots'              => $roots,
    'folders_configured' => count($stored['folders']),
]);
