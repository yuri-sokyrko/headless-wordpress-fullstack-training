---
title: 'Custom Post Types for Headless'
module: 3
lesson: 2
teaches: [custom-post-types, show-in-graphql, show-in-rest-for-editor, capability-type, supports-array]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/post-types.php']
requires: [3.1]
---

# Lesson 03.2 — Custom Post Types for Headless

## Quick Overview

`incident` and `tech_review` are the two custom post types this application needs, and both are
registered exactly as
[appendix 03 §1](../appendix/03-content-model-reference.md#1-post-types) specifies. The
mechanics are `register_post_type` calls you could write in your sleep. What is new is the
handful of arguments that exist for a consumer that is not PHP: `show_in_graphql`,
`graphql_single_name`, `graphql_plural_name`, and the `capability_type` /`map_meta_cap` pair
that Lesson 03.5 builds the reporter role on top of.

Three of the arguments deserve attention before you type them. `show_in_rest => true` stays on
even though nothing in this course consumes REST — the block editor *is* a REST client, and
turning REST off for a post type gives editors a white screen. `publicly_queryable => true`
stays on for `incident` even though WordPress never renders a visible front end, because
permalink generation and `preview_post_link` depend on it and Module 17's preview flow will need
them. And the singular/plural GraphQL names are load-bearing in a way post type slugs are not:
they become `incident`, `incidents`, `Incident` and `IncidentConnection` in the schema, and they
become TypeScript type names via codegen in Module 10. Renaming one later is a breaking API
change, not a cosmetic edit.

By the end of this lesson you will have:

- `includes/post-types.php` registering `incident` and `tech_review` per the contract
- `supports` arrays matching §1 exactly — including `custom-fields` on `incident`, which ACF
  and the REST meta endpoints both need
- `capability_type => 'incident'` and `map_meta_cap => true` on `incident`, generating the
  granular capabilities Lesson 03.5 assigns
- Both types visible in wp-admin, editable in the block editor, and listed by
  `wp post-type list`
- Rewrite bases `incidents` and `reviews` flushed and resolving
- A written note on why `graphql_single_name` is a public API name and the post type slug is not

## Classic WP Analogy

This is the most direct one-to-one mapping in the entire course. `register_post_type` is
`register_post_type`. `labels`, `supports`, `has_archive`, `rewrite`, `menu_icon`,
`hierarchical` — every argument you already know means what it always meant, fires on the same
`init` hook, and produces the same rows in `wp_posts` with the same `post_type` column value.
If you have built a portfolio CPT or an events CPT, you have already done ninety percent of
this lesson.

The additions are a thin layer of *visibility* flags. Think of `show_in_graphql` the way you
think of `show_in_rest`: it does not change how the data is stored or queried internally, it
changes which external API can see it. `graphql_single_name` and `graphql_plural_name` are the
equivalent of `rewrite['slug']` for a different consumer — they are the public identifier that
external code will hard-code, so you choose them once and carefully. `capability_type` you may
never have set, because for a CPT authored only by editors the default `post` capabilities are
fine; here `incident` is authored by the public, so it needs its own capability family.

**Where the analogy breaks down:** in Classic WordPress, forgetting an argument produces a
visible symptom you can chase — no archive page, a 404, a missing menu item, a field that will
not save. Here, forgetting `show_in_graphql` produces a post type that works perfectly in
wp-admin and **does not exist** as far as the front end is concerned. There is no error. There
is no 404. The schema simply has no `incidents` field, and the failure surfaces four modules
later as a GraphQL validation error in a query you were sure was correct. Registration
arguments are now API surface, and the feedback loop on getting one wrong is much longer than
you are used to.

---

## Key Concepts

### 1. Four identifiers, four consumers, one post type

`register_post_type` gives one entity four separate public names. They are not
interchangeable, they are read by different systems, and only one of them is cheap to change
later.

| Identifier | Value for `incident` | Read by | Cost of renaming |
|---|---|---|---|
| Post type slug | `incident` | `wp_posts.post_type`, `WP_Query`, WP-CLI, `get_post_type()` | **highest** — it is a column value in every row |
| `rewrite['slug']` | `incidents` | the URL router, `get_permalink()`, sitemaps | low — a redirect fixes it |
| `rest_base` | `incidents` | `/wp-json/wp/v2/incidents`, the block editor | low — nothing external consumes REST here |
| `graphql_single_name` / `graphql_plural_name` | `Incident` / `Incidents` | **the front end, via the schema** | **breaking API change** — see Key Concept 3 |

The mistake is to assume they must match. `incident` is singular because it names one row's
type, `incidents` is plural because it names a collection in a URL, and `Incident` is
capitalised because GraphQL types are PascalCase and codegen turns it into a TypeScript
`interface Incident`.

### 2. `show_in_rest` is not optional, even in a headless build

This is the trap that produces the most panicked questions in headless WordPress, so it gets
its own concept. **The block editor is a REST client.** Gutenberg is a React application that
talks to `/wp-json/wp/v2/<rest_base>` to load the post, autosave it, save it and read its meta.

```
      wp-admin/post.php?post=42&action=edit
                │
                ▼
   ┌────────────────────────┐   GET  /wp-json/wp/v2/incidents/42     ┌──────────┐
   │  Gutenberg (React)     │──────────────────────────────────────▶ │ WordPress│
   │  in the admin page     │   POST /wp-json/wp/v2/incidents/42     │  REST    │
   └────────────────────────┘ ◀──────────────────────────────────────└──────────┘
                                        ▲
                        show_in_rest => false breaks THIS,
                        not your front end
```

| `show_in_rest` | wp-admin list table | Block editor | Classic editor | Your front end |
|---|---|---|---|---|
| `true` | works | works | works | unaffected — it reads GraphQL |
| `false` | works | **white screen** | works | unaffected |

The white screen is the whole symptom. No PHP error, no notice in `debug.log`, just an empty
editor canvas and a failed request in the browser console. And the instinctive fix — "fine,
disable Gutenberg for this post type with `use_block_editor_for_post_type`" — is the wrong
lesson to learn.

> **Leave REST on for the editor; simply do not consume REST from the front end.** REST being
> enabled is not an architectural statement. It is how wp-admin works. The architectural
> statement is that `next-app` only ever calls `/graphql` — and that is enforced by what you
> write in `next-app`, not by crippling wp-admin. Appendix 03 §1 states this as a rule for
> every post type in the course.

### 3. GraphQL names are API surface, and renaming one is a breaking change

`show_in_graphql => true` plus the two names produce a surprising amount of schema. From
`graphql_single_name: 'Incident'` and `graphql_plural_name: 'Incidents'`, WPGraphQL derives:

```
  graphql_single_name: Incident          graphql_plural_name: Incidents
        │                                       │
        ├─ type      Incident                   ├─ rootQuery  incidents(...)
        ├─ rootQuery incident(id:, idType:)     ├─ type       RootQueryToIncidentConnection
        ├─ input     ...Incident...             ├─ type       RootQueryToIncidentConnectionEdge
        └─ implements ContentNode,              └─ enums      IncidentIdType, ...
                      NodeWithTitle, ...
```

Every one of those names then travels:

| Where the name lands | Module | What a rename costs |
|---|---|---|
| The GraphQL schema | 05 | queries stop validating — total failure, not degradation |
| `wordpress-headless/schema.graphql`, committed | 06 | the CI schema diff fails, which is the point |
| Generated TypeScript types | 10 | `Incident` becomes an unknown symbol in every component |
| Component props and tests | 08, 12, 14 | a compile error per usage |

The post type slug has none of that reach — it is read by your own PHP and by WP-CLI. So the
*cheap-looking* argument is the expensive one. Choose the two GraphQL names once, from appendix
03 §1, and treat a change the way you would treat a change to a REST URL you published.

### 4. `capability_type` and `map_meta_cap`, set now and used in Lesson 03.5

By default a custom post type borrows `post`'s capabilities — `edit_posts`, `publish_posts` —
which means anyone who can edit a blog post can edit your CPT. For `tech_review` that is exactly
right: it is editor-only content, and reusing `post`'s capabilities is one less thing to grant.

For `incident` it is exactly wrong, because `incident` is authored by the public. So it gets its
own capability family:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/post-types.php
'capability_type' => 'incident',
'map_meta_cap'    => true,
'capabilities'    => array( 'create_posts' => 'create_incidents' ),
```

That generates `edit_incident`, `read_incident`, `delete_incident` (meta capabilities, checked
against a specific post) and `edit_incidents`, `edit_others_incidents`, `publish_incidents`,
`read_private_incidents`, `delete_incidents`, `delete_others_incidents`,
`edit_published_incidents` and friends (primitive capabilities, checked against a role).

The third line is the one nobody sets and everybody needs. **`create_posts` defaults to the
value of `edit_posts`** — so without it, `create_incidents` would not exist and "may submit a
new incident" would be indistinguishable from "may edit existing incidents". Appendix 03 §6
gives `incident_reporter` the first and a restricted form of the second, so they have to be
separable capabilities.

> **Setting `capability_type` has an immediate and alarming consequence.** The moment you
> register `incident` with its own capability family, *nobody holds any of those capabilities* —
> not even you. The Incidents menu will not appear in wp-admin, because the menu is gated on
> `edit_incidents`. That is not a bug, it is the mechanism working, and it is why Step 3 grants
> the family to `administrator` and `editor` in the same file. Lesson 03.5 then defines the role
> that deliberately does **not** get all of it.

### 5. `supports` decides which storage and which APIs exist

`supports` is not cosmetic — each entry switches on a meta box *and* a storage path *and*, in
several cases, a REST or GraphQL field.

| Support | For `incident` | What it actually enables |
|---|---|---|
| `title` | ✓ | `post_title`, and `NodeWithTitle` in the schema |
| `editor` | ✓ | `post_content`, `contentBlocks` in Module 14 |
| `revisions` | ✓ | `wp_posts` rows of type `revision`; Module 17's preview needs them |
| `author` | ✓ | `post_author` is respected; without it every incident is authored by whoever saved it |
| `custom-fields` | ✓ | **the `meta` REST field and `register_post_meta` visibility** — ACF and Lesson 03.4 both need it |
| `thumbnail` | ✗ | `_thumbnail_id`; `incident` uses an ACF image field instead |
| `excerpt` | ✗ | `post_excerpt`; the front end derives summaries from ACF fields |
| `comments` | ✗ | `wp_comments`; there is no comment UI in this application |

The `custom-fields` entry is the one to remember. Leave it off and `register_post_meta` still
registers the key, ACF still saves values, and the REST `meta` object is **absent** — so the
block editor cannot read or write your meta, and the failure looks like "my field does not
save".

`author` on `incident` and not on `tech_review` is deliberate: incidents have a submitter whose
identity matters for `edit_incidents` (own posts only), and reviews are institutional.

### 6. `public`, `publicly_queryable`, `has_archive` and `rewrite` when nothing renders

The `btt-headless` theme from Lesson 02.4 redirects every front-end request to Next. So what is
the point of URL arguments at all?

| Argument | Still matters? | Why |
|---|---|---|
| `public` | **yes** | Drives the defaults for everything below, and WPGraphQL treats non-public types as private data |
| `publicly_queryable` | **yes** | `get_permalink()` returns a real URL, and `preview_post_link` — Module 17's whole preview flow — is built from it |
| `rewrite['slug']` | **yes** | It is what `get_permalink()` produces, which is what Yoast puts in the sitemap (Module 19) and what the preview link contains |
| `has_archive` | barely | Only `get_post_type_archive_link()` reads it. Nothing renders it. Set it because it is free and Yoast's sitemap uses it |
| `rewrite['with_front']` | **yes** | `false` keeps `/incidents/...` out from under the `/blog` prefix you add in Step 4 |

`has_archive` is the honest "barely matters" case. In Classic WordPress it was the difference
between having an incidents listing page and not having one. Here the listing page is a Next.js
route at `/incidents` that queries `incidents(first: 20)` and has no relationship to the
WordPress archive, which still resolves and immediately redirects.

`publicly_queryable` is the opposite case — it looks pointless and is load-bearing. Turn it off
and `get_permalink()` starts returning `?post_type=incident&p=42`-shaped URLs, `preview_post_link`
has nothing sensible to filter, and Module 17's "Preview" button in wp-admin sends the editor
somewhere useless. The rule: **the WordPress URL is not user-facing, but it is the input to
several things that are.**

### 7. Moving the blog to `/blog` is a permalink-structure change, not a rewrite argument

Appendix 03 §1 puts core `post` under `/blog`. You cannot do that with `rewrite['slug']`,
because `post` does not have one — core builds post permalinks from the global
`permalink_structure` option instead.

```
   permalink_structure = '/%postname%/'          permalink_structure = '/blog/%postname%/'
   ─────────────────────────────────────         ────────────────────────────────────────
   /hello-world          post                    /blog/hello-world     post
   /about                page                    /about                page
   /incidents/dns-again  incident                /incidents/dns-again  incident
                                                        ▲
   ⚠ a page slugged "hello-world" and a post          with_front => false
     slugged "hello-world" collide                    keeps this OUT of /blog
```

Two reasons to do this rather than leave posts at the root. First, collisions: with posts at
`/`, every page slug competes with every post slug, and WordPress resolves it with "verbose page
rules" — an extra rule set checked on every request. Second, Module 09's catch-all `[...slug]`
route handles pages, and a distinct prefix lets the router dispatch on the first path segment
instead of asking WordPress what a slug is.

`with_front` is the argument that makes it safe. When `permalink_structure` has a static prefix,
every post type with `'with_front' => true` (the default) inherits it — so `incident` would land
at `/blog/incidents/dns-again`. Setting it to `false` on both custom types keeps them at the
root of their own namespace.

---

## Task

> **The first line of every code fence in this course is the destination path, not a line of
> the file.** PHP files start at their `<?php`. Paste from there down.

### Step 1: Install WPGraphQL as a measuring instrument

`show_in_graphql` is unobservable without something that reads it. Module 05 is where you learn
WPGraphQL properly; install it now so that every registration from here on can be verified
against the schema instead of taken on faith.

```bash
cd wordpress-headless
docker compose run --rm wpcli wp plugin install wp-graphql --activate
docker compose run --rm wpcli wp plugin list --status=active --field=name
```

**Verify §1:**

- [ ] `wp-graphql` appears in the active list.
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8080/graphql` prints
      `400` or `500` — an *error about a missing query* means the endpoint exists. A `404` means
      the plugin is not active.

> **You are not installing WPGraphQL CORS, now or ever.** Appendix 03 §8 makes this explicit:
> the browser never talks to `/graphql`, only the Next.js server runtime does, so there is no
> CORS policy to get wrong and no introspection surface reachable from the app's own traffic.
> Installing a CORS plugin would create the exposure it appears to manage.

### Step 2: Write `includes/post-types.php`

Every value below comes from
[appendix 03 §1](../appendix/03-content-model-reference.md#1-post-types). Read the inline
comments — they are the lesson.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/post-types.php
<?php
/**
 * Custom post types.
 *
 * Contract: .lessons/appendix/03-content-model-reference.md §1
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

/**
 * The blog lives under /blog. `post` has no rewrite slug of its own — core
 * builds its permalinks from this option. See Key Concept 7.
 */
const BLOG_PERMALINK_STRUCTURE = '/blog/%postname%/';

add_action( 'init', __NAMESPACE__ . '\\register_post_types' );

/**
 * Register `incident` and `tech_review`.
 *
 * Runs on `init`, and is also called directly by Plugin::activate(), because
 * `init` has not fired for this plugin during its own activation.
 */
function register_post_types(): void {

	register_post_type(
		'incident',
		array(
			'labels'              => array(
				'name'          => __( 'Incidents', 'blame-the-tech-core' ),
				'singular_name' => __( 'Incident', 'blame-the-tech-core' ),
				'menu_name'     => __( 'Incidents', 'blame-the-tech-core' ),
				'add_new_item'  => __( 'Add New Incident', 'blame-the-tech-core' ),
				'edit_item'     => __( 'Edit Incident', 'blame-the-tech-core' ),
				'all_items'     => __( 'All Incidents', 'blame-the-tech-core' ),
				'not_found'     => __( 'No incidents found.', 'blame-the-tech-core' ),
			),
			'description'         => __( 'A publicly submitted outage, moderated before publication.', 'blame-the-tech-core' ),

			// ── Visibility ──────────────────────────────────────────────────
			'public'              => true,
			'publicly_queryable'  => true, // permalinks + preview_post_link. Key Concept 6.
			'show_ui'             => true,
			'show_in_menu'        => true,
			'show_in_nav_menus'   => false, // navigation comes from core menus, not from this
			'menu_position'       => 21,
			'menu_icon'           => 'dashicons-warning',

			// ── Consumers ───────────────────────────────────────────────────
			// REQUIRED. The block editor is a REST client; false = white screen.
			'show_in_rest'        => true,
			'rest_base'           => 'incidents',
			'show_in_graphql'     => true,
			'graphql_single_name' => 'Incident',
			'graphql_plural_name' => 'Incidents',

			// ── URLs ────────────────────────────────────────────────────────
			'hierarchical'        => false,
			'has_archive'         => 'incidents',
			'rewrite'             => array(
				'slug'       => 'incidents',
				'with_front' => false, // stay out from under the /blog prefix
			),

			// ── Storage ─────────────────────────────────────────────────────
			// `custom-fields` is what exposes the REST `meta` object. Lesson 03.4
			// and ACF both depend on it.
			'supports'            => array( 'title', 'editor', 'revisions', 'author', 'custom-fields' ),
			'delete_with_user'    => false, // deleting a reporter must not delete the record

			// ── Authorisation ───────────────────────────────────────────────
			'capability_type'     => 'incident',
			'map_meta_cap'        => true,
			'capabilities'        => array(
				// Without this line `create_posts` falls back to `edit_incidents`
				// and "may submit" cannot be granted separately from "may edit".
				'create_posts' => 'create_incidents',
			),
		)
	);

	register_post_type(
		'tech_review',
		array(
			'labels'              => array(
				'name'          => __( 'Tech Reviews', 'blame-the-tech-core' ),
				'singular_name' => __( 'Tech Review', 'blame-the-tech-core' ),
				'menu_name'     => __( 'Tech Reviews', 'blame-the-tech-core' ),
				'add_new_item'  => __( 'Add New Tech Review', 'blame-the-tech-core' ),
				'edit_item'     => __( 'Edit Tech Review', 'blame-the-tech-core' ),
				'all_items'     => __( 'All Tech Reviews', 'blame-the-tech-core' ),
				'not_found'     => __( 'No tech reviews found.', 'blame-the-tech-core' ),
			),
			'description'         => __( 'A satirical review of a company or a tool.', 'blame-the-tech-core' ),

			'public'              => true,
			'publicly_queryable'  => true,
			'show_ui'             => true,
			'show_in_menu'        => true,
			'show_in_nav_menus'   => false,
			'menu_position'       => 22,
			'menu_icon'           => 'dashicons-star-half',

			'show_in_rest'        => true,
			'rest_base'           => 'tech-reviews',
			'show_in_graphql'     => true,
			'graphql_single_name' => 'TechReview',
			'graphql_plural_name' => 'TechReviews',

			'hierarchical'        => false,
			'has_archive'         => 'reviews',
			'rewrite'             => array(
				'slug'       => 'reviews',
				'with_front' => false,
			),

			'supports'            => array( 'title', 'editor', 'thumbnail', 'revisions' ),

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
function grant_incident_caps_to_core_roles(): void {
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

	foreach ( array( 'administrator', 'editor' ) as $role_name ) {
		$role = get_role( $role_name );

		if ( ! $role instanceof \WP_Role ) {
			continue;
		}

		foreach ( $caps as $cap ) {
			// add_cap() writes the whole wp_user_roles option, so only write
			// when something actually changes. This is the idempotency rule
			// from Lesson 03.1 §7 applied to roles.
			if ( ! $role->has_cap( $cap ) ) {
				$role->add_cap( $cap );
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
function ensure_permalink_structure(): void {
	if ( get_option( 'permalink_structure' ) === BLOG_PERMALINK_STRUCTURE ) {
		return;
	}

	global $wp_rewrite;
	$wp_rewrite->set_permalink_structure( BLOG_PERMALINK_STRUCTURE );
}
```

### Step 3: Load and activate the registrations

Two edits to `includes/Plugin.php`. First, add the file to the include list:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	private const INCLUDES = array(
		'includes/post-types.php',   // Lesson 03.2
		// 'includes/taxonomies.php',   ← Lesson 03.3
		// 'includes/statuses.php',     ← Lesson 03.4
		// 'includes/roles.php',        ← Lesson 03.5
	);
```

Then call the three functions from `activate()`, in this order:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	public static function activate(): void {
		// `init` has not fired for this plugin in this request, so the post
		// types do not exist yet and there would be no rewrite rules to flush.
		register_post_types();

		// A custom capability_type with no holders hides its own admin menu.
		grant_incident_caps_to_core_roles();

		// Writes permalink_structure and flushes, but only if it changed.
		ensure_permalink_structure();

		// LAST. Everything that adds a rewrite rule must already have run.
		flush_rewrite_rules();

		update_option( 'btt_core_version', VERSION, false );
	}
```

**Verify §3:**

- [ ] `docker compose run --rm wpcli wp plugin list` runs without a PHP fatal. A typo in the
      `INCLUDES` path produces `Failed opening required` and takes wp-admin down with it.
- [ ] The order is `register_post_types()` → caps → permalinks → `flush_rewrite_rules()`.
      Flushing first is the classic mistake and it fails silently.

### Step 4: Re-activate so the hook actually runs

The activation hook fires on a **transition**, so an already-active plugin will not run it.

```bash
docker compose run --rm wpcli wp plugin deactivate blame-the-tech-core
docker compose run --rm wpcli wp plugin activate blame-the-tech-core
docker compose run --rm wpcli wp rewrite structure '/blog/%postname%/' --hard
```

The third command is belt and braces: `ensure_permalink_structure()` already did it, and running
it by hand proves the value you expect is the value WordPress has. It is also the exact command
Module 24's `release_command` uses.

It answers with `Success: Rewrite structure set.` **and**
`Warning: Regenerating a .htaccess file requires special configuration. See usage docs.` — expect
that warning and ignore it. `--hard` asks WP-CLI to write `.htaccess` as well as the database
rules, and it declines because it cannot tell whether Apache reads one; this image serves the
pretty permalinks from `mod_rewrite` with `AllowOverride` already configured, so the rules that
matter are in the database and they are set. The `Success` line is the one to read.

> **This is also the lesson that makes Lesson 02.4's `/graphql` check change its answer.** Until
> now `permalink_structure` was empty, so WordPress parsed no paths and `redirect_canonical`
> answered `/graphql` with a `301` to `/graphql/`. From this step on the route genuinely does not
> exist and you get a clean `404` — which is what Module 05 replaces with WPGraphQL.

### Step 5: Create one of each and look at what you got

Reload wp-admin. **Incidents** and **Tech Reviews** should both be in the sidebar now — reviews
because they use `post` capabilities your admin user already had, incidents because Step 3
granted the generated family to `administrator`. If the Incidents menu is missing, the caps
grant did not run: re-run Step 4.

```bash
docker compose run --rm wpcli wp post create \
  --post_type=incident \
  --post_title='DNS took down checkout on a Friday' \
  --post_name=dns-took-down-checkout \
  --post_status=publish \
  --porcelain
# prints the new post ID

docker compose run --rm wpcli wp post create \
  --post_type=tech_review \
  --post_title='Kubernetes: a review' \
  --post_name=kubernetes-a-review \
  --post_status=publish \
  --porcelain
```

**Verify §5:**

- [ ] `http://localhost:8080/wp-admin/edit.php?post_type=incident` lists the incident.
- [ ] Opening it shows the **block editor**, not a white canvas. A white canvas means
      `show_in_rest` is missing or `false`.
- [ ] The permalink shown under the title is `http://localhost:8080/incidents/dns-took-down-checkout/`
      — **not** `/blog/incidents/...`. If it has the `/blog` prefix, `with_front` is not `false`.

### Step 6: Write down the naming rule

Add four or five sentences to `docs/adr/` — or to the content-model document you started in
Lesson 01.2 — stating that `graphql_single_name` and `graphql_plural_name` are public API names
frozen by appendix 03 §1, that the post type slug is internal, and what a rename would cost in
Modules 06, 10 and 14. You will want this written down the first time someone proposes renaming
`Incident` to `Outage`.

---

## Verification

```bash
cd wordpress-headless

# 1. Both post types are registered
docker compose run --rm wpcli wp post-type list --field=name | grep -E '^(incident|tech_review)$'
# Expected: incident and tech_review

# 2. The registration arguments WordPress actually stored — not what you meant to write.
#    These properties are readable without WPGraphQL, because register_post_type()
#    copies every argument onto the WP_Post_Type object.
docker compose run --rm wpcli wp eval '
foreach ( array( "incident", "tech_review" ) as $t ) {
  $o = get_post_type_object( $t );
  printf( "%s rest=%s gql=%s single=%s plural=%s cap=%s%s",
    $t, var_export( $o->show_in_rest, true ), var_export( $o->show_in_graphql, true ),
    $o->graphql_single_name, $o->graphql_plural_name, $o->capability_type, PHP_EOL );
}'
# Expected: incident    rest=true gql=true single=Incident   plural=Incidents  cap=incident
#           tech_review rest=true gql=true single=TechReview plural=TechReviews cap=post

# 3. `create_incidents` is a real, separate capability (the create_posts override)
docker compose run --rm wpcli wp eval 'echo get_post_type_object("incident")->cap->create_posts, PHP_EOL;'
# Expected: create_incidents
#           If it prints edit_incidents, the `capabilities` array is missing.

# 4. Both types are in the GraphQL schema, by name
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ a: __type(name:\"Incident\"){ name } b: __type(name:\"TechReview\"){ name } }"}'
# Expected: {"data":{"a":{"name":"Incident"},"b":{"name":"TechReview"}}}

# 5. ...and the plural names produced real root fields that return data
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:5){ nodes { title slug } } techReviews(first:5){ nodes { title } } }"}'
# Expected: the incident and the review you created in Step 5

# 6. NEGATIVE: a type that was never registered is absent, not empty
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"Scapegoat\"){ name } }"}'
# Expected: {"data":{"__type":null}} — taxonomies are Lesson 03.3

# 7. NEGATIVE: querying a field that does not exist fails the WHOLE query
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1){ nodes { title severityLevel } } }"}'
# Expected: an "errors" array saying severityLevel does not exist on Incident,
#           and NO "data" for the fields that were valid. GraphQL validates the
#           whole document before any resolver runs.

# 8. The permalink structure moved the blog
docker compose run --rm wpcli wp option get permalink_structure
# Expected: /blog/%postname%/

# 9. Rewrite rules were flushed and the incident rule exists
docker compose run --rm wpcli wp rewrite list --match=/incidents/dns-took-down-checkout/ --fields=match,query
# Expected: one or more rows whose query contains incident=$matches[1]
#           NO ROWS means flush_rewrite_rules() never ran with the type registered.

# 10. Permalinks are what the front end and Yoast will consume
docker compose run --rm wpcli wp post list --post_type=incident --field=url
# Expected: http://localhost:8080/incidents/dns-took-down-checkout/
#           NOT /blog/incidents/... (with_front) and NOT /?p=42 (permalink_structure)

# 11. The block editor's REST route exists for both types
curl -s -o /dev/null -w 'incidents=%{http_code}\n'  http://localhost:8080/wp-json/wp/v2/incidents
curl -s -o /dev/null -w 'reviews=%{http_code}\n'    http://localhost:8080/wp-json/wp/v2/tech-reviews
# Expected: incidents=200 and reviews=200. A 404 here is the white-screen editor bug.

# 12. `custom-fields` support is on, so REST exposes a meta object (Lesson 03.4 needs it)
docker compose run --rm wpcli wp eval 'var_export( post_type_supports( "incident", "custom-fields" ) );'
# Expected: true

# 13. Nothing fataled
docker compose logs --tail=40 wordpress | grep -iE 'php (warning|notice|fatal)' || echo clean
# Expected: clean
```

Checks 6 and 7 are the two to internalise. In Classic WordPress a typo in a field name gives you
`null` and a blank space on the page; here it rejects the entire request. That strictness is what
makes Module 10's codegen possible, and it means the schema — not your memory — is the reference.

## Control Questions

1. `incident` has four public identifiers: `incident`, `incidents`, `incidents` and `Incident`.
   Say which consumer reads each one, and rank them by the cost of changing them after Module 10.
2. A colleague sets `show_in_rest => false` on `incident`, reasoning that the front end only uses
   GraphQL. Describe exactly what breaks, what the error message is, and why "disable Gutenberg
   for this post type" is the wrong fix.
3. `'capabilities' => array( 'create_posts' => 'create_incidents' )` looks redundant next to
   `capability_type => 'incident'`. State what WordPress does without it, and why appendix 03 §6
   cannot be implemented in that state.
4. `has_archive` is described as barely mattering while `publicly_queryable` is load-bearing,
   even though neither produces a page a visitor ever sees. Justify the asymmetry with two
   concrete things `publicly_queryable` feeds.
5. You move the blog to `/blog` by setting `permalink_structure`, and both custom post types set
   `'with_front' => false`. Predict the URL of an incident if you removed that argument, and name
   one thing in Module 19 that would then be wrong.

## Learn More

- [`register_post_type()`](https://developer.wordpress.org/reference/functions/register_post_type/) —
  the full argument list; read the `capability_type`, `capabilities` and `map_meta_cap` entries
  together rather than separately
- [Post Type Supports](https://developer.wordpress.org/reference/functions/post_type_supports/) —
  the canonical list of `supports` values, several of which switch on storage you did not ask for
- [The `WP_Post_Type` class](https://developer.wordpress.org/reference/classes/wp_post_type/) —
  `set_props()` is why every argument you pass is readable back as a property, which is what
  Verification check 2 exploits
- [WPGraphQL — custom post types](https://www.wpgraphql.com/docs/custom-post-types/) — the
  official statement of what `graphql_single_name` and `graphql_plural_name` generate. The separate
  naming-conventions page that used to hold the reserved-name and collision rules no longer exists,
  and nothing replaced it — so the only reliable check on a plural you invent is to register it and
  read your own schema, which is what Step 4 has you do
- [Using permalinks](https://wordpress.org/documentation/article/customize-permalinks/) —
  the structure tags. The performance note about verbose page rules that motivates `/blog` is no
  longer on any current official page; Key Concept 6 above is where this course argues it
- [WP-CLI `rewrite list`](https://developer.wordpress.org/cli/commands/rewrite/list/) — the
  fastest way to answer "did my flush actually happen" without clicking Settings → Permalinks
