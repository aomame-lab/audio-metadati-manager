<?php
/**
 * Audio MetadatiManager - Authorized music roots
 *
 * A "root" is a directory the container is allowed to browse and read music
 * from. Root 1 is the historical one (AUDIO_LIBRARY_OVERRIDE, /music in
 * Docker) and keeps the identifier "music"; additional roots come from the
 * AUDIO_MUSIC_ROOTS environment variable:
 *
 *   AUDIO_MUSIC_ROOTS=music2:/music-roots/music2,music3:/music-roots/music3
 *
 * Format: comma separated "id:path" pairs. The identifier must match
 * [a-z0-9][a-z0-9_-]{0,31} and is what the browser sends back; the browser
 * never sends an absolute path, so it can never reach anything outside the
 * mounted roots.
 *
 * The browser also never sees the canonical (realpath) form of a root: it only
 * receives the identifier and the container path that was configured, which is
 * the same information the user typed in .env.
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

/** Environment variable holding the additional roots. */
define('AUDIO_MUSIC_ROOTS_ENV', 'AUDIO_MUSIC_ROOTS');

/** Identifier of the historical / primary root. */
define('AUDIO_MUSIC_ROOT_PRIMARY_ID', 'music');

/** Maximum number of entries returned by one directory listing. */
define('AUDIO_MUSIC_MAX_ENTRIES', 2000);

/** Maximum length accepted for a relative path. */
define('AUDIO_MUSIC_MAX_REL_LEN', 1024);

/**
 * Return the configured music roots, primary root first.
 *
 * @return array<int, array{id:string, path:string, label:string, primary:bool}>
 */
function music_roots(): array
{
    static $cache = null;
    static $cacheKey = null;

    // The key makes the cache self-invalidating: the environment cannot change
    // while the application runs, and the test suite can therefore switch
    // between a single-mount and a multi-mount configuration in one process.
    $key = (string) getenv('AUDIO_LIBRARY_OVERRIDE') . "\0"
         . (string) getenv(AUDIO_MUSIC_ROOTS_ENV) . "\0"
         . (defined('AUDIO_LIBRARY_PATH') ? (string) AUDIO_LIBRARY_PATH : '');
    if ($cache !== null && $cacheKey === $key) {
        return $cache;
    }

    $roots = [];
    $seen = [];

    $primaryPath = music_root_primary_path();
    if ($primaryPath !== '') {
        $roots[] = [
            'id'      => AUDIO_MUSIC_ROOT_PRIMARY_ID,
            'path'    => $primaryPath,
            'label'   => music_root_default_label(AUDIO_MUSIC_ROOT_PRIMARY_ID),
            'primary' => true,
        ];
        $seen[AUDIO_MUSIC_ROOT_PRIMARY_ID] = true;
    }

    $env = getenv(AUDIO_MUSIC_ROOTS_ENV);
    if (is_string($env) && $env !== '') {
        foreach (explode(',', $env) as $entry) {
            $entry = trim($entry);
            if ($entry === '' || strpos($entry, ':') === false) {
                continue;
            }
            [$id, $path] = explode(':', $entry, 2);
            $id = strtolower(trim($id));
            $path = trim($path);
            if ($id === '' || $path === '' || isset($seen[$id])) {
                continue;
            }
            if (!music_root_valid_id($id)) {
                continue;
            }
            $roots[] = [
                'id'      => $id,
                'path'    => $path,
                'label'   => music_root_default_label($id),
                'primary' => false,
            ];
            $seen[$id] = true;
        }
    }

    $cache = $roots;
    $cacheKey = $key;
    return $cache;
}

/**
 * Resolve the path of the primary root (the one used by the single-folder
 * workflow and by the API defaults).
 */
function music_root_primary_path(): string
{
    $root = getenv('AUDIO_LIBRARY_OVERRIDE');
    if ($root === false || $root === '') {
        $root = defined('AUDIO_LIBRARY_PATH') ? AUDIO_LIBRARY_PATH : '';
    }
    if (!is_string($root) || $root === '') {
        return '';
    }
    $real = realpath($root);
    return $real !== false ? $real : $root;
}

/** Human readable name of a root, used when no custom label is set. */
function music_root_default_label(string $id): string
{
    return $id === AUDIO_MUSIC_ROOT_PRIMARY_ID ? 'Music 1' : 'Music ' . preg_replace('/\D+/', '', $id);
}

/** Root identifier validation (also enforced on browser input). */
function music_root_valid_id(string $id): bool
{
    return (bool) preg_match('/^[a-z0-9][a-z0-9_-]{0,31}$/', $id);
}

/**
 * Return a single root by identifier, or null when unknown.
 *
 * @return array{id:string, path:string, label:string, primary:bool}|null
 */
function music_root_by_id(string $id): ?array
{
    $id = strtolower(trim($id));
    foreach (music_roots() as $root) {
        if ($root['id'] === $id) {
            return $root;
        }
    }
    return null;
}

/**
 * True when a canonical path is the root itself or lives inside it.
 * Used to reject anything a symlink might have pointed at outside the mount.
 */
function music_path_in_root(string $canonicalRoot, string $canonicalPath): bool
{
    if ($canonicalRoot === '' || $canonicalPath === '') {
        return false;
    }
    if ($canonicalPath === $canonicalRoot) {
        return true;
    }
    return strpos($canonicalPath, rtrim($canonicalRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR) === 0;
}

/**
 * Normalise a browser supplied relative path.
 *
 * Rejects absolute paths, "..", NUL bytes and anything too long.
 * Trailing slashes, duplicated slashes and "." segments are collapsed, so
 * "Rock/", "/Rock" and "./Rock" all become the same "Rock".
 *
 * @return string|null null when the path is not acceptable.
 */
function normalize_music_rel_path(?string $rel): ?string
{
    if ($rel === null) {
        return '';
    }
    if (strpos($rel, "\0") !== false) {
        return null;
    }
    if (strlen($rel) > AUDIO_MUSIC_MAX_REL_LEN) {
        return null;
    }
    $rel = trim($rel);
    if ($rel === '' || $rel === '.') {
        return '';
    }
    // An absolute path is never accepted: the browser only navigates with
    // relative paths inside a root.
    if ($rel[0] === '/') {
        return null;
    }
    $segments = [];
    foreach (explode('/', $rel) as $segment) {
        if ($segment === '' || $segment === '.') {
            continue;
        }
        if ($segment === '..') {
            return null;
        }
        $segments[] = $segment;
    }
    return implode('/', $segments);
}

/**
 * Resolve a relative path inside a root and verify it with realpath().
 *
 * @return array{ok:bool, error?:string, path?:string, rel:string, root?:array}
 */
function resolve_music_rel(string $rootId, ?string $rel): array
{
    $normalized = normalize_music_rel_path($rel);
    if ($normalized === null) {
        return ['ok' => false, 'error' => 'Invalid path', 'rel' => ''];
    }

    $root = music_root_by_id($rootId);
    if ($root === null) {
        return ['ok' => false, 'error' => 'Unknown root', 'rel' => $normalized];
    }

    $rootReal = realpath($root['path']);
    if ($rootReal === false || !is_dir($rootReal)) {
        // Unplugged disk or missing mount: reported, never fatal.
        return ['ok' => false, 'error' => 'Root folder is not available', 'rel' => $normalized];
    }

    $target = $normalized === '' ? $rootReal : $rootReal . DIRECTORY_SEPARATOR . $normalized;
    $real = realpath($target);
    if ($real === false || !is_dir($real)) {
        return ['ok' => false, 'error' => 'Folder not found', 'rel' => $normalized];
    }
    if (!music_path_in_root($rootReal, $real)) {
        // A symlink pointed outside the mounted root: refuse it.
        return ['ok' => false, 'error' => 'Folder is outside the mounted root', 'rel' => $normalized];
    }

    return ['ok' => true, 'path' => $real, 'rel' => $normalized, 'root' => $root];
}

/**
 * Parent of a relative path, or null when already at the root level.
 */
function music_rel_parent(string $rel): ?string
{
    $rel = trim($rel, '/');
    if ($rel === '') {
        return null;
    }
    $pos = strrpos($rel, '/');
    return $pos === false ? '' : substr($rel, 0, $pos);
}

/**
 * List the sub-directories of an already verified canonical directory.
 *
 * Only one level is read (no recursive walk) and each entry is validated with
 * realpath(), so directories that escape the root through a symlink are not
 * offered at all. Dot-directories (.covers and friends) stay hidden.
 *
 * @return array{ok:bool, error?:string, entries:array<int, array{name:string, rel:string, type:string}>}
 */
function browse_music_dir(string $rootReal, string $canonicalDir, string $rel): array
{
    if (!music_path_in_root($rootReal, $canonicalDir)) {
        return ['ok' => false, 'error' => 'Folder is outside the mounted root', 'entries' => []];
    }

    $handle = @opendir($canonicalDir);
    if ($handle === false) {
        return ['ok' => false, 'error' => 'Folder cannot be read (check permissions)', 'entries' => []];
    }

    $entries = [];
    try {
        while (($name = readdir($handle)) !== false) {
            if ($name === '.' || $name === '..' || $name === '' || $name[0] === '.') {
                continue;
            }
            $child = $canonicalDir . DIRECTORY_SEPARATOR . $name;
            $real = realpath($child);
            if ($real === false || !is_dir($real)) {
                continue;                                   // file, dangling symlink, unreadable
            }
            if (!music_path_in_root($rootReal, $real)) {
                continue;                                   // symlink escaping the root
            }
            $entries[] = [
                'name' => $name,
                'rel'  => $rel === '' ? $name : $rel . '/' . $name,
                'type' => 'dir',
            ];
            if (count($entries) >= AUDIO_MUSIC_MAX_ENTRIES) {
                break;
            }
        }
    } finally {
        closedir($handle);
    }

    usort($entries, static function (array $a, array $b): int {
        return strcasecmp($a['name'], $b['name']);
    });

    return ['ok' => true, 'entries' => $entries];
}

/**
 * Public description of a root, safe to send to the browser.
 */
function music_root_public(?array $root): array
{
    if ($root === null) {
        return ['id' => '', 'label' => '', 'path' => '', 'primary' => false, 'available' => false];
    }
    $available = is_dir($root['path']);
    return [
        'id'        => $root['id'],
        'label'     => $root['label'],
        'path'      => $root['path'],
        'primary'   => !empty($root['primary']),
        'available' => $available,
    ];
}
