<?php
/**
 * The `createIncident` mutation.
 *
 * Replaces WPGraphQL's generated createIncident, which accepts a client-chosen
 * post_status and authorId. Contract: appendix 03 §7.
 *
 * Order inside mutateAndGetPayload is authenticate → authorise → sanitise →
 * validate → write, and it is not negotiable (Lesson 06.2 §3).
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
 * Resolve a term slug to a term ID, or fail.
 *
 * sanitize_key() proves the SHAPE of a slug. Only a lookup proves it EXISTS.
 * The term ID is what gets passed to wp_set_object_terms(), because that
 * function will CREATE a term when handed a string it cannot find.
 *
 * @throws \GraphQL\Error\UserError If no term with that slug exists.
 */
function require_term_id( mixed $raw_slug, string $taxonomy, string $label ): int {
	$slug = sanitize_key( (string) $raw_slug );
	$term = '' === $slug ? false : get_term_by( 'slug', $slug, $taxonomy );

	if ( ! $term instanceof \WP_Term ) {
		/* translators: %s: human-readable taxonomy label, e.g. "severity". */
		throw new UserError( sprintf( __( 'That %s does not exist.', 'blame-the-tech-core' ), $label ) );
	}

	return (int) $term->term_id;
}

/**
 * Validate a client-supplied date-time and return it as MySQL GMT.
 *
 * Rejects rather than corrects. An incident in the future is a typo or a
 * probe; silently clamping it to `now` stores a fact nobody asserted.
 *
 * @throws \GraphQL\Error\UserError If unparseable or in the future.
 */
function require_past_datetime( mixed $raw ): string {
	$time = strtotime( sanitize_text_field( (string) $raw ) );

	if ( false === $time || $time > time() ) {
		throw new UserError( __( 'occurredAt must be a valid date and time that is not in the future.', 'blame-the-tech-core' ) );
	}

	return gmdate( 'Y-m-d H:i:s', $time );
}

/**
 * Input fields for createIncident. `clientMutationId` is added by WPGraphQL.
 */
function create_incident_input_fields(): array {
	return array(
		'title'               => array(
			'type'        => array( 'non_null' => 'String' ),
			'description' => __( 'Incident headline. Plain text; markup is stripped.', 'blame-the-tech-core' ),
		),
		'body'                => array(
			'type'        => 'String',
			'description' => __( 'What happened, as post content. A safe subset of HTML is kept.', 'blame-the-tech-core' ),
		),
		'scapegoatSlug'       => array(
			'type'        => array( 'non_null' => 'String' ),
			'description' => __( 'Slug of an EXISTING scapegoat term. Unknown slugs are rejected; no term is ever created.', 'blame-the-tech-core' ),
		),
		'severitySlug'        => array(
			'type'        => array( 'non_null' => 'String' ),
			'description' => __( 'Slug of one of the four severity terms. The set is closed.', 'blame-the-tech-core' ),
		),
		'occurredAt'          => array(
			'type'        => array( 'non_null' => 'String' ),
			'description' => __( 'When it happened. Anything strtotime() understands, and not in the future.', 'blame-the-tech-core' ),
		),
		'downtimeMinutes'     => array(
			'type'        => array( 'non_null' => 'Int' ),
			'description' => __( 'Minutes of downtime, 0–100000.', 'blame-the-tech-core' ),
		),
		'estimatedCostUsd'    => array(
			'type'        => 'Float',
			'description' => __( 'Estimated cost in USD. Optional, must not be negative.', 'blame-the-tech-core' ),
		),
		'environment'         => array(
			'type'        => array( 'non_null' => 'IncidentEnvironment' ),
			'description' => __( 'Where it happened. A real enum, so an illegal value never reaches this resolver.', 'blame-the-tech-core' ),
		),
		'resolutionStatus'    => array(
			'type'        => 'IncidentResolutionStatus',
			'description' => __( 'Defaults to OPEN when omitted.', 'blame-the-tech-core' ),
		),
		'blameConfidence'     => array(
			'type'        => 'Float',
			'description' => __( 'How sure the reporter is, 0–100. Defaults to 73.', 'blame-the-tech-core' ),
		),
		'stackTrace'          => array(
			'type'        => 'String',
			'description' => __( 'Optional stack trace. Stored as plain text and rendered escaped inside <pre>.', 'blame-the-tech-core' ),
		),
		'reporterDisplayName' => array(
			'type'        => 'String',
			'description' => __( 'Display name to credit. Defaults to the authenticated user’s display name.', 'blame-the-tech-core' ),
		),
		// The two fields that teach the trust boundary. Both are PARSED.
		// Neither is trusted. See Lesson 06.2 §5 before deleting them.
		'status'              => array(
			'type'        => 'PostStatusEnum',
			'description' => __( 'ACCEPTED AND ALWAYS IGNORED. Every incident is created as `pending`; moderation happens in wp-admin. Present so that clients sending it get a created incident rather than a schema error.', 'blame-the-tech-core' ),
		),
		'isVerified'          => array(
			'type'        => 'Boolean',
			'description' => __( 'Honoured only for callers holding `edit_others_incidents`. Silently discarded for everyone else — a field in an input type is not permission to set it.', 'blame-the-tech-core' ),
		),
	);
}

/**
 * Create a pending incident on behalf of the authenticated user.
 *
 * @throws \GraphQL\Error\UserError On any authorisation or validation failure.
 * @return array{postObjectId: int}
 */
function create_incident_payload( array $input, AppContext $context, ResolveInfo $info ): array {
	// ── 1. AUTHENTICATE ────────────────────────────────────────────────
	if ( ! is_user_logged_in() ) {
		throw new UserError( __( 'You must be signed in to submit an incident.', 'blame-the-tech-core' ) );
	}

	// ── 2. AUTHORISE ───────────────────────────────────────────────────
	// WPGraphQL does NOT do this for you. Without these three lines the
	// mutation runs for anyone who can reach /graphql (Lesson 06.2 §2).
	if ( ! current_user_can( 'create_incidents' ) ) {
		throw new UserError( __( 'You are not allowed to submit incidents.', 'blame-the-tech-core' ) );
	}

	// The `incident_submission_open` kill switch from appendix 03 §4.5 is
	// honoured by the Server Action in Module 16. It is deliberately NOT
	// checked here: it is a content setting, not an authorisation decision,
	// and a mutation that fails closed when an SCF options page has never
	// been saved takes the submission form down for a reason nobody can see.

	// ── 3. SANITISE ────────────────────────────────────────────────────
	$title    = sanitize_text_field( (string) ( $input['title'] ?? '' ) );
	$body     = wp_kses_post( (string) ( $input['body'] ?? '' ) );
	$trace    = sanitize_textarea_field( (string) ( $input['stackTrace'] ?? '' ) );
	$downtime = absint( $input['downtimeMinutes'] ?? 0 );
	$cost     = (float) ( $input['estimatedCostUsd'] ?? 0 );
	$blame    = isset( $input['blameConfidence'] ) ? (float) $input['blameConfidence'] : 73.0;
	$reporter = sanitize_text_field( (string) ( $input['reporterDisplayName'] ?? '' ) );

	// Enum inputs arrive as the STORED kebab-case value already — graphql-php
	// mapped SCREAMING_SNAKE to it (Lesson 06.1 §4). Re-assert anyway: this
	// value is about to be written to wp_postmeta.
	$environment = normalize_stored_value( 'IncidentEnvironment', $input['environment'] ?? '' );
	$resolution  = normalize_stored_value( 'IncidentResolutionStatus', $input['resolutionStatus'] ?? 'open' ) ?? 'open';

	// ── 4. VALIDATE ────────────────────────────────────────────────────
	// Everything here runs BEFORE wp_insert_post(), so a rejected request
	// leaves nothing behind. `String!` accepts "" — non-null is not non-empty.
	if ( '' === $title ) {
		throw new UserError( __( 'A title is required.', 'blame-the-tech-core' ) );
	}

	if ( mb_strlen( $title ) > 200 ) {
		throw new UserError( __( 'The title is too long.', 'blame-the-tech-core' ) );
	}

	if ( $downtime > 100000 ) {
		throw new UserError( __( 'downtimeMinutes must be between 0 and 100000.', 'blame-the-tech-core' ) );
	}

	if ( $cost < 0 || $cost > 1000000000 ) {
		throw new UserError( __( 'estimatedCostUsd is out of range.', 'blame-the-tech-core' ) );
	}

	if ( $blame < 0 || $blame > 100 ) {
		throw new UserError( __( 'blameConfidence must be between 0 and 100.', 'blame-the-tech-core' ) );
	}

	if ( null === $environment ) {
		throw new UserError( __( 'environment is not a recognised value.', 'blame-the-tech-core' ) );
	}

	$occurred_at = require_past_datetime( $input['occurredAt'] ?? '' );

	// Term existence, before the insert — otherwise a bad slug leaves an
	// orphan post behind (Lesson 06.2 §3).
	$scapegoat_id = require_term_id( $input['scapegoatSlug'] ?? '', 'scapegoat', __( 'scapegoat', 'blame-the-tech-core' ) );
	$severity_id  = require_term_id( $input['severitySlug'] ?? '', 'severity', __( 'severity', 'blame-the-tech-core' ) );

	// ── 5. WRITE ───────────────────────────────────────────────────────
	$post_id = wp_insert_post(
		array(
			'post_type'    => 'incident',
			'post_title'   => $title,
			'post_content' => $body,
			// FORCED. Not read from $input. $input['status'] is discarded here
			// and this is the line Lesson 05.5 promised.
			'post_status'  => 'pending',
			// FORCED. There is no code path by which a caller attributes an
			// incident to somebody else.
			'post_author'  => get_current_user_id(),
		),
		true
	);

	if ( is_wp_error( $post_id ) ) {
		// The WP_Error message can name tables and columns. Log it, do not
		// return it (Lesson 06.2 §8).
		graphql_debug( 'wp_insert_post failed: ' . $post_id->get_error_message() );

		throw new UserError( __( 'The incident could not be saved.', 'blame-the-tech-core' ) );
	}

	$post_id = (int) $post_id;

	// Term IDs, never strings: wp_set_object_terms() creates terms from
	// strings it cannot find, and creates nothing from an integer.
	wp_set_object_terms( $post_id, array( $scapegoat_id ), 'scapegoat', false );
	wp_set_object_terms( $post_id, array( $severity_id ), 'severity', false );

	update_post_meta( $post_id, 'occurred_at', $occurred_at );
	update_post_meta( $post_id, 'downtime_minutes', $downtime );
	update_post_meta( $post_id, 'estimated_cost_usd', $cost );
	update_post_meta( $post_id, 'environment', $environment );
	update_post_meta( $post_id, 'resolution_status', $resolution );
	update_post_meta( $post_id, 'blame_confidence', $blame );
	update_post_meta( $post_id, 'stack_trace', $trace );
	update_post_meta(
		$post_id,
		'reporter_display_name',
		'' !== $reporter ? $reporter : wp_get_current_user()->display_name
	);

	// `is_verified` is a MODERATION fact. A client value is honoured only for
	// a caller who could set it in wp-admin anyway; otherwise it is discarded
	// without comment and the field is written false.
	$verified = current_user_can( 'edit_others_incidents' ) && ! empty( $input['isVerified'] );
	update_post_meta( $post_id, 'is_verified', $verified );

	return array( 'postObjectId' => $post_id );
}

/**
 * Register the mutation.
 */
function register_create_incident_mutation(): void {
	register_graphql_mutation(
		'createIncident',
		array(
			'description'         => __( 'Submit an incident for moderation. Always creates a `pending` post authored by the authenticated user. Requires the `create_incidents` capability.', 'blame-the-tech-core' ),
			'inputFields'         => create_incident_input_fields(),
			'outputFields'        => array(
				'incident' => array(
					'type'        => 'Incident',
					'description' => __( 'The created incident, always with status `pending`.', 'blame-the-tech-core' ),
					// $source is the array returned by mutateAndGetPayload.
					// Resolve through the LOADER so a mutate-then-read round
					// trip costs one query, not two (Lesson 06.4).
					'resolve'     => static function ( $payload, array $args, AppContext $context, ResolveInfo $info ) {
						if ( empty( $payload['postObjectId'] ) ) {
							return null;
						}

						return $context->get_loader( 'post' )->load_deferred( (int) $payload['postObjectId'] );
					},
				),
			),
			'mutateAndGetPayload' => __NAMESPACE__ . '\\create_incident_payload',
		)
	);
}
add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_create_incident_mutation' );
