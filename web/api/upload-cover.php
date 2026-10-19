<?php
/**
 * API endpoint: POST /api/upload-cover.php
 *
 * Accepts a single cover image uploaded from the client (multipart/form-data,
 * field name "cover") and stores it as a temporary JPEG inside the configured
 * music library, then returns its absolute path.
 *
 * Why the file is written inside the library:
 * bulk-update.php validates the "cover" argument with resolve_in_library(),
 * which only accepts paths that already exist inside a library root. Storing
 * the upload under "<root>/.covers/" keeps the existing security checks
 * untouched instead of widening the paths accepted by the API. With several
 * mounts the first WRITABLE root is used, so a read-only secondary mount never
 * breaks the bulk cover upload. The directory name starts with a dot and
 * find_covers() only scans the folder of each audio file, so these temporary
 * images are never offered as source covers nor modified by the application.
 *
 * Response: { success:true, path:"/abs/path.jpg", name:"original.jpg" }
 *           { success:false, error:"..." }
 */

require_once __DIR__ . '/bootstrap.php';

const COVER_UPLOAD_DIRNAME = '.covers';
const COVER_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;   // 10 MB
const COVER_UPLOAD_MAX_AGE = 86400;                 // remove leftovers older than 24h

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
if ((int) $field['size'] <= 0 || (int) $field['size'] > COVER_UPLOAD_MAX_BYTES) {
    json_out(['success' => false, 'error' => 'The image is empty or too large (max 10 MB)'], 400);
}

$root = cover_storage_root();
if ($root === null) {
    json_out(['success' => false, 'error' => 'No library configured: cannot store the cover'], 400);
}

$uploadDir = rtrim($root, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . COVER_UPLOAD_DIRNAME;
if (!is_dir($uploadDir) && !@mkdir($uploadDir, 0777, true) && !is_dir($uploadDir)) {
    json_out(['success' => false, 'error' => 'Unable to create the temporary cover folder'], 500);
}
$realUploadDir = realpath($uploadDir);
if ($realUploadDir === false || resolve_in_library($realUploadDir) === null) {
    json_out(['success' => false, 'error' => 'Temporary cover folder is not inside the library'], 500);
}

// Only JPEG is supported by the Python core (COVER_EXTS = .jpg / .jpeg).
$allowedMime = ['image/jpeg', 'image/jpg', 'image/pjpeg'];
$mime = '';
if (function_exists('finfo_open')) {
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    if ($finfo !== false) {
        $mime = (string) finfo_file($finfo, $field['tmp_name']);
        // Nessun finfo_close(): deprecated da PHP 8.1 e l'oggetto viene liberato automaticamente.
    }
}
if ($mime !== '' && !in_array(strtolower($mime), $allowedMime, true)) {
    json_out(['success' => false, 'error' => 'Only JPEG images are supported (detected: ' . $mime . ')'], 400);
}

// Authoritative check: the bytes must really be a JPEG image.
$info = @getimagesize($field['tmp_name']);
if ($info === false || empty($info['mime']) || strtolower((string) $info['mime']) !== 'image/jpeg') {
    json_out(['success' => false, 'error' => 'The selected file is not a valid JPEG image'], 400);
}

// Random name: never reuse the client filename on disk.
$target = $realUploadDir . DIRECTORY_SEPARATOR . bin2hex(random_bytes(16)) . '.jpg';
if (!move_uploaded_file($field['tmp_name'], $target)) {
    json_out(['success' => false, 'error' => 'Unable to store the uploaded image'], 500);
}
@chmod($target, 0644);

// Best-effort cleanup of leftovers from previous sessions.
$now = time();
foreach ((array) @scandir($realUploadDir) as $entry) {
    if ($entry === '.' || $entry === '..' || $entry === basename($target)) {
        continue;
    }
    $candidate = $realUploadDir . DIRECTORY_SEPARATOR . $entry;
    if (is_file($candidate) && ($now - (int) @filemtime($candidate)) > COVER_UPLOAD_MAX_AGE) {
        @unlink($candidate);
    }
}

json_out([
    'success' => true,
    'path' => $target,
    'name' => (string) ($_FILES['cover']['name'] ?? basename($target)),
]);