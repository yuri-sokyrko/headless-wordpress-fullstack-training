<?php
/**
 * Taxonomies, their closed term sets, and the severity single-select rule.
 *
 * Contract: .lessons/appendix/03-content-model-reference.md §2
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

/**
 * Seeded on activation. Free-form afterwards — editors may add more.
*/
const SCAPEGOAT_TERMS = array(
	'the-intern'              => 'The Intern',
	'mercury-retrograde'      => 'Mercury Retrograde',
	'legacy-jquery'           => 'Legacy jQuery',
	'dns'                     => 'DNS',
	'solar-flares'            => 'Solar Flares',
	'the-cache'               => 'The Cache',
	'daylight-saving-time'    => 'Daylight Saving Time',
	'that-one-regex'          => 'That One Regex',
	'kubernetes'              => 'Kubernetes',
	'the-previous-contractor' => 'The Previous Contractor',
);

/**
 * CLOSED SET. Four terms, forever. The front end filters on these slugs.
*/
const SEVERITY_TERMS = array(
	's1-catastrophic' => 'S1 — Catastrophic',
	's2-major'        => 'S2 — Major',
	's3-minor'        => 'S3 — Minor',
	's4-cosmetic'     => 'S4 — Cosmetic',
);

/**
 * Seeded, free-form, and shared across three post types.
*/
const TECH_STACK_TERMS = array(
	'react'      => 'React',
	'nextjs'     => 'Next.js',
	'nodejs'     => 'NodeJS',
	'typescript' => 'TypeScript',
	'wordpress'  => 'WordPress',
	'php'        => 'PHP',
	'mysql'      => 'MySQL',
	'aws'        => 'AWS',
	'docker'     => 'Docker',
	'kubernetes' => 'Kubernetes',
	'jquery'     => 'jQuery',
	'redis'      => 'Redis',
);

// Registered after post-types.php, because Plugin::boot() requires that file
// first and callbacks on the same hook run in registration order.
add_action( 'init', __NAMESPACE__ . '\\register_taxonomies' );

/**
 * Arguments every taxonomy here shares. Each call below overrides only what
 * differs — and the override list is the interesting part.
 *
 * @param  string $single       graphql_single_name.
 * @param  string $plural       graphql_plural_name.
 * @param  string $rewrite_slug URL segment for the term archive.
 * @return array<string, mixed>
 */
function taxonomy_defaults( string $single, string $plural, string $rewrite_slug ): array {
	return array(
		'public'              => true,
		'publicly_queryable'  => true,
		'hierarchical'        => false,
		'show_ui'             => true,
		'show_in_menu'        => true,
		'show_in_nav_menus'   => false, // navigation comes from core menus
		'show_admin_column'   => true,  // a column on the post list, free
		'show_in_rest'        => true,  // keep Gutenberg's own term panel
		'show_in_graphql'     => true,
		'graphql_single_name' => $single,
		'graphql_plural_name' => $plural,
		'rewrite'             => array(
			'slug'       => $rewrite_slug,
			'with_front' => false, // stay out from under the /blog prefix
		),
	);
}

/**
 * Register `scapegoat`, `severity` and `tech_stack`.
 *
 * Runs on `init`, and is called directly by Plugin::activate() before terms are
 * seeded, because `wp_insert_term()` rejects an unregistered taxonomy.
 */
function register_taxonomies(): void {
	register_taxonomy(
		'scapegoat',
		array( 'incident' ),
		array_merge(
			taxonomy_defaults( 'Scapegoat', 'Scapegoats', 'scapegoats' ),
			array(
				'labels'       => array(
					'name'          => __( 'Scapegoats', 'blame-the-tech-core' ),
					'singular_name' => __( 'Scapegoat', 'blame-the-tech-core' ),
				),
				'rest_base'    => 'scapegoats',
				'capabilities' => array(
					'manage_terms' => 'manage_categories',
					'edit_terms'   => 'manage_categories',
					'delete_terms' => 'manage_categories',
					'assign_terms' => 'edit_incidents',
				),
			),
		)
	);

	register_taxonomy(
		'severity',
		array( 'incident' ),
		array_merge(
			taxonomy_defaults( 'Severity', 'Severities', 'severity' ),
			array(
				'labels'             => array(
					'name'          => __( 'Severities', 'blame-the-tech-core' ),
					'singular_name' => __( 'Severity', 'blame-the-tech-core' ),
				),

				// There is nothing to manage: the set is closed.
				'show_in_menu'       => false,
				'show_in_quick_edit' => false, // one more surface to get it wrong on.

				// HIERARCHICAL IS A UI DECISION HERE, NOT A DATA ONE. Severities have
				// no parents and never will. What `true` buys is the block editor's
				// category-style CHECKBOX panel instead of the free-text token input
				// Gutenberg draws for a flat taxonomy — the closed set rendered as a
				// closed set, with no JS build step.
				//
				// A custom `meta_box_cb` cannot do this job: core adds EVERY taxonomy
				// meta box with `__back_compat_meta_box => true`
				// (wp-admin/includes/meta-boxes.php), and the block editor skips every
				// box carrying that flag (wp-admin/includes/post.php). Such a callback
				// renders only in the classic editor, so pairing it with
				// `show_in_rest => false` produces no severity UI at all.
				//
				// `show_in_rest` stays true (from taxonomy_defaults) because the panel
				// needs it — which also means Gutenberg writes terms over REST and
				// never reaches a `save_post` handler. Single-select is therefore
				// enforced on `set_object_terms` below: the one chokepoint REST, the
				// classic editor, WP-CLI and the seeder all pass through.
				'hierarchical'       => true,

				// CLOSED MEANS CLOSED — including for administrators, including in
				// the editor. Gutenberg renders its "Add New" form whenever the REST
				// response advertises `wp:action-create-severity`, and core adds that
				// link for anyone holding `edit_terms`. Leaving that as
				// `manage_options` therefore put a category-creation form in the
				// sidebar for every admin, which is precisely the thing a closed set
				// must not have.
				//
				// `do_not_allow` is WordPress's idiom for "no role, ever" — it also
				// removes the add/delete forms from edit-tags.php. `manage_terms`
				// stays, so an admin can still READ the list at
				// /wp-admin/edit-tags.php?taxonomy=severity while being unable to
				// change it.
				//
				// This does not block seeding: `wp_insert_term()` is a low-level
				// function with no capability check, so seed_default_terms() below is
				// unaffected. The set is defined in SEVERITY_TERMS and changed by
				// editing code, which is the whole point of calling it closed.
				'capabilities'       => array(
					'manage_terms' => 'manage_options', // read the list
					'edit_terms'   => 'do_not_allow',   // nobody creates or renames
					'delete_terms' => 'do_not_allow',   // nobody deletes
					'assign_terms' => 'edit_incidents', // editors still tick a box
				),
			)
		)
	);

	register_taxonomy(
		'tech_stack',
		array( 'incident', 'tech_review', 'post' ), // three object types on purpose
		array_merge(
			taxonomy_defaults( 'TechStack', 'TechStacks', 'stack' ),
			array(
				'labels'    => array(
					'name'          => __( 'Tech Stack', 'blame-the-tech-core' ),
					'singular_name' => __( 'Technology', 'blame-the-tech-core' ),
				),
				'rest_base' => 'tech-stack',
			)
		)
	);
}

add_action( 'set_object_terms', __NAMESPACE__ . '\\enforce_single_severity', 10, 6 );

/**
 * Collapse a multi-term severity assignment back to one.
 *
 * The checkbox panel lets an editor tick four boxes. Nothing in WordPress stops
 * them, because "one term" is our rule, not core's — there is no `single` flag
 * on a taxonomy, hierarchical or otherwise.
 *
 * This runs on `set_object_terms`, which fires *after* the write, for every
 * caller: the REST request Gutenberg sends, a classic `$_POST`, `wp term add`,
 * and the Module 04 seeder. Enforcing here rather than in a `save_post` handler
 * is the whole point — a `save_post` guard would never see Gutenberg's write.
 *
 * When more than one term arrives, the one the editor just ticked wins, which is
 * what "click S1 while S2 is set" should obviously do. `$old_tt_ids` is what
 * makes that distinguishable from the set that was already there.
 *
 * @param int    $object_id  Object ID.
 * @param mixed  $terms      Terms as passed to wp_set_object_terms().
 * @param int[]  $tt_ids     Term taxonomy IDs now assigned.
 * @param string $taxonomy   Taxonomy slug.
 * @param bool   $append     Whether terms were appended.
 * @param int[]  $old_tt_ids Term taxonomy IDs assigned before this write.
 */
function enforce_single_severity(
	int $object_id,
	$terms,
	array $tt_ids,
	string $taxonomy,
	bool $append,
	array $old_tt_ids
): void {
	// Re-entrancy guard: the corrective write below fires this hook again.
	static $collapsing = false;

	if ( 'severity' !== $taxonomy || $collapsing ) {
		return;
	}

	// Read the RESULT, never `count($tt_ids)`. On an append core passes only the
	// tt_ids this call added, so a second term arriving next to an existing one
	// shows up here as a single-element $tt_ids while the object now has two.
	$current = wp_get_object_terms( $object_id, 'severity' );

	if ( is_wp_error( $current ) || count( $current ) <= 1 ) {
		return;
	}

	// tt_ids introduced by THIS write: on an append that is exactly the new set,
	// otherwise whatever was not already assigned.
	$added   = array_values( array_diff( $tt_ids, $old_tt_ids ) );
	$keep_tt = (int) ( $added[0] ?? ( $tt_ids[0] ?? 0 ) );

	$keep = null;

	foreach ( $current as $term ) {
		if ( (int) $term->term_taxonomy_id === $keep_tt ) {
			$keep = $term;
			break;
		}
	}

	$keep = $keep ?? $current[0];

	$collapsing = true;
	wp_set_object_terms( $object_id, array( $keep->term_id ), 'severity', false );
	$collapsing = false;

	// Observable, so Module 23 can assert on it and the CLI can report it,
	// rather than a silent correction the editor never learns about.
	do_action( 'btt_severity_collapsed', $object_id, (int) $keep->term_id, $current );
}

/**
 * Create the 24 seeded terms. Safe to run on every deploy.
 *
 * @return int Number of terms created by this call.
 */
function seed_default_terms(): int {
	$created = 0;
	$seed    = array(
		'scapegoat'  => SCAPEGOAT_TERMS,
		'severity'   => SEVERITY_TERMS,
		'tech_stack' => TECH_STACK_TERMS,
	);

	foreach ( $seed as $taxonomy => $terms ) {
		foreach ( $terms as $slug => $name ) {
			// Idempotency keyed on the SLUG. Not the name (editors rename), not
			// the ID (IDs differ between your machine, CI and production).
			if ( null !== term_exists( $slug, $taxonomy ) ) {
				continue;
			}

			$result = wp_insert_term( $name, $taxonomy, array( 'slug' => $slug ) );

			if ( is_wp_error( $result ) ) {
				// An action rather than error_log(), so the CLI can report it
				// and Module 23's tests can assert on it.
				do_action( 'btt_term_seed_failed', $taxonomy, $slug, $result );
				continue;
			}

			++$created;
		}
	}

	return $created;
}
