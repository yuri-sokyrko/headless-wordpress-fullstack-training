---
title: 'Post Meta, Status & Moderation'
module: 3
lesson: 4
teaches: [register-post-meta, custom-post-status, moderation-queue, admin-columns, auth-callback]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/statuses.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/admin/incident-columns.php']
requires: [3.2]
---

# Lesson 03.4 — Post Meta, Status & Moderation

## Quick Overview

An incident submitted by a member of the public must not go straight to the front end. This
lesson builds the moderation path: `register_post_meta` for the fields that are not taxonomies,
core's `pending` status put to work as a real moderation queue, and an admin experience an
editor can actually use — sortable severity and scapegoat columns, a scapegoat filter dropdown,
and a row action that publishes in one click. The submission flow that feeds this queue is
Module 16; here you build the receiving end and prove it works by hand.

`register_post_meta` is the part to slow down on, because it does more than declare a key. It
sets a `type` and `single`, it opts the key into REST with `show_in_rest` so the block editor
can read and write it, and it takes an `auth_callback` that decides who may edit the key at all.
That callback is the first appearance of a theme this course returns to repeatedly:
`is_verified` from
[appendix 03 §4.1](../appendix/03-content-model-reference.md#41-incident-details) is editable by
an editor, present in the schema, and must be **ignored** when a client supplies it. A field
existing in an API is not permission to write it. Module 06.2 enforces the same rule at the
mutation boundary, independently, because two checks at two layers is the design.

By the end of this lesson you will have:

- `includes/statuses.php` — meta registration and the moderation status wiring
- `includes/admin/incident-columns.php` — severity and scapegoat as sortable columns, a
  scapegoat filter, and a one-click publish row action
- Registered meta for every non-taxonomy field in §4.1, with types, `single`, `show_in_rest`
  and an `auth_callback` each
- An `is_verified` `auth_callback` that returns false for anyone without `edit_others_incidents`
- A working queue: create an incident as `pending`, see it in wp-admin, publish it, and see the
  status transition in the database
- A note on what `transition_post_status` will be used for in Module 18

## Classic WP Analogy

Everything here is an API you have used. `add_post_meta`/`update_post_meta`/`get_post_meta` are
unchanged. `pending` is the same `post_status` that core's Contributor role has always produced —
"Submit for Review" in the classic editor, and a Pending list in wp-admin. `manage_edit-{$type}_columns`
and `manage_{$type}_posts_custom_column` are the same filter and action pair you have used to add
a thumbnail column to a CPT list, and `restrict_manage_posts` is the same hook you have used to
add a taxonomy dropdown above a list table. If you have ever built an editorial workflow in
Classic WordPress, this is that, with the same hooks.

`register_post_meta` is the one function that may be genuinely new, and it is worth
understanding as a *declaration* layered on top of the storage you already know. The rows still
land in `wp_postmeta` exactly as `update_post_meta` always put them; registration adds a schema
— a type, a cardinality, a REST projection and an authorisation callback — so that consumers
other than your own PHP can discover and safely handle the key. Classic WordPress let you skip
this because your PHP was the only consumer.

**Where the analogy breaks down:** in Classic WordPress a moderation workflow is enforced by the
wp-admin UI, and the UI is the only door. A Contributor cannot publish because the Publish
button is not rendered for them, and in practice that is enough. Here there are at least three
doors — wp-admin, the REST API the block editor uses, and the GraphQL mutation in Module 06 —
and a rule enforced by a rendered button is enforced at none of them. That is why this lesson
puts the rule in `auth_callback` and why Lesson 03.5 puts it in the capability map: the
constraint has to live somewhere every door has to walk through, and a hidden button is not that
place.

---

## Key Concepts

### 1. `register_post_meta` is a declaration layered on storage you already have

`update_post_meta( 42, 'downtime_minutes', 90 )` writes the same `wp_postmeta` row it always
did. Registration changes nothing about that. What it adds is a **description of the key** that
other consumers can read:

| Argument | What it buys | What happens without it |
|---|---|---|
| `type` | `'number'`, `'string'`, `'boolean'` in the REST schema | REST refuses the key or types it as a string |
| `single` | `get_post_meta( $id, $key, true )` semantics in REST | REST returns an array for a scalar |
| `default` | a value for posts that never set the key | `''` — and `'' == 0` is a bug waiting to happen |
| `show_in_rest` | the key appears in the post's `meta` object | the block editor cannot read it |
| `sanitize_callback` | runs on **every** write, including `update_post_meta()` | whatever the caller passed is what is stored |
| `auth_callback` | gates `edit_post_meta` — which REST consults | **defaults to `__return_true`** for non-protected keys |
| `revisions_enabled` | the value is copied into revisions | Module 17's preview shows the live value, not the draft's |

Two rows are load-bearing and the rest are hygiene. `sanitize_callback` is the only place a
type is *enforced* rather than declared, and `auth_callback`'s default should worry you: a
carelessly registered meta key is writable through REST by anyone who can edit the post.

> **`post_type_supports( 'incident', 'custom-fields' )` must be true for any of this to reach
> REST.** You set it in Lesson 03.2 §5. Without it the `meta` object is absent from the REST
> response entirely, and the symptom is "my field does not save" with no error anywhere.

### 2. Registered meta versus a hand-rolled meta box

The pre-SCF way was `add_meta_box`, a `wp_nonce_field`, and a `save_post` handler that reads
`$_POST` and calls `update_post_meta`. That code still works. Here is what it does not do:

| | `add_meta_box` + `save_post` | `register_post_meta` |
|---|---|---|
| Editing UI | you write the HTML | none — SCF or the block editor provides it |
| Declared type | ❌ nothing knows the key exists | ✅ `type` + `single` |
| Sanitised on **every** write path | ❌ only the one you wrote | ✅ including WP-CLI and the seeder |
| Authorisation | your own `current_user_can` — if you remembered | ✅ `auth_callback`, consulted by core |
| Discoverable | ❌ grep | ✅ `get_registered_meta_keys()` |

**The verdict: register the key, and let something else draw the form.** SCF draws the form
(Module 04) and writes to exactly the same `wp_postmeta` rows under the same key names. Two
registrations, one storage, different jobs — SCF owns the editing experience,
`register_post_meta` owns the contract.

That division explains something you have certainly seen: half the custom fields in a legacy
WordPress site store the wrong type. `"90"` for a number, `"on"` for a boolean, `""` for null.
Nothing ever told the system what the key was for, so nothing ever checked.

### 3. Registering meta does not put it in the GraphQL schema

This surprises people, so it is worth stating flatly: **`register_post_meta` has no effect on
WPGraphQL.** There is no automatic projection of meta keys into the schema, and that is a
feature — an application's meta keys include internal bookkeeping nobody outside should see.

Three routes exist, and this project uses two of them:

| Route | Used for | Where |
|---|---|---|
| **SCF field group with `show_in_graphql`** | every field in appendix 03 §4.1 — they arrive under `incidentDetails` | Lesson 04.2 |
| **`register_graphql_field()`** | computed values like `blameScore`, and enum-typed projections of raw strings | Module 06 |
| Exposing raw meta wholesale | nothing, ever | — |

So a key registered here is REST-visible and GraphQL-invisible until Module 04 gives it a field
group. That is the right default: **each exposed field is API surface you have to keep working.**

### 4. `auth_callback` and the two layers it does not cover

The signature is fixed by core:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/statuses.php
function can_moderate_incident( bool $allowed, string $meta_key, int $object_id, int $user_id ): bool {
    return user_can( $user_id, 'edit_others_incidents' );
}
```

It is consulted by `map_meta_cap()` when something checks `edit_post_meta`, `add_post_meta` or
`delete_post_meta` — which the REST API does on every meta write. It is **not** consulted by
`update_post_meta()` called directly from PHP.

```
   REST  PUT /wp-json/wp/v2/incidents/42  { meta: { is_verified: true } }
        └─▶ current_user_can( 'edit_post_meta', 42, 'is_verified' )
              └─▶ map_meta_cap  ──▶  YOUR auth_callback   ✅ enforced

   PHP   update_post_meta( 42, 'is_verified', true )
        └─▶ straight to the database                      ⚠️ not enforced

   GraphQL  createIncident( input: { isVerified: true } )
        └─▶ your resolver                                 ← Module 06 checks, independently
```

That is not a hole, it is a layering decision: PHP inside your own process is trusted, requests
from outside are not. It does mean the rule is written twice — once in the `auth_callback` for
the REST door, once in the mutation resolver for the GraphQL door. Appendix 03 §4.1 says
`is_verified` is editable in wp-admin by an editor and silently discarded when a client sends
it to `createIncident`. Two pieces of code, one rule. That is the design, not duplication.

### 5. The moderation queue is a status machine with exactly one privileged edge

```
        public submission                editor decision
        (Module 16)                      (this lesson)
                                          ┌──▶  publish        visible to the front end
   ─────▶  pending  ────────────────────▶ ┤
           post_status='pending'          └──▶  btt_rejected   kept, never published
           is_verified = false
                                       requires publish_incidents
```

Core's `pending` needs no registration — it already has a wp-admin filter link, a count and a
list view. What core lacks is a terminal "no" distinct from `draft` and from deletion.

| Status | Registered by | Public | Counted in `wp_term_taxonomy.count` | Front end sees it |
|---|---|---|---|---|
| `pending` | core | no | no | no |
| `publish` | core | yes | **yes** | yes |
| `draft` | core | no | no | no |
| `btt_rejected` | **you** | no | no | no |

> **The block editor's status control does not list custom statuses.** This is a long-standing
> Gutenberg gap, not something you configured wrong. It is also why this lesson builds the
> transition as a **row action** and a **bulk action** on the list table rather than as a
> dropdown option — those work in every WordPress version, and they are what a moderator working
> a queue of forty submissions actually wants. Clicking into a post to change a dropdown is the
> slow path.

### 6. Four list-table hooks, and the one thing core will not do for you

`manage_incident_posts_columns` (filter) adds columns; `manage_incident_posts_custom_column`
(action) renders one cell and therefore **echoes**, so escaping happens there;
`manage_edit-incident_sortable_columns` (filter) declares which headers are clickable and the
`orderby` value each sends; `restrict_manage_posts` (action) draws filter controls above the
table.

`show_admin_column => true` on a taxonomy (Lesson 03.3) already added Severity and Scapegoat
columns, so you do not add them again — you make the ones core gave you **sortable**, which core
does not do for taxonomies at all. `WP_Query` cannot `ORDER BY` a taxonomy term, because the
term is three tables away, so sorting by one means adding the join yourself through
`posts_clauses`. And it is why `severity` slugs are prefixed `s1-` to `s4-`: sorted
alphabetically by slug, they sort by severity.

---

## Task

> **The first line of every code fence in this course is the destination path, not a line of
> the file.** PHP files start at their `<?php`. Paste from there down.

### Step 1: Write `includes/statuses.php`

Meta registration and the moderation status. Field names come from
[appendix 03 §4.1](../appendix/03-content-model-reference.md#41-incident-details) and must match
it exactly — Module 04's SCF group writes to these same keys.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/statuses.php
<?php
/**
 * Registered post meta and the moderation statuses.
 *
 * Contract: .lessons/appendix/03-content-model-reference.md §4.1
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

/** A moderated submission that will never be published. Not `draft`, not deleted. */
const STATUS_REJECTED = 'btt_rejected';

add_action( 'init', __NAMESPACE__ . '\\register_moderation_statuses' );
add_action( 'init', __NAMESPACE__ . '\\register_incident_meta' );

/** Register the terminal "no": kept, filterable, never publishable. */
function register_moderation_statuses(): void {
	register_post_status(
		STATUS_REJECTED,
		array(
			'label'                     => _x( 'Rejected', 'post status', 'blame-the-tech-core' ),
			'public'                    => false, // never resolvable on the front end
			'internal'                  => false, // but editors may see and filter it
			'protected'                 => true,
			'exclude_from_search'       => true,
			'show_in_admin_all_list'    => false, // keep the queue clean
			'show_in_admin_status_list' => true,  // but give it a filter link and a count
			// The plural form is identical here; _n_noop() still wants both.
			'label_count'               => _n_noop(
				'Rejected <span class="count">(%s)</span>',
				'Rejected <span class="count">(%s)</span>',
				'blame-the-tech-core'
			),
		)
	);
}

/** Closed value sets. Lesson 06.1 turns these into real GraphQL enums. */
const INCIDENT_ENVIRONMENTS = array( 'production', 'staging', 'development', 'works-on-my-machine' );
const INCIDENT_RESOLUTIONS  = array( 'open', 'mitigated', 'blamed', 'wontfix' );

/** Clamp a numeric meta value into its documented range. */
function clamp_number( mixed $value, float $min, float $max ): float {
	return (float) max( $min, min( $max, (float) $value ) );
}

/**
 * Build a sanitiser that only lets a value through if it is in the list.
 *
 * @param string[] $allowed Allowed values; the first is the fallback.
 */
function one_of( array $allowed ): callable {
	return static fn( $value ): string =>
		in_array( (string) $value, $allowed, true ) ? (string) $value : $allowed[0];
}

/**
 * Normalise a date-time string, rejecting anything in the future. Returns ''
 * rather than a wrong value: an empty field is visibly missing, where a
 * silently corrected date is a lie the front end will render.
 */
function sanitize_occurred_at( mixed $value ): string {
	$time = strtotime( sanitize_text_field( (string) $value ) );

	return ( false === $time || $time > time() ) ? '' : gmdate( 'Y-m-d H:i:s', $time );
}

/**
 * May this user write incident meta at all? Core's `$allowed` guess is
 * deliberately ignored — the signature is fixed by `map_meta_cap()`.
 *
 * @param bool   $allowed   Core's guess.
 * @param string $meta_key  Meta key.
 * @param int    $object_id Post ID.
 * @param int    $user_id   User ID.
 */
function can_edit_incident_meta( bool $allowed, string $meta_key, int $object_id, int $user_id ): bool {
	return user_can( $user_id, 'edit_post', $object_id );
}

/**
 * May this user write MODERATOR-ONLY incident meta? `is_verified` is the trust
 * boundary from appendix 03 §4.1: a reporter may edit their own pending
 * incident and still cannot set this. Same four arguments as above.
 */
function can_moderate_incident_meta( bool $allowed, string $meta_key, int $object_id, int $user_id ): bool {
	return user_can( $user_id, 'edit_others_incidents' );
}

/**
 * Register every non-taxonomy field of `incident`.
 *
 * SCF builds the editing UI for these keys in Module 04 and writes to the same
 * rows; registration gives them a type, a sanitiser, a REST projection and an
 * authorisation callback. The spec array below IS appendix 03 §4.1, in code:
 * key => [ type, sanitize_callback, overrides ].
 */
function register_incident_meta(): void {
	$editable  = __NAMESPACE__ . '\\can_edit_incident_meta';
	$moderator = __NAMESPACE__ . '\\can_moderate_incident_meta';

	$meta = array(
		'occurred_at'           => array( 'string', __NAMESPACE__ . '\\sanitize_occurred_at' ),
		'downtime_minutes'      => array( 'number', static fn( $v ): float => clamp_number( $v, 0, 100000 ) ),
		'estimated_cost_usd'    => array( 'number', static fn( $v ): float => clamp_number( $v, 0, 1000000000 ) ),
		'blame_confidence'      => array( 'number', static fn( $v ): float => clamp_number( $v, 0, 100 ), array( 'default' => 73 ) ),
		'environment'           => array( 'string', one_of( INCIDENT_ENVIRONMENTS ), array( 'default' => INCIDENT_ENVIRONMENTS[0] ) ),
		'resolution_status'     => array( 'string', one_of( INCIDENT_RESOLUTIONS ), array( 'default' => INCIDENT_RESOLUTIONS[0] ) ),
		// sanitize_textarea_field, NOT wp_kses_post: a stack trace is not HTML.
		// It renders inside <pre>, escaped on output (Module 14), never through
		// dangerouslySetInnerHTML.
		'stack_trace'           => array( 'string', 'sanitize_textarea_field' ),
		'reporter_display_name' => array( 'string', 'sanitize_text_field' ),
		// The one key with a different auth_callback. That is the whole point.
		'is_verified'           => array(
			'boolean',
			static fn( $v ): bool => (bool) $v,
			array(
				'default'           => false,
				'auth_callback'     => $moderator,
				'revisions_enabled' => false, // a moderation fact, not editorial content
			),
		),
	);

	foreach ( $meta as $key => $spec ) {
		register_post_meta(
			'incident',
			$key,
			array_merge(
				array(
					'type'              => $spec[0],
					'single'            => true,
					'show_in_rest'      => true,
					'revisions_enabled' => true,
					'sanitize_callback' => $spec[1],
					'auth_callback'     => $editable,
				),
				$spec[2] ?? array()
			)
		);
	}
}
```

**Verify §1:**

- [ ] Every key has an explicit `auth_callback`. The default is `__return_true`, so an omission
      is not a smaller mistake than a wrong callback — it is a bigger one.
- [ ] `is_verified` is the only key using `can_moderate_incident_meta`.
- [ ] Every key name matches appendix 03 §4.1 character for character. Module 04's SCF group
      writes to these keys; a typo here becomes two meta rows that never meet.

### Step 2: Write `includes/admin/incident-columns.php`

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/admin/incident-columns.php
<?php
/**
 * The incidents list table: columns, sorting, filtering and moderation actions.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

add_filter( 'manage_incident_posts_columns', __NAMESPACE__ . '\\incident_columns' );
add_action( 'manage_incident_posts_custom_column', __NAMESPACE__ . '\\render_incident_column', 10, 2 );
add_filter( 'manage_edit-incident_sortable_columns', __NAMESPACE__ . '\\incident_sortable_columns' );
add_action( 'pre_get_posts', __NAMESPACE__ . '\\order_incidents_by_meta' );
add_filter( 'posts_clauses', __NAMESPACE__ . '\\order_incidents_by_taxonomy', 10, 2 );
add_action( 'restrict_manage_posts', __NAMESPACE__ . '\\render_scapegoat_filter' );
add_filter( 'post_row_actions', __NAMESPACE__ . '\\incident_row_actions', 10, 2 );
add_action( 'admin_post_btt_approve_incident', __NAMESPACE__ . '\\handle_approve_incident' );
add_filter( 'bulk_actions-edit-incident', __NAMESPACE__ . '\\incident_bulk_actions' );
add_filter( 'handle_bulk_actions-edit-incident', __NAMESPACE__ . '\\handle_incident_bulk_action', 10, 3 );
add_action( 'admin_notices', __NAMESPACE__ . '\\incident_admin_notices' );

/**
 * Add two columns after the title. Severity and Scapegoat are already there,
 * courtesy of `show_admin_column` in Lesson 03.3.
 *
 * @param array<string, string> $columns Existing columns.
 */
function incident_columns( array $columns ): array {
	$out = array();

	foreach ( $columns as $key => $label ) {
		$out[ $key ] = $label;
		if ( 'title' === $key ) {
			$out['btt_downtime'] = __( 'Downtime', 'blame-the-tech-core' );
			$out['btt_verified'] = __( 'Verified', 'blame-the-tech-core' );
		}
	}

	return $out;
}

/** Render one cell. This ECHOES, so everything is escaped here. */
function render_incident_column( string $column, int $post_id ): void {
	if ( 'btt_downtime' === $column ) {
		echo esc_html( sprintf( '%d min', (int) get_post_meta( $post_id, 'downtime_minutes', true ) ) );
	}
	if ( 'btt_verified' === $column ) {
		echo get_post_meta( $post_id, 'is_verified', true )
			? esc_html__( 'yes', 'blame-the-tech-core' )
			: esc_html__( '—', 'blame-the-tech-core' );
	}
}

/** Which columns are clickable, and the `orderby` value each one sends. */
function incident_sortable_columns( array $columns ): array {
	$columns['taxonomy-severity']  = 'severity';
	$columns['taxonomy-scapegoat'] = 'scapegoat';
	$columns['btt_downtime']       = 'downtime_minutes';
	return $columns;
}

/** True only for the incidents list table in wp-admin. */
function is_incident_admin_query( \WP_Query $query ): bool {
	return is_admin() && $query->is_main_query() && 'incident' === $query->get( 'post_type' );
}

/** Sorting by a scalar is `meta_key` plus `meta_value_num`. Nothing exotic. */
function order_incidents_by_meta( \WP_Query $query ): void {
	if ( is_incident_admin_query( $query ) && 'downtime_minutes' === $query->get( 'orderby' ) ) {
		$query->set( 'meta_key', 'downtime_minutes' );
		$query->set( 'orderby', 'meta_value_num' );
	}
}

/**
 * Sorting by a TAXONOMY needs the join WP_Query will not write for you: the
 * three-table join from Lesson 03.3 §1, by hand. Ordering on `btt_t.slug` is
 * why the severity slugs are prefixed s1- to s4-.
 *
 * @param array<string, string> $clauses SQL clauses.
 * @param \WP_Query             $query   The query.
 */
function order_incidents_by_taxonomy( array $clauses, \WP_Query $query ): array {
	if ( ! is_incident_admin_query( $query ) ) {
		return $clauses;
	}

	$orderby = (string) $query->get( 'orderby' );

	// An allowlist, not a sanitiser: only these two strings ever reach SQL.
	if ( ! in_array( $orderby, array( 'severity', 'scapegoat' ), true ) ) {
		return $clauses;
	}

	global $wpdb;

	$clauses['join'] .= " LEFT JOIN {$wpdb->term_relationships} AS btt_tr ON btt_tr.object_id = {$wpdb->posts}.ID"
		. " LEFT JOIN {$wpdb->term_taxonomy} AS btt_tt ON btt_tt.term_taxonomy_id = btt_tr.term_taxonomy_id"
		. " LEFT JOIN {$wpdb->terms} AS btt_t ON btt_t.term_id = btt_tt.term_id";

	// Even an allowlisted value goes through prepare(). No exceptions, ever.
	$clauses['where']  .= $wpdb->prepare( ' AND ( btt_tt.taxonomy = %s OR btt_tt.taxonomy IS NULL )', $orderby );
	// Without this, a post with two terms appears twice in the list.
	$clauses['groupby'] = "{$wpdb->posts}.ID";
	$clauses['orderby'] = 'btt_t.slug ' . ( 'asc' === strtolower( (string) $query->get( 'order' ) ) ? 'ASC' : 'DESC' );

	return $clauses;
}

/**
 * A scapegoat dropdown above the list. `WP_Query` already understands a query
 * var named after the taxonomy, so no `pre_get_posts` handling is needed.
 */
function render_scapegoat_filter( string $post_type ): void {
	if ( 'incident' !== $post_type ) {
		return;
	}

	// A read-only list filter: it changes no state, so it needs no nonce.
	wp_dropdown_categories(
		array(
			'taxonomy'        => 'scapegoat',
			'name'            => 'scapegoat',
			'value_field'     => 'slug',
			'show_option_all' => __( 'All scapegoats', 'blame-the-tech-core' ),
			'selected'        => isset( $_GET['scapegoat'] ) ? sanitize_key( wp_unslash( $_GET['scapegoat'] ) ) : '',
			'hierarchical'    => false,
			'hide_empty'      => false,
		)
	);
}

/** An "Approve" row action, on pending incidents only. */
function incident_row_actions( array $actions, \WP_Post $post ): array {
	if ( 'incident' !== $post->post_type || 'pending' !== $post->post_status ) {
		return $actions;
	}

	if ( ! current_user_can( 'publish_incidents' ) || ! current_user_can( 'edit_post', $post->ID ) ) {
		return $actions;
	}

	$args = array(
		'action' => 'btt_approve_incident',
		'post'   => $post->ID,
	);
	$url  = wp_nonce_url(
		add_query_arg( $args, admin_url( 'admin-post.php' ) ),
		'btt_approve_incident_' . $post->ID
	);

	$actions['btt_approve'] = sprintf( '<a href="%s">%s</a>', esc_url( $url ), esc_html__( 'Approve', 'blame-the-tech-core' ) );

	return $actions;
}

/**
 * Publish one incident and mark it verified. Callers check capabilities.
 */
function approve_incident( int $post_id ): bool {
	$post = get_post( $post_id );

	if ( ! $post instanceof \WP_Post || 'incident' !== $post->post_type ) {
		return false;
	}

	$result = wp_update_post(
		array(
			'ID'          => $post_id,
			'post_status' => 'publish',
		),
		true
	);
	if ( is_wp_error( $result ) ) {
		return false;
	}

	// A direct meta write bypasses the auth_callback, which is correct here:
	// the capability was checked by the caller, and this is server-side code
	// recording a moderation fact, not a client supplying a value.
	update_post_meta( $post_id, 'is_verified', true );

	return true;
}

/**
 * The single-row Approve link. Nonce first, capability second, work third.
 */
function handle_approve_incident(): void {
	$post_id = isset( $_GET['post'] ) ? absint( wp_unslash( $_GET['post'] ) ) : 0;

	check_admin_referer( 'btt_approve_incident_' . $post_id ); // dies on failure

	if ( 0 === $post_id || ! current_user_can( 'publish_incidents' ) || ! current_user_can( 'edit_post', $post_id ) ) {
		wp_die( esc_html__( 'Not allowed.', 'blame-the-tech-core' ), '', array( 'response' => 403 ) );
	}

	$done = approve_incident( $post_id ) ? 1 : 0;
	wp_safe_redirect( add_query_arg( 'btt_approved', $done, admin_url( 'edit.php?post_type=incident' ) ) );
	exit;
}

/** The matching bulk action, for working forty submissions at once. */
function incident_bulk_actions( array $actions ): array {
	if ( current_user_can( 'publish_incidents' ) ) {
		$actions['btt_approve'] = __( 'Approve (publish)', 'blame-the-tech-core' );
	}
	return $actions;
}

/**
 * WordPress has already verified the bulk-action nonce before this filter runs,
 * so the only check left is the capability — per row, not once for the batch.
 *
 * @param string $redirect_to Where to send the user next.
 * @param string $action      The chosen bulk action.
 * @param int[]  $post_ids    Selected post IDs.
 */
function handle_incident_bulk_action( string $redirect_to, string $action, array $post_ids ): string {
	if ( 'btt_approve' !== $action || ! current_user_can( 'publish_incidents' ) ) {
		return $redirect_to;
	}

	$done = 0;
	foreach ( $post_ids as $post_id ) {
		if ( current_user_can( 'edit_post', (int) $post_id ) && approve_incident( (int) $post_id ) ) {
			++$done;
		}
	}

	return add_query_arg( 'btt_approved', $done, $redirect_to );
}

/** Report the result of a row action or a bulk action. */
function incident_admin_notices(): void {
	if ( ! isset( $_GET['btt_approved'] ) ) {
		return;
	}

	$count = absint( wp_unslash( $_GET['btt_approved'] ) );

	/* translators: %d: number of incidents approved. */
	$text = sprintf( _n( '%d incident approved.', '%d incidents approved.', $count, 'blame-the-tech-core' ), $count );

	printf( '<div class="notice notice-success is-dismissible"><p>%s</p></div>', esc_html( $text ) );
}
```

### Step 3: Load both files

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	private const INCLUDES = array(
		'includes/post-types.php',                 // Lesson 03.2
		'includes/taxonomies.php',                 // Lesson 03.3
		'includes/statuses.php',                   // Lesson 03.4
		'includes/admin/incident-columns.php',     // Lesson 03.4
		// 'includes/roles.php',                      ← Lesson 03.5
	);
```

**Verify §3:**

- [ ] `mkdir -p includes/admin` first, or the `require_once` fatals.
- [ ] Reload wp-admin. No `Failed opening required` in `docker compose logs wordpress`.

### Step 4: Work the queue by hand

```bash
cd wordpress-headless

# A submission arrives exactly as Module 16 will create it: pending, unverified.
ID=$(docker compose run --rm wpcli wp post create --post_type=incident \
  --post_title='The intern deployed on Friday' --post_name=intern-deployed-on-friday \
  --post_status=pending --porcelain | tr -d '\r')

docker compose run --rm wpcli wp post term add "$ID" severity s2-major
docker compose run --rm wpcli wp post term add "$ID" scapegoat the-intern
docker compose run --rm wpcli wp post meta update "$ID" downtime_minutes 145
docker compose run --rm wpcli wp post meta update "$ID" occurred_at '2024-11-15 09:20:00'
```

Now open `http://localhost:8080/wp-admin/edit.php?post_type=incident&post_status=pending`.

**Verify §4:**

- [ ] The **Pending** filter link shows a count of 1, and the row reads Downtime `145 min`,
      Verified `—`.
- [ ] Hovering the row shows an **Approve** action. Click it: the row moves to Published, Verified
      becomes `yes`, and a green notice says "1 incident approved."
- [ ] The **Severity** and **Scapegoat** headers both sort, and Severity sorts S1 → S4 rather
      than alphabetically by label.
- [ ] The **All scapegoats** dropdown filters the list; the URL gains `?scapegoat=the-intern`.

### Step 5: Note what `transition_post_status` will be for

Add one line to your notes: the `pending → publish` edge you just built by hand is the hook
point Module 18 attaches the revalidation webhook to. `transition_post_status` fires with
`( $new_status, $old_status, $post )` for **every** status change — WP-CLI, REST and the Module
06 mutation included — which is why the webhook goes there and not inside `approve_incident()`.
One transition, one place, every door.

---

## Verification

```bash
cd wordpress-headless

# 1. Every contract key is registered, with its type and a NON-default auth callback
docker compose run --rm wpcli wp eval '
$keys = get_registered_meta_keys( "post", "incident" );
foreach ( $keys as $key => $args ) {
  printf( "%-24s %-8s single=%s auth=%s%s", $key, $args["type"], var_export( $args["single"], true ),
    is_string( $args["auth_callback"] ) ? $args["auth_callback"] : "closure", PHP_EOL );
}'
# Expected: nine rows — downtime_minutes, estimated_cost_usd, blame_confidence,
#           environment, resolution_status, occurred_at, reporter_display_name,
#           stack_trace, is_verified. NONE of them says __return_true.

# 2. The sanitize_callback runs on EVERY write path, including WP-CLI
ID=$(docker compose run --rm wpcli wp post create --post_type=incident \
      --post_title='Sanitizer probe' --post_name=sanitizer-probe \
      --post_status=pending --porcelain | tr -d '\r')
docker compose run --rm wpcli wp post meta update "$ID" downtime_minutes 999999999
docker compose run --rm wpcli wp post meta get "$ID" downtime_minutes
# Expected: 100000 — clamped to the contract's maximum, not the value you sent

# 3. NEGATIVE: a value outside the closed set is replaced, not stored
docker compose run --rm wpcli wp post meta update "$ID" environment 'the-moon'
docker compose run --rm wpcli wp post meta get "$ID" environment
# Expected: production — the first allowed value. NOT the-moon.

# 4. NEGATIVE: a future date is discarded rather than silently corrected
docker compose run --rm wpcli wp post meta update "$ID" occurred_at '2099-01-01 00:00:00'
docker compose run --rm wpcli wp post meta get "$ID" occurred_at
# Expected: empty output

# 5. The custom status exists and is not public
docker compose run --rm wpcli wp eval '
$s = get_post_status_object( "btt_rejected" );
printf( "%s public=%s protected=%s%s", $s->name, var_export( $s->public, true ),
  var_export( $s->protected, true ), PHP_EOL );'
# Expected: btt_rejected public=false protected=true

# 6. A rejected incident is invisible to an anonymous reader
docker compose run --rm wpcli wp post update "$ID" --post_status=btt_rejected
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:50){ nodes { slug } } }"}' | grep -c sanitizer-probe
# Expected: 0

# 7. NEGATIVE: the REST door is shut to an anonymous caller, and the value is unchanged
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "http://localhost:8080/wp-json/wp/v2/incidents/$ID" \
  -H 'Content-Type: application/json' -d '{"meta":{"is_verified":true}}'
docker compose run --rm wpcli wp post meta get "$ID" is_verified
# Expected: 401, then empty or 0. NOT 1.

# 8. Approving from PHP does what the row action does
docker compose run --rm wpcli wp post update "$ID" --post_status=pending
docker compose run --rm wpcli wp eval "\\Blame\\Core\\approve_incident( $ID );"
docker compose run --rm wpcli wp post get "$ID" --field=post_status
docker compose run --rm wpcli wp post meta get "$ID" is_verified
# Expected: publish, then 1

# 9. Clean up the probe, and no PHP notices from the new admin file
docker compose run --rm wpcli wp post delete "$ID" --force
docker compose logs --tail=60 wordpress | grep -iE 'php (warning|notice|fatal)' || echo clean
# Expected: clean
```

Checks 3 and 4 are the ones that pay off later. A field that cannot hold a wrong value is a field
the front end never has to defend against — and Module 10's generated TypeScript will assert
exactly the same shape from the other end.

## Control Questions

1. `register_post_meta` adds no editing UI and no GraphQL field. List what it *does* add, and
   say which single argument you would be most alarmed to find missing on `is_verified`.
2. The `auth_callback` blocks a REST write of `is_verified` but not `update_post_meta()` from
   PHP. Explain why that is a layering decision rather than a hole, and name the second place the
   same rule has to be written.
3. `pending` is core and `btt_rejected` is yours. Give two things core's status provides for
   free that you had to declare, and one reason `draft` would have been the wrong reuse.
4. Sorting the list by Downtime is a `meta_key` plus `meta_value_num`; sorting by Severity needs
   a `posts_clauses` join. Explain the difference in terms of where each value is stored, and say
   what the `groupby` line prevents.
5. The Approve row action checks the nonce, then `publish_incidents`, then
   `edit_post`. Say what each of the three protects against, and which one a reporter fails.

## Learn More

- [`register_post_meta()`](https://developer.wordpress.org/reference/functions/register_post_meta/) —
  the argument list, and the sentence about `auth_callback` defaulting to `__return_true`
- [`register_post_status()`](https://developer.wordpress.org/reference/functions/register_post_status/) —
  every argument, including the `label_count` `_n_noop()` shape that trips everyone up once
- [`map_meta_cap()`](https://developer.wordpress.org/reference/functions/map_meta_cap/) — read
  the `edit_post_meta` branch to see exactly where your `auth_callback` is consulted
- [`posts_clauses`](https://developer.wordpress.org/reference/hooks/posts_clauses/) — the six
  clauses you can rewrite, which is how the taxonomy sort in Step 2 works
- [`$wpdb->prepare()`](https://developer.wordpress.org/reference/classes/wpdb/prepare/) — the
  format specifiers, and why an allowlisted value still goes through it
