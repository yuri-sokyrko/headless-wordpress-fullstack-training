<?php
/**
 * Custom GraphQL fields on `Incident` and `TechReview`.
 *
 * Two jobs:
 *   1. Retype SCF select fields so they are real enums (Lesson 06.1 §5).
 *   2. Register `blameScore` and `blameScoreBreakdown` (§6).
 *
 * Every resolver here MUST be computation only. A field on a type is resolved
 * once per node and the node count is chosen by the client — see §7 and
 * Lesson 06.4.
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core;

use GraphQL\Type\Definition\ResolveInfo;
use WPGraphQL\AppContext;

defined( 'ABSPATH' ) || exit;

/**
 * The object type WPGraphQL for SCF generates from the `Incident Details`
 * field group. Confirmed by introspection in Task Step 4 — the SCF plugin owns
 * this name, so it lives in exactly one place.
 */
const SCF_INCIDENT_TYPE = 'IncidentDetails';

/**
 * severity term slug => weight. The severity list is closed (appendix 03 §2).
*/
const SEVERITY_WEIGHTS = array(
	's1-catastrophic' => 1.0,
	's2-major'        => 0.6,
	's3-minor'        => 0.3,
	's4-cosmetic'     => 0.1,
);

/**
 * Resolve the post ID behind a `$source` that may be an SCF field-group
 * container, a WPGraphQL model, or a bare ID.
 *
 * WPGraphQL for SCF has passed all three across its major versions. Handling
 * every shape costs four lines and removes a whole class of upgrade breakage.
 */
function source_post_id( mixed $source ): int {
	if ( is_array( $source ) ) {
		$node = $source['node'] ?? null;

		if ( is_object( $node ) && isset( $node->databaseId ) ) {
			return (int) $node->databaseId;
		}

		return (int) ( $source['post_id'] ?? 0 );
	}

	if ( is_object( $source ) && isset( $source->databaseId ) ) {
		return (int) $source->databaseId;
	}

	return is_numeric( $source ) ? (int) $source : 0;
}

/**
 * The incident's severity term slug, or null.
 *
 * `get_the_terms()` reads the object term cache, which the connection's post
 * query primed for the whole batch — so this is not a query per node. The
 * static memo covers a client selecting both blameScore and
 * blameScoreBreakdown on the same node.
 *
 * @var array<int, string|null> $memo
 */
function incident_severity_slug( int $post_id ): ?string {
	static $memo = array();

	if ( array_key_exists( $post_id, $memo ) ) {
		return $memo[ $post_id ];
	}

	$terms = get_the_terms( $post_id, 'severity' );

	$memo[ $post_id ] = ( is_array( $terms ) && array() !== $terms ) ? (string) $terms[0]->slug : null;

	return $memo[ $post_id ];
}

/**
 * Compute the blame score and everything that went into it.
 *
 * Returns null when the score cannot be computed — an incident with no
 * severity term. Null means "not computable"; 0.0 would mean "harmless", and
 * those are different claims (Lesson 06.1 §6).
 *
 * @return array{score: float, severitySlug: string, severityWeight: float, blameConfidence: float, downtimeMinutes: float}|null
 */
function incident_blame_breakdown( int $post_id ): ?array {
	static $memo = array();

	if ( array_key_exists( $post_id, $memo ) ) {
		return $memo[ $post_id ];
	}

	$slug = incident_severity_slug( $post_id );

	if ( null === $slug || ! array_key_exists( $slug, SEVERITY_WEIGHTS ) ) {
		$memo[ $post_id ] = null;

		return null;
	}

	$weight     = (float) SEVERITY_WEIGHTS[ $slug ];
	$confidence = (float) get_post_meta( $post_id, 'blame_confidence', true );
	$downtime   = (float) get_post_meta( $post_id, 'downtime_minutes', true );

	$memo[ $post_id ] = array(
		'score'           => round( $weight * ( $confidence / 100 ) * $downtime, 2 ),
		'severitySlug'    => $slug,
		'severityWeight'  => $weight,
		'blameConfidence' => $confidence,
		'downtimeMinutes' => $downtime,
	);

	return $memo[ $post_id ];
}

/**
 * The object type WPGraphQL for SCF generates from the `Tech Review Fields`
 * field group (`group_tech_review_fields.json`, `graphql_field_name`
 * "techReviewFields").
 */
const SCF_TECH_REVIEW_TYPE = 'TechReviewFields';

/**
 * Retype one SCF select field to a real enum, on both its object type and the
 * companion `<Type>_Fields` interface WPGraphQL for SCF generates alongside it
 * (registered from the same field array — see
 * WPGraphQLAcf\Registry::register_graphql_object_type()). Both must change
 * together: graphql-php's interface-conformance check rejects a schema where
 * an implementing type's field type is no longer compatible with the
 * interface's declared type.
 */
function retype_scf_enum_field( string $type_name, string $field_name, string $enum, string $meta_key ): void {
	$resolve = static function ( $source, array $args, AppContext $context, ResolveInfo $info ) use ( $enum, $meta_key ): ?string {
		$post_id = source_post_id( $source );

		if ( 0 === $post_id ) {
			return null;
		}

		// Return the STORED value. graphql-php serialises it to the
		// enum name. Upper-casing here would break the field.
		return normalize_stored_value( $enum, get_post_meta( $post_id, $meta_key, true ) );
	};

	$field_config = array(
		'type'        => $enum,
		'description' => sprintf(
		/* translators: %s: GraphQL enum type name. */
			__( 'Stored as a kebab-case value in post meta and exposed as %s. Null when unset or when the stored value is not a legal enum value.', 'blame-the-tech-core' ),
			$enum
		),
		'resolve'     => $resolve,
	);

	// SCF registered this field as [String] on both the object type and its
	// `_Fields` interface. A field cannot be registered twice, so retyping is
	// remove-then-add on each. See Lesson 06.1 §5 for the two costs this incurs.
	foreach ( array( $type_name, $type_name . '_Fields' ) as $target ) {
		deregister_graphql_field( $target, $field_name );
		register_graphql_field( $target, $field_name, $field_config );
	}
}

/**
 * Retype the two SCF select fields on `IncidentDetails` as real enums.
 */
function register_incident_enum_fields(): void {
	retype_scf_enum_field( SCF_INCIDENT_TYPE, 'environment', 'IncidentEnvironment', 'environment' );
	retype_scf_enum_field( SCF_INCIDENT_TYPE, 'resolutionStatus', 'IncidentResolutionStatus', 'resolution_status' );
}

/**
 * Retype `verdict` on `TechReviewFields` as a real enum.
 */
function register_tech_review_enum_fields(): void {
	retype_scf_enum_field( SCF_TECH_REVIEW_TYPE, 'verdict', 'TechReviewVerdict', 'verdict' );
}

/**
 * `blameScore`, and the object type that explains it.
 */
function register_blame_score_fields(): void {
	register_graphql_object_type(
		'BlameScoreBreakdown',
		array(
			'description' => __( 'Every input to blameScore, so a client can explain the number instead of only printing it.', 'blame-the-tech-core' ),
			'fields'      => array(
				'score'           => array(
					'type'        => 'Float',
					'description' => __( 'severityWeight × (blameConfidence ÷ 100) × downtimeMinutes, rounded to 2 decimal places.', 'blame-the-tech-core' ),
					// $source here is the ARRAY returned by the parent
					// blameScoreBreakdown resolver — Lesson 06.1 §2.
					'resolve'     => static fn( $source ): ?float => isset( $source['score'] ) ? (float) $source['score'] : null,
				),
				'severitySlug'    => array(
					'type'              => 'String',
					'description'       => __( 'The severity term slug the weight came from.', 'blame-the-tech-core' ),
					// Lesson 06.3 §5: a reason names the replacement AND the date.
					// A deprecation with no date is a field that lives forever.
					'deprecationReason' => __( 'Duplicates `severities { nodes { slug } }`, which is the canonical route, and leaks a WordPress term slug into a computed field. Use that connection instead. Removed after 2026-06-01.', 'blame-the-tech-core' ),
					'resolve'           => static fn( $source ): ?string => isset( $source['severitySlug'] ) ? (string) $source['severitySlug'] : null,
				),
				'severityWeight'  => array(
					'type'        => 'Float',
					'description' => __( 'Weight for that severity: 1.0, 0.6, 0.3 or 0.1.', 'blame-the-tech-core' ),
					'resolve'     => static fn( $source ): ?float => isset( $source['severityWeight'] ) ? (float) $source['severityWeight'] : null,
				),
				'blameConfidence' => array(
					'type'        => 'Float',
					'description' => __( 'The reporter’s confidence, 0–100, exactly as stored.', 'blame-the-tech-core' ),
					'resolve'     => static fn( $source ): ?float => isset( $source['blameConfidence'] ) ? (float) $source['blameConfidence'] : null,
				),
				'downtimeMinutes' => array(
					'type'        => 'Float',
					'description' => __( 'Reported downtime in minutes, exactly as stored.', 'blame-the-tech-core' ),
					'resolve'     => static fn( $source ): ?float => isset( $source['downtimeMinutes'] ) ? (float) $source['downtimeMinutes'] : null,
				),
			),
		)
	);

	register_graphql_field(
		'Incident',
		'blameScore',
		array(
			'type'        => 'Float',
			'description' => __( 'Computed on read: severity weight × (blameConfidence ÷ 100) × downtimeMinutes. NULL — not 0 — when the incident has no severity term, because "not computable" and "harmless" are different claims.', 'blame-the-tech-core' ),
			'resolve'     => static function ( $source, array $args, AppContext $context, ResolveInfo $info ): ?float {
				$breakdown = incident_blame_breakdown( source_post_id( $source ) );

				return null === $breakdown ? null : (float) $breakdown['score'];
			},
		)
	);

	register_graphql_field(
		'Incident',
		'blameScoreBreakdown',
		array(
			'type'        => 'BlameScoreBreakdown',
			'description' => __( 'The inputs to blameScore. Null under exactly the same conditions as blameScore.', 'blame-the-tech-core' ),
			'resolve'     => static function ( $source, array $args, AppContext $context, ResolveInfo $info ): ?array {
				return incident_blame_breakdown( source_post_id( $source ) );
			},
		)
	);
}

add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_incident_enum_fields' );
add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_tech_review_enum_fields' );
add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_blame_score_fields' );

/**
 * The where-args input type of the ROOT `incidents` connection.
 *
 * WPGraphQL composes it as <fromType>To<ucfirst(toType)>Connection . 'WhereArgs'
 * — WPConnectionType::register_connection_input(). Introspected in Step 7,
 * because the name is generated and a major version could change it.
 */
const INCIDENT_WHERE_ARGS = 'RootQueryToIncidentConnectionWhereArgs';

/**
 * ONE narrow, allowlisted taxonomy argument — not a generic taxQuery, and not
 * the three arguments Lesson 05.2 §6 sketched. `severityIn` has two callers,
 * HomepageFeeds and IncidentTicker; `scapegoatIn` would have none. See §9.
 */
function register_incident_where_args(): void {
	register_graphql_fields(
		INCIDENT_WHERE_ARGS,
		array(
			'severityIn' => array(
				'type'        => array( 'list_of' => 'String' ),
				'description' => __( 'Narrow to incidents carrying any of these severity term slugs. The severity taxonomy is a closed set, so a slug outside it is discarded server-side and narrows the result to nothing rather than widening it. There is deliberately no generic taxQuery — Lesson 05.2 §6.', 'blame-the-tech-core' ),
			),
		)
	);
}

/**
 * Translate `severityIn` into exactly one tax_query clause.
 *
 * The intersection with SEVERITY_WEIGHTS is the security property: no
 * caller-supplied string reaches WP_Query, only members of the closed term set.
 * When nothing survives, the clause is still added with an EMPTY term list,
 * which WP_Tax_Query compiles to `0 = 1` — "no matches", never "no filter".
 *
 * @param  array<string,mixed> $query_args WP_Query args WPGraphQL has built.
 * @param  mixed               $source     Unused — a root connection has none.
 * @param  array<string,mixed> $args       This field's GraphQL args, incl. `where`.
 * @param  mixed               $context    Unused.
 * @param  mixed               $info       Unused.
 * @return array<string,mixed>
 */
function apply_severity_in( array $query_args, $source, array $args, $context, $info ): array {
	// Every post-object connection fires this filter. WPGraphQL normalises
	// post_type to an ARRAY before it gets here
	// (PostObjectConnectionResolver::__construct), so compare against a list.
	if ( ! in_array( 'incident', (array) ( $query_args['post_type'] ?? array() ), true ) ) {
		return $query_args;
	}

	$requested = $args['where']['severityIn'] ?? null;

	// Absent or null: add no clause at all. "No filter" and "a filter that
	// matches nothing" have to stay two different answers.
	if ( ! is_array( $requested ) ) {
		return $query_args;
	}

	$allowed = array_intersect(
		array_map( 'sanitize_title', array_filter( $requested, 'is_string' ) ),
		array_keys( SEVERITY_WEIGHTS )
	);

	$clauses   = ( isset( $query_args['tax_query'] ) && is_array( $query_args['tax_query'] ) ) ? $query_args['tax_query'] : array();
	$clauses[] = array(
		'taxonomy' => 'severity',
		'field'    => 'slug',
		'terms'    => array_values( $allowed ),
		'operator' => 'IN',
	);

	$query_args['tax_query'] = $clauses;

	return $query_args;
}

add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_incident_where_args' );
add_filter( 'graphql_post_object_connection_query_args', __NAMESPACE__ . '\\apply_severity_in', 10, 5 );
