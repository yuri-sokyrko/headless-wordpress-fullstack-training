<?php

/**
 * The `registerDeveloper` mutation — the ONLY registration door.
 *
 * WPGraphQL's built-in registerUser requires users_can_register (a second
 * door) and assigns get_option('default_role'). This assigns
 * `incident_reporter` explicitly. See appendix 03 §6 and Lesson 05.5 §5.
 *
 * Module 15 adds email verification enforcement, Turnstile and rate limiting.
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core;

use GraphQL\Error\UserError;
use GraphQL\Type\Definition\ResolveInfo;
use WPGraphQL\AppContext;

defined('ABSPATH') || exit;

/**
 * A unique, valid username derived from an email local part.
 *
 * Never the email itself: WordPress exposes usernames in several places, and
 * an email address is not a public identifier.
 */
function unique_reporter_login(string $email): string
{
	$base = sanitize_user(strtok($email, '@'), true);
	$base = '' !== $base ? $base : 'reporter';
	$base = substr($base, 0, 40);

	$login = $base;
	$n     = 1;

	while (username_exists($login)) {
		++$n;
		$login = $base . $n;
	}

	return $login;
}

/**
 * Create an unverified `incident_reporter`.
 *
 * @throws \GraphQL\Error\UserError On a bad token or invalid input.
 * @return array{accepted: bool, email: string}
 */
function register_developer_payload(array $input, AppContext $context, ResolveInfo $info): array
{
	// ── 1. AUTHENTICATE ────────────────────────────────────────────────
	// There is no logged-in user at registration time, so the APPLICATION
	// proves itself. hash_equals() is inside require_app_token().
	require_app_token();

	// ── 2. AUTHORISE ───────────────────────────────────────────────────
	// Holding the app token IS the authorisation for this mutation. It is
	// stated here rather than left implicit, because a reader must not have
	// to wonder whether the check was forgotten.

	// ── 3. SANITISE ────────────────────────────────────────────────────
	$email  = sanitize_email((string) ($input['email'] ?? ''));
	$name   = sanitize_text_field((string) ($input['displayName'] ?? ''));
	$locale = sanitize_key((string) ($input['locale'] ?? 'en'));

	// ── 4. VALIDATE ────────────────────────────────────────────────────
	// sanitize_email() strips illegal characters; is_email() judges the
	// result. Two functions, two jobs.
	if ('' === $email || ! is_email($email)) {
		throw new UserError(__('A valid email address is required.', 'blame-the-tech-core'));
	}

	if ('' === $name || mb_strlen($name) > 80) {
		throw new UserError(__('A display name of 1–80 characters is required.', 'blame-the-tech-core'));
	}

	if (! in_array($locale, array('en', 'uk', 'de'), true)) {
		$locale = 'en';
	}

	// ── 5. WRITE ───────────────────────────────────────────────────────
	// An existing email returns the SAME payload as a new registration.
	// Anything else is an account-enumeration oracle (Lesson 06.2 §8).
	if (email_exists($email)) {
		graphql_debug('registerDeveloper: email already registered; returning generic payload.');

		return array(
			'accepted' => true,
			'email'    => $email,
		);
	}

	$user_id = wp_insert_user(
		array(
			'user_login'   => unique_reporter_login($email),
			'user_email'   => $email,
			// Generated, never returned, never logged. The user sets their own
			// via the reset flow; Module 15 wires that up.
			'user_pass'    => wp_generate_password(32, true, true),
			'display_name' => $name,
			'locale'       => 'en' === $locale ? '' : $locale,
			// EXPLICIT. Not get_option('default_role') — appendix 03 §6.
			'role'         => REPORTER_ROLE,
		)
	);

	if (is_wp_error($user_id)) {
		graphql_debug('wp_insert_user failed: ' . $user_id->get_error_message());

		throw new UserError(__('Registration could not be completed.', 'blame-the-tech-core'));
	}

	$user_id = (int) $user_id;

	// Unverified until proven otherwise. Module 15 refuses `createIncident`
	// for a reporter whose btt_verified is 0.
	update_user_meta($user_id, 'btt_verified', 0);

	// Store only a HASH of the verification code; mail the raw one. A database
	// read must not yield a usable credential.
	$verify_code = wp_generate_password(32, false, false);
	update_user_meta($user_id, 'btt_verify_hash', hash('sha256', $verify_code));
	update_user_meta($user_id, 'btt_verify_expires', time() + DAY_IN_SECONDS);

	$verify_url = add_query_arg(
		array(
			'uid'   => $user_id,
			'token' => $verify_code,
		),
		trailingslashit((string) getenv('BTT_FRONTEND_URL')) . 'verify'
	);

	wp_mail(
		$email,
		__('Confirm your Blame The Tech account', 'blame-the-tech-core'),
		sprintf(
			/* translators: %s: verification URL. */
			__("Welcome. Confirm your account within 24 hours:\n\n%s\n", 'blame-the-tech-core'),
			esc_url_raw($verify_url)
		)
	);

	return array(
		'accepted' => true,
		'email'    => $email,
	);
}

/** Register the mutation. */
function register_register_developer_mutation(): void
{
	register_graphql_mutation(
		'registerDeveloper',
		array(
			'description'         => __('Create an unverified incident_reporter. Server-to-server only: requires the X-BTT-App-Token header. Returns the same payload whether or not the email was already registered.', 'blame-the-tech-core'),
			'inputFields'         => array(
				'email'       => array(
					'type'        => array('non_null' => 'String'),
					'description' => __('Email address. Also the verification target.', 'blame-the-tech-core'),
				),
				'displayName' => array(
					'type'        => array('non_null' => 'String'),
					'description' => __('Public display name, 1–80 characters.', 'blame-the-tech-core'),
				),
				'locale'      => array(
					'type'        => 'String',
					'description' => __('One of en, uk, de. Anything else falls back to en.', 'blame-the-tech-core'),
				),
			),
			'outputFields'        => array(
				'accepted' => array(
					'type'        => array('non_null' => 'Boolean'),
					'description' => __('True when the registration was accepted for processing. Deliberately true for an already-registered email.', 'blame-the-tech-core'),
					'resolve'     => static fn($payload): bool => ! empty($payload['accepted']),
				),
				'email'    => array(
					'type'        => 'String',
					'description' => __('The sanitised email, echoed for form display. No User node is returned — this mutation is called without a session.', 'blame-the-tech-core'),
					'resolve'     => static fn($payload): ?string => $payload['email'] ?? null,
				),
			),
			'mutateAndGetPayload' => __NAMESPACE__ . '\\register_developer_payload',
		)
	);
}
add_action('graphql_register_types', __NAMESPACE__ . '\\register_register_developer_mutation');
