<?php
/**
 * `wp blame fixture` — export, load and inspect the seeded-database cache.
 *
 * DEV AND CI ONLY. `fixture load` replaces the entire database, and a command
 * that can do that has no business existing in a deployable artifact. Two
 * independent protections:
 *
 *   1. Location. Module 24's image copies wp-content/plugins/blame-the-tech-core
 *      and nothing else, so this directory is not in the build context.
 *   2. The environment bail below, in case somebody edits that Dockerfile.
 *
 * @package Blame\Seeder
 */

declare( strict_types=1 );

namespace Blame\Seeder;

use WP_CLI;

defined( 'ABSPATH' ) || exit;

// The first statement after the guard. wp_get_environment_type() reads the
// WP_ENVIRONMENT_TYPE constant from wp-config.php first, then the environment
// variable. Returning here means the command does not EXIST rather than failing,
// so a confused operator gets "not a registered subcommand" and no workaround.
if ( 'production' === wp_get_environment_type() ) {
	return;
}

// No web surface at all. WP_CLI::add_command() on a web request is a fatal error
// on every URL, including wp-admin — Lesson 04.4.
if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	return;
}

/** The dump's first line. An SQL comment, so `wp db import` ignores it. */
const DIGEST_PREFIX = '-- btt-seed-digest: ';

/**
 * Human-readable output, on STDERR, always.
 *
 * In `export` STDOUT is the dump. WP_CLI::log() and WP_CLI::success() both write
 * to STDOUT, so one stray call puts "Success:" inside your SQL and the import
 * fails hundreds of lines later with a syntax error naming a table.
 */
function note( string $message ): void {
	fwrite( STDERR, '[blame fixture] ' . $message . "\n" );
}

/**
 * The files whose contents define the fixture. Sorted, so the digest does not
 * depend on the order they are listed in here.
 *
 * @return string[]
 */
function seeder_inputs(): array {
	$dir = WP_PLUGIN_DIR . '/blame-the-tech-core/includes/cli';

	$files = array(
		$dir . '/seed.php',
		$dir . '/migrations.php',
		$dir . '/blame-command.php',
	);

	sort( $files );

	return $files;
}

/**
 * sha256 over SEED_VERSION plus the hash of each seeder input.
 *
 * Hashing the CODE, not the data: "is this file intact" is not the question.
 * "Was this dump produced by the seeder I have right now" is, and only the
 * inputs can answer it. SEED_VERSION is read from the plugin's constant rather
 * than from wp_options, so the digest is a pure function of the repository.
 */
function digest(): string {
	$version = defined( 'Blame\Core\CLI\SEED_VERSION' )
		? (string) constant( 'Blame\Core\CLI\SEED_VERSION' )
		: 'unversioned';

	$parts = array( $version );

	foreach ( seeder_inputs() as $file ) {
		if ( ! is_readable( $file ) ) {
			WP_CLI::error( sprintf( 'Cannot read %s, so any digest would be a lie.', $file ) );
		}

		$parts[] = (string) hash_file( 'sha256', $file );
	}

	return hash( 'sha256', implode( "\n", $parts ) );
}

/** Published incidents. The one number worth asserting after an import. */
function incident_count(): int {
	// The import replaced every table under this process's feet.
	wp_cache_flush();

	$counts = wp_count_posts( 'incident' );

	return isset( $counts->publish ) ? (int) $counts->publish : 0;
}

/**
 * Export, load and inspect the seeded-database cache.
 *
 * The seeder is the source of truth; this dump is a cache of its output.
 */
final class Fixture_Command {

	/**
	 * Write the seeded database, prefixed with its digest, to STDOUT.
	 *
	 * ## EXAMPLES
	 *
	 *     # From wordpress-headless/. -T is REQUIRED: a TTY corrupts the stream.
	 *     docker compose run --rm -T wpcli wp blame fixture export > ../fixtures/seeded.sql
	 *
	 * @when after_wp_load
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Associative arguments (none).
	 */
	public function export( array $args, array $assoc_args ): void {
		note( sprintf( 'exporting %d incidents…', incident_count() ) );

		// fwrite + fflush rather than WP_CLI::line(): mysqldump inherits this same
		// descriptor, so the parent must flush before handing it over — otherwise
		// PHP's buffer is emptied AFTER the dump and the digest lands at the end.
		fwrite( STDOUT, DIGEST_PREFIX . digest() . "\n" );
		fflush( STDOUT );

		WP_CLI::runcommand(
			'db export - --add-drop-table',
			array(
				'launch'     => false,
				'return'     => false,
				'exit_error' => true,
			)
		);

		note( 'done. The first line of the dump is its digest.' );
	}

	/**
	 * Replace the entire database with SQL read from STDIN.
	 *
	 * The digest CANNOT be verified here: the dump is a stream, and by the time
	 * this process could read the file it would already have imported it. The
	 * check belongs on the host — see `npm run e2e:reset` and e2e/global-setup.ts.
	 *
	 * ## EXAMPLES
	 *
	 *     docker compose run --rm -T wpcli wp blame fixture load < ../fixtures/seeded.sql
	 *
	 * @when after_wp_load
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Associative arguments (none).
	 */
	public function load( array $args, array $assoc_args ): void {
		// Without this, forgetting `-T` or the `<` redirect leaves the command
		// waiting on a terminal for ever, looking like a hang.
		if ( stream_isatty( STDIN ) ) {
			WP_CLI::error(
				'Nothing is piped to STDIN. Run this as: '
				. 'docker compose run --rm -T wpcli wp blame fixture load < ../fixtures/seeded.sql'
			);
		}

		note( 'importing SQL from STDIN — this replaces every table…' );

		WP_CLI::runcommand(
			'db import -',
			array(
				'launch'     => false,
				'return'     => false,
				'exit_error' => true,
			)
		);

		$count = incident_count();

		if ( 40 !== $count ) {
			WP_CLI::error(
				sprintf(
					'Imported, but there are %d published incidents rather than 40. '
					. 'The dump is not a seeded fixture — re-export it.',
					$count
				)
			);
		}

		WP_CLI::success( sprintf( 'restored: %d incidents.', $count ) );
	}

	/**
	 * Print the digest of the seeder as it exists on disk, one line, on STDOUT.
	 *
	 * Compare it with the dump's first line to decide whether the cache is stale:
	 *
	 *     head -1 ../fixtures/seeded.sql
	 *
	 * ## EXAMPLES
	 *
	 *     docker compose run --rm -T wpcli wp blame fixture status
	 *
	 * @when after_wp_load
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Associative arguments (none).
	 */
	public function status( array $args, array $assoc_args ): void {
		// EXACTLY one line on STDOUT, so `head -1 dump` = `fixture status` is a
		// string comparison a script and a human can both make.
		WP_CLI::line( DIGEST_PREFIX . digest() );

		note( sprintf( 'inputs: %s', implode( ', ', array_map( 'basename', seeder_inputs() ) ) ) );
		note( sprintf( 'this database holds %d published incidents', incident_count() ) );
	}
}

/** Registered from the hook below, never at load time. */
function register(): void {
	WP_CLI::add_command( 'blame fixture', Fixture_Command::class );
}

// mu-plugins load BEFORE regular plugins, so `blame` does not exist yet and
// registering now would create a stray top-level command. WP-CLI fires this hook
// immediately after blame-the-tech-core calls add_command('blame', …).
// Key Concept 6. `wp help blame fixture` is the proof.
WP_CLI::add_hook( 'after_add_command:blame', __NAMESPACE__ . '\\register' );
