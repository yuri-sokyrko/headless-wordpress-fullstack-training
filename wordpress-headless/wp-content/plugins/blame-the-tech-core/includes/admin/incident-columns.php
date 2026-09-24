<?php
/**
 * The incidents list table: columns, sorting, filtering and moderation actions.
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

add_filter( 'manage_incident_posts_columns', __NAMESPACE__ . '\\incident_columns' );
add_action( 'manage_incident_posts_custom_column', __NAMESPACE__ . '\\render_incident_column', 10, 2 );
add_filter( 'manage_edit-incident_sortable_columns', __NAMESPACE__ . '\\incident_sortable_columns' );
add_action( 'pre_get_posts', __NAMESPACE__ . '\\order_incidents_by_meta' );
add_filter( 'posts_clauses', __NAMESPACE__ . '\\order_incidents_by_taxonomy', 10, 2 );
add_action( 'restrict_manage_posts', __NAMESPACE__ . '\\render_scapegoat_filter' );
add_filter( 'post_row_actions', __NAMESPACE__ . '\\incident_row_actions', 10, 2 );
add_action( 'admin_post_btt_approve_incident', __NAMESPACE__ . '\\handle_approve_incident' );
add_filter( 'bulk_actions-edit-incident', __NAMESPACE__ . '\\incident_bulk_actions' );
add_filter( 'handle_bulk_actions-edit-incident', __NAMESPACE__ . '\\handle_incident_bulk_action', 10, 3 );
add_action( 'admin_notices', __NAMESPACE__ . '\\incident_admin_notices' );

/**
 * Add two columns after the title. Severity and Scapegoat are already there,
 * courtesy of `show_admin_column` in Lesson 03.3.
 *
 * @param array<string, string> $columns Existing columns.
 */
function incident_columns( array $columns ): array {
	$out = array();

	foreach ( $columns as $key => $label ) {
		$out[ $key ] = $label;
		if ( 'title' === $key ) {
			$out['btt_downtime'] = __( 'Downtime', 'blame-the-tech-core' );
			$out['btt_verified'] = __( 'Verified', 'blame-the-tech-core' );
		}
	}

	return $out;
}

/**
 * Render one cell. This ECHOES, so everything is escaped here.
 */
function render_incident_column( string $column, int $post_id ): void {
	if ( 'btt_downtime' === $column ) {
		echo esc_html( sprintf( '%d min', (int) get_post_meta( $post_id, 'downtime_minutes', true ) ) );
	}
	if ( 'btt_verified' === $column ) {
		echo get_post_meta( $post_id, 'is_verified', true )
		? esc_html__( 'yes', 'blame-the-tech-core' )
		: esc_html__( '—', 'blame-the-tech-core' );
	}
}

/**
 * Which columns are clickable, and the `orderby` value each one sends.
 */
function incident_sortable_columns( array $columns ): array {
	$columns['taxonomy-severity']  = 'severity';
	$columns['taxonomy-scapegoat'] = 'scapegoat';
	$columns['btt_downtime']       = 'downtime_minutes';
	return $columns;
}

/**
 * True only for the incidents list table in wp-admin.
 */
function is_incident_admin_query( \WP_Query $query ): bool {
	return is_admin() && $query->is_main_query() && 'incident' === $query->get( 'post_type' );
}

/**
 * Sorting by a scalar is `meta_key` plus `meta_value_num`. Nothing exotic.
 */
function order_incidents_by_meta( \WP_Query $query ): void {
	if ( is_incident_admin_query( $query ) && 'downtime_minutes' === $query->get( 'orderby' ) ) {
		$query->set( 'meta_key', 'downtime_minutes' );
		$query->set( 'orderby', 'meta_value_num' );
	}
}

/**
 * Sorting by a TAXONOMY needs the join WP_Query will not write for you: the
 * three-table join from Lesson 03.3 §1, by hand. Ordering on `btt_t.slug` is
 * why the severity slugs are prefixed s1- to s4-.
 *
 * @param array<string, string> $clauses SQL clauses.
 * @param \WP_Query             $query   The query.
 */
function order_incidents_by_taxonomy( array $clauses, \WP_Query $query ): array {
	if ( ! is_incident_admin_query( $query ) ) {
		return $clauses;
	}

	$orderby = (string) $query->get( 'orderby' );

	// An allowlist, not a sanitiser: only these two strings ever reach SQL.
	if ( ! in_array( $orderby, array( 'severity', 'scapegoat' ), true ) ) {
		return $clauses;
	}

	global $wpdb;

	$clauses['join'] .= " LEFT JOIN {$wpdb->term_relationships} AS btt_tr ON btt_tr.object_id = {$wpdb->posts}.ID"
	. " LEFT JOIN {$wpdb->term_taxonomy} AS btt_tt ON btt_tt.term_taxonomy_id = btt_tr.term_taxonomy_id"
	. " LEFT JOIN {$wpdb->terms} AS btt_t ON btt_t.term_id = btt_tt.term_id";

	// Even an allowlisted value goes through prepare(). No exceptions, ever.
	$clauses['where'] .= $wpdb->prepare( ' AND ( btt_tt.taxonomy = %s OR btt_tt.taxonomy IS NULL )', $orderby );
	// Without this, a post with two terms appears twice in the list.
	$clauses['groupby'] = "{$wpdb->posts}.ID";
	$clauses['orderby'] = 'btt_t.slug ' . ( 'asc' === strtolower( (string) $query->get( 'order' ) ) ? 'ASC' : 'DESC' );

	return $clauses;
}

/**
 * A scapegoat dropdown above the list. `WP_Query` already understands a query
 * var named after the taxonomy, so no `pre_get_posts` handling is needed.
 */
function render_scapegoat_filter( string $post_type ): void {
	if ( 'incident' !== $post_type ) {
		return;
	}

	// A read-only list filter: it changes no state, so it needs no nonce.
	wp_dropdown_categories(
		array(
			'taxonomy'        => 'scapegoat',
			'name'            => 'scapegoat',
			'value_field'     => 'slug',
			'show_option_all' => __( 'All scapegoats', 'blame-the-tech-core' ),
			'selected'        => isset( $_GET['scapegoat'] ) ? sanitize_key( wp_unslash( $_GET['scapegoat'] ) ) : '',
			'hierarchical'    => false,
			'hide_empty'      => false,
		)
	);
}

/**
 * An "Approve" row action, on pending incidents only.
 */
function incident_row_actions( array $actions, \WP_Post $post ): array {
	if ( 'incident' !== $post->post_type || 'pending' !== $post->post_status ) {
		return $actions;
	}

	if ( ! current_user_can( 'publish_incidents' ) || ! current_user_can( 'edit_post', $post->ID ) ) {
		return $actions;
	}

	$args = array(
		'action' => 'btt_approve_incident',
		'post'   => $post->ID,
	);
	$url  = wp_nonce_url(
		add_query_arg( $args, admin_url( 'admin-post.php' ) ),
		'btt_approve_incident_' . $post->ID
	);

	$actions['btt_approve'] = sprintf( '<a href="%s">%s</a>', esc_url( $url ), esc_html__( 'Approve', 'blame-the-tech-core' ) );

	return $actions;
}

/**
 * Publish one incident and mark it verified. Callers check capabilities.
 */
function approve_incident( int $post_id ): bool {
	$post = get_post( $post_id );

	if ( ! $post instanceof \WP_Post || 'incident' !== $post->post_type ) {
		return false;
	}

	$result = wp_update_post(
		array(
			'ID'          => $post_id,
			'post_status' => 'publish',
		),
		true
	);
	if ( is_wp_error( $result ) ) {
		return false;
	}

	// A direct meta write bypasses the auth_callback, which is correct here:
	// the capability was checked by the caller, and this is server-side code
	// recording a moderation fact, not a client supplying a value.
	update_post_meta( $post_id, 'is_verified', true );

	return true;
}

/**
 * The single-row Approve link. Nonce first, capability second, work third.
 */
function handle_approve_incident(): void {
	$post_id = isset( $_GET['post'] ) ? absint( wp_unslash( $_GET['post'] ) ) : 0;

	check_admin_referer( 'btt_approve_incident_' . $post_id ); // dies on failure

	if ( 0 === $post_id || ! current_user_can( 'publish_incidents' ) || ! current_user_can( 'edit_post', $post_id ) ) {
		wp_die( esc_html__( 'Not allowed.', 'blame-the-tech-core' ), '', array( 'response' => 403 ) );
	}

	$done = approve_incident( $post_id ) ? 1 : 0;
	wp_safe_redirect( add_query_arg( 'btt_approved', $done, admin_url( 'edit.php?post_type=incident' ) ) );
	exit;
}

/**
 * The matching bulk action, for working forty submissions at once.
 */
function incident_bulk_actions( array $actions ): array {
	if ( current_user_can( 'publish_incidents' ) ) {
		$actions['btt_approve'] = __( 'Approve (publish)', 'blame-the-tech-core' );
	}
	return $actions;
}

/**
 * WordPress has already verified the bulk-action nonce before this filter runs,
 * so the only check left is the capability — per row, not once for the batch.
 *
 * @param string $redirect_to Where to send the user next.
 * @param string $action      The chosen bulk action.
 * @param int[]  $post_ids    Selected post IDs.
 */
function handle_incident_bulk_action( string $redirect_to, string $action, array $post_ids ): string {
	if ( 'btt_approve' !== $action || ! current_user_can( 'publish_incidents' ) ) {
		return $redirect_to;
	}

	$done = 0;
	foreach ( $post_ids as $post_id ) {
		if ( current_user_can( 'edit_post', (int) $post_id ) && approve_incident( (int) $post_id ) ) {
			++$done;
		}
	}

	return add_query_arg( 'btt_approved', $done, $redirect_to );
}

/**
 * Report the result of a row action or a bulk action.
 */
function incident_admin_notices(): void {
	if ( ! isset( $_GET['btt_approved'] ) ) {
		return;
	}

	$count = absint( wp_unslash( $_GET['btt_approved'] ) );

	/* translators: %d: number of incidents approved. */
	$text = sprintf( _n( '%d incident approved.', '%d incidents approved.', $count, 'blame-the-tech-core' ), $count );

	printf( '<div class="notice notice-success is-dismissible"><p>%s</p></div>', esc_html( $text ) );
}
