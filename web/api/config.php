<?php
/**
 * API endpoint: GET /api/config.php
 * Return the application configuration (library path).
 */

require_once __DIR__ . '/bootstrap.php';

json_out([
    'success' => true,
    'library_path' => library_root(),
]);