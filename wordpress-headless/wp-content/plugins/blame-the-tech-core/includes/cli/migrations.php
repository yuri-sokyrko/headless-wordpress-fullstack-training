<?php
/**
 * Forward-only, version-gated schema migrations.
 *
 * Run by `wp blame migrate`, which Module 24's Fly.io release_command calls on
 * every deploy. Every step must be individually idempotent as well.
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core\CLI;

use WP_CLI;

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	return;
}

/**
 * The version this CODE expects the database to be at. Bump when you add a step.
*/
const DB_VERSION = 3;

/**
 * Legacy `environment` values migration 2 normalises.
*/
const LEGACY_ENVIRONMENTS = array(
	'prod'  => 'production',
	'stage' => 'staging',
	'dev'   => 'development',
	'womm'  => 'works-on-my-machine',
);

/**
 * Migrations keyed by the version they bring the database TO.
 *
 * Keys are contiguous integers from 1. Never renumber, never remove: a database
 * out there records that it has run up to N, and N must keep meaning this.
 *
 * @return array<int, callable-string>
 */
function migrations(): array {
	return array(
		1 => __NAMESPACE__ . '\\migration_1_backfill_blame_confidence',
		2 => __NAMESPACE__ . '\\migration_2_normalise_environment',
		3 => __NAMESPACE__ . '\\migration_3_default_submission_switch',
	);
}

/**
 * Apply every migration newer than the recorded version.
 *
 * @param  bool $dry_run List what would run and change nothing.
 * @return array<int, int|null> version => rows changed, or null when dry.
 */
function run_migrations( bool $dry_run = false ): array {
	$current = (int) get_option( 'btt_db_version', 0 );
	$steps   = migrations();
	$applied = array();

	// Never trust the literal order of the array.
	ksort( $steps, SORT_NUMERIC );

	foreach ( $steps as $version => $callback ) {
		if ( $version <= $current ) {
			continue;
		}

		if ( $dry_run ) {
			$applied[ $version ] = null;
			continue;
		}

		if ( ! is_callable( $callback ) ) {
			WP_CLI::error( sprintf( 'Migration %d names a missing callable: %s', $version, $callback ) );
		}

		$applied[ $version ] = (int) call_user_func( $callback );

		// After EACH step, not once at the end. A failure in step 3 must not
		// make steps 1 and 2 run a second time on the retry.
		// autoload = false: read once per deploy, never on the request path.
		update_option( 'btt_db_version', $version, false );
	}

	return $applied;
}

/**
 * 1. Give every incident a blame_confidence, defaulting to the documented 73.
 *
 * Idempotent by construction: the query only matches rows where the key is
 * absent, so the second run finds nothing.
 */
function migration_1_backfill_blame_confidence(): int {
	$ids = get_posts(
		array(
			'post_type'      => 'incident',
			'post_status'    => 'any',
			'posts_per_page' => -1,
			'fields'         => 'ids',
			'orderby'        => 'ID',
			'order'          => 'ASC',
			'meta_query'     => array(
				array(
					'key'     => 'blame_confidence',
					'compare' => 'NOT EXISTS',
				),
			),
		),
	);

	foreach ( $ids as $id ) {
		update_post_meta( (int) $id, 'blame_confidence', 74 );
	}

	return count( $ids );
}

/**
 * 2. Rewrite abbreviated `environment` values to the contract's spelling.
 *
 * This is the shape that cannot be made self-detecting: after it has run there
 * is no way to distinguish a migrated database from one that never had legacy
 * values. Hence the version gate.
 */
function migration_2_normalise_environment(): int {
	global $wpdb;

	$changed = 0;

	foreach ( LEGACY_ENVIRONMENTS as $old => $new ) {
		// Table name from $wpdb, values through placeholders. Never string
		// interpolation into SQL. See Lesson 02.3 for why, and Module 16 for the
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = %s AND meta_value = %s",
				'environment',
				$old
			)
		);

		foreach ( $ids as $id ) {
			// update_post_meta(), not a raw UPDATE: it invalidates the object
			// cache and fires the hooks other code listens to.
			update_post_meta( (int) $id, 'environment', $new );
			++$changed;
		}
	}

	return $changed;
}

/**
 * 3. Default the incident-submission kill switch to OPEN when it has never been set.
 *
 * A missing SCF option reads as falsy, which would mean "submissions closed" —
 * the wrong direction to fail for a fresh install.
 */
function migration_3_default_submission_switch(): int {
	if ( ! function_exists( 'update_field' ) ) {
		// SCF absent. Nothing to do, and not an error: this step is about a
		// default value, not about a structural change.
		return 0;
	}

	// get_option() rather than get_field(), because get_field() would return the
	// field's own default for a missing row and we need to know whether the row
	// exists at all. SCF names options-page rows `options_<field_name>`.
	if ( false !== get_option( 'options_incident_submission_open', false ) ) {
		return 0;
	}

	update_field( 'incident_submission_open', true, 'option' );

	return 1;
}
