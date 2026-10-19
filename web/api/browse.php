<?php
/**
 * API endpoint: GET /api/browse.php
 * List ONE directory level inside an authorized music root.
 *
 * Parameters:
 *   - root: root identifier (music, music2, ...) — required
 *   - path: relative path inside that root, "" for the root itself (default)
 *
 * The browser never sends an absolute path: it picks a root and walks relative
 * segments, so it cannot read anything outside the mounted roots. Each level is
 * validated server side with realpath(), which blocks ".." and symlinks that
 * point outside the root.
 *
 * Response (ok):
 *   { success:true, root:{id,label,path,primary,available},
 *     path:"Rock/Metal", parent:"Rock", display:"music2/Rock/Metal",
 *     entries:[{name, rel, type:"dir"}] }
 *
 * Response (navigation state that is not an error):
 *   { success:false, error:"Folder not found", rel:"Rock" }   (HTTP 200)
 * The dialog renders these inline instead of raising a toast.
 */

require_once __DIR__ . '/bootstrap.php';

$rootId = strtolower(trim((string) ($_GET['root'] ?? '')));
$rel    = (string) ($_GET['path'] ?? '');

if ($rootId === '' || music_root_by_id($rootId) === null) {
    json_out(['success' => false, 'error' => 'Unknown root'], 400);
}

$resolved = resolve_music_rel($rootId, $rel);
if (empty($resolved['ok'])) {
    json_out([
        'success' => false,
        'error'   => $resolved['error'] ?? 'Folder not available',
        'rel'     => $resolved['rel'],
    ]);
}

$root     = $resolved['root'];
$rootReal = realpath($root['path']);
$listing  = browse_music_dir($rootReal, $resolved['path'], $resolved['rel']);

if (empty($listing['ok'])) {
    json_out([
        'success' => false,
        'error'   => $listing['error'],
        'rel'     => $resolved['rel'],
    ]);
}

json_out([
    'success' => true,
    'root'    => music_root_public($root),
    'path'    => $resolved['rel'],
    'parent'  => music_rel_parent($resolved['rel']),
    'display' => $resolved['rel'] === ''
        ? $root['label']
        : $root['id'] . '/' . $resolved['rel'],
    'entries' => $listing['entries'],
]);
