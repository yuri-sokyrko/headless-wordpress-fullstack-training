<?php
/**
 * Registered GraphQL enums.
 *
 * The authoritative value list is appendix 03 §3. The GraphQL NAME is
 * SCREAMING_SNAKE_CASE; the `value` is what is stored in wp_postmeta and in
 * wp_btt_leads.source. graphql-php maps between them in both directions — see
 * Lesson 06.1 §4 before "helpfully" upper-casing anything in a resolver.
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;
/**
 * enum type name => config accepted verbatim by register_graphql_enum_type().
 *
 * @var array<string, array{description: string, values: array<string, array{value: string, description: string}>}>
 */
const GRAPHQL_ENUMS = array(
	'IncidentEnvironment'      => array(
		'description' => 'Where an incident happened. Stored as a kebab-case SCF select value; exposed as an enum so consumers get a union type rather than a string.',
		'values'      => array(
			'PRODUCTION'          => array(
				'value'       => 'production',
				'description' => 'Real users, real money, real pager.',
			),
			'STAGING'             => array(
				'value'       => 'staging',
				'description' => 'The environment that is definitely identical to production.',
			),
			'DEVELOPMENT'         => array(
				'value'       => 'development',
				'description' => 'A shared development environment.',
			),
			'WORKS_ON_MY_MACHINE' => array(
				'value'       => 'works-on-my-machine',
				'description' => 'Reproduces nowhere except the reporter’s laptop.',
			),
		),
	),
	'IncidentResolutionStatus' => array(
		'description' => 'How far an incident has travelled from "it is broken" to "it is someone else’s fault".',
		'values'      => array(
			'OPEN'      => array(
				'value'       => 'open',
				'description' => 'Still on fire.',
			),
			'MITIGATED' => array(
				'value'       => 'mitigated',
				'description' => 'Symptoms suppressed, cause unknown.',
			),
			'BLAMED'    => array(
				'value'       => 'blamed',
				'description' => 'A scapegoat has been identified. This is the terminal success state.',
			),
			'WONTFIX'   => array(
				'value'       => 'wontfix',
				'description' => 'Accepted as a feature.',
			),
		),
	),
	'TechReviewVerdict'        => array(
		'description' => 'The tech-radar verdict on a company or tool.',
		'values'      => array(
			'ADOPT'  => array(
				'value'       => 'adopt',
				'description' => 'Use it.',
			),
			'TRIAL'  => array(
				'value'       => 'trial',
				'description' => 'Use it somewhere that can fail.',
			),
			'ASSESS' => array(
				'value'       => 'assess',
				'description' => 'Read about it; do not ship it.',
			),
			'HOLD'   => array(
				'value'       => 'hold',
				'description' => 'Stop starting new things with it.',
			),
		),
	),
	'LeadSource'               => array(
		'description' => 'Which HOBT surface produced a lead. Used as a mutation INPUT in Lesson 06.2 and stored in wp_btt_leads.source.',
		'values'      => array(
			'HOBT_HERO'        => array(
				'value'       => 'hobt-hero',
				'description' => 'The hero form on /hobt.',
			),
			'HOBT_CTA_BLOCK'   => array(
				'value'       => 'hobt-cta-block',
				'description' => 'The hobt-cta Gutenberg block, anywhere it appears.',
			),
			'HOBT_FOOTER'      => array(
				'value'       => 'hobt-footer',
				'description' => 'The site-wide footer form.',
			),
			'INCIDENT_SIDEBAR' => array(
				'value'       => 'incident-sidebar',
				'description' => 'The promo in the incident detail sidebar.',
			),
		),
	),
);

/**
 * Register every enum in GRAPHQL_ENUMS.
 *
 * `graphql_register_types` fires once per GraphQL request, after WPGraphQL has
 * built everything it derives from your registrations. An enum may be
 * registered before anything uses it — `LeadSource` has no field until
 * Lesson 06.2 — and that is fine.
 */
function register_graphql_enums(): void {
	foreach ( GRAPHQL_ENUMS as $type_name => $config ) {
		register_graphql_enum_type( $type_name, $config );
	}
}
add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_graphql_enums' );

/**
 * The stored (kebab-case) values of one enum.
 *
 * @return string[]
 */
function enum_stored_values( string $enum ): array {
	return array_column( GRAPHQL_ENUMS[ $enum ]['values'] ?? array(), 'value' );
}

/**
 * Normalise a raw stored value for RETURN FROM A RESOLVER.
 *
 * Returns the kebab-case value — NOT the SCREAMING_SNAKE name. graphql-php
 * serialises it to the name. Anything unrecognised becomes null rather than a
 * guess: wp_postmeta predates this enum, and serialising an illegal value
 * throws for the whole field.
 */
function normalize_stored_value( string $enum, mixed $raw ): ?string {
	$value = sanitize_key( (string) $raw );

	return in_array( $value, enum_stored_values( $enum ), true ) ? $value : null;
}

/**
 * Reverse map, for the boundaries that are NOT GraphQL — a CSV export, an
 * admin column, a log line. Inside GraphQL you never need this.
 */
function stored_to_enum_name( string $enum, mixed $raw ): ?string {
	$value = sanitize_key( (string) $raw );

	foreach ( GRAPHQL_ENUMS[ $enum ]['values'] ?? array() as $name => $spec ) {
		if ( $spec['value'] === $value ) {
			return $name;
		}
	}

	return null;
}
