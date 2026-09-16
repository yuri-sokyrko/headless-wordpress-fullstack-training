---
title: 'GraphQL vs REST vs WP_Query'
module: 5
lesson: 1
teaches: [graphql-vs-rest, graphql-schema-basics, graphiql, overfetching, wpgraphql-install]
produces: []
requires: [3.2, 4.5]
---

# Lesson 05.1 — GraphQL vs REST vs WP_Query

## Quick Overview

Three ways to ask WordPress for the same thing, and this lesson runs all three against your own
seeded database so the comparison is measured rather than argued. The question: give me ten
published incidents with their title, slug, severity term, scapegoat term and downtime, ordered
newest first. `WP_Query` answers it in PHP inside the same process. The REST API answers it in
two or three round trips, returning far more of each post than you asked for and leaving you to
resolve terms yourself. WPGraphQL answers it in one `POST /graphql` returning exactly those five
fields and nothing else.

You will install WPGraphQL and its companion plugins, open GraphiQL at `/wp-admin/admin.php?page=graphiql-ide`,
and learn to read the docs pane — which matters more than any query in this lesson, because the
schema is the reference you will consult a hundred times over the next fifteen modules. Then you
compare payload sizes and round-trip counts for the three approaches with real numbers. The
verdict is stated up front rather than saved for the end: **GraphQL wins here**, because a
decoupled front end is a network hop away and over-fetching costs latency you cannot get back.
The cost is also stated — a query language your server has to parse and plan, a schema you now
have to version, and a class of performance problem (N+1, unbounded depth) that Module 06 exists
to handle.

By the end of this lesson you will have:

- WPGraphQL, WPGraphQL for SCF and the supporting plugins installed, pinned and active
- `/graphql` answering a `{ generalSettings { title } }` query with JSON
- GraphiQL open, with the docs pane used to find `incidents` without looking at any lesson
- The same read expressed three ways — `WP_Query`, REST, GraphQL — with round-trip counts and
  response sizes recorded
- A written verdict with its cost named
- Your first named operation saved to the scratch `queries.graphql`

## Classic WP Analogy

A GraphQL query is `WP_Query` with the field list moved to the caller. That is the sentence to
hold on to. When you write:

```graphql
{ incidents(first: 10, where: { status: PUBLISH }) { nodes { title slug } } }
```

you are writing `new WP_Query(['post_type' => 'incident', 'posts_per_page' => 10, 'post_status'
=> 'publish'])` and then, instead of a template deciding what to echo, declaring `title` and
`slug` as part of the request. `first` is `posts_per_page`. `where` is the argument array.
`nodes` is `$query->posts`. Underneath, WPGraphQL literally builds a `WP_Query` and runs it, so
everything you learned in Lesson 02.3 about indexes and `meta_query` is still exactly true — the
SQL is the same SQL.

The REST comparison is worth doing because you may already reach for `/wp-json/wp/v2/posts` and
assume that is what "headless WordPress" means. REST is fine, and this course keeps it enabled
because the block editor needs it. It just answers a different question: a REST endpoint returns
a *resource*, in full, with the shape its author chose, and getting a post plus its terms plus
its featured image means three requests or an `_embed` parameter that returns even more than
before. Both round trips and payload size compound over a page with several lists on it.

**Where the analogy breaks down:** `WP_Query` is *lenient and local*. A typo in an argument key
is silently ignored, a missing field is `null`, and the page still renders — and because you are
in the same process, you can always follow up with `get_post_meta()` when you realise you need
one more value. GraphQL is *strict and remote*. A misspelled field is a validation error that
rejects the whole query before any resolver runs, and there is no "one more value" — if you did
not ask for it in the request, you do not have it, and getting it means another network round
trip. That strictness is what makes codegen possible in Module 10, but it inverts the debugging
habit: read the schema first, do not add a null check.

---

## Key Concepts

### 1. One endpoint, one round trip

There is one URL — `POST http://localhost:8080/graphql` — and the request body is JSON with three
keys, two of which are optional:

```json
{
  "query": "query GetIncidents($first: Int!) { incidents(first: $first) { nodes { title slug } } }",
  "variables": { "first": 10 },
  "operationName": "GetIncidents"
}
```

That is the whole protocol. The URL never changes, the HTTP verb never changes, and the shape of
the response is the shape of the `query` you sent. Compare that with REST, where the URL *is* the
question: `/wp-json/wp/v2/incident`, `/wp-json/wp/v2/severity`, `/wp-json/wp/v2/media/412`.

```
REST — the URL is the question                GraphQL — the body is the question
────────────────────────────────              ─────────────────────────────────────
GET /wp/v2/incident?per_page=10               POST /graphql
GET /wp/v2/severity?post=1,2,3,4…             {
GET /wp/v2/scapegoat?post=1,2,3,4…              "query": "…",
GET /wp/v2/media/412                            "variables": { "first": 10 }
  4+ round trips, 4 caches, 4 shapes          }
                                                1 round trip, 1 cache key, 1 shape
```

One consequence lands immediately and surprises everyone exactly once:

> **GraphQL answers with HTTP 200 and an `errors` array.** A permission failure, a validation
> failure, a resolver exception — all of them come back `200 OK` with `errors` populated and
> `data` either `null` or *partially* filled. `res.ok` tells you nothing. `fetch` will never
> throw. Every check in this course that proves a failure inspects `.errors`, never the status
> code. See [appendix 05 §8](../appendix/05-graphql-cheatsheet.md#8-errors).

### 2. Over-fetching, under-fetching, and why both cost you

Take one concrete question: **ten published incidents with title, slug, severity slug, scapegoat
slug and downtime, newest first.** Five fields per row.

| | `WP_Query` | REST | GraphQL |
|---|---|---|---|
| Where it runs | in-process PHP | over HTTP | over HTTP |
| Round trips | 0 | 3–4, or 1 with `_embed` | **1** |
| Fields returned per post | whatever you `echo` | ~25 top-level, most of them `rendered` HTML | **exactly 5** |
| Terms | one extra query, cached | separate request, or `_embed` | in the same response |
| SCF `downtime_minutes` | `get_post_meta()`, free | **absent** unless the field group opts into REST | in the same response |
| Adding a sixth field | edit the template | often free — it was already in the payload | edit the query, and the diff shows it |

Two distinct failures hide in that table. **Over-fetching** is REST handing you
`content.rendered`, `excerpt.rendered`, `guid`, `_links` and twenty more keys when you wanted
five values; you pay for it in bytes, in JSON parse time, and in a cache entry that is mostly
waste. **Under-fetching** is the opposite and worse: the payload does not contain the severity
term or the SCF field, so you make another request, and the page cannot render until the slowest
of them returns. `_embed` trades under-fetching for more over-fetching — it inlines the terms
*and* the author *and* the featured media, in full.

In Classic WordPress neither problem existed, because the template and the database were in the
same process. The moment the renderer is a network hop away, every extra field is bytes on a wire
and every extra request is a round trip you cannot get back.

### 3. The type system is the API

WPGraphQL derives a **schema** from your registrations in Modules 03 and 04. The schema is a
typed, machine-readable description of everything askable, and it is the artifact that makes
everything else in this course possible. Written as SDL, a fragment of yours looks like this:

```graphql
type Incident implements Node & ContentNode & NodeWithTitle & UniformResourceIdentifiable {
  id: ID!                       #  ! means non-null — never absent
  databaseId: Int!
  title(format: PostObjectFieldFormatEnum): String
  slug: String
  date: String
  severities(first: Int, after: String): IncidentToSeverityConnection
  scapegoats(first: Int, after: String): IncidentToScapegoatConnection
  incidentDetails: IncidentDetails          # from SCF, Lesson 04.2
}
```

Four things in that fragment carry weight:

| Element | What it means |
|---|---|
| `type Incident` | An **object type**. Your `graphql_single_name` from [appendix 03 §1](../appendix/03-content-model-reference.md#1-post-types) picked this name. |
| `String`, `Int`, `ID`, `Boolean`, `Float` | The five built-in **scalars**. Leaves of the tree. There is no `SELECT *` — you name every scalar you want. |
| `!` | **Non-null.** A promise the server makes. Nullability is a design decision, not a default — Lesson 06.3. |
| `implements Node & ContentNode` | **Interfaces.** `nodeByUri` can return "whatever lives at this URI" because everything addressable implements `UniformResourceIdentifiable`. |
| `…Connection` | A paginated list, Relay-style. Lesson 05.2 is entirely about these. |

Because the schema is queryable — that is **introspection**, `{ __schema { types { name } } }` —
tools can read it. GraphiQL's autocomplete is introspection. Module 10's codegen is introspection
(against a committed snapshot, Lesson 06.3). The `@graphql-eslint` rule that fails your build for
querying a field that does not exist is introspection. You did not write a single line of
documentation and you have a browsable, always-current API reference.

### 4. GraphiQL, and the one thing it will lie to you about

GraphiQL ships inside WPGraphQL. It lives at
`http://localhost:8080/wp-admin/admin.php?page=graphiql-ide`, and it is the manual test harness
for the next fifteen modules.

```
┌──────────────────────────────────────────────┬──────────────────────┐
│ query GetIncidents($first: Int!) {           │  RESPONSE            │
│   incidents(first: $first) {                 │  {                   │
│     nodes { title slug }                     │    "data": { … }     │
│   }                                          │  }                   │
│ }                                            │                      │
├──────────────────────────────────────────────┤                      │
│ QUERY VARIABLES                              │                      │
│ { "first": 3 }                               │                      │
└──────────────────────────────────────────────┴──────────────────────┘
   ▲ Ctrl+Space = autocomplete    Prettify = reformat    Docs = the schema
```

| Pane / control | Use it for |
|---|---|
| **Docs** (top right) | The schema browser. Search `incidents`, click through to `Incident`, read every field and argument. This is the reference — not the lesson text. |
| **Query editor** | `Ctrl+Space` completes field names against the live schema. A red squiggle is a validation error *before* you run anything. |
| **Query Variables** | The JSON for your `$variables`. From Lesson 05.3 on, values live here and never in the query text. |
| **Prettify** | Reformats. Use it before pasting a query into your scratch file. |
| **Re-fetch schema** | After every PHP change in Module 06. A field you just registered that "does not exist" is almost always a stale docs pane. |

> **GraphiQL is authenticated as your wp-admin session.** It runs inside wp-admin, so your
> administrator cookie is attached to every request it makes. That means GraphiQL can see draft
> posts, private fields and mutations that an anonymous caller cannot — and "it works in GraphiQL
> but returns `null` from `curl`" is nearly always correct behaviour rather than a bug. Whenever a
> result matters, re-run it with `curl` as an anonymous caller. Every `## Verification` block in
> Modules 05 and 06 does exactly that, for exactly this reason.

### 5. Underneath, it is still `WP_Query`

This is the most reassuring fact in the module. WPGraphQL's post connection resolver **builds a
`WP_Query` and runs it**. It does not talk to MySQL directly, it does not maintain a second index,
and it does not bypass a single WordPress filter.

```
POST /graphql
     │
     ▼
  parse + validate against the schema      ← rejects unknown fields before any I/O
     │
     ▼
  resolve incidents  ──▶  new WP_Query([ 'post_type' => 'incident', … ])
     │                          │
     │                          ▼
     │                    the same SQL you EXPLAINed in Lesson 02.3
     │                          │
     ▼                          ▼
  per-node resolvers  ──▶  get_post_meta() / get_the_terms()  ← object cache
     │
     ▼
  JSON, shaped exactly like the query
```

The argument mapping, which is most of what you need to know to write a query:

| `WP_Query` arg | GraphQL |
|---|---|
| `'posts_per_page' => 10` | `first: 10` |
| `'paged' => 2` | `after: $endCursor` (Lesson 05.2 — cursors, not pages) |
| `'post_status' => 'publish'` | `where: { status: PUBLISH }` |
| `'orderby' => 'date', 'order' => 'DESC'` | `where: { orderby: { field: DATE, order: DESC } }` |
| `'s' => 'dns'` | `where: { search: "dns" }` |
| `'post__in' => [1,2,3]` | `where: { in: ["1","2","3"] }` |
| `'name' => 'the-slug'` | `where: { name: "the-slug" }` or the single-node field with `idType: SLUG` |
| `'author' => 4` | `where: { author: 4 }` |
| `'date_query' => [...]` | `where: { dateQuery: { after: { year: 2025 } } }` |
| `'tax_query' => [...]` | **not in core WPGraphQL** — see Lesson 05.2 §6 |
| `'meta_query' => [...]` | **not in core WPGraphQL** — deliberately, and Lesson 05.2 §6 says why |

Everything you know about performance survives intact. `wp_postmeta.meta_value` still has no
usable index, so a filter on `downtime_minutes` is still the slow query you `EXPLAIN`ed in
Lesson 02.3 — the SQL is the same SQL, generated from the same `WP_Query`, hitting the same
tables. Headless does not fix that. It moves it one layer further away, where it is harder to
see, which is a good reason to have read the plan already.

### 6. REST does not go away — it keeps exactly two jobs

This course leaves the REST API on, and it is important to understand that this is a decision
rather than an oversight.

| Consumer | Uses | Why not GraphQL |
|---|---|---|
| **The block editor** (Gutenberg) | `/wp-json/wp/v2/*` via `@wordpress/core-data` | Gutenberg is a REST client. Its data layer is not pluggable in any practical way. Turn REST off for a post type and the editor renders a white screen — which is why `show_in_rest => true` is mandatory in [appendix 03 §1](../appendix/03-content-model-reference.md#1-post-types), even here. |
| **The preview handshake** | `/wp-json/btt/v1/preview/verify` (Lesson 17.2) | One tiny custom route that exchanges a short-lived token, called server-to-server. A mutation would work; a route handler is simpler and has no schema consequences. |

Everything else the front end reads goes through `/graphql`. Two APIs with clearly separated
owners is a smaller problem than one API doing a job it is bad at.

### 7. The verdict, and the cost

**GraphQL wins for this application**, and the reason is narrow and specific: the renderer is a
network hop from the data, several lists appear on one page, and the field set each component
needs is known at build time. Those three facts are exactly the conditions GraphQL was designed
for. If the front end were PHP templates in the same process, `WP_Query` would win on every axis
and adding GraphQL would be pure overhead.

The cost, stated plainly:

| Cost | Where it bites | Where the course handles it |
|---|---|---|
| A query language your server parses, validates and plans on every request | CPU on the WordPress box | Lesson 06.4 — depth limits, persisted queries |
| A schema you now own and must version | Field renames become deploy-ordering problems | Lesson 06.3 — additive-only, `@deprecated`, committed schema |
| N+1 is the default failure mode of per-node resolvers | 40 nodes, 140 SQL queries | Lesson 06.4 — loaders, measured before and after |
| The client chooses how much work you do | An unbounded or deeply nested query | Lesson 05.2 and 06.4 — explicit `first`, depth and complexity caps |
| Two API surfaces to reason about | GraphQL plus the REST the editor needs | Key Concept 6 — separated by owner, not by preference |

---

## Task

### Step 1: Confirm the starting state

```bash
cd wordpress-headless

docker compose ps
docker compose run --rm wpcli wp post list --post_type=incident --format=count
```

**Verify §1:**

- [ ] `wordpress`, `db`, `adminer` and `mailpit` are `running`, `db` is `(healthy)`.
- [ ] The incident count is `40`. If it is `0`, run `docker compose run --rm wpcli wp blame seed --fresh`
      before continuing — pagination and facets are unteachable on an empty site.

### Step 2: Confirm WPGraphQL and WPGraphQL for SCF are installed

Lesson 04.2 installed both, because the SCF field groups could not be inspected without them.
Both commands below are idempotent, so run them either way — "already installed" is the expected
answer, not a problem. Remember the house rule from
[appendix 07 §2](../appendix/07-command-reference.md#2-wp-cli) — every `wp` command in this course
runs through the `wpcli` service, because the stock `wordpress` image ships no `wp` binary:

```bash
docker compose run --rm wpcli wp plugin install wp-graphql --activate
docker compose run --rm wpcli wp plugin install wpgraphql-acf --activate

docker compose run --rm wpcli wp plugin list --fields=name,version,status --format=csv
```

Copy that CSV into your notes if you did not already do it in Lesson 04.2. **Those two version
numbers are the pin.** Module 24 installs
plugins at image build time with `wp plugin install <slug> --version=<pinned>`, and "whatever was
latest on the day we deployed" is not a reproducible build. You do not need a lockfile mechanism
today; you need the numbers written down.

The other plugins in [appendix 03 §8](../appendix/03-content-model-reference.md#8-plugin-inventory)
arrive with the modules that need them — JWT in Module 15, Content Blocks in Module 14, Yoast SEO
in Module 19, Polylang in Module 20. Install nothing else now.

**Verify §2:**

- [ ] `wp-graphql` and `wpgraphql-acf` both show `active`.
- [ ] `docker compose logs --tail=50 wordpress` shows no new PHP fatal error or warning.

### Step 3: Confirm the endpoint answers

```bash
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ generalSettings { title } }"}'
```

WPGraphQL also accepts `GET` with the query in the query string, which matters much later — a
`GET` is cacheable by a CDN, which is half of why persisted queries are worth having
(Lesson 06.4):

```bash
curl -s -G http://localhost:8080/graphql --data-urlencode 'query={ generalSettings { title } }'
```

**Verify §3:**

- [ ] Both commands return `{"data":{"generalSettings":{"title":"Blame The Tech"}}}`.
- [ ] Neither response has an `errors` key.

### Step 4: Take the GraphiQL tour

Open <http://localhost:8080/wp-admin/admin.php?page=graphiql-ide>.

Do these five things in order. The point is the fourth one.

1. Paste `{ generalSettings { title } }` and run it.
2. Open the **Docs** pane, search for `incidents`, and click through to the `Incident` type.
   Read the argument list on `incidents` — you are looking at the `WP_Query` mapping table from
   Key Concept 5, generated from your own registrations.
3. In the editor, type `{ incidents(first: 3) { nodes { ` and press `Ctrl+Space`. Every field on
   `Incident` is offered, including `incidentDetails` from SCF.
4. **Find `downtimeMinutes` without looking at this lesson or the appendix.** Docs pane →
   `Incident` → `incidentDetails` → `IncidentDetails` → the field list. That path is the skill;
   the query is not.
5. Break it on purpose: change `title` to `titel` and run. Read the error. Nothing executed —
   validation rejected the whole document before a single resolver ran.

**Verify §4:**

- [ ] You found `downtimeMinutes` through the Docs pane.
- [ ] The misspelled field produced a validation error naming the type, and `data` was absent.

### Step 5: Ask the same question three ways

**5a — `WP_Query`, in-process.** No HTTP, no serialisation, and you can reach for one more value
at any time:

```bash
docker compose run --rm wpcli wp eval '
$q = new WP_Query( [
  "post_type"      => "incident",
  "post_status"    => "publish",
  "posts_per_page" => 10,
  "orderby"        => "date",
  "order"          => "DESC",
] );
foreach ( $q->posts as $p ) {
  $sev = wp_get_post_terms( $p->ID, "severity", [ "fields" => "slugs" ] );
  printf(
    "%-46s %-18s %s\n",
    $p->post_name,
    $sev ? $sev[0] : "-",
    get_post_meta( $p->ID, "downtime_minutes", true )
  );
}
printf( "SQL queries this request: %d\n", $GLOBALS["wpdb"]->num_queries );
'
```

The query count includes WordPress booting, so treat it as a shape rather than a benchmark. What
matters is that terms and meta cost one primed query each for the whole result set, not one per
row — the same batching idea you will meet as a DataLoader in Lesson 06.4.

**5b — REST.** Ask for ten incidents and measure the payload:

```bash
curl -s 'http://localhost:8080/wp-json/wp/v2/incident?per_page=10' | wc -c
curl -s 'http://localhost:8080/wp-json/wp/v2/incident?per_page=10&_embed=1' | wc -c

# What keys did you actually get for one post?
curl -s 'http://localhost:8080/wp-json/wp/v2/incident?per_page=1' | jq -r '.[0] | keys[]'
```

Note two things in that key list. It is long, and `downtime_minutes` is **not in it** — SCF fields
are absent from REST unless the field group opts in separately, so the honest REST version of this
question needs a `register_rest_field()` you have not written.

**5c — GraphQL.** One request, five fields:

```bash
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first: 10, where: { status: PUBLISH, orderby: { field: DATE, order: DESC } }) { nodes { title slug severities(first: 1) { nodes { slug } } scapegoats(first: 1) { nodes { slug } } incidentDetails { downtimeMinutes } } } }"}' \
  | tee /tmp/btt-graphql.json | wc -c

jq '.data.incidents.nodes[0]' /tmp/btt-graphql.json
```

Write the three numbers down: REST plain, REST with `_embed`, GraphQL. You will quote them for the
rest of the course.

### Step 6: Start the scratch query file

Every query you verify from here to Lesson 05.5 goes into one scratch file. Lesson 10.2 turns
these into committed `.graphql` documents under `next-app/src/graphql/`; until there is an
application, they live locally.

Keep it out of git without touching the shared `.gitignore` — a personal scratch file is a
personal exclusion:

```bash
cd ..    # repo root
printf '%s\n' 'queries.graphql' >> .git/info/exclude
git check-ignore -v queries.graphql
```

Then create it:

```graphql
# queries.graphql — scratch. Local only, excluded via .git/info/exclude (Step 6).
# Operation names match the table in .lessons/05-wpgraphql-fundamentals/README.md.

query IncidentsFirstLook {
  incidents(
    first: 10
    where: { status: PUBLISH, orderby: { field: DATE, order: DESC } }
  ) {
    nodes {
      title
      slug
      severities(first: 1) {
        nodes {
          slug
        }
      }
      scapegoats(first: 1) {
        nodes {
          slug
        }
      }
      incidentDetails {
        downtimeMinutes
      }
    }
  }
}
```

**Verify §6:**

- [ ] `git check-ignore -v queries.graphql` names `.git/info/exclude`.
- [ ] `git status --short` does **not** list `queries.graphql`.

### Step 7: Write the verdict down

Two sentences, in your own words, in your ADR log from Module 01: why this application queries
GraphQL rather than REST, and the one cost you are accepting for it. Naming the cost is the
part that matters — an architectural decision with no downside written next to it has not been
made, it has been assumed.

---

## Verification

```bash
cd wordpress-headless

# 1. Both plugins are active
docker compose run --rm wpcli wp plugin list --status=active --field=name | sort
# Expected: the list includes wp-graphql and wpgraphql-acf

# 2. The endpoint answers a POST
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ generalSettings { title } }"}'
# Expected: {"data":{"generalSettings":{"title":"Blame The Tech"}}}

# 3. ...and a GET (this is what makes CDN caching possible in Module 18)
curl -s -G http://localhost:8080/graphql --data-urlencode 'query={ generalSettings { title } }'
# Expected: the same JSON

# 4. The seeded incidents are queryable, and the count matches the database
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first: 100) { nodes { slug } } }"}' | jq '.data.incidents.nodes | length'
# Expected: 40

# 5. SCF fields are in the schema and resolve
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first: 1) { nodes { incidentDetails { downtimeMinutes environment } } } }"}' | jq -c '.data.incidents.nodes[0]'
# Expected: downtimeMinutes as a number; environment as a bare string like "production"
#           (it becomes the IncidentEnvironment enum in Lesson 06.1)

# 6. NEGATIVE — a misspelled field is rejected before anything executes
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first: 1) { nodes { titel } } }"}' | jq -c '{errors: (.errors | length), data: .data}'
# Expected: {"errors":1,"data":null}
#           Note the HTTP status was still 200. Read .errors, never the status code.

# 7. NEGATIVE — and the error names the field and the type, so it is actionable
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first: 1) { nodes { titel } } }"}' | jq -r '.errors[0].message'
# Expected: Cannot query field "titel" on type "Incident". (…and a suggestion)

# 8. You get ONLY the fields you asked for — no over-fetching to opt out of
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first: 1) { nodes { slug } } }"}' | jq -r '.data.incidents.nodes[0] | keys[]'
# Expected: exactly one line — slug

# 9. REST returns far more than five fields for the same rows
curl -s 'http://localhost:8080/wp-json/wp/v2/incident?per_page=1' | jq -r '.[0] | keys | length'
# Expected: 20 or more

# 10. ...and the SCF value is not among them
curl -s 'http://localhost:8080/wp-json/wp/v2/incident?per_page=1' | jq -r '.[0] | keys[]' | grep -c downtime
# Expected: 0   (REST would need a register_rest_field; GraphQL needed nothing)

# 11. Payload size, three ways. Record all three.
echo -n 'REST plain : '; curl -s 'http://localhost:8080/wp-json/wp/v2/incident?per_page=10' | wc -c
echo -n 'REST _embed: '; curl -s 'http://localhost:8080/wp-json/wp/v2/incident?per_page=10&_embed=1' | wc -c
echo -n 'GraphQL    : '; curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first: 10, where: { status: PUBLISH }) { nodes { title slug severities(first:1){ nodes{ slug } } scapegoats(first:1){ nodes{ slug } } incidentDetails{ downtimeMinutes } } } }"}' | wc -c
# Expected: GraphQL is the smallest by a wide margin, and REST _embed is the largest

# 12. Introspection works — this is what GraphiQL and Module 10's codegen both use
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name: \"Incident\") { fields { name } } }"}' | jq -r '.data.__type.fields[].name' | grep -c .
# Expected: a number well above 20. If this errors, introspection is off — check
#           WP_ENVIRONMENT_TYPE is "local" (appendix 04 §2)

# 13. The scratch file exists and is not staged
cd .. && ls -l queries.graphql && git status --short | grep -c queries.graphql
# Expected: the file exists, and the grep count is 0
```

## Control Questions

1. A colleague reports that `POST /graphql` "returns 200, so the mutation worked". Explain in
   two sentences why that conclusion is unsound, and name the exact JSON path you would read
   instead.
2. `_embed` reduces REST round trips from four to one. Name the two costs it adds, and say why
   they matter more for a decoupled front end than for a PHP theme.
3. WPGraphQL builds a `WP_Query`. Given that, what will happen to a GraphQL query that filters
   40,000 incidents on `downtime_minutes`, and which lesson's `EXPLAIN` output predicts it?
4. A query works in GraphiQL and returns `null` for the same field when run with `curl`. Give
   the most likely cause, and the one-line change to the `curl` command that would confirm it.
5. This course keeps the REST API enabled. Name its two remaining consumers and say what breaks
   in wp-admin if you disable REST for the `incident` post type.

## Learn More

- [GraphQL — Queries and Mutations](https://graphql.org/learn/queries/) — the official
  walkthrough of the query language itself; read it once, top to bottom, before Lesson 05.3
- [GraphQL — Schemas and Types](https://graphql.org/learn/schema/) — where `!`, interfaces and
  unions come from; it is the vocabulary Module 10's generated TypeScript uses
- [WPGraphQL — Intro to GraphQL](https://www.wpgraphql.com/docs/intro-to-graphql) — the same
  ideas expressed in WordPress terms, by the plugin's authors
- [WPGraphQL — Interacting with WPGraphQL](https://www.wpgraphql.com/docs/interacting-with-wpgraphql) —
  the request shape, `GET` versus `POST`, batching, and the GraphiQL IDE
- [WPGraphQL — Posts and Pages](https://www.wpgraphql.com/docs/posts-and-pages) — the full connection
  argument reference; the authoritative version of Key Concept 5's mapping table
- [WordPress REST API Handbook](https://developer.wordpress.org/rest-api/) — worth skimming
  `_embed` and `_fields`, so your comparison in Step 5 is fair to REST
- [`@wordpress/core-data`](https://developer.wordpress.org/block-editor/reference-guides/data/data-core/) —
  the block editor's REST data layer; read it when you wonder why REST cannot simply be turned off
- [GraphQL over HTTP](https://graphql.github.io/graphql-over-http/draft/) — the draft spec for
  status codes and content types, and the reason the 200-with-errors behaviour is not a WPGraphQL
  quirk
