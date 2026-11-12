<?php
/**
 * Editor preview, repointed at the Next.js front end.
 *
 * Three responsibilities:
 *   1. preview_post_link  — send wp-admin's Preview button to /api/preview on Next
 *   2. the token mint     — a single-use 120 s receipt, stored under a HASH of itself
 *   3. /btt/v1/preview/verify — redeem the receipt for a user-scoped preview JWT
 *
 * Contract: the Preview Flow diagram in the Module 17 README, and appendix 04 §4
 * for the cookie and credential rules. Lesson 17.2.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

/** Transient key prefix. The rest of the key is hash( 'sha256', $token ). */
const PREVIEW_TRANSIENT_PREFIX = 'btt_pv_';

/** Seconds. Bounds replay; single use bounds reuse. Lesson 17.2 §5. */
const PREVIEW_TOKEN_TTL = 120;

/**
 * The HMAC key, from the environment. Same shape as expected_app_token():
 * never a literal, never an option, never committed. Appendix 04 §1.
 */
function preview_secret(): string {
	$secret = getenv( 'BTT_PREVIEW_SHARED_SECRET' );

	return is_string( $secret ) ? trim( $secret ) : '';
}

/**
 * Mint a single-use preview token and record what it is a receipt FOR.
 *
 * The transient is keyed by hash( 'sha256', $token ) rather than by the token,
 * so a database dump, a stray `wp transient list` or an SQL injection yields
 * hashes and not live previews. Same reasoning as a password hash, applied to a
 * two-minute credential.
 *
 * No timestamp is signed, deliberately: the 120 s transient already bounds
 * replay and deletion-on-use already bounds reuse. Module 18's webhook has no
 * store, which is exactly why IT needs X-BTT-Timestamp. Lesson 17.2 §5.
 */
function mint_preview_token( int $post_id, int $user_id ): string {
	// base64url of 32 CSPRNG bytes. No '+', '/' or '=' — this travels in a URL.
	$random = rtrim( strtr( base64_encode( random_bytes( 32 ) ), '+/', '-_' ), '=' );
	$token  = $random . '.' . hash_hmac( 'sha256', $random, preview_secret() );

	set_transient(
		PREVIEW_TRANSIENT_PREFIX . hash( 'sha256', $token ),
		array(
			'post_id' => $post_id,
			'user_id' => $user_id,
		),
		PREVIEW_TOKEN_TTL
	);

	return $token;
}

/**
 * The front-end path for a post, as Next.js routes it.
 *
 * The map is the `rewrite` column of appendix 03 §1, which is deliberately the
 * same word as the Next segment — /incidents, /blog, /reviews. Pages go through
 * the [...slug] catch-all, so their path is the WordPress page URI.
 *
 * One locale today. Module 20 replaces the constant with the editor's locale.
 */
function preview_front_end_path( \WP_Post $post ): string {
	$segments = array(
		'incident'    => 'incidents',
		'post'        => 'blog',
		'tech_review' => 'reviews',
	);

	if ( 'page' === $post->post_type ) {
		return '/en/' . ltrim( get_page_uri( $post ), '/' );
	}

	$segment = $segments[ $post->post_type ] ?? null;

	if ( null === $segment ) {
		return '';
	}

	return '/en/' . $segment . '/' . $post->post_name;
}

/**
 * Repoint wp-admin's Preview button at Next.js.
 *
 * PRIORITY 99, not the default 10. A headless WordPress install routinely has
 * more than one plugin with an opinion about this filter — Lesson 17.1 activated
 * one — and "whichever loaded first" is not a design. Lesson 17.2 §10.
 *
 * Returns the ORIGINAL link, unchanged, whenever it cannot build a correct one.
 * A misconfigured server must degrade to WordPress's own behaviour rather than
 * to a broken URL.
 */
function filter_preview_post_link( string $link, \WP_Post $post ): string {
	$frontend = trim( (string) getenv( 'BTT_FRONTEND_URL' ) );
	$path     = preview_front_end_path( $post );

	if ( '' === $frontend || '' === preview_secret() || '' === $path ) {
		return $link;
	}

	// The post_name is empty until the first save for some post types, and a
	// preview of a post with no slug has nowhere to land.
	if ( 'page' !== $post->post_type && '' === $post->post_name ) {
		return $link;
	}

	$minted = mint_preview_token( (int) $post->ID, get_current_user_id() );

	return add_query_arg(
		array(
			// Single-use, 120 s, one claim. NOT a session credential — the one
			// permitted token in a URL, per appendix 04 §4 and Lesson 17.2 §7.
			'token' => $minted,
			// An UNTRUSTED hint. Next logs it and never looks it up: the
			// transient carries the real post id. It exists so a failed preview
			// is diagnosable from an access log without the token in hand.
			'id'    => (int) $post->ID,
			// Where to land after the exchange. Next re-validates this against a
			// same-origin path allowlist, because WordPress is not a trusted
			// client — the mirror image of Lesson 06.2's discipline.
			'next'  => $path,
		),
		rtrim( $frontend, '/' ) . '/api/preview'
	);
}
add_filter( 'preview_post_link', __NAMESPACE__ . '\\filter_preview_post_link', 99, 2 );

/**
 * REST permission callback. The DECISION comes from app_token_matches(); the
 * FAILURE is a WP_Error, because WP_REST_Server::dispatch() does not catch the
 * UserError that require_app_token() throws. Lesson 17.2 §8.
 *
 * Two distinct codes, one status. `btt_app_token_unset` replaces the
 * graphql_debug() line that used to live in app-token.php.
 *
 * @return true|\WP_Error
 */
function rest_preview_permission() {
	if ( '' === expected_app_token() ) {
		return new \WP_Error(
			'btt_app_token_unset',
			__( 'Not authorized.', 'blame-the-tech-core' ),
			array( 'status' => 401 )
		);
	}

	if ( ! app_token_matches() ) {
		return new \WP_Error(
			'btt_not_authorized',
			__( 'Not authorized.', 'blame-the-tech-core' ),
			array( 'status' => 401 )
		);
	}

	return true;
}

/**
 * Redeem a preview token. Server-to-server only.
 *
 * @return array{postId:int,previewJwt:string}|\WP_Error
 */
function rest_verify_preview( \WP_REST_Request $request ) {
	$token = (string) $request->get_param( 'token' );
	$key   = PREVIEW_TRANSIENT_PREFIX . hash( 'sha256', $token );

	$payload = get_transient( $key );

	// DELETE FIRST, unconditionally. Single use means single ATTEMPT: a token
	// that failed the capability check below is still spent. Deleting after the
	// checks would leave a token replayable by anyone who could make one check
	// fail.
	delete_transient( $key );

	if ( ! is_array( $payload ) || ! isset( $payload['post_id'], $payload['user_id'] ) ) {
		// Expired, already redeemed, or never existed. One answer for all three.
		return new \WP_Error(
			'btt_preview_token_invalid',
			__( 'This preview link has expired. Click Preview again.', 'blame-the-tech-core' ),
			array( 'status' => 401 )
		);
	}

	// The HMAC is NOT re-checked here, and that is deliberate rather than an
	// omission: the transient key IS hash( 'sha256', $token ), so producing a hit
	// requires the exact token. The signature exists for NEXT's benefit — a local
	// pre-check so an unauthenticated caller cannot force a WordPress round trip
	// per request. Lesson 17.2 §6.
	$post_id = (int) $payload['post_id'];
	$user_id = (int) $payload['user_id'];
	$user    = get_userdata( $user_id );

	if ( ! $user instanceof \WP_User || ! user_can( $user, 'edit_post', $post_id ) ) {
		// 403, not 401: the caller IS authenticated (the app token passed) and the
		// answer is still no. Next never sees a reason.
		return new \WP_Error(
			'btt_preview_forbidden',
			__( 'Not authorized.', 'blame-the-tech-core' ),
			array( 'status' => 403 )
		);
	}

	// Mint a NORMAL user JWT for that editor. WordPress's own edit_post check
	// stays the authority when the query arrives — Next transports authority and
	// never holds it. Lesson 17.2 §9.
	if ( ! is_callable( array( '\\WPGraphQL\\JWT_Authentication\\Auth', 'get_token' ) ) ) {
		return new \WP_Error(
			'btt_jwt_unavailable',
			__( 'Not authorized.', 'blame-the-tech-core' ),
			array( 'status' => 500 )
		);
	}

	// $cap_check = false: the app token has already authenticated the CALLER, and
	// there is no logged-in user in a server-to-server REST request to check.
	$jwt = \WPGraphQL\JWT_Authentication\Auth::get_token( $user, false );

	if ( ! is_string( $jwt ) || '' === $jwt ) {
		return new \WP_Error(
			'btt_jwt_unavailable',
			__( 'Not authorized.', 'blame-the-tech-core' ),
			array( 'status' => 500 )
		);
	}

	return array(
		'postId'     => $post_id,
		'previewJwt' => $jwt,
	);
}

/**
 * The route. POST, because redeeming consumes the token — this is not a
 * cacheable read and must never be reachable by a link.
 */
function register_preview_routes(): void {
	register_rest_route(
		'btt/v1',
		'/preview/verify',
		array(
			'methods'             => 'POST',
			'callback'            => __NAMESPACE__ . '\\rest_verify_preview',
			'permission_callback' => __NAMESPACE__ . '\\rest_preview_permission',
			'args'                => array(
				'token' => array(
					'required'          => true,
					'type'              => 'string',
					// Shape only. `sanitize_text_field()` would be wrong: the token
					// is never stored or printed, only hashed and compared.
					'validate_callback' => static fn( $value ): bool => is_string( $value )
						&& 1 === preg_match( '/^[A-Za-z0-9_-]{43}\.[a-f0-9]{64}$/', $value ),
				),
			),
		)
	);
}
add_action( 'rest_api_init', __NAMESPACE__ . '\\register_preview_routes' );
