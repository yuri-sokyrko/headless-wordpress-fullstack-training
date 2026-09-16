---
title: 'Taxonomies & the Scapegoat Model'
module: 3
lesson: 3
teaches: [custom-taxonomies, term-counts-vs-meta-count, closed-term-sets, tax-query-vs-meta-query, activation-term-seeding]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/taxonomies.php']
requires: [3.2]
---

# Lesson 03.3 — Taxonomies & the Scapegoat Model

## Quick Overview

Three taxonomies, one modelling argument. `scapegoat` classifies what an incident blames,
`severity` classifies how bad it was, and `tech_stack` spans `incident`, `tech_review` and
`post`. All three are registered per
[appendix 03 §2](../appendix/03-content-model-reference.md#2-taxonomies), with their terms
seeded on activation behind a `term_exists()` guard so a redeploy does not duplicate them.
`severity` gets an extra restriction: a closed set of four terms, rendered as a checkbox panel
nobody can add to, so no editor — and no administrator — can invent "S5 kinda bad" and break a
front-end filter. Getting that to hold in the block editor is less obvious than it sounds, and
Key Concept 3 is mostly a tour of the two ways it silently does not.

The interesting half of this lesson is *why* these are taxonomies at all, and it is a
performance argument you can now measure yourself with the `EXPLAIN` skills from Lesson 02.3.
"This incident blames DNS" could plausibly be an SCF select stored in `wp_postmeta`. Make it a
taxonomy instead and WordPress maintains `wp_term_taxonomy.count` for you, so the blame
leaderboard becomes one indexed read rather than a `COUNT(*)` grouped over an unindexed EAV
table; term archives, term URLs and indexed `tax_query` joins come free. The contract states
the decision and its cost — terms have no revisions and no rich editorial body — and this lesson
proves the performance half rather than asserting it. Numeric facets like `downtime_minutes`
stay in post meta, because they cannot be taxonomies, and that residual trap is what Module 06's
N+1 lesson is built on.

By the end of this lesson you will have:

- `includes/taxonomies.php` registering `scapegoat`, `severity` and `tech_stack` with the
  contract's GraphQL names and rewrite bases
- 24 terms seeded on activation — 10 scapegoats, 4 severities, 10 tech stacks — idempotently
- `severity` locked to its four terms — a hierarchical checkbox panel with no "Add New" for
  anyone, and a `set_object_terms` guard that collapses a multi-tick back to one — and
  `tech_stack` attached to three post types
- `EXPLAIN` output for a `tax_query` on `severity` next to the equivalent `meta_query`, with
  the row estimates compared
- A one-read leaderboard query against `wp_term_taxonomy.count`, and the grouped `COUNT(*)` it
  replaces
- A written statement of what the taxonomy choice costs, not just what it buys

## Classic WP Analogy

You know this API completely. `register_taxonomy`, `hierarchical => false` for a tag-like
taxonomy, `wp_set_object_terms()`, `get_the_terms()`, `WP_Query` with `'tax_query' => [[
'taxonomy' => 'severity', 'field' => 'slug', 'terms' => 's1-catastrophic' ]]`. You also know
the three-table shape underneath — `wp_terms`, `wp_term_taxonomy`, `wp_term_relationships` —
even if you have never had a reason to care. All of that transfers untouched; the only new
argument is `show_in_graphql` with its singular and plural names, the same visibility flag you
added to post types in Lesson 03.2.

Where this lesson asks something new of you is in the *choosing*. In Classic WordPress the
taxonomy-versus-meta decision is usually made on editorial convenience: taxonomies get a nice
box in the sidebar and an archive page, meta fields get a text input, so you pick whichever
looks better in wp-admin. That heuristic is not wrong, it is just incomplete — and in a headless
build the missing half dominates, because the front end filters and counts these values on every
list page and every one of those becomes a query against your database with no page cache in
front of it.

**Where the analogy breaks down:** `wp_term_taxonomy.count` is a number Classic WordPress
maintains for you and you have probably never queried directly, because `get_terms()` handed it
over and a widget rendered it. Here it is the difference between a leaderboard that costs one
indexed lookup and one that costs a full grouped scan of `wp_postmeta` on every request. The
same convenience you took for granted becomes an architectural asset — and the corollary bites
too: `count` only tracks published posts of the taxonomy's object types, so the moment
Lesson 03.4 introduces a `pending` moderation status you have to know what `count` is and is not
counting. Classic WordPress let you stay pleasantly ignorant of that; this course does not.

---

## Key Concepts

### 1. The three tables, and the one column that decides the model

You have used this API for years; the shape underneath it is what this lesson is about.
```
  wp_terms                  wp_term_taxonomy              wp_term_relationships
  ┌────────────────┐        ┌────────────────────────┐    ┌────────────────────┐
  │ term_id    PK  │◀──────▶│ term_taxonomy_id   PK  │◀──▶│ object_id          │
  │ name           │        │ term_id            FK  │    │ term_taxonomy_id   │
  │ slug   UNIQUE  │        │ taxonomy          KEY  │    │ term_order         │
  └────────────────┘        │ parent                 │    └────────────────────┘
                            │ count  ◀── MAINTAINED  │     one row per post↔term
                            └────────────────────────┘
                                    BY WORDPRESS
```

`wp_term_taxonomy.count` is an ordinary `BIGINT` column that WordPress keeps up to date on every
save, via `wp_update_term_count()`. Ten scapegoat terms means ten rows and ten counts, so "which
scapegoat is blamed most" is a `SELECT` over ten rows. Model the same fact as an SCF select and
you get one `wp_postmeta` row per incident, and a `GROUP BY` over every one of them:

| | Taxonomy (`wp_term_taxonomy.count`) | Post meta (`GROUP BY meta_value`) |
|---|---|---|
| Rows read for the leaderboard | 10 — one per term | 40 today, 400,000 later |
| Index used | `KEY taxonomy (taxonomy(...))` | `KEY meta_key (meta_key(...))` — then a scan |
| `GROUP BY` target | none needed | `meta_value`, a `LONGTEXT` column MySQL **cannot** index |
| `Extra` in `EXPLAIN` | index scan, tiny filesort | `Using temporary; Using filesort` |
| Growth | O(number of terms) | O(number of incidents) |
| Filtering (`?severity=s1-catastrophic`) | indexed join through `wp_term_relationships` | `meta_query` string comparison on `meta_value` |

**The verdict: `scapegoat` and `severity` are taxonomies.** Key Concept 3 makes you measure it
rather than take it from a table.

> **What it costs, stated plainly:** WordPress buys that cheap read with a write. Every
> `wp_set_object_terms()` triggers a `COUNT(*)` and an `UPDATE` on `wp_term_taxonomy`. You have
> moved work from every read to every write, which is the right trade for a public leaderboard
> read thousands of times and written forty times — and the wrong trade for something written
> constantly and read rarely. Name the read/write ratio before you choose.

### 2. What `count` counts, and what it silently does not

`count` is maintained by `_update_post_term_count()`, and that function counts **only posts
whose `post_status` is `publish`**, of the object types the taxonomy is registered for.

```
  40 incidents: 32 publish · 6 pending · 2 draft   ─┬─▶ count for `dns`          = 4  (publish)
                                                    └─▶ rows in relationships    = 7  (everything)
```

That is exactly right for a public leaderboard — an unmoderated submission must not move the
numbers — and exactly wrong if you build a moderation dashboard on `count` and wonder why the
queue looks empty. For "how many are waiting", count rows; for "how many are live", read
`count`. Lesson 03.4 introduces the queue that makes the distinction matter.

### 3. `severity` as a closed set: three mechanisms, only one of which is real

Appendix 03 §2 fixes `severity` at four terms, forever. Editors must be able to *assign* them
and must not be able to *invent* them, because the front end filters on the slug and
`?severity=s5-kinda-bad` returns an empty page with no error. Three mechanisms could enforce
that, and they are not equally strong:

"Closed" is really two rules — *nobody invents a fifth severity*, and *no incident carries two*
— and they need different mechanisms. Four candidates, and half of them are traps:

| Mechanism | Classic editor | Block editor | REST | WP-CLI |
|---|---|---|---|---|
| A radio-button `meta_box_cb` | ✅ | ❌ **never renders at all** | ❌ | ❌ |
| Validating in a `save_post` handler | ✅ | ❌ **never runs** | ❌ | ❌ |
| **Collapsing on `set_object_terms`** | ✅ | ✅ | ✅ | ✅ |
| **`capabilities` on `register_taxonomy`** | ✅ | ✅ | ✅ | ✅ |

The bottom two are the real ones: capabilities stop *inventing*, the `set_object_terms` guard
stops *multi-assign*. The top two are worth understanding precisely, because both look correct
and neither works in the editor this project actually ships.

**Why `meta_box_cb` never renders.** Core registers every taxonomy meta box with a flag:

```php
// wp-admin/includes/meta-boxes.php — note that this is unconditional
add_meta_box(
    $tax_meta_box_id, $label, $taxonomy->meta_box_cb, null, 'side', 'core',
    array( 'taxonomy' => $tax_name, '__back_compat_meta_box' => true )
);
```

and the block editor skips every box carrying it:

```php
// wp-admin/includes/post.php, the_block_editor_meta_boxes()
// If a meta box is just here for back compat, don't show it in the block editor.
if ( isset( $meta_box['args']['__back_compat_meta_box'] ) && $meta_box['args']['__back_compat_meta_box'] ) {
    continue;
}
```

A custom `meta_box_cb` is therefore a classic-editor-only feature, whatever its callback does.
Pair it with `show_in_rest => false` — which removes Gutenberg's own panel — and you get **no
severity UI whatsoever**: no radio box, no checkboxes, nothing in the sidebar. The two settings
cancel out, and the failure is silent, because both halves look individually reasonable.

**What to do instead.** Register `severity` as **hierarchical**, and leave it in REST:

```php
'hierarchical' => true,   // a UI decision, not a data one — severities have no parents
'show_in_rest' => true,   // the panel does not exist without it
```

`hierarchical => true` is what makes Gutenberg draw its category-style **checkbox** list instead
of the free-text token input it uses for flat taxonomies — a closed set rendered as a closed set,
with no JavaScript build step, which matters because `@wordpress/scripts` does not arrive until
Module 13. Nothing about the data is hierarchical and nothing ever will be; you are choosing a
control, and that is a legitimate reason to set the flag.

**Why `save_post` is the second trap.** Once the taxonomy is in REST, Gutenberg writes terms
through the REST API, not through a form post. A `save_post` handler guarded by a nonce — the
obvious place to validate — never sees that write at all, so it silently does nothing. Enforce on
`set_object_terms` instead, the one chokepoint REST, the classic editor, WP-CLI and the Module 04
seeder all pass through.

**The capability map, and the detail that bites.** This is the half WordPress's own authorisation
layer enforces:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/taxonomies.php
'capabilities' => array(
    'manage_terms' => 'manage_options', // read the term list
    'edit_terms'   => 'do_not_allow',   // nobody creates or renames — not even an admin
    'delete_terms' => 'do_not_allow',   // nobody deletes
    'assign_terms' => 'edit_incidents', // editors still tick a box
),
```

`edit_terms` is the one that matters, and `manage_options` is not strict enough. Gutenberg renders
its "Add New Category" form whenever the post's REST response advertises
`wp:action-create-severity`, and core emits that link for anyone holding `edit_terms`. Set it to
`manage_options` and every administrator gets a term-creation form in the incident sidebar —
parent-category dropdown and all — which is exactly what a closed set must not have. The link
only appears under `context=edit`, the context the editor sends, so it is invisible to a casual
REST poke and easy to miss.

`do_not_allow` is WordPress's idiom for "no role, ever". It closes the sidebar form and the
add/delete forms on `edit-tags.php` in one move, while `manage_terms` left at `manage_options`
still lets an administrator *read* the list. Seeding is unaffected: `wp_insert_term()` is a
low-level function with no capability check, so `seed_default_terms()` below keeps working. The
set is defined in `SEVERITY_TERMS` and changed by editing code, which is what calling it closed
should mean.

> **`severity` is hierarchical and `scapegoat` and `tech_stack` are not.** That asymmetry is
> about the control, not the content. Free-form taxonomies want the token input — typing a new
> scapegoat is the point. A closed set wants checkboxes and no "Add New", and in the block editor
> `hierarchical` is the only switch that produces them without shipping JavaScript.

### 4. Taxonomy, CPT with a relationship, or SCF select

The full decision, with the answer this project reaches:

| | Taxonomy + term meta | CPT + relationship field | SCF select |
|---|---|---|---|
| Maintained count | ✅ free | ❌ `COUNT(*)` over `wp_postmeta` | ❌ same |
| Indexed filtering | ✅ `tax_query` | ⚠️ `meta_query` on a post ID | ❌ `meta_query` on a string |
| Its own URL / archive | ✅ | ✅ | ❌ |
| Revisions, a body, an author | ❌ term meta only | ✅ | ❌ |
| Editor effort to add one | trivial | a whole post | trivial |
| **Chosen for** | **`scapegoat`, `severity`, `tech_stack`** | nothing in this app | `environment`, `resolution_status` |

`scapegoat` is a taxonomy because "this incident blames DNS" is *classification*, and because
the leaderboard is the most-read query in the application. The honest cost is the fourth row: a
scapegoat has no revision history and no long-form editorial body. The `Scapegoat Profile` term
field group in Lesson 04.3 covers everything this app needs — an avatar, a tagline, an official
excuse — but if scapegoats ever needed a 2,000-word essay with revisions, this decision would
have to be revisited. **Model the relationship you have, not the one you might want**, and write
down what you gave up, because the next person will otherwise assume you did not know.

Note the last column. `environment` and `resolution_status` stay SCF selects even though they
look exactly like `severity` — nobody will ever browse "all incidents in staging" as a
destination page, so the URL, the archive and the maintained count are worth nothing. Numeric
facets like `downtime_minutes` cannot be taxonomies at all, which is the residual trap Module
06's N+1 lesson is built on.

### 5. `tech_stack` spans three post types, which is a front-end decision

`scapegoat` and `severity` attach to `incident` only. `tech_stack` attaches to `incident`,
`tech_review` **and** `post`, so "everything tagged React" is a heterogeneous list:

```
  techStack(id:"react", idType:SLUG) { contentNodes(first: 20) { nodes {
      __typename                       ← "Incident" | "TechReview" | "Post"
      ... on Incident   { title }
      ... on TechReview { ratingOverall }
      ... on Post       { date }
  } } }
```

In Classic WordPress that is a `WP_Query` with `'post_type' => 'any'` and a `switch` in the
template. In GraphQL it is the `ContentNode` interface plus inline fragments, and in TypeScript
a discriminated union narrowed on `__typename`. Registering one taxonomy across three post types
now is what forces you to learn it in Modules 05 and 14.

### 6. Seeding terms on activation, idempotently and by slug

Twenty-four terms are created by the activation hook, and two rules make that safe on every
deploy: guard with `term_exists( $slug, $taxonomy )`, and key the guard on the **slug** — never
the name (editors rename) and never the ID (IDs differ between your machine, CI and production).

The ID rule is the one that catches people. A seeder that says "term 14 is DNS" is correct on
your machine and wrong everywhere else, and the failure is silent: the wrong scapegoat gets
blamed. Lesson 04.5 generalises this into the determinism rules for the whole seeder.

---

## Task

> **The first line of every code fence in this course is the destination path, not a line of
> the file.** PHP files start at their `<?php`. Paste from there down.

### Step 1: Write `includes/taxonomies.php`

Every slug and every GraphQL name comes from
[appendix 03 §2](../appendix/03-content-model-reference.md#2-taxonomies) and its
[seeded terms table](../appendix/03-content-model-reference.md#seeded-terms).

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/taxonomies.php
<?php
/**
 * Taxonomies, their closed term sets, and the severity single-select rule.
 *
 * Contract: .lessons/appendix/03-content-model-reference.md §2
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

/** Seeded on activation. Free-form afterwards — editors may add more. */
const SCAPEGOAT_TERMS = array(
	'the-intern'               => 'The Intern',
	'mercury-retrograde'       => 'Mercury Retrograde',
	'legacy-jquery'            => 'Legacy jQuery',
	'dns'                      => 'DNS',
	'solar-flares'             => 'Solar Flares',
	'the-cache'                => 'The Cache',
	'daylight-saving-time'     => 'Daylight Saving Time',
	'that-one-regex'           => 'That One Regex',
	'kubernetes'               => 'Kubernetes',
	'the-previous-contractor'  => 'The Previous Contractor',
);

/** CLOSED SET. Four terms, forever. The front end filters on these slugs. */
const SEVERITY_TERMS = array(
	's1-catastrophic' => 'S1 — Catastrophic',
	's2-major'        => 'S2 — Major',
	's3-minor'        => 'S3 — Minor',
	's4-cosmetic'     => 'S4 — Cosmetic',
);

/** Seeded, free-form, and shared across three post types. */
const TECH_STACK_TERMS = array(
	'react'      => 'React',
	'nextjs'     => 'Next.js',
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
 * @param string $single       graphql_single_name.
 * @param string $plural       graphql_plural_name.
 * @param string $rewrite_slug URL segment for the term archive.
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
			)
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

				// HIERARCHICAL IS A UI DECISION HERE, NOT A DATA ONE. Severities
				// have no parents and never will. What `true` buys is the block
				// editor's category-style CHECKBOX panel instead of the free-text
				// token input Gutenberg draws for a flat taxonomy — the closed set
				// rendered as a closed set, with no JS build step. Key Concept 3.
				'hierarchical'       => true,

				// Inherited as `true` from taxonomy_defaults(), and it must stay
				// that way: the panel does not exist without it. Which also means
				// Gutenberg writes terms over REST and never reaches a `save_post`
				// handler — hence enforce_single_severity() on `set_object_terms`.

				'capabilities'       => array(
					// `edit_terms` is the one that matters. Gutenberg renders its
					// "Add New Category" form whenever the REST response carries
					// `wp:action-create-severity`, and core emits that link for
					// anyone holding this cap. At `manage_options` every admin gets
					// a term-creation form in the sidebar. `do_not_allow` is
					// WordPress's idiom for "no role, ever" — and it does not block
					// seeding, because wp_insert_term() has no capability check.
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
 * The checkbox panel lets an editor tick all four. Nothing in WordPress stops
 * them, because "exactly one" is our rule, not core's — there is no `single`
 * flag on a taxonomy, hierarchical or otherwise.
 *
 * This runs on `set_object_terms`, which fires AFTER the write, for every
 * caller: the REST request Gutenberg sends, a classic `$_POST`, `wp term add`,
 * and the Module 04 seeder. Enforcing here rather than in a `save_post` handler
 * is the whole point — a `save_post` guard never sees Gutenberg's write.
 *
 * @param int    $object_id  Object ID.
 * @param mixed  $terms      Terms as passed to wp_set_object_terms().
 * @param int[]  $tt_ids     Term taxonomy IDs written by this call.
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

	// Read the RESULT, never count( $tt_ids ). On an append core passes only the
	// tt_ids THIS call added, so a second term landing beside an existing one
	// arrives here as a single-element $tt_ids while the object now holds two.
	$current = wp_get_object_terms( $object_id, 'severity' );

	if ( is_wp_error( $current ) || count( $current ) <= 1 ) {
		return;
	}

	// Whichever term this write introduced wins, so ticking S1 while S2 is set
	// does the obvious thing. $old_tt_ids is what makes that distinguishable.
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
```

### Step 2: Load and seed on activation

Two edits to `includes/Plugin.php`, exactly as in Lesson 03.2 §3:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	private const INCLUDES = array(
		'includes/post-types.php',   // Lesson 03.2
		'includes/taxonomies.php',   // Lesson 03.3
		// 'includes/statuses.php',     ← Lesson 03.4
		// 'includes/roles.php',        ← Lesson 03.5
	);
```

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	public static function activate(): void {
		register_post_types();

		// Taxonomies must be registered before terms can be inserted into them:
		// wp_insert_term() rejects an unknown taxonomy with a WP_Error.
		register_taxonomies();
		seed_default_terms();

		grant_incident_caps_to_core_roles();
		ensure_permalink_structure();

		flush_rewrite_rules();

		update_option( 'btt_core_version', VERSION, false );
	}
```

**Verify §2:**

- [ ] `register_taxonomies()` is called **before** `seed_default_terms()`. Reversed, every
      `wp_insert_term()` returns `WP_Error: Invalid taxonomy` and the seed creates nothing.
- [ ] `flush_rewrite_rules()` is still last.

### Step 3: Re-activate and confirm 24 terms

```bash
cd wordpress-headless
docker compose run --rm wpcli wp plugin deactivate blame-the-tech-core
docker compose run --rm wpcli wp plugin activate blame-the-tech-core

docker compose run --rm wpcli wp term list severity --fields=slug,name,count
docker compose run --rm wpcli wp term list scapegoat --format=count
docker compose run --rm wpcli wp term list tech_stack --format=count
```

**Verify §3:**

- [ ] `severity` lists exactly four terms — `s1-catastrophic`, `s2-major`, `s3-minor`,
      `s4-cosmetic` — with the contract's names, em dash included.
- [ ] `scapegoat` and `tech_stack` both print `10`.
- [ ] Re-run the two `activate` commands. Still 4, 10 and 10 — **not** 8, 20 and 20. That is the
      `term_exists()` guard doing its job.

### Step 4: Classify the incident from Lesson 03.2 by hand

Open the incident in wp-admin. All three panels are Gutenberg's own, because all three
taxonomies are in REST — but they do not look alike, and the difference is the lesson.

- [ ] Assign the scapegoat `DNS` and the severity `S1 — Catastrophic`, and update the post.
- [ ] **Scapegoats** and **Tech Stack** are free-text token inputs that will happily create a
      term as you type. That is correct: those sets are open.
- [ ] **Severities** is a list of exactly four checkboxes, and there is **no "Add New Category"
      link beneath it** — not for you, even as an administrator. If you see one, `edit_terms` is
      not `do_not_allow`; Verification checks 9 and 10 are the ones that catch it.
- [ ] Tick a second severity and update. It collapses back to one, and the one you just ticked
      is the one that survives. That is `enforce_single_severity()`, not the UI.
- [ ] Assign a `tech_stack` term to a blog post too, proving the taxonomy spans three types.

### Step 5: Measure the leaderboard, both ways

This is the `EXPLAIN` work from Lesson 02.3 applied to a decision you just made. Adminer at
<http://localhost:8081> renders the plan as a table, which is easier to read than the CLI.

```bash
# A. The taxonomy leaderboard — what this lesson's model makes possible
docker compose run --rm wpcli wp db query "EXPLAIN SELECT t.name, tt.count
  FROM wp_terms t INNER JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id
  WHERE tt.taxonomy = 'scapegoat' ORDER BY tt.count DESC LIMIT 10;"

# B. The post-meta leaderboard — what an SCF select would have forced
docker compose run --rm wpcli wp db query "EXPLAIN SELECT m.meta_value, COUNT(*) AS n
  FROM wp_postmeta m INNER JOIN wp_posts p ON p.ID = m.post_id
  WHERE m.meta_key = 'scapegoat' AND p.post_type = 'incident' AND p.post_status = 'publish'
  GROUP BY m.meta_value ORDER BY n DESC LIMIT 10;"
```

**Verify §5:** for both plans, write down the `rows` estimate, whether `Extra` contains
`Using temporary` and `Using filesort`, and which index was used.

With 40 incidents neither query is slow, and saying otherwise would be dishonest. What the plans
show is the **shape**: the first reads one row per term with no temporary table, the second
builds a temporary table keyed on a `LONGTEXT` column. Multiply the rows by ten thousand and only
one of them still works.

### Step 6: Write down what the decision cost

Add an ADR under `docs/adr/` — the next free number — recording that `scapegoat` is a taxonomy
rather than a CPT with a relationship field. Include the measurement from Step 5, be explicit
about what you gave up (**no revisions and no long-form editorial body**), and state the
condition that would make you revisit it. An ADR that only lists benefits is marketing.

---

## Verification

```bash
cd wordpress-headless

# 1. All three taxonomies are registered, against the right object types
docker compose run --rm wpcli wp eval '
foreach ( array( "scapegoat", "severity", "tech_stack" ) as $t ) {
  $o = get_taxonomy( $t );
  printf( "%s -> %s | rest=%s hier=%s gql=%s/%s%s", $t, implode( ",", $o->object_type ),
    var_export( $o->show_in_rest, true ), var_export( $o->hierarchical, true ),
    $o->graphql_single_name, $o->graphql_plural_name, PHP_EOL );
}'
# Expected: scapegoat  -> incident                  | rest=true hier=false gql=Scapegoat/Scapegoats
#           severity   -> incident                  | rest=true hier=TRUE  gql=Severity/Severities
#           tech_stack -> incident,tech_review,post | rest=true hier=false gql=TechStack/TechStacks
#           `severity` is the only hierarchical one, and that is a UI decision — it is
#           what makes Gutenberg draw checkboxes instead of a token input. Key Concept 3.

# 2. Exactly 24 terms, with the contract's slugs — and seeding is idempotent
docker compose run --rm wpcli wp term list severity --field=slug --orderby=slug
# Expected: s1-catastrophic  s2-major  s3-minor  s4-cosmetic  (four lines, nothing else)
docker compose run --rm wpcli wp plugin deactivate blame-the-tech-core >/dev/null
docker compose run --rm wpcli wp plugin activate blame-the-tech-core >/dev/null
docker compose run --rm wpcli wp term list scapegoat --format=count
docker compose run --rm wpcli wp term list tech_stack --format=count
# Expected: 10 and 10 — not 20 and 20

# 4. The maintained count is real, and it moves when you publish
docker compose run --rm wpcli wp term list scapegoat --fields=slug,count | grep dns
# Expected: dns with count 1 — the incident you classified in Step 4

# 5. ...and NEGATIVE: count ignores anything not published
ID=$(docker compose run --rm wpcli wp post create --post_type=incident \
      --post_title='Pending: the cache again' --post_name=pending-cache-again \
      --post_status=pending --porcelain | tr -d '\r')
docker compose run --rm wpcli wp post term add "$ID" scapegoat the-cache
docker compose run --rm wpcli wp term list scapegoat --fields=slug,count | grep the-cache
# Expected: the-cache with count 0 — the relationship row exists, the count does not
#           move until the post is published. Key Concept 2.
docker compose run --rm wpcli wp db query \
  "SELECT COUNT(*) AS relationship_rows FROM wp_term_relationships r
   INNER JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = r.term_taxonomy_id
   INNER JOIN wp_terms t ON t.term_id = tt.term_id
   WHERE tt.taxonomy='scapegoat' AND t.slug='the-cache';"
# Expected: 1 — the row is there; only `count` is filtering by status

# 6. Publish it and the count catches up
docker compose run --rm wpcli wp post update "$ID" --post_status=publish
docker compose run --rm wpcli wp term list scapegoat --fields=slug,count | grep the-cache
# Expected: the-cache with count 1

# 7. The taxonomies are in the GraphQL schema under the contract's names
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ scapegoats(first:100){ nodes { name slug count } } severities(first:10){ nodes { slug } } }"}'
# Expected: 10 scapegoats with a numeric `count`, and the four severity slugs

# 8. The term-to-post connection: one indexed join through wp_term_relationships
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ severity(id:\"s1-catastrophic\",idType:SLUG){ name count incidents(first:10){ nodes { title } } } }"}'
# Expected: name "S1 — Catastrophic", count 1, and the incident from Step 4

# 9. NEGATIVE: the closed set is closed for EVERYONE, administrators included.
#    This is the check that would have caught the "Add New Category" form.
docker compose run --rm wpcli wp eval '
wp_set_current_user( 1 );
$t = get_taxonomy( "severity" );
foreach ( array( "manage_terms", "edit_terms", "delete_terms", "assign_terms" ) as $c ) {
  printf( "admin %-13s (%-14s) = %s%s", $c, $t->cap->$c,
    var_export( current_user_can( $t->cap->$c ), true ), PHP_EOL );
}'
# Expected: admin manage_terms  (manage_options) = true   ← may READ the list
#           admin edit_terms    (do_not_allow)   = false  ← may NOT create or rename
#           admin delete_terms  (do_not_allow)   = false
#           admin assign_terms  (edit_incidents) = true   ← may still tick a box

# 10. NEGATIVE: no create-term link, so Gutenberg draws no "Add New Category" form.
#     `context=edit` is essential — the wp:action-* links do not exist without it,
#     which is exactly why this was easy to miss.
docker compose run --rm wpcli wp eval '
wp_set_current_user( 1 );
$id  = get_posts( array( "post_type" => "incident", "numberposts" => 1, "fields" => "ids" ) )[0];
$req = new WP_REST_Request( "GET", "/wp/v2/incidents/" . $id );
$req->set_param( "context", "edit" );
$data = rest_get_server()->response_to_data( rest_do_request( $req ), false );
foreach ( array_keys( $data["_links"] ) as $rel ) {
  if ( str_contains( $rel, "action-" ) && str_contains( $rel, "severity" ) ) { echo $rel, PHP_EOL; }
}'
# Expected: wp:action-assign-severity — and NOTHING else.
#           If wp:action-create-severity appears, `edit_terms` is not do_not_allow
#           and every admin has a term-creation form in the incident sidebar.

# 10b. NEGATIVE: severity IS in REST (the panel needs it), but creating is refused.
docker compose run --rm wpcli wp eval '
wp_set_current_user( 1 );
$req = new WP_REST_Request( "POST", "/wp/v2/severity" );
$req->set_body_params( array( "name" => "S5 — Invented By An Admin" ) );
printf( "create severity via REST: %d%s", rest_do_request( $req )->get_status(), PHP_EOL );
printf( "severity terms still: %d%s",
  count( get_terms( array( "taxonomy" => "severity", "hide_empty" => false ) ) ), PHP_EOL );'
# Expected: create severity via REST: 403
#           severity terms still: 4

# 10c. NEGATIVE: ticking every box still stores exactly one severity.
docker compose run --rm wpcli wp eval '
$id  = get_posts( array( "post_type" => "incident", "numberposts" => 1, "fields" => "ids" ) )[0];
$all = get_terms( array( "taxonomy" => "severity", "hide_empty" => false, "fields" => "ids" ) );
wp_set_object_terms( $id, array_map( "intval", $all ), "severity", false );
printf( "after assigning all 4: [%s]%s",
  implode( ",", wp_get_object_terms( $id, "severity", array( "fields" => "slugs" ) ) ), PHP_EOL );'
# Expected: exactly ONE slug. enforce_single_severity() collapsed the other three.

# 11. Term archive rewrites were flushed, and the extra incident is cleaned up
docker compose run --rm wpcli wp rewrite list --match=/scapegoats/dns/ --fields=match,query
# Expected: a rule whose query contains scapegoat=$matches[1]
docker compose run --rm wpcli wp post delete "$ID" --force
# Expected: Success — Module 04's starting state expects 40 incidents, not 41
```

Checks 5 and 6 together are the ones to keep. They are the difference between a leaderboard that
shows moderated reality and one that shows whatever anybody submitted three minutes ago.

## Control Questions

1. The blame leaderboard reads `wp_term_taxonomy.count` instead of a grouped `COUNT(*)`. Name
   the operation that pays for that cheap read, say when it happens, and describe a content shape
   where the trade would be the wrong way round.
2. `count` for `the-cache` was `0` while a row existed in `wp_term_relationships`. Explain the
   discrepancy, and say which of the two numbers a moderation dashboard should use.
3. A radio-button `meta_box_cb` and a `save_post` validator both look like reasonable ways to
   keep `severity` to one term, and neither does anything in this project. Explain what silences
   each one, naming the core flag responsible for the first and the request path responsible for
   the second.
4. `severity` is the only hierarchical taxonomy here, yet a severity will never have a parent.
   Justify the flag, and say what the editor sidebar would show instead if it were `false`.
5. `edit_terms` was `manage_options` and the set was still not closed. Describe what an
   administrator saw in the incident sidebar, name the REST link that put it there, and say why
   `context=edit` is the reason nobody noticed.
6. `tech_stack` spans `incident`, `tech_review` and `post`. Describe what a query for
   "everything tagged React" returns, and name the GraphQL construct and the TypeScript
   construct you will need in Modules 05 and 14 to consume it.

## Learn More

- [`register_taxonomy()`](https://developer.wordpress.org/reference/functions/register_taxonomy/) —
  the full argument list; read `capabilities`, `hierarchical` and `show_in_rest` together, and
  note that the docs for `meta_box_cb` never mention the block editor ignoring it
- [Meta boxes in the block editor](https://developer.wordpress.org/block-editor/how-to-guides/metabox/) —
  the `__back_compat_meta_box` flag from Key Concept 3, and why a taxonomy meta box is always
  marked with it
- [`set_object_terms`](https://developer.wordpress.org/reference/hooks/set_object_terms/) — the
  hook `enforce_single_severity()` uses; read the `$append` parameter's effect on `$tt_ids`
  carefully, because it is the reason the naive `count( $tt_ids )` guard is wrong
- [Taxonomy database schema](https://developer.wordpress.org/apis/handbook/database/#term-tables) —
  the three tables in Key Concept 1, in core's own diagram, with the indexed columns marked
- [`wp_update_term_count()`](https://developer.wordpress.org/reference/functions/wp_update_term_count/) —
  follow it into `_update_post_term_count()` and read the `post_status` clause for yourself
- [WPGraphQL — custom taxonomies](https://www.wpgraphql.com/docs/custom-taxonomies/) — what
  `graphql_single_name` and `graphql_plural_name` generate for a taxonomy, including `count`
- [WPGraphQL — interfaces](https://www.wpgraphql.com/docs/interfaces/) — `ContentNode` and
  `__typename`, which is what makes `tech_stack` across three post types queryable
- [MySQL `EXPLAIN` output](https://dev.mysql.com/doc/refman/8.0/en/explain-output.html) — the
  reference for the `rows` and `Extra` columns you recorded in Step 5
