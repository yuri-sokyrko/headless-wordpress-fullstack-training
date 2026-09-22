<?php

/**
 * Application-token authentication for server-to-server mutations.
 *
 * The app token identifies the Next.js APPLICATION, not a user — see
 * appendix 04 §4. It is used by mutations that have no logged-in caller by
 * definition: registration and lead capture.
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core;

use GraphQL\Error\UserError;

defined('ABSPATH') || exit;

const APP_TOKEN_HEADER = 'X-BTT-App-Token';

/**
 * The expected token, from the environment. Never a literal, never an option,
 * never committed — appendix 04 §1.
 */
function expected_app_token(): string
{
	$token = getenv('BTT_APP_TOKEN');

	return is_string($token) ? trim($token) : '';
}

/**
 * The token the caller presented, from the request headers.
 *
 * PHP exposes `X-BTT-App-Token` as HTTP_X_BTT_APP_TOKEN. It is not sanitised
 * with sanitize_text_field(), because it is never stored or printed — it is
 * only ever compared, and trimming is all the normalisation it may safely get.
 */
function presented_app_token(): string
{
	$raw = $_SERVER['HTTP_X_BTT_APP_TOKEN'] ?? '';

	return is_string($raw) ? trim($raw) : '';
}

/**
 * Require a valid application token, or fail the mutation.
 *
 * hash_equals(), NOT == or ===. String comparison returns as soon as two bytes
 * differ, which leaks how many leading bytes were correct and turns guessing a
 * 48-character token into a few thousand requests per character.
 * hash_equals() takes the same time for any two strings of equal length.
 *
 * The known value goes FIRST — that is the documented argument order.
 *
 * @throws \GraphQL\Error\UserError If the token is missing, empty or wrong.
 */
function require_app_token(): void
{
	$expected = expected_app_token();

	// A misconfigured server must never authenticate everyone. If the
	// environment variable is absent, every call fails closed.
	if ('' === $expected) {
		graphql_debug('BTT_APP_TOKEN is not set in the WordPress environment.');

		throw new UserError(__('Not authorized.', 'blame-the-tech-core'));
	}

	if (! hash_equals($expected, presented_app_token())) {
		// Same message for missing, empty, short, long and wrong. A caller
		// entitled to this mutation already holds the token.
		throw new UserError(__('Not authorized.', 'blame-the-tech-core'));
	}
}
