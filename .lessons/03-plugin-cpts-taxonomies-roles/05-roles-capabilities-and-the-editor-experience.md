---
title: 'Roles, Capabilities & the Editor Experience'
module: 3
lesson: 5
teaches: [roles-and-capabilities, map-meta-cap, structural-authorization, admin-redirect-for-role, users-can-register-off]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/roles.php']
requires: [3.2, 3.4]
---

# Lesson 03.5 — Roles, Capabilities & the Editor Experience

## Quick Overview

`incident_reporter` is the role public submitters get, and the most important thing about it is a
capability it does **not** have. Per
[appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities) the role
holds `read`, `create_incidents` and `edit_incidents` for its own pending posts, and it does not
hold `publish_incidents`, `edit_others_incidents` or `delete_incidents`. Because `incident` was
registered in Lesson 03.2 with `capability_type => 'incident'` and `map_meta_cap => true`,
WordPress generates that whole capability family for you and routes every
`current_user_can('edit_post', $id)` check through `map_meta_cap`, which resolves the meta
capability against the post's author and status. You are not writing an authorisation system;
you are configuring the one WordPress already has.

That distinction is the lesson. Withholding a capability makes moderation **structural**: there
is no code path by which a reporter publishes an incident, because the capability does not exist
for them, in wp-admin, in REST, in WP-CLI, and in the Module 06 mutation. Compare that with an
`if ($status === 'publish') { deny(); }` somewhere in a mutation resolver — enforced only where
you remembered to write it, and silently absent from every path you did not think of. The rest of
the lesson is the editor experience: `incident_reporter` gets no `edit_posts`, so it cannot reach
the block editor or upload media; `show_admin_bar_front` is false; and an `admin_init` guard
redirects it away from wp-admin entirely, because public users have a front end, not a dashboard.
`users_can_register` stays off — registration goes through one door, the `registerDeveloper`
mutation in Module 06.

By the end of this lesson you will have:

- `includes/roles.php` creating `incident_reporter` with exactly the capabilities in §6 and no
  others
- Capabilities added and removed on activation and deactivation, idempotently and without
  orphaning the role
- An `admin_init` redirect and `show_admin_bar_front => false` for the role
- `users_can_register` explicitly off, with a comment pointing at Module 06
- A test user in the role, with a password taken from the environment, that provably cannot
  publish — verified via `wp cap list` and a WP-CLI publish attempt that fails
- The capability matrix from §6 reproduced by `wp cap list incident_reporter`, not by hand

## Classic WP Analogy

You know the shape of this: five core roles, `add_role()`, `$role->add_cap()`, and the Members
or User Role Editor plugin you have probably used to tick boxes on a client site. Contributor is
the mental model — it can write posts and not publish them — and `incident_reporter` is
essentially Contributor, restricted to one post type, with `edit_posts` deliberately withheld so
it cannot see the blog. Capabilities are still stored in the `wp_user_roles` option and still
resolved by `current_user_can()`, exactly as they always were.

`map_meta_cap` is the piece most Classic WordPress developers have seen the effects of without
ever reading. It is what makes `current_user_can('edit_post', 42)` mean "may this user edit
*that specific* post", by translating the meta capability into a primitive one based on whether
the user is the author and whether the post is published. When you set
`capability_type => 'incident'` and `map_meta_cap => true`, you get `edit_incident`,
`publish_incidents`, `edit_others_incidents` and the rest generated and mapped, with the
author-and-status logic already correct. Writing that logic yourself is both unnecessary and a
reliable source of bugs.

**Where the analogy breaks down:** in Classic WordPress, a role's capabilities and the wp-admin
UI reinforce each other so completely that you rarely have to distinguish them. Hide the Publish
button and remove the capability and you cannot tell which one stopped the user. Here the UI is
gone — a reporter never sees wp-admin at all — so the capability is the *only* thing standing
between a public HTTP request and a published post. And unlike Classic WordPress, the request
does not arrive through a form you rendered: it arrives as JSON at a GraphQL endpoint from an
application you also wrote and must nonetheless not trust. The capability check is not a
convenience layer over a UI any more; it is the security boundary itself.

---

## Key Concepts

### 1. Roles live in the database, not in your code

This trips up everyone once. `add_role()` does not declare a role the way `register_post_type()`
declares a post type. It performs a **one-time write** to the `wp_user_roles` row in
`wp_options`, and then does nothing forever after.

```
register_post_type()                  add_role()
─────────────────────────────────     ─────────────────────────────────
runs on EVERY request, on `init`      writes the DB ONCE, returns null
                                      if the role already exists
change the code → change takes        change the code → NOTHING HAPPENS
effect on the next request            until you re-run it deliberately
```

The consequence: **editing the capability array in your source file changes nothing on a site
where the role already exists.** You add `delete_incidents` to the list, reload, and the role
still does not have it. Then you deactivate and reactivate, and it still does not have it,
because `add_role()` saw the role already there and returned `null` without touching it.

The fix is a version number, and §5 builds it. For now, hold the mental model: post types are
declarative and re-run constantly; roles are a migration you apply.

### 2. Primitive capabilities versus meta capabilities

Lesson 03.2 registered `incident` with `capability_type => 'incident'` and
`map_meta_cap => true`. That generated two different kinds of capability, and the difference
governs everything in this lesson.

| | Primitive | Meta |
|---|---|---|
| Example | `publish_incidents`, `edit_others_incidents` | `edit_incident`, `read_incident`, `delete_incident` |
| Granted to a role? | **yes** — this is what you put in the array | **never** — granting one is a bug |
| Checked as | `current_user_can('publish_incidents')` | `current_user_can('edit_incident', 42)` |
| Answers | "may this user, in general?" | "may this user, for *that specific post*?" |
| Resolved by | a lookup in the role | `map_meta_cap()`, which translates it into primitives |

`map_meta_cap()` is the function you have benefited from for years without reading. When
something asks `current_user_can('edit_incident', 42)`, WordPress looks at post 42 — who wrote
it, whether it is published, whether it is private — and returns the list of **primitive**
capabilities the user would need. Roughly:

```
current_user_can( 'edit_incident', 42 )
        │
        ▼
   map_meta_cap()  ── is the user the author of 42?
        │                 │
        │                 ├── yes, and 42 is a draft   → requires  edit_incidents
        │                 ├── yes, and 42 is published → requires  edit_published_incidents
        │                 └── no                       → requires  edit_others_incidents
        ▼
   does the ROLE hold that primitive capability?
```

This is why you never write the author-and-status logic yourself. It already exists, it is
already correct, and it is already applied by wp-admin, the REST API, WP-CLI and — once
Module 06 calls `current_user_can()` in a resolver — your GraphQL mutations.

The full generated family for `incident`:

| Capability | Kind | `incident_reporter` holds it? |
|---|---|---|
| `create_incidents` | primitive | ✅ |
| `edit_incidents` | primitive | ✅ (own, unpublished) |
| `edit_incident` | meta | resolves to the above |
| `read_incident` | meta | resolves to `read` |
| `delete_incident` | meta | resolves to `delete_incidents` |
| `publish_incidents` | primitive | ❌ **the whole point** |
| `edit_others_incidents` | primitive | ❌ |
| `edit_published_incidents` | primitive | ❌ |
| `edit_private_incidents` | primitive | ❌ |
| `read_private_incidents` | primitive | ❌ |
| `delete_incidents` | primitive | ❌ |
| `delete_others_incidents` | primitive | ❌ |
| `delete_published_incidents` | primitive | ❌ |
| `delete_private_incidents` | primitive | ❌ |

> **`edit_published_incidents` is withheld deliberately, and it is subtle.** A reporter may edit
> their own incident while it is `pending`. The moment a moderator publishes it, `map_meta_cap`
> starts requiring `edit_published_incidents` for that same post — which the reporter does not
> have. So editing rights expire on publication, automatically, with no code of yours involved.
> That is the behaviour you want, and you get it by omitting one string from an array.

### 3. Structural authorization versus procedural authorization

This is the concept the module has been building toward.

```
PROCEDURAL — enforced where you remembered to write it
────────────────────────────────────────────────────────────────
  GraphQL mutation      if ( $status === 'publish' ) deny();     ✅ covered
  REST endpoint         (nobody added the check)                 ❌ OPEN
  wp-admin              (role can reach it)                      ❌ OPEN
  WP-CLI                (no check at all)                        ❌ OPEN
  a future endpoint     (written next quarter by someone else)   ❌ OPEN

STRUCTURAL — enforced by WordPress, everywhere, by omission
────────────────────────────────────────────────────────────────
  role simply does not hold `publish_incidents`
  ⇒ wp_insert_post() downgrades the status by itself
  ⇒ REST, WP-CLI, GraphQL, wp-admin and code not yet written
     all deny, because they all funnel through the same check
```

The practical demonstration is worth internalising: if a reporter's request asks for
`post_status => 'publish'` and the role lacks `publish_incidents`, **`wp_insert_post()` itself
silently rewrites the status to `pending`.** You do not have to catch it. Module 06's
`createIncident` mutation forces `pending` anyway — belt and braces — but even a mutation that
forgot to would still not publish.

> **The rule this course applies everywhere:** if a permission can be expressed as the absence
> of a capability, express it that way. A capability check you have to remember to write is a
> capability check someone will eventually forget. This is the same argument that puts
> `severity` in a taxonomy in Lesson 03.3 — make the data model enforce the rule rather than
> asking every future code path to.

### 4. Withholding `edit_posts` is what removes the dashboard

`incident_reporter` gets **no** `edit_posts`. That single omission cascades:

| Consequence | Why |
|---|---|
| No block editor | `edit.php` and `post-new.php` require `edit_posts` for `post` |
| No media upload | `upload_files` is not granted, and the media modal needs it |
| No Posts/Pages menus | every core menu is registered against a capability |
| Nothing to see in wp-admin | which is what makes §6's redirect honest rather than cosmetic |

The reporter is not a content author in the WordPress sense. They submit a structured record
through a form on the Next.js front end, and an editor moderates it. They have a front end, not
a dashboard.

> **`read` is still granted, and it is not optional.** Without `read`, `is_user_logged_in()`
> works but the user cannot load `/wp-admin/admin-ajax.php`, cannot be resolved by `viewer` in
> WPGraphQL, and hits odd edge cases in core. `read` is the "you are a real user" capability.
> Grant it and remove access a different way.

### 5. Keeping the role in sync: a version number, not a prayer

Because §1 makes role changes a migration, you need to know when to re-apply. The pattern is an
option holding a version you bump by hand whenever the capability list changes:

```
activate()  ──▶  get_option('btt_roles_version')
                       │
                       ├── equals ROLES_VERSION  → return, do nothing
                       │
                       └── differs or absent
                                │
                                ├── remove_role('incident_reporter')   ← discard old caps
                                ├── add_role(... current caps ...)     ← re-create clean
                                └── update_option('btt_roles_version', ROLES_VERSION)
```

Remove-then-add rather than patching individual capabilities, because patching only ever adds:
if you *delete* a capability from the array, a patch-based sync leaves the old one in place
forever. Re-creating guarantees the role on disk matches the role in the file.

This is safe because **a role is not a user**. `remove_role()` deletes the definition; users
assigned to it keep the role *name* in their `wp_capabilities` meta and pick up the new
definition the moment it is re-added. Nobody is logged out, nobody is orphaned.

### 6. Deactivation, and the difference between "off" and "uninstalled"

Three different lifecycle events, three different correct behaviours:

| Event | What to do with `incident_reporter` | Why |
|---|---|---|
| **Deactivate** | **leave it** | Users still hold it. Removing it would silently strip every reporter of their role, and reactivating would not put them back. |
| **Deactivate** | remove the `incident_*` caps from `administrator` and `editor` | These are ours to clean up; they refer to a post type that no longer exists. |
| **Uninstall** (`uninstall.php`) | reassign users to `subscriber`, *then* `remove_role()` | The only point at which destroying data is what the user asked for. |

> **Never `remove_role()` on deactivation.** Deactivating a plugin is something an administrator
> does to debug for ninety seconds. It must not be destructive. This is the single most common
> way plugins lose customer data, and the fix is the paragraph above.

### 7. One registration door

`users_can_register` stays **off**, set explicitly on activation rather than left to whatever the
site happens to have.

With it on, WordPress serves `/wp-login.php?action=register`, which creates users with
`get_option('default_role')` and applies none of your rules — no email verification, no
Turnstile, no rate limit, no guarantee the role is `incident_reporter`. That is a second
registration door into the same building, and you would have to secure it separately and
remember it exists.

Module 06 builds the only door: a `registerDeveloper` mutation that assigns the role explicitly
and is called server-to-server with the application token. Module 15 adds verification and rate
limiting to it. One door, one set of rules.

---

## Task

### Step 1: Write the role definition

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/roles.php
/**
 * The `incident_reporter` role, and the capability lifecycle around it.
 *
 * The authoritative capability list is appendix 03 §6. If you change the array
 * below, bump ROLES_VERSION or the change will not reach an existing site.
 */

declare(strict_types=1);

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

/**
 * Bump this whenever REPORTER_CAPS changes. It is what makes the role a
 * migration rather than a one-time write — see Lesson 03.5 §1.
 */
const ROLES_VERSION = '1';

const REPORTER_ROLE = 'incident_reporter';

/**
 * Exactly the capabilities from appendix 03 §6, and no others.
 *
 * What is ABSENT matters more than what is present:
 *   - no `publish_incidents`        → cannot publish, on any code path
 *   - no `edit_published_incidents` → editing rights expire on publication
 *   - no `edit_others_incidents`    → cannot touch another reporter's incident
 *   - no `edit_posts`               → no block editor, no media library
 *   - no `upload_files`             → no media upload
 */
const REPORTER_CAPS = array(
	'read'             => true,
	'create_incidents' => true,
	'edit_incidents'   => true,
);

/**
 * Create or refresh `incident_reporter`.
 *
 * Remove-then-add rather than patching, so that REMOVING a capability from
 * REPORTER_CAPS actually removes it from an existing site. Safe because a role
 * definition is not a user: assigned users keep the role name in their
 * wp_capabilities meta and pick up the new definition immediately.
 */
function ensure_reporter_role(): void {
	if ( get_option( 'btt_roles_version' ) === ROLES_VERSION && get_role( REPORTER_ROLE ) ) {
		return;
	}

	remove_role( REPORTER_ROLE );

	add_role(
		REPORTER_ROLE,
		__( 'Incident Reporter', 'blame-the-tech-core' ),
		REPORTER_CAPS
	);

	update_option( 'btt_roles_version', ROLES_VERSION, false );
}

/**
 * Remove OUR capabilities from core roles on deactivation.
 *
 * Deliberately does NOT remove `incident_reporter` itself — users still hold
 * it, and deactivation must never be destructive. See Lesson 03.5 §6;
 * uninstall.php is where the role goes.
 */
function revoke_incident_caps_from_core_roles(): void {
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
			if ( $role->has_cap( $cap ) ) {
				$role->remove_cap( $cap );
			}
		}
	}
}

/**
 * Registration happens through the `registerDeveloper` mutation (Module 06),
 * never through /wp-login.php?action=register. One door, one set of rules.
 */
function close_wp_registration(): void {
	if ( (string) get_option( 'users_can_register' ) !== '0' ) {
		update_option( 'users_can_register', 0 );
	}
}
```

**Verify §1:**

- [ ] The file declares `namespace Blame\Core;` and matches the procedural-file convention from
      Lesson 03.1 §3 — no class, because there is nothing here worth wrapping in one.
- [ ] `REPORTER_CAPS` contains exactly three keys. If you typed `publish_incidents`, delete it.

### Step 2: Keep reporters out of wp-admin

Append to the same file:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/roles.php

/**
 * Send reporters back to the front end if they reach wp-admin.
 *
 * `admin_init` runs for admin-ajax.php too, so the DOING_AJAX guard is not
 * optional — without it, any front-end AJAX from a logged-in reporter would
 * be answered with a 302 to the home page.
 */
function redirect_reporters_away_from_admin(): void {
	if ( wp_doing_ajax() || ! is_user_logged_in() ) {
		return;
	}

	// Capability, not role name: an administrator who has been given the
	// reporter role for testing should still reach the dashboard.
	if ( current_user_can( 'edit_posts' ) ) {
		return;
	}

	wp_safe_redirect( home_url( '/' ) );
	exit;
}
add_action( 'admin_init', __NAMESPACE__ . '\\redirect_reporters_away_from_admin' );

/**
 * Hide the admin bar for anyone who cannot use the dashboard.
 *
 * The `show_admin_bar_front` USER META that wp-admin exposes is per-user and
 * set at registration; this filter is role-wide and cannot be un-set by the
 * user, which is what we want.
 */
add_filter(
	'show_admin_bar',
	static function ( bool $show ): bool {
		return current_user_can( 'edit_posts' ) ? $show : false;
	}
);
```

> **The `wp_doing_ajax()` guard is the bug you would otherwise ship.** `admin_init` fires on
> `admin-ajax.php`, which is a front-end endpoint despite its name. Without the guard, every
> AJAX call made by a logged-in reporter returns a redirect instead of data, and the failure
> looks like a broken front end rather than a broken permission check.

**Verify §2:**

- [ ] The redirect tests `current_user_can('edit_posts')`, not `in_array('incident_reporter', ...)`.
- [ ] `wp_safe_redirect()` — not `wp_redirect()` — so an attacker cannot use it as an open redirect.

### Step 3: Wire it into the plugin lifecycle

Three edits to `includes/Plugin.php`, matching the pattern from Lesson 03.2 §Step 3.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	private const INCLUDES = array(
		'includes/post-types.php',              // Lesson 03.2
		'includes/taxonomies.php',              // Lesson 03.3
		'includes/statuses.php',                // Lesson 03.4
		'includes/admin/incident-columns.php',  // Lesson 03.4
		'includes/roles.php',                   // Lesson 03.5
	);
```

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	public static function activate(): void {
		register_post_types();
		register_taxonomies();
		seed_default_terms();

		grant_incident_caps_to_core_roles();

		// New in 03.5. Idempotent, and gated on ROLES_VERSION.
		ensure_reporter_role();
		close_wp_registration();

		ensure_permalink_structure();

		flush_rewrite_rules();

		update_option( 'btt_core_version', VERSION, false );
	}
```

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	public static function deactivate(): void {
		// Our capabilities on core roles are ours to clean up.
		revoke_incident_caps_from_core_roles();

		// `incident_reporter` is deliberately LEFT IN PLACE — users hold it.
		// It is removed in uninstall.php, after reassigning those users.

		flush_rewrite_rules();
	}
```

### Step 4: Re-activate and create a test reporter

```bash
cd wordpress-headless

docker compose run --rm wpcli wp plugin deactivate blame-the-tech-core
docker compose run --rm wpcli wp plugin activate blame-the-tech-core
```

The password comes from your shell session, never from a file:

```bash
export BTT_REPORTER_PASSWORD="$(openssl rand -base64 24)"

docker compose run --rm wpcli wp user create reporter reporter@example.test \
  --role=incident_reporter \
  --user_pass="$BTT_REPORTER_PASSWORD" \
  --display_name="A Reporter"

echo "Save in your password manager: $BTT_REPORTER_PASSWORD"
```

**Verify §4:**

- [ ] `wp user list --field=user_login` includes `reporter`.
- [ ] The `export` is not in `.zshrc`, `.bashrc`, `.env` or any other file. It lives in this
      shell session and nowhere else — see [appendix 04 §1](../appendix/04-env-reference.md#1-the-five-rules).

### Step 5: Prove the negative

A capability you believe in but have not tested is a capability you do not have. Attempt to
publish as the reporter and watch WordPress downgrade it.

```bash
docker compose run --rm wpcli wp post create \
  --post_type=incident \
  --post_title="Attempted direct publish" \
  --post_status=publish \
  --user=reporter \
  --porcelain
```

Note the ID it prints, then ask what actually got stored:

```bash
docker compose run --rm wpcli wp post get <ID> --field=post_status
```

**Verify §5:**

- [ ] The status is `pending`, **not** `publish`. Nothing in your code caught this —
      `wp_insert_post()` downgraded it because the role lacks `publish_incidents`.
- [ ] Delete the test post: `docker compose run --rm wpcli wp post delete <ID> --force`

---

## Verification

```bash
cd wordpress-headless

# 1. The role exists with exactly the three capabilities from appendix 03 §6
docker compose run --rm wpcli wp cap list incident_reporter
# Expected: read, create_incidents, edit_incidents — and nothing else

# 2. The capability that defines the module is ABSENT
docker compose run --rm wpcli wp cap list incident_reporter | grep -c '^publish_incidents$'
# Expected: 0

# 3. ...and so are the other three that matter
docker compose run --rm wpcli wp cap list incident_reporter \
  | grep -cE '^(edit_others_incidents|edit_published_incidents|edit_posts)$'
# Expected: 0

# 4. Editors DO hold it, so moderation is possible at all
docker compose run --rm wpcli wp cap list editor | grep -c '^publish_incidents$'
# Expected: 1

# 5. THE NEGATIVE THAT MATTERS: a reporter cannot publish, even asking directly
ID=$(docker compose run --rm wpcli wp post create --post_type=incident \
  --post_title="Verification probe" --post_status=publish \
  --user=reporter --porcelain | tr -d '\r')
docker compose run --rm wpcli wp post get "$ID" --field=post_status
# Expected: pending
#           NOT publish. wp_insert_post() downgraded it with no code of ours involved.

# 6. Editing rights expire on publication (the map_meta_cap behaviour from §2)
docker compose run --rm wpcli wp eval \
  'wp_set_current_user(get_user_by("login","reporter")->ID);
   $id = (int) $argv[0];
   echo current_user_can("edit_post", $id) ? "can-edit" : "cannot-edit", PHP_EOL;
   wp_update_post(["ID"=>$id,"post_status"=>"publish"]);
   echo current_user_can("edit_post", $id) ? "can-edit" : "cannot-edit", PHP_EOL;' "$ID"
# Expected: two lines — "can-edit" then "cannot-edit"
#           Same user, same post. Publication moved the required capability.

docker compose run --rm wpcli wp post delete "$ID" --force

# 7. Registration has exactly one door
docker compose run --rm wpcli wp option get users_can_register
# Expected: 0

# 8. ...and wp-login's register action really is closed
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:8080/wp-login.php?action=register'
# Expected: 302  (redirected away — registration is disabled)

# 9. A reporter reaching wp-admin is bounced to the front end
docker compose run --rm wpcli wp eval \
  'echo has_action("admin_init", "Blame\\Core\\redirect_reporters_away_from_admin") ? "hooked" : "MISSING", PHP_EOL;'
# Expected: hooked

# 10. Deactivation is NOT destructive — the role survives
docker compose run --rm wpcli wp plugin deactivate blame-the-tech-core
docker compose run --rm wpcli wp role list --field=name | grep -c incident_reporter
# Expected: 1  (still there — users hold it; removal belongs in uninstall.php)

docker compose run --rm wpcli wp plugin activate blame-the-tech-core

# 11. Re-activation is idempotent — no duplicate caps, no version churn
docker compose run --rm wpcli wp option get btt_roles_version
docker compose run --rm wpcli wp cap list incident_reporter | wc -l
# Expected: 1  and  3
```

Check 5 and check 6 are the two that matter. If check 5 prints `publish`, the role holds
`publish_incidents` and every mutation you write in Module 06 is one forgotten line away from
publishing user content unreviewed.

## Control Questions

1. You add `delete_incidents` to `REPORTER_CAPS` and reload the site. Nothing changes. Explain
   why in terms of §1, and name the two things you must do to make it take effect.
2. `edit_incident` (singular) and `edit_incidents` (plural) differ by one letter and are
   completely different kinds of capability. Say which is which, which one you grant to a role,
   and what happens if you grant the other.
3. A reporter can edit their own incident while it is `pending` but not after a moderator
   publishes it — and you wrote no code for that. Walk through how `map_meta_cap` produces this,
   naming the primitive capability required in each case.
4. Deactivation removes the `incident_*` capabilities from `editor` but leaves the
   `incident_reporter` role in place. Justify the asymmetry, and describe what a user in that
   role experiences while the plugin is deactivated.
5. Module 06's `createIncident` mutation forces `post_status => 'pending'`. Given check 5 in the
   Verification block, that line is arguably redundant. Give the argument for keeping it anyway,
   and the one scenario where it is the only thing standing between you and a published post.

## Learn More

- [Roles and Capabilities](https://wordpress.org/documentation/article/roles-and-capabilities/) —
  the canonical list of core capabilities; skim it to see how few you actually need to grant
- [`map_meta_cap()`](https://developer.wordpress.org/reference/functions/map_meta_cap/) — read
  the source, not just the docs. The `edit_post` case is forty lines and explains §2 completely.
- [`register_post_type()` — `capability_type`](https://developer.wordpress.org/reference/functions/register_post_type/#capability_type) —
  the exact list of capabilities generated, and the `create_posts` footnote from Lesson 03.2
- [`add_role()`](https://developer.wordpress.org/reference/functions/add_role/) — note the
  return value: `null` when the role already exists, which is §1's whole problem in one line
- [Plugin uninstall methods](https://developer.wordpress.org/plugins/plugin-basics/uninstall-methods/) —
  where `remove_role()` belongs, and why `uninstall.php` runs with no plugin code loaded
- [`wp cap` and `wp role`](https://developer.wordpress.org/cli/commands/cap/) — the WP-CLI
  commands the Verification block uses, useful for auditing any client site you inherit
