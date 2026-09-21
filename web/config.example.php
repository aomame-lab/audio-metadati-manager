<?php
/**
 * Audio Metadati Manager - Example local configuration
 *
 * Copy this file to web/config.local.php and set the path of your music
 * library:
 *
 *   cp web/config.example.php web/config.local.php
 *
 * The file web/config.local.php is ignored by Git and will not be
 * committed to the repository.
 *
 * Alternatively you can use the environment variable instead of editing
 * a file (useful for scripts and containers):
 *
 *   export AUDIO_LIBRARY_OVERRIDE=/path/to/your/music
 *
 * If neither this file nor the environment variable is set, the
 * application starts with an empty library and you can type a path
 * directly in the web interface.
 */

define('AUDIO_LIBRARY_PATH', '/path/to/your/music');