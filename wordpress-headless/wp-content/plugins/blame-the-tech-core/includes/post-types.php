<?php

/**
 * Custom post types.
 *
 * Contract: .lessons/appendix/03-content-model-reference.md
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core;

defined('ABSPATH') || exit;

/**
 * The blog lives under /blog. `post` has no rewrite slug of its own — core
 * builds its permalinks from this option. See Key Concept 7.
 */
const BLOG_PERMALINK_STRUCTURE = '/blog/%postname%/';

add_action('init', __NAMESPACE__ . '\\register_post_types');


/**
 * Register `incident` and `tech_review`.
 *
 * Runs on `init`, and is also called directly by Plugin::activate(), because
 * `init` has not fired for this plugin during its own activation.
 */
function register_post_types(): void
{
	register_post_type(
		'incident',
		array(
			'labels' => array(
				'name' => __('Incidents', 'blame-the-tech-core'),
				'singular_name' => __('Incident', 'blame-the-tech-core'),
				'menu_name' => __('Incidents', 'blame-the-tech-core'),
				'add_new_item' => __('Add New Incident', 'blame-the-tech-core'),
				'edit_item' => __('Edit Incident', 'blame-the-tech-core'),
				'all_items' => __('All Incidents', 'blame-the-tech-core'),
				'not_found' => __('No incidents found.', 'blame-the-tech-core'),
			),
			'description' => __('A publicli submitted outage, moderated before publication.', 'blame-the-tech-core'),

			// ── Visibility ──────────────────────────────────────────────────
			'public' => true,
			'public_queryable' => true,
			'show_ui' => true,
			'show_in_menu' => true,
			'show_in_nav_menus' => false, // navigation comes from core menus, not from this
			'menu_position' => 21,
			'menu_icon' => 'dashicons-warning',

			// ── Consumers ───────────────────────────────────────────────────
			// REQUIRED. The block editor is a REST client; false = white screen.
			'show_in_rest' => true,
			'rest_base' => 'incidents',
			'show_in_graphql' => true,
			'graphql_single_name' => 'Incident',
			'graphql_plural_name' => 'Incidents',

			// ── URLs ────────────────────────────────────────────────────────
			'hierarchical' => false,
			'has_archive' => 'incidents',
			'rewrite' => array(
				'slug' => 'incidents',
				'with_front' => false, // stay out from under the /blog prefix
			),

			// ── Storage ─────────────────────────────────────────────────────
			// `custom-fields` is what exposes the REST `meta` object. Lesson 03.4
			// and ACF both depend on it.
			'supports' => array('title', 'editor', 'revisions', 'author', 'custom-fields'),
			'delete_with_user'    => false, // deleting a reporter must not delete the record

			// ── Authorisation ───────────────────────────────────────────────
			'capability_type' => 'incident',
			'map_meta_cap' => true,
			'capabilities' => array(
				// Without this line `create_posts` falls back to `edit_incidents`
				// and "may submit" cannot be granted separately from "may edit".
				'create_posts' => 'create_incidents',
			),
		)
	);

	register_post_type(
		'tech_review',
		array(
			'labels' => array(
				'name' => __('Tech Reviews', 'blame-the-tech-core'),
				'singular_name' => __('Tech Review', 'blame-the-tech-core'),
				'menu_name' => __('Tech Reviews', 'blame-the-tech-core'),
				'add_new_item' => __('Add New Tech Review', 'blame-the-tech-core'),
				'edit_item' => __('Edit Tech Review', 'blame-the-tech-core'),
				'all_items' => __('All Tech Reviews', 'blame-the-tech-core'),
				'not_found' => __('No tech reviews found.', 'blame-the-tech-core'),
			),
			'description' => __('A satirical review of a company or a tool.', 'blame-the-tech-core'),

			'public' => true,
			'publicly_queryable' => true,
			'show_ui' => true,
			'show_in_menu' => true,
			'show_in_nav_menus' => false,
			'menu_position' => 22,
			'menu_icon' => 'dashicons-star-half',

			'show_in_rest' => true,
			'rest_base' => 'tech-reviews',
			'show_in_graphql' => true,
			'graphql_single_name' => 'TechReview',
			'graphql_plural_name' => 'TechReviews',

			'hierarchical' => false,
			'has_archive' => 'reviews',
			'rewrite' => array(
				'slug' => 'reviews',
				'with_front' => false,
			),

			'supports' => array('title', 'editor', 'thumbnail', 'revisions'),

			// Editor-only content, so core `post` capabilities are correct and
			// nothing needs granting. The cost, stated plainly: you cannot grant
			// review editing without also granting blog-post editing.
			'capability_type'     => 'post',
			'map_meta_cap'        => true,
		)
	);
}

/**
 * Give the generated `incident` capabilities to the roles that should hold all
 * of them.
 *
 * A custom `capability_type` is only half a decision — the other half is who
 * holds it, and until someone does, the Incidents menu does not even render.
 * Lesson 03.5 adds the role that deliberately holds only part of this list.
 */
function grant_incident_caps_to_core_roles(): void
{
	$caps = array(
		'create_incidents',
		'edit_incidents',
		'edit_others_incidents',
		'edit_published_incidents',
		'edit_private_incidents',
		'publish_incidents',
		'read_private_incidents',
		'delete_incidents',
		'delete_others_incidents',
		'delete_published_incidents',
		'delete_private_incidents',
	);

	foreach (array('administrator', 'editor') as $role_name) {
		$role = get_role($role_name);

		if (!$role instanceof \WP_Role) {
			continue;
		}

		foreach ($caps as $cap) {
			// add_cap() writes the whole wp_user_roles option, so only write
			// when something actually changes. This is the idempotency rule
			// from Lesson 03.1 §7 applied to roles.
			if (!$role->has_cap($cap)) {
				$role->add_cap($cap);
			}
		}
	}
}

/**
 * Point the global permalink structure at /blog, once.
 *
 * set_permalink_structure() writes the option AND flushes the rule set, so the
 * early return is what keeps activation cheap on a redeploy.
 */
function ensure_permalink_structure(): void
{
	if (get_option('permalink_structure') === BLOG_PERMALINK_STRUCTURE) {
		return;
	}

	global $wp_rewrite;
	$wp_rewrite->set_permalink_structure(BLOG_PERMALINK_STRUCTURE);
}
