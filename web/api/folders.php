<?php
/**
 * API endpoint: /api/folders.php
 * Persistent list of the music folders registered from the interface.
 *
 *   GET   -> { success:true, folders:[...] }
 *   POST  { action:"add",    root:"music2", path:"Rock", label?:"Rock 1" }
 *   POST  { action:"remove", id:"f_1a2b3c4d5e6f" }
 *
 * Every registered folder keeps a stable id, the authorized root it belongs to,
 * its normalised relative path, a readable label and the creation/update dates.
 * Duplicates are refused comparing root + normalised path, so "Rock", "Rock/",
 * "/Rock" and "./Rock" are the same folder.
 *
 * Removing a folder deletes the record only: no audio file, metadata, cover or
 * host directory is touched.
 */

require_once __DIR__ . '/bootstrap.php';

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

/* ------------------------------- list ------------------------------- */
if ($method === 'GET') {
    $stored = library_folders_load();
    $folders = [];
    foreach ($stored['folders'] as $folder) {
        $folders[] = library_folder_public($folder);
    }
    json_out([
        'success' => true,
        'folders' => $folders,
        'warning' => $stored['warning'],
    ]);
}

/* ------------------------------- write ------------------------------ */
if ($method !== 'POST') {
    json_out(['success' => false, 'error' => 'Method not allowed'], 405);
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    $input = $_POST;
}
$action = (string) ($input['action'] ?? '');

if ($action === 'add') {
    $rootId = strtolower(trim((string) ($input['root'] ?? '')));
    if (!music_root_valid_id($rootId) || music_root_by_id($rootId) === null) {
        json_out(['success' => false, 'error' => 'Unknown root'], 400);
    }

    $warning = null;
    $result  = library_folders_add($rootId, $input['path'] ?? '', (string) ($input['label'] ?? ''), $warning);

    if (empty($result['ok'])) {
        $status = $result['duplicate'] !== null ? 409 : 400;
        json_out([
            'success'   => false,
            'error'     => $result['error'],
            'duplicate' => $result['duplicate'] !== null ? library_folder_public($result['duplicate']) : null,
            'warning'   => $warning,
        ], $status);
    }

    json_out([
        'success' => true,
        'folder'  => library_folder_public($result['folder']),
        'warning' => $warning,
    ]);
}

if ($action === 'remove') {
    $id = (string) ($input['id'] ?? '');
    if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id)) {
        json_out(['success' => false, 'error' => 'Invalid folder id'], 400);
    }

    $warning = null;
    if (!library_folders_remove($id, $warning)) {
        json_out(['success' => false, 'error' => 'Folder not found', 'warning' => $warning], 404);
    }

    json_out(['success' => true, 'removed' => $id, 'warning' => $warning]);
}

json_out(['success' => false, 'error' => 'Invalid action'], 400);
