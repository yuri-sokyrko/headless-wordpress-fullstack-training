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
