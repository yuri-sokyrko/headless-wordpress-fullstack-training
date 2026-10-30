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
const ROLES_VERSION = '2';

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

/**
 * Remove capabilities from `incident_reporter` that nothing should have added.
 *
 * ensire_reporter_role() rebuilds the rile from REPORTER_CAPS, son in a clean
 * install this function fincds nothing. It exists because a role lives in the
 * `wp_user_role` OPTION - shared, writable state that any plugin or any
 * "user role editor" screen can add to. `upload_files` on this role would be an
 * arbitrary-file-write surface reachable by a public signup.
 *
 * Idempotent. Called from Plugin::activate() and NOT gated on ROLES_VERSION.
 */
function strip_reporter_extras(): void {
	$role = get_role(REPORTER_ROLE);

	if(!$role instanceof \WP_Role) {
		return;
	}

	$never = array(
		'upload_files',
		'edit_posts',
		'publish_incidents',
		'edit_published_incidents',
		'edit_others_incidents',
		'delete_incidents',
	);

	foreach($never as $cap) {
		if($role->has_cap($cap)) {
			$role->remove_cap($cap);
		}
	}
}

/**
 * Deny `create_incidents` until the account's email has been verified.
 *
 * The right hook, for the reason in Lesson 15.3 §4: the map_meta_cap FILTER
 * runs for every current_user_can() call, so the rule applies to the Module 06
 * mutation, to wp-admin, to REST, to WP-CLI, and to code nobody has written
 * yet. The alternative — an `if` inside createIncident — is correct exactly
 * once and one forgotten code path away from being bypassed.
 *
 * `array( 'do_not_allow' )` denies because no role holds a capability by that
 * name. It is not a special-cased sentinel; that is why it is stable.
 *
 * $user_id is left untyped and cast: this filter is called by third-party code
 * as well as core, and a strict_types fatal inside an authorisation filter
 * would fail OPEN on any path that swallows the error.
 *
 * @param array<int, string> $caps
 * @return array<int, string>
 */
function deny_create_incidents_until_verified( array $caps, string $cap, $user_id, array $args ): array {
	// Name check FIRST, before any database read. This callback runs on every
	// capability check in every request; everything below it must not.
	if ( 'create_incidents' !== $cap ) {
		return $caps;
	}

	$user_id = (int) $user_id;

	// Anonymous. Let the normal machinery deny it — narrowing this filter's
	// scope keeps its behaviour easy to reason about.
	if ( 0 === $user_id ) {
		return $caps;
	}

	// THE THREE-STATE READ, and the whole reason Lesson 15.3 §6 exists.
	// get_user_meta( …, true ) returns '' when the row does not EXIST, and '0'
	// only when registerDeveloper wrote an explicit zero. Deny on '0' and only
	// on '0'. A falsy test — `! get_user_meta(...)` — would also match '',
	// because `'' == 0` is true in PHP, and would therefore lock out the seeded
	// reporter, e2e_agent and editor, plus every account an administrator adds
	// by hand. An absent row means "not created through the public door".
	if ( '0' !== get_user_meta( $user_id, 'btt_verified', true ) ) {
		return $caps;
	}

	// It really does say 0. One last exemption: an editor or administrator whose
	// meta was set to 0 by hand is not a public signup. user_can() re-enters
	// this filter with a DIFFERENT $cap, which returns on the first line of the
	// function, so there is no recursion. Get that ordering wrong and there is.
	if ( user_can( $user_id, 'edit_others_incidents' ) ) {
		return $caps;
	}

	return array( 'do_not_allow' );
}
add_filter( 'map_meta_cap', __NAMESPACE__ . '\\deny_create_incidents_until_verified', 10, 4 );

/**
 * Point core's new-user notification at the Next.js /verify page, for reporters.
 *
 * The wp-admin "Users → Add New" path calls wp_new_user_notification(), which
 * mails a /wp-login.php?action=rp link — into the one place an incident_reporter
 * may not go. Filtering `wp_new_user_notification_email` is scoped and
 * composable; redeclaring the pluggable function would be global and would
 * conflict with any other plugin doing the same (Lesson 15.3 §8).
 *
 * This does NOT replace registerDeveloper's own mail. Lesson 06.2 already sends
 * that one.
 *
 * @param array<string, string> $email `to`, `subject`, `message`, `headers`.
 * @return array<string, string>
 */
function reporter_new_user_notification_email(array $email, \WP_User $user, string $blogname): array {
	if(!in_array(REPORTER_ROLE, (array) $user->roles, true)) {
		// Editors and administrators DO use wp-admin. Core's message is correct
		// for them and this filter leaves it entirely alone.
		return $email;
	}

	// A fresh single-use code, hashed at rest. Declared in
	// includes/graphql/mutation-verify-developer.php — all INCLUDES are required
	// before any hook fires, so load order does not matter for a call site.
	$code = issue_verify_code((int) $user->ID);
	$verify_url = add_query_arg(
		array(
			'uid' => (int) $user->ID,
			'token' => $code,
		),
		trailingslashit((string) getenv('BTT_FORNTEND_URL')) . 'verify'
	);

	/* translators: %s: site name. */
	$email['subject'] = sprintf(__('[%s] Confirm your account', 'blame-the-tech-core'), $blogname);
	$email['message'] = sprintf(
		/* translators: 1: site name, 2: verification URL. */
		__( "An account was created for you on %1\$s.\n\nConfirm it and choose a password within 24 hours:\n\n%2\$s\n\nIf you did not expect this, ignore this email.\n", 'blame-the-tech-core' ),
		$blogname,
		esc_url_raw( $verify_url )
	);


	return $email;
}
add_filter('wp_new_user_notification_email', __NAMESPACE__ . '\\reporter_new_user_notification_email',  10, 3);
