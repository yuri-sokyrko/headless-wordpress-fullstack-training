---
title: 'Extending the Schema in PHP'
module: 6
lesson: 1
teaches: [register-graphql-field, register-graphql-enum, computed-fields, resolver-caching, enum-value-mapping, connection-where-args]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/enums.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/fields.php']
requires: [5.4]
---

# Lesson 06.1 — Extending the Schema in PHP

## Quick Overview

So far the schema has been whatever WPGraphQL derived from your registrations. Now you start
designing it. `register_graphql_field` adds a field to an existing type with a resolver you
write; `register_graphql_enum_type` adds a real enum; `register_graphql_object_type` adds a
whole type when a field needs structure. You use the first two. `blameScore` becomes a `Float`
on `Incident`, computed from the severity term's weight multiplied by `blameConfidence` and
`downtimeMinutes` — a value that exists nowhere in the database and is derived on read, which is
precisely what a computed field is for.

The four enums from
[appendix 03 §3](../appendix/03-content-model-reference.md#3-registered-graphql-enums) are the
other half, and they matter more than they look. Right now `environment` arrives as a bare
`String`, so codegen in Module 10 will type it as `string` and every consumer gets no help at
all: no autocomplete, no exhaustiveness checking, no compile error when someone writes
`"prodution"`. Register `IncidentEnvironment` with four values and the same field becomes a
union type in TypeScript, and the switch statement that renders an environment badge can be
checked for completeness by the compiler. The resolver does the case mapping — GraphQL enum
values are `SCREAMING_SNAKE_CASE` by convention, the underlying ACF select values are
`kebab-case`, and the translation lives in exactly one place rather than being scattered across
the front end.

By the end of this lesson you will have:

- `includes/graphql/enums.php` registering `IncidentEnvironment`, `IncidentResolutionStatus`,
  `TechReviewVerdict` and `LeadSource` with the exact values from §3
- ACF select fields resolving through those enums, with `kebab-case` mapped to
  `SCREAMING_SNAKE_CASE` in the resolver
- `includes/graphql/fields.php` registering `blameScore` on `Incident` with a documented formula
- A `description` on every registered field and enum value, visible in the GraphiQL docs pane
- A resolver that caches its per-request work rather than recomputing per field access
- `severityIn: [String]` on the `incidents` connection's where-args input — one narrow,
  allowlisted taxonomy filter, registered because two documents need it and no generic
  `taxQuery` exists
- A `blameScore` sanity check: the S1 incidents score highest, the S4 cosmetic ones lowest

## Classic WP Analogy

`register_graphql_field` is `register_rest_field`, and if you have ever added a computed value to
a REST response you have written this function under a different name. It is also the same shape
as a `get_the_excerpt`-style filter, or an `acf/load_value` hook, or any of the dozens of places
where WordPress lets you say "when someone asks for X, run my callback". The resolver receives
the source object — the `$post` in a wrapper — and returns a value. Nothing about it is
conceptually new to a developer who has written a filter.

The enum concept has no direct WordPress equivalent, but it has an exact WordPress *problem*.
Think of every place you have stored a status or a type as a string in post meta and then
defended it: an admin `<select>` with hard-coded `<option>` values, a `switch` in a template
with a `default` that outputs nothing, a sanitise callback with an `in_array()` allowlist, and a
constant or two so the string is spelled once. An enum is all of that, declared once, enforced by
the API layer, and — this is the part with no Classic equivalent — *propagated to the consumer's
type system*. Your `in_array()` allowlist protects your PHP; an enum protects code in another
language on another machine.

**Where the analogy breaks down:** a REST field or a filter callback runs once per request, for
one object, and if it is slow you notice on that page and cache it. A GraphQL resolver runs
**once per node**, and a client you do not control decides how many nodes to ask for. A
`blameScore` resolver that calls `get_the_terms()` costs one extra query for a single incident
and forty for a list, and the client can legitimately ask for two hundred. The resolver is not
"a function on a page" any more; it is a function whose invocation count is chosen by someone
else. That reframing is what Lesson 06.4 is entirely about, and it is why this lesson insists on
caching the severity weight lookup even though the code looks fast.

---

## Key Concepts

### 1. Four registration functions, and which one a problem calls for

WPGraphQL exposes the whole type registry as plain PHP functions. Four of them cover everything
this course does, and choosing between them is almost always obvious once you can name what you
are adding.

| Function | Adds | Reach for it when |
|---|---|---|
| `register_graphql_field( $type, $name, $config )` | one field on an existing type | You have a value that can be derived from a node — `blameScore` |
| `register_graphql_enum_type( $name, $config )` | a new enum | A field's values are a closed, known set — all four in appendix 03 §3 |
| `register_graphql_object_type( $name, $config )` | a new object type | A field needs **structure**, not a scalar — `BlameScoreBreakdown` |
| `register_graphql_connection( $config )` | a paginated list between two types | You are exposing a *list* that needs cursors, `first`/`after` and a `pageInfo` |

All four are called from the `graphql_register_types` action, which fires after WPGraphQL has
registered everything it derives from your post types, taxonomies and ACF groups — so your
registrations see a complete schema and can react to it.

```
plugins_loaded ──▶ init ──▶ … ──▶ a POST arrives at /graphql
                                        │
                                        ▼
                          WPGraphQL builds the TypeRegistry
                            · core types (Post, Page, User…)
                            · types derived from your CPTs
                            · types from WPGraphQL for ACF
                                        │
                                        ▼
                        do_action( 'graphql_register_types' )   ◀── YOU
                            · register_graphql_enum_type()
                            · register_graphql_object_type()
                            · register_graphql_field()
                            · deregister_graphql_field()
                                        │
                                        ▼
                              parse → validate → execute
```

**The verdict on `register_graphql_connection`: this project does not need one, and that is
worth saying out loud.** The obvious candidate is a blame leaderboard — "the incidents that
blame this scapegoat" — and WPGraphQL already gives you it for free, because `scapegoat` is a
registered taxonomy and taxonomy-to-content connections are generated. The cheatsheet's
leaderboard query in [appendix 05 §9](../appendix/05-graphql-cheatsheet.md#9-query-patterns-this-app-actually-uses)
reads `count` straight off `wp_term_taxonomy`. Registering a hand-written connection would give
you a second way to ask the same question, with your own pagination bugs. The shape, for when
you do need it:

```php
// Illustrative only — this project registers no custom connection.
register_graphql_connection(
	array(
		'fromType'      => 'Scapegoat',
		'toType'        => 'Incident',
		'fromFieldName' => 'topIncidents',
		'resolve'       => static fn( $source, $args, $context, $info ) => null,
	)
);
```

The cost of a custom connection, stated plainly: you now own cursor stability, `pageInfo`
correctness and the interaction with `graphql_connection_max_query_amount` from Lesson 06.4.
Taxonomy connections already got all three right.

### 2. The resolver signature, and what each of the four arguments actually holds

Every resolver in WPGraphQL — yours and WPGraphQL's own — has the same signature. It comes from
graphql-php, not from WordPress, and learning what is in each slot is most of what separates a
resolver you can reason about from one you copy-paste.

```php
// Illustrative — the shape every `resolve` callback in this module has.
static function ( $source, array $args, AppContext $context, ResolveInfo $info ) {
	// …
}
```

| Argument | Holds | On `Incident.blameScore` that means |
|---|---|---|
| `$source` | **the parent field's already-resolved value** | a `WPGraphQL\Model\Post` for this one incident — `$source->databaseId` is the post ID |
| `$args` | the arguments passed to **this** field | `array()`, because `blameScore` takes none |
| `$context` | the per-request `AppContext` — **this is where the loaders live** | `$context->get_loader( 'post' )`, `$context->get_loader( 'term' )` |
| `$info` | the `ResolveInfo` for this field: its name, its path, the selection set below it, the parsed query | `$info->fieldName === 'blameScore'`; `$info->path` is `['incidents','nodes',7,'blameScore']` |

`$source` is the argument people get wrong, because it is not "the post" — it is *whatever the
field above resolved to*. On a field registered on `Incident` it is a post model. On a field
registered on `BlameScoreBreakdown` it is the array your `blameScoreBreakdown` resolver
returned. On the root query it is `null`. So when a resolver mysteriously receives an array where
you expected an object, the answer is always "look at what the parent field returns".

> **`$context` is not decoration.** It is the only argument that is shared across every resolver
> in the request, which makes it the only correct place to put anything that should happen once
> per request rather than once per node. Lesson 06.4 uses exactly that property:
> `$context->get_loader( 'post' )->load_deferred( $id )` returns a promise, WPGraphQL collects
> every deferred ID in the resolution pass, and one query satisfies all of them.

`$info` is the argument you will use least and should know exists, because it is how a resolver
can see what is being asked *below* it. A resolver that returns a heavy object only when the
client selected an expensive sub-field reads `$info->getFieldSelection()`. That is a real
optimisation and also a real way to write a resolver nobody can predict, so this course uses it
nowhere and mentions it once.

### 3. Why you register a real enum instead of returning the string

Right now `incidentDetails { environment }` is a `String`, because that is what ACF stores and
WPGraphQL for ACF has no way to know the value set is closed. Everything downstream inherits
that shrug.

```
WITHOUT an enum                              WITH IncidentEnvironment
──────────────────────────────────────       ──────────────────────────────────────
schema:   environment: String                schema:   environment: IncidentEnvironment
codegen:  environment: string                codegen:  environment:
                                                         | 'PRODUCTION'
                                                         | 'STAGING'
                                                         | 'DEVELOPMENT'
                                                         | 'WORKS_ON_MY_MACHINE'

switch (env) {                               switch (env) {
  case 'production':   …                       case 'PRODUCTION':  …
  case 'prodution':    …  ← ships              case 'PRODUCTION':  …  ← compile error
  default: return null   ← silent hole         }  ← exhaustive; adding a value
}                                                 breaks the build, on purpose
```

Four things you get, and only the first is about PHP:

| Gained | Where it shows up |
|---|---|
| The API rejects an illegal value before a resolver runs | `environment: PRODUCTIN` is a **validation** error, not your problem |
| Codegen emits a TypeScript union, not `string` | Module 10 — `IncidentEnvironment` becomes four string literals |
| Exhaustiveness checking in the consumer | Module 11's badge component: a `switch` with no `default` that the compiler proves complete |
| Self-documenting schema | GraphiQL lists the four values with descriptions; nobody has to grep PHP for the allowlist |

The third row is the one that pays for the work. A `switch` over a `string` needs a `default`
branch, and a `default` branch is a place where a value you forgot renders as nothing. A `switch`
over a union with no `default` is a compile error the day someone adds `IN_A_DATACENTER_FIRE` to
the enum — the front end refuses to build until a human decides what that badge looks like. You
cannot buy that with an `in_array()` allowlist in PHP, because your allowlist protects your PHP
and the bug is in someone else's TypeScript.

> **This is the single highest-leverage twenty lines in the module.** Four enums, sixteen values,
> and the entire front end stops handling strings it was never going to receive.

### 4. `SCREAMING_SNAKE_CASE` and `kebab-case`, and who actually maps between them

GraphQL enum values are `SCREAMING_SNAKE_CASE` by convention. The ACF select values in
[appendix 03 §4.1](../appendix/03-content-model-reference.md#41-incident-details) are
`kebab-case`, because that is what a slug looks like in WordPress. Both facts are fixed, so
something has to translate.

The important thing — and the thing almost every first attempt gets backwards — is that **the
enum type does the mapping for you, in both directions, if you register it correctly.** An enum
value has a *name* (what appears in the schema and in queries) and an internal *value* (what PHP
sees and returns):

```php
// Illustrative — the shape of one enum value.
'WORKS_ON_MY_MACHINE' => array(
	'value'       => 'works-on-my-machine',   // ← what PHP hands over and receives
	'description' => 'Reproduces nowhere except the reporter’s laptop.',
),
```

Which produces this, and it is worth reading twice:

```
READING (a query result)                      WRITING (a mutation input)
─────────────────────────────────────         ─────────────────────────────────────
get_post_meta() → 'works-on-my-machine'       client sends WORKS_ON_MY_MACHINE
        │                                             │
   your resolver RETURNS the                      graphql-php parses the literal
   kebab value, unchanged                             │
        │                                             ▼
   graphql-php serialises it to             $input['environment'] is ALREADY
   WORKS_ON_MY_MACHINE                      'works-on-my-machine' in PHP
        │                                             │
        ▼                                             ▼
   client sees the enum name                 wp_insert_post / update_post_meta
                                             stores the kebab value
```

So a resolver that carefully upper-cases and underscores its return value is not just extra work
— it is **broken**. Return `'PRODUCTION'` and serialisation fails with `Expected a value of type
"IncidentEnvironment" but received: PRODUCTION`, because no registered value has that internal
value. Return `'production'` and the client sees `PRODUCTION`. The type system is the mapper.

What is genuinely left for your code is narrower and more interesting:

| Job | Direction | Why the type system cannot do it |
|---|---|---|
| Decide what an **unknown** stored value means | read | `wp_postmeta` predates the enum. A row holding `prod` or `''` is not a legal internal value, and serialising it throws. Your resolver must return `null` instead. |
| Decide what a **missing** value means | read | An incident with no `environment` row: `null`, not a guessed default. |
| Re-assert the allowlist on write | write | The enum guarantees the *mutation* input. Nothing guarantees a value written by wp-admin, WP-CLI or the seeder. |
| Name-to-value translation outside GraphQL | both | `wp_btt_leads.source` stores `hobt-hero`; a CSV export or an admin column that wants to print `HOBT_HERO` needs the reverse map, and that map should exist once |

That last row is why `enums.php` exports two small helpers alongside the registration —
`normalize_stored_value()` for reads and `stored_to_enum_name()` for the boundaries that are not
GraphQL. One array is the single source of truth for the schema, the sanitiser and the reverse
map.

> **Return `null`, never a guess.** A resolver that maps an unrecognised `environment` to
> `PRODUCTION` because production is the common case has invented data. `null` renders as "not
> recorded" and is honest; a wrong badge is a lie the front end will happily repeat for years.

### 5. Retyping a field that already exists

The contract puts `environment` and `resolutionStatus` **inside** `incidentDetails`, where
WPGraphQL for ACF has already registered them as `String`. You cannot register a field twice, so
retyping is two calls: remove, then add.

```php
// Illustrative — the pattern, in full, in the Task.
deregister_graphql_field( 'IncidentDetails', 'environment' );
register_graphql_field( 'IncidentDetails', 'environment', array( 'type' => 'IncidentEnvironment', /* … */ ) );
```

`deregister_graphql_field()` is a first-class WPGraphQL function and this is a legitimate use of
it — the same technique Lesson 06.2 uses to replace the generated `createIncident` mutation. It
comes with two costs and you should know both before you type it:

| Cost | Detail |
|---|---|
| You now own the resolver | ACF's resolver handled `return_format`, translation and the field's default. Yours reads meta directly, so anything ACF did for you, you do or lose. |
| The type name is not yours | `IncidentDetails` is generated by WPGraphQL for ACF from `graphql_field_name`. A major version of that plugin could rename it, and your `deregister` would then silently target nothing. |

The second cost is why the Task has you **introspect the real type name** rather than trusting
this page, and why the resolver reads its post ID through a helper that copes with three
different `$source` shapes. Defensive code in a resolver is not paranoia when the type you are
extending is generated by someone else's plugin.

### 6. `blameScore`: a computed field with a formula you can point at

`blameScore` exists nowhere in the database. It is derived on read from three inputs, which is
the textbook case for a computed field —
[appendix 03 §7](../appendix/03-content-model-reference.md#7-custom-graphql-fields-and-mutations)
fixes the definition as severity weight × `blameConfidence` × `downtimeMinutes`.

| Input | Source | Notes |
|---|---|---|
| severity weight | the `severity` term on the incident | `s1-catastrophic` → `1.0`, `s2-major` → `0.6`, `s3-minor` → `0.3`, `s4-cosmetic` → `0.1` |
| `blame_confidence` | post meta, 0–100 | divided by 100, so it acts as a multiplier |
| `downtime_minutes` | post meta, 0–100000 | the only unbounded-ish term, which is why S4 incidents can still out-score S1 ones |

```
             ┌──────────────┐
severity ───▶│ weight 0–1   │───┐
             └──────────────┘   │
             ┌──────────────┐   ├──▶  ×  ──▶  round(…, 2)  ──▶  blameScore: Float
confidence ─▶│ /100 → 0–1   │───┤
             └──────────────┘   │
             ┌──────────────┐   │
downtime ───▶│ minutes      │───┘
             └──────────────┘

no severity term  ──▶  null        (not 0.0 — see below)
```

**`blameScore` is nullable, deliberately.** An incident with no `severity` term has no weight, and
the honest answer is "cannot be computed". Returning `0.0` would put it at the bottom of a sorted
list as though it were the least serious thing that ever happened, which is a different claim
entirely. Lesson 06.3 revisits this as a nullability decision with a written reason; for now the
rule is that a computed field returns `null` when its inputs are missing and never a placeholder.

The structured companion, `blameScoreBreakdown`, exists so the front end can explain the number
instead of just printing it — and so this lesson has a reason to call
`register_graphql_object_type`. Its resolver returns a plain PHP array, and each field of
`BlameScoreBreakdown` reads one key out of that array. That is `$source` from §2, made concrete:
the parent resolved to an array, so the children receive an array.

### 7. A field on a type is resolved once per node — and that is where 06.4 comes from

This is the sentence to carry out of the lesson.

```
query { incidents(first: 40) { nodes { title blameScore } } }

          incidents          ← ONE resolver call
             │
             ├─ nodes[0]  ──▶ blameScore resolver   call 1
             ├─ nodes[1]  ──▶ blameScore resolver   call 2
             │      ⋮
             └─ nodes[39] ──▶ blameScore resolver   call 40
```

Forty calls. If each one runs a query, that is forty queries a `WP_Query` did not need, for a
field that looks free in the schema. And the count is not yours to choose — a front-end developer
writes `first: 40`, or `first: 200`, in a query you may never read.

So a computed-field resolver has one rule: **it may compute, and it must not fetch.** In practice
that means it reads only from things WordPress has already loaded for the batch:

| Call | Cost inside a connection | Why |
|---|---|---|
| `get_post_meta( $id, 'downtime_minutes', true )` | cached | the post loader primes the meta cache for the whole batch |
| `get_the_terms( $id, 'severity' )` | cached | the same query primes the object term cache |
| `get_term_meta( $term_id, 'tagline', true )` | ⚠️ **one query per node** | term meta is not primed by a post query — Lesson 06.4's demonstration |
| `get_field( 'downtime_minutes', $id )` | ⚠️ ACF's own load path, per node | Lesson 06.4 measures it |
| `new WP_Query( … )` in a resolver | ❌ never | one full query per node |

Both resolvers in this lesson also memoize into a `static` array keyed by post ID, because a
client can legitimately select `blameScore` *and* `blameScoreBreakdown` on the same node and
there is no reason to compute the same three multiplications twice. That memo lives for one PHP
request, which is exactly the right lifetime — no invalidation to get wrong.

> **Do not take this on trust.** Lesson 06.4 turns the query log on and counts, because "this
> looks cheap" is how every N+1 in production got there. The last check in this lesson's
> Verification block is a first, crude count so you have a number before you have an opinion.

### 8. A field without a `description` is a field someone will misuse

Every `register_graphql_*` config in this module carries a `description`, and every enum value
carries one too. This is not documentation politeness — it is the only place the meaning travels
with the field.

| Reader | Sees the description |
|---|---|
| Anyone in GraphiQL | in the Docs pane, next to the field |
| `wordpress-headless/schema.graphql` | as an SDL doc-string, in the diff, in code review (Lesson 06.3) |
| A TypeScript developer in Module 10 | as a JSDoc comment on the generated type, on hover |

`blameScore` without a description is a `Float` called "blame score", and the first person to use
it will guess it is a percentage. With one sentence naming the formula and the `null` case, it is
a field they can use correctly on the first try.

### 9. `severityIn`: one narrow argument, and why not three

Lesson 05.2 §6 established that core WPGraphQL ships taxonomy `where` arguments for `category`
and `post_tag` and nothing else, and that the generic `taxQuery` extension is not installed here,
because a query builder on a public endpoint lets an anonymous caller assemble joins nobody
reviewed. That leaves a real hole. Two committed documents need to narrow the **root**
`incidents` connection by severity — `HomepageFeeds` in Lesson 10.5 wants one slug,
`IncidentTicker` in Lesson 14.4 wants a list — and traversal from the term, which serves
`/scapegoats/[slug]` perfectly, cannot express "either of these two severities" as one
connection.

So you register the **filter** and not the **builder**. That distinction is the whole concept.

| | A generic `taxQuery` | `severityIn: [String]` |
|---|---|---|
| Taxonomies reachable | every registered one | `severity` |
| Values reachable | any string the caller sends | four slugs, intersected server-side |
| Operators reachable | `IN`, `NOT IN`, `AND`, `EXISTS`, nesting, `relation` | `IN` |
| Query plans a reviewer has seen | none of them | the only one it can produce |

**One argument, not three.** 05.2 §6's table named `severitySlug`, `scapegoatSlug` and
`techStackSlug` together, and only the first has a caller. `/incidents` narrows by scapegoat and
tech stack **in the client**, in Lesson 09.2's `IncidentBrowser`, and every single-facet page
traverses from the term instead. A `scapegoatIn` would therefore be schema surface with no
consumer — something to document, version, deprecate and answer questions about, for nothing.
Register the argument a document actually sends, and add the second one on the day a second
document needs it.

**The name of the type is not yours.** WPGraphQL composes a connection's where-args input as
`<fromType>To<ToType>Connection` plus `WhereArgs`, so the root `incidents` connection carries
`RootQueryToIncidentConnectionWhereArgs`. Step 7 introspects it rather than trusting this page,
for the same reason Step 4 introspected `IncidentDetails`: a generated name belongs to whoever
generates it.

**The filter intersects; it never trusts.** `severity` is a closed term set — four slugs,
appendix 03 §2, term UI locked to radio buttons — so the incoming list is intersected with those
four and everything else is discarded before any query is built. That intersection is the
"allowlisted" in "narrow, allowlisted argument", and it is exactly what a builder cannot have,
because accepting values nobody enumerated is what a builder is *for*.

```
where: { severityIn: ["s2-major", "s9-apocalyptic", "anything at all"] }
         │
         ▼   array_intersect() with the four known slugs
   ["s2-major"]  ──▶  tax_query … 'IN' ('s2-major')  ──▶  the S2 incidents

where: { severityIn: ["s9-apocalyptic"] }
         │
         ▼
   []            ──▶  tax_query … 'IN' ()            ──▶  ZERO rows
                                                           — never "all rows"
```

Read the second branch twice, because it is the failure mode that would actually ship. An unknown
slug has to narrow to **nothing**; the one thing it must never do is widen to everything.
Dropping the clause when the allowlist empties the list would turn one typo in a block attribute
into "the ticker shows every incident on the site", and nobody would ever file that bug.
WordPress gets this right for you: `WP_Tax_Query` compiles an `IN` clause with an empty `terms`
array to `0 = 1` rather than to no clause at all — `wp-includes/class-wp-tax-query.php`,
`get_sql_for_clause()`. Pass the empty array straight through and let it.

An **absent** argument is a different thing again and must stay different: no `severityIn` key
means no clause, which means no filter. "Filter by nothing" and "no filter" are two answers, and
Verification check 11 is the one that proves they did not collapse into one.

---

## Task

### Step 1: Make the directory the whole module lives in

```bash
cd wordpress-headless/wp-content/plugins/blame-the-tech-core
mkdir -p includes/graphql
ls includes/
```

Every file in Lessons 06.1, 06.2 and 06.4 lands in `includes/graphql/`. The expected tree in
`wordpress-headless/README.md` lists the directory, not each file.

### Step 2: Register the four enums

One array is the source of truth for the schema, the sanitiser and the reverse map. Change a
value in one place or it drifts in three.

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/enums.php
/**
 * Registered GraphQL enums.
 *
 * The authoritative value list is appendix 03 §3. The GraphQL NAME is
 * SCREAMING_SNAKE_CASE; the `value` is what is stored in wp_postmeta and in
 * wp_btt_leads.source. graphql-php maps between them in both directions — see
 * Lesson 06.1 §4 before "helpfully" upper-casing anything in a resolver.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

/**
 * enum type name => config accepted verbatim by register_graphql_enum_type().
 *
 * @var array<string, array{description: string, values: array<string, array{value: string, description: string}>}>
 */
const GRAPHQL_ENUMS = array(
	'IncidentEnvironment'      => array(
		'description' => 'Where an incident happened. Stored as a kebab-case ACF select value; exposed as an enum so consumers get a union type rather than a string.',
		'values'      => array(
			'PRODUCTION'          => array(
				'value'       => 'production',
				'description' => 'Real users, real money, real pager.',
			),
			'STAGING'             => array(
				'value'       => 'staging',
				'description' => 'The environment that is definitely identical to production.',
			),
			'DEVELOPMENT'         => array(
				'value'       => 'development',
				'description' => 'A shared development environment.',
			),
			'WORKS_ON_MY_MACHINE' => array(
				'value'       => 'works-on-my-machine',
				'description' => 'Reproduces nowhere except the reporter’s laptop.',
			),
		),
	),
	'IncidentResolutionStatus' => array(
		'description' => 'How far an incident has travelled from "it is broken" to "it is someone else’s fault".',
		'values'      => array(
			'OPEN'      => array(
				'value'       => 'open',
				'description' => 'Still on fire.',
			),
			'MITIGATED' => array(
				'value'       => 'mitigated',
				'description' => 'Symptoms suppressed, cause unknown.',
			),
			'BLAMED'    => array(
				'value'       => 'blamed',
				'description' => 'A scapegoat has been identified. This is the terminal success state.',
			),
			'WONTFIX'   => array(
				'value'       => 'wontfix',
				'description' => 'Accepted as a feature.',
			),
		),
	),
	'TechReviewVerdict'        => array(
		'description' => 'The tech-radar verdict on a company or tool.',
		'values'      => array(
			'ADOPT'  => array(
				'value'       => 'adopt',
				'description' => 'Use it.',
			),
			'TRIAL'  => array(
				'value'       => 'trial',
				'description' => 'Use it somewhere that can fail.',
			),
			'ASSESS' => array(
				'value'       => 'assess',
				'description' => 'Read about it; do not ship it.',
			),
			'HOLD'   => array(
				'value'       => 'hold',
				'description' => 'Stop starting new things with it.',
			),
		),
	),
	'LeadSource'               => array(
		'description' => 'Which HOBT surface produced a lead. Used as a mutation INPUT in Lesson 06.2 and stored in wp_btt_leads.source.',
		'values'      => array(
			'HOBT_HERO'        => array(
				'value'       => 'hobt-hero',
				'description' => 'The hero form on /hobt.',
			),
			'HOBT_CTA_BLOCK'   => array(
				'value'       => 'hobt-cta-block',
				'description' => 'The hobt-cta Gutenberg block, anywhere it appears.',
			),
			'HOBT_FOOTER'      => array(
				'value'       => 'hobt-footer',
				'description' => 'The site-wide footer form.',
			),
			'INCIDENT_SIDEBAR' => array(
				'value'       => 'incident-sidebar',
				'description' => 'The promo in the incident detail sidebar.',
			),
		),
	),
);

/**
 * Register every enum in GRAPHQL_ENUMS.
 *
 * `graphql_register_types` fires once per GraphQL request, after WPGraphQL has
 * built everything it derives from your registrations. An enum may be
 * registered before anything uses it — `LeadSource` has no field until
 * Lesson 06.2 — and that is fine.
 */
function register_graphql_enums(): void {
	foreach ( GRAPHQL_ENUMS as $type_name => $config ) {
		register_graphql_enum_type( $type_name, $config );
	}
}
add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_graphql_enums' );

/**
 * The stored (kebab-case) values of one enum.
 *
 * @return string[]
 */
function enum_stored_values( string $enum ): array {
	return array_column( GRAPHQL_ENUMS[ $enum ]['values'] ?? array(), 'value' );
}

/**
 * Normalise a raw stored value for RETURN FROM A RESOLVER.
 *
 * Returns the kebab-case value — NOT the SCREAMING_SNAKE name. graphql-php
 * serialises it to the name. Anything unrecognised becomes null rather than a
 * guess: wp_postmeta predates this enum, and serialising an illegal value
 * throws for the whole field.
 */
function normalize_stored_value( string $enum, mixed $raw ): ?string {
	$value = sanitize_key( (string) $raw );

	return in_array( $value, enum_stored_values( $enum ), true ) ? $value : null;
}

/**
 * Reverse map, for the boundaries that are NOT GraphQL — a CSV export, an
 * admin column, a log line. Inside GraphQL you never need this.
 */
function stored_to_enum_name( string $enum, mixed $raw ): ?string {
	$value = sanitize_key( (string) $raw );

	foreach ( GRAPHQL_ENUMS[ $enum ]['values'] ?? array() as $name => $spec ) {
		if ( $spec['value'] === $value ) {
			return $name;
		}
	}

	return null;
}
```

**Verify §2:**

- [ ] Sixteen values across four enums, and every name matches
      [appendix 03 §3](../appendix/03-content-model-reference.md#3-registered-graphql-enums)
      character for character. These names end up in TypeScript; a typo here is a typo in
      Module 11.
- [ ] Every `value` is the `kebab-case` string, and no `value` is upper case.
- [ ] `normalize_stored_value()` returns the **stored** value, not the enum name. If you wrote
      `strtoupper()` anywhere in this file, delete it and re-read §4.

### Step 3: Load the file and confirm the enums reached the schema

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	private const INCLUDES = array(
		'includes/post-types.php',                 // Lesson 03.2
		'includes/taxonomies.php',                 // Lesson 03.3
		'includes/statuses.php',                   // Lesson 03.4
		'includes/admin/incident-columns.php',     // Lesson 03.4
		'includes/roles.php',                      // Lesson 03.5
		'includes/acf.php',                        // Lesson 04.1
		'includes/graphql/enums.php',              // Lesson 06.1
	);
```

Introspection is how you are going to check every registration in this module, and WPGraphQL
blocks it for **unauthenticated** callers by default — so an anonymous `curl` asking for `__type`
gets an error rather than a type. Lesson 04.2 turned it on for local development already; `patch
insert` is the idempotent subcommand — `patch update` **errors** with `No data exists for key`
when the key is absent, measured — so confirm it rather than assuming it:

```bash
cd wordpress-headless
docker compose run --rm wpcli wp option patch insert graphql_general_settings public_introspection_enabled on
docker compose run --rm wpcli wp option pluck graphql_general_settings public_introspection_enabled
# Expected: on
```

> **This is a local-only convenience and it is a database row, which is the wrong place for a
> policy.** GraphiQL introspects as your logged-in administrator and never needed it; `curl` and
> `jq` do. Lesson 06.4 replaces this row with a code-owned filter that turns introspection on
> when `WP_ENVIRONMENT_TYPE` is `local` and off everywhere else — see
> [appendix 04 §6](../appendix/04-env-reference.md#6-the-honest-caveat-about-hiding-the-wordpress-origin).

Now read the enum back out of the schema:

```bash
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"IncidentEnvironment\"){ kind enumValues { name description } } }"}' | jq
```

**Verify §3:**

- [ ] `kind` is `ENUM` and four values come back with their descriptions.
- [ ] If the response is an `errors` array mentioning introspection, the option above did not
      take — re-run it and check the `pluck` output.
- [ ] If `__type` is `null`, the file is not loaded. Check `Plugin::INCLUDES` and
      `docker compose logs --tail=40 wordpress` for a `Failed opening required`.

### Step 4: Find out what the ACF field-group type is really called

The next step deregisters two fields on the type WPGraphQL for ACF generated from the
`Incident Details` group. Do not trust this page for that name — ask the schema.

```bash
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"Incident\"){ fields { name type { name } } } }"}' \
  | jq -r '.data.__type.fields[] | select(.name=="incidentDetails") | .type.name'
```

**Verify §4:**

- [ ] The output is a type name — `IncidentDetails` if you are on WPGraphQL for ACF v2.
- [ ] If it differs, note it. Step 5 puts it in a single constant, `ACF_INCIDENT_TYPE`, and that
      constant is the only place the name appears.

### Step 5: Register the enum-typed fields, `blameScore` and the breakdown type

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/fields.php
/**
 * Custom GraphQL fields on `Incident`.
 *
 * Two jobs:
 *   1. Retype the two ACF select fields so they are real enums (Lesson 06.1 §5).
 *   2. Register `blameScore` and `blameScoreBreakdown` (§6).
 *
 * Every resolver here MUST be computation only. A field on a type is resolved
 * once per node and the node count is chosen by the client — see §7 and
 * Lesson 06.4.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

use GraphQL\Type\Definition\ResolveInfo;
use WPGraphQL\AppContext;

defined( 'ABSPATH' ) || exit;

/**
 * The object type WPGraphQL for ACF generates from the `Incident Details`
 * field group. Confirmed by introspection in Task Step 4 — the ACF plugin owns
 * this name, so it lives in exactly one place.
 */
const ACF_INCIDENT_TYPE = 'IncidentDetails';

/** severity term slug => weight. The severity list is closed (appendix 03 §2). */
const SEVERITY_WEIGHTS = array(
	's1-catastrophic' => 1.0,
	's2-major'        => 0.6,
	's3-minor'        => 0.3,
	's4-cosmetic'     => 0.1,
);

/**
 * Resolve the post ID behind a `$source` that may be an ACF field-group
 * container, a WPGraphQL model, or a bare ID.
 *
 * WPGraphQL for ACF has passed all three across its major versions. Handling
 * every shape costs four lines and removes a whole class of upgrade breakage.
 */
function source_post_id( mixed $source ): int {
	if ( is_array( $source ) ) {
		$node = $source['node'] ?? null;

		if ( is_object( $node ) && isset( $node->databaseId ) ) {
			return (int) $node->databaseId;
		}

		return (int) ( $source['post_id'] ?? 0 );
	}

	if ( is_object( $source ) && isset( $source->databaseId ) ) {
		return (int) $source->databaseId;
	}

	return is_numeric( $source ) ? (int) $source : 0;
}

/**
 * The incident's severity term slug, or null.
 *
 * `get_the_terms()` reads the object term cache, which the connection's post
 * query primed for the whole batch — so this is not a query per node. The
 * static memo covers a client selecting both blameScore and
 * blameScoreBreakdown on the same node.
 *
 * @var array<int, string|null> $memo
 */
function incident_severity_slug( int $post_id ): ?string {
	static $memo = array();

	if ( array_key_exists( $post_id, $memo ) ) {
		return $memo[ $post_id ];
	}

	$terms = get_the_terms( $post_id, 'severity' );

	$memo[ $post_id ] = ( is_array( $terms ) && array() !== $terms ) ? (string) $terms[0]->slug : null;

	return $memo[ $post_id ];
}

/**
 * Compute the blame score and everything that went into it.
 *
 * Returns null when the score cannot be computed — an incident with no
 * severity term. Null means "not computable"; 0.0 would mean "harmless", and
 * those are different claims (Lesson 06.1 §6).
 *
 * @return array{score: float, severitySlug: string, severityWeight: float, blameConfidence: float, downtimeMinutes: float}|null
 */
function incident_blame_breakdown( int $post_id ): ?array {
	static $memo = array();

	if ( array_key_exists( $post_id, $memo ) ) {
		return $memo[ $post_id ];
	}

	$slug = incident_severity_slug( $post_id );

	if ( null === $slug || ! array_key_exists( $slug, SEVERITY_WEIGHTS ) ) {
		$memo[ $post_id ] = null;

		return null;
	}

	$weight     = (float) SEVERITY_WEIGHTS[ $slug ];
	$confidence = (float) get_post_meta( $post_id, 'blame_confidence', true );
	$downtime   = (float) get_post_meta( $post_id, 'downtime_minutes', true );

	$memo[ $post_id ] = array(
		'score'           => round( $weight * ( $confidence / 100 ) * $downtime, 2 ),
		'severitySlug'    => $slug,
		'severityWeight'  => $weight,
		'blameConfidence' => $confidence,
		'downtimeMinutes' => $downtime,
	);

	return $memo[ $post_id ];
}

/** Retype the two ACF select fields as real enums. */
function register_incident_enum_fields(): void {
	$fields = array(
		// GraphQL field name => [ enum type, wp_postmeta key ].
		'environment'      => array( 'IncidentEnvironment', 'environment' ),
		'resolutionStatus' => array( 'IncidentResolutionStatus', 'resolution_status' ),
	);

	foreach ( $fields as $field_name => list( $enum, $meta_key ) ) {
		// ACF registered this field as String. A field cannot be registered
		// twice, so retyping is remove-then-add. See Lesson 06.1 §5 for the
		// two costs this incurs.
		deregister_graphql_field( ACF_INCIDENT_TYPE, $field_name );

		register_graphql_field(
			ACF_INCIDENT_TYPE,
			$field_name,
			array(
				'type'        => $enum,
				'description' => sprintf(
					/* translators: %s: GraphQL enum type name. */
					__( 'Stored as a kebab-case value in post meta and exposed as %s. Null when unset or when the stored value is not a legal enum value.', 'blame-the-tech-core' ),
					$enum
				),
				'resolve'     => static function ( $source, array $args, AppContext $context, ResolveInfo $info ) use ( $enum, $meta_key ): ?string {
					$post_id = source_post_id( $source );

					if ( 0 === $post_id ) {
						return null;
					}

					// Return the STORED value. graphql-php serialises it to the
					// enum name. Upper-casing here would break the field.
					return normalize_stored_value( $enum, get_post_meta( $post_id, $meta_key, true ) );
				},
			)
		);
	}
}

/** `blameScore`, and the object type that explains it. */
function register_blame_score_fields(): void {
	register_graphql_object_type(
		'BlameScoreBreakdown',
		array(
			'description' => __( 'Every input to blameScore, so a client can explain the number instead of only printing it.', 'blame-the-tech-core' ),
			'fields'      => array(
				'score'           => array(
					'type'        => 'Float',
					'description' => __( 'severityWeight × (blameConfidence ÷ 100) × downtimeMinutes, rounded to 2 decimal places.', 'blame-the-tech-core' ),
					// $source here is the ARRAY returned by the parent
					// blameScoreBreakdown resolver — Lesson 06.1 §2.
					'resolve'     => static fn( $source ): ?float => isset( $source['score'] ) ? (float) $source['score'] : null,
				),
				'severitySlug'    => array(
					'type'        => 'String',
					'description' => __( 'The severity term slug the weight came from.', 'blame-the-tech-core' ),
					'resolve'     => static fn( $source ): ?string => isset( $source['severitySlug'] ) ? (string) $source['severitySlug'] : null,
				),
				'severityWeight'  => array(
					'type'        => 'Float',
					'description' => __( 'Weight for that severity: 1.0, 0.6, 0.3 or 0.1.', 'blame-the-tech-core' ),
					'resolve'     => static fn( $source ): ?float => isset( $source['severityWeight'] ) ? (float) $source['severityWeight'] : null,
				),
				'blameConfidence' => array(
					'type'        => 'Float',
					'description' => __( 'The reporter’s confidence, 0–100, exactly as stored.', 'blame-the-tech-core' ),
					'resolve'     => static fn( $source ): ?float => isset( $source['blameConfidence'] ) ? (float) $source['blameConfidence'] : null,
				),
				'downtimeMinutes' => array(
					'type'        => 'Float',
					'description' => __( 'Reported downtime in minutes, exactly as stored.', 'blame-the-tech-core' ),
					'resolve'     => static fn( $source ): ?float => isset( $source['downtimeMinutes'] ) ? (float) $source['downtimeMinutes'] : null,
				),
			),
		)
	);

	register_graphql_field(
		'Incident',
		'blameScore',
		array(
			'type'        => 'Float',
			'description' => __( 'Computed on read: severity weight × (blameConfidence ÷ 100) × downtimeMinutes. NULL — not 0 — when the incident has no severity term, because "not computable" and "harmless" are different claims.', 'blame-the-tech-core' ),
			'resolve'     => static function ( $source, array $args, AppContext $context, ResolveInfo $info ): ?float {
				$breakdown = incident_blame_breakdown( source_post_id( $source ) );

				return null === $breakdown ? null : (float) $breakdown['score'];
			},
		)
	);

	register_graphql_field(
		'Incident',
		'blameScoreBreakdown',
		array(
			'type'        => 'BlameScoreBreakdown',
			'description' => __( 'The inputs to blameScore. Null under exactly the same conditions as blameScore.', 'blame-the-tech-core' ),
			'resolve'     => static function ( $source, array $args, AppContext $context, ResolveInfo $info ): ?array {
				return incident_blame_breakdown( source_post_id( $source ) );
			},
		)
	);
}

add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_incident_enum_fields' );
add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_blame_score_fields' );
```

Add the file to the loader, after `enums.php` — the fields reference enum type names, so the
enums must be registered first:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
		'includes/graphql/enums.php',              // Lesson 06.1
		'includes/graphql/fields.php',             // Lesson 06.1
```

**Verify §5:**

- [ ] `docker compose logs --tail=40 wordpress` shows no PHP warning or fatal.
- [ ] All **three** hook registrations — two `add_action`, one `add_filter` — are at the
      **bottom** of the file, after the functions they name.
      Function declarations hoist, so this is style rather than necessity — but the file reads
      top-down and the hook list at the end is the summary.
- [ ] No resolver in the file calls `new WP_Query`, `get_field()`, or `get_term_meta()`. If one
      does, you have written Lesson 06.4's bug on purpose.

### Step 6: Read your own schema in GraphiQL

Open <http://localhost:8080/wp-admin/admin.php?page=graphiql-ide> and hard-reload the page — the
Docs pane caches the schema in the browser, and a field you just registered that "does not
exist" is almost always a stale pane rather than broken PHP.

```graphql
# GraphiQL probe — not saved to queries.graphql
query BlameScoreProbe {
  incidents(first: 5, where: { orderby: { field: DATE, order: DESC } }) {
    nodes {
      title
      blameScore
      blameScoreBreakdown {
        score
        severitySlug
        severityWeight
        blameConfidence
        downtimeMinutes
      }
      incidentDetails {
        environment
        resolutionStatus
      }
    }
  }
}
```

**Verify §6:**

- [ ] `environment` comes back as `PRODUCTION` / `STAGING` / `DEVELOPMENT` /
      `WORKS_ON_MY_MACHINE` — upper case, underscored. If it is still `production`, the
      `deregister_graphql_field` call did not match; re-run Step 4.
- [ ] The Docs pane shows your `description` text on `blameScore`.
- [ ] `severityWeight × blameConfidence ÷ 100 × downtimeMinutes` equals `score` for at least one
      node, checked with a calculator. A formula nobody has arithmetic-checked once is a formula
      with a typo in it.

### Step 7: Register the one connection argument the documents need

Key Concept 9 is the argument for this step: one narrow, allowlisted `where` argument, because
two committed documents filter the root `incidents` connection by severity and nothing in the
schema lets them. Ask the schema for the input type name before you type it — the name is
generated, not yours:

```bash
cd wordpress-headless
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"RootQuery\"){ fields{ name args{ name type{ name } } } } }"}' \
  | jq -r '.data.__type.fields[] | select(.name=="incidents") | .args[] | select(.name=="where") | .type.name'
# Expected: RootQueryToIncidentConnectionWhereArgs
```

Then append to `fields.php`. Nothing else moves: `SEVERITY_WEIGHTS` is already in this file and
its keys *are* the allowlist, and `Plugin::INCLUDES` already loads the file, so there is no new
file and no fourth edit to that array.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/fields.php — appended

/**
 * The where-args input type of the ROOT `incidents` connection.
 *
 * WPGraphQL composes it as <fromType>To<ucfirst(toType)>Connection . 'WhereArgs'
 * — WPConnectionType::register_connection_input(). Introspected in Step 7,
 * because the name is generated and a major version could change it.
 */
const INCIDENT_WHERE_ARGS = 'RootQueryToIncidentConnectionWhereArgs';

/**
 * ONE narrow, allowlisted taxonomy argument — not a generic taxQuery, and not
 * the three arguments Lesson 05.2 §6 sketched. `severityIn` has two callers,
 * HomepageFeeds and IncidentTicker; `scapegoatIn` would have none. See §9.
 */
function register_incident_where_args(): void {
	register_graphql_fields(
		INCIDENT_WHERE_ARGS,
		array(
			'severityIn' => array(
				'type'        => array( 'list_of' => 'String' ),
				'description' => __( 'Narrow to incidents carrying any of these severity term slugs. The severity taxonomy is a closed set, so a slug outside it is discarded server-side and narrows the result to nothing rather than widening it. There is deliberately no generic taxQuery — Lesson 05.2 §6.', 'blame-the-tech-core' ),
			),
		)
	);
}

/**
 * Translate `severityIn` into exactly one tax_query clause.
 *
 * The intersection with SEVERITY_WEIGHTS is the security property: no
 * caller-supplied string reaches WP_Query, only members of the closed term set.
 * When nothing survives, the clause is still added with an EMPTY term list,
 * which WP_Tax_Query compiles to `0 = 1` — "no matches", never "no filter".
 *
 * @param array<string,mixed> $query_args WP_Query args WPGraphQL has built.
 * @param mixed               $source     Unused — a root connection has none.
 * @param array<string,mixed> $args       This field's GraphQL args, incl. `where`.
 * @param mixed               $context    Unused.
 * @param mixed               $info       Unused.
 * @return array<string,mixed>
 */
function apply_severity_in( array $query_args, $source, array $args, $context, $info ): array {
	// Every post-object connection fires this filter. WPGraphQL normalises
	// post_type to an ARRAY before it gets here
	// (PostObjectConnectionResolver::__construct), so compare against a list.
	if ( ! in_array( 'incident', (array) ( $query_args['post_type'] ?? array() ), true ) ) {
		return $query_args;
	}

	$requested = $args['where']['severityIn'] ?? null;

	// Absent or null: add no clause at all. "No filter" and "a filter that
	// matches nothing" have to stay two different answers.
	if ( ! is_array( $requested ) ) {
		return $query_args;
	}

	$allowed = array_intersect(
		array_map( 'sanitize_title', array_filter( $requested, 'is_string' ) ),
		array_keys( SEVERITY_WEIGHTS )
	);

	$clauses   = ( isset( $query_args['tax_query'] ) && is_array( $query_args['tax_query'] ) ) ? $query_args['tax_query'] : array();
	$clauses[] = array(
		'taxonomy' => 'severity',
		'field'    => 'slug',
		'terms'    => array_values( $allowed ),
		'operator' => 'IN',
	);

	$query_args['tax_query'] = $clauses;

	return $query_args;
}

add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_incident_where_args' );
add_filter( 'graphql_post_object_connection_query_args', __NAMESPACE__ . '\\apply_severity_in', 10, 5 );
```

**Verify §7:**

- [ ] `__type(name: "RootQueryToIncidentConnectionWhereArgs")` lists `severityIn` as a `LIST` of
      `String`. If the type is `null`, the name is wrong — re-run the introspection above.
- [ ] `where: { severityIn: ["s1-catastrophic"] }` returns fewer nodes than the unfiltered
      connection **and** every node it returns carries that term. Fewer alone proves nothing.
- [ ] `where: { severityIn: ["s9-apocalyptic"] }` returns **zero** nodes and no error. If it
      returns every incident, your empty-list branch dropped the clause — re-read §9.
- [ ] Nothing was added to `Plugin::INCLUDES` and no new file was created.

---

## Verification

```bash
cd wordpress-headless

# 1. No PHP notices from the two new files
docker compose logs --tail=80 wordpress | grep -iE 'php (warning|notice|fatal)' || echo clean
# Expected: clean

# 2. All four enums are in the schema
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ a:__type(name:\"IncidentEnvironment\"){kind} b:__type(name:\"IncidentResolutionStatus\"){kind} c:__type(name:\"TechReviewVerdict\"){kind} d:__type(name:\"LeadSource\"){kind} }"}' \
  | jq -r '.data | to_entries[] | "\(.key)=\(.value.kind // "MISSING")"'
# Expected: a=ENUM b=ENUM c=ENUM d=ENUM  (four lines, none MISSING)

# 3. The values match appendix 03 §3 exactly
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"IncidentEnvironment\"){ enumValues { name } } }"}' \
  | jq -r '.data.__type.enumValues[].name' | sort | tr '\n' ' '
# Expected: DEVELOPMENT PRODUCTION STAGING WORKS_ON_MY_MACHINE

# 4. The ACF field is now enum-typed, not String
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"IncidentDetails\"){ fields { name type { name kind } } } }"}' \
  | jq -r '.data.__type.fields[] | select(.name=="environment" or .name=="resolutionStatus") | "\(.name): \(.type.name) \(.type.kind)"'
# Expected: environment: IncidentEnvironment ENUM
#           resolutionStatus: IncidentResolutionStatus ENUM

# 5. A read returns the ENUM NAME, not the stored kebab value
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:3){ nodes{ slug incidentDetails{ environment } } } }"}' \
  | jq -r '.data.incidents.nodes[] | "\(.slug) \(.incidentDetails.environment)"'
# Expected: three lines, each ending in an UPPER_CASE value.
#           A lower-case "production" here means the retype did not take effect.

# 6. NEGATIVE: an illegal enum value is rejected by VALIDATION, before any resolver runs.
#    `order` is a built-in enum whose only values are ASC and DESC.
curl -s -o /tmp/badenum.json -w 'HTTP %{http_code}\n' -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1, where:{ orderby:{ field: DATE, order: DESCENDING } }){ nodes{ slug } } }"}'
# Expected: HTTP 200 — refusal arrives with a 200, as always (Lesson 05.5 §3)

jq -r 'if .errors then "rejected: " + .errors[0].message else "ACCEPTED — unexpected" end' /tmp/badenum.json
# Expected: rejected: … a message naming DESCENDING as not a valid enum value.
#           Your resolver never ran. This is what an enum buys you at the boundary.

# 7. NEGATIVE, and the one that matters: an incident with NO severity term
#    scores null, not 0.0, and does not error.
ID=$(docker compose run --rm wpcli wp post create --post_type=incident \
  --post_title='Unweighable probe' --post_name=unweighable-probe \
  --post_status=publish --porcelain | tr -d '\r')
docker compose run --rm wpcli wp post meta update "$ID" blame_confidence 99
docker compose run --rm wpcli wp post meta update "$ID" downtime_minutes 500

curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"query($s:ID!){ incident(id:$s, idType:SLUG){ blameScore blameScoreBreakdown{ score } } }","variables":{"s":"unweighable-probe"}}' \
  | jq '{score: .data.incident.blameScore, breakdown: .data.incident.blameScoreBreakdown, errors: (.errors // "none")}'
# Expected: {"score": null, "breakdown": null, "errors": "none"}
#           null — NOT 0. And no error: a missing input is not an exception.

# 8. Give it a severity and the same query computes: 0.6 × 0.99 × 500 = 297
docker compose run --rm wpcli wp post term add "$ID" severity s2-major
docker compose run --rm wpcli wp cache flush
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"query($s:ID!){ incident(id:$s, idType:SLUG){ blameScore blameScoreBreakdown{ severityWeight blameConfidence downtimeMinutes } } }","variables":{"s":"unweighable-probe"}}' \
  | jq '.data.incident'
# Expected: blameScore 297, severityWeight 0.6, blameConfidence 99, downtimeMinutes 500

# 9. The registered argument narrows, and it narrows to the RIGHT rows.
#    S1 incidents also out-score S4 ones, which is a sanity check on the weights.
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ all: incidents(first:100, where:{status:PUBLISH}){ nodes{ slug } } hi: incidents(first:100, where:{status:PUBLISH, severityIn:[\"s1-catastrophic\"]}){ nodes{ blameScore severities{ nodes{ slug } } } } lo: incidents(first:100, where:{status:PUBLISH, severityIn:[\"s4-cosmetic\"]}){ nodes{ blameScore } } }"}' \
  | jq -c '{all: (.data.all.nodes|length), s1: (.data.hi.nodes|length),
            every_s1_node_really_is_s1: ([.data.hi.nodes[].severities.nodes[].slug]|unique),
            s1_max: ([.data.hi.nodes[].blameScore]|max), s4_max: ([.data.lo.nodes[].blameScore]|max)}'
# Expected: s1 is smaller than all; every_s1_node_really_is_s1 is exactly
#           ["s1-catastrophic"]; s1_max greater than s4_max.
#           The middle line is the one doing work — a filter that returned FEWER rows
#           has not proved it returned the RIGHT rows.

# 10. NEGATIVE — `taxQuery` is not in this schema and never will be. This is the
#     check that catches a document written against a plugin you did not install.
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1, where:{ taxQuery:{ relation: AND } }){ nodes{ slug } } }"}' \
  | jq -c '{data: .data, msg: .errors[0].message}'
# Expected: {"data":null,"msg":"Field \"taxQuery\" is not defined by type
#           \"RootQueryToIncidentConnectionWhereArgs\". Did you mean \"dateQuery\"?"}
#           `data` is null because this failed VALIDATION — no resolver ran, and the
#           message names the input type your one argument lives on.

# 11. NEGATIVE, and the one worth having — a slug outside the closed set returns
#     NOTHING, not EVERYTHING.
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ bogus: incidents(first:100, where:{severityIn:[\"s9-apocalyptic\"]}){ nodes{ slug } } mixed: incidents(first:100, where:{severityIn:[\"s9-apocalyptic\",\"s4-cosmetic\"]}){ nodes{ severities{ nodes{ slug } } } } }"}' \
  | jq -c '{bogus: (.data.bogus.nodes|length),
            mixed_slugs: ([.data.mixed.nodes[].severities.nodes[].slug]|unique),
            errors: (.errors // "none")}'
# Expected: {"bogus":0,"mixed_slugs":["s4-cosmetic"],"errors":"none"}
#           If `bogus` is 40 rather than 0, the allowlist emptied the term list and your
#           code dropped the clause, so "unknown severity" silently became "every
#           incident". A passing happy path cannot see that. This check can.

# 12. A first, crude query count for 40 nodes — the number Lesson 06.4 improves
docker compose run --rm wpcli wp eval '
  $before = $GLOBALS["wpdb"]->num_queries;
  graphql( array( "query" => "{ incidents(first:40){ nodes{ title blameScore } } }" ) );
  printf( "queries=%d%s", $GLOBALS["wpdb"]->num_queries - $before, PHP_EOL );'
# Expected: a two- or three-digit number. Write it down — Lesson 06.4 measures it properly
#           and cuts it. Do NOT conclude anything from one run.

# 13. Clean up the probe
docker compose run --rm wpcli wp post delete "$ID" --force
docker compose run --rm wpcli wp post list --post_type=incident --format=count
# Expected: the count you had before this lesson
```

Checks 5 and 7 are the pair to trust on the enums: 5 proves the enum is doing the mapping you did
not write, and 7 proves the field is honest about what it cannot compute. Checks 10 and 11 are the
pair to trust on the new argument, and 11 is the only one of the four that can fail quietly —
re-read it before you move on.

## Control Questions

1. Your `environment` resolver returns `'PRODUCTION'` and the field errors with
   `Expected a value of type "IncidentEnvironment"`. Explain what graphql-php was trying to do,
   what it should have received, and which single word in §4 you skipped.
2. `blameScore` returns `null` for an incident with no severity term rather than `0.0`. Give the
   concrete front-end consequence of the `0.0` choice on a list sorted by `blameScore`
   descending, and say what a client would have to do to distinguish the two cases if you had
   chosen `0.0`.
3. `register_graphql_field( 'BlameScoreBreakdown', … )` and
   `register_graphql_field( 'Incident', … )` receive different things in `$source`. Say what each
   receives and why, in terms of the field above it.
4. Retyping `incidentDetails.environment` required `deregister_graphql_field` first, and the type
   name it targets is generated by a third-party plugin. Describe the failure mode when that
   plugin renames the type in a major version, and say why it would be silent.
5. `blameScore` calls `get_the_terms()` and `get_post_meta()`, which Key Concept 7 calls cached,
   but `get_term_meta()` would be one query per node. Explain what makes the first two free
   inside a connection and the third not, and name the WordPress function that would make the
   third free too.

## Learn More

- [`register_graphql_field()`](https://www.wpgraphql.com/functions/register_graphql_field/) —
  the full config array, including `args` and `deprecationReason`, which Lesson 06.3 uses
- [`register_graphql_enum_type()`](https://www.wpgraphql.com/functions/register_graphql_enum_type/) —
  read the `values` array carefully; the name/`value` split is the whole of Key Concept 4
- [`register_graphql_object_type()`](https://www.wpgraphql.com/functions/register_graphql_object_type/) —
  what you need when a field's answer is a shape rather than a scalar
- [`register_graphql_connection()`](https://www.wpgraphql.com/functions/register_graphql_connection/) —
  worth reading once so you recognise when a taxonomy connection already does the job
- [WPGraphQL — Default Field Resolvers](https://www.wpgraphql.com/docs/default-types-and-fields/) —
  what WPGraphQL resolves for you before your resolver is ever called
- [graphql-php — Enum types](https://webonyx.github.io/graphql-php/type-definitions/enums/) — the
  library underneath WPGraphQL, and the normative answer on internal values versus names
- [graphql-php — `ResolveInfo`](https://webonyx.github.io/graphql-php/data-fetching/#solving-n1-problem) —
  the `$info` argument and the deferred-resolution model Lesson 06.4 builds on
- [GraphQL spec — Enums](https://spec.graphql.org/October2021/#sec-Enums) — two pages, and it
  settles every argument about whether enum values may be lower case
