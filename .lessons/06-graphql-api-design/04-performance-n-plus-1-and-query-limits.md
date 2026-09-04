---
title: 'Performance, N+1 & Query Limits'
module: 6
lesson: 4
teaches: [n-plus-1, dataloader, query-depth-limits, persisted-queries, introspection-off]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/performance.php']
requires: [2.3, 6.1]
---

# Lesson 06.4 — Performance, N+1 & Query Limits

## Quick Overview

Ask for 40 incidents with their scapegoat, their severity and their `blameScore`, turn on the
query log, and count. If the resolvers are written naively you will see well over a hundred SQL
queries for one HTTP request: one to fetch the posts, then one per node for the terms, then one
per node for the meta the score needs. That is **N+1**, and it is the defining performance
problem of any GraphQL server. It is not a WordPress problem and not a WPGraphQL bug — it is what
happens when a per-node resolver does its own I/O and a client chooses N.

The fix is batching. WPGraphQL ships DataLoader-style loaders that collect the IDs requested
during a resolution pass and fetch them in one query, and core's own
`update_post_caches`/`_prime_post_caches` and `update_object_term_cache` do the same job at the
WordPress level. You will measure before, wire the loaders and priming, and measure after,
writing both numbers down. The second half of the lesson is about the attack surface a query
language creates: a client can send a deeply nested query that costs the server far more than it
costs them, so you set a **depth limit** (reject beyond 10), a complexity budget, disable
introspection outside development, and read the case for **persisted queries** — an allowlist of
hash-registered operations, which is the strongest control available and the one Module 24
enables in production. The honest caveat from
[appendix 04 §6](../appendix/04-env-reference.md#6-the-honest-caveat-about-hiding-the-wordpress-origin)
applies: keeping the endpoint server-only is not security by itself, these limits are.

By the end of this lesson you will have:

- A measured query count for a 40-node list before any optimisation, taken from the query log
- `includes/graphql/performance.php` wiring loader-based batching and cache priming for terms
  and meta
- The same query re-measured, with the improvement recorded as two concrete numbers
- A depth limit rejecting a query nested beyond 10, proven with a deliberately abusive query
- Introspection disabled unless `WP_ENVIRONMENT_TYPE` is `local`, and `graphql_debug` off
  outside local
- A written note on persisted queries: what they buy, what they cost, and why they wait for
  Module 24

## Classic WP Analogy

You have already fixed this bug in a template. The classic form is a loop that calls
`get_the_terms()` or `get_post_meta()` inside `while (have_posts())`, and the classic fix is
either to let `WP_Query`'s `update_post_term_cache` and `update_post_meta_cache` do their work —
they default to true and prime the whole result set in one query each — or to call
`_prime_post_caches()` yourself for a list of IDs you assembled some other way. If you have ever
watched Query Monitor report 200 queries on an archive page and traced it to a helper function
called in a loop, you have diagnosed N+1 without using the term.

The mechanism is identical here. `WP_Query` primes caches for the posts it returned, then
`get_post_meta()` inside the loop hits the object cache instead of the database. A GraphQL
loader does the same thing one level up: it defers the individual requests, collects the IDs, and
issues one query for the batch. So the mental model transfers, and so does the diagnostic
instinct — count the queries, find the thing being called per item, and hoist the fetch.

**Where the analogy breaks down:** in a Classic WordPress template *you* wrote the loop, so you
know how many iterations there are and you can see the offending call. Here the "loop" is chosen
by the client at request time. A resolver that costs one extra query looks perfectly fine in
development against a single node, and the same resolver costs 200 queries when a front-end
developer writes `first: 200` in a query you never reviewed — or when someone hostile does. Two
consequences follow that have no Classic equivalent. First, performance review has to happen at
the *schema* level, because you cannot review every query your API will ever be sent. Second,
you need hard limits — depth, complexity, and ultimately a persisted-query allowlist — because
"nobody would write that query" stops being a safe assumption the moment the endpoint is
reachable by anyone but you.

---

## Key Concepts

### 1. N+1, and why a query language invites it

N+1 is one query to fetch a list, then one more **per item** to fetch something about each item.
The name is the arithmetic: 1 + N.

```
   ONE query for the list                    ONE query PER NODE
   ┌────────────────────────────┐            ┌──────────────────────────────┐
   │ SELECT ID FROM wp_posts    │            │ node[0]  → SELECT … WHERE 17 │
   │  WHERE post_type='incident'│  ────────▶ │ node[1]  → SELECT … WHERE 18 │
   │  LIMIT 40                  │            │   ⋮                          │
   └────────────────────────────┘            │ node[39] → SELECT … WHERE 56 │
              1                              └──────────────────────────────┘
                                                          40
                                        total: 41 queries for one HTTP request
```

REST has the same problem and hides it, because a REST endpoint's response shape is fixed by the
developer who wrote it — you can see the loop, you own it, and you fix it once. GraphQL exposes
it structurally, for three reasons that compound:

| Property of GraphQL | Consequence |
|---|---|
| A field on a type is resolved **once per node** | Lesson 06.1 §7. Forty nodes, forty resolver calls. |
| The **client** chooses N | `first: 5` in development, `first: 200` in the query someone writes next quarter |
| The client also chooses the **shape** | Nested selections multiply: 40 incidents × 1 scapegoat each × 1 avatar each |
| Every resolver looks cheap in isolation | `get_term_meta()` is one fast query. That is the trap. |

> **The reframing that matters:** a resolver is not a function on a page. It is a function whose
> invocation count is decided by someone else, later, in another repository. Review performance
> at the **schema** level, because you cannot review every query your API will ever be sent.

### 2. WordPress already batches — and you know how, from templates

The Classic WordPress version of this bug is `get_post_meta()` inside `while ( have_posts() )`.
The Classic fix is priming: `WP_Query` defaults `update_post_meta_cache` and
`update_post_term_cache` to `true` and fetches the whole result set's meta and terms in one query
each, so the calls inside the loop hit the object cache.

Three core functions do the priming, and knowing which one covers what is most of the fix:

| Function | Primes | Not primed by anything else |
|---|---|---|
| `_prime_post_caches( $ids, $terms, $meta )` | posts, their meta, their terms | — |
| `update_object_term_cache( $ids, $post_types )` | the term **relationships** for a batch of posts | |
| `update_termmeta_cache( $term_ids )` | **term meta** | ⚠️ **yes — nothing primes term meta for you** |
| `update_meta_cache( 'post', $ids )` | post meta only | |

```
                       PRIMED BY A POST QUERY?
  get_post_meta( $post_id, 'downtime_minutes' )        ✅  update_post_meta_cache
  get_the_terms( $post_id, 'severity' )                ✅  update_post_term_cache
  get_term_meta( $term_id, 'tagline' )                 ❌  nothing. one query per term.
  get_field( 'avatar', 'scapegoat_' . $term_id )       ❌  term meta again, via ACF
  wp_get_attachment_image_src( $id )                   ❌  a separate post + its meta
```

That fourth row is why ACF **term** fields and ACF **image** fields are the two most common
sources of N+1 in a WPGraphQL project. Both reach for data that no post query primes.

### 3. WPGraphQL's DataLoader and the deferred-resolution model

WPGraphQL ships DataLoaders — one per kind of thing it can fetch by ID — and they live on the
`AppContext`, which is the one resolver argument shared across the whole request (Lesson 06.1
§2).

```php
// Illustrative — the pattern. Lesson 06.2's createIncident payload already uses it.
'resolve' => static function ( $source, array $args, AppContext $context, ResolveInfo $info ) {
	return $context->get_loader( 'post' )->load_deferred( (int) $source->relatedId );
},
```

`load_deferred()` does **not** return a post. It returns a `Deferred` — a promise. Nothing is
fetched yet.

```
   resolution pass 1: every node's resolver runs
   ┌──────────────────────────────────────────────────────────┐
   │ node[0]  load_deferred(17)  ──▶ queue: [17]              │
   │ node[1]  load_deferred(18)  ──▶ queue: [17,18]           │
   │   ⋮                                                      │
   │ node[39] load_deferred(56)  ──▶ queue: [17,18,…,56]      │
   └──────────────────────────────────────────────────────────┘
                              │
   graphql-php drains the queue ONCE
                              ▼
   ┌──────────────────────────────────────────────────────────┐
   │ loadKeys([17,18,…,56])  →  ONE query for all 40          │
   └──────────────────────────────────────────────────────────┘
                              │
   pass 2: every promise resolves from the batch
```

Loader keys worth knowing: `post`, `term`, `user`, `comment`, `post_type`, `taxonomy`. Anything
you can fetch by ID, fetch through a loader.

| Rule | Why |
|---|---|
| Return the `Deferred`, do not resolve it | Resolving it inside your resolver defeats the batch entirely |
| One `load_deferred` per node is correct | That is the design. Forty deferreds, one query. |
| A loader only helps for **by-ID** lookups | A `WP_Query` in a resolver cannot be batched by anything |

**The verdict: loaders solve the by-ID case completely and nothing else.** Term meta, ACF fields
and image sizes are not by-ID lookups of a known type, so they need priming (§2) or a different
question (§4).

### 4. Sometimes the fix is to ask from the other side

The most valuable N+1 fix is often not batching — it is noticing that the relationship reads
better in the other direction.

```
   N+1 SHAPE — 40 nodes, each asking about its scapegoat
   { incidents(first: 40) { nodes { scapegoats(first: 1) { nodes { name } } } } }
       one term query PER INCIDENT

   CONSTANT SHAPE — ask the taxonomy, which already has the answer
   { scapegoats(first: 10) { nodes { name count } } }
       one term query, and `count` is a column WordPress maintains
```

`wp_term_taxonomy.count` is maintained by WordPress on every term assignment, so the blame
leaderboard in [appendix 05 §9](../appendix/05-graphql-cheatsheet.md#9-query-patterns-this-app-actually-uses)
is **one indexed read** rather than an aggregate over 40 nodes. That is not a coincidence — it is
why appendix 03 §2 made `scapegoat` a taxonomy instead of a relationship field. The data model
choice made in Module 03 is what makes the fast query possible in Module 06.

| Question | Bad shape | Good shape |
|---|---|---|
| "How many incidents blame each scapegoat?" | walk incidents, count | `scapegoats { nodes { count } }` |
| "The 10 worst incidents" | fetch 200, sort client-side | `first: 10` with `orderby` |
| "Every incident tagged React" | fetch all, filter | `techStack(id:"react") { contentNodes }` |

### 5. Measure. Do not estimate, and do not trust this page

Query counts move between WordPress versions, WPGraphQL versions, ACF versions and object-cache
configurations. The number you read in a tutorial is worthless; the number your stack prints is
not.

Two things WordPress gives you:

| Tool | Gives you | Cost |
|---|---|---|
| `$wpdb->num_queries` | a running count, **always available** | free |
| `SAVEQUERIES` | the full SQL of every query, in `$wpdb->queries` | memory and time — never in production |

`SAVEQUERIES` is checked **at query time**, not at boot, so `define( 'SAVEQUERIES', true )` at
the top of a `wp eval` script logs everything after that line. That is the whole harness.

The number to look at is not the total — it is the **shape**:

```
   run the SAME query at first: 5 and first: 40
   ─────────────────────────────────────────────────────────────
   flat        18 → 19 queries     O(1) in N   ✅ correct
   linear      23 → 58 queries     O(N)        ❌ an N+1, exactly N apart
```

And group duplicate SQL after normalising the numbers out of it. A hundred queries that are
really one query shape repeated forty times is a diagnosis; a hundred distinct queries is a
different problem entirely. The harness in the Task does both.

> **Run it twice.** The first run of any query populates transients, term caches and object
> caches; the second is the steady state your users see. A single cold measurement over-reports,
> and "I fixed it" is the most common consequence.

### 6. `wp_options` autoload is on the hot path of every GraphQL request

Lesson 02.3 §7 measured this and Module 06 is where it starts costing you. Before WordPress runs
a single line of your resolver, it runs:

```
   POST /graphql
        │
        ├─▶ SELECT option_name, option_value FROM wp_options WHERE autoload='yes'
        │        ← the fixed tax. Paid on EVERY request, before anything else.
        ├─▶ plugins load, init fires, WPGraphQL builds the type registry
        └─▶ your query executes
```

A 4 MB autoload set is a 4 MB cost on a request that returns 2 KB of JSON, and unlike a page it
is not amortised by a page cache — Lesson 02.3 makes exactly this point about Server Components
fetching per render. So the query budget in this lesson has two halves: the queries your
**query** costs, and the fixed cost every request pays before it starts. Measuring the first
while ignoring the second is how a "fast" API stays slow.

### 7. Limits: what each one actually stops

Four controls, and they stop different attacks. Enabling one and calling it done is the common
mistake.

| Control | Mechanism | Stops | Does not stop |
|---|---|---|---|
| **Node cap** | `graphql_connection_max_query_amount` filter | `first: 100000` | a deeply nested query with `first: 1` |
| **Depth limit** | a `QueryDepth` validation rule | `author { posts { author { posts { … } } } }` recursion | a flat query selecting 4000 fields |
| **Complexity limit** | a `QueryComplexity` validation rule | very large queries generally | a legitimate query that is genuinely expensive |
| **Persisted queries** | WPGraphQL Smart Cache allowlist | **everything not on the allowlist** | nothing — this is the strong one |

```
   WITHOUT limits                          WITH limits
   ───────────────────────────────         ───────────────────────────────
   one 900-byte request                    validation rejects it before
   → 40s of CPU, 12000 queries               a single resolver runs
   → asymmetric cost: cheap for              → cost stays with the caller
     the caller, ruinous for you
```

Two notes on the practicalities, both learned the hard way:

- **The standard introspection query is deeper than 10 levels.** A depth limit of 10 applied to
  everybody breaks GraphiQL and every schema-fetching tool. This project applies the limit to
  callers who cannot `manage_options`, which is every caller that matters and not the
  administrator sitting in the IDE.
- **Complexity without per-field weights is blunt.** `QueryComplexity` counts fields and
  multiplies by list arguments; nothing in WPGraphQL annotates a resolver with what it truly
  costs. Treat it as a ceiling on query *size*, not a cost model, and set it generously enough
  that no real query trips it.

### 8. Introspection: on locally, off everywhere else

Introspection is how GraphiQL autocompletes and how codegen used to work. Nothing in this
project needs it in production, because Lesson 06.3 committed `wordpress-headless/schema.graphql`
and Module 10's codegen reads that **file**.

| Environment | Introspection | Why |
|---|---|---|
| `local` | **on** | GraphiQL, and every `curl __type` check in this course |
| `staging`, `production` | **off** | It hands an attacker a complete, machine-readable map of your API for free |

WPGraphQL already blocks *public* introspection by default and has a setting for it — which is a
database row, and a policy in a database row is a policy someone will change by clicking. This
lesson moves the decision into code, keyed on `wp_get_environment_type()`, so it travels with the
deploy.

> **Be honest about what this buys.** Turning introspection off is not security; a determined
> attacker can enumerate fields by guessing, and appendix 04 §6 says so plainly. It removes a
> convenience, raises the cost of reconnaissance, and is worth two lines. The controls that do
> the actual work are the capability checks in Lesson 06.2 and the persisted-query allowlist
> below.

### 9. Persisted queries are the strongest control available

WPGraphQL Smart Cache lets a client register an operation, receive its hash, and thereafter send
only the hash. In production you configure it so that **only hash-registered operations
execute**.

```
   AD-HOC (development)                    PERSISTED (production)
   ───────────────────────────────         ───────────────────────────────
   POST { "query": "{ … }" }               POST { "queryId": "<sha256>" }
   the server parses whatever                the server looks the hash up
   arrived                                   → not found? refused. Full stop.
   depth/complexity limits are               depth and complexity are already
   guessing at what is reasonable            known, because you wrote the query
```

| Buys you | Costs you |
|---|---|
| An **allowlist**. An unregistered query cannot run, so there is nothing to rate-limit or budget. | A build step: operations must be extracted and registered at deploy time |
| Smaller requests — a hash, not a document | A deploy-ordering constraint: register before the front end ships |
| Cacheable at the edge by hash | Ad-hoc debugging in production is gone, which is mostly a feature |

This project turns it on in **Module 24**, not here, because it needs the extracted-operations
list that Module 10's codegen produces. What matters now is knowing the ceiling: depth and
complexity limits are what you do *until* you have an allowlist, and the allowlist is what
makes the rest of it a defence in depth rather than the whole defence.

---

## Task

### Step 1: Build the harness and take the "before" numbers

Two shell functions. `gqcount` prints the query count plus the three most-repeated SQL shapes,
which is what turns a number into a diagnosis.

```bash
cd wordpress-headless

gqcount() {
  docker compose run --rm wpcli wp eval '
    define( "SAVEQUERIES", true );
    $wpdb = $GLOBALS["wpdb"];
    graphql( array( "query" => $argv[0] ) );
    printf( "queries=%d%s", count( $wpdb->queries ), PHP_EOL );
    $groups = array();
    foreach ( $wpdb->queries as $row ) {
      $sql = preg_replace( "/[0-9]+/", "N", (string) $row[0] );
      $sql = preg_replace( "/\s+/", " ", (string) $sql );
      $groups[ $sql ] = ( $groups[ $sql ] ?? 0 ) + 1;
    }
    arsort( $groups );
    foreach ( array_slice( $groups, 0, 3, true ) as $sql => $n ) {
      printf( "%5d x %s%s", $n, substr( $sql, 0, 88 ), PHP_EOL );
    }' "$1"
}
```

Measure the same query at two sizes. The **difference** is the signal, not the total.

```bash
# A. Titles only — the floor. Whatever this costs, every query costs.
gqcount '{ incidents(first: 5)  { nodes { title } } }'
gqcount '{ incidents(first: 40) { nodes { title } } }'

# B. blameScore — Lesson 06.1 claimed this is free. Check the claim.
gqcount '{ incidents(first: 5)  { nodes { title blameScore } } }'
gqcount '{ incidents(first: 40) { nodes { title blameScore } } }'

# C. A taxonomy connection PER NODE — the deliberate N+1.
gqcount '{ incidents(first: 5)  { nodes { scapegoats(first: 1) { nodes { name } } } } }'
gqcount '{ incidents(first: 40) { nodes { scapegoats(first: 1) { nodes { name } } } } }'
```

**Verify §1:**

- [ ] Run each line **twice** and use the second number. The first run warms caches (Key
      Concept 5).
- [ ] A and B are roughly **flat** between `first: 5` and `first: 40` — a handful of queries
      either way. `blameScore` reads primed caches and adds no I/O.
- [ ] C grows by roughly **35** — one term query per extra node. That is an N+1, and the SQL
      breakdown names it: the top line is a `wp_term_relationships` join repeated N times.
- [ ] Write the six numbers down. Step 5 puts them in `docs/api-contract.md`.

### Step 2: Write `includes/graphql/performance.php`

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/performance.php
/**
 * GraphQL performance and abuse limits.
 *
 * Four jobs:
 *   1. Prime WordPress object caches for every connection batch (§2).
 *   2. Cap connection size, query depth and query complexity (§7).
 *   3. Own the introspection decision in code, not in a database row (§8).
 *   4. Log a query count per operation in local development (§5).
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

use GraphQL\Validator\Rules\DisableIntrospection;
use GraphQL\Validator\Rules\QueryComplexity;
use GraphQL\Validator\Rules\QueryDepth;

defined( 'ABSPATH' ) || exit;

/** Hard ceiling on nodes per connection, whatever `first:` asks for. */
const GRAPHQL_MAX_NODES = 50;

/** Max nesting levels. The introspection query is deeper — see below. */
const GRAPHQL_MAX_DEPTH = 10;

/** Field-count ceiling. A size limit, not a cost model (§7). */
const GRAPHQL_MAX_COMPLEXITY = 500;

/**
 * Cap every connection.
 *
 * WPGraphQL's default is 100 and a client asking for more is silently clamped
 * with a graphql_debug notice. min() rather than a flat return, so a
 * connection that has already lowered its own ceiling keeps it.
 */
add_filter(
	'graphql_connection_max_query_amount',
	static fn( $amount ): int => min( (int) $amount, GRAPHQL_MAX_NODES ),
	10,
	1
);

/**
 * Prime object caches for a whole connection batch, before per-node resolvers
 * run.
 *
 * `graphql_connection_ids` fires once per connection with every ID it
 * resolved — the one place in a GraphQL request where the full batch is
 * visible. Priming here makes the cost of a per-node resolver O(1) in N
 * DELIBERATELY, rather than depending on what a loader's internal WP_Query
 * happens to prime in the version you have installed.
 *
 * Both core functions skip IDs that are already cached, so this is cheap when
 * the loader already did the work and decisive when it did not.
 *
 * @param mixed $ids      The IDs the connection resolved.
 * @param mixed $resolver The connection resolver.
 * @return mixed The IDs, unchanged.
 */
function prime_connection_caches( $ids, $resolver ) {
	if ( ! is_array( $ids ) || array() === $ids ) {
		return $ids;
	}

	$int_ids = array_values( array_filter( array_map( 'absint', $ids ) ) );

	if ( array() === $int_ids ) {
		return $ids;
	}

	// Which kind of ID are we holding? The loader name says so. Guarded,
	// because this accessor is WPGraphQL internals rather than a documented
	// contract — and a missing method must not fatal a GraphQL request.
	$loader = is_object( $resolver ) && method_exists( $resolver, 'get_loader_name' )
		? (string) $resolver->get_loader_name()
		: '';

	if ( 'post' === $loader ) {
		// One query for the posts, one for all their meta, one per taxonomy.
		_prime_post_caches( $int_ids, true, true );
	}

	if ( 'term' === $loader ) {
		// Term meta is primed by NOTHING else (§2). This single line is what
		// removes the ACF-term-field N+1.
		update_termmeta_cache( $int_ids );
	}

	return $ids;
}
add_filter( 'graphql_connection_ids', __NAMESPACE__ . '\\prime_connection_caches', 10, 2 );

/**
 * Depth, complexity and introspection rules.
 *
 * `graphql_validation_rules` receives the rule array WPGraphQL assembled and
 * hands it to graphql-php. Replacing a key replaces WPGraphQL's own
 * setting-gated rule with one configured in code.
 *
 * @param array<string,\GraphQL\Validator\Rules\ValidationRule> $rules Validation rules.
 * @return array<string,\GraphQL\Validator\Rules\ValidationRule>
 */
function filter_graphql_validation_rules( array $rules ): array {
	// The standard introspection query nests deeper than 10 levels, so a
	// blanket depth limit breaks GraphiQL and every schema tool. The public
	// endpoint is what needs the limit; an operator in the IDE is not the
	// threat model. Anonymous callers never satisfy this check.
	if ( ! current_user_can( 'manage_options' ) ) {
		$rules['query_depth']      = new QueryDepth( GRAPHQL_MAX_DEPTH );
		$rules['query_complexity'] = new QueryComplexity( GRAPHQL_MAX_COMPLEXITY );
	}

	// Introspection off outside local, for EVERY caller including
	// administrators. Codegen reads the committed schema.graphql (Lesson
	// 06.3), so nothing in this project introspects a production server.
	if ( 'local' !== wp_get_environment_type() ) {
		$rules['disable_introspection'] = new DisableIntrospection( DisableIntrospection::ENABLED );
	}

	return $rules;
}
add_filter( 'graphql_validation_rules', __NAMESPACE__ . '\\filter_graphql_validation_rules', 10, 1 );

/**
 * Own the introspection setting in code rather than in a database row.
 *
 * Lesson 06.1 turned public introspection on with `wp option patch` so the
 * verification curls would work. A policy in wp_options is a policy someone
 * changes by clicking; this filter makes it a property of the environment and
 * supersedes the row.
 *
 * @param mixed  $value       The stored value.
 * @param mixed  $default_val The default.
 * @param string $option_name The setting key.
 * @return mixed
 */
function filter_graphql_settings( $value, $default_val, string $option_name ) {
	$is_local = 'local' === wp_get_environment_type();

	// Introspection: on locally, off everywhere else.
	if ( 'public_introspection_enabled' === $option_name ) {
		return $is_local ? 'on' : 'off';
	}

	// graphql_debug off outside local. It adds an `extensions.debug` array to
	// every response carrying deprecation notices, connection warnings and
	// whatever graphql_debug() was called with — useful locally, and a
	// disclosure channel in production (Lesson 06.2 §8).
	if ( 'debug_mode_enabled' === $option_name ) {
		return $is_local ? $value : 'off';
	}

	return $value;
}
add_filter( 'graphql_get_setting_section_field_value', __NAMESPACE__ . '\\filter_graphql_settings', 10, 3 );

/**
 * Log the query count for every GraphQL operation, in local development only.
 *
 * $wpdb->num_queries is free and always available — unlike SAVEQUERIES, which
 * keeps the full SQL and must never run in production. Output lands in
 * wp-content/debug.log, because docker-compose.dev.yml sets WP_DEBUG_LOG
 * (Lesson 02.2) and WP_DEBUG_DISPLAY false, so nothing is injected into the
 * JSON response.
 *
 * @param mixed  $response  The response.
 * @param mixed  $schema    The schema.
 * @param string $operation The operation name.
 * @return mixed The response, unchanged.
 */
function log_graphql_query_count( $response, $schema, $operation = '' ) {
	global $wpdb;

	if ( 'local' === wp_get_environment_type() ) {
		error_log( // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- local only, gated above.
			sprintf(
				'[btt-graphql] operation=%s queries=%d',
				'' !== (string) $operation ? (string) $operation : 'anonymous',
				(int) $wpdb->num_queries
			)
		);
	}

	return $response;
}
add_filter( 'graphql_request_results', __NAMESPACE__ . '\\log_graphql_query_count', 10, 3 );
```

Load it last — it filters what the other files registered:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
		'includes/graphql/mutation-submit-hobt-lead.php',    // Lesson 06.2
		'includes/graphql/performance.php',                  // Lesson 06.4
```

**Verify §2:**

- [ ] `docker compose logs --tail=40 wordpress` shows no fatal. A missing graphql-php class
      would fatal here — if `QueryDepth` cannot be found, your WPGraphQL is too old to bundle
      graphql-php 15.
- [ ] Every `add_filter` is at the bottom of its block, and each names a function defined above
      it.
- [ ] `error_log` appears exactly once, inside the `local` branch.

### Step 3: Re-measure, and compare the shapes

```bash
gqcount '{ incidents(first: 5)  { nodes { title blameScore } } }'
gqcount '{ incidents(first: 40) { nodes { title blameScore } } }'
gqcount '{ incidents(first: 5)  { nodes { scapegoats(first: 1) { nodes { name } } } } }'
gqcount '{ incidents(first: 40) { nodes { scapegoats(first: 1) { nodes { name } } } } }'
```

**Verify §3:**

- [ ] `blameScore` is still flat, and is now flat *because you made it so* rather than because a
      loader happened to prime the right cache.
- [ ] The per-node taxonomy walk (query C) is **still linear in N**, and that is the honest
      result. Priming the post batch does not help, because WPGraphQL resolves a term connection
      with its own `WP_Term_Query` per node rather than reading the object term cache.
- [ ] Therefore the fix for C is not a filter — it is Key Concept 4. Confirm it:

```bash
# The same question, asked from the taxonomy side. Constant, whatever N is.
gqcount '{ scapegoats(first: 10) { nodes { name count } } }'
```

- [ ] A handful of queries, and it does not grow. `count` is a column WordPress maintains
      (appendix 03 §2), which is why Module 03's data-model decision is what makes this possible.

### Step 4: Measure the fixed cost every request pays

Lesson 02.3 §7's number, revisited now that it is on the hot path of an API.

```bash
docker compose run --rm wpcli wp db query \
  "SELECT COUNT(*) AS rows_autoloaded, SUM(LENGTH(option_value)) AS autoload_bytes
   FROM wp_options WHERE autoload IN ('yes','on');"
```

**Verify §4:**

- [ ] Under roughly 800 000 bytes. Every GraphQL request pays this before your first resolver
      runs.
- [ ] If it is larger, find the offender —
      `SELECT option_name, LENGTH(option_value) FROM wp_options WHERE autoload IN ('yes','on') ORDER BY 2 DESC LIMIT 10;`
      — and note that a deactivated plugin's options do not go away.

### Step 5: Write the query budget into the contract

Append a section to the `docs/api-contract.md` you wrote in Lesson 06.3. The numbers are yours,
not the ones printed here.

```markdown
<!-- docs/api-contract.md — append -->
## 8. Query budget and limits

Measured on the 40-incident seed, second run, local Docker stack, <today's date>.

| Query | `first: 5` | `first: 40` | Shape |
|---|---|---|---|
| `incidents { nodes { title } }` | 18 | 19 | flat |
| `incidents { nodes { title blameScore } }` | 18 | 19 | flat — computed from primed caches |
| `incidents { nodes { scapegoats { nodes { name } } } }` | 23 | 58 | **linear** — one term query per node |
| `scapegoats { nodes { name count } }` | 6 | 6 | flat — `count` is an indexed column |

Fixed cost before any resolver runs: `wp_options` autoload — <your bytes> bytes.

### Limits in force

| Limit | Value | Where |
|---|---|---|
| Nodes per connection | 50 | `graphql_connection_max_query_amount` |
| Query depth | 10, for callers without `manage_options` | `QueryDepth` validation rule |
| Query complexity | 500 | `QueryComplexity` validation rule |
| Public introspection | on in `local`, off elsewhere | code, keyed on `WP_ENVIRONMENT_TYPE` |
| `graphql_debug` | on in `local`, off elsewhere | same filter — `extensions.debug` is a disclosure channel |
| Persisted queries | Module 24, WPGraphQL Smart Cache | production only; the strongest control |

### Rules

- A resolver on a type is called once per node, and the client chooses the node count. A resolver
  may compute; it must not fetch.
- Term meta is primed by nothing. Any resolver reaching for `get_term_meta()` or an ACF term
  field needs `update_termmeta_cache()` for the batch first.
- A linear query shape is a review finding, not a performance opinion. Re-ask the question from
  the other side of the relationship before reaching for a cache.
- Every list in a saved operation passes an explicit `first`. `@graphql-eslint` fails the build
  otherwise.
```

---

## Verification

```bash
cd wordpress-headless

# 0. Re-define the harness in this shell
gqcount() {
  docker compose run --rm wpcli wp eval '
    define( "SAVEQUERIES", true );
    $wpdb = $GLOBALS["wpdb"];
    graphql( array( "query" => $argv[0] ) );
    printf( "queries=%d%s", count( $wpdb->queries ), PHP_EOL );' "$1"
}

# 1. No fatal from the new file
docker compose logs --tail=60 wordpress | grep -iE 'php (warning|fatal)' || echo clean
# Expected: clean

# 2. The node cap is in force, exactly
docker compose run --rm wpcli wp eval \
  'echo (int) apply_filters( "graphql_connection_max_query_amount", 100, null, array(), null, null ), PHP_EOL;'
# Expected: 50

# 3. The priming filter is hooked
docker compose run --rm wpcli wp eval \
  'echo has_filter( "graphql_connection_ids", "Blame\\Core\\prime_connection_caches" ) ? "hooked" : "MISSING", PHP_EOL;'
# Expected: hooked

# 4. blameScore is O(1) in N — the shape, not the number, is the result
gqcount '{ incidents(first: 5)  { nodes { title blameScore } } }'
gqcount '{ incidents(first: 40) { nodes { title blameScore } } }'
# Expected: two numbers within a few of each other. Eight times the nodes,
#           about the same query count. Run each twice and use the second.

# 5. ...and the per-node taxonomy walk is O(N), which is the honest result
gqcount '{ incidents(first: 5)  { nodes { scapegoats(first: 1) { nodes { name } } } } }'
gqcount '{ incidents(first: 40) { nodes { scapegoats(first: 1) { nodes { name } } } } }'
# Expected: the second number is roughly 35 higher. One term query per extra node.

# 6. The same question from the taxonomy side is constant
gqcount '{ scapegoats(first: 10) { nodes { name count } } }'
# Expected: single digits. This is Key Concept 4, measured.

# 7. NEGATIVE: a query nested past the depth limit is REJECTED, anonymously
curl -s -o /tmp/deep.json -w 'HTTP %{http_code}\n' -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1){ nodes{ author{ node{ posts(first:1){ nodes{ author{ node{ posts(first:1){ nodes{ author{ node{ posts(first:1){ nodes{ author{ node{ posts(first:1){ nodes{ id } } } } } } } } } } } } } } } } } } }"}'
# Expected: HTTP 200 — a refusal, delivered with a 200, as always
jq -r '.errors[0].message' /tmp/deep.json
# Expected: a message about query depth naming the limit 10.
#           If instead you get data back, the rule is not wired — re-check Step 2.

# 8. ...and a shallow query from the same anonymous caller still works
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:2){ nodes{ title blameScore } } }"}' \
  | jq -r 'if .errors then "UNEXPECTED ERROR: " + .errors[0].message else "ok" end'
# Expected: ok — the limit rejects abuse, not the application

# 9. Introspection is ON here because this is a local environment
docker compose run --rm wpcli wp eval 'echo wp_get_environment_type(), PHP_EOL;'
# Expected: local   (set by WP_ENVIRONMENT_TYPE — appendix 04 §2)
docker compose run --rm wpcli wp eval \
  'echo get_graphql_setting( "public_introspection_enabled", "off" ), PHP_EOL;'
# Expected: on — from the CODE filter, not the option row

# 10. NEGATIVE: the same code returns "off" for any other environment.
#     Proven by calling the filter directly rather than restarting the stack.
docker compose run --rm wpcli wp eval '
  add_filter( "graphql_get_setting_section_field_value", function ( $v, $d, $name ) {
    return "public_introspection_enabled" === $name ? "off" : $v;
  }, 99, 3 );
  echo get_graphql_setting( "public_introspection_enabled", "off" ), PHP_EOL;'
# Expected: off — the value is decided by a filter chain, so a production
#           environment type turns it off without touching the database

# 10b. graphql_debug follows the same rule, from the same filter
docker compose run --rm wpcli wp eval \
  'echo get_graphql_setting( "debug_mode_enabled", "off" ) ?: "off", PHP_EOL;'
# Expected: whatever you have set locally — and provably "off" for any other
#           environment type, by the same mechanism as check 10

# 11. The dev-only query counter is writing to the debug log
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"query BudgetProbe { incidents(first:3){ nodes{ title blameScore } } }"}' >/dev/null
docker compose exec wordpress tail -n 5 /var/www/html/wp-content/debug.log | grep 'btt-graphql'
# Expected: a line like [btt-graphql] operation=BudgetProbe queries=NN

# 12. The fixed per-request cost, from Lesson 02.3
docker compose run --rm wpcli wp db query \
  "SELECT SUM(LENGTH(option_value)) AS autoload_bytes FROM wp_options WHERE autoload IN ('yes','on');"
# Expected: comfortably under 800000. Every GraphQL request pays it.

# 13. SAVEQUERIES is not defined for normal requests — it must never be
docker compose exec wordpress php -r 'echo defined("SAVEQUERIES") ? "DEFINED — remove it" : "not defined", PHP_EOL;'
# Expected: not defined

# 14. The budget is recorded, so the next person inherits numbers and not folklore
grep -c '^## 8. Query budget and limits' ../docs/api-contract.md
# Expected: 1
```

Checks 4, 5 and 6 together are the lesson. One field is flat, one shape is linear, and the fix
for the linear one was a modelling decision made three modules ago — not a cache.

## Control Questions

1. `blameScore` costs no extra queries at `first: 40`, and `get_term_meta()` inside the same
   resolver would cost forty. Explain the difference in terms of what a post query primes, and
   name the one function that would make the term-meta version flat.
2. `load_deferred()` returns a promise rather than a post. Walk through what would happen to the
   batching if a resolver called `->load( $id )` instead, and say how many queries a 40-node
   connection would then cost.
3. A depth limit of 10 is applied only to callers without `manage_options`. Give the concrete
   thing that breaks if you apply it to everybody, say why that thing is deeper than any
   application query, and name what an attacker gains from the exemption.
4. The per-node `scapegoats(first: 1)` query stayed linear even after you added cache priming.
   Explain why the priming does not help, and describe the two different fixes available —
   one at the query level and one at the resolver level.
5. Persisted queries are described as the strongest available control, yet this project also
   sets depth and complexity limits. Give the argument for keeping all three once the allowlist
   is in place, and the one failure mode the allowlist does **not** cover.

## Learn More

- [graphql-php — Solving the N+1 problem](https://webonyx.github.io/graphql-php/data-fetching/#solving-n1-problem) —
  the deferred model in the library WPGraphQL runs on; short, and it is the mechanism
- [WPGraphQL — Performance](https://www.wpgraphql.com/docs/performance/) — the project's own
  guidance on loaders, caching and connection limits
- [`_prime_post_caches()`](https://developer.wordpress.org/reference/functions/_prime_post_caches/) —
  read the source; the three arguments are exactly the three caches in Key Concept 2
- [`update_termmeta_cache()`](https://developer.wordpress.org/reference/functions/update_termmeta_cache/) —
  the one line that removes the ACF-term-field N+1
- [WordPress `SAVEQUERIES`](https://developer.wordpress.org/advanced-administration/debug/debug-wordpress/#savequeries) —
  what it stores, and the warning about production that this lesson repeats
- [Query Monitor](https://querymonitor.com/) — the plugin version of Step 1's harness; it has a
  dedicated panel for duplicate queries, which is the N+1 detector
- [WPGraphQL Smart Cache](https://github.com/wp-graphql/wp-graphql-smart-cache) — persisted
  queries and network cache; read the persisted-queries section before Module 24
- [OWASP — GraphQL Cheat Sheet: DoS](https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html#dos-prevention) —
  depth, amount and complexity limits argued as a security control rather than a tuning knob
- [Apollo — Demand control](https://www.apollographql.com/docs/graphos/routing/security/demand-control) —
  how a mature GraphQL platform weights fields, and why an unweighted complexity limit is blunt
