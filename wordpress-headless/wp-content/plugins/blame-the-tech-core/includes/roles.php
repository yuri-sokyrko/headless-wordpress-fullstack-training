<?php
/**
 * The `incident_reporter` role, and the capability lifecycle around it.
 *
 * The authoritative capability list is appendix 03 §6. If you change the array
 * below, bump ROLES_VERSION or the change will not reach an existing site.
 */

declare(strict_types=1);

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

/**
 * Bump this whenever REPORTER_CAPS changes. It is what makes the role a
 * migration rather than a one-time write — see Lesson 03.5 §1.
 */
const ROLES_VERSION = '1';

const REPORTER_ROLE = 'incident_reporter';

/**
 * Exactly the capabilities from appendix 03 §6, and no others.
 *
 * What is ABSENT matters more than what is present:
 *   - no `publish_incidents`        → cannot publish, on any code path
 *   - no `edit_published_incidents` → editing rights expire on publication
 *   - no `edit_others_incidents`    → cannot touch another reporter's incident
 *   - no `edit_posts`               → no block editor, no media library
 *   - no `upload_files`             → no media upload
 */
const REPORTER_CAPS = array(
	'read'             => true,
	'create_incidents' => true,
	'edit_incidents'   => true,
);

/**
 * Create or refresh `incident_reporter`.
 *
 * Remove-then-add rather than patching, so that REMOVING a capability from
 * REPORTER_CAPS actually removes it from an existing site. Safe because a role
 * definition is not a user: assigned users keep the role name in their
 * wp_capabilities meta and pick up the new definition immediately.
 */
function ensure_reporter_role(): void {
	if ( get_option( 'btt_roles_version' ) === ROLES_VERSION && get_role( REPORTER_ROLE ) ) {
		return;
	}

	remove_role( REPORTER_ROLE );

	add_role(
		REPORTER_ROLE,
		__( 'Incident Reporter', 'blame-the-tech-core' ),
		REPORTER_CAPS
	);

	update_option( 'btt_roles_version', ROLES_VERSION, false );
}

/**
 * Remove OUR capabilities from core roles on deactivation.
 *
 * Deliberately does NOT remove `incident_reporter` itself — users still hold
 * it, and deactivation must never be destructive. See Lesson 03.5 §6;
 * uninstall.php is where the role goes.
 */
function revoke_incident_caps_from_core_roles(): void {
	$caps = array(
		'create_incidents',
		'edit_incidents',
		'edit_others_incidents',
		'edit_published_incidents',
		'edit_private_incidents',
		'publish_incidents',
		'read_private_incidents',
		'delete_incidents',
		'delete_others_incidents',
		'delete_published_incidents',
		'delete_private_incidents',
	);

	foreach ( array( 'administrator', 'editor' ) as $role_name ) {
		$role = get_role( $role_name );

		if ( ! $role instanceof \WP_Role ) {
			continue;
		}

		foreach ( $caps as $cap ) {
			if ( $role->has_cap( $cap ) ) {
				$role->remove_cap( $cap );
			}
		}
	}
}

/**
 * Registration happens through the `registerDeveloper` mutation (Module 06),
 * never through /wp-login.php?action=register. One door, one set of rules.
 */
function close_wp_registration(): void {
	if ( (string) get_option( 'users_can_register' ) !== '0' ) {
		update_option( 'users_can_register', 0 );
	}
}

/**
 * Send reporters back to the front end if they reach wp-admin.
 *
 * `admin_init` runs for admin-ajax.php too, so the DOING_AJAX guard is not
 * optional — without it, any front-end AJAX from a logged-in reporter would
 * be answered with a 302 to the home page.
 */
function redirect_reporters_away_from_admin(): void {
	if ( wp_doing_ajax() || ! is_user_logged_in() ) {
		return;
	}

	// Capability, not role name: an administrator who has been given the
	// reporter role for testing should still reach the dashboard.
	if ( current_user_can( 'edit_posts' ) ) {
		return;
	}

	wp_safe_redirect( home_url( '/' ) );
	exit;
}
add_action( 'admin_init', __NAMESPACE__ . '\\redirect_reporters_away_from_admin' );

/**
 * Hide the admin bar for anyone who cannot use the dashboard.
 *
 * The `show_admin_bar_front` USER META that wp-admin exposes is per-user and
 * set at registration; this filter is role-wide and cannot be un-set by the
 * user, which is what we want.
 */
add_filter(
	'show_admin_bar',
	static function ( bool $show ): bool {
		return current_user_can( 'edit_posts' ) ? $show : false;
	}
);
