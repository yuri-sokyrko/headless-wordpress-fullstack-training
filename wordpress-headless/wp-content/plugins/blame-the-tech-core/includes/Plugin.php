<?php

/**
 * Plugin bootstrap and lifecycle.
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core;

defined('ABSPATH') || exit;

/**
 * Loads every registration file and owns the three lifecycle hooks.
 *
 * Deliberately not a singleton. There is no instance state to protect, so
 * `get_instance()` would be ceremony. Static methods are honest about that.
 */
final class Plugin
{
	/**
	 * Procedural registration files, required on every request in this order.
	 *
	 * Each later lesson in Modules 03 and 04 adds exactly one line here.
	 *
	 * @var string[]
	 */
	private const INCLUDES = array(
		'includes/post-types.php',
		// 'includes/taxonomies.php',   ← Lesson 03.3
		// 'includes/statuses.php',     ← Lesson 03.4
		// 'includes/roles.php',        ← Lesson 03.5
	);

	/**
	 * Files loaded only under WP-CLI. Lesson 04.4 fills this in.
	 *
	 * @var string[]
	 */
	private const CLI_INCLUDES = array();

	/**
	 * Wire the plugin up. Called at plugin-load time, before `init`.
	 */

	public static function boot(): void
	{
		foreach (self::INCLUDES as $file) {
			require_once PLUGIN_DIR . '/' . $file;
		}

		if (defined('WP_CLI') && WP_CLI) {
			foreach (self::CLI_INCLUDES as $file) {
				require_once PLUGIN_DIR . '/' . $file;
			}
		}
	}

	/**
	 * Runs on activation — which, in this project, means on every deploy.
	 *
	 * `init` has NOT fired for this plugin in this request, so anything that
	 * depends on a registration has to trigger that registration itself.
	 * Every statement here must be safe to run again.
	 */
	public static function activate(): void
	{
		register_post_types();
		grant_incident_caps_to_core_roles();
		ensure_permalink_structure();
		// Later lessons add their calls here, above the flush:
		//   03.3  register_taxonomies();  seed_default_terms();
		//   03.5  register_reporter_role();

		// LAST. Everything that adds a rewrite rule must already have run.
		flush_rewrite_rules();

		// autoload = false: this is read by the migration runner, not on the
		// request path. Lesson 02.3 explains why that third argument matters.
		update_option('btt_core_version', VERSION, false);
	}

	/**
	 * Runs on deactivation. Deactivation is not deletion — remove nothing a
	 * user would miss.
	 */
	public static function deactivate(): void
	{
		// Soft flush. The plugin is still loaded right now, so
		// flush_rewrite_rules() would rebuild the rule set *including* our own
		// rules. Deleting the option lets WordPress rebuild it on the next
		// request from whatever is actually registered then.
		delete_option('rewrite_rules');
	}
}
