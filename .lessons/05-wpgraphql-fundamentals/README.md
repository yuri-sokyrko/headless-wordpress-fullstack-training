# Module 05 — WPGraphQL Fundamentals

## Prerequisites

Before starting this module you should have completed:

- **Module 03** — Plugin, CPTs, Taxonomies & Roles
- **Module 04** — SCF, Content Modeling & WP-CLI Seeding, all five lessons

You need a seeded database. Querying an empty site teaches you nothing about pagination,
filtering or connection counts, and half the exercises in this module depend on there being 40
incidents spread across 4 severities.

> ⚠️ **This module writes no files into `wordpress-headless/` or `next-app/`.** It produces
> *verified queries*, saved as GraphiQL tabs and in a scratch `queries.graphql` you keep locally.
> They become committed `.graphql` documents in Lesson 10.2, once there is an application to put
> them in. Keep the scratch file — you will paste from it for the next five modules.

## Starting State

Module 04 verified clean. The content model is complete and the database is populated.

```bash
# 1. The seeder produces the full inventory
docker compose run --rm wpcli wp blame seed --fresh
docker compose run --rm wpcli wp post list --post_type=incident --format=count
# Expected: 40
docker compose run --rm wpcli wp post list --post_type=tech_review --format=count
# Expected: 8

# 2. SCF field groups are files, not database rows
ls wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/acf-json/
# Expected: five group_*.json files

# 3. Terms are seeded and counted
docker compose run --rm wpcli wp term list scapegoat --fields=slug,count
# Expected: 10 rows, counts summing to 40

# 4. The endpoint answers — Lesson 04.2 installed WPGraphQL and WPGraphQL for SCF
#    so that the SCF field groups could be inspected in GraphiQL as they were built
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/graphql
# Expected: 200 (this module is about USING it, not installing it)
```

## What You'll Learn

- **Why GraphQL** — one round trip, exactly the fields you asked for, and a schema the client
  can read; compared honestly against REST and against `WP_Query`
- **GraphiQL** — the IDE built into WPGraphQL: docs pane, autocomplete, and the schema as the
  primary reference
- **Relay connections** — `nodes`, `edges`, `pageInfo`, `endCursor`, and why cursor pagination
  beats `offset` on a table that changes underneath you
- **`where` arguments** — the `tax_query` and `meta_query` you already know, expressed as
  connection arguments
- **Variables, fragments and directives** — named operations, reusable field sets,
  `@include`/`@skip`, and why every production query is a named operation with variables
- **Everything that is not a post** — taxonomy terms, users, media, and menus via
  `menuItems(where: { location: PRIMARY })`
- **Mutations** — why every one of them needs authentication, and what happens when they do not
  have it

## What You'll Build

- WPGraphQL, WPGraphQL for SCF and the supporting plugins installed and answering on
  `/graphql`
- A verified query for every read the front end will need: the incidents list with facets, a
  single incident by slug, the scapegoat leaderboard, blog and review lists, media, menus, and
  site settings
- A fragment library for the field sets that repeat across those queries
- A working demonstration that an unauthenticated mutation is rejected — the negative case that
  Module 06 builds on
- A scratch `queries.graphql` that Lesson 10.2 turns into committed documents

After this module **every read the front end needs is answerable**, with variables, and you can
prove it in GraphiQL without writing a line of JavaScript.

## Lessons

| # | Lesson | New Technology | What You Build |
|---|---|---|---|
| 1 | [GraphQL vs REST vs WP_Query](01-graphql-vs-rest-vs-wp-query.md) | WPGraphQL, GraphiQL | The stack installed, plus the same read done three ways and compared |
| 2 | [Nodes, Connections & Pagination](02-nodes-connections-and-pagination.md) | Relay connections, cursors | The paginated, filtered incidents list query |
| 3 | [Variables, Fragments & Directives](03-variables-fragments-and-directives.md) | Named operations, fragments, `@include` | The fragment library and every query parameterised |
| 4 | [Taxonomies, Users, Media & Menus](04-taxonomies-users-media-and-menus.md) | Term/user/media connections, `menuItems` | The leaderboard, the nav query, media with sizes |
| 5 | [Mutations & Why They Need Auth](05-mutations-and-why-they-need-auth.md) | Mutation root, input types | A rejected anonymous mutation, and the case for Module 06 |

## The Queries You Leave With

Each one maps to a route you build in Modules 09–11. Names are the operation names you will keep.

| Operation | Feeds | Introduced |
|---|---|---|
| `IncidentsList` | `/incidents` with severity, scapegoat and stack facets | Lesson 05.2 |
| `IncidentBySlug` | `/incidents/[slug]` | Lesson 05.3 |
| `ScapegoatLeaderboard` | `/scapegoats` — ordered by term `count` | Lesson 05.4 |
| `ScapegoatBySlug` | `/scapegoats/[slug]`, including `scapegoatProfile` | Lesson 05.4 |
| `PostsList` / `PostBySlug` | `/blog` | Lesson 05.3 |
| `ReviewsList` / `ReviewBySlug` | `/reviews`, including both repeaters | Lesson 05.3 |
| `SiteChrome` | Root layout — `siteSettings` plus `menuItems` | Lesson 05.4 |

> **Do not reach for `WP_GRAPHQL_ENDPOINT` in a browser yet.** Every query in this module runs
> in GraphiQL, which is served by WordPress itself and authenticated by your wp-admin session.
> The front end never queries `/graphql` from the browser — that boundary is set in
> [appendix 04 §3](../appendix/04-env-reference.md#3-nextjs--next-appenvlocal) and is why this
> course installs no CORS plugin.

## How to Work

1. **Keep the docs pane in GraphiQL open.** The schema is the reference; the appendix is the
   contract. Guessing a field name wastes more time than reading it.
2. **Write every query as a named operation with variables from Lesson 05.3 onward**, even in
   GraphiQL. A query with a literal slug in it is a query you will have to rewrite.
3. **Save each verified query into your scratch `queries.graphql`** with the operation name from
   the table above. Module 10 assumes you have them.
4. **Commit after every lesson.** There is no code to commit here, so commit the scratch file's
   progress notes in your own working branch, or simply record the operation names in your ADR
   log.
