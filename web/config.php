<?php
/**
 * Audio Manager - Configuration loader
 *
 * This file is portable and safe to commit to version control.
 * It loads an optional local configuration file (web/config.local.php,
 * which is Git-ignored) and otherwise falls back to environment variables.
 *
 * Precedence:
 *   1. web/config.local.php          (local, not committed)
 *   2. AUDIO_LIBRARY_OVERRIDE        (environment variable)
 *   3. empty value                   (the path can be typed in the web UI)
 *
 * To set a fixed music library, copy web/config.example.php to
 * web/config.local.php and edit the path, or export:
 *
 *   export AUDIO_LIBRARY_OVERRIDE=/path/to/your/music
 */

$localConfigFile = __DIR__ . '/config.local.php';

if (is_file($localConfigFile)) {
    require_once $localConfigFile;
}

if (!defined('AUDIO_LIBRARY_PATH')) {
    $envOverride = getenv('AUDIO_LIBRARY_OVERRIDE');
    if ($envOverride) {
        $resolved = realpath($envOverride);
        define('AUDIO_LIBRARY_PATH', $resolved !== false ? $resolved : $envOverride);
    } else {
        define('AUDIO_LIBRARY_PATH', '');
    }
}