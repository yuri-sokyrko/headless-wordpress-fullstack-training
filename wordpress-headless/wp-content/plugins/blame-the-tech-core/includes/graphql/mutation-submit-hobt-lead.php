<?php
/**
 * The `submitHobtLead` mutation.
 *
 * Writes to the custom wp_btt_leads table (appendix 03 §5) — never a post
 * type, because a CPT is one misconfigured show_in_graphql away from leaking
 * every lead. The table itself is created with dbDelta() in Module 16, which
 * also adds the honeypot, timing, Turnstile and rate-limit checks. Until then
 * this mutation guards its own write and fails safely.
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core;

use GraphQL\Error\UserError;
use GraphQL\Type\Definition\ResolveInfo;
use WPGraphQL\AppContext;

defined( 'ABSPATH' ) || exit;

/**
 * Fully-qualified leads table name.
 */
function leads_table(): string {
	global $wpdb;

	return $wpdb->prefix . 'btt_leads';
}

/**
 * Does the leads table exist yet?
 *
 * $wpdb->prepare() with a %s placeholder — the table name is interpolated by
 * WordPress, not by us, and never by string concatenation.
 */
function leads_table_exists(): bool {
	global $wpdb;

	$table = leads_table();
	$found = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) );

	return $found === $table;
}

/**
 * Pseudonymise the caller's IP.
 *
 * The raw address is never stored and never logged. An HMAC with a key that
 * lives only in the environment is reversible only by brute force over the
 * whole IPv4 space, and only by someone who also holds the key.
 */
function lead_ip_hash( string $ip ): ?string {
	$key = (string) getenv( 'BTT_LEAD_IP_HMAC_KEY' );

	if ( '' === $key || '' === $ip ) {
		return null;
	}

	return hash_hmac( 'sha256', $ip, $key );
}

/**
 * Record a HOBT lead.
 *
 * @throws \GraphQL\Error\UserError On a bad token, invalid input, or before Module 16.
 * @return array{accepted: bool}
 */
function submit_hobt_lead_payload( array $input, AppContext $context, ResolveInfo $info ): array {
	// ── 1 + 2. AUTHENTICATE / AUTHORISE ────────────────────────────────
	require_app_token();

	// ── 3. SANITISE ────────────────────────────────────────────────────
	$email     = sanitize_email( (string) ( $input['email'] ?? '' ) );
	$full_name = sanitize_text_field( (string) ( $input['fullName'] ?? '' ) );
	$company   = sanitize_text_field( (string) ( $input['company'] ?? '' ) );
	$team_size = sanitize_text_field( (string) ( $input['teamSize'] ?? '' ) );
	$locale    = sanitize_key( (string) ( $input['locale'] ?? 'en' ) );
	$consent   = ! empty( $input['consent'] );

	// An enum input arrives as the stored kebab value; re-assert it anyway.
	$source = normalize_stored_value( 'LeadSource', $input['source'] ?? '' );

	$agent = substr( sanitize_text_field( (string) ( $_SERVER['HTTP_USER_AGENT'] ?? '' ) ), 0, 255 );
	$ip    = filter_var( (string) ( $_SERVER['REMOTE_ADDR'] ?? '' ), FILTER_VALIDATE_IP );

	// ── 4. VALIDATE ────────────────────────────────────────────────────
	if ( '' === $email || ! is_email( $email ) ) {
		throw new UserError( __( 'A valid email address is required.', 'blame-the-tech-core' ) );
	}

	if ( '' === $full_name || mb_strlen( $full_name ) > 190 ) {
		throw new UserError( __( 'A name of 1–190 characters is required.', 'blame-the-tech-core' ) );
	}

	if ( null === $source ) {
		throw new UserError( __( 'source is not a recognised value.', 'blame-the-tech-core' ) );
	}

	if ( ! $consent ) {
		throw new UserError( __( 'Consent is required.', 'blame-the-tech-core' ) );
	}

	// ── 5. WRITE ───────────────────────────────────────────────────────
	if ( ! leads_table_exists() ) {
		// Module 16 creates the table. The caller learns that the endpoint is
		// unavailable and nothing about schemas, tables or plugins.
		graphql_debug( 'wp_btt_leads does not exist yet — Module 16 creates it with dbDelta().' );

		throw new UserError( __( 'Temporarily unavailable.', 'blame-the-tech-core' ) );
	}

	global $wpdb;

	// $wpdb->insert() builds a prepared statement from the format array.
	// There is no SQL string in this function to concatenate anything into.
	$wpdb->insert(
		leads_table(),
		array(
			'created_at' => current_time( 'mysql', true ),
			'email'      => $email,
			'full_name'  => $full_name,
			'company'    => '' !== $company ? $company : null,
			'team_size'  => '' !== $team_size ? $team_size : null,
			'source'     => $source,
			'locale'     => in_array( $locale, array( 'en', 'uk', 'de' ), true ) ? $locale : 'en',
			'consent'    => 1,
			'ip_hash'    => lead_ip_hash( false !== $ip ? (string) $ip : '' ),
			'user_agent' => '' !== $agent ? $agent : null,
		),
		array( '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s' )
	);

	// A duplicate violates UNIQUE KEY (email, source) and returns false. That
	// is SUCCESS from the caller's point of view: telling them the address is
	// already on the list is the same enumeration oracle as in §8.
	return array( 'accepted' => true );
}

/**
 * Register the mutation.
 */
function register_submit_hobt_lead_mutation(): void {
	register_graphql_mutation(
		'submitHobtLead',
		array(
			'description'         => __( 'Record a HOBT demo lead. Server-to-server only: requires the X-BTT-App-Token header. Returns `accepted: true` for a duplicate, on purpose.', 'blame-the-tech-core' ),
			'inputFields'         => array(
				'email'    => array(
					'type'        => array( 'non_null' => 'String' ),
					'description' => __( 'Lead email address.', 'blame-the-tech-core' ),
				),
				'fullName' => array(
					'type'        => array( 'non_null' => 'String' ),
					'description' => __( 'Lead name, 1–190 characters.', 'blame-the-tech-core' ),
				),
				'company'  => array(
					'type'        => 'String',
					'description' => __( 'Optional company name.', 'blame-the-tech-core' ),
				),
				'teamSize' => array(
					'type'        => 'String',
					'description' => __( 'Optional team-size bucket.', 'blame-the-tech-core' ),
				),
				'source'   => array(
					'type'        => array( 'non_null' => 'LeadSource' ),
					'description' => __( 'Which HOBT surface produced the lead.', 'blame-the-tech-core' ),
				),
				'locale'   => array(
					'type'        => 'String',
					'description' => __( 'One of en, uk, de.', 'blame-the-tech-core' ),
				),
				'consent'  => array(
					'type'        => array( 'non_null' => 'Boolean' ),
					'description' => __( 'Must be true. Recorded, and required.', 'blame-the-tech-core' ),
				),
			),
			'outputFields'        => array(
				'accepted' => array(
					'type'        => array( 'non_null' => 'Boolean' ),
					'description' => __( 'True when the lead was accepted. No row ID is returned and duplicates are indistinguishable from new leads.', 'blame-the-tech-core' ),
					'resolve'     => static fn( $payload ): bool => ! empty( $payload['accepted'] ),
				),
			),
			'mutateAndGetPayload' => __NAMESPACE__ . '\\submit_hobt_lead_payload',
		)
	);
}
add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_submit_hobt_lead_mutation' );
