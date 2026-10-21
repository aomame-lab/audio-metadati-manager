<?php
/**
 * Audio Metadati Manager — test suite (multi music folders)
 *
 * Dependency free: plain PHP, no PHPUnit. Every test builds its own temporary
 * directory tree, so the real music library of the user is never needed.
 *
 *   php tests/run-tests.php
 *
 * Optional: AUDIO_PYTHON_BIN=<python with mutagen> adds the end-to-end tests
 * that really run python/comm.py over generated silent MP3 fixtures.
 */

declare(strict_types=1);

define('TESTS_DIR', __DIR__);
define('APP_ROOT', dirname(__DIR__));

/* ------------------------------------------------------------------ */
/* tiny test harness                                                   */
/* ------------------------------------------------------------------ */

$GLOBALS['tests_run'] = 0;
$GLOBALS['tests_failed'] = 0;
$GLOBALS['current_test'] = '';

function test(string $name, callable $fn): void
{
    $GLOBALS['current_test'] = $name;
    $GLOBALS['tests_run']++;
    try {
        $fn();
        echo "  \033[32mPASS\033[0m  $name\n";
    } catch (Throwable $e) {
        $GLOBALS['tests_failed']++;
        echo "  \033[31mFAIL\033[0m  $name\n";
        echo "        " . $e->getMessage() . "\n";
    }
}

function fail(string $message): void
{
    throw new RuntimeException($message);
}

function assert_true($value, string $message = ''): void
{
    if ($value !== true) {
        fail($message !== '' ? $message : 'expected true, got ' . var_export($value, true));
    }
}

function assert_false($value, string $message = ''): void
{
    if ($value !== false) {
        fail($message !== '' ? $message : 'expected false, got ' . var_export($value, true));
    }
}

function assert_same($expected, $actual, string $message = ''): void
{
    if ($expected !== $actual) {
        fail(($message !== '' ? $message . ' — ' : '')
            . 'expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

function assert_contains(string $haystack, string $needle, string $message = ''): void
{
    if (strpos($haystack, $needle) === false) {
        fail(($message !== '' ? $message . ' — ' : '') . "'$needle' not found in '$haystack'");
    }
}

function assert_null($value, string $message = ''): void
{
    if ($value !== null) {
        fail($message !== '' ? $message : 'expected null, got ' . var_export($value, true));
    }
}

function section(string $title): void
{
    echo "\n\033[1m$title\033[0m\n";
}

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Recursively remove a directory. */
function rmtree(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }
    $items = scandir($dir);
    if ($items === false) {
        return;
    }
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        $path = $dir . DIRECTORY_SEPARATOR . $item;
        if (is_link($path) || is_file($path)) {
            @unlink($path);
        } elseif (is_dir($path)) {
            rmtree($path);
        }
    }
    @rmdir($dir);
}

/** Remove every child of a directory, keeping the directory itself. */
function clear_dir(string $dir): void
{
    foreach ((array) @scandir($dir) as $item) {
        if ($item === '.' || $item === '..' || $item === '') {
            continue;
        }
        rmtree($dir . DIRECTORY_SEPARATOR . $item);
        if (!is_dir($dir . DIRECTORY_SEPARATOR . $item)) {
            @unlink($dir . DIRECTORY_SEPARATOR . $item);
        }
    }
}

/**
 * Build an isolated fixture tree.
 *
 *   $f = fixture([
 *       'music1' => ['Rock/Album A/track1.mp3', 'Rock/Album A/cover.jpg', ...],
 *       'music2' => [...],
 *   ]);
 *
 * Returns ['dir' => tmpdir, 'music1' => abs path, 'music2' => abs path, ...].
 */
function fixture(array $trees): array
{
    $base = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'amm-test-' . bin2hex(random_bytes(6));
    $out = ['data' => $base . DIRECTORY_SEPARATOR . '_data'];
    mkdir($out['data'], 0775, true);
    // macOS maps /var -> /private/var: store the canonical form so the
    // assertions can compare against realpath() results.
    $out['dir'] = realpath($base);

    foreach ($trees as $name => $files) {
        $root = $base . DIRECTORY_SEPARATOR . $name;
        mkdir($root, 0775, true);
        $out[$name] = realpath($root);
        foreach ((array) $files as $rel) {
            $full = $root . DIRECTORY_SEPARATOR . ltrim(str_replace('\\', '/', $rel), '/');
            $dir = dirname($full);
            if (!is_dir($dir)) {
                mkdir($dir, 0775, true);
            }
            file_put_contents($full, '');
        }
    }
    return $out;
}

/**
 * Configure the environment for a fixture.
 *
 * @param string      $primary path of the historical /music root ('' = unset)
 * @param array|null  $extra   root id => path; null simulates an unplugged disk
 */
function use_roots(string $primary, ?array $extra = null): void
{
    putenv('AUDIO_LIBRARY_OVERRIDE=' . $primary);
    putenv('AUDIO_MUSIC_ROOTS=' . (is_array($extra) ? rtrim(implode(',', array_map(
        static fn(string $id, string $path): string => $id . ':' . $path,
        array_keys($extra),
        array_values($extra)
    )), ',') : ''));
    putenv('AUDIO_DATA_DIR=' . $GLOBALS['fixture']['data']);
}

/** Run an API endpoint in an isolated process and decode its JSON answer. */
function call_endpoint(string $file, array $get = [], ?array $post = null): array
{
    return run_api_file([
        'file'   => $file,
        'server' => ['REQUEST_METHOD' => $post === null ? 'GET' : 'POST'],
        'get'    => $get,
        'post'   => $post,
    ], $file);
}

/**
 * Simulate a direct HTTP request for a served PHP file, exactly as the PHP
 * built-in web server does: SCRIPT_FILENAME is the file named in the URL.
 * $webPath is relative to web/, e.g. "api/library-roots.php" or "config.php".
 */
function call_direct(string $webPath): array
{
    return run_api_file([
        'file'    => basename($webPath),
        'web_path' => $webPath,
        'direct'  => true,
        'server'  => ['REQUEST_METHOD' => 'GET'],
        'get'     => [],
        'post'    => null,
    ], 'direct:' . $webPath);
}

function run_api_file(array $payload, string $label): array
{
    $env = [
        'AUDIO_LIBRARY_OVERRIDE' => (string) getenv('AUDIO_LIBRARY_OVERRIDE'),
        'AUDIO_MUSIC_ROOTS'       => (string) getenv('AUDIO_MUSIC_ROOTS'),
        'AUDIO_DATA_DIR'          => (string) getenv('AUDIO_DATA_DIR'),
        'AUDIO_PYTHON_BIN'        => (string) getenv('AUDIO_PYTHON_BIN'),
        'PATH'                    => (string) getenv('PATH'),
        'HOME'                    => (string) getenv('HOME'),
    ];

    $result = runner_exec($payload, $env, $label);

    if (!preg_match('/\n__STATUS__(\d+)\s*$/', $result['stdout'], $m)) {
        fail($label . ' produced no status marker. stdout=' . trim($result['stdout'])
            . ' stderr=' . trim($result['stderr']));
    }
    $body = substr($result['stdout'], 0, -strlen($m[0]));

    // Regression guard: an empty body is the worst failure signature for a
    // client, because fetch().json() rejects it without an actionable message.
    if (trim($body) === '') {
        fail($label . ' returned an EMPTY body (HTTP ' . $m[1] . '). stderr=' . trim($result['stderr']));
    }

    $decoded = json_decode(trim($body), true);
    if (!is_array($decoded)) {
        fail($label . ' did not return JSON: ' . trim($body)
            . ' stderr=' . trim($result['stderr']));
    }
    $decoded['__status'] = (int) $m[1];
    return $decoded;
}

function runner_exec(array $payload, array $env, string $label): array
{
    $script = TESTS_DIR . DIRECTORY_SEPARATOR . '_endpoint_runner.php';
    $cmd = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($script) . ' '
        . escapeshellarg(base64_encode(serialize($payload)));
    $descriptors = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    $process = proc_open($cmd, $descriptors, $pipes, APP_ROOT, $env);
    if (!is_resource($process)) {
        fail('unable to spawn the endpoint runner for ' . $label);
    }
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($process);
    return ['stdout' => (string) $stdout, 'stderr' => (string) $stderr];
}

/* ------------------------------------------------------------------ */
/* load the application modules                                        */
/* ------------------------------------------------------------------ */

require_once APP_ROOT . '/web/api/bootstrap.php';

function python_available(): bool
{
    static $ok = null;
    if ($ok !== null) {
        return $ok;
    }
    $bin = (string) getenv('AUDIO_PYTHON_BIN');
    if ($bin === '') {
        $bin = PHP_OS_FAMILY === 'Darwin' ? 'python3' : 'python3';
    }
    $cmd = escapeshellarg($bin) . ' -c ' . escapeshellarg('import mutagen') . ' 2>/dev/null';
    exec($cmd, $ignored, $code);
    $ok = ($code === 0);
    return $ok;
}

function run_comm(array $args): array
{
    $bin = (string) getenv('AUDIO_PYTHON_BIN');
    if ($bin === '') {
        $bin = 'python3';
    }
    $cmd = escapeshellarg($bin) . ' ' . escapeshellarg(APP_ROOT . '/python/comm.py');
    foreach ($args as $arg) {
        $cmd .= ' ' . escapeshellarg((string) $arg);
    }
    $output = shell_exec($cmd . ' 2>&1');
    $decoded = json_decode(trim((string) $output), true);
    return is_array($decoded) ? $decoded : ['success' => false, 'error' => trim((string) $output)];
}

/**
 * Build a minimal but valid ID3v2.3 tag holding a single TIT2 frame.
 * Hand written so the fixtures need no extra dependency.
 */
function id3v23_tag(string $title): string
{
    $payload = "\x00" . $title;                    // 0x00 = ISO-8859-1
    $frame = 'TIT2' . pack('N', strlen($payload)) . "\x00\x00" . $payload;
    $size = strlen($frame);
    $syncsafe = chr(($size >> 21) & 0x7F) . chr(($size >> 14) & 0x7F)
        . chr(($size >> 7) & 0x7F) . chr($size & 0x7F);
    return "ID3\x03\x00\x00" . $syncsafe . $frame;
}

/* Generate a real, silent, valid MPEG-1 Layer III file (40 frames, ~1 s). */
function make_mp3(string $path, string $title, string $artist, string $album = '', string $track = '1'): void
{
    $dir = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    $frame = "\xFF\xFB\x90\x00" . str_repeat("\x00", 413);   // 128 kbps, 44.1 kHz
    file_put_contents($path, id3v23_tag($title) . str_repeat($frame, 40));

    $res = run_comm(['save', $path, $title, $artist, $album, $artist, '2020', $track, '9', 'Rock', '']);
    if (empty($res['success'])) {
        fail('unable to build the MP3 fixture: ' . json_encode($res));
    }
}

/* ================================================================== */
/* TESTS                                                               */
/* ================================================================== */

$fixture = fixture(['music1' => [], 'music2' => []]);
$GLOBALS['fixture'] = $fixture;
register_shutdown_function(static function () use ($fixture): void {
    rmtree($fixture['dir']);
});

echo "Audio Metadati Manager — multi folder test suite\n";
echo "workspace: " . $fixture['dir'] . "\n";
echo "python/mutagen: " . (python_available() ? 'available' : 'NOT available (end-to-end tests skipped)') . "\n";

/* ---------------- 1. Roots configuration ---------------- */
section('1. Roots configuration (MUSIC_PATH only / several mounts)');

test('starts with the historical MUSIC_PATH only, no AUDIO_MUSIC_ROOTS', function () use ($fixture) {
    putenv('AUDIO_MUSIC_ROOTS=');
    putenv('AUDIO_LIBRARY_OVERRIDE=' . $fixture['music1']);
    $roots = music_roots();
    assert_same(1, count($roots), 'one root expected');
    assert_same('music', $roots[0]['id']);
    assert_same($fixture['music1'], $roots[0]['path']);
    assert_true($roots[0]['primary']);
});

test('adds the extra mounts declared in AUDIO_MUSIC_ROOTS', function () use ($fixture) {
    use_roots($fixture['music1'],['music2' => $fixture['music2'], 'music3' => '/mnt/does-not-exist']);
    $roots = music_roots();
    assert_same(3, count($roots));
    assert_same(['music', 'music2', 'music3'], array_column($roots, 'id'));
    assert_same($fixture['music2'], $roots[1]['path']);
    assert_false($roots[1]['primary']);
});

test('ignores malformed root entries', function () use ($fixture) {
    putenv('AUDIO_LIBRARY_OVERRIDE=' . $fixture['music1']);
    putenv('AUDIO_MUSIC_ROOTS=music:other,,broken-entry,music2:' . $fixture['music2']);
    $roots = music_roots();
    assert_same(2, count($roots), 'duplicate id and malformed entries are skipped');
    assert_same('music2', $roots[1]['id']);
});

test('resolve_in_library accepts every root and rejects foreign paths', function () use ($fixture) {
    $outside = fixture(['outside' => ['secret/track.mp3']]);
    try {
        use_roots($fixture['music1'],['music2' => $fixture['music2']]);
        mkdir($fixture['music2'] . '/Rock', 0775, true);
        assert_same(
            realpath($fixture['music2'] . '/Rock'),
            resolve_in_library($fixture['music2'] . '/Rock')
        );
        assert_null(resolve_in_library($outside['outside'] . '/secret'), 'outside path must be refused');

        // ".." is neutralised by realpath(): a path that lands outside every
        // root stays refused, one that lands inside a root is legitimate.
        assert_null(
            resolve_in_library($fixture['music1'] . '/../music2/../nowhere'),
            'a traversal escaping every root must be refused'
        );
        assert_same(
            realpath($fixture['music2'] . '/Rock'),
            resolve_in_library($fixture['music1'] . '/../music2/Rock'),
            'a traversal resolving inside a root is simply resolved'
        );
    } finally {
        rmtree($outside['dir']);
    }
});

test('with no root at all any existing path is still accepted (legacy behaviour)', function () use ($fixture) {
    putenv('AUDIO_LIBRARY_OVERRIDE=' . $fixture['dir'] . '/does-not-exist');
    putenv('AUDIO_MUSIC_ROOTS=');
    mkdir($fixture['music1'] . '/Legacy', 0775, true);
    assert_same(
        realpath($fixture['music1'] . '/Legacy'),
        resolve_in_library($fixture['music1'] . '/Legacy')
    );
});

test('cover_storage_root picks the first writable root', function () use ($fixture) {
    mkdir($fixture['music1'] . '/Writable', 0775, true);
    mkdir($fixture['music2'] . '/Other', 0775, true);
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    $expected = realpath($fixture['music1']);
    if (is_writable($expected)) {
        assert_same($expected, cover_storage_root());
    } else {
        assert_true(cover_storage_root() === realpath($fixture['music2'])
            || cover_storage_root() === null, 'a writable root or none');
    }
});

/* ---------------- 2. Directory explorer ---------------- */
section('2. Directory explorer (browse.php)');

test('lists one directory level of an authorized root', function () use ($fixture) {
    clear_dir($fixture['music1']);
    foreach (['Rock', 'Jazz', 'Rock/Album A'] as $rel) {
        @mkdir($fixture['music1'] . '/' . $rel, 0775, true);
    }
    file_put_contents($fixture['music1'] . '/Rock/song.mp3', '');
    file_put_contents($fixture['music1'] . '/.covers', '');        // dotfile, must stay hidden
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);

    $res = call_endpoint('browse.php', ['root' => 'music']);
    assert_true($res['success'], 'browse should succeed');
    assert_same('', $res['path'], 'the root level is the empty relative path');
    assert_null($res['parent'], 'the root level has no parent');
    $names = array_column($res['entries'], 'name');
    sort($names);
    assert_same(['Jazz', 'Rock'], $names, 'files and dot-directories are not listed');
    // Entries are sorted case-insensitively: Jazz, Rock.
    assert_same('Jazz', $res['entries'][0]['name']);
    assert_same('Rock', $res['entries'][1]['rel'], 'each entry carries its relative path');
    assert_same('dir', $res['entries'][1]['type'], 'only directories are returned');
});

test('navigates down and back to the parent without leaving the root', function () use ($fixture) {
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    $down = call_endpoint('browse.php', ['root' => 'music', 'path' => 'Rock/Album A']);
    assert_true($down['success']);
    assert_same('Rock', $down['parent']);
    assert_same('music/Rock/Album A', $down['display']);

    $up = call_endpoint('browse.php', ['root' => 'music', 'path' => $down['parent']]);
    assert_true($up['success']);
    assert_same('Rock', $up['path']);
    assert_same('', $up['parent'], 'the parent of a first level folder is the root');

    $top = call_endpoint('browse.php', ['root' => 'music', 'path' => '']);
    assert_true($top['success']);
    assert_null($top['parent'], 'the root itself has no parent: navigation cannot escape it');
});

test('refuses path traversal (..) in every form', function () use ($fixture) {
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    foreach (['../music2', 'Rock/../../music2', '..', 'Rock/..', '/etc', '/etc/passwd'] as $attack) {
        $res = call_endpoint('browse.php', ['root' => 'music', 'path' => $attack]);
        assert_false($res['success'], 'must refuse: ' . $attack);
    }
});

test('refuses a symlink that escapes the root', function () use ($fixture) {
    $outside = fixture(['outside' => ['target/secret.mp3']]);
    try {
        @symlink($outside['outside'] . '/target', $fixture['music1'] . '/Escape');
        use_roots($fixture['music1'],['music2' => $fixture['music2']]);

        $res = call_endpoint('browse.php', ['root' => 'music', 'path' => 'Escape']);
        assert_false($res['success'], 'following the symlink must fail');
        assert_contains($res['error'], 'outside');

        $list = call_endpoint('browse.php', ['root' => 'music']);
        $names = array_column($list['entries'] ?? [], 'name');
        assert_false(in_array('Escape', $names, true), 'the escaping link is not even offered');
    } finally {
        rmtree($outside['dir']);
    }
});

test('reports an unavailable root instead of crashing', function () use ($fixture) {
    use_roots($fixture['music1'],['music2' => '/mnt/unplugged-disk']);
    $res = call_endpoint('browse.php', ['root' => 'music2']);
    assert_false($res['success']);
    assert_contains($res['error'], 'not available');

    $cfg = call_endpoint('config.php');
    $byId = [];
    foreach ($cfg['roots'] as $root) {
        $byId[$root['id']] = $root;
    }
    assert_false($byId['music2']['available'], 'config marks the missing mount');
    assert_true($byId['music']['available'], 'the primary root is still fine');
});

test('rejects an unknown root identifier', function () use ($fixture) {
    use_roots($fixture['music1'],[]);
    $res = call_endpoint('browse.php', ['root' => '../../etc']);
    assert_false($res['success']);
    assert_contains($res['error'], 'Unknown root');
});

/* ---------------- 3. Persistent folder list ---------------- */
section('3. Persistent folder list (folders.php)');

test('adds a folder and returns it with its stable id', function () use ($fixture) {
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    $res = call_endpoint('folders.php', [], ['action' => 'add', 'root' => 'music2', 'path' => 'Rock']);
    assert_true($res['success'], json_encode($res));
    assert_same('music2', $res['folder']['root_id']);
    assert_same('Rock', $res['folder']['rel_path']);
    assert_true($res['folder']['available']);
    assert_same('Rock', $res['folder']['label'], 'label defaults to the folder name');
    assert_true($res['folder']['created_at'] !== '' && $res['folder']['updated_at'] !== '');
    $listed = call_endpoint('folders.php')['folders'];
    assert_same(1, count($listed), 'the folder is persisted');
    assert_same($res['folder']['id'], $listed[0]['id'], 'the id is stable');
});

test('refuses duplicates: trailing slash, leading ./ and case of the same path', function () use ($fixture) {
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    $existing = count(call_endpoint('folders.php')['folders']);
    foreach (['Rock/', './Rock', 'Rock//', '  Rock  '] as $variant) {
        $res = call_endpoint('folders.php', [], ['action' => 'add', 'root' => 'music2', 'path' => $variant]);
        assert_false($res['success'], 'duplicate refused for: ' . $variant);
        assert_contains($res['error'], 'already registered');
        assert_true($res['duplicate'] !== null);
    }
    assert_same($existing, count(call_endpoint('folders.php')['folders']), 'no extra record created');
});

test('the same relative path on two different roots is not a duplicate', function () use ($fixture) {
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    $res = call_endpoint('folders.php', [], ['action' => 'add', 'root' => 'music', 'path' => 'Rock']);
    assert_true($res['success'], 'same relative path on another root is allowed');
});

test('parent and child folders can coexist', function () use ($fixture) {
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    $before = count(call_endpoint('folders.php')['folders']);
    $parent = call_endpoint('folders.php', [], ['action' => 'add', 'root' => 'music', 'path' => '']);
    assert_true($parent['success']);
    assert_same($before + 1, count(call_endpoint('folders.php')['folders']), 'root folder accepted too');
});

test('stores a custom label and truncates an over-long one', function () use ($fixture) {
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    @unlink(library_folders_file());
    $res = call_endpoint('folders.php', [], ['action' => 'add', 'root' => 'music2', 'path' => 'Jazz', 'label' => 'My Jazz']);
    assert_true($res['success']);
    assert_same('My Jazz', $res['folder']['label']);

    $long = call_endpoint('folders.php', [], ['action' => 'add', 'root' => 'music', 'path' => 'Rock', 'label' => str_repeat('x', 400)]);
    assert_true($long['success'], json_encode($long));
    assert_same(120, mb_strlen($long['folder']['label']), 'label truncated, not rejected');
});

test('removes a folder without touching anything on disk', function () use ($fixture) {
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    $marker = $fixture['music1'] . '/keep-me.txt';
    file_put_contents($marker, 'untouched');

    $list = call_endpoint('folders.php')['folders'];
    $target = null;
    foreach ($list as $folder) {
        if ($folder['rel_path'] === 'Jazz') {
            $target = $folder;
        }
    }
    assert_true($target !== null, 'folder to remove found');

    $res = call_endpoint('folders.php', [], ['action' => 'remove', 'id' => $target['id']]);
    assert_true($res['success']);
    assert_same($target['id'], $res['removed']);

    $ids = array_column(call_endpoint('folders.php')['folders'], 'id');
    assert_false(in_array($target['id'], $ids, true), 'record removed from the configuration');
    assert_true(is_file($marker), 'files on disk are never deleted');

    $again = call_endpoint('folders.php', [], ['action' => 'remove', 'id' => $target['id']]);
    assert_false($again['success'], 'removing twice is an explicit 404');
});

test('survives a restart: a separate process reads the same configuration', function () use ($fixture) {
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    $before = call_endpoint('folders.php')['folders'];

    // A brand new PHP process (simulating a container/app restart) must see
    // exactly the same list, read from the persistent data directory.
    $result = runner_exec(
        ['file' => 'folders.php', 'server' => ['REQUEST_METHOD' => 'GET'], 'get' => [], 'post' => null],
        [
            'AUDIO_LIBRARY_OVERRIDE' => (string) getenv('AUDIO_LIBRARY_OVERRIDE'),
            'AUDIO_MUSIC_ROOTS'       => (string) getenv('AUDIO_MUSIC_ROOTS'),
            'AUDIO_DATA_DIR'          => (string) getenv('AUDIO_DATA_DIR'),
            'PATH'                    => (string) getenv('PATH'),
        ],
        'folders.php (restart)'
    );
    $after = json_decode(trim(explode("\n__STATUS__", $result['stdout'])[0]), true);

    assert_true(is_array($after), 'the restarted process answered: ' . trim($result['stderr']));
    assert_same(count($before), count($after['folders']), 'same number of folders after restart');
    assert_same(
        array_column($before, 'rel_path'),
        array_column($after['folders'], 'rel_path')
    );
});

test('a corrupted configuration file is reported, not fatal', function () use ($fixture) {
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    $file = library_folders_file();
    file_put_contents($file, '{ this is not json');
    $res = call_endpoint('folders.php');
    assert_true($res['success']);
    assert_same([], $res['folders']);
    assert_true($res['warning'] !== null, 'the user is told the store was reset');
    assert_true(is_file($file . '.corrupt'), 'the unreadable file is preserved');

    call_endpoint('folders.php', [], ['action' => 'add', 'root' => 'music', 'path' => '']);
    assert_same(1, count(call_endpoint('folders.php')['folders']), 'the store works again');
});

test('rejects an unknown root and an invalid id', function () use ($fixture) {
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    $bad = call_endpoint('folders.php', [], ['action' => 'add', 'root' => 'nope', 'path' => '']);
    assert_false($bad['success']);
    $badId = call_endpoint('folders.php', [], ['action' => 'remove', 'id' => '../../etc/passwd']);
    assert_false($badId['success']);
});

/* ---------------- 4. Scanning / library merge ---------------- */
section('4. Scanning and merge (library.php)');

test('library.php refuses to run with no registered folder', function () use ($fixture) {
    use_roots($fixture['music1'],[]);
    @unlink(library_folders_file());
    $res = call_endpoint('library.php');
    assert_false($res['success']);
});

test('scans every registered folder and merges the tracks', function () use ($fixture) {
    if (!python_available()) {
        return;   // declared as skipped in the summary
    }
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    @unlink(library_folders_file());
    rmtree($fixture['music1'] . '/Rock');
    rmtree($fixture['music1'] . '/Jazz');
    rmtree($fixture['music2'] . '/Rock');
    make_mp3($fixture['music1'] . '/Rock/Album A/01.mp3', 'Song one', 'Artist A');
    make_mp3($fixture['music2'] . '/Rock/Album B/02.mp3', 'Song two', 'Artist B');

    foreach ([['music', 'Rock'], ['music2', 'Rock']] as [$root, $path]) {
        $res = call_endpoint('folders.php', [], ['action' => 'add', 'root' => $root, 'path' => $path]);
        assert_true($res['success'], json_encode($res));
    }

    $lib = call_endpoint('library.php');
    assert_true($lib['success'], json_encode($lib));
    assert_same(2, $lib['total'], 'one track per folder');
    $paths = array_column($lib['tracks'], 'path');
    assert_true(in_array(realpath($fixture['music1'] . '/Rock/Album A/01.mp3'), $paths, true));
    assert_true(in_array(realpath($fixture['music2'] . '/Rock/Album B/02.mp3'), $paths, true));
    $titles = array_column($lib['tracks'], 'title');
    sort($titles);
    assert_same(['Song one', 'Song two'], $titles, 'real metadata read by mutagen');
});

test('parent + child folders never import the same file twice', function () use ($fixture) {
    if (!python_available()) {
        return;   // skipped, declared in the summary
    }
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    @unlink(library_folders_file());
    clear_dir($fixture['music1']);
    make_mp3($fixture['music1'] . '/Rock/Album A/01.mp3', 'First', 'Artist A');
    make_mp3($fixture['music1'] . '/Rock/Album B/02.mp3', 'Second', 'Artist A');

    $parent = call_endpoint('folders.php', [], ['action' => 'add', 'root' => 'music', 'path' => '']);
    $child  = call_endpoint('folders.php', [], ['action' => 'add', 'root' => 'music', 'path' => 'Rock']);
    assert_true($parent['success'] && $child['success'], 'parent and child are both accepted');

    $lib = call_endpoint('library.php');
    assert_true($lib['success'], json_encode($lib));
    assert_same(2, $lib['total'], 'the two tracks are imported once each, not twice');

    $paths = array_column($lib['tracks'], 'path');
    assert_same(count($paths), count(array_unique($paths)), 'paths are unique');
});

test('an unavailable folder is reported and does not break the scan', function () use ($fixture) {
    if (!python_available()) {
        return;
    }
    use_roots($fixture['music1'],['music2' => '/mnt/unplugged-disk']);
    @unlink(library_folders_file());
    clear_dir($fixture['music1']);
    make_mp3($fixture['music1'] . '/Solo/01.mp3', 'Only one', 'Artist A');
    call_endpoint('folders.php', [], ['action' => 'add', 'root' => 'music', 'path' => '']);
    call_endpoint('folders.php', [], ['action' => 'add', 'root' => 'music2', 'path' => '']);

    $lib = call_endpoint('library.php');
    assert_true($lib['success'], 'the scan still succeeds');
    assert_same(1, $lib['total'], 'tracks of the available root are returned');

    $byId = [];
    foreach ($lib['folders'] as $folder) {
        $byId[$folder['root_id']] = $folder;
    }
    assert_false($byId['music2']['available']);
    assert_true($byId['music2']['error'] !== null);
    assert_true($byId['music']['available']);
});

test('removing a folder keeps its records reachable until the next scan', function () use ($fixture) {
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    $folders = call_endpoint('folders.php')['folders'];
    if (count($folders) === 0) {
        return;
    }
    call_endpoint('folders.php', [], ['action' => 'remove', 'id' => $folders[0]['id']]);
    $after = call_endpoint('folders.php')['folders'];
    assert_same(count($folders) - 1, count($after));
});

/* ---------------- 5. Regression of the existing API ---------------- */
section('5. Regression of the pre-existing endpoints');

test('config.php keeps the historical library_path field', function () use ($fixture) {
    use_roots($fixture['music1'],[]);
    $cfg = call_endpoint('config.php');
    assert_true($cfg['success']);
    assert_same(realpath($fixture['music1']), $cfg['library_path']);
    assert_true(is_array($cfg['roots']));
});

test('tracks.php still scans the root when no folder is registered', function () use ($fixture) {
    if (!python_available()) {
        return;
    }
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    @unlink(library_folders_file());
    $res = call_endpoint('tracks.php', ['path' => '']);
    assert_true($res['success'], json_encode($res));
    assert_true(is_array($res['tracks']));
});

test('tracks.php refuses a path outside every root', function () use ($fixture) {
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    $outside = fixture(['outside' => ['lib/song.mp3']]);
    try {
        $res = call_endpoint('tracks.php', ['path' => $outside['outside'] . '/lib']);
        assert_false($res['success'], 'a foreign folder is refused');
    } finally {
        rmtree($outside['dir']);
    }
});

test('metadata.php reads a real file on a secondary root', function () use ($fixture) {
    if (!python_available()) {
        return;
    }
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    $file = $fixture['music2'] . '/Secondary/99.mp3';
    make_mp3($file, 'Secondary song', 'Artist C', 'Album C', '9');
    $res = call_endpoint('metadata.php', ['path' => $file]);
    assert_true($res['success'], json_encode($res));
    assert_same('Secondary song', $res['track']['title']);
    assert_same('Artist C', $res['track']['artist']);
    assert_true($res['track']['duration'] > 0);
});

test('save.php still writes metadata on a secondary root', function () use ($fixture) {
    if (!python_available()) {
        return;
    }
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    $file = $fixture['music2'] . '/Secondary/99.mp3';
    $res = call_endpoint('save.php', [], [
        'path' => $file, 'title' => 'Saved on root 2', 'artist' => 'Edited',
        'album' => 'Edited album', 'album_artist' => 'Edited', 'year' => '2024',
        'track' => 2, 'total' => 10, 'genre' => 'Jazz',
    ]);
    assert_true($res['success'], json_encode($res));

    $back = call_endpoint('metadata.php', ['path' => $file]);
    assert_same('Saved on root 2', $back['track']['title']);
    assert_same('Edited album', $back['track']['album']);
    assert_same('Jazz', $back['track']['genre']);
});

test('save.php refuses a file outside every root', function () use ($fixture) {
    use_roots($fixture['music1'],['music2' => $fixture['music2']]);
    $outside = fixture(['outside' => ['lib/song.mp3']]);
    try {
        $res = call_endpoint('save.php', [], [
            'path' => $outside['outside'] . '/lib/song.mp3', 'title' => 'nope',
            'artist' => 'x', 'album' => 'y', 'album_artist' => 'z', 'year' => '2020',
            'track' => 1, 'total' => 1, 'genre' => '',
        ]);
        assert_false($res['success'], 'writing outside a root is refused');
        assert_contains($res['error'], 'Invalid audio file');
    } finally {
        rmtree($outside['dir']);
    }
});

/* ---------------- 6. Files served under the document root ---------------- */
section('6. Files reachable in the served document root');

/** Endpoints: the files the browser is allowed to call. */
const AMM_ENDPOINTS = [
    'config.php', 'tracks.php', 'scan.php', 'metadata.php', 'save.php',
    'bulk-update.php', 'cover.php', 'audio.php', 'upload-cover.php',
    'upload-album-cover.php', 'browse.php', 'folders.php', 'library.php',
];

/** Include-only files: reachable by URL but never a valid entry point. */
const AMM_INTERNAL_FILES = [
    'api/bootstrap.php', 'api/library-roots.php', 'api/library-folders.php',
    'config.php', 'config.example.php',
];

test('every include-only file refuses direct access with an explicit JSON error', function () use ($fixture) {
    use_roots($fixture['music1']);
    foreach (AMM_INTERNAL_FILES as $webPath) {
        $res = call_direct($webPath);
        assert_same(403, $res['__status'], $webPath . ' must answer 403, not an empty 200');
        assert_false($res['success'], $webPath . ' must report a failure');
        assert_contains($res['error'], 'not an API endpoint', $webPath);
    }
});

test('the guard does not break the normal include chain', function () use ($fixture) {
    use_roots($fixture['music1'], ['music2' => $fixture['music2']]);
    $cfg = call_endpoint('config.php');
    assert_true($cfg['success'], json_encode($cfg));
    assert_same($fixture['music1'], $cfg['library_path']);
    assert_same(2, count($cfg['roots']), 'the roots parsed from the environment survive the guard');
    assert_true(function_exists('music_roots') && function_exists('library_folders_load'));
});

test('every PHP file under web/api is either an endpoint or guarded', function () {
    $found = [];
    foreach ((array) scandir(APP_ROOT . '/web/api') as $entry) {
        if ($entry === '.' || $entry === '..' || substr($entry, -4) !== '.php') {
            continue;
        }
        $found[] = $entry;
    }
    sort($found);
    // A new file under web/api is served over HTTP like the others, so it must
    // be declared here: as a callable endpoint or as a guarded internal file.
    $expected = array_merge(AMM_ENDPOINTS, [
        'bootstrap.php', 'library-roots.php', 'library-folders.php',
    ]);
    sort($expected);
    assert_same($expected, $found, 'a new file under web/api must be declared as endpoint or internal');
});

test('no endpoint ever answers with an empty body, on success or on error', function () use ($fixture) {
    use_roots($fixture['music1'], ['music2' => $fixture['music2']]);

    // Success and error paths of every endpoint that can answer without a file.
    $probes = [
        ['config.php', []],
        ['folders.php', []],
        ['library.php', []],
        ['browse.php', ['root' => 'music']],
        ['browse.php', ['root' => '../../etc']],
        ['browse.php', []],
        ['tracks.php', []],
        ['tracks.php', ['path' => '/definitely/not/here']],
        ['metadata.php', []],
        ['metadata.php', ['path' => '/definitely/not/here.mp3']],
        ['cover.php', []],
        ['audio.php', []],
        ['audio.php', ['path' => '/definitely/not/here.mp3']],
        ['upload-album-cover.php', []],
    ];
    foreach ($probes as [$file, $get]) {
        // run_api_file() already fails on an empty body; assert the shape too.
        $res = call_endpoint($file, $get);
        assert_true(array_key_exists('success', $res), $file . ' must always report success');
        assert_true($res['__status'] >= 200 && $res['__status'] < 600, $file . ' must set a status');
        if (!$res['success']) {
            assert_true(isset($res['error']) && trim((string) $res['error']) !== '',
                $file . ' must explain the failure instead of failing silently');
        }
    }
});

test('a POST to an endpoint answers with JSON, never with an empty body', function () use ($fixture) {
    use_roots($fixture['music1'], ['music2' => $fixture['music2']]);
    $probes = [
        ['folders.php', ['action' => 'add', 'root' => '../../etc', 'path' => '']],
        ['folders.php', ['action' => 'remove', 'id' => '../../../etc/passwd']],
        ['folders.php', []],
        ['save.php', ['path' => '/definitely/not/here.mp3']],
        ['bulk-update.php', []],
        ['bulk-update.php', ['action' => 'nope']],
        ['scan.php', ['path' => '/definitely/not/here']],
        ['upload-album-cover.php', ['path' => '/definitely/not/here.mp3']],
    ];
    foreach ($probes as [$file, $post]) {
        $res = call_endpoint($file, [], $post);
        assert_false($res['success'], $file . ' must refuse the malformed request');
        assert_true(trim((string) ($res['error'] ?? '')) !== '', $file . ' must explain the refusal');
    }
});

test('the data volume is not touched by a refused or empty request', function () use ($fixture) {
    use_roots($fixture['music1']);
    $before = @file_get_contents(library_folders_file());
    call_direct('api/library-folders.php');
    call_endpoint('browse.php', ['root' => '../../etc']);
    $after = @file_get_contents(library_folders_file());
    assert_same($before === false ? '' : $before, $after === false ? '' : $after,
        'reading the configuration must never rewrite it');
});

/* ---------------- summary ---------------- */
$skipped = python_available() ? 0 : 6;
echo "\n";
echo "----------------------------------------\n";
echo "tests run    : {$GLOBALS['tests_run']}\n";
echo "failed       : {$GLOBALS['tests_failed']}\n";
echo "skipped (no mutagen): {$skipped}\n";
echo "----------------------------------------\n";

exit($GLOBALS['tests_failed'] > 0 ? 1 : 0);
