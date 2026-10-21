<?php
require_once __DIR__ . '/bootstrap.php';

const ALBUM_COVER_MAX_BYTES = 10 * 1024 * 1024;

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
if ($method !== 'POST') {
    json_out(['success' => false, 'error' => 'Method not allowed'], 405);
}

$audioPath = $_POST['path'] ?? null;
$audioReal = resolve_in_library(is_string($audioPath) ? $audioPath : null);
if ($audioReal === null || !is_file($audioReal)) {
    json_out(['success' => false, 'error' => 'Invalid audio file'], 400);
}

$audioExt = strtolower(pathinfo($audioReal, PATHINFO_EXTENSION));
if (!in_array($audioExt, ['mp3', 'flac', 'm4a'], true)) {
    json_out(['success' => false, 'error' => 'Unsupported audio file'], 400);
}

$albumDir = realpath(dirname($audioReal));
if ($albumDir === false || !is_dir($albumDir) || resolve_in_library($albumDir) === null) {
    json_out(['success' => false, 'error' => 'Invalid album folder'], 400);
}
if (!is_writable($albumDir)) {
    json_out(['success' => false, 'error' => 'The album folder is not writable'], 400);
}

$field = $_FILES['cover'] ?? null;
if (!is_array($field) || !isset($field['error'])) {
    json_out(['success' => false, 'error' => 'No cover file received'], 400);
}
if ((int) $field['error'] === UPLOAD_ERR_INI_SIZE || (int) $field['error'] === UPLOAD_ERR_FORM_SIZE) {
    json_out(['success' => false, 'error' => 'The image is too large (max 10 MB)'], 400);
}
if ((int) $field['error'] !== UPLOAD_ERR_OK) {
    json_out(['success' => false, 'error' => 'Upload failed (code ' . (int) $field['error'] . ')'], 400);
}
if (!is_uploaded_file($field['tmp_name'])) {
    json_out(['success' => false, 'error' => 'Invalid upload'], 400);
}
if ((int) $field['size'] <= 0 || (int) $field['size'] > ALBUM_COVER_MAX_BYTES) {
    json_out(['success' => false, 'error' => 'The image is empty or too large (max 10 MB)'], 400);
}

$allowedMime = ['image/jpeg', 'image/jpg', 'image/pjpeg'];
$mime = '';
if (function_exists('finfo_open')) {
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    if ($finfo !== false) {
        $mime = (string) finfo_file($finfo, $field['tmp_name']);
    }
}
if ($mime !== '' && !in_array(strtolower($mime), $allowedMime, true)) {
    json_out(['success' => false, 'error' => 'Only JPEG images are supported (detected: ' . $mime . ')'], 400);
}

$info = @getimagesize($field['tmp_name']);
if ($info === false || empty($info['mime']) || strtolower((string) $info['mime']) !== 'image/jpeg') {
    json_out(['success' => false, 'error' => 'The selected file is not a valid JPEG image'], 400);
}

$bytes = @file_get_contents($field['tmp_name']);
if ($bytes === false || $bytes === '') {
    json_out(['success' => false, 'error' => 'Unable to read the uploaded image'], 400);
}

$originalName = (string) ($field['name'] ?? 'cover.jpg');
$base = basename(str_replace('\\', '/', $originalName));
$ext = strtolower(pathinfo($base, PATHINFO_EXTENSION));
if (!in_array($ext, ['jpg', 'jpeg'], true)) {
    $ext = 'jpg';
}
$stem = (string) pathinfo($base, PATHINFO_FILENAME);
$stem = preg_replace('/[^A-Za-z0-9_-]+/', '-', $stem);
$stem = trim((string) $stem, '-_');
if ($stem === '') {
    $stem = 'cover';
}
$stem = substr($stem, 0, 120);

$target = null;
$targetName = null;
for ($i = 0; $i < 10000; $i++) {
    $candidateName = $stem . ($i === 0 ? '' : '-' . $i) . '.' . $ext;
    $candidate = $albumDir . DIRECTORY_SEPARATOR . $candidateName;
    if (file_exists($candidate) || is_link($candidate)) {
        continue;
    }

    $handle = @fopen($candidate, 'xb');
    if ($handle === false) {
        if (file_exists($candidate) || is_link($candidate)) {
            continue;
        }
        json_out(['success' => false, 'error' => 'Unable to store the uploaded image'], 500);
    }

    $written = fwrite($handle, $bytes);
    fclose($handle);

    if ($written !== strlen($bytes)) {
        @unlink($candidate);
        json_out(['success' => false, 'error' => 'Unable to store the uploaded image'], 500);
    }

    @chmod($candidate, 0644);
    $target = $candidate;
    $targetName = $candidateName;
    break;
}

if ($target === null) {
    json_out(['success' => false, 'error' => 'Unable to find a unique file name'], 500);
}

json_out([
    'success' => true,
    'path' => realpath($target) ?: $target,
    'name' => $targetName,
]);
