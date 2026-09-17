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
		'includes/taxonomies.php',
		'includes/statuses.php',
		'includes/admin/incident-columns.php',
		'includes/roles.php',
		'includes/acf.php',
	);

	/**
	 * Files loaded only under WP-CLI.
	 *
	 * @var string[]
	 */
	private const CLI_INCLUDES = array(
		'includes/cli/migrations.php',
		'includes/cli/seed.php',
		'includes/cli/blame-command.php',
	);

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

		register_taxonomies();
		seed_default_terms();

		grant_incident_caps_to_core_roles();

		ensure_reporter_role();
		close_wp_registration();

		ensure_permalink_structure();

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
		// Our capabilities on core roles are ours to clean up.
		revoke_incident_caps_from_core_roles();

		// `incident_reporter` is deliberately LEFT IN PLACE — users hold it.
		// It is removed in uninstall.php, after reassigning those users.

		// Soft flush. The plugin is still loaded right now, so
		// flush_rewrite_rules() would rebuild the rule set *including* our own
		// rules. Deleting the option lets WordPress rebuild it on the next
		// request from whatever is actually registered then.
		delete_option('rewrite_rules');
	}
}
