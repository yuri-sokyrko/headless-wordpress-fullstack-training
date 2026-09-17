<?php

/**
 * Deterministic fixture content for `wp blame seed`.
 *
 * Every value here comes from a constant or from the loop index. Nothing reads
 * the clock, a random source, or a database id.
 *
 * Counts are fixed by appendix 03 section 9: 40 incidents, 8 reviews, 10 posts,
 * 3 pages, 3 users, 12 media.
 *
 * @package Blame\Core
 */

declare(strict_types=1);

namespace Blame\Core\CLI;

use WP_CLI;

defined('ABSPATH') || exit;

if (! defined('WP_CLI') || ! WP_CLI) {
	return;
}

/** Bumped whenever the fixture content changes shape. */
const SEED_VERSION = '1.0.0';

/** The seeder's only clock. Never time(), never current_time(). */
const SEED_EPOCH = '2024-09-02 08:00:00';

/** Stamped on everything the seeder creates, so reset deletes only its own work. */
const SEED_MARKER = '_btt_seeded';

/** Verdict values as stored — appendix 03 section 3. Lesson 06.1 maps them to an enum. */
const SEED_VERDICTS = array('adopt', 'trial', 'assess', 'hold');

/** The three fixture accounts. Passwords come from the named environment variables. */
const SEED_USERS = array(
	'editor'    => array(
		'role'    => 'editor',
		'email'   => 'editor@blamethe.tech',
		'display' => 'Dana Editor',
		'env'     => 'BTT_EDITOR_PASSWORD',
	),
	'reporter'  => array(
		'role'    => 'incident_reporter',
		'email'   => 'reporter@blamethe.tech',
		'display' => 'Sam Reporter',
		'env'     => 'BTT_REPORTER_PASSWORD',
	),
	'e2e_agent' => array(
		'role'    => 'incident_reporter',
		'email'   => 'e2e@blamethe.tech',
		'display' => 'E2E Agent',
		'env'     => 'BTT_E2E_PASSWORD',
	),
);

/** slug => title, for the twelve checked-in JPEGs. The slug IS the filename. */
const SEED_MEDIA = array(
	'review-logo-01'    => 'Hyperscale Cloud Co logo',
	'review-logo-02'    => 'Monolith Systems logo',
	'review-logo-03'    => 'Serverless Nights logo',
	'review-logo-04'    => 'Deprecate.io logo',
	'review-logo-05'    => 'YAML Industries logo',
	'review-logo-06'    => 'Rewrite Rules Ltd logo',
	'review-logo-07'    => 'Eventual Consistency AG logo',
	'review-logo-08'    => 'Blameless Kubernetes logo',
	'hero-home'         => 'Home hero',
	'hero-about'        => 'About hero',
	'hero-hobt'         => 'HOBT hero',
	'avatar-the-intern' => 'The Intern',
);

/** Eight companies, in a fixed order matching review-logo-01..08. */
const SEED_COMPANIES = array(
	'Hyperscale Cloud Co',
	'Monolith Systems',
	'Serverless Nights',
	'Deprecate.io',
	'YAML Industries',
	'Rewrite Rules Ltd',
	'Eventual Consistency AG',
	'Blameless Kubernetes',
);

/** Ten headlines, cycled across the forty incidents and numbered. */
const SEED_HEADLINES = array(
	'Deployed on a Friday',
	'The certificate expired',
	'Someone rotated the wrong key',
	'The cron job ran twice',
	'A regex ate the payload',
	'The cache never invalidated',
	'DNS propagated to nowhere',
	'The migration ran backwards',
	'Autoscaling scaled to zero',
	'A leap second in the log parser',
);

/** Eight reporter display names, cycled. Denormalised — appendix 03 section 4.1. */
const SEED_REPORTERS = array(
	'Ada L.',
	'Grace H.',
	'Linus T.',
	'Barbara L.',
	'Ken T.',
	'Margaret H.',
	'Dennis R.',
	'Radia P.',
);

/**
 * A fixed date, offset from SEED_EPOCH, as BOTH date columns.
 *
 * DateInterval rather than modify(), so the return type is never false.
 *
 * @return array{post_date: string, post_date_gmt: string}
 */
function seed_date(int $days_after, int $hours_after = 0): array
{
	$when = (new \DateTimeImmutable(SEED_EPOCH, new \DateTimeZone('UTC')))
		->add(new \DateInterval(sprintf('P%dDT%dH', $days_after, $hours_after)));

	$stamp = $when->format('Y-m-d H:i:s');

	// Both columns, both UTC, both explicit. assert_seed_environment() has
	// already pinned the site timezone to UTC, so the two are the same string
	// and neither is derived from an option — Key Concept 3.
	return array(
		'post_date'     => $stamp,
		'post_date_gmt' => $stamp,
	);
}

/**
 * Resolve a term SLUG to its id. Slug in, id out — rule 1 from Key Concept 3.
 */
function term_id(string $slug, string $taxonomy): int
{
	$term = get_term_by('slug', $slug, $taxonomy);

	if (! $term instanceof \WP_Term) {
		WP_CLI::error(
			sprintf(
				'Term "%s" is missing from %s. Re-activate blame-the-tech-core to seed terms (Lesson 03.3).',
				$slug,
				$taxonomy
			)
		);
	}

	return (int) $term->term_id;
}

/**
 * Create or update a post identified by its SLUG, never by an id.
 *
 * @param array<string, mixed> $postarr Arguments for wp_insert_post().
 */
function upsert_post(array $postarr): int
{
	$existing = get_page_by_path(
		(string) $postarr['post_name'],
		OBJECT,
		(string) $postarr['post_type']
	);

	if ($existing instanceof \WP_Post) {
		$postarr['ID'] = (int) $existing->ID;
	}

	// wp_insert_post() calls wp_unslash() on what you give it, so unslashed
	// input silently loses every backslash — which matters in a stack trace.
	$id = wp_insert_post(wp_slash($postarr), true);

	if (is_wp_error($id)) {
		WP_CLI::error(sprintf('Insert failed for %s: %s', $postarr['post_name'], $id->get_error_message()));
	}

	update_post_meta((int) $id, SEED_MARKER, 1);

	return (int) $id;
}

/**
 * Everything that must be true before a single row is written.
 */
function assert_seed_environment(): void
{
	$missing = array();

	foreach (SEED_USERS as $login => $spec) {
		// A password is only REQUIRED to create an account. Re-seeding content
		// against a database that already holds the three accounts must not ask
		// for the credentials again — Module 05 re-runs this seeder without them,
		// and a seeder that demands a secret it does not need is a seeder people
		// work around.
		if (get_user_by('login', $login) instanceof \WP_User) {
			continue;
		}

		if ('' === (string) getenv($spec['env'])) {
			$missing[] = $spec['env'];
		}
	}

	if (array() !== $missing) {
		// Fail loudly. Inventing a password here would create three accounts
		// nobody can log into, with a green exit code.
		WP_CLI::error(
			'Missing password variables: ' . implode(', ', $missing)
				. '. Export them into this shell and pass them through with -e. Never into a file.'
		);
	}

	// One clock. WordPress derives whichever date column you omit using the site
	// timezone, so two installs on different zones disagree. Write only if it
	// differs — the Module 03 idempotency rule.
	if ('UTC' !== (string) get_option('timezone_string')) {
		update_option('timezone_string', 'UTC');
		update_option('gmt_offset', 0);
		WP_CLI::log('pinned the site timezone to UTC');
	}

	// One home URL. Serialized option values embed it with a byte-length prefix,
	// so a fixture seeded under one WP_HOME is not portable to another without
	// `wp search-replace` — Key Concepts 5 and 9.
	$home     = untrailingslashit((string) get_option('home'));
	$recorded = untrailingslashit((string) get_option('btt_seed_home', ''));

	if ('' !== $recorded && $recorded !== $home) {
		WP_CLI::warning(
			sprintf(
				'This database was seeded under %1$s and is running under %2$s. Run: wp search-replace %1$s %2$s --all-tables',
				$recorded,
				$home
			)
		);
	}

	if ($recorded !== $home) {
		update_option('btt_seed_home', $home, false);
	}
}

/**
 * Create the three fixture accounts.
 *
 * @return array<string, int> login => user id
 */
function seed_users(): array
{
	$ids = array();

	foreach (SEED_USERS as $login => $spec) {
		$password = (string) getenv($spec['env']);
		$existing = get_user_by('login', $login);

		if ($existing instanceof \WP_User) {
			$ids[$login] = (int) $existing->ID;

			// No variable supplied: leave the existing password alone. Changing
			// an account's password is not a side effect a content seeder gets
			// to have when it was not asked.
			if ('' === $password) {
				continue;
			}

			// Only write when something actually changed: wp_update_user() with
			// the same password still writes a NEW hash, because the salt is
			// random. That would make two identical seeds produce two different
			// wp_users rows.
			if (! wp_check_password($password, $existing->user_pass, $existing->ID)) {
				wp_update_user(
					array(
						'ID'        => $existing->ID,
						'user_pass' => $password,
						'role'      => $spec['role'],
					)
				);
			}

			continue;
		}

		if ('' === $password) {
			// Unreachable if assert_seed_environment() ran, and it stays here
			// because "the caller checked" is not a guarantee.
			WP_CLI::error(sprintf('%s is not set, so %s cannot be created.', $spec['env'], $login));
		}

		$id = wp_insert_user(
			array(
				'user_login'   => $login,
				'user_pass'    => $password,
				'user_email'   => $spec['email'],
				'display_name' => $spec['display'],
				'role'         => $spec['role'],
			)
		);

		if (is_wp_error($id)) {
			WP_CLI::error(sprintf('Could not create %s: %s', $login, $id->get_error_message()));
		}

		$ids[$login] = (int) $id;
	}

	// Every seeded account is a verified account. `registerDeveloper` (Lesson
	// 06.2) sets btt_verified = 0 on a self-registered developer, and Module 15
	// refuses `create_incidents` while that meta says '0'. A CLI-created account
	// has no such meta at all, and `'' == 0` is true in PHP — so writing 1 here
	// states the intent in the fixture rather than relying on the filter reading
	// an absent value the way you hoped. Idempotent: same value on every seed.
	foreach ($ids as $id) {
		update_user_meta($id, 'btt_verified', 1);
	}

	return $ids;
}

/** Turn off intermediate image sizes. Registered only for the duration of the seed. */
function no_intermediate_sizes(): array
{
	return array();
}

/**
 * Sideload the twelve checked-in JPEGs.
 *
 * @return array<string, int> slug => attachment id
 */
function seed_media(): array
{
	$dir = \Blame\Core\PLUGIN_DIR . '/includes/cli/fixtures/media';
	$ids = array();

	// launch => false below means `wp media import` runs IN THIS PROCESS, so
	// this filter applies to it. With launch => true it would not — that is the
	// whole reason for the flag. Key Concept 6.
	add_filter('intermediate_image_sizes_advanced', __NAMESPACE__ . '\\no_intermediate_sizes');

	foreach (SEED_MEDIA as $slug => $title) {
		$existing = get_page_by_path($slug, OBJECT, 'attachment');

		if ($existing instanceof \WP_Post) {
			$ids[$slug] = (int) $existing->ID;
			continue;
		}

		$path = sprintf('%s/%s.jpg', $dir, $slug);

		if (! is_readable($path)) {
			WP_CLI::error(sprintf('Missing fixture image: %s. Re-run Step 1.', $path));
		}

		$id = (int) WP_CLI::runcommand(
			// esc_cmd() is WP-CLI's escapeshellarg wrapper. Titles contain spaces.
			\WP_CLI\Utils\esc_cmd('media import %s --porcelain --title=%s', $path, $title),
			array(
				'return'     => true,
				'launch'     => false,
				'exit_error' => true,
			)
		);

		// Fixed slug. `wp media import` derives one from the filename, which is
		// usually the same and is not guaranteed to be.
		wp_update_post(
			array(
				'ID'        => $id,
				'post_name' => $slug,
			)
		);
		update_post_meta($id, SEED_MARKER, 1);

		$ids[$slug] = $id;
	}

	remove_filter('intermediate_image_sizes_advanced', __NAMESPACE__ . '\\no_intermediate_sizes');

	return $ids;
}

/**
 * Forty incidents, ten per severity and four per scapegoat.
 *
 * @param array<string, int> $users From seed_users().
 */
function seed_incidents(array $users): int
{
	$scapegoats = array_keys(\Blame\Core\SCAPEGOAT_TERMS);
	$severities = array_keys(\Blame\Core\SEVERITY_TERMS);
	$stacks     = array_keys(\Blame\Core\TECH_STACK_TERMS);

	for ($i = 0; $i < 40; $i++) {
		$occurred = seed_date($i, 1);
		$dates    = seed_date($i, 3);
		$headline = SEED_HEADLINES[$i % 10];

		$id = upsert_post(
			array(
				'post_type'     => 'incident',
				'post_name'     => sprintf('incident-%02d', $i + 1),
				'post_title'    => sprintf('%s (#%d)', $headline, $i + 1),
				// All forty PUBLISHED, so wp_term_taxonomy.count sums to 40 —
				// term counts only count public statuses (Lesson 03.3). Pending
				// and rejected fixtures are created per-test in Module 12.
				'post_status'   => 'publish',
				'post_author'   => $users['reporter'],
				'post_content'  => sprintf(
					'<!-- wp:paragraph --><p>%s. Nobody has owned up yet.</p><!-- /wp:paragraph -->',
					esc_html($headline)
				),
				'post_date'     => $dates['post_date'],
				'post_date_gmt' => $dates['post_date_gmt'],
			)
		);

		// Term IDs, resolved from slugs. Passing a slug straight into
		// wp_set_object_terms() on a NON-hierarchical taxonomy would be read as
		// a term NAME and would create a duplicate term.
		wp_set_object_terms($id, array(term_id($severities[$i % 4], 'severity')), 'severity', false);
		wp_set_object_terms($id, array(term_id($scapegoats[$i % 10], 'scapegoat')), 'scapegoat', false);
		wp_set_object_terms($id, array(term_id($stacks[($i * 3) % 10], 'tech_stack')), 'tech_stack', false);

		// SCF field names fixed by appendix 03 section 4.1. update_field() writes
		// through the sanitisers registered in Lesson 03.4 — which is why
		// occurred_at has to be in the past or it is stored as ''.
		update_field('occurred_at', $occurred['post_date_gmt'], $id);
		update_field('downtime_minutes', (($i * 37) % 480) + 5, $id);
		update_field('estimated_cost_usd', ($i * 911) % 250000, $id);
		update_field('environment', \Blame\Core\INCIDENT_ENVIRONMENTS[$i % 4], $id);
		update_field('resolution_status', \Blame\Core\INCIDENT_RESOLUTIONS[($i * 3) % 4], $id);
		update_field('blame_confidence', ($i * 17) % 101, $id);
		update_field(
			'stack_trace',
			sprintf(
				"Traceback (most recent call last):\n  File \"app/handler.php\", line %d\n  RuntimeException: %s",
				40 + $i,
				$headline
			),
			$id
		);
		update_field('reporter_display_name', SEED_REPORTERS[$i % 8], $id);
		update_field('is_verified', 0 === $i % 3, $id);
	}

	return 40;
}

/**
 * Eight reviews, two per verdict, with both repeaters populated.
 *
 * @param array<string, int> $media From seed_media().
 */
function seed_reviews(array $media): int
{
	$stacks = array_keys(\Blame\Core\TECH_STACK_TERMS);

	for ($i = 0; $i < 8; $i++) {
		$company = SEED_COMPANIES[$i];
		$logo    = $media[sprintf('review-logo-%02d', $i + 1)];
		$dates   = seed_date(60 + ($i * 2), 11);

		$id = upsert_post(
			array(
				'post_type'     => 'tech_review',
				'post_name'     => sprintf('review-%02d', $i + 1),
				'post_title'    => $company,
				'post_status'   => 'publish',
				'post_content'  => sprintf(
					'<!-- wp:paragraph --><p>We ran %s in production for six months. Here is the damage.</p><!-- /wp:paragraph -->',
					esc_html($company)
				),
				'post_date'     => $dates['post_date'],
				'post_date_gmt' => $dates['post_date_gmt'],
			)
		);

		wp_set_object_terms($id, array(term_id($stacks[$i % 10], 'tech_stack')), 'tech_stack', false);
		set_post_thumbnail($id, $logo);

		update_field('company_name', $company, $id);
		update_field('logo', $logo, $id);
		update_field('rating_overall', 1 + (($i * 7) % 10), $id);
		update_field('rating_dx', 1 + (($i * 3) % 10), $id);
		update_field('rating_docs', 1 + (($i * 5) % 10), $id);
		update_field('rating_incident_response', 1 + (($i * 9) % 10), $id);
		update_field('verdict', SEED_VERDICTS[$i % 4], $id);
		// SCF's Date Picker stores Ymd and reformats on read via return_format.
		update_field('reviewed_at', str_replace('-', '', substr($dates['post_date_gmt'], 0, 10)), $id);

		// A repeater value is a list of rows keyed by SUB-FIELD NAME. This is
		// the PHP shape behind [TechReviewFieldsPros] — Lesson 04.2.
		update_field(
			'pros',
			array(
				array('item' => sprintf('%s ships runnable examples in the docs', $company)),
				array('item' => 'The status page is honest about outages'),
			),
			$id
		);

		update_field(
			'cons',
			array(
				array('item' => 'Pricing requires a spreadsheet and a lawyer'),
				array('item' => sprintf('The %s CLI has four ways to do one thing', $company)),
			),
			$id
		);
	}

	return 8;
}

/**
 * Block markup exercising every custom block from Module 13.
 *
 * `btt/scapegoat-picker` stores a TERM ID, so the id is resolved from the slug
 * here. A literal would be a fixture that works on exactly one machine.
 *
 * Every string below is byte-for-byte what the block's `save()` produces in
 * Module 13. That is not a coincidence and it is not optional: the block
 * validator re-runs `save()` on load and compares its output to what is
 * stored, so a fixture that merely looks right makes every seeded post open
 * with "this block contains unexpected content". Three of the six blocks
 * serialise to a self-closing comment because their `save()` returns `null`
 * — they store data and no markup, which is the right shape when a React
 * front end does the rendering.
 *
 * These two posts are also the "already published" content that Lesson 13.5's
 * `deprecated` entry exists for. When 13.5 changes `btt/incident-callout`'s
 * markup, this is the old markup it has to keep loading.
 */
function block_showcase(int $scapegoat_term_id): string
{
	return implode(
		"\n\n",
		array(
			'<!-- wp:heading --><h2 class="wp-block-heading">What happened</h2><!-- /wp:heading -->',
			'<!-- wp:paragraph --><p>A short, entirely fictional description of a very real feeling.</p><!-- /wp:paragraph -->',
			'<!-- wp:btt/incident-callout {"incidentSlug":"incident-01","severity":"s1-catastrophic"} --><div class="wp-block-btt-incident-callout"><h3>Production is a smoking crater</h3><p>The DNS change was fine in staging.</p></div><!-- /wp:btt/incident-callout -->',
			'<!-- wp:btt/blame-quote {"attribution":"The on-call engineer"} --><blockquote class="wp-block-btt-blame-quote"><!-- wp:paragraph --><p>It worked on my machine.</p><!-- /wp:paragraph --></blockquote><!-- /wp:btt/blame-quote -->',
			sprintf('<!-- wp:btt/scapegoat-picker {"termId":%d} /-->', $scapegoat_term_id),
			'<!-- wp:btt/incident-ticker {"count":5,"severities":["s1-catastrophic","s2-major"]} /-->',
			'<!-- wp:btt/tech-verdict-card {"reviewSlug":"review-01"} --><div class="wp-block-btt-tech-verdict-card">Trial.</div><!-- /wp:btt/tech-verdict-card -->',
			'<!-- wp:btt/hobt-cta {"label":"Stop blaming the tech","href":"/hobt"} /-->',
		)
	);
}

/**
 * Ten blog posts. The first two carry every custom block.
 *
 * @param array<string, int> $media From seed_media().
 */
function seed_posts(array $media): int
{
	$showcase = block_showcase(term_id('the-intern', 'scapegoat'));
	$stacks   = array_keys(\Blame\Core\TECH_STACK_TERMS);

	for ($i = 0; $i < 10; $i++) {
		$dates = seed_date(40 + $i, 9);

		$id = upsert_post(
			array(
				'post_type'      => 'post',
				'post_name'      => sprintf('blog-%02d', $i + 1),
				'post_title'     => sprintf('Blaming the tech, part %d', $i + 1),
				'post_status'    => 'publish',
				'post_excerpt'   => 'A short satirical post about the thing that broke.',
				'post_content'   => $i < 2
					? $showcase
					: sprintf(
						'<!-- wp:paragraph --><p>Instalment %d. Nothing exploded today, which is suspicious.</p><!-- /wp:paragraph -->',
						$i + 1
					),
				'post_date'      => $dates['post_date'],
				'post_date_gmt'  => $dates['post_date_gmt'],
				'comment_status' => 'closed',
			)
		);

		wp_set_object_terms($id, array(term_id($stacks[$i % 10], 'tech_stack')), 'tech_stack', false);
		set_post_thumbnail($id, $media['hero-home']);
	}

	return 10;
}

/**
 * Home, About and HOBT.
 *
 * @param array<string, int> $media From seed_media().
 */
function seed_pages(array $media): int
{
	$home = upsert_post(
		array_merge(
			seed_date(0, 7),
			array(
				'post_type'    => 'page',
				'post_name'    => 'home',
				'post_title'   => 'Blame The Tech',
				'post_status'  => 'publish',
				'post_content' => '<!-- wp:paragraph --><p>Every outage has a scapegoat. Find yours.</p><!-- /wp:paragraph -->',
			)
		)
	);
	set_post_thumbnail($home, $media['hero-home']);

	$about = upsert_post(
		array_merge(
			seed_date(0, 8),
			array(
				'post_type'    => 'page',
				'post_name'    => 'about',
				'post_title'   => 'About',
				'post_status'  => 'publish',
				'post_content' => '<!-- wp:paragraph --><p>We catalogue blame. It is a growth industry.</p><!-- /wp:paragraph -->',
			)
		)
	);
	set_post_thumbnail($about, $media['hero-about']);

	$hobt = upsert_post(
		array_merge(
			seed_date(0, 9),
			array(
				'post_type'    => 'page',
				'post_name'    => 'hobt',
				'post_title'   => 'HOBT',
				'post_status'  => 'publish',
				'post_content' => block_showcase(term_id('kubernetes', 'scapegoat')),
			)
		)
	);
	set_post_thumbnail($hobt, $media['hero-hobt']);

	// The second half of the HOBT Promo location rule from Lesson 04.3. Without
	// this row the field group does not apply and hobtPromo resolves to null.
	update_post_meta($hobt, '_wp_page_template', 'templates/hobt.php');

	update_field('headline', 'How To Omit Blaming Tech', $hobt);
	update_field('subheadline', 'A twenty-four module course in not being the scapegoat.', $hobt);
	update_field('hero_image', $media['hero-hobt'], $hobt);
	update_field('price_usd', 499, $hobt);
	update_field('seats_left', 12, $hobt);
	update_field('demo_booking_url', 'https://example.test/hobt/demo', $hobt);
	update_field('start_now_url', 'https://example.test/hobt/checkout', $hobt);

	update_field(
		'modules',
		array(
			array(
				'title'            => 'Blame Fundamentals',
				'summary'          => 'Who to blame, and in what order.',
				'duration_minutes' => 90,
			),
			array(
				'title'            => 'Advanced Deflection',
				'summary'          => 'It was DNS. It is always DNS.',
				'duration_minutes' => 120,
			),
			array(
				'title'            => 'Postmortem Theatre',
				'summary'          => 'Blameless, in the sense of blaming a process.',
				'duration_minutes' => 60,
			),
		),
		$hobt
	);

	update_field(
		'testimonials',
		array(
			array(
				'quote'  => 'I have not been blamed once since the workshop.',
				'author' => 'Dana Editor',
				'role'   => 'Head of Nobody Told Me',
				'avatar' => $media['avatar-the-intern'],
			),
			array(
				'quote'  => 'We now blame Mercury retrograde with confidence.',
				'author' => 'Sam Reporter',
				'role'   => 'Incident Reporter',
				'avatar' => $media['avatar-the-intern'],
			),
		),
		$hobt
	);

	// A static front page, so nodeByUri("/") resolves to a real node in Module 09.
	// Only write when something changed.
	if ('page' !== get_option('show_on_front') || $home !== (int) get_option('page_on_front')) {
		update_option('show_on_front', 'page');
		update_option('page_on_front', $home);
	}

	return 3;
}

/**
 * Force-delete everything the seeder owns.
 *
 * `true` skips the trash. A trashed post keeps its slug reserved, so the next
 * seed would get `incident-01-2` and every URL in the test suite would be wrong.
 */
function reset_seeded(): int
{
	$ids = get_posts(
		array(
			'post_type'      => array('incident', 'tech_review', 'post', 'page', 'attachment'),
			'post_status'    => 'any',
			'posts_per_page' => -1,
			'fields'         => 'ids',
			'orderby'        => 'ID',
			'order'          => 'ASC',
			'meta_key'       => SEED_MARKER,
		)
	);

	foreach ($ids as $id) {
		// wp_delete_post() delegates to wp_delete_attachment() for attachments,
		// which also removes the files from the uploads volume.
		wp_delete_post((int) $id, true);
	}

	return count($ids);
}

/**
 * The whole seed, in dependency order.
 *
 * @param array<string, mixed> $assoc_args Flags from the CLI command.
 */
function seed_all(array $assoc_args): void
{
	assert_seed_environment();

	if (\WP_CLI\Utils\get_flag_value($assoc_args, 'fresh', false)) {
		WP_CLI::confirm('--fresh force-deletes all seeded content first. Continue?', $assoc_args);
		WP_CLI::log(sprintf('reset: removed %d items', reset_seeded()));
	}

	$users = seed_users();

	// Two jobs at once. It sets post_author for editorial content, and it gives
	// the process `unfiltered_html` — without which wp_insert_post() runs
	// post_content through wp_kses and strips every <!-- wp:… --> comment.
	wp_set_current_user($users['editor']);

	if (! current_user_can('unfiltered_html')) {
		WP_CLI::error(
			'The seeding user lacks unfiltered_html, so every block comment would be stripped '
				. 'from post_content. On multisite this capability is super-admin only.'
		);
	}

	$media = seed_media();

	$counts = array(
		'media'        => count($media),
		'users'        => count($users),
		'incidents'    => seed_incidents($users),
		'tech_reviews' => seed_reviews($media),
		'posts'        => seed_posts($media),
		'pages'        => seed_pages($media),
	);

	// Term counts are maintained incrementally, so recount once at the end and
	// the Module 05 leaderboard is correct on its first read.
	foreach (array('scapegoat', 'severity', 'tech_stack') as $taxonomy) {
		$terms = get_terms(
			array(
				'taxonomy'   => $taxonomy,
				'hide_empty' => false,
				'fields'     => 'ids',
			)
		);

		if (! is_wp_error($terms)) {
			wp_update_term_count_now($terms, $taxonomy);
		}
	}

	update_option('btt_seed_version', SEED_VERSION, false);

	foreach ($counts as $label => $n) {
		WP_CLI::log(sprintf('%-13s %d', $label, $n));
	}

	WP_CLI::success(sprintf('seed %s complete', SEED_VERSION));
}
