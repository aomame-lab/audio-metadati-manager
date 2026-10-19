<?php
/**
 * Test helper: runs a single API endpoint in a clean process.
 *
 * The endpoints terminate with exit(), so each one has to run isolated.
 * Usage: php _endpoint_runner.php <base64 of a serialized request spec>
 *
 * The spec is ['file' => 'browse.php', 'server' => [...], 'get' => [...],
 * 'post' => [...]|null, 'direct' => bool, 'web_path' => 'api/browse.php'].
 *
 * Output is "<json>\n__STATUS__<http status>" so the parent can assert on both
 * the body and the status code. The body buffer is kept open with ob_start()
 * because http_response_code() refuses to work once output has been flushed.
 *
 * 'direct' => true reproduces the built-in web server, where SCRIPT_FILENAME
 * is the file named in the URL: that is the condition the direct-access guards
 * of the include-only files test.
 *
 * 'web_path' addresses files that live in web/ instead of web/api/.
 *
 * The JSON body of a POST is injected through $_POST: file_get_contents()
 * on php://input returns nothing under the CLI SAPI, and every endpoint already
 * falls back to $_POST when the raw body is not valid JSON.
 */

declare(strict_types=1);

$spec = unserialize(base64_decode($argv[1] ?? ''), ['allowed_classes' => false]);
if (!is_array($spec) || empty($spec['file'])) {
    fwrite(STDERR, "bad request spec\n");
    exit(2);
}

$webRoot = dirname(__DIR__) . '/web';
$target  = !empty($spec['web_path'])
    ? $webRoot . '/' . ltrim((string) $spec['web_path'], '/')
    : $webRoot . '/api/' . ltrim((string) $spec['file'], '/');

$_SERVER['REQUEST_METHOD'] = $spec['server']['REQUEST_METHOD'] ?? 'GET';
foreach ($spec['get'] ?? [] as $key => $value) {
    $_GET[$key] = $value;
    $_REQUEST[$key] = $value;
}
if (($spec['post'] ?? null) !== null) {
    $_POST = $spec['post'];
    $_REQUEST = array_merge($_REQUEST, $spec['post']);
}
if (!empty($spec['direct'])) {
    $_SERVER['SCRIPT_FILENAME'] = $target;
}

ob_start();
register_shutdown_function(static function (): void {
    $code = http_response_code();
    $body = ob_get_contents();
    ob_end_clean();
    echo $body . "\n__STATUS__" . (is_int($code) ? $code : 200) . "\n";
});

require_once $target;
