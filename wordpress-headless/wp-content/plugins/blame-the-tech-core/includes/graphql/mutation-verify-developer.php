<?php
/**
 * The `verifyDeveloper` mutation, and the verification-code helpers.
 *
 * Consumes the single-use code registerDeveloper mailed (Lesson 06.2), sets a
 * password the human chose, and flips btt_verified to 1 — which is what makes
 * the map_meta_cap filter in includes/roles.php start allowing
 * create_incidents. Contract: appendix 03 §7.
 *
 * Returns the SAME payload for an unknown user, a wrong code, an expired code
 * and an already-used code. Four failures, one answer, no oracle.
 *
 * @package Blame\Core
 */


declare( strict_types=1 );

namespace Blame\Core;

use GraphQL\Error\UserError;
use GraphQL\Type\Definition\ResolveInfo;
use WPGraphQL\AppContext;

defined( 'ABSPATH' ) || exit;

/** Matches the window registerDeveloper's email promises. */
const VERIFY_CODE_TTL = DAY_IN_SECONDS;

/** The shortest password this application will accept. Length beats character classes. */
const MIN_PASSWORD_LENGTH = 12;

/**
 * Issue a fresh verification code and store only its hash.
 *
 * Returns the RAW code, which the caller mails and then forgets. A database
 * read must not yield a usable credential — the same rule core applies to
 * user_activation_key.
 *
 * Called by registerDeveloper's sibling in Lesson 06.2 and by
 * reporter_new_user_notification_email() in includes/roles.php.
 */
function issue_verify_code(int $user_id): string {
	// No special characters: this value travels in a URL query string and gets
	// pasted by humans out of an email client that may or may not linkify it.
	$code = wp_generate_password(32, false, false);

	update_user_meta( $user_id, 'btt_verify_hash', hash('sha256', $code));
	update_user_meta($user_id, 'btt_verify_expires', time() + VERIFY_CODE_TTL);

	return $code;
}

/**
 * Check a presented code and, on success, CONSUME it.
 *
 * Single use: both meta rows are deleted, so a replay from browser history, a
 * proxy log or a forwarded email fails. hash_equals(), not ===, for the same
 * timing reason as the app token (Lesson 06.2 §7).
 */
function consume_verify_code(int $user_id, string $code): bool {
	$stored = (string) get_user_meta($user_id, 'btt_verify_hash', true);
	$expires = (int) get_user_meta($user_id, 'btt_verify_expires', true);

	if('' === $stored || '' === $code) {
		return false;
	}

	if($expires < time()) {
		return false;
	}

	if(!hash_equals($stored, hash('sha256', $code))) {
		return false;
	}

	delete_user_meta($user_id, 'btt_verify_hash');
	delete_user_meta($user_id, 'btt_verify_expires');

	return true;
}

/**
 * Verify an account and set its password.
 *
 * @throws \GraphQL\Error\UserError On a bad app token or an unusable password.
 * @return array{verified: bool}
 */
function verify_developer_payload(array $input, AppContext $context, ResolveInfo $info): array {
	// ── 1 + 2. AUTHENTICATE / AUTHORISE ────────────────────────────────
	// There is no logged-in user: the whole point is that this account cannot
	// sign in yet. So the APPLICATION proves itself. hash_equals() is inside.
	require_app_token();

	// ── 3. SANITISE ────────────────────────────────────────────────────
	$user_id = absint($input['userId'] ?? 0);
	$code = sanitize_text_field((string) ($input['code'] ?? ''));

	// A password is NOT sanitised. It is compared and hashed, never stored as
	// text, never printed, never logged. sanitize_text_field() would silently
	// change it — collapsing whitespace turns a passphrase into a different
	// passphrase, and the user could then never log in with what they typed.
	$password = (string) ($input['password'] ?? '');

	// ── 4. VALIDATE ────────────────────────────────────────────────────
	// This one throws rather than returning `verified: false`, and that is
	// deliberate: it is a fact about the CALLER'S OWN input and leaks nothing
	// about the account. It also runs BEFORE the code is consumed, so a too
	// short password does not burn a single-use code.
	$length = mb_strlen($password);

	if($length < MIN_PASSWORD_LENGTH || $length > 200) {
		throw new UserError(
			sprintf(
				/* translators: %d: minimum password length. */
				__('Choose a password of at least %d characters.', 'blame-the-tech-core'),
				MIN_PASSWORD_LENGTH
			)
		);
	}

	$user = 0 === $user_id ? null : get_user_by('id', $user_id);

	// FOUR failures, ONE answer: no such user, not a reporter, wrong code,
	// expired code, already-consumed code. Nothing here distinguishes them,
	// because a distinguishable answer tells a stranger which user IDs exist
	// and whether a guessed code was close.
	if(!$user instanceof \WP_User
		|| !in_array(REPORTER_ROLE, (array) $user->roles, true)
		|| !consume_verify_code($user_id, $code
	)) {
		graphql_debug('verifyDeveloper: generic refusal for uid ' . $user_id);

		return array('verified' => false);
	}

	// ── 5. WRITE ───────────────────────────────────────────────────────
	// registerDeveloper set a random 32-character password nobody has ever
	// seen, so this is the first password the human owns. wp_set_password()
	// also destroys that user's sessions and clears any pending reset key.
	wp_set_password($password, $user_id);

	update_user_meta($user_id, 'btt_verified', 1);

	return array('verified' => true);
}

/** Register the mutation. */
function register_verify_developer_mutation(): void {
	register_graphql_mutation(
		'verifyDeveloper',
		array(
			'description' => __( 'Consume the single-use code emailed by registerDeveloper, set the account password, and mark the email verified. Server-to-server only: requires the X-BTT-App-Token header. Returns `verified: false` — with no error — for an unknown user, a wrong code, an expired code or an already-used code.', 'blame-the-tech-core' ),
			'inputFields' => array(
				'userId' => array(
					'type' => array('non_null' => 'Int'),
					'description' => __('The `uid` query parameter from the verification link.', 'blame-the-tech-core'),
				),
				'code' => array(
					'type' => array( 'non_null' => 'String' ),
					'description' => __( 'The `token` query parameter from the verification link. Compared against a stored sha256 hash with hash_equals().', 'blame-the-tech-core' ),
				),
				'password' => array(
					'type' => array( 'non_null' => 'String' ),
					'description' => __( 'The password the user chooses. registerDeveloper generated a random one and never disclosed it, so this is the first password the account owner holds.', 'blame-the-tech-core' ),
				),
			),
			'outputFields' => array(
				'verified' => array(
					'type' => array( 'non_null' => 'Boolean' ),
					'description' => __( 'True only when the code was valid, unexpired and unused. False for every other case, with no detail about which.', 'blame-the-tech-core' ),
					'resolve' => static fn( $payload ): bool => ! empty( $payload['verified'] ),
				),
			),
			'mutateAndGetPayload' => __NAMESPACE__ . '\\verify_developer_payload',
		)
	);
}
add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_verify_developer_mutation' );
