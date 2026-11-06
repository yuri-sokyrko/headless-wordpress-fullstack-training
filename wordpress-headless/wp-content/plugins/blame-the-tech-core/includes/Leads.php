<?php
/**
 * The wp_btt_leads custom table.
 *
 * NOT a custom post type, and appendix 03 §5 is the contract for the columns
 * and the two keys. A CPT is one misconfigured show_in_graphql away from
 * publishing every lead; a table WPGraphQL has never heard of cannot leak
 * through a content API by accident. Lesson 16.3 §1.
 *
 * Writes go through the submitHobtLead mutation ONLY. This file owns the
 * schema and the two read helpers, and nothing else.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

/**
 * Bump this whenever the CREATE TABLE statement changes, or ensure_leads_table()
 * will skip the dbDelta() that would apply your change. Same mechanism as
 * ROLES_VERSION in Lesson 03.5, for the same reason.
 */
const LEADS_DB_VERSION = '1';

/**
 * The CREATE TABLE statement, formatted for dbDelta()'s parser.
 *
 * Columns and keys are appendix 03 §5, reproduced here because this is the file
 * that creates them.
 *
 * dbDelta() parses this with regular expressions, not a SQL parser, so the FORM
 * matters. The two rules that break a migration SILENTLY: TWO spaces after
 * PRIMARY KEY, and KEY rather than INDEX with every key named. One field per
 * line and no backticks on field names are the other two. Lowercase types match
 * core's own wp_get_db_schema() convention — modern dbDelta() normalises case
 * itself, so this is house style rather than a trap. Lesson 16.3 §2, and
 * appendix 03 §5 for the full rule set.
 */
function leads_table_schema( string $table, string $charset_collate ): string {
	return "CREATE TABLE {$table} (
		id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
		created_at datetime NOT NULL,
		email varchar(190) NOT NULL,
		full_name varchar(190) NOT NULL,
		company varchar(190) NULL,
		team_size varchar(32) NULL,
		source varchar(64) NOT NULL,
		locale varchar(10) NOT NULL,
		consent tinyint(1) NOT NULL DEFAULT 0,
		ip_hash char(64) NULL,
		user_agent varchar(255) NULL,
		PRIMARY KEY  (id),
		UNIQUE KEY uniq_email_source (email, source),
		KEY idx_created_at (created_at)
	) {$charset_collate};";
}

/**
 * Create or converge the table. Idempotent, and called from Plugin::activate().
 *
 * dbDelta() runs SHOW CREATE TABLE, parses it, diffs it and possibly issues
 * DDL. That is a fine thing to do once per deploy and a terrible thing to do on
 * a page view, so it lives in activation and the version option lets even that
 * be skipped.
 */
function ensure_leads_table(): void {
	if ( get_option( 'btt_leads_db_version' ) === LEADS_DB_VERSION && leads_table_exists() ) {
		return;
	}

	global $wpdb;

	// dbDelta() is not loaded on a normal request.
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';

	dbDelta( leads_table_schema( leads_table(), $wpdb->get_charset_collate() ) );

	// autoload = false: read by activation, never on the request path.
	update_option( 'btt_leads_db_version', LEADS_DB_VERSION, false );
}

/**
 * How many leads came from one source.
 *
 * The one READ in the whole feature, and it is here to be the example: %i is an
 * IDENTIFIER placeholder for the table name, %s is the value, and there is no
 * interpolated SQL string anywhere in this function. %i needs WordPress 6.2+.
 */
function leads_count_by_source( string $source ): int {
	global $wpdb;

	return (int) $wpdb->get_var(
		$wpdb->prepare(
			'SELECT COUNT(*) FROM %i WHERE source = %s',
			leads_table(),
			$source
		)
	);
}
