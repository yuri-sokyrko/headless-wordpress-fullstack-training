---
title: 'GraphQL Codegen'
module: 10
lesson: 2
teaches: [graphql-codegen, client-preset, committed-generated-code, schema-as-contract, codegen-check]
produces: ['next-app/codegen.ts', 'wordpress-headless/schema.graphql', 'next-app/src/gql/', 'next-app/src/graphql/incidents.graphql']
requires: [10.1, 9.3]
---

# Lesson 10.2 — GraphQL Codegen

## Quick Overview

This is the lesson that deletes `src/types/graphql-responses.ts`. Every hand-written response
type from Lesson 09.3 goes in one commit, replaced by types generated from the `schema.graphql`
you committed in Module 06. From here on, a type describing WordPress data is derived from the
schema by a tool, or it does not exist. If the schema says `downtimeMinutes: Float` and
therefore nullable, your type says `number | null`, and the bug you shipped in Lesson 09.3
becomes a compile error instead of a 500.

Two configuration decisions carry the weight. First, codegen reads the **committed
`schema.graphql` file**, not a live introspection query against WordPress — which means CI can
regenerate and diff types with no running WordPress, no database and no credential of any kind.
Second, `src/gql/` is **committed**. Generated code in git feels wrong for about a day, until
you notice that `npm run codegen:check` failing in CI is a much better experience than a build
that mysteriously depends on a container being up. Refreshing the schema becomes a deliberate
human action, `npm run schema:pull`, whose diff gets reviewed like any other change — which is
exactly what you want when someone activates a plugin that adds forty types.

By the end of this lesson you will have:

- `next-app/codegen.ts` using the `client-preset`, reading `wordpress-headless/schema.graphql`
- `wordpress-headless/schema.graphql` — the Module 06 schema, committed, plus an `npm run schema:pull` script that refreshes it
- `next-app/src/gql/` — generated and committed, with a header comment telling future you not to edit it
- `next-app/src/graphql/incidents.graphql` and siblings — the first `.graphql` documents, no longer inline template strings
- `src/types/graphql-responses.ts` deleted, and `npm run codegen:check` wired into `package.json` for Module 24's CI gate

## Classic WP Analogy

You already run a generated-artifact-in-git workflow, and you already know why it is worth it:
**ACF Local JSON**. The field group is defined once, saved to `includes/acf-json/`, and every
environment derives from that file instead of from a database table someone edited in
production at 2am. The content model becomes code — diffable, reviewable, deployable — and the
class of bug where staging and production disagree about a field name simply stops existing.

| ACF Local JSON | GraphQL Codegen |
|---|---|
| Field groups defined once, stored as JSON in git | Schema defined once, `schema.graphql` in git |
| Every environment reads the same file | Every build reads the same file |
| No DB export/import step on deploy | No live WordPress needed in CI |
| A field rename shows up as a reviewable diff | A schema change shows up as a reviewable diff |
| `acf-json/` is committed even though ACF wrote it | `src/gql/` is committed even though codegen wrote it |

The parallel is close enough that the objection is the same one too. "Why would I commit a file
a tool generates?" Because the alternative is a build step that depends on a running service,
and because the diff is the review surface: when `src/gql/` changes by nine hundred lines,
somebody should look at why.

The analogy breaks on direction of authorship, and the break matters day to day. `acf-json/`
files are written by ACF but read and sometimes hand-edited by you — they are a source of
truth. `src/gql/` is the opposite: it is a **derived artifact**, it is never edited by hand, and
your editor should treat it as read-only. Edit it and the next `npm run codegen` silently
reverts you. The second break: ACF Local JSON is the model itself, whereas codegen output is a
*projection* of a model that lives in WordPress. If someone activates a plugin that changes the
schema and nobody runs `npm run schema:pull`, your types are confidently, silently stale — the
Lesson 09.3 failure mode returning through a different door. `npm run codegen:check` in CI is
what closes it, and
[appendix 04 §7](../appendix/04-env-reference.md#7-secret-injection-per-target) explains why
the check is designed to need no credentials at all.

---

## Key Concepts

<!-- TODO: Phase B -->

---

## Task

<!-- TODO: Phase B -->

---

## Verification

<!-- TODO: Phase B -->

## Control Questions

<!-- TODO: Phase B -->

## Learn More

<!-- TODO: Phase B -->
