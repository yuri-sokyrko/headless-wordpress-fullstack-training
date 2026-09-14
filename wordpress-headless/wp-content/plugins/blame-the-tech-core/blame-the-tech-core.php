<?php

/**
 * Plugin Name: Blame The Tech - Core
 * Description: Post types, taxonomies, statuses, roles, ACF loading, GraphQL extensions and the `wp blame`,
 * Version: 0.1.0
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * Author: Blame The Tech
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * TextDomain: blame-the-tech-core
 * Domain Path: /languages
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core;

// Direct access to a PHP file inside wp-content must not execute anything.
defined('ABSPATH') || exit;

const VERSION = '0.1.0';
const PLUGIN_FILE = __FILE__;
const PLUGIN_DIR = __DIR__;

$btt_autoload = __DIR__ . '/vendor/autoload.php';

// vendor/ is gitignored, so a fresh clone has no autoloader until someone runs
// `composer install`. Fail with a sentence that says what to type, not a fatal.
if (!is_readable($btt_autoload)) {
	add_action('admin_notices', static function (): void {
		printf(
			'<div class="notice notice-error"><p><strong>%s</strong> %s</p></div>',
			esc_html__('Blame The Tech Core is not loaded.', 'blame-the-tech-core'),
			esc_html__(
				'vendor/autoload.php is missing. Run: docker compose run --rm composer install',
				'blame-the-tech-core'
			)
		);
	});

	return;
}

require_once $btt_autoload;

Plugin::boot();

// These take the MAIN plugin file. Passing __FILE__ from inside includes/ is a
// classic and silent mistake: the hook name would not match and nothing fires.
register_activation_hook(PLUGIN_FILE, array(Plugin::class, 'activate'));
register_deactivation_hook(PLUGIN_FILE, array(Plugin::class, 'deactivate'));
