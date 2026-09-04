---
title: 'WP Integration & GraphQL Contract Tests'
module: 23
lesson: 5
teaches: [wp-phpunit, integration-testing, acf-key-contract, block-json-registration, graphql-execution-tests, schema-drift, graphql-eslint]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/bootstrap.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Integration/PostTypesTest.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Integration/GraphQLSchemaTest.php', 'wordpress-headless/schema.graphql']
requires: [23.4, 06.4, 13.2]
---

# Lesson 23.5 — WP Integration & GraphQL Contract Tests

## Quick Overview

Some things are only true when WordPress is really running. Whether `incident` registered with
`show_in_graphql` and the right `graphql_single_name`. Whether `map_meta_cap` actually produces
`publish_incidents` and actually withholds it from `incident_reporter`. Whether
`register_block_type` found your `block.json`. Whether the resolver returns `null` for a pending
incident to an anonymous caller. `wp-phpunit` is the tool: core's own test suite, pointed at a
real MySQL, with `WP_UnitTestCase` factories and a transaction per test. This is the suite that
catches "the plugin activated but the schema is wrong", which is the single most expensive class
of bug in a headless WordPress build, because it surfaces in TypeScript at runtime.

Two contracts get pinned here and both are worth naming explicitly. **ACF field-group keys are a
public contract.** `field_incident_occurred_at` is not an implementation detail — it is the join
between the JSON in `includes/acf-json/`, the GraphQL field name, and the codegen'd TypeScript
type. Rename it and the front end gets `null` with no error anywhere, so a test asserts the keys
exist and fails on a rename. **And the schema itself is a contract**:
`wp graphql generate-static-schema` writes `schema.graphql`, it is committed, CI regenerates it
and fails on `git diff --exit-code`, and `@graphql-eslint` validates every `.graphql` document
against it. That is what makes the appendix 04 §7 promise real — no CI job ever needs a running
WordPress or a database credential, because the contract is a file.

One setup decision, stated up front: **the PHP tests run inside the existing Compose `wordpress`
container, not `wp-env`.** One stack, one mental model, the same PHP version as production.

By the end of this lesson you will have:

- `tests/bootstrap.php` loading `wp-phpunit` and the plugin, a `phpunit.xml.dist` with an
  `integration` suite, and a `wp_test` database and user in the Compose stack — never the
  development database, never `root`
- `tests/Integration/PostTypesTest.php` — every post type and taxonomy from
  [appendix 03](../appendix/03-content-model-reference.md), asserted for `show_in_graphql`,
  GraphQL names and `supports`
- Capability tests per role from appendix 03 §6, including the negative: `incident_reporter`
  cannot `publish_incidents`
- An ACF field-group key test that fails on a rename, and a `register_block_type` test that fails
  on a missing or malformed `block.json`
- `tests/Integration/GraphQLSchemaTest.php` — in-process `graphql()` execution for `blameScore`,
  the guarded mutations, and an anonymous caller getting no pending incidents
- A committed `wordpress-headless/schema.graphql`, a `npm run codegen:check` drift gate, and
  `@graphql-eslint` in the lint run

## Classic WP Analogy

This is the one suite in the module where the Classic analogy is not an analogy at all — it *is*
the Classic tool. `wp-phpunit` is the same `WP_UnitTestCase` you would use to test any plugin,
with the same factories and the same transactional isolation. If you have ever written a test for
a WordPress plugin, you already know this API.

The environment choice is where the interesting comparison lives, and it deserves a verdict:

| Option | What it is | Verdict |
|---|---|---|
| **The existing Compose `wordpress` container** | `docker compose exec -w /var/www/html/$PLUGIN wordpress php vendor/bin/pest` | **Chosen.** Same PHP 8.3, same extensions, same image as production. One stack to reason about. (Composer itself runs from a `composer` service — the stock image has neither Composer nor WP-CLI.) |
| `wp-env` | The Gutenberg team's Docker-based test environment | A second Docker stack, a second PHP version, a second set of ports. Worth knowing, not worth running here. |
| `wp scaffold plugin-tests` + a host MySQL | The classic `bin/install-wp-tests.sh` path | Works, and reintroduces "works on my machine" for everyone whose local PHP differs. |

> **The `wp-env` aside, so upstream docs still make sense.** Every `@wordpress/*` package's
> documentation and every Gutenberg contribution guide assumes `wp-env`. When you read
> `npx wp-env run tests-wordpress wp ...` in the block editor handbook, translate it to
> `docker compose run --rm wpcli wp ...` and it does the same thing. Knowing the mapping means
> the upstream documentation stays usable without adding a second container stack to this project.

Where the analogy genuinely breaks is the **contract** half of the lesson, and it has no Classic
counterpart whatsoever. In a Classic theme, a renamed ACF field key produced a blank space on a
page — annoying, visible, found in minutes by anyone looking at the site. Here it produces
`null` in a typed TypeScript field that codegen still says is a `String`, on a page that renders
perfectly with a missing section, in a language whose type checker was satisfied because the
schema said so. Nothing fails. There was no need for a field-key test when the consumer was a PHP
template ten lines away; there is an urgent need for one when the consumer is a different
application in a different language deployed on a different host.

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
