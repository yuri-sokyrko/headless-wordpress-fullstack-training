<?php

/**
 * The `wp blame` command namespace.
 *
 * Loaded ONLY under WP-CLI. See Plugin::CLI_INCLUDES and the guard below.
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core\CLI;

use WP_CLI;

defined('ABSPATH') || exit;

/*
 * Second lock. Plugin::boot() already gates CLI_INCLUDES on this condition, but
 * a file under includes/ is one careless `require` away from a web request, and
 * `WP_CLI::add_command()` on a web request is a fatal error on every URL — wp-admin
 * included, so you cannot get in to fix it. Three lines, outage becomes no-op.
 *
 * Truthiness as well as existence: some tooling defines WP_CLI as false.
 */
if (!defined('WP_CLI') || !WP_CLI) {
	return;
}

/**
 * Manage Blame The Tech fixture content, settings and schema migrations.
 *
 * Every subcommand here is designed to be safe to run twice. The Fly.io
 * release_command in Module 24 runs some of them on every single deploy.
 */
final class Blame_Command
{
	/**
	 * Report content counts and the current schema version.
	 *
	 * Read-only, and the first thing to run when something looks wrong: it
	 * answers "is the database populated" and "which migrations have run" in
	 * one call.
	 *
	 * ## OPTIONS
	 *
	 * [--porcelain]
	 * : Print one tab-separated line, in a fixed column order, with no header.
	 * For scripts. Column order is: incidents, tech_reviews, posts, pages,
	 * media, users, scapegoat_terms, severity_terms, db_version.
	 *
	 * [--format=<format>]
	 * : Render the table in a particular format. Ignored with --porcelain.
	 * ---
	 * default: table
	 * options:
	 *   - table
	 *   - json
	 *   - csv
	 *   - yaml
	 * ---
	 *
	 * ## EXAMPLES
	 *
	 *     # Human output
	 *     wp blame status
	 *
	 *     # How many incidents, for a script
	 *     wp blame status --porcelain | cut -f1
	 *
	 *     # Feed a CI assertion
	 *     wp blame status --format=json
	 *
	 * @when after_wp_load
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Associative arguments.
	 */
	public function status(array $args, array $assoc_args): void
	{
		$counts = self::counts();

		if (\WP_CLI\Utils\get_flag_value($assoc_args, 'porcelain', false)) {
			// Values only, in the documented order. array_values() is safe here
			// because self::counts() builds the array in a fixed order.
			WP_CLI::line(implode("\t", array_values($counts)));

			return;
		}

		$rows = array();
		foreach ($counts as $item => $count) {
			$rows[] = array(
				'item'  => $item,
				'count' => $count,
			);
		}

		\WP_CLI\Utils\format_items(
			(string) \WP_CLI\Utils\get_flag_value($assoc_args, 'format', 'table'),
			$rows,
			array('item', 'count')
		);
	}

	/**
	 * Populate the database with deterministic fixture content.
	 *
	 * Not implemented yet — Lesson 04.5 builds this. It exits 0 with a warning
	 * rather than an error, because "did nothing" is not a failure and a
	 * release_command should not be blocked by a stub.
	 *
	 * ## OPTIONS
	 *
	 * [--fresh]
	 * : Delete existing fixture content before seeding. Development and CI only.
	 *
	 * [--yes]
	 * : Skip the confirmation prompt that --fresh triggers.
	 *
	 * ## EXAMPLES
	 *
	 *     wp blame seed
	 *     wp blame seed --fresh --yes
	 *
	 * @when after_wp_load
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Associative arguments.
	 */
	public function seed(array $args, array $assoc_args): void
	{
		// Same namespace, so the function resolves without a `use`.
		seed_all($assoc_args);
	}

	/**
	 * Delete every fixture item this project created. DESTRUCTIVE.
	 *
	 * ## OPTIONS
	 *
	 * [--yes]
	 * : Skip the confirmation prompt. Mandatory in CI, where there is no TTY.
	 *
	 * ## EXAMPLES
	 *
	 *     wp blame reset
	 *     wp blame reset --yes
	 *
	 * @when after_wp_load
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Associative arguments.
	 */
	public function reset(array $args, array $assoc_args): void
	{
		WP_CLI::confirm(
			'This force-deletes every seeded incident, review, post, page and media item. Continue?',
			$assoc_args
		);

		WP_CLI::success(sprintf('removed %d items', reset_seeded()));
	}

	/**
	 * Create and configure the languages this project needs.
	 *
	 * Errors when Polylang is absent, which is the correct behaviour for a step
	 * a release depends on: silently skipping it would ship a site with no
	 * languages and a green deploy.
	 *
	 * ## EXAMPLES
	 *
	 *     wp blame ensure-languages
	 *
	 * @subcommand ensure-languages
	 * @when after_wp_load
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Associative arguments.
	 */
	public function ensure_languages(array $args, array $assoc_args): void
	{
		if (! function_exists('pll_languages_list')) {
			// Exits 1. This is the line that stops a deploy.
			WP_CLI::error('Polylang is not active. Language setup arrives in Module 20.');
		}

		WP_CLI::warning('wp blame ensure-languages is a stub. Module 20 implements it.');
	}

	/**
	 * Apply every schema migration that has not run yet.
	 *
	 * Forward only. To undo something, add a new migration.
	 *
	 * ## OPTIONS
	 *
	 * [--dry-run]
	 * : List what would run, and change nothing.
	 *
	 * ## EXAMPLES
	 *
	 *     wp blame migrate --dry-run
	 *     wp blame migrate
	 *
	 * @when after_wp_load
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Associative arguments.
	 */
	public function migrate(array $args, array $assoc_args): void
	{
		$dry_run = (bool) \WP_CLI\Utils\get_flag_value($assoc_args, 'dry-run', false);
		$from    = (int) get_option('btt_db_version', 0);

		if ($from > DB_VERSION) {
			// The database has seen a newer deploy than this code. Rolling the
			// code back does not roll the data back — say so rather than
			// pretending everything is fine.
			WP_CLI::warning(
				sprintf('Database is at version %d but this code expects %d.', $from, DB_VERSION)
			);
		}

		$applied = run_migrations($dry_run);

		if (array() === $applied) {
			WP_CLI::success(sprintf('Database is at version %d. Nothing to do.', $from));

			return;
		}

		foreach ($applied as $version => $changed) {
			WP_CLI::log(
				$dry_run
					? sprintf('pending: migration %d', $version)
					: sprintf('migration %d: %d row(s) changed', $version, (int) $changed)
			);
		}

		WP_CLI::success(
			$dry_run
				? sprintf('%d migration(s) pending.', count($applied))
				: sprintf('Database is now at version %d.', DB_VERSION)
		);
	}

	/**
	 * Content counts, in the fixed order --porcelain documents.
	 *
	 * Private, so WP-CLI does not turn it into a subcommand.
	 *
	 * @return array<string, int>
	 */
	private static function counts(): array
	{
		$published = static function (string $post_type): int {
			$counts = wp_count_posts($post_type);

			return (int) ($counts->publish ?? 0);
		};

		$terms = static function (string $taxonomy): int {
			$total = wp_count_terms(
				array(
					'taxonomy'   => $taxonomy,
					'hide_empty' => false,
				)
			);

			return is_wp_error($total) ? 0 : (int) $total;
		};

		// Attachments live under the `inherit` status, not `publish`.
		$media = wp_count_posts('attachment');

		return array(
			'incidents'       => $published('incident'),
			'tech_reviews'    => $published('tech_review'),
			'posts'           => $published('post'),
			'pages'           => $published('page'),
			'media'           => (int) ($media->inherit ?? 0),
			'users'           => (int) count_users()['total_users'],
			'scapegoat_terms' => $terms('scapegoat'),
			'severity_terms'  => $terms('severity'),
			'db_version'      => (int) get_option('btt_db_version', 0),
		);
	}
}

WP_CLI::add_command(
	'blame',
	Blame_Command::class,
	array('shortdesc' => 'Manage Blame The Tech fixture content and schema migrations.')
);
