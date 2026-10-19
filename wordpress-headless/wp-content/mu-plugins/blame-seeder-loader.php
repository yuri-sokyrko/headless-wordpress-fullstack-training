<?php
/**
 * Plugin Name: Blame Seeder Loader
 * Description: Loads the dev/CI fixture commands. mu-plugins does not recurse into directories.
 *
 * @package Blame\Seeder
 */

declare(strict_types=1);

defined('ABSPATH') || exit;

$btt_seeder = __DIR__ . '/blame-seeder/blame-seeder.php';

// A guard, not an optimisation: this directory is excluded from the production
// image, so on a host where the exclusion worked the require would be fatal.
if(is_readable($btt_seeder)) {
	require_once $btt_seeder;
}
