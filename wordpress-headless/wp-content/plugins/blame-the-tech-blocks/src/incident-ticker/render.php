<?php
/**
 * Server render for btt/incident-ticker.
 *
 * NOTHING a visitor sees comes from this file. The btt-headless theme redirects
 * every front-end request to Next.js, and Module 14 renders this block from its
 * attributes in TypeScript. This renderer exists for `the_content()`, for
 * Module 17's WordPress-side preview route, and so the block is not invisible to
 * a future non-Next consumer. Lesson 13.4 Key Concept 6 prices that honestly.
 *
 * @package Blame\Blocks
 *
 * @var array<string, mixed> $attributes Validated and defaulted by WordPress.
 * @var string               $content    Serialised inner blocks. Empty here.
 * @var WP_Block             $block      The block instance.
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || exit;

// Locals are prefixed because this file is include()d into a scope we do not own.
// A bare $count or $query is a collision waiting for a WordPress release.
$btt_count = max(1, min(20, (int) ($attributes['count'] ?? 5)));

// Never trust the array. `enum` on an ARRAY's items is not validated by
// prepare_attributes_for_render(), so intersect against the closed set from
// appendix 03 §2 ourselves.
$btt_severities = array_values(
	array_intersect(
		array_map('sanitize_title', (array) ($attributes['severities'] ?? array())),
		array('s1-catastrophic', 's2-major', 's3-minor', 's4-cosmetic')
	)
);

// No severities selected means no query and no markup. `return`, not `return ''`
// — this file's return value is discarded either way, and echoing nothing is the
// documented way for a block to render nothing.
if(array() === $btt_severities) {
	return;
}

$btt_query = new WP_Query(
	array(
		'post_type' => 'incident',
		// Public incidents are created as `pending` by Module 06's mutation.
		// Without this, an admin-context render could leak an unmoderated one.
		'post_status' => 'publish',

		'posts_per_page' => $btt_count,
		'orderby' => 'date',
		'order' => 'DESC',

		// Key Concept 3, one line at a time.
		'fields' => 'ids', // no full WP_Post hydration
		'no_found_rows' => true, // no SELECT FOUND_ROWS(); nothing paginates
		'update_post_meta_cache' => false, // we read no meta
		'update_post_term_cache' => false, // we read no terms
		'ignore_sticky_posts' => true, // "most recent" means most recent

		'tax_query' => array(
			array(
				'taxonomy' => 'severity',
				// Slugs, not term IDs: slugs are stable across machines and term
				// IDs are a property of a table's history (Lesson 12.4).
				'field' => 'slug',
				'terms' => $btt_severities,
			)
		)
	)
);

if(!$btt_query->have_posts()) {
	return;
}

// `fields => ids` means the posts are NOT in the cache, so get_the_title() below
// would be one SELECT each. One deliberate IN() fetch instead of five lookups.
_prime_post_caches($btt_query->posts, false, false);

// get_block_wrapper_attributes() escapes its own output — do NOT wrap it in
// esc_attr(). `data-severities` is hand-written, so that one does need it.
?>
<div
	<?php echo get_block_wrapper_attributes(array('class' => 'btt-incident-ticker')); ?>
	data-severities="<?php echo esc_attr(implode(' ', $btt_severities)); ?>"
>
	<ul>
		<?php foreach($btt_query->posts as $btt_id): ?>
			<li>
				<a href="<?php echo esc_url((string) get_permalink($btt_id)); ?>">
					<?php echo esc_html(get_the_title($btt_id)); ?>
				</a>
			</li>
		<?php endforeach; ?>
	</ul>
</div>
<?php
// wp_reset_postdata() is deliberately absent: `fields => ids` never touched the
// global $post, and `have_posts()` was called without `the_post()`. Calling it
// here would be cargo cult.
