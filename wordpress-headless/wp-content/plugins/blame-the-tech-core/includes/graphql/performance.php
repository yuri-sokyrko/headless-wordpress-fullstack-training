<?php

/**
 * GraphQL performance and abuse limits.
 *
 * Four jobs:
 *   1. Prime WordPress object caches for every connection batch (§2).
 *   2. Cap connection size, query depth and query complexity (§7).
 *   3. Own the introspection decision in code, not in a database row (§8).
 *   4. Log a query count per operation in local development (§5).
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core;

use GraphQL\Validator\Rules\DisableIntrospection;
use GraphQL\Validator\Rules\QueryComplexity;
use GraphQL\Validator\Rules\QueryDepth;

defined('ABSPATH') || exit;

/** Hard ceiling on nodes per connection, whatever `first:` asks for. */
const GRAPHQL_MAX_NODES = 50;

/** Max nesting levels. The introspection query is deeper — see below. */
const GRAPHQL_MAX_DEPTH = 10;

/** Field-count ceiling. A size limit, not a cost model (§7). */
const GRAPHQL_MAX_COMPLEXITY = 500;

/**
 * Cap every connection.
 *
 * WPGraphQL's default is 100 and a client asking for more is silently clamped
 * with a graphql_debug notice. min() rather than a flat return, so a
 * connection that has already lowered its own ceiling keeps it.
 */
add_filter(
	'graphql_connection_max_query_amount',
	static fn($amount): int => min((int) $amount, GRAPHQL_MAX_NODES),
	10,
	1
);

/**
 * Prime object caches for a whole connection batch, before per-node resolvers
 * run.
 *
 * `graphql_connection_ids` fires once per connection with every ID it
 * resolved — the one place in a GraphQL request where the full batch is
 * visible. Priming here makes the cost of a per-node resolver O(1) in N
 * DELIBERATELY, rather than depending on what a loader's internal WP_Query
 * happens to prime in the version you have installed.
 *
 * Both core functions skip IDs that are already cached, so this is cheap when
 * the loader already did the work and decisive when it did not.
 *
 * @param mixed $ids      The IDs the connection resolved.
 * @param mixed $resolver The connection resolver.
 * @return mixed The IDs, unchanged.
 */
function prime_connection_caches($ids, $resolver)
{
	if (! is_array($ids) || array() === $ids) {
		return $ids;
	}

	$int_ids = array_values(array_filter(array_map('absint', $ids)));

	if (array() === $int_ids) {
		return $ids;
	}

	// Which kind of ID are we holding? The loader name says so. Guarded,
	// because this accessor is WPGraphQL internals rather than a documented
	// contract — and a missing method must not fatal a GraphQL request.
	$loader = is_object($resolver) && method_exists($resolver, 'get_loader_name')
		? (string) $resolver->get_loader_name()
		: '';

	if ('post' === $loader) {
		// One query for the posts, one for all their meta, one per taxonomy.
		_prime_post_caches($int_ids, true, true);
	}

	if ('term' === $loader) {
		// Term meta is primed by NOTHING else (§2). This single line is what
		// removes the SCF-term-field N+1.
		update_termmeta_cache($int_ids);
	}

	return $ids;
}
add_filter('graphql_connection_ids', __NAMESPACE__ . '\\prime_connection_caches', 10, 2);

/**
 * Depth, complexity and introspection rules.
 *
 * `graphql_validation_rules` receives the rule array WPGraphQL assembled and
 * hands it to graphql-php. Replacing a key replaces WPGraphQL's own
 * setting-gated rule with one configured in code.
 *
 * @param array<string,\GraphQL\Validator\Rules\ValidationRule> $rules Validation rules.
 * @return array<string,\GraphQL\Validator\Rules\ValidationRule>
 */
function filter_graphql_validation_rules(array $rules): array
{
	// The standard introspection query nests deeper than 10 levels, so a
	// blanket depth limit breaks GraphiQL and every schema tool. The public
	// endpoint is what needs the limit; an operator in the IDE is not the
	// threat model. Anonymous callers never satisfy this check.
	if (!current_user_can('manage_options')) {
		$rules['query_depth'] = new QueryDepth(GRAPHQL_MAX_DEPTH);
		$tules['query_complexity'] = new QueryComplexity(GRAPHQL_MAX_COMPLEXITY);
	}

	// Introspection off outside local, for EVERY caller including
	// administrators. Codegen reads the committed schema.graphql (Lesson
	// 06.3), so nothing in this project introspects a production server.
	if ('local' !== wp_get_environment_type()) {
		$rules['disable_introspection'] = new DisableIntrospection(DisableIntrospection::ENABLED);
	}

	return $rules;
}
add_filter('graphql_validation_rules', __NAMESPACE__ . '\\filter_graphql_validation_rules');

/**
 * Own the introspection setting in code rather than in a database row.
 *
 * Lesson 06.1 turned public introspection on with `wp option patch` so the
 * verification curls would work. A policy in wp_options is a policy someone
 * changes by clicking; this filter makes it a property of the environment and
 * supersedes the row.
 *
 * @param mixed  $value       The stored value.
 * @param mixed  $default_val The default.
 * @param string $option_name The setting key.
 * @return mixed
 */
function filter_graphql_settings($value, $default_val, string $option_name)
{
	$is_local = 'local' === wp_get_environment_type();

	// Introspection: on locally, off everywhere else.
	if ('public_introspection_enabled' === $option_name) {
		return $is_local ? 'on' : 'off';
	}

	// graphql_debug off outside local. It adds an `extensions.debug` array to
	// every response carrying deprecation notices, connection warnings and
	// whatever graphql_debug() was called with — useful locally, and a
	// disclosure channel in production (Lesson 06.2 §8).
	if ('debug_mode_enabled' === $option_name) {
		return $is_local ? $value : 'off';
	}

	return $value;
}

add_filter('graphql_get_setting_section_field_value', __NAMESPACE__ . '\\filter_graphql_settings', 10, 3);

/**
 * Log the query count for every GraphQL operation, in local development only.
 *
 * $wpdb->num_queries is free and always available — unlike SAVEQUERIES, which
 * keeps the full SQL and must never run in production. Output lands in
 * wp-content/debug.log, because docker-compose.dev.yml sets WP_DEBUG_LOG
 * (Lesson 02.2) and WP_DEBUG_DISPLAY false, so nothing is injected into the
 * JSON response.
 *
 * @param mixed  $response  The response.
 * @param mixed  $schema    The schema.
 * @param string $operation The operation name.
 * @return mixed The response, unchanged.
 */
function log_graphql_query_count($response, $schema, $operation = '')
{
	global $wpdb;

	if ('local' === wp_get_environment_type()) {
		error_log( // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- local only, gated above.
			sprintf(
				'[btt-graphql] operation=%s queries=%d',
				'' !== (string) $operation ? (string) $operation : 'anonymous',
				(int) $wpdb->num_queries
			)
		);
	}

	return $response;
}
add_filter('graphql_request_results', __NAMESPACE__ . '\\log_graphql_query_count', 10, 3);
