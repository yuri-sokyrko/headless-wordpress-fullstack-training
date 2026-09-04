# Module 06 — GraphQL API Design & Schema Extensions

## Prerequisites

Before starting this module you should have completed:

- **Module 03** — Plugin, CPTs, Taxonomies & Roles
- **Module 04** — ACF, Content Modeling & WP-CLI Seeding
- **Module 05** — WPGraphQL Fundamentals, all five lessons

Keep [appendix 03 §3 and §7](../appendix/03-content-model-reference.md#3-registered-graphql-enums)
open — the enums, the computed field and the four custom operations are all specified there.

> ⚠️ **Do not skip Lesson 02.3 if you skipped it.** Lesson 06.4 is a query-plan lesson wearing a
> GraphQL hat: it shows the same `meta_query` executing 40 times for a list of 40 incidents,
> and the fix only makes sense if you can read the plan. If `EXPLAIN` in Adminer is unfamiliar,
> go back before starting 06.4.

## Starting State

Module 05 verified clean. Every read the front end needs is answerable, and you have the
operations saved in a scratch `queries.graphql`.

```bash
# 1. GraphQL answers, and the schema knows the custom types
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ generalSettings { title } incidents(first:1){ nodes{ slug } } }"}'
# Expected: a "data" object with a title and one incident slug — no "errors" key

# 2. ACF is in the schema
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1){ nodes{ incidentDetails{ downtimeMinutes environment } } } }"}'
# Expected: downtimeMinutes as a number, environment as a bare String — the enum lands in 06.1

# 3. Anonymous mutations are already rejected
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation{ createIncident(input:{title:\"x\"}){ post{ id } } }"}'
# Expected: an "errors" array mentioning permission. NOT a created incident.
```

## What You'll Learn

- **Extending the schema from PHP** — `register_graphql_field`, `register_graphql_enum_type`,
  `register_graphql_object_type`, and resolvers that are cheap enough to call per node
- **Enums instead of bare strings** — why `IncidentEnvironment` produces a TypeScript union in
  Module 10 where a `String` produces nothing useful
- **Custom mutations** — `register_graphql_mutation`, input types, and the three things a
  mutation must do before it writes: authenticate, authorise, sanitise
- **Independent re-authorisation** — Next.js is not a trusted client, so WordPress validates
  again, from scratch
- **API design as a contract** — additive change, deprecation over removal, nullability as a
  promise, and a committed `schema.graphql` that CI can diff
- **N+1 and DataLoader** — why a field that looks free costs 40 queries, and how the loader
  batches it
- **Query depth and complexity limits**, disabled introspection in production, and persisted
  queries as the strongest available control

## What You'll Build

- `includes/graphql/enums.php` — the four enums from
  [§3](../appendix/03-content-model-reference.md#3-registered-graphql-enums), with resolvers
  mapping `kebab-case` ACF values to `SCREAMING_SNAKE_CASE`
- `includes/graphql/fields.php` — `blameScore` on `Incident`, computed and cached
- `includes/graphql/mutation-create-incident.php` — `createIncident`, forcing `post_status` and
  `post_author`, ignoring `is_verified`
- `includes/graphql/mutation-register-developer.php` — `registerDeveloper`, app-token
  authenticated
- `includes/graphql/performance.php` — loader wiring, depth and complexity limits
- `wordpress-headless/schema.graphql` — the schema snapshot, committed, so CI never needs a live WordPress

After this module the API is a **designed contract** rather than whatever WPGraphQL happened to
expose: computed fields, guarded mutations, real enums, a depth limit, and a schema file under
review.

## Lessons

| # | Lesson | New Technology | What You Build |
|---|---|---|---|
| 1 | [Extending the Schema in PHP](01-extending-the-schema-in-php.md) | `register_graphql_field`, `register_graphql_enum_type` | `enums.php`, `fields.php` — the four enums and `blameScore` |
| 2 | [Custom Mutations & Input Validation](02-custom-mutations-and-input-validation.md) | `register_graphql_mutation`, input sanitising | `createIncident`, `registerDeveloper` |
| 3 | [API Design, Versioning & Contracts](03-api-design-versioning-and-contracts.md) | Deprecation, nullability, schema snapshots | `wordpress-headless/schema.graphql` and a written API policy |
| 4 | [Performance, N+1 & Query Limits](04-performance-n-plus-1-and-query-limits.md) | DataLoader, depth/complexity limits | `performance.php`, a measured before-and-after |

## The Four Custom Operations

Specified in [§7](../appendix/03-content-model-reference.md#7-custom-graphql-fields-and-mutations).
`submitHobtLead` is listed for completeness and lands in Module 16 with the leads table.

| Name | Kind | Auth | The guard that matters |
|---|---|---|---|
| `blameScore` | field on `Incident` | public | Must not cost a query per node — Lesson 06.4 |
| `createIncident` | mutation | user JWT + `create_incidents` | Forces `post_status = 'pending'` and `post_author`; **ignores** `is_verified` |
| `registerDeveloper` | mutation | app token, server-to-server | Assigns `incident_reporter` explicitly, never `default_role` |
| `submitHobtLead` | mutation | app token, server-to-server | Writes to `wp_btt_leads`, never a post type (Module 16) |

> **A field being present in a GraphQL input type is not permission to set it.** `is_verified`
> is in the schema, an editor can write it in wp-admin, and `createIncident` silently discards it
> when a client sends it. That is the whole trust-boundary lesson in one field, and Lesson 06.2's
> Verification proves the discard rather than asserting it.

## How to Work

1. **Work the lessons in order.** 06.1's enums are what 06.2's input types validate against, and
   06.3 snapshots a schema that only exists after both.
2. **Reload GraphiQL's schema after every PHP change.** WPGraphQL caches the schema; a field you
   just registered that "does not exist" is almost always a stale docs pane.
3. **Measure in 06.4, do not estimate.** Turn on the query log, count the queries for a 40-node
   list before and after the loader, and write both numbers down.
4. **Commit after every lesson.** `git add -A && git commit -m "feat(api): guard createIncident"`.
   Lesson 06.3's `wordpress-headless/schema.graphql` is the frozen contract Module 10 generates types from.
