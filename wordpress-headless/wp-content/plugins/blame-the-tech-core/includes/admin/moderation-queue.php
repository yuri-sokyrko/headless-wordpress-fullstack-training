<?php
/**
 * The incident moderation queue.
 *
 * EXTENDS includes/admin/incident-columns.php (Lesson 03.4), which already owns
 * the columns, the sortable headers, the scapegoat filter, the Approve row
 * action and its handler. This file adds the four things that did not exist:
 * a pending-by-default queue view, moderation column ORDER, a Reject action,
 * and the reporter notification on transition. Lesson 16.4 §1.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

add_action( 'pre_get_posts', __NAMESPACE__ . '\\default_incident_queue_to_pending' );
add_filter( 'manage_incident_posts_columns', __NAMESPACE__ . '\\promote_moderation_columns', 20 );
add_action( 'manage_incident_posts_custom_column', __NAMESPACE__ . '\\render_reporter_column', 10, 2 );
add_filter( 'post_row_actions', __NAMESPACE__ . '\\incident_reject_row_action', 20, 2 );
add_action( 'admin_post_btt_reject_incident', __NAMESPACE__ . '\\handle_reject_incident' );
add_action( 'transition_post_status', __NAMESPACE__ . '\\notify_reporter_on_transition', 10, 3 );

/**
 * Default the incident list to `pending` for anyone who can publish.
 *
 * This IS the queue: no new screen, no new menu item, no second list table.
 * The "All (n)" link at the top of the screen still works, so the default is a
 * starting point rather than a filter you have to defeat.
 *
 * `is_incident_admin_query()` is Lesson 03.4's helper and does the is_admin(),
 * is_main_query() and post_type checks in one place.
 */
function default_incident_queue_to_pending( \WP_Query $query ): void {
	if ( ! is_incident_admin_query( $query ) ) {
		return;
	}

	// A reporter never reaches wp-admin (03.5), and an author with no
	// publishing capability has no queue to work.
	if ( ! current_user_can( 'publish_incidents' ) ) {
		return;
	}

	// Respect any explicit choice the editor made. `all_posts` is what the
	// "All" status link sends; `post_status` is every other link; `s` is a
	// search, which must never be scoped to one status silently.
	// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only list filters.
	if ( isset( $_GET['post_status'] ) || isset( $_GET['all_posts'] ) || isset( $_GET['s'] ) ) {
		return;
	}
	// phpcs:enable WordPress.Security.NonceVerification.Recommended

	$query->set( 'post_status', 'pending' );
}

/**
 * Promote Severity and Scapegoat to sit immediately after the title, and add a
 * Reporter column.
 *
 * The two taxonomy columns ALREADY EXIST — Lesson 03.3's show_admin_column put
 * them there. Adding them again would produce two Severity columns. What a
 * moderator needs is them FIRST, because triage is "how bad, who is blamed,
 * who says so" and those three answers should not be at the far right of a
 * 1600px table. Priority 20, so this runs after 03.4's filter at 10.
 *
 * @param array<string, string> $columns Existing columns.
 * @return array<string, string>
 */
function promote_moderation_columns( array $columns ): array {
	$promoted = array( 'taxonomy-severity', 'taxonomy-scapegoat' );
	$out      = array();

	foreach ( $columns as $key => $label ) {
		$out[ $key ] = $label;

		if ( 'title' !== $key ) {
			continue;
		}

		foreach ( $promoted as $moved ) {
			if ( isset( $columns[ $moved ] ) ) {
				$out[ $moved ] = $columns[ $moved ];
			}
		}

		$out['btt_reporter'] = __( 'Reporter', 'blame-the-tech-core' );
	}

	// No de-duplication step is needed, and the reason is a PHP detail worth
	// knowing: re-assigning an EXISTING key does not move it. When the loop
	// later reaches `taxonomy-severity` it overwrites a key that is already in
	// position two, so the column appears once, early. Try it in `php -a`
	// before you believe it.
	return $out;
}

/** Render the Reporter cell. This ECHOES, so it escapes. */
function render_reporter_column( string $column, int $post_id ): void {
	if ( 'btt_reporter' !== $column ) {
		return;
	}

	// The DENORMALISED display name (appendix 03 §4.1) first, because public
	// reporters are not classic WordPress authors and the meta is what the
	// front end shows.
	$name = (string) get_post_meta( $post_id, 'reporter_display_name', true );

	if ( '' === $name ) {
		$author = get_userdata( (int) get_post_field( 'post_author', $post_id ) );
		$name   = $author instanceof \WP_User ? $author->display_name : __( 'unknown', 'blame-the-tech-core' );
	}

	// The email address is deliberately NOT printed. A list table is a screen
	// people screenshot into Slack.
	echo esc_html( $name );
}

/**
 * A "Reject" row action beside Lesson 03.4's Approve, on pending incidents.
 *
 * Same three ingredients as Approve, and the nonce is one of them: a
 * capability answers "may this user", a nonce answers "did this request come
 * from a form we rendered for them". Structural authorization does not replace
 * it, because CSRF against a legitimately-capable editor passes every
 * capability check there is. Lesson 16.4 §3.
 *
 * @param array<string, string> $actions Existing row actions.
 */
function incident_reject_row_action( array $actions, \WP_Post $post ): array {
	if ( 'incident' !== $post->post_type || 'pending' !== $post->post_status ) {
		return $actions;
	}

	if ( ! current_user_can( 'publish_incidents' ) || ! current_user_can( 'edit_post', $post->ID ) ) {
		return $actions;
	}

	$url = wp_nonce_url(
		add_query_arg(
			array(
				'action' => 'btt_reject_incident',
				'post'   => $post->ID,
			),
			admin_url( 'admin-post.php' )
		),
		'btt_reject_incident_' . $post->ID
	);

	$actions['btt_reject'] = sprintf(
		'<a href="%s">%s</a>',
		esc_url( $url ),
		esc_html__( 'Reject', 'blame-the-tech-core' )
	);

	return $actions;
}

/**
 * Send a pending incident back to `draft`.
 *
 * Draft, not trash: the reporter can still see it on /account, an editor can
 * still fix and publish it, and nothing is destroyed by a mis-click.
 *
 * Nonce FIRST — it wp_die()s, and there is no point checking capabilities on a
 * request you are about to reject. Capability second. Work third. Same shape as
 * handle_approve_incident() in Lesson 03.4.
 */
function handle_reject_incident(): void {
	$post_id = isset( $_GET['post'] ) ? absint( wp_unslash( $_GET['post'] ) ) : 0;

	check_admin_referer( 'btt_reject_incident_' . $post_id );

	if ( 0 === $post_id || ! current_user_can( 'publish_incidents' ) || ! current_user_can( 'edit_post', $post_id ) ) {
		wp_die( esc_html__( 'Not allowed.', 'blame-the-tech-core' ), '', array( 'response' => 403 ) );
	}

	$post = get_post( $post_id );

	if ( ! $post instanceof \WP_Post || 'incident' !== $post->post_type ) {
		wp_die( esc_html__( 'Not allowed.', 'blame-the-tech-core' ), '', array( 'response' => 403 ) );
	}

	// wp_update_post() fires transition_post_status, which sends the mail.
	wp_update_post(
		array(
			'ID'          => $post_id,
			'post_status' => 'draft',
		)
	);

	wp_safe_redirect( add_query_arg( 'btt_rejected', 1, admin_url( 'edit.php?post_type=incident' ) ) );
	exit;
}

/**
 * Mail the reporter when their incident leaves `pending`.
 *
 * Argument order is NEW, OLD, POST. Getting it backwards means this handler
 * fires never, which is a quiet way to lose an afternoon.
 *
 * The destination is the FRONT END. `incident_reporter` is redirected away
 * from wp-admin on admin_init (03.5) and has no edit_posts at all, so a link
 * to edit.php is a link to a redirect. Nothing errors when you get this wrong;
 * the mail sends perfectly and the recipient bounces. Lesson 16.4 §4.
 *
 * Module 18 attaches the revalidation webhook to this same hook, and reuses
 * these same guards.
 */
function notify_reporter_on_transition( string $new_status, string $old_status, \WP_Post $post ): void {
	if ( 'incident' !== $post->post_type || $new_status === $old_status ) {
		return;
	}

	// Autosaves and revisions transition statuses too, and mailing on those is
	// how you end up with forty identical messages in Mailpit.
	if ( wp_is_post_autosave( $post ) || wp_is_post_revision( $post ) ) {
		return;
	}

	// Only a moderation decision on a submission. Not `auto-draft` → `draft`,
	// not `publish` → `trash`.
	if ( 'pending' !== $old_status || ! in_array( $new_status, array( 'publish', 'draft' ), true ) ) {
		return;
	}

	$author = get_userdata( (int) $post->post_author );

	if ( ! $author instanceof \WP_User || ! is_email( $author->user_email ) ) {
		return;
	}

	// The locale registerDeveloper stored, so a German reporter gets /de/account.
	$stored = (string) get_user_meta( $author->ID, 'locale', true );
	$locale = in_array( $stored, array( 'uk', 'de' ), true ) ? $stored : 'en';

	// BTT_FRONTEND_URL, exactly as the verification mail does. Locally that is
	// host.docker.internal:3000, which is unresolvable from your browser and
	// correct anyway — it is the address WordPress uses to reach Next.
	$account = trailingslashit( (string) getenv( 'BTT_FRONTEND_URL' ) ) . $locale . '/account';

	$approved = 'publish' === $new_status;

	wp_mail(
		$author->user_email,
		$approved
			? __( 'Your incident is live', 'blame-the-tech-core' )
			: __( 'Your incident needs another look', 'blame-the-tech-core' ),
		sprintf(
			$approved
				/* translators: 1: incident title, 2: account URL. */
				? __( "“%1\$s” has been approved and is now public.\n\nYour submissions: %2\$s\n", 'blame-the-tech-core' )
				/* translators: 1: incident title, 2: account URL. */
				: __( "“%1\$s” was sent back for revision. A moderator will have left a note.\n\nYour submissions: %2\$s\n", 'blame-the-tech-core' ),
			$post->post_title,
			esc_url_raw( $account )
		)
	);
}
