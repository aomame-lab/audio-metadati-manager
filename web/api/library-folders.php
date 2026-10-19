<?php
/**
 * Audio MetadatiManager - Registered music folders (persistent store)
 *
 * The music folders chosen from the "Cartelle musicali" dialog are stored in a
 * small JSON file inside AUDIO_DATA_DIR (a persistent volume in Docker, the
 * "data" folder of the project otherwise). The project ships no database and no
 * dependency: a few dozen records do not need one, and a plain JSON file stays
 * readable and backup-friendly for the user.
 *
 * Format:
 *   {
 *     "version": 1,
 *     "folders": [
 *       { "id": "f_1a2b3c4d5e6f", "root_id": "music", "rel_path": "Rock",
 *         "label": "Rock", "created_at": "2026-01-01 00:00:00",
 *         "updated_at": "2026-01-01 00:00:00" }
 *     ]
 *   }
 *
 * "version" is the migration hook: a future layout bumps it and normalises the
 * records on read, existing files keep working untouched.
 *
 * Removing a folder only deletes this record. No music file, metadata, cover or
 * host directory is ever touched.
 */

declare(strict_types=1);

// Direct access guard: this file is an include of bootstrap.php, not an API
// endpoint. See the same guard in web/config.php for the rationale: an empty
// "200 text/html" is the worst possible failure signature for the browser,
// because response.json() rejects it without saying anything useful.
if (isset($_SERVER['SCRIPT_FILENAME'])
    && @realpath((string) $_SERVER['SCRIPT_FILENAME']) !== false
    && @realpath((string) $_SERVER['SCRIPT_FILENAME']) === @realpath(__FILE__)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'error' => 'Internal file, not an API endpoint']);
    exit;
}

define('AUDIO_FOLDERS_STORE_VERSION', 1);
define('AUDIO_FOLDERS_FILE', 'music-folders.json');

/**
 * Directory holding the application data.
 * AUDIO_DATA_DIR wins, then the "data" folder next to the project root.
 */
function library_data_dir(): string
{
    $env = getenv('AUDIO_DATA_DIR');
    if (is_string($env) && $env !== '') {
        return rtrim($env, DIRECTORY_SEPARATOR);
    }
    if (defined('PROJECT_ROOT')) {
        return PROJECT_ROOT . DIRECTORY_SEPARATOR . 'data';
    }
    return dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'data';
}

function library_folders_file(): string
{
    return library_data_dir() . DIRECTORY_SEPARATOR . AUDIO_FOLDERS_FILE;
}

/**
 * Read the store. Returns ['folders' => [...], 'warning' => ?string].
 * A missing file is the normal empty state, not an error.
 *
 * @return array{folders:array<int, array>, warning:?string}
 */
function library_folders_load(): array
{
    $file = library_folders_file();
    $raw = @file_get_contents($file);
    if ($raw === false || trim($raw) === '') {
        return ['folders' => [], 'warning' => null];
    }

    $data = json_decode($raw, true);
    if (!is_array($data)) {
        // Keep a copy of the unreadable file instead of overwriting it blindly.
        @copy($file, $file . '.corrupt');
        return ['folders' => [], 'warning' => 'The stored configuration was unreadable and has been reset'];
    }

    $folders = [];
    foreach ((array) ($data['folders'] ?? []) as $record) {
        $clean = library_folder_sanitize($record);
        if ($clean !== null) {
            $folders[] = $clean;
        }
    }

    return ['folders' => $folders, 'warning' => null];
}

/**
 * Validate and normalise one record read from the store.
 * Unknown or corrupted records are dropped instead of breaking the endpoint.
 */
function library_folder_sanitize($record): ?array
{
    if (!is_array($record)) {
        return null;
    }
    $id = (string) ($record['id'] ?? '');
    $rootId = (string) ($record['root_id'] ?? '');
    $rel = normalize_music_rel_path((string) ($record['rel_path'] ?? ''));
    if ($id === '' || !preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id)) {
        return null;
    }
    if (!music_root_valid_id($rootId) || $rel === null) {
        return null;
    }
    $label = trim((string) ($record['label'] ?? ''));
    if (mb_strlen($label) > 120) {
        $label = mb_substr($label, 0, 120);
    }
    if ($label === '') {
        $label = library_folder_default_label($rel);
    }

    return [
        'id'         => $id,
        'root_id'    => $rootId,
        'rel_path'   => $rel,
        'label'      => $label,
        'created_at' => (string) ($record['created_at'] ?? ''),
        'updated_at' => (string) ($record['updated_at'] ?? ''),
    ];
}

/** Label used when the user does not provide one. */
function library_folder_default_label(string $rel): string
{
    $name = basename(str_replace('\\', '/', $rel));
    return $name === '' ? 'Music root' : $name;
}

/** Stable dedup key: root identifier + normalised relative path. */
function library_folder_key(string $rootId, string $rel): string
{
    return $rootId . '|' . $rel;
}

/**
 * Write the store atomically (temp file + rename) and under an exclusive lock.
 *
 * @return bool
 */
function library_folders_save(array $folders): bool
{
    $dir = library_data_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return false;
    }

    $payload = json_encode([
        'version' => AUDIO_FOLDERS_STORE_VERSION,
        'folders' => array_values($folders),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);

    if ($payload === false) {
        return false;
    }

    $lock = @fopen($dir . DIRECTORY_SEPARATOR . '.' . AUDIO_FOLDERS_FILE . '.lock', 'c');
    if ($lock !== false) {
        @flock($lock, LOCK_EX);
    }

    $target = library_folders_file();
    $tmp = $target . '.' . bin2hex(random_bytes(4)) . '.tmp';
    $ok = @file_put_contents($tmp, $payload) !== false;
    if ($ok) {
        @chmod($tmp, 0644);
        $ok = @rename($tmp, $target);
    }
    if (!$ok) {
        @unlink($tmp);
    }

    if ($lock !== false) {
        @flock($lock, LOCK_UN);
        @fclose($lock);
    }

    return $ok;
}

/**
 * Register a folder. Returns ['ok'=>bool, 'error'=>?string, 'folder'=>?array,
 * 'duplicate'=>?array].
 */
function library_folders_add(string $rootId, ?string $rel, string $label, ?string &$warning = null): array
{
    $resolved = resolve_music_rel($rootId, $rel);
    $normalized = $resolved['rel'];
    if (!empty($resolved['error']) && $normalized === null) {
        return ['ok' => false, 'error' => $resolved['error'], 'folder' => null, 'duplicate' => null];
    }

    $stored = library_folders_load();
    $warning = $stored['warning'];

    $key = library_folder_key(strtolower($rootId), $normalized);
    foreach ($stored['folders'] as $folder) {
        if (library_folder_key($folder['root_id'], $folder['rel_path']) === $key) {
            return [
                'ok'        => false,
                'error'     => 'This folder is already registered',
                'folder'    => $folder,
                'duplicate' => $folder,
            ];
        }
    }

    $label = trim($label);
    if (mb_strlen($label) > 120) {
        $label = mb_substr($label, 0, 120);
    }
    if ($label === '') {
        $label = library_folder_default_label($normalized);
    }

    $now = date('Y-m-d H:i:s');
    $folder = [
        'id'         => 'f_' . bin2hex(random_bytes(6)),
        'root_id'    => strtolower($rootId),
        'rel_path'   => $normalized,
        'label'      => $label,
        'created_at' => $now,
        'updated_at' => $now,
    ];

    $stored['folders'][] = $folder;
    if (!library_folders_save($stored['folders'])) {
        return ['ok' => false, 'error' => 'Unable to save the configuration', 'folder' => null, 'duplicate' => null];
    }

    return ['ok' => true, 'error' => null, 'folder' => $folder, 'duplicate' => null];
}

/**
 * Remove a registration. Only the stored record is deleted: nothing on disk
 * (audio files, metadata, covers, directories) is modified.
 */
function library_folders_remove(string $id, ?string &$warning = null): bool
{
    $stored = library_folders_load();
    $warning = $stored['warning'];

    $kept = [];
    $removed = false;
    foreach ($stored['folders'] as $folder) {
        if (!$removed && $folder['id'] === $id) {
            $removed = true;
            continue;
        }
        $kept[] = $folder;
    }
    if (!$removed) {
        return false;
    }

    return library_folders_save($kept);
}

/**
 * Public representation of a registered folder, with its live availability.
 */
function library_folder_public(array $folder): array
{
    $resolved = resolve_music_rel($folder['root_id'], $folder['rel_path']);
    $root = music_root_by_id($folder['root_id']);

    $available = !empty($resolved['ok']);
    $error = $available ? null : ($resolved['error'] ?? 'Folder not available');

    return [
        'id'         => $folder['id'],
        'root_id'    => $folder['root_id'],
        'root_label' => $root !== null ? $root['label'] : $folder['root_id'],
        'rel_path'   => $folder['rel_path'],
        'label'      => $folder['label'],
        'display'    => $folder['rel_path'] === ''
            ? ($root !== null ? $root['label'] : $folder['root_id'])
            : $folder['root_id'] . '/' . $folder['rel_path'],
        'available'  => $available,
        'error'      => $error,
        'created_at' => $folder['created_at'],
        'updated_at' => $folder['updated_at'],
    ];
}
