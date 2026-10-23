<?php
/**
 * Plugin Name: Blame The Tech - Blocks
 * Description: Six Gutenberg blocks for Blame The Tech. Built with @wordpress/scripts; registers from build/.
 * Version: 0.1.0
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * Author: Blame The Tech
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: blame-the-tech-blocks
 * Domain Path: /languages
 *
 * @package Blame\Blocks
 */

declare(strict_types=1);

namespace Blame\Blocks;

defined( 'ABSPATH' ) || exit;

const VERSION = '0.1.0';
const PLUGIN_DIR = __DIR__;

/**
 * Every block this plugin owns, in inserter order.
 *
 * One entry per directory under src/. `tech-verdict-card` is Lesson 13.5's
 * optional stretch block and is listed from the start on purpose: the is_dir()
 * guard below means an unbuilt block is silently skipped rather than fatal, so
 * a learner who skips the stretch gets no error and no missing-file notice.
 *
 * @var string[]
 */

const BLOCKS = [
	'incident-callout',
	'blame-quote',
	'scapegoat-picker',
	'incident-ticker',
	'hobt-cta',
	'tech-verdict-card'
];

/**
 * Register every built block with the server-side registry.
 *
 * `init` is the correct hook: earlier and the block type registry does not
 * exist yet, later and REST/GraphQL schema building has already run.
 */
function register_blocks(): void {
	foreach(BLOCKS as $slug) {
		// build/, NEVER src/. wp-scripts copies block.json into build/ next to
		// the compiled index.js, so `file:./index.js` only resolves there.
		// Registering src/ makes the block appear and every rebuild invisible.
		$dir = PLUGIN_DIR . '/build/' . $slug;

		// A fresh clone has no build/ at all — it is gitignored. Degrade to
		// "no blocks", never to a fatal, and never to an admin notice storm.
		if(!is_dir($dir)) {
			continue;
		}

		register_block_type($dir);
	}
}
add_action('init', __NAMESPACE__ . '\\register_blocks');

/**
 * Add the `btt` inserter category.
 *
 * `block_categories_all`, not the 5.8-deprecated `block_categories`: the newer
 * filter also runs for the site editor, which receives a block editor context
 * rather than a WP_Post.
 *
 * @param array<int, array<string, mixed>> $categories Registered categories.
 * @return array<int, array<string, mixed>>
 */
function register_category(array $categories): array {
	// unshift, not push: the inserter renders categories in array order and
	// these are the blocks an editor of THIS site reaches for first.
	array_unshift(
		$categories,
		array(
			'slug' => 'btt',
			'title' => 'Blame The Tech',
			'icon' => null, // A wrong category icon is worse than none.
 		)
	);

	return $categories;
}
add_filter('block_categories_all', __NAMESPACE__ . '\\register_category');

/**
 * Resolve one allowlisted SCF field on a `tech_review`.
 *
 * @param array<string, mixed> $source_args    `args` from the block comment's metadata.bindings.
 * @param \WP_Block            $block          The block instance.
 * @param string               $attribute_name The attribute being resolved.
 * @return string|null The value, or null to leave the attribute alone.
 */
function resolve_review_field( array $source_args, \WP_Block $block, string $attribute_name ): ?string {
	// ALLOWLIST, and it is not optional. Without it this source is a
	// general-purpose "read any SCF field on any post" primitive, callable by
	// anyone who can write a block comment — which is every user with
	// `edit_posts`. Publish the fields you meant to publish.
	$btt_allowed = array('verdict', 'company_name', 'raring_overall');
	$btt_key = (string) ($source_args['key'] ?? '');

	if(! in_array($btt_key, $btt_allowed, true)) {
		return null;
	}

	// Prefer the review this block points at; fall back to the surrounding post,
	// which is what usesContext: ['postId'] provides.
	$btt_slug = (string) ($block->attributes['reviewSlug'] ?? '');
	$btt_post = ' ' !== $btt_slug ? get_page_by_path($btt_slug, OBJECT, 'tech_review') : null;
	$btt_id = $btt_post instanceof \WP_Post ? $btt_post->ID : ($block->context['postId'] ?? 0);

	if(0 === $btt_id || ! function_exists('get_field')) {
		return null;
	}

	$btt_value = get_field($btt_key, $btt_id);

	// Scalars only. Returning an array or an object here would be substituted
	// into an attribute declared `string`, and the failure would surface in
	// Module 14 as a type that does not match the schema.
	return is_scalar( $btt_value ) ? (string) $btt_value : null;
}

/**
 * Register the binding source. `init`, like every other registration here.
 */
function register_binding(): void {
	// Guard: the function is WordPress 6.5+. An older core should degrade to
	// "no bindings", not to a fatal.
	if(!function_exists('register_block_type_binding_source')) {
		return;
	}

	register_block_bindings_source('btt/review-field', array(
		'label' => __( 'Tech review field', 'blame-the-tech-blocks' ),
		'get_value_callback' => __NAMESPACE__ . '\\resolve_review_field',
		'uses_context' => array('postId'),
	));
}
add_action('init', __NAMESPACE__ . '\\register_binding');
