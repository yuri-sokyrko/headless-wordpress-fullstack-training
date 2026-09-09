---
title: 'Security Hardening: WordPress'
module: 24
lesson: 1
teaches: [wp-hardening, disallow-file-mods, xmlrpc-off, rest-lockdown, graphql-introspection-off, query-depth-limits, persisted-queries, least-privilege-db-user]
produces: ['wordpress-headless/wp-content/mu-plugins/000-btt-hardening.php']
requires: [23.5, 06.4]
---

# Lesson 24.1 — Security Hardening: WordPress

## Quick Overview

Going headless changes your WordPress threat model in both directions at once. It removes
surface — no public theme rendering user input, no comment form, no search query hitting the
database from the open internet, no front-end plugin scripts. And it adds one large new opening
that no WordPress hardening guide written before 2019 mentions: **a GraphQL endpoint that will
happily describe your entire schema and execute arbitrarily nested queries against your
database.** This lesson closes the classic surface and then spends its second half on the new one.

The classic half is familiar work applied properly: lock `/wp-admin` and `/wp-login.php` at the
edge rather than with a plugin, disable XML-RPC, require authentication for REST routes that do
not need to be anonymous, set `DISALLOW_FILE_EDIT` and `DISALLOW_FILE_MODS` so wp-admin cannot
execute or install code, run as a least-privilege database user with no `GRANT`, `FILE` or
`SUPER` — and never as `root`, in any environment — and write down an update policy that says
who applies core and plugin updates and how fast. The GraphQL half is the new material:
introspection **off** in production with `graphql_debug` off alongside it, query depth and
complexity limits rejecting anything past depth 10, and then the strongest control available —
**persisted queries via WPGraphQL Smart Cache**, where the front end registers its operations by
hash at build time and production executes **only** hash-registered operations. An attacker with
your endpoint URL and a hand-written query gets nothing to execute.

And one honest caveat, per [appendix 04 §6](../appendix/04-env-reference.md#6-the-honest-caveat-about-hiding-the-wordpress-origin):
**keeping `WP_GRAPHQL_ENDPOINT` server-only is not security.** Media `sourceUrl` values are
public, so your WordPress host is discoverable regardless. The controls below are the ones doing
actual work.

By the end of this lesson you will have:

- `mu-plugins/000-btt-hardening.php` — environment-aware, branching on `WP_ENVIRONMENT_TYPE`, so
  local development is not crippled by production settings
- wp-admin and `wp-login.php` restricted at the edge, with a documented break-glass path for admins
- XML-RPC disabled, anonymous REST limited to what Gutenberg needs, user enumeration closed, and
  `DISALLOW_FILE_EDIT` / `DISALLOW_FILE_MODS` set in production — so plugins are installed by
  rebuilding the image, not from wp-admin
- A least-privilege MySQL user with the exact grants WordPress needs and nothing more
- GraphQL introspection off in production, depth and complexity limits set, and persisted queries
  enforced with a documented allowlist-registration step in the build
- A written update policy and a written statement of what hiding the origin does and does not buy

## Classic WP Analogy

Almost everything here is a hardening task you have done before, which makes the one genuinely
new item easier to spot.

| Classic WordPress hardening | Headless equivalent |
|---|---|
| Wordfence / iThemes login limiting | Edge rules at Cloudflare in front of Fly.io |
| `.htaccess` deny on `wp-login.php` | The same idea, one layer further out |
| `add_filter('xmlrpc_enabled', '__return_false')` | Identical, in the hardening mu-plugin |
| `define('DISALLOW_FILE_EDIT', true)` | Identical, from the environment |
| Hiding the WordPress version | Still worth doing, still not security |
| A security plugin's firewall | The edge, plus a WordPress that renders no front end |
| — | **GraphQL introspection, depth limits, persisted queries** |

The empty cell is the lesson. There is no Classic analogue for the GraphQL controls, because in a
Classic site the only query interface reachable by a stranger was a search box and an
`?author=1` enumeration. `POST /graphql` is a general-purpose, self-describing query interface —
run an introspection query and you receive every type, field, argument and mutation, formatted
for a code generator. That is exactly what makes WPGraphQL productive, and it is exactly why it
must be turned off in production.

Where the analogy breaks in a way worth stating plainly: **the classic instinct is to reduce
surface by hiding, and it does not work here.** Obscuring the login URL, removing the generator
tag, moving `wp-config.php` up a directory — these were cheap and marginally useful. The
equivalent instinct with GraphQL is "keep the endpoint secret", and it fails on contact with your
own media URLs. The controls that do work are all **allowlists**: a query allowlist (persisted
queries), a capability allowlist (the matrix in
[appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities)), and a
grant allowlist on the database user. Hiding is not a control. Enumerating what is permitted is.

---

## Key Concepts

### 1. The surface ledger: what went away, what stayed, what arrived

Hardening starts with an inventory. Write the ledger before the code: two thirds of a pre-2019
checklist is now work you do not have to do, and the third that remains is the third nobody wrote
a checklist for.

| Attack surface | Classic site | This site | Why |
|---|---|---|---|
| Theme rendering user input | large | **gone** | The theme renders nothing; Lesson 02.4's `template_redirect` sends every front-end URL to Next |
| Comment form | large | **gone** | `supports` in appendix 03 §1 excludes comments on every post type |
| Search query from the open internet | medium | **gone** | No search template. Next queries WPGraphQL with typed variables |
| Front-end plugin scripts | medium | **gone** | No `wp_head`, no `wp_enqueue_scripts` on a public page |
| `wp-login.php` brute force | large | unchanged | Editors still log in here |
| XML-RPC | medium | unchanged until you close it | The endpoint ships enabled |
| REST user enumeration | medium | unchanged until you close it | `/wp-json/wp/v2/users` is anonymous by default |
| wp-admin file editor | **critical** | unchanged until you close it | Arbitrary code execution behind one stolen session |
| **`POST /graphql`** | did not exist | **the main event** | A general-purpose, self-describing query interface |

The last row has no historical equivalent, and not because GraphQL is insecure. A Classic site's
query interface was a search box: one parameter, one shape, one query plan. `POST /graphql`
accepts an arbitrary document, and the client — not you — chooses how many nodes and how many
levels of nesting the server resolves. Those are the two dials an attacker turns.

### 2. Hiding is not a control. Enumerating what is permitted is.

The Classic reflexes were mostly obscurity: rename the login URL, remove the generator tag, hide
the version. Cheap, and they do raise the cost of an *untargeted* scan — a real if modest
benefit. They do nothing against anyone who has decided to attack you specifically.

Every control in this lesson that actually holds is an **allowlist**:

```
DENYLIST THINKING                        ALLOWLIST THINKING
─────────────────────────────────        ─────────────────────────────────
"block the bad queries"                  "only these 34 query hashes run"
"hide the GraphQL endpoint"              "the DB user has 8 grants, no more"
"block the bad REST routes"              "two anonymous REST routes exist"
"stop admins editing files"              "the image IS the plugin set"

  ↑ unbounded: you lose the moment          ↑ bounded: you win by default, and
    someone thinks of a case you did        a new case fails closed until
    not                                     someone deliberately adds it
```

The three allowlists this lesson installs are a **query allowlist** (persisted queries), a
**capability allowlist** (already built — the matrix in
[appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities)), and a
**grant allowlist** on the MySQL user. Each is finite, reviewable in a diff, and fails closed on
a case nobody anticipated.

**The cost of an allowlist is operational.** A changed query needs a registration step before the
front end that uses it goes live; a plugin that wants a new table needs a migration you approve.
Both costs are real, both are cheaper than the alternative, and if you are not willing to pay
either, say so out loud rather than shipping a control you will disable in a fortnight.

### 3. Why a `mu-plugin`, why `000-`, and why a top-level file

`000-btt-hardening.php` goes in `wp-content/mu-plugins/`, not in `blame-the-tech-core`. Three
reasons, in order of how much they matter:

| Property | mu-plugin | Regular plugin |
|---|---|---|
| Can be deactivated from wp-admin | **no** | yes, one click |
| Loads before regular plugins | **yes** | no |
| Appears in the plugin list | as "Must-Use", not toggleable | yes |
| Needs activation after a deploy | **no** | yes |

The first row is the whole argument: a control an administrator can switch off from a web UI is a
control an attacker holding an administrator session can switch off from a web UI. The second
matters because core registers some of what you filter early, and loading first means your filter
is in place before anything else reasons about it.

The `000-` prefix is load order — `wp_get_mu_plugins()` returns the glob sorted. And **mu-plugins
do not recurse**: that function globs `WPMU_PLUGIN_DIR . '/*.php'` and never descends, which is
why Lesson 12.4 needed `blame-seeder-loader.php` beside the `blame-seeder/` directory. A
top-level `.php` file is correct here; a `000-btt-hardening/` directory would load nothing and
report nothing.

### 4. Environment-awareness is the difference between a control and a nuisance

A hardening file that cripples local development gets deleted within a week, usually by you, at
11pm, while trying to reproduce something. So every branch in this file is keyed on
`wp_get_environment_type()`.

The mechanism already exists and you are not building it. `wp-config.php` defines
`WP_ENVIRONMENT_TYPE` from the environment (Lesson 02.4 Step 2:
`define( 'WP_ENVIRONMENT_TYPE', btt_env_opt( 'WP_ENVIRONMENT_TYPE', 'local' ) )`), and
`docker-compose.dev.yml` sets it to `local` through `WORDPRESS_CONFIG_EXTRA` (Lesson 02.2).
[Appendix 04 §2](../appendix/04-env-reference.md#2-wordpress--wordpress-headlessenv) is the
contract: `local` | `staging` | `production`.

| Control | `local` | `staging` | `production` |
|---|---|---|---|
| Introspection | on | **off** | **off** |
| `graphql_debug` | on | **off** | **off** |
| Query depth / complexity | on | on | on |
| Persisted queries **enforced** | off | **on** | **on** |
| XML-RPC | **off** | **off** | **off** |
| Anonymous REST allowlist | **on** | **on** | **on** |
| `DISALLOW_FILE_MODS` | off | **on** | **on** |
| wp-admin edge restriction | off | on | on |

Note the shape: **most rows are on everywhere.** Only four controls have a local exemption, and
each exists because the control makes a development task impossible rather than merely
inconvenient. "It is annoying locally" is not a reason to weaken a control; "codegen cannot read
the schema" is. And `staging` is deliberately identical to `production` in every security row — a
staging environment softer than production cannot tell you whether production will work.

### 5. What Lesson 06.4 already built, and what is left

**This is a verify-and-extend, not a new control**, and getting that wrong would repeat the most
common defect in this course. Read
[Lesson 06.4](../06-graphql-api-design/04-performance-n-plus-1-and-query-limits.md) before you
type anything, then read
`wp-content/plugins/blame-the-tech-core/includes/graphql/performance.php`.

| Control | State before this lesson | This lesson |
|---|---|---|
| `public_introspection_enabled` | **already** a `graphql_get_setting_section_field_value` filter keyed on `wp_get_environment_type()` | **verify only** |
| `debug_mode_enabled` (`graphql_debug`) | **already** the same filter, off outside `local` | **verify only** |
| `QueryDepth` | **already** `GRAPHQL_MAX_DEPTH = 10` | **verify only** |
| `QueryComplexity` | **already** `GRAPHQL_MAX_COMPLEXITY = 500` | **verify only** |
| `graphql_connection_max_query_amount` | **already** clamped to **50** — so a `first: 100` anywhere in the app is silently reduced | **verify only** |
| Persisted queries | **does not exist** | **build it** |
| XML-RPC, REST allowlist, user enumeration | do not exist | build them |
| Least-privilege DB user | `MYSQL_USER=btt` exists (Lesson 02.2) with image-default grants | tighten the grants |
| `DISALLOW_FILE_EDIT` / `DISALLOW_FILE_MODS` | **already** defined in `wp-config.php` from the environment (02.4) and present in `.env.example` (02.5), both `false` locally | **set them `true` for production** |

Two rows read like work and are not. Lesson 06.4 moved the introspection decision out of a
`wp_options` row into a filter precisely so it would travel with the environment rather than with
a database. And the two `DISALLOW_FILE_*` constants are wired end to end already — the only thing
missing is the production **value**. If you find yourself writing
`define( 'DISALLOW_FILE_MODS', true )` in the mu-plugin, stop: you are shadowing a constant
`wp-config.php` already defined.

### 6. Persisted queries: the strongest control, and its real footgun

A persisted query allowlist inverts the trust relationship. Today `/graphql` accepts a document
and executes it. Under persisted queries, production accepts a **hash** and executes the document
that hash was registered against. An attacker holding your endpoint URL and a hand-written query
has nothing to send.

```
DEVELOPMENT                          PRODUCTION (persisted queries enforced)
──────────────────────────────       ────────────────────────────────────────
POST /graphql                        POST /graphql
{ "query": "{ incidents { … } }" }   { "extensions": { "persistedQuery":
        │                                { "sha256Hash": "9f2c…" } } }
        ▼                                    ▼
  parse → validate → execute          look up 9f2c… in the allowlist
                                    ┌────────┴────────┐
                                  found            not found
                                    │                 │
                                execute          REFUSE — and there is no way
                                                 to supply the document instead
```

WPGraphQL Smart Cache provides the mechanism: it stores each registered operation as a
`graphql_document` post and, with query allowlisting on and public queries off, refuses anything
not registered. Registration is a build step — POST each shipped operation once, from a caller
holding the app token.

**The footgun, and it is the most valuable sentence in this Key Concept: the ordering of the two
deploys matters.** A query that changes needs to be registered *before* the front end that sends
its new hash goes live. Get the order wrong and the front end sends a hash production has never
seen, production refuses it, and every page that uses that query fails — with a GraphQL error
inside an HTTP 200, so your uptime monitor stays green.

| Deploy order | Result |
|---|---|
| register → deploy Next | correct; the old hash is still registered, so the old front end also works |
| deploy Next → register | **broken window** between the two, proportional to how long registration takes |
| register only, never deploy Next | harmless; an unused registered operation costs one post row |

So registration is **additive and idempotent**, and it runs in the WordPress deploy — the side
that owns the allowlist registers into it. Pruning stale operations is a separate, occasional,
deliberate job, never part of a deploy.

**The cost, stated plainly.** You lose ad-hoc queries against production, which is the point, and
which means a genuine production data question now needs a WP-CLI session or a new registered
operation. Development is unaffected: enforcement is off in `local`. If your team cannot live
with that, the fallback is depth plus complexity limits plus edge rate limiting — write down that
you chose the weaker control and why.

### 7. wp-admin belongs at the edge, and the break-glass path is part of the design

Restricting `/wp-admin` and `/wp-login.php` with a WordPress plugin means the request has already
reached PHP, bootstrapped WordPress and connected to MySQL before being refused. A login-limiter
plugin is a rate limiter that runs *after* the expensive part.

```
   internet
      │
      ▼
  ┌────────────────────────┐   /wp-admin, /wp-login.php  →  403 unless the rule
  │ Cloudflare (edge)      │      matches. WordPress is never woken.
  └───────┬────────────────┘   /graphql, /wp-json/*      →  pass, rate limited
          │                    everything else            →  pass
          ▼
  ┌────────────────────────┐
  │ Fly.io: Apache + PHP   │  Lesson 02.4's template_redirect still guards
  │ WordPress              │  the front end. Two layers, on purpose.
  └────────────────────────┘
```

Three candidate rules, and the trade each makes:

| Rule | Editor experience | Weakness |
|---|---|---|
| IP allowlist | breaks on any new network | a static office IP is rare; a VPN is another dependency |
| Cloudflare Access (identity) | SSO, works anywhere | a second identity system to run |
| Rate limit only | invisible | slows brute force; does not stop stuffing with a valid password |

This course recommends Cloudflare Access for `/wp-admin*` and `/wp-login.php` plus a rate limit
on `/graphql` — and writing the **break-glass path** down before you turn any of it on: how an
administrator gets in when the identity provider is down. Here that path is `fly ssh console`
plus WP-CLI, which does not traverse the edge at all, and it is safe to rely on because it
requires a Fly deploy token held by two people and rotated.

A break-glass path that is not written down is not a path. It is a two-hour outage while somebody
remembers whether WP-CLI can create a user.

### 8. Anonymous REST: the block editor is a REST client, so a blanket block breaks it

The instinct after "the front end does not use REST" is to turn REST off. Do not. Gutenberg **is**
a REST client — it saves posts, loads block types, resolves media and reads users through
`/wp-json/wp/v2/*`, which is why Lesson 02.4's routing table passes `/wp-json/*`. The correct
control is an allowlist keyed on **who is asking**, not on the route:

| Caller | Verdict |
|---|---|
| Logged-in editor in wp-admin (cookie + nonce) | allowed — this is Gutenberg |
| Anonymous request to `/btt/v1/preview/verify` (17.2) | **allowed** — it authenticates itself with `X-BTT-App-Token` and `hash_equals()` |
| Anonymous request to `/btt/v1/health` (24.6) | **allowed** — a monitor cannot hold a credential |
| Anonymous request to anything else, including `/wp/v2/users` | **401** |

That closes REST user enumeration as a side effect, and it beats filtering the `users` route
specifically: the next core release could add a route you did not think about, and the allowlist
refuses it by default.

Enumeration has a second door — `?author=1`, which core redirects to the author archive, leaking
a username in the `Location` header. Lesson 02.4's `template_redirect` already sends front-end
URLs to Next, but it fires *after* `query_vars` are parsed and the behaviour differs by permalink
structure, so the mu-plugin closes this explicitly rather than relying on a side effect.

### 9. The database user: eight grants, and what the three forbidden ones buy an attacker

`MYSQL_USER=btt` has existed since Lesson 02.2, which already made the least-privilege argument
for it. What it has not had is an *audited* grant list: the `mysql` image grants `ALL PRIVILEGES`
on the named database, which is more than WordPress needs.

WordPress needs exactly this, on one schema — `SELECT`, `INSERT`, `UPDATE`, `DELETE` for every
request; `CREATE`, `ALTER`, `INDEX` and `DROP` for `dbDelta()` on activation (the leads table,
16.3) and for `wp core update-db`. `CREATE TEMPORARY TABLES` is the one row you may drop and
test, because ACF, WPGraphQL and Polylang do not use it.

Here is what the three you must never grant would buy someone who found a SQL injection:

| Grant | What it becomes |
|---|---|
| `FILE` | `SELECT … INTO OUTFILE '/var/www/html/x.php'` — SQL injection becomes remote code execution |
| `SUPER` | read and change server variables, kill other sessions, disable binary logging so the incident is unlogged |
| `GRANT OPTION` | privilege escalation: the attacker grants themselves the other two |

`root` has all three, which is why `WORDPRESS_DB_USER` is never `root` in any environment —
[appendix 04 §2](../appendix/04-env-reference.md#2-wordpress--wordpress-headlessenv) states the
rule and this is the reasoning. Revoking `FILE` does not make injection harmless; it caps the
damage at "read and modify every row in your database", which is still bad.
`$wpdb->prepare()` is the control. This is the blast radius limit.

### 10. `DISALLOW_FILE_MODS` is the sentence that connects this lesson to Lesson 24.6

`DISALLOW_FILE_EDIT` removes the wp-admin theme and plugin file editor — a text box that writes
executable PHP into your document root, available to anyone holding an administrator session,
with no legitimate production use.

`DISALLOW_FILE_MODS` goes further: no plugin or theme installs, updates or deletions through
wp-admin at all. **Plugins are installed by rebuilding the image, not from wp-admin.** Which is
Lesson 24.6's entire premise — the image *is* the plugin set, so anything installed at runtime
vanishes on the next deploy whether you disallow it or not. The constant just makes the system
honest about it.

What must not be lost in the move is the **update policy**, because "we install plugins by
rebuilding" is a deployment mechanism and not a schedule. Write it down:

| Update class | Who | How fast | Mechanism |
|---|---|---|---|
| WordPress core security release | the on-call engineer | within 48 hours | bump the base image tag, PR, CI, deploy |
| Plugin security advisory (any severity) | the on-call engineer | within 48 hours | bump in `composer.json` or the Dockerfile, PR, CI, deploy |
| Core / plugin minor release | whoever is on maintenance | the next fortnightly window | one PR, `wp core update-db` runs in the release command |
| Major version of ACF, WPGraphQL or Polylang | a named owner, scheduled | a deliberate piece of work | schema regenerated, `codegen:check` is the gate |

Automatic background updates are **off**, which is a real trade and not obviously the right one.
On a Classic site they are a genuine win because the alternative is nothing. Here the alternative
is a pipeline that tests the change, so the win is smaller and the cost — a container mutating
itself and losing the mutation on the next deploy — is higher. If you cannot staff the 48-hour
commitment above, automatic core security updates on a mutable filesystem beat an unpatched
WordPress; say so in your own runbook rather than inherit this table.

---

## Task

### Step 1: Audit before you write — what is already hardened

Nothing in this step changes anything. It exists because the most expensive mistake available here
is rebuilding a control Lesson 06.4 already shipped, and then having two mechanisms disagree.

```bash
cd wordpress-headless

# What the environment thinks it is
docker compose run --rm wpcli wp eval 'echo wp_get_environment_type(), PHP_EOL;'

# The four GraphQL limits 06.4 set, read through the filter chain
docker compose run --rm wpcli wp eval '
  echo "introspection: ", get_graphql_setting( "public_introspection_enabled", "off" ), PHP_EOL;
  echo "debug:         ", get_graphql_setting( "debug_mode_enabled", "off" ) ?: "off", PHP_EOL;
  echo "max nodes:     ", (int) apply_filters( "graphql_connection_max_query_amount", 100, null, array(), null, null ), PHP_EOL;
  echo "depth const:   ", defined( "Blame\\Core\\GRAPHQL_MAX_DEPTH" ) ? Blame\Core\GRAPHQL_MAX_DEPTH : "MISSING", PHP_EOL;'

# The two constants wp-config.php already drives from the environment
docker compose run --rm wpcli wp eval '
  printf( "DISALLOW_FILE_EDIT=%s DISALLOW_FILE_MODS=%s\n",
    var_export( DISALLOW_FILE_EDIT, true ), var_export( DISALLOW_FILE_MODS, true ) );'
```

**Verify §1:**

- [ ] The environment type is `local`.
- [ ] `introspection: on`, `max nodes: 50`, `depth const: 10`. All three come from
      `includes/graphql/performance.php`, which you are **not** editing in this lesson.
- [ ] Note what `introspection: on` is really telling you. WPGraphQL's *own* default for
      `public_introspection_enabled` is `off`, and `DisableIntrospection` also waves a request
      through whenever `WPGraphQL::debug()` is true — which `WORDPRESS_DEBUG=1` in
      `docker-compose.dev.yml` makes true. So the unauthenticated `__type` and `__schema` curls
      back in Lessons 04.3, 14.1, 19.1 and 20.2 worked because of the **dev override**, not
      because introspection ships open. This lesson's job here is to confirm it is off in
      production and that nothing in the stack turns it back on — not to switch it off.
- [ ] Both `DISALLOW_FILE_*` print `false`, and both are **already defined** in
      `wp-config.php`. Do not define either in the mu-plugin: a second `define()` emits a
      notice that lands in `wp-content/debug.log`, where nobody will correlate it with the
      GraphQL response that got truncated.
- [ ] `grep -c 'graphql_get_setting_section_field_value' wp-content/plugins/blame-the-tech-core/includes/graphql/performance.php`
      is `1`. This lesson verifies that filter and adds a different key to it.

### Step 2: Write the hardening mu-plugin

One top-level file, every branch keyed on the environment, and the local branch deliberately
generous.

```php
<?php
// wordpress-headless/wp-content/mu-plugins/000-btt-hardening.php
/**
 * Plugin Name: BTT Hardening
 * Description: Environment-aware hardening. A must-use plugin on purpose: it cannot be
 *              deactivated from wp-admin, and it loads before every regular plugin.
 * Version:     1.0.0
 *
 * `000-` is load order. mu-plugins does NOT recurse — wp_get_mu_plugins() globs
 * WPMU_PLUGIN_DIR . '/*.php' at the top level only (Lesson 12.4 §3), so this MUST be a
 * top-level file. A 000-btt-hardening/ directory would load nothing and say nothing.
 *
 * WHAT THIS FILE DOES NOT DO, and why:
 *   - It does not define DISALLOW_FILE_EDIT or DISALLOW_FILE_MODS. wp-config.php already
 *     defines both from the environment (Lesson 02.4). Redefining is a notice, not a fix.
 *   - It does not set introspection, graphql_debug, query depth, query complexity or the
 *     connection node cap. Lesson 06.4's includes/graphql/performance.php owns all five,
 *     keyed on the same wp_get_environment_type(). Two owners is one too many.
 *
 * @package Blame\Hardening
 */

declare( strict_types=1 );

namespace Blame\Hardening;

defined( 'ABSPATH' ) || exit;

/**
 * The ONLY REST routes an anonymous caller may reach. Both authenticate themselves.
 *
 *   /btt/v1/preview/verify  Lesson 17.2 — X-BTT-App-Token, compared with hash_equals()
 *   /btt/v1/health          Lesson 24.6 — a monitor cannot hold a credential
 *
 * An allowlist rather than a denylist on /wp/v2/users: the next core release can add a
 * route nobody here thought about, and an allowlist refuses it by default.
 */
const ANON_REST_ALLOWLIST = array(
	'/btt/v1/preview/verify',
	'/btt/v1/health',
);

/** True everywhere except `local`. `staging` is identical to `production` here, on purpose. */
function hardened(): bool {
	return 'local' !== wp_get_environment_type();
}

/*
 * ─── 1. XML-RPC, off in every environment ──────────────────────────────────────────
 * No branch: nothing in this project has ever used XML-RPC, and the Jetpack/mobile-app
 * argument for keeping it does not apply to a headless install with no public front end.
 */
add_filter( 'xmlrpc_enabled', '__return_false' );
add_filter( 'pings_open', '__return_false' );

/** Empty the method table too, so /xmlrpc.php answers "unknown method" rather than 405-ing. */
add_filter( 'xmlrpc_methods', static fn(): array => array() );

/** Remove the X-Pingback advertisement from every response. */
add_filter(
	'wp_headers',
	static function ( array $headers ): array {
		unset( $headers['X-Pingback'] );

		return $headers;
	}
);

/*
 * ─── 2. Anonymous REST allowlist ───────────────────────────────────────────────────
 * rest_pre_dispatch rather than rest_authentication_errors: it receives the WP_REST_Request,
 * so the route comes from $request->get_route() instead of being reconstructed out of
 * $GLOBALS['wp']->query_vars. Returning a WP_Error short-circuits the dispatch.
 *
 * The block editor is a REST client and it is NOT affected: an editor in wp-admin is
 * logged in, so the first branch returns before the allowlist is consulted.
 */
function restrict_anonymous_rest( $result, $server, $request ) {
	if ( null !== $result || is_user_logged_in() ) {
		return $result;
	}

	$route = (string) $request->get_route();

	foreach ( ANON_REST_ALLOWLIST as $allowed ) {
		if ( $route === $allowed || str_starts_with( $route, $allowed . '/' ) ) {
			return $result;
		}
	}

	// 401, not 403: the caller has presented no credential, and the distinction is what
	// tells a monitor "log in" rather than "give up". No route name in the message.
	return new \WP_Error(
		'btt_rest_authentication_required',
		__( 'Authentication required.', 'blame-the-tech' ),
		array( 'status' => 401 )
	);
}
add_filter( 'rest_pre_dispatch', __NAMESPACE__ . '\\restrict_anonymous_rest', 10, 3 );

/*
 * ─── 3. User enumeration ───────────────────────────────────────────────────────────
 * ?author=1 is a public query var. Core's canonical redirect turns it into
 * /author/<user_nicename>/, which puts a real login name in a Location header that
 * anybody can read. Dropping the query var at parse_request (priority 1, before
 * redirect_canonical at 10) makes the request resolve as the home query, which
 * Lesson 02.4's template_redirect then sends to Next.
 *
 * COST: author archives stop working. This site has none — the theme renders no front
 * end at all — so the cost is zero here and would not be zero on a Classic site.
 * parse_request does not run for wp-admin requests, so the editor UI is untouched.
 */
add_action(
	'parse_request',
	static function ( \WP $wp ): void {
		unset( $wp->query_vars['author'], $wp->query_vars['author_name'] );
	},
	1
);

/** Belt: no author sitemap, so there is no second list of usernames. */
add_filter( 'wp_sitemaps_add_provider', static fn( $provider, string $name ) => 'users' === $name ? false : $provider, 10, 2 );

/*
 * ─── 4. Version disclosure ─────────────────────────────────────────────────────────
 * Not security. Worth doing anyway: it removes this install from the results of a scan
 * that greps for "WordPress 7.1" and moves on. Say so rather than counting it as a
 * control (Key Concept 2).
 */
add_filter( 'the_generator', static fn(): string => '' );
remove_action( 'wp_head', 'wp_generator' );

/*
 * ─── 5. GraphQL: persisted-query allowlisting ──────────────────────────────────────
 * The setting section belongs to WPGraphQL Smart Cache. At 2.0.1 the field names in
 * `graphql_persisted_queries_section` are `grant_mode` and `editor_display`; Task Step 5
 * prints them off your own install. Filtering the setting rather than writing a
 * wp_options row is the pattern Lesson 06.4 established: a policy in the database is a
 * policy someone changes by clicking.
 */
const SMART_CACHE_ALLOWLIST_FIELDS = array(
	// name => value, in a hardened environment. `grant_mode` is ONE radio, not a pair
	// of booleans: 'public' | 'only_allowed' | 'some_denied', defaulting to 'public'.
	'grant_mode'     => 'only_allowed',
	'editor_display' => 'off',
);

function filter_smart_cache_settings( $value, $default_val, string $option_name ) {
	if ( ! hardened() ) {
		return $value;
	}

	return SMART_CACHE_ALLOWLIST_FIELDS[ $option_name ] ?? $value;
}
add_filter( 'graphql_get_setting_section_field_value', __NAMESPACE__ . '\\filter_smart_cache_settings', 11, 3 );

/*
 * ─── 6. GraphQL: refuse a raw document, when and only when we mean it ──────────────
 * The braces to §5's belt, and the half of this that does not depend on a field name.
 *
 * OFF BY DEFAULT, and that is not timidity. Enforcing "hash only" refuses every request
 * carrying a `query` string, and Next does not send hashes until codegen is configured to
 * emit them (`persistedDocuments` in codegen.ts — NOT this lesson's work; see §6 and the
 * report at the end of the Task). Flipping this on before the client sends hashes takes
 * the whole site down, with a GraphQL error inside an HTTP 200, so your uptime check
 * stays green. Read Key Concept 6's deploy-ordering table before you set it.
 *
 * Two escapes, both deliberate:
 *   - manage_options: an operator in GraphiQL is not the threat model (same carve-out
 *     as 06.4's depth rule).
 *   - the app token: the registration POST in Step 6 necessarily carries the document,
 *     and app_token_matches() is Lesson 06.2's hash_equals() comparison.
 */
function enforcing_persisted_queries(): bool {
	return hardened() && filter_var( getenv( 'BTT_PERSISTED_QUERIES_ENFORCED' ) ?: 'false', FILTER_VALIDATE_BOOLEAN );
}

function require_persisted_query( array $data ): array {
	if ( ! enforcing_persisted_queries() ) {
		return $data;
	}

	if ( current_user_can( 'manage_options' ) ) {
		return $data;
	}

	if ( function_exists( 'Blame\\Core\\app_token_matches' ) && \Blame\Core\app_token_matches() ) {
		return $data;
	}

	$has_hash = ! empty( $data['extensions']['persistedQuery']['sha256Hash'] )
		|| ! empty( $data['queryId'] );

	if ( '' !== trim( (string) ( $data['query'] ?? '' ) ) && ! $has_hash ) {
		// A UserError is rendered by WPGraphQL into the `errors` array with HTTP 200 —
		// the house rule (appendix 05). Never a 4xx: clients here read `.errors`.
		throw new \GraphQL\Error\UserError(
			esc_html__( 'This endpoint executes registered operations only.', 'blame-the-tech' )
		);
	}

	return $data;
}
add_filter( 'graphql_request_data', __NAMESPACE__ . '\\require_persisted_query', 10, 1 );
```

**Verify §2:**

- [ ] `docker compose logs --tail=40 wordpress` shows no fatal and no `Failed opening required`.
- [ ] `docker compose run --rm wpcli wp plugin list --status=must-use` lists **BTT Hardening**.
      If it does not, the file is in a subdirectory — mu-plugins does not recurse.
- [ ] `docker compose run --rm wpcli wp eval 'echo function_exists("Blame\\Hardening\\hardened") ? "loaded" : "NOT LOADED", PHP_EOL;'`
      prints `loaded`.
- [ ] `grep -c "define( 'DISALLOW" wp-content/mu-plugins/000-btt-hardening.php` is `0`.
- [ ] `grep -c 'graphql_connection_max_query_amount\|QueryDepth\|public_introspection_enabled' wp-content/mu-plugins/000-btt-hardening.php`
      is `0`. All three belong to Lesson 06.4, and two owners for one setting means the loser
      is whichever loads second.
- [ ] wp-admin still loads and the block editor still saves a post — the check that the REST
      allowlist did not break Gutenberg.

### Step 3: Tighten the database user's grants

The `mysql` image grants `ALL PRIVILEGES` on the named database, which includes `CREATE ROUTINE`,
`EXECUTE`, `LOCK TABLES`, `REFERENCES` and `TRIGGER` — none of which WordPress uses. Read what
you have first:

```bash
docker compose exec -T db sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" -e "SHOW GRANTS FOR \"btt\"@\"%\";"'
```

Then narrow it to the list from Key Concept 9. `MYSQL_ROOT_PASSWORD` comes from the container's
own environment, never a command line — a command line lands in your shell history and in the
host's process list:

```bash
# Reasoned, not executed against a production host: run this locally first and
# confirm the site still works before you run it anywhere that matters.
docker compose exec -T db sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" <<SQL
REVOKE ALL PRIVILEGES ON \`btt\`.* FROM "btt"@"%";
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP
  ON \`btt\`.* TO "btt"@"%";
FLUSH PRIVILEGES;
SQL'
```

**Verify §3:**

- [ ] `SHOW GRANTS` lists exactly those eight on `` `btt`.* `` plus `USAGE ON *.*`, which is
      MySQL's way of writing "no privileges at all, globally".
- [ ] `GRANT OPTION`, `FILE` and `SUPER` appear nowhere. Verification check 9 asserts it.
- [ ] `wp option get siteurl` still answers, and `wp blame seed --fresh --yes` still completes
      — `dbDelta()` on the leads table is what exercises `CREATE`, `ALTER` and `DROP`. The
      eight are a floor, not a suggestion.

> **`CREATE TEMPORARY TABLES` is the row worth experimenting with**, and it is absent above. ACF,
> WPGraphQL and Polylang do not need it; some analytics and migration plugins do, and they fail
> with a MySQL error rather than a WordPress one. If a new plugin says `command denied to user`,
> check this first — adding the grant back is a one-line, reviewable decision.

### Step 4: Set the production and staging values

Almost no new variables: the names exist in
[appendix 04 §2](../appendix/04-env-reference.md#2-wordpress--wordpress-headlessenv) and in
`.env.example` since Lesson 02.5, with `false` local values. What changes is the value each
environment gets, and in production those arrive as Fly `[env]` entries (Lesson 24.6), never
from a committed file.

| Variable | `local` | `staging` | `production` |
|---|---|---|---|
| `WP_ENVIRONMENT_TYPE` | `local` | `staging` | `production` |
| `WORDPRESS_DEBUG` | `1` | `0` | `0` |
| `DISALLOW_FILE_EDIT` | `false` | `true` | `true` |
| `DISALLOW_FILE_MODS` | `false` | `true` | `true` |
| `BTT_PERSISTED_QUERIES_ENFORCED` | `false` | `false` **until the client sends hashes** | `false` until then |

`BTT_PERSISTED_QUERIES_ENFORCED` is the one new name, and it is not a secret. Add it to
`.env.example` beside the two `DISALLOW_*` lines:

```dotenv
# wordpress-headless/.env.example — append beside DISALLOW_FILE_MODS
# Refuse any GraphQL request carrying a raw document instead of a registered hash.
# FALSE until codegen emits persisted documents on the Next side. Lesson 24.1 §6.
BTT_PERSISTED_QUERIES_ENFORCED=false
```

**Verify §4:**

- [ ] `grep -c 'BTT_PERSISTED_QUERIES_ENFORCED' .env.example` is `1`, and the value is
      `false`. A `true` here is a committed instruction to break production.
- [ ] `git check-ignore -v .env` still names a rule. You did not put a value in the tracked file.
- [ ] `docker compose run --rm wpcli wp eval 'echo var_export( Blame\Hardening\enforcing_persisted_queries(), true ), PHP_EOL;'`
      prints `false`.

### Step 5: Install WPGraphQL Smart Cache and read its real field names

```bash
# NOT `wp plugin install wp-graphql-smart-cache` — this plugin is not in the
# wordpress.org directory, so a bare slug fails with `Plugin not found`. Install the
# release asset, which is also the version pin. Note the asset drops the leading `wp-`.
docker compose run --rm wpcli wp plugin install \
  'https://github.com/wp-graphql/wp-graphql-smart-cache/releases/download/v2.0.1/wpgraphql-smart-cache.zip' \
  --activate

# The names your version uses. The mu-plugin's SMART_CACHE_ALLOWLIST_FIELDS must match
# THESE — a filter keyed on a name that does not exist silently changes nothing, which is
# the whole failure mode this step exists to rule out.
docker compose run --rm wpcli wp option get graphql_persisted_queries_section --format=json
```

**Verify §5:**

- [ ] The JSON prints a set of field names — at 2.0.1 they are `grant_mode`, `editor_display`,
      `query_garbage_collect` and `query_garbage_collect_age`. Compare them to
      `SMART_CACHE_ALLOWLIST_FIELDS` in your mu-plugin and **edit the constant to match**. If the
      option does not exist yet, open **GraphQL → Settings → Saved Queries** in wp-admin once and
      save; the row appears then.
- [ ] `docker compose run --rm wpcli wp eval 'echo get_graphql_setting( "grant_mode", "unset", "graphql_persisted_queries_section" ), PHP_EOL;'`
      prints `public` — or `unset` before that option row exists. Either way it is **not**
      `only_allowed`, because `hardened()` is false locally and your filter returns `$value`
      untouched. **That is the branch working**, and it is the positive that proves this file can
      be developed against.
- [ ] There is no separate "enable persisted queries" toggle to find, and its absence is not a
      missing step: the `graphql_document` post type and the `sha256Hash` lookup are live the
      moment the plugin activates. `grant_mode` is the only thing standing between a hash-only
      endpoint and an open one.
- [ ] `docker compose run --rm wpcli wp plugin list --status=active | grep -c smart-cache` is `1`.
      The installed directory is `wpgraphql-smart-cache`, which still matches that grep.

> **Installing a plugin with `wp plugin install` works locally and will not work in
> production**, because Step 4 set `DISALLOW_FILE_MODS`. That is not a bug in this step; it is
> Key Concept 10. In production this plugin arrives because Lesson 24.6's Dockerfile puts it in
> the image. Verification check 10 proves the refusal.

### Step 6: Register the operation allowlist, as a deploy step

One POST per operation, from a caller holding the app token, **additive and idempotent** —
re-registering an existing operation is a no-op, which is what makes it safe on every deploy.

```bash
# From next-app/. One POST per committed .graphql document. The app token comes from the
# INVOKING SHELL — never from a file, never on the command line of a longer pipeline.
export WP_APP_TOKEN="$(read -rs -p 'app token: ' t && echo "$t")"

for doc in src/graphql/*.graphql; do
  q="$(cat "$doc")"
  hash="$(printf '%s' "$q" | shasum -a 256 | cut -d' ' -f1)"
  curl -s -X POST http://localhost:8080/graphql \
    -H 'Content-Type: application/json' \
    -H "X-BTT-App-Token: $WP_APP_TOKEN" \
    -d "$(jq -n --arg q "$q" --arg h "$hash" \
          '{query:$q, extensions:{persistedQuery:{version:1, sha256Hash:$h}}}')" \
    | jq -r --arg d "$doc" 'if .errors then "FAILED \($d): " + .errors[0].message else "ok \($d)" end'
done
```

**Verify §6:**

- [ ] Every line prints `ok`. A `FAILED` naming a validation error means the document does not
      match the committed schema — run `npm run codegen:check` before debugging registration.
- [ ] `wp post list --post_type=graphql_document --format=count` equals the number of `.graphql`
      documents, or more. More means operations from an earlier revision are still registered,
      which is harmless and is why a *deploy* never prunes.
- [ ] The whole loop a second time prints `ok` again and does not change the count.

> **The hash must be computed over the exact bytes the client will send.** The loop above hashes
> the file, and codegen normalises documents before shipping them — so these two hashes agree
> only once `codegen.ts` is configured to emit persisted documents and to write the same
> manifest. Until then this step proves the *mechanism* and the allowlist is not the thing
> serving traffic. That gap is named in this lesson's report rather than papered over.

### Step 7: Write the edge rules and the break-glass path down

Edge configuration is Cloudflare state, not repository state, so what belongs in git is the
decision and the recovery path. Append one section to `docs/architecture.md`, the file Lesson
01.3 created and thirty lessons have appended to since.

```markdown
<!-- docs/architecture.md — append ONE section. Never edit another lesson's section. -->

## WordPress hardening (Lesson 24.1)

### Edge rules, in front of Fly.io

| Path | Rule | Rationale |
|---|---|---|
| `/wp-admin*`, `/wp-login.php` | Cloudflare Access, identity-gated | The request never wakes PHP. A login-limiter plugin rate-limits *after* the expensive part. |
| `/xmlrpc.php` | block at the edge | Nothing uses it. `xmlrpc_enabled` is off as well — two layers. |
| `/graphql` | 60 requests / minute / IP | Depth and complexity limits cap one query's cost; this caps the rate. |
| `/wp-json/*` | pass, 120 / minute / IP | The block editor is a REST client (Lesson 02.4's routing table). |
| `/wp-content/uploads/*` | pass, cached | Media is public. See the caveat below. |

### Break-glass

Cloudflare Access being down must not mean nobody can administer WordPress.

1. `fly ssh console -a btt-wp`
2. `wp user list --role=administrator` / `wp user create` / `wp user update` as needed
3. Record what you did in `docs/runbook.md` the same day.

This path bypasses the edge entirely. It is acceptable because it requires a Fly deploy token,
which two named people hold and which is rotated quarterly. If that stops being true, this
paragraph stops being true.

### What hiding the origin does and does not buy

Media `sourceUrl` values are absolute and public, so the WordPress host is discoverable from any
rendered page regardless of `WP_GRAPHQL_ENDPOINT` being server-only (appendix 04 §6). Keeping the
endpoint out of the client bundle removes it from the app's own traffic. It is not a control. The
controls are the query allowlist, the capability matrix, the grant list and the edge rules.

### Update policy

| Update class | Owner | Deadline | Mechanism |
|---|---|---|---|
| Core security release | on-call | 48 h | base image tag bump → PR → CI → deploy |
| Plugin security advisory | on-call | 48 h | version bump → PR → CI → deploy |
| Core / plugin minor | maintenance rota | next fortnightly window | one PR; `wp core update-db` runs in the release command |
| Major ACF / WPGraphQL / Polylang | named owner | scheduled work | schema regenerated; `codegen:check` is the gate |

Background auto-updates are **off**: the container is immutable and would lose the mutation on
the next deploy. This is only defensible while the 48-hour commitment above is staffed.
```

**Verify §7:**

- [ ] The heading is `## WordPress hardening (Lesson 24.1)`, appended not inserted, and
      `git diff docs/architecture.md` shows additions only.
- [ ] Every update-policy row names a **person or rota**, not "the team". An unowned deadline
      is a wish, and a path nobody has walked is a paragraph — so walk the break-glass one
      locally today.

### Step 8: Prove the branch works both ways, then commit

The failure mode of this lesson is a file that is correct in production and unusable locally, so
the last step exercises both sides.

```bash
cd wordpress-headless

# Local: introspection still available, so `npm run schema:pull` and GraphiQL still work
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __schema { queryType { name } } }"}' | jq -r '.data.__schema.queryType.name'

# The same code, in a production-typed environment. `docker compose run -e` overrides
# env_file, wp-config.php reads WP_ENVIRONMENT_TYPE through btt_env_opt(), and
# wp_get_environment_type() reads the constant — so this is the real branch, not a mock.
docker compose run --rm -e WP_ENVIRONMENT_TYPE=production wpcli wp eval '
  printf( "env=%s hardened=%s introspection=%s\n",
    wp_get_environment_type(),
    var_export( Blame\Hardening\hardened(), true ),
    get_graphql_setting( "public_introspection_enabled", "off" ) );'

git add -A
git commit -m "feat(wp): environment-aware hardening mu-plugin and persisted-query allowlist"
```

**Verify §8:**

- [ ] The first command prints `RootQuery`. Introspection is on locally and must stay on —
      `npm run schema:pull` and every GraphiQL session depend on it.
- [ ] The second prints `env=production hardened=true introspection=off`. Both halves matter:
      the same file, the same commit, two behaviours, decided by one variable.
- [ ] `docker compose run --rm wpcli wp plugin list --status=must-use --format=count` is `2`:
      the hardening file and Lesson 12.4's `blame-seeder-loader.php`.
- [ ] `git status --short` is clean and `.env` is not in the commit.

---

## Verification

```bash
cd wordpress-headless

# 1. The mu-plugin is loaded, at the top level, and it is not deactivatable
docker compose run --rm wpcli wp plugin list --status=must-use --format=csv --fields=name,status
# Expected: two rows — 000-btt-hardening.php and blame-seeder-loader.php, both "must-use"
#           A missing hardening row means the file is in a subdirectory. mu-plugins
#           does not recurse (Key Concept 3).

# 2. Introspection is ON here, because this is local. THE POSITIVE THAT MATTERS:
#    a hardening file that cannot be developed against is the failure mode.
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __schema { queryType { name } } }"}' | jq -r '.data.__schema.queryType.name'
# Expected: RootQuery

# 3. NEGATIVE — the same code, in a production-typed environment, refuses it.
#    `docker compose run -e` overrides env_file, so this is the real branch.
docker compose run --rm -e WP_ENVIRONMENT_TYPE=production wpcli wp eval \
  'printf( "env=%s introspection=%s debug=%s hardened=%s\n",
     wp_get_environment_type(),
     get_graphql_setting( "public_introspection_enabled", "off" ),
     get_graphql_setting( "debug_mode_enabled", "off" ) ?: "off",
     var_export( Blame\Hardening\hardened(), true ) );'
# Expected: env=production introspection=off debug=off hardened=true
#           All four from Lesson 06.4's filter plus this lesson's hardened(). If
#           introspection is "on" here, performance.php is not loaded.

# 4. NEGATIVE — a depth-11 query is refused. HTTP 200 with an `errors` array, as always:
#    read .errors with jq, never the status code.
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -o /tmp/btt-deep.json -w 'http=%{http_code}\n' \
  -d '{"query":"{ incidents(first:1){ nodes{ author{ node{ posts(first:1){ nodes{ author{ node{ posts(first:1){ nodes{ author{ node{ posts(first:1){ nodes{ author{ node{ posts(first:1){ nodes{ id } } } } } } } } } } } } } } } } } } }"}'
# Expected: http=200
jq -r 'if .errors then .errors[0].message else "NO ERROR — the depth rule is not wired" end' /tmp/btt-deep.json
# Expected: a message naming the depth limit 10. Lesson 06.4 owns this rule; this
#           check confirms it survived the mu-plugin arriving.

# 5. ...and a shallow anonymous query still works. The limit rejects abuse, not the app.
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:2){ nodes{ title } } }"}' \
  | jq -r 'if .errors then "UNEXPECTED: " + .errors[0].message else "ok" end'
# Expected: ok

# 6. NEGATIVE — an UNREGISTERED operation hash is refused under the allowlist
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"extensions":{"persistedQuery":{"version":1,"sha256Hash":"0000000000000000000000000000000000000000000000000000000000000000"}}}' \
  | jq -r 'if .errors then "refused: " + .errors[0].message else "EXECUTED — the allowlist is off" end'
# Expected: refused: … (PersistedQueryNotFound, or your version's wording)
#           This is the control doing its job: there is no way to supply the
#           document instead of the hash.

# 6b. ...and a REGISTERED one from Step 6 still resolves
doc=src/graphql/incidents.graphql
h=$(printf '%s' "$(cat ../next-app/$doc)" | shasum -a 256 | cut -d' ' -f1)
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "$(jq -n --arg h "$h" '{extensions:{persistedQuery:{version:1,sha256Hash:$h}},variables:{first:2}}')" \
  | jq -r 'if .errors then "FAILED: " + .errors[0].message else "ok" end'
# Expected: ok — the hash registered in Step 6 executes without the document.
#           A PersistedQueryNotFound here means the bytes you hashed are not the
#           bytes you registered. Key Concept 6's footgun, in miniature.

# 7. NEGATIVE — XML-RPC returns nothing useful
curl -s -X POST http://localhost:8080/xmlrpc.php -H 'Content-Type: text/xml' \
  -d '<methodCall><methodName>system.listMethods</methodName><params/></methodCall>' \
  | grep -c 'wp.getUsersBlogs\|pingback.ping'
# Expected: 0 — no method table, so no pingback and no wp.* surface

# 7b. NEGATIVE — and no response advertises pingback
curl -sI http://localhost:8080/ | grep -ci 'x-pingback'
# Expected: 0

# 8. NEGATIVE — ?author=1 does not enumerate a username
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'http://localhost:8080/?author=1'
# Expected: a 30x whose Location has NO /author/<name>/ segment. The query var is
#           dropped at parse_request, so this resolves as the home query and
#           Lesson 02.4's template_redirect sends it to Next.

# 8b. NEGATIVE — and REST does not enumerate either
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/wp-json/wp/v2/users
# Expected: 401 — the anonymous allowlist holds two btt/v1 routes and this is not one
curl -s http://localhost:8080/wp-json/wp/v2/users | jq -r '.code // "no code"'
# Expected: btt_rest_authentication_required

# 8c. ...but the two allowlisted routes are still reachable anonymously
curl -s -o /dev/null -w 'preview/verify %{http_code}\n' -X POST http://localhost:8080/wp-json/btt/v1/preview/verify
# Expected: preview/verify 401 — from Lesson 17.2's OWN app-token check, not from the
#           allowlist. A 404 here means you blocked the route instead of passing it.

# 9. NEGATIVE — the database user holds none of the three dangerous grants
docker compose exec -T db sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" -N -B \
  -e "SHOW GRANTS FOR \"btt\"@\"%\";"' | grep -cE 'GRANT OPTION|\bFILE\b|\bSUPER\b'
# Expected: 0
docker compose exec -T db sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" -N -B \
  -e "SHOW GRANTS FOR \"btt\"@\"%\";"'
# Expected: USAGE ON *.* plus exactly SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER,
#           INDEX, DROP on `btt`.*. No ALL PRIVILEGES.

# 10. NEGATIVE — plugin installation fails once DISALLOW_FILE_MODS is set.
#     Proven without editing .env: -e overrides env_file for this one container.
docker compose run --rm -T -e DISALLOW_FILE_MODS=true wpcli \
  wp plugin install classic-editor 2>&1 | tail -2
# Expected: an error naming DISALLOW_FILE_MODS or "Plugin installation is disabled".
#           NOT "Plugin installed successfully". In production the image is the
#           plugin set — Key Concept 10, and Lesson 24.6's premise.

# 11. The block editor still works. The REST allowlist must not break Gutenberg,
#     and an anonymous curl cannot tell you that — a logged-in call can.
docker compose run --rm wpcli wp eval '
  wp_set_current_user( get_user_by( "login", "editor" )->ID );
  $r = rest_do_request( new WP_REST_Request( "GET", "/wp/v2/block-types" ) );
  printf( "block-types status=%d count=%d\n", $r->get_status(), is_array( $r->get_data() ) ? count( $r->get_data() ) : -1 );'
# Expected: status=200 and a count in the hundreds. A 401 means restrict_anonymous_rest
#           is checking the route before is_user_logged_in() — swap the order back.

# 12. NEGATIVE — nothing in the mu-plugin duplicates a Lesson 06.4 setting
grep -cE 'graphql_connection_max_query_amount|QueryDepth|QueryComplexity|public_introspection_enabled|debug_mode_enabled' \
  wp-content/mu-plugins/000-btt-hardening.php
# Expected: 0. Two owners for one setting means the loser is decided by load order.

# 13. NEGATIVE — no secret, and no credential, is in the tracked file
grep -cE 'password|secret|[A-Za-z0-9_/+=]{32,}' wp-content/mu-plugins/000-btt-hardening.php
# Expected: 0

# 14. The honest caveat, demonstrated rather than asserted: the WordPress host is
#     discoverable from public media URLs no matter what you hide.
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ mediaItems(first:1){ nodes{ sourceUrl } } }"}' | jq -r '.data.mediaItems.nodes[0].sourceUrl'
# Expected: an absolute http://localhost:8080/wp-content/uploads/... URL.
#           In production that is your origin, in every rendered page. Appendix 04 §6.

# 15. NEGATIVE — the enforcement switch is OFF in the tracked example file
grep 'BTT_PERSISTED_QUERIES_ENFORCED' .env.example
# Expected: BTT_PERSISTED_QUERIES_ENFORCED=false
#           A `true` here is a committed instruction to break production.
docker compose run --rm wpcli wp eval 'echo var_export( Blame\Hardening\enforcing_persisted_queries(), true ), PHP_EOL;'
# Expected: false

# 16. NEGATIVE — the mu-plugin is not a directory, and it is not in the plugins dir
test -f wp-content/mu-plugins/000-btt-hardening.php && echo "top-level file: ok"
# Expected: top-level file: ok
ls wp-content/plugins/ | grep -c hardening
# Expected: 0 — a regular plugin can be deactivated from wp-admin (Key Concept 3)

# 17. The four Lesson 06.4 limits are all still reachable through the filter chain
docker compose run --rm wpcli wp eval \
  'printf( "nodes=%d depth=%d complexity=%d\n",
     (int) apply_filters( "graphql_connection_max_query_amount", 100, null, array(), null, null ),
     Blame\Core\GRAPHQL_MAX_DEPTH, Blame\Core\GRAPHQL_MAX_COMPLEXITY );'
# Expected: nodes=50 depth=10 complexity=500
#           Unchanged by this lesson. If any number moved, you edited 06.4's file.

# 18. The suites still pass — hardening that breaks the tests is not shipped
cd ../next-app && npm run test:run
# Expected: exits 0
cd ../wordpress-headless && docker compose run --rm composer run phpcs
# Expected: exits 0, no --standard flag needed anywhere (phpcs.xml.dist is in the plugin)
```

If check 3 prints `introspection=on`, stop: `performance.php` is not loading and every limit this
lesson claims to verify is absent. If check 11 returns 401, the REST allowlist is checking the
route before the session, and you have broken the block editor for every editor on the site —
the one failure here a user reports before you notice.

## Control Questions

1. `hardened()` returns false for `local` and true for both `staging` and `production`, and the
   table in Key Concept 4 makes staging identical to production in every security row. Name the
   one control you would most want to differ between staging and production, say what it would
   cost you to make that exception, and explain why the course refuses it anyway.
2. Persisted queries are enforced by the WordPress side, but the hashes are produced by the Next
   build. Given the deploy-ordering table in Key Concept 6, describe the sequence of a release in
   which you have changed one query and one component that uses it — including what is registered,
   what is deployed, in what order, and what a visitor sees during each gap.
3. The mu-plugin drops the `author` and `author_name` query vars at `parse_request` rather than
   filtering `redirect_canonical`. Both close the enumeration. Explain what the `parse_request`
   version additionally prevents, and name the site on which it would be the wrong choice.
4. Revoking `FILE` from the database user does not stop SQL injection. Say precisely what it does
   change about the consequences of one, then say which control in this course is the one that
   actually prevents injection and where it lives.
5. `DISALLOW_FILE_MODS` means plugins are installed by rebuilding the image. A security advisory
   lands for a plugin at 22:00 on a Friday and the 48-hour clock in the update policy is running.
   Walk the path from advisory to production, naming every gate the change passes through, and
   identify the step most likely to make you miss the deadline.

## Learn More

- [WordPress — Hardening WordPress](https://developer.wordpress.org/advanced-administration/security/hardening/) —
  the official list; read it as the *classic* half of this lesson and notice that GraphQL appears
  nowhere in it
- [WordPress — must-use plugins](https://wordpress.org/documentation/article/must-use-plugins/) —
  confirms the no-recursion behaviour and the load-order rule the `000-` prefix relies on
- [`wp_get_environment_type()`](https://developer.wordpress.org/reference/functions/wp_get_environment_type/) —
  the four accepted values and the constant-then-environment resolution order every branch in this
  lesson depends on
- [WPGraphQL Smart Cache — persisted queries](https://github.com/wp-graphql/wp-graphql-smart-cache/blob/main/docs/persisted-queries.md) —
  the allowlist mechanism, and the source to check when the setting field names in Task Step 5 do
  not match what your version prints
- [OWASP — GraphQL Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html) —
  depth, complexity, batching and introspection as a coherent threat model rather than four
  unrelated switches
- [MySQL — privileges provided by MySQL](https://dev.mysql.com/doc/refman/8.0/en/privileges-provided.html) —
  the authoritative description of `FILE`, `SUPER` and `GRANT OPTION`; read those three entries
  before you decide Key Concept 9 is being dramatic
- [WordPress REST API — `rest_pre_dispatch`](https://developer.wordpress.org/reference/hooks/rest_pre_dispatch/) —
  why the allowlist hooks here rather than on `rest_authentication_errors`, and what returning a
  `WP_Error` does to the dispatch
- [Cloudflare Access — self-hosted applications](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/) —
  the mechanism behind the `/wp-admin*` rule, including how to keep a break-glass bypass that does
  not depend on the identity provider being up
- [WordPress — `DISALLOW_FILE_MODS`](https://developer.wordpress.org/advanced-administration/wordpress/wp-config/#disable-plugin-and-theme-update-and-installation) —
  one paragraph, and the exact behaviour Verification check 10 asserts
