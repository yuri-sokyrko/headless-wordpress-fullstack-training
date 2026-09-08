---
title: 'WP Integration & GraphQL Contract Tests'
module: 23
lesson: 5
teaches: [wp-phpunit, integration-testing, acf-key-contract, block-json-registration, graphql-execution-tests, schema-drift, graphql-eslint]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/bootstrap.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/wp-tests-config.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Integration/PostTypesTest.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Integration/AcfKeysTest.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Integration/GraphQLSchemaTest.php', 'wordpress-headless/schema.graphql', 'next-app/eslint.config.mjs']
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

### 1. What is only true when WordPress is really running

Lesson 23.4's suite proved arithmetic. This one proves the things that are not statements about
your code at all — they are statements about what WordPress, WPGraphQL and ACF *did with* your
code.

| Claim | What actually has to have happened |
|---|---|
| `incident` is in the schema as `Incident` / `Incidents` | `register_post_type` ran on `init`, and WPGraphQL read `graphql_single_name` off the registered object at `graphql_register_types` |
| `publish_incidents` exists as a capability name | core's `get_post_type_capabilities()` **generated** eleven names from `capability_type` + `map_meta_cap` |
| `incident_reporter` does **not** hold it | the role's capability array was written to `wp_options` → `wp_user_roles` |
| `register_block_type` found `block.json` | the file exists on disk, at `build/incident-callout/block.json`, and parsed |
| an anonymous caller sees no `pending` incident | WPGraphQL's Model layer decided, against a real user context |
| `field_incident_occurred_at` is loaded | ACF is active and read `includes/acf-json/` at `acf/init` |

Every row shares a shape: **your code is one input among several, and the output belongs to
somebody else.** That is the definition of an integration test, and it is why mocking
`register_post_type()` proves nothing about any row above. It is also the suite that catches the
most expensive class of bug in a headless build — *the plugin activated and the schema is wrong* —
which surfaces in TypeScript, at runtime, in production, as `null` on a field codegen types as
`String`.

### 2. `WP_UnitTestCase`, factories, and transaction-per-test

If you have written a WordPress test before, you wrote it against this class, and nothing about it
changes here.

| Facility | What it gives you |
|---|---|
| `$this->factory->post->create( [ 'post_type' => 'incident' ] )` | a real row in `wp_posts`, with real meta, real terms and a real ID |
| `$this->factory->user->create( [ 'role' => 'incident_reporter' ] )` | a real user with a real capability array |
| `wp_set_current_user( $id )` | a real current-user context, so `current_user_can()` answers for real |
| a transaction per test, rolled back in `tearDown` | test 2 cannot see test 1's post, without a truncate |

The isolation is worth understanding rather than trusting. `setUp()` issues `START TRANSACTION`
and `tearDown()` issues `ROLLBACK`, so every insert vanishes — Verification check 4 asserts exactly
that, and it is what tells you the isolation is real. **Anything that commits escapes it**: a DDL
statement, an explicit `COMMIT`, or code opening its own connection. That is rare in plugin code
and it is the first thing to look for when a test passes alone and fails in the suite.

The honest cost: **a few seconds of boot** before the first assertion, because WordPress installs
itself into `wp_test` on every run. That is why suite 4 is not the suite you run on save, and why
Lesson 23.4 exists at all.

### 3. Roles are database state, so the bootstrap has to run the activation path

This one costs an hour if you meet it by accident, and it is not in any tutorial.

Loading the plugin file registers **hooks**. It does not create a role. `ensure_reporter_role()`
runs in `Plugin::activate()`, and `activate()` runs on `register_activation_hook` — which
`wp-phpunit` never fires, because nothing ever activates anything.

```
   WITHOUT Plugin::activate()               WITH it, in tests/bootstrap.php
   ──────────────────────────────────       ──────────────────────────────────
   plugin file loaded                       plugin file loaded
   init fires → post types registered ✅    init fires → post types registered ✅
   get_role('incident_reporter') → null ❌  Plugin::activate() → add_role() ✅
                                            wp_roles()->for_site() → reloaded ✅
   the capability test fails with
   "user_can(): role does not exist" —
   which reads like a broken test, not
   like missing state.
```

So `tests/bootstrap.php` calls `\Blame\Core\Plugin::activate()` once, **after** the WordPress
bootstrap and **before** the first test's transaction — so the role, the seeded terms and the
`btt_roles_version` option are committed for the whole run and survive every rollback.

`wp_roles()->for_site()` afterwards is the detail people miss. `WP_Roles` caches the
`wp_user_roles` option in a singleton that was built during bootstrap, before `add_role()` wrote
to it. Without the reload, `get_role()` answers from a stale cache and the capability test fails
for a reason that has nothing to do with capabilities. (`reinit()` is the older spelling of the
same thing and is deprecated.)

> **A genuine benefit falls out of this.** `Plugin::activate()` runs on every deploy in this
> architecture (Lesson 03.1's `release_command`), so it has to be idempotent — and calling it here
> means the suite exercises the activation path on every run, which is more coverage of it than
> anything else provides.

### 4. WordPress comes from Composer, and one version constraint will bite

| Source of WordPress for the test suite | Verdict |
|---|---|
| `wp scaffold plugin-tests` + `bin/install-wp-tests.sh` | a shell script, a `/tmp` path, a curl, and a version nobody records |
| the WordPress already in the container at `/var/www/html` | tempting, and wrong: a CI runner has no such container, so CI and local diverge |
| **`wp-phpunit/wp-phpunit` + `roots/wordpress-no-content`, as dev dependencies** | ✅ **chosen.** The version is in `composer.lock`, `composer install` is the only setup step, and a runner and your laptop get byte-identical WordPress |

`roots/wordpress-no-content` is core **without** `wp-content`, which is exactly right: your
`wp-content` is the repository. `wp-phpunit/wp-phpunit` is core's own `tests/phpunit` directory,
published as a package.

Two configuration details follow, and both go in `wp-tests-config.php`: **`ABSPATH`** points at
`vendor/roots/wordpress-no-content/` — the Composer copy, in both environments, for parity — and
**`WP_CONTENT_DIR`** points at the real `wp-content`, computed as `dirname( __DIR__, 3 )`. Without
the second, `WP_CONTENT_DIR` defaults inside the Composer copy where there are no plugins at all,
so WPGraphQL and ACF are invisible and every schema test skips.

**Now the constraint, and it is the one thing here that may not resolve on your machine.** Pest 3
requires PHPUnit 11; WordPress core's test suite supports a specific range of PHPUnit majors and
refuses others in its own bootstrap; `yoast/phpunit-polyfills` is the shim between them. All three
have to agree, and which triple agrees depends on your WordPress version:

```
   pestphp/pest  ──requires──▶  phpunit/phpunit  ◀──must be supported by──  wp-phpunit
                                       ▲
                                       └── yoast/phpunit-polyfills bridges the gap
```

**Reasoned, not executed.** This course cannot run Composer, so treat Step 2's versions as a
starting point rather than a fact. If the bootstrap aborts naming an unsupported PHPUnit version,
the fix is mechanical: lower `pestphp/pest` by one major, `composer update`, and **record the
triple that worked** in a comment in `composer.json`. Never patch anything under `vendor/`. Lesson
24.4 installs from the same `composer.lock`, so a pin that works locally works there — the entire
reason this lives in Composer rather than in a shell script.

### 5. Two suites, two containers, one `composer.json` — said plainly

| | Suite 3 — unit | Suite 4 — integration |
|---|---|---|
| Needs WordPress | no — it is mocked out | **yes**, plus a real MySQL |
| Local invocation | `docker compose run --rm composer run test:unit` | `docker compose exec -T -w /var/www/html/$PLUGIN wordpress php vendor/bin/pest --testsuite=integration` |
| Why not the other container | the stock `wordpress` image has **no Composer binary** | the `composer` service has **no WordPress** |
| On a CI runner | `composer test:unit` | `composer test:integration` — both verbatim |

Read the last row. On a runner with PHP, Composer and a MySQL service, both run by name. Locally
only the first does, because the container that has WordPress has no Composer and the container
that has Composer has no WordPress. That asymmetry is a teaching point rather than a wart: **a
Composer script documents a command; it does not guarantee every host can run it** — as true of
every `package.json` script you have written. Declaring `test:integration` anyway is what makes
Lesson 24.4's `_php.yml` a three-line job instead of a copied incantation.

### 6. ACF field-group keys are a public contract

`field_incident_occurred_at` looks like an implementation detail. It is a join, across three
languages and two deployables:

```
   includes/acf-json/group_incident_details.json
        "key": "field_incident_occurred_at",  "name": "occurred_at"
             │
             ▼  ACF registers the field; WPGraphQL for ACF exposes it
   GraphQL:  incidentDetails { occurredAt }
             │
             ▼  graphql-codegen reads wordpress-headless/schema.graphql
   TypeScript: IncidentDetails['occurredAt']: string | null
             │
             ▼
   src/components/incidents/IncidentCard.tsx renders it
```

Rename the **key** in wp-admin and ACF treats it as a *different field*: the old meta rows stay
put, the new field reads nothing, and the front end gets `null` on a field whose generated
TypeScript type still says `String`, on a page that renders perfectly with a section missing.
**Nothing fails** — no error, no log line, no failing type check, no HTTP status.

Two tests, answering different questions. `json_decode` the file and assert every expected key is
present: needs **no ACF, no licence, no database**, and catches a rename, a deletion or a merge
that dropped a field. Then `acf_get_fields( 'group_incident_details' )` and assert the same set:
needs ACF, and catches a group ACF *refused to load* — bad JSON, a location rule that excludes
everything, a PRO-only field type on ACF free.

The first is the primary assertion **precisely because it needs nothing**. ACF PRO requires a
licence key (`ACF_PRO_LICENSE`, appendix 04 §2), so a CI runner may not have ACF at all — and a
contract test that only runs where ACF is installed gets skipped in the one place it matters. The
runtime assertion is second, guarded by `function_exists()`, and it **skips loudly**.

> **A skipped test is not a passing test.** PHPUnit reports skips separately and CI is happy to be
> green with forty of them. Read the skip count on every run; Lesson 24.4 owns closing it.

### 7. The schema is a contract, and `--output` is not optional

`wp graphql generate-static-schema` writes the SDL for the whole schema to a file. The file is
committed, at **`wordpress-headless/schema.graphql`** — never under `next-app/`, because WordPress
owns the schema and the snapshot belongs beside the thing that produces it.

```bash
# (illustration) the exact invocation, and the flag that is mandatory
docker compose run --rm wpcli wp graphql generate-static-schema \
  --output=/var/www/html/wp-content/plugins/blame-the-tech-core/schema.graphql
```

**Without `--output`, WPGraphQL writes to `get_temp_dir() . 'schema.graphql'`** — which is `/tmp`
inside the `wpcli` container, and `--rm` deletes that container the instant the command finishes.
The command reports success. Nothing appears. Lesson 06.3 learned this the hard way and the flag
has been mandatory ever since. The `--output` path is inside the plugin's bind mount, which is why
the invocation is followed by an `mv` into place — the only path both the container and your disk
agree on.

The drift gate has three parts, and each fails at a different moment. Regenerating and running
`git diff --exit-code -- schema.graphql` catches a schema change nobody committed — a new plugin, a
renamed field, an upgraded WPGraphQL. `npm run codegen:check` catches a **committed** schema change
whose generated types were never regenerated. `@graphql-eslint` catches a document selecting a
field the schema does not have, at lint time, in the file you edited. The first is a human action
reviewed like any change; the other two are CI gates. And none of the three needs a running
WordPress.

### 8. The payoff — no CI job ever needs WordPress or a credential

Appendix 04 §7 makes a promise: *CI never needs WordPress credentials.* This is the mechanism.

```
   WITHOUT a committed schema                WITH one
   ──────────────────────────────────        ──────────────────────────────────
   codegen introspects a live WP             codegen reads a FILE
        │                                        │
        ├─ CI needs a WordPress               ├─ CI needs nothing
        ├─ CI needs a database password       ├─ no secret in the job at all
        ├─ CI needs the network to be up      ├─ no network
        └─ a flaky WP = a red build           └─ a file either matches or it does not
        for reasons unrelated to the diff
```

`npm run codegen:check` runs with Docker stopped — Lesson 10.2 verified exactly that. The whole
front-end pipeline is offline and hermetic, and the only job in the workflow that touches a
database is this integration suite. Which is why it runs last and is the first thing path-filtered
out of a front-end-only pull request.

> **The trade, stated.** A snapshot can be stale, and then every generated type is confidently
> wrong. The gate is the answer: CI regenerates and fails on a diff. A snapshot *without* that
> gate is worse than introspection, because it is wrong silently instead of loudly.

### 9. In-process `graphql()` beats an HTTP round trip in a test

WPGraphQL exposes a PHP function that executes a query against the schema in the current process:

```php
// (illustration) the whole API
$result = graphql( array( 'query' => '{ incidents { nodes { slug } } }' ) );
// $result['data'] / $result['errors'] — the same shape the HTTP endpoint returns
```

| | in-process `graphql()` | HTTP to `/graphql` |
|---|---|---|
| Needs a web server | no | yes — a second process, a port, a readiness wait |
| Sees the test's transaction | **yes** — same connection, so a factory-created post is visible | **no** — a separate connection cannot see an uncommitted row |
| Current user | `wp_set_current_user()` applies directly | you would have to authenticate over the wire |
| Tests the HTTP layer | no | yes — CORS, auth headers, the JWT plugin |
| Flake sources | none | the port, the boot, the network |

Row 2 is decisive. A factory-created `pending` incident exists only inside this connection's
transaction, so an HTTP request could not see it at all — you would have to commit, which destroys
the isolation. In-process execution is not a convenient approximation; it is the only form that
works with the isolation you want.

What it does **not** cover is real: the HTTP layer, the JWT plugin's header parsing, CORS, and the
app-token guard's `$_SERVER` read. Those are Lesson 23.6's, over a real socket.

### 10. `@graphql-eslint` validates every document against the file

Codegen fails on an invalid document eventually, in a command you run less often than the linter.
`@graphql-eslint` moves it left: it parses `.graphql` files with a GraphQL parser and validates
them against the committed schema, in `npm run lint`, in your editor, on save.

| Failure | Codegen | `@graphql-eslint` |
|---|---|---|
| selecting a field that does not exist | on the next `npm run codegen` | **immediately, in the file you edited** |
| an anonymous operation | no | yes — a name is what MSW matches on (Lesson 23.2) |
| a duplicated operation name | as a confusing type collision | by name |
| selecting a `@deprecated` field, or an unspread fragment | no | yes, with the rule enabled |

Three integration details decide whether this works at all. **It is one flat-config object scoped
to `files: ['**/*.graphql']`** — ESLint 9 lints any file matching a non-universal `files` pattern
when it walks a directory, so no new npm script and no `--ext` flag is needed. **It goes *before*
`prettier`**, which only *disables* rules: anything after it could re-enable a formatting rule and
start a fight. And **`npm run lint` runs `--max-warnings=0`**, so a preset rule set at `warn` fails
the build exactly as an `error` does — convenient, and a trap, because a preset shipping half its
rules at `warn` looks advisory in the config and behaves as blocking in CI.

This lesson does **not** touch `linterOptions`. Lesson 07.5 already sets
`reportUnusedDisableDirectives: 'error'`, so the new object carries nothing but `files`,
`languageOptions`, `plugins` and `rules` — one key per lesson, so two concurrent edits cannot
collide.


---

## Task

Nine steps: a database, three dependencies, two config edits, three test files, a schema refresh
and a lint rule. Every command assumes `wordpress-headless/` with
`PLUGIN=wp-content/plugins/blame-the-tech-core` exported, unless it says otherwise.

### Step 1: Create the `wp_test` database and a user with rights to it and nothing else

Never the development database — `wp-phpunit` **drops and recreates every table** on each run. And
never `root`, for the same reason 02.2's `MYSQL_USER` is `btt`: least privilege applied to the
cheapest possible target.

The password comes from the invoking shell and is never written to a file. Appendix 04 §9 records
that Module 23 introduces **no new env-file variable**, and this is why: a test-database credential
is a session variable, like the three `BTT_*_PASSWORD` rows in appendix 04 §2.

```bash
cd wordpress-headless
export PLUGIN=wp-content/plugins/blame-the-tech-core
export WP_TESTS_DB_PASSWORD="$(openssl rand -base64 24 | tr -d '\n=+/')"
```

```bash
# The heredoc is evaluated on YOUR shell, so $WP_TESTS_DB_PASSWORD expands here and
# travels over stdin. `$MYSQL_ROOT_PASSWORD` is inside SINGLE quotes, so it expands
# inside the container against the container's own environment — the same trick the
# db healthcheck uses in Lesson 02.2, and for the same reason: the root password
# never appears in your shell history or in `docker compose config`.
docker compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"' <<SQL
CREATE DATABASE IF NOT EXISTS wp_test DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'wp_test'@'%' IDENTIFIED BY '$WP_TESTS_DB_PASSWORD';
GRANT ALL PRIVILEGES ON wp_test.* TO 'wp_test'@'%';
FLUSH PRIVILEGES;
SQL
```

`ON wp_test.*` and not `ON *.*`: the suite needs `CREATE`, `DROP` and `ALTER` inside its own
database and nothing outside it. A `wp_test` user who can read `btt` is a test suite one typo away
from truncating your development content.

> **This does not survive `docker compose down -v`.** That destroys `btt-db-data` and the test
> database with it. Both `IF NOT EXISTS` clauses make re-running the block free, so put it in your
> notes beside `npm run e2e:reset` — and note that `WP_TESTS_DB_PASSWORD` is written nowhere, so it
> has to be re-exported in any new shell. A `/docker-entrypoint-initdb.d` script would automate half
> of this and would make `docker compose up` fail for anyone who had not exported the variable,
> which is a worse trade.

**Verify §1:**

- [ ] The `wp_test` user can reach its own database:
      `docker compose exec -T -e P="$WP_TESTS_DB_PASSWORD" db sh -c 'mysql -uwp_test -p"$P" -e "SELECT DATABASE() FROM DUAL" wp_test'`
      prints `wp_test`.
- [ ] **NEGATIVE:** the same user cannot reach the development database:
      `docker compose exec -T -e P="$WP_TESTS_DB_PASSWORD" db sh -c 'mysql -uwp_test -p"$P" -e "SHOW TABLES" btt'`
      fails with `Access denied`. If it succeeds, the grant is too wide — `DROP` it and redo it.
- [ ] `git status --short` shows nothing new. No file was written in this step, and that is the
      point.

### Step 2: Add the three integration dependencies and the `test:integration` script

```bash
docker compose run --rm composer require --dev \
  wp-phpunit/wp-phpunit \
  roots/wordpress-no-content \
  yoast/phpunit-polyfills:^3.0
```

```json
{
  "scripts": {
    "phpcs": "phpcs",
    "phpcbf": "phpcbf",
    "test:unit": "pest --testsuite=unit",
    "test:integration": "pest --testsuite=integration"
  }
}
```

That is an anchored edit to the `scripts` block Lesson 23.4 left with three entries — the rest of
`composer.json` is unchanged.

> **The version triple, and the honest caveat.** `pestphp/pest` pins a PHPUnit major, WordPress's
> own test suite supports a range of PHPUnit majors and refuses others in its bootstrap, and
> `yoast/phpunit-polyfills` bridges them. This course cannot run Composer, so **these constraints
> are reasoned, not executed.** If Step 7's first run aborts with a message about an unsupported
> PHPUnit version, lower `pestphp/pest` by one major, `composer update`, and record the triple
> that worked in a comment in `composer.json`. Never edit anything under `vendor/`. Lesson 24.4
> installs from your `composer.lock`, so whatever resolves here is what CI gets.

**Verify §2:**

- [ ] `composer show --direct` lists all three, and `composer run --list` shows four scripts.
- [ ] `ls $PLUGIN/vendor/roots/wordpress-no-content/wp-settings.php` exists — the proof you have a
      real WordPress on disk rather than a metapackage.
- [ ] `composer run test:unit` still reports Lesson 23.4's 30 passing tests. Adding WordPress to
      `vendor/` must not affect a suite that mocks WordPress out.

### Step 3: Add the `integration` suite, and stop PHPCS sniffing your tests

Two anchored edits. First, `phpunit.xml.dist` gains a second `<testsuite>` — **with its own
bootstrap**, which is the whole reason the suites are separate elements rather than two directories
in one suite:

```xml
<?xml version="1.0"?>
<!-- wordpress-headless/wp-content/plugins/blame-the-tech-core/phpunit.xml.dist (fragment) -->
  <testsuites>
    <testsuite name="unit">
      <directory>tests/Unit</directory>
    </testsuite>

    <!-- NEW. Brain Monkey redefines the WordPress function set and a real
         WordPress has already defined it, so the two cannot share a process.
         Different bootstrap, different directory, never run together. -->
    <testsuite name="integration">
      <directory>tests/Integration</directory>
    </testsuite>
  </testsuites>
```

PHPUnit takes one `bootstrap` attribute for the whole file, so the integration bootstrap is
selected by pointing the root attribute at it and letting the unit suite ignore the extra work:

```xml
<?xml version="1.0"?>
<!-- wordpress-headless/wp-content/plugins/blame-the-tech-core/phpunit.xml.dist (fragment) -->
<phpunit
  bootstrap="tests/bootstrap.php"
  colors="true"
  failOnWarning="true"
  failOnRisky="true"
  cacheDirectory=".phpunit.cache"
>
```

`tests/bootstrap.php` therefore has to be safe to load for **both** suites: Step 4's version
requires the autoloader unconditionally and boots WordPress only when the test library is present
and a database password is in the environment. One file with a guard beats two files and a comment
explaining which is which.

Second, `phpcs.xml.dist` gains one exclusion:

```xml
<?xml version="1.0"?>
<!-- wordpress-headless/wp-content/plugins/blame-the-tech-core/phpcs.xml.dist (fragment) -->
  <exclude-pattern>*/vendor/*</exclude-pattern>
  <exclude-pattern>*/node_modules/*</exclude-pattern>
  <exclude-pattern>*/build/*</exclude-pattern>
  <!-- NEW. WPCS expects a file docblock, a class per file, snake_case variables and
       Yoda conditions. A Pest file is `it('...', function () { ... })` at file scope
       with camelCase closures — it violates a dozen sniffs by construction, and every
       one of those violations is a false positive.
       CATCH THIS HERE. A CI job that is red on arrival gets a `continue-on-error:
       true` within a week, and nobody ever removes it (Lesson 21.4's ratchet, applied
       to a linter). -->
  <exclude-pattern>*/tests/*</exclude-pattern>
```

The cost, stated: **test code now has no style gate.** The alternative is a per-sniff exclusion
list scoped to `*/tests/*` — more accurate, longer, and it drifts every time WPCS adds a sniff.
The reversal condition is a team that cares, and the price is the maintenance.

**Verify §3:**

- [ ] `pest --list-test-suites` prints **both** `unit` and `integration`.
- [ ] `composer run phpcs` is clean. Before this edit it reported dozens of false positives in
      `tests/` — run it once *before* adding the exclusion if you want to see what a CI job red on
      arrival looks like.
- [ ] `composer run test:unit` still reports 30 passing. The unit suite now loads
      `tests/bootstrap.php`, so a failure here means the guard is wrong.

### Step 4: Write the config and the bootstrap

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/wp-tests-config.php
/**
 * Database and path configuration for the wp-phpunit suite.
 *
 * NO CREDENTIAL IS WRITTEN HERE. Every value comes from the environment, injected
 * by the invoking shell (Step 7) — appendix 04 §9 records that Module 23 adds no
 * env-file variable, and a test-database password is a session credential.
 *
 * @package Blame\Core\Tests
 */

declare( strict_types=1 );

define( 'DB_NAME', getenv( 'WP_TESTS_DB_NAME' ) ?: 'wp_test' );
define( 'DB_USER', getenv( 'WP_TESTS_DB_USER' ) ?: 'wp_test' );
define( 'DB_PASSWORD', (string) getenv( 'WP_TESTS_DB_PASSWORD' ) );

// `db:3306`, never `localhost` — inside a container `localhost` is the container.
// Lesson 02.2 Key Concept 2, and the single most expensive misunderstanding in the
// whole stack.
define( 'DB_HOST', getenv( 'WP_TESTS_DB_HOST' ) ?: 'db:3306' );
define( 'DB_CHARSET', 'utf8mb4' );
define( 'DB_COLLATE', '' );

// A prefix of its own, so even a misconfigured DB_NAME cannot collide with `wp_`.
$table_prefix = 'wptests_';

// WordPress from Composer, in BOTH environments, for parity. Trailing slash required.
define( 'ABSPATH', dirname( __DIR__ ) . '/vendor/roots/wordpress-no-content/' );

// THE LINE PEOPLE MISS. `roots/wordpress-no-content` has no wp-content, so without
// this WP_CONTENT_DIR defaults inside the Composer copy — where there are no
// plugins, so WPGraphQL and ACF are invisible and every schema test skips.
// Three levels up from tests/ is wp-content, in the container and on a CI runner.
define( 'WP_CONTENT_DIR', dirname( __DIR__, 3 ) );

define( 'WP_TESTS_DOMAIN', 'localhost' );
define( 'WP_TESTS_EMAIL', 'admin@blamethe.tech' );
define( 'WP_TESTS_TITLE', 'Blame The Tech — tests' );
define( 'WP_PHP_BINARY', 'php' );
define( 'WP_DEBUG', true );

// No salts. WordPress generates and stores them on first install when they are
// undefined, so declaring them here would put nine secret-shaped literals into a
// tracked file to buy nothing at all.
```

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/bootstrap.php
/**
 * PHPUnit bootstrap for BOTH suites.
 *
 * The unit suite (Brain Monkey) needs only the autoloader; the integration suite
 * needs a whole WordPress. One file with a guard beats two files and a comment
 * explaining which is which.
 *
 * @package Blame\Core\Tests
 */

declare( strict_types=1 );

$btt_plugin_dir = dirname( __DIR__ );

require_once $btt_plugin_dir . '/vendor/autoload.php';

$btt_wp_phpunit = getenv( 'WP_PHPUNIT__DIR' ) ?: $btt_plugin_dir . '/vendor/wp-phpunit/wp-phpunit';

// The guard. `composer run test:unit` reaches this file too, and Brain Monkey
// cannot coexist with a real WordPress in one process — so if there is no database
// password in the environment, this is the unit suite and there is nothing to do.
if ( '' === (string) getenv( 'WP_TESTS_DB_PASSWORD' ) || ! is_dir( $btt_wp_phpunit ) ) {
	return;
}

putenv( 'WP_PHPUNIT__TESTS_CONFIG=' . __DIR__ . '/wp-tests-config.php' );

require_once $btt_wp_phpunit . '/includes/functions.php';

tests_add_filter(
	'muplugins_loaded',
	static function () use ( $btt_plugin_dir ): void {
		$plugins = dirname( $btt_plugin_dir );

		// Third-party first — WPGraphQL registers the types our plugin extends, and
		// ACF has to exist before includes/acf.php filters its settings. Each one is
		// GUARDED: a CI runner may not have ACF PRO at all (it needs a licence key),
		// and a test that needs a missing plugin must SKIP loudly rather than fatal.
		foreach ( array( 'wp-graphql/wp-graphql.php', 'advanced-custom-fields-pro/acf.php', 'wp-graphql-acf/wp-graphql-acf.php' ) as $optional ) {
			if ( file_exists( $plugins . '/' . $optional ) ) {
				require_once $plugins . '/' . $optional;
			}
		}

		require_once $btt_plugin_dir . '/blame-the-tech-core.php';

		// The blocks plugin registers from build/, which is gitignored. Loading it
		// anyway means the block.json test can tell "not built" from "malformed".
		if ( file_exists( $plugins . '/blame-the-tech-blocks/blame-the-tech-blocks.php' ) ) {
			require_once $plugins . '/blame-the-tech-blocks/blame-the-tech-blocks.php';
		}
	}
);

require $btt_wp_phpunit . '/includes/bootstrap.php';

// ── AFTER the bootstrap, BEFORE the first test's transaction ──────────────
// Loading a plugin registers hooks; it does not create a role. `activate()` runs
// on register_activation_hook, which nothing here ever fires — so without this,
// `get_role('incident_reporter')` is null and the capability test fails naming a
// role that does not exist. Key Concept 3.
//
// It is committed rather than rolled back, because it runs before any test opens a
// transaction, and it is idempotent by requirement (Lesson 03.1: activation runs on
// every deploy). So the suite also exercises the activation path on every run.
\Blame\Core\Plugin::activate();

// WP_Roles caches wp_user_roles in a singleton built during bootstrap — before
// add_role() wrote to it. `for_site()` reloads from the option. (`reinit()` is the
// deprecated spelling of the same thing.)
wp_roles()->for_site();
```

One anchored edit to `tests/Pest.php`, so `it()` works against `WP_UnitTestCase`:

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Pest.php (fragment — append)
// Guarded, because Pest.php is loaded for the UNIT suite too, where WordPress does
// not exist and a bare class reference would be a fatal error.
if ( class_exists( '\WP_UnitTestCase' ) ) {
	uses( \WP_UnitTestCase::class )->in( 'Integration' );
}
```

**Verify §4:**

- [ ] `docker compose run --rm composer run test:unit` still reports 30 passing, with
      `WP_TESTS_DB_PASSWORD` **unset** inside that container. The guard is what makes that true.
- [ ] `grep -c 'getenv' tests/wp-tests-config.php` is **4 or more**, and
      `grep -cE "PASSWORD.*=.*'[A-Za-z0-9]" tests/wp-tests-config.php` is `0`. No credential is in
      the file; every one is read from the environment.
- [ ] `grep -c 'WP_CONTENT_DIR' tests/wp-tests-config.php` is `1`. Without it every plugin-dependent
      test will skip, and a skipped test is not a passing test.

### Step 5: `PostTypesTest.php` — registration, GraphQL names, and the capability negative

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Integration/PostTypesTest.php
/**
 * What WordPress DID with our registrations. Not what we called.
 *
 * @package Blame\Core\Tests
 */

declare( strict_types=1 );

it( 'registers `incident` with the GraphQL names appendix 03 §1 promises', function (): void {
	$type = get_post_type_object( 'incident' );

	// `graphql_single_name` is the join between PHP and every generated TypeScript
	// type. Rename it and codegen produces a different type name, every query
	// stops compiling, and the failure is at least LOUD — unlike the ACF case.
	expect( $type )->not->toBeNull();
	expect( $type->show_in_graphql )->toBeTrue();
	expect( $type->graphql_single_name )->toBe( 'Incident' );
	expect( $type->graphql_plural_name )->toBe( 'Incidents' );
	expect( $type->public )->toBeTrue();
	expect( $type->hierarchical )->toBeFalse();
} );

it( 'supports exactly the five features the seeder and the mutation rely on', function (): void {
	// `custom-fields` is the one to watch: without it `register_post_meta` still
	// works but the REST and block-editor meta surfaces disappear, and ACF's
	// field-group location rules behave oddly. `author` is what makes
	// `post_author` meaningful for a reporter's own-incidents query.
	foreach ( array( 'title', 'editor', 'revisions', 'author', 'custom-fields' ) as $feature ) {
		expect( post_type_supports( 'incident', $feature ) )->toBeTrue();
	}

	expect( post_type_supports( 'incident', 'comments' ) )->toBeFalse();
} );

it( 'generates the incident capability family from capability_type + map_meta_cap', function (): void {
	$caps = get_post_type_object( 'incident' )->cap;

	// THIS is WordPress's behaviour, not ours. `capability_type: 'incident'` plus
	// `map_meta_cap: true` makes core GENERATE eleven names. A unit test asserting
	// we passed those two arguments proves we passed two arguments.
	expect( $caps->publish_posts )->toBe( 'publish_incidents' );
	expect( $caps->edit_others_posts )->toBe( 'edit_others_incidents' );
	expect( $caps->read_private_posts )->toBe( 'read_private_incidents' );

	// The one explicit override from Lesson 03.2, so a reporter can create without
	// being able to edit anyone else's.
	expect( $caps->create_posts )->toBe( 'create_incidents' );
} );

it( 'registers `tech_review` and the three taxonomies with their GraphQL names', function (): void {
	expect( get_post_type_object( 'tech_review' )->graphql_single_name )->toBe( 'TechReview' );

	$expected = array(
		'scapegoat'  => array( 'Scapegoat', 'Scapegoats' ),
		'severity'   => array( 'Severity', 'Severities' ),
		'tech_stack' => array( 'TechStack', 'TechStacks' ),
	);

	foreach ( $expected as $taxonomy => list( $single, $plural ) ) {
		$object = get_taxonomy( $taxonomy );

		expect( $object )->not->toBeFalse();
		expect( $object->show_in_graphql )->toBeTrue();
		expect( $object->graphql_single_name )->toBe( $single );
		expect( $object->graphql_plural_name )->toBe( $plural );
	}

	// `severity` is deliberately absent from REST (Lesson 03.3): it is moderated
	// through a radio meta box, not a free-text term field, and exposing it to the
	// block editor's taxonomy panel would let an editor invent an `s5`.
	expect( get_taxonomy( 'severity' )->show_in_rest )->toBeFalse();
} );

it( 'NEGATIVE: `incident_reporter` cannot publish, and CAN create', function (): void {
	// The most valuable assertion in the module. It is true because a role's
	// capability array lives in wp_options, `map_meta_cap` generated the names, and
	// core's user_can() walked both — none of which exists in a Brain Monkey
	// process, and all of which a mocked current_user_can() would have hidden.
	$reporter = self::factory()->user->create( array( 'role' => 'incident_reporter' ) );

	expect( user_can( $reporter, 'create_incidents' ) )->toBeTrue();
	expect( user_can( $reporter, 'edit_incidents' ) )->toBeTrue();

	expect( user_can( $reporter, 'publish_incidents' ) )->toBeFalse();
	expect( user_can( $reporter, 'edit_others_incidents' ) )->toBeFalse();
	expect( user_can( $reporter, 'delete_others_incidents' ) )->toBeFalse();
	expect( user_can( $reporter, 'read_private_incidents' ) )->toBeFalse();
} );

it( 'NEGATIVE: a contributor gets nothing, and an editor gets everything', function (): void {
	$contributor = self::factory()->user->create( array( 'role' => 'contributor' ) );
	$editor      = self::factory()->user->create( array( 'role' => 'editor' ) );

	// Appendix 03 §6's matrix, asserted against the authorisation layer that
	// enforces it. `revoke_incident_caps_from_core_roles()` is why contributor is
	// empty: the capability family would otherwise leak to every role that has
	// `edit_posts`.
	expect( user_can( $contributor, 'create_incidents' ) )->toBeFalse();
	expect( user_can( $editor, 'publish_incidents' ) )->toBeTrue();
	expect( user_can( $editor, 'edit_others_incidents' ) )->toBeTrue();
} );

it( 'isolates each test in a transaction — the post from the previous test is gone', function (): void {
	// Paired with the test below. Together they prove the isolation is real rather
	// than assumed, which is the property every other test in this file rests on.
	expect( get_posts( array( 'post_type' => 'incident', 'post_status' => 'any', 'numberposts' => -1 ) ) )
		->toHaveCount( 0 );

	self::factory()->post->create( array( 'post_type' => 'incident', 'post_status' => 'pending' ) );

	expect( get_posts( array( 'post_type' => 'incident', 'post_status' => 'any', 'numberposts' => -1 ) ) )
		->toHaveCount( 1 );
} );

it( 'NEGATIVE: still sees zero incidents, because the previous test rolled back', function (): void {
	expect( get_posts( array( 'post_type' => 'incident', 'post_status' => 'any', 'numberposts' => -1 ) ) )
		->toHaveCount( 0 );
} );
```

**Verify §5:**

- [ ] The last two tests must run **in file order** — check `phpunit.xml.dist` has no
      `executionOrder="random"`, or the pair is meaningless.
- [ ] A capability test failing about a role that does not exist means `bootstrap.php` is not
      calling `Plugin::activate()`, or not calling `wp_roles()->for_site()` after it. Key Concept 3.
- [ ] `grep -c 'register_post_type\|register_taxonomy' tests/Integration/PostTypesTest.php` is `0`.
      This file asserts **results**, never calls.

### Step 6: `AcfKeysTest.php` — the contract that fails silently

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Integration/AcfKeysTest.php
/**
 * ACF field-group keys and block.json, asserted as CONTRACTS.
 *
 * @package Blame\Core\Tests
 */

declare( strict_types=1 );

/** The keys the front end depends on, from appendix 03 §4. */
const BTT_INCIDENT_FIELD_KEYS = array(
	'field_incident_occurred_at',
	'field_incident_downtime_minutes',
	'field_incident_estimated_cost_usd',
	'field_incident_environment',
	'field_incident_resolution_status',
	'field_incident_blame_confidence',
	'field_incident_stack_trace',
	'field_incident_reporter_display_name',
	'field_incident_is_verified',
);

it( 'keeps every incident field key, read straight off the JSON', function (): void {
	// The PRIMARY assertion, and it deliberately needs NOTHING — no ACF, no
	// licence key, no database. A contract test that only runs where ACF PRO is
	// installed is a contract test that gets skipped in CI, which is the one place
	// it matters. Key Concept 6.
	$file = dirname( __DIR__, 2 ) . '/includes/acf-json/group_incident_details.json';

	expect( $file )->toBeReadableFile();

	$group = json_decode( (string) file_get_contents( $file ), true );

	expect( $group )->toBeArray();
	expect( $group['key'] )->toBe( 'group_incident_details' );
	expect( $group['graphql_field_name'] )->toBe( 'incidentDetails' );

	$keys = array_column( $group['fields'], 'key' );

	// Rename ANY of these in wp-admin and ACF treats it as a different field: the
	// old meta rows stay put, the new field reads nothing, and TypeScript gets
	// `null` on a field codegen still types as `String`. No error, anywhere.
	foreach ( BTT_INCIDENT_FIELD_KEYS as $key ) {
		expect( $keys )->toContain( $key );
	}

	// And the name→key pairing, because a key can survive while its `name` moves —
	// and `name` is what becomes the GraphQL field.
	$by_key = array_column( $group['fields'], 'name', 'key' );

	expect( $by_key['field_incident_occurred_at'] )->toBe( 'occurred_at' );
	expect( $by_key['field_incident_is_verified'] )->toBe( 'is_verified' );
} );

it( 'agrees with what ACF actually loaded, when ACF is present', function (): void {
	if ( ! function_exists( 'acf_get_fields' ) ) {
		// SKIPPED, loudly. ACF PRO needs a licence key (appendix 04 §2), so a CI
		// runner may legitimately not have it. Read the skip count on every run:
		// a skipped test is not a passing test, and Lesson 24.4 owns closing this.
		$this->markTestSkipped( 'ACF is not active; the JSON contract test above still ran.' );
	}

	$loaded = array_column( (array) acf_get_fields( 'group_incident_details' ), 'key' );

	// This one catches what the JSON test cannot: a group ACF REFUSED to load —
	// malformed JSON, a location rule that matches nothing, a PRO-only field type
	// on ACF free. The JSON can be perfect and the group still absent.
	foreach ( BTT_INCIDENT_FIELD_KEYS as $key ) {
		expect( $loaded )->toContain( $key );
	}
} );

it( 'NEGATIVE: every block.json is valid and namespaced `btt/`', function (): void {
	$src = dirname( __DIR__, 3 ) . '/plugins/blame-the-tech-blocks/src';

	if ( ! is_dir( $src ) ) {
		$this->markTestSkipped( 'The blocks plugin is not checked out.' );
	}

	$found = 0;

	foreach ( (array) glob( $src . '/*/block.json' ) as $file ) {
		$block = json_decode( (string) file_get_contents( (string) $file ), true );

		// Malformed JSON gives null, and register_block_type() would fail SILENTLY
		// on it — `continue`-ing past a directory it could not read. So the
		// assertion is on the parse first and the shape second.
		expect( $block )->toBeArray();
		expect( $block['apiVersion'] )->toBe( 3 );
		expect( $block['name'] )->toStartWith( 'btt/' );
		expect( $block['textdomain'] )->toBe( 'blame-the-tech-blocks' );

		++$found;
	}

	expect( $found )->toBe( 6 );
} );

it( 'confirms the blocks are REGISTERED, when build/ exists', function (): void {
	$registry = WP_Block_Type_Registry::get_instance();

	if ( ! $registry->is_registered( 'btt/incident-callout' ) ) {
		// `build/` is gitignored, so a fresh clone has no built blocks and
		// register_blocks() `continue`s past every one of them without a notice.
		// That degradation is deliberate (Lesson 13.1) and it means this assertion
		// can only be made after `npm run build` in the blocks plugin.
		$this->markTestSkipped( 'build/ is absent — run the blocks build first.' );
	}

	foreach ( array( 'incident-callout', 'blame-quote', 'scapegoat-picker', 'incident-ticker', 'hobt-cta', 'tech-verdict-card' ) as $slug ) {
		expect( $registry->is_registered( 'btt/' . $slug ) )->toBeTrue();
	}
} );
```

**Verify §6:**

- [ ] Four tests. Read the **skip count**: three of four skipping means the environment has no ACF
      and no block build, and only the JSON contract test ran. Usable, and not green.
- [ ] **NEGATIVE, on a probe copy.** Rename a key and watch the primary test fail:
      `sed -i.bak 's/field_incident_occurred_at/field_incident_happened_at/' includes/acf-json/group_incident_details.json`,
      re-run, then `mv includes/acf-json/group_incident_details.json.bak includes/acf-json/group_incident_details.json`.
      One test fails and names the key. Before this test existed, the same rename produced a
      `null` on a page that rendered perfectly.
- [ ] **NEGATIVE.** Break a `block.json` the same way — remove a closing brace on a `.bak` copy —
      and confirm the third test fails on `toBeArray()` rather than on a missing key. A malformed
      `block.json` makes `register_block_type()` skip the block with no notice at all.

### Step 7: `GraphQLSchemaTest.php` — execute the schema in this process

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Integration/GraphQLSchemaTest.php
/**
 * In-process schema execution. The test's own transaction is visible to it,
 * which an HTTP request could never be. Key Concept 9.
 *
 * @package Blame\Core\Tests
 */

declare( strict_types=1 );

beforeEach(
	function (): void {
		if ( ! function_exists( 'graphql' ) ) {
			$this->markTestSkipped( 'WPGraphQL is not active in this environment.' );
		}
	}
);

it( 'resolves blameScore from the same arithmetic Lesson 23.4 unit-tested', function (): void {
	$post_id = self::factory()->post->create(
		array( 'post_type' => 'incident', 'post_status' => 'publish', 'post_name' => 'incident-int-01' )
	);

	wp_set_object_terms( $post_id, 's2-major', 'severity' );
	update_post_meta( $post_id, 'blame_confidence', 99 );
	update_post_meta( $post_id, 'downtime_minutes', 500 );

	$result = graphql(
		array(
			'query'     => 'query ($slug: ID!) { incident(id: $slug, idType: SLUG) { blameScore } }',
			'variables' => array( 'slug' => 'incident-int-01' ),
		)
	);

	// 297.0 — the same number as the unit test, reached through a real resolver.
	// If these two ever disagree, one of them is wrong and you will know which
	// within a minute, which is the whole reason both exist.
	expect( $result )->not->toHaveKey( 'errors' );
    expect( $result['data']['incident']['blameScore'] )->toBe( 297.0 );
} );

it( 'NEGATIVE: an anonymous caller sees no PENDING incident', function (): void {
	self::factory()->post->create(
		array( 'post_type' => 'incident', 'post_status' => 'pending', 'post_name' => 'incident-int-pending' )
	);

	wp_set_current_user( 0 );

	// No `where: { status: PUBLISH }` filter, deliberately. The client documents all
	// carry one (Lesson 10.5), and asserting with it would test the FILTER. This
	// asserts WPGraphQL's Model layer: an unauthenticated caller must not see a
	// pending post even when nothing asked it not to.
	$result = graphql( array( 'query' => '{ incidents { nodes { slug } } }' ) );

	$slugs = array_column( (array) ( $result['data']['incidents']['nodes'] ?? array() ), 'slug' );

	expect( $slugs )->not->toContain( 'incident-int-pending' );
} );

it( 'NEGATIVE: the same caller sees it once they can edit others incidents', function (): void {
	self::factory()->post->create(
		array( 'post_type' => 'incident', 'post_status' => 'pending', 'post_name' => 'incident-int-pending' )
	);

	wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

	$result = graphql( array( 'query' => '{ incidents(where: { status: PENDING }) { nodes { slug } } }' ) );

	// The positive half. Without it, the negative above would also pass if the
	// resolver returned nothing to anybody — which is a broken schema, not a
	// working authorisation layer.
	$slugs = array_column( (array) ( $result['data']['incidents']['nodes'] ?? array() ), 'slug' );

	expect( $slugs )->toContain( 'incident-int-pending' );
} );

it( 'NEGATIVE: the generated createIncident mutation is not in the schema', function (): void {
	// Lesson 06.2 set `graphql_exclude_mutations` so WPGraphQL's generated CRUD is
	// gone and only the guarded custom mutation remains. An upgrade that
	// re-registers it would hand an authenticated reporter a way to set
	// `post_status` directly, and nothing else in the stack would notice.
	$result = graphql(
		array( 'query' => '{ __type(name: "RootMutation") { fields { name } } }' )
	);

	$fields = array_column( (array) $result['data']['__type']['fields'], 'name' );

	expect( $fields )->toContain( 'createIncident' );
	expect( $fields )->not->toContain( 'updateIncident' );
	expect( $fields )->not->toContain( 'deleteIncident' );
} );

it( 'NEGATIVE: the incident query limit is clamped at 50 nodes', function (): void {
	// Lesson 06.4's `graphql_connection_max_query_amount` filter. Asking for 500
	// must not return 500, and this is testable in-process because the filter runs
	// in this process.
	$result = graphql( array( 'query' => '{ incidents(first: 500) { nodes { slug } } }' ) );

	expect( $result )->not->toHaveKey( 'errors' );
	expect( count( (array) ( $result['data']['incidents']['nodes'] ?? array() ) ) )->toBeLessThanOrEqual( 50 );
} );
```

Run it:

```bash
cd wordpress-headless
docker compose exec -T \
  -e WP_TESTS_DB_PASSWORD="$WP_TESTS_DB_PASSWORD" \
  -w /var/www/html/wp-content/plugins/blame-the-tech-core \
  wordpress php vendor/bin/pest --testsuite=integration
```

The `-e` is how the password crosses into the container, from the shell that exported it in Step 1
and nowhere else. `-T` because there is no TTY in CI and a hung `exec` in a workflow is a
twenty-minute timeout.

**Verify §7:**

- [ ] The suite boots, after several seconds of `Installing…` — WordPress installing itself into
      `wp_test`, and the honest cost of suite 4.
- [ ] If it aborts naming an unsupported PHPUnit version, go back to Step 2's caveat. That is the
      one constraint this course could not verify for you.
- [ ] `-e WP_TESTS_DB_PASSWORD` is present. Without it `DB_PASSWORD` is `''` and the failure reads
      `Error establishing a database connection`, which names the wrong problem.
- [ ] Read the skip count. Every skip is a plugin this environment lacks and a row 24.4 must close.

### Step 8: Refresh the schema snapshot and prove the drift gate

The schema changed the moment Module 14 added block types and Module 20 added Polylang. Refresh it
deliberately, and review the diff like any other change.

```bash
cd next-app
npm run schema:pull
git diff --stat -- ../wordpress-headless/schema.graphql
```

`schema:pull` (Lesson 10.2) wraps the whole invocation including the mandatory `--output` and the
`mv` — read it once with `npm pkg get scripts.schema:pull`, so the flag is not folklore. Then
regenerate the types the new schema implies:

```bash
npm run codegen
git status --short src/gql/
npm run codegen:check
```

**Verify §8:**

- [ ] `npm run codegen:check` exits `0`. It regenerates and then diffs `src/gql/`, so a non-zero
      exit means the committed types do not match the committed schema — commit the new ones.
- [ ] **NEGATIVE.** Break the snapshot on a probe copy:
      `sed -i.bak 's/blameScore/blameScoreTypo/' ../wordpress-headless/schema.graphql`, then
      `npm run codegen; echo "exit=$?"`, then restore from the `.bak`. Codegen fails naming the
      documents that select a field that no longer exists.
- [ ] `npm run codegen:check` works with **Docker stopped** — the whole of Key Concept 8.
- [ ] `test -f schema.graphql && echo WRONG` prints nothing from inside `next-app/`.

### Step 9: Lint every GraphQL document against the schema

```bash
cd next-app
npm view @graphql-eslint/eslint-plugin license
# Expected: MIT
npm install --save-dev @graphql-eslint/eslint-plugin
```

One new config object in `eslint.config.mjs`, placed **before** the trailing `prettier` entry:

```js
// next-app/eslint.config.mjs (fragment — the import, and ONE new config object)
import graphqlPlugin from '@graphql-eslint/eslint-plugin';

// …then, inside the exported array, AFTER the existing objects and BEFORE `prettier`:
  {
    // ESLint 9 lints any file matching a non-universal `files` pattern when it
    // walks a directory, so this needs no new npm script and no --ext flag. It
    // folds into `npm run lint`.
    files: ['**/*.graphql'],
    plugins: { '@graphql-eslint': graphqlPlugin },
    languageOptions: {
      parser: graphqlPlugin.parser,
      parserOptions: {
        graphQLConfig: {
          // A FILE, reached across the repository — the same path codegen.ts uses
          // (Lesson 10.2). No endpoint, no credential, no running WordPress.
          schema: '../wordpress-headless/schema.graphql',
          documents: 'src/graphql/**/*.graphql',
        },
      },
    },
    rules: {
      // `npm run lint` runs --max-warnings=0, so a preset rule set at `warn` still
      // FAILS the build. Read the preset before you trust it to be advisory.
      ...graphqlPlugin.configs['flat/operations-recommended'].rules,

      // An anonymous operation is a document MSW cannot match on (Lesson 23.2)
      // and codegen cannot name a type after. Explicit, at error.
      '@graphql-eslint/no-anonymous-operations': 'error',
      '@graphql-eslint/unique-operation-name': 'error',
    },
  },
```

The file already holds the ignores block, `js.configs.recommended`, the type-aware
`typescript-eslint` tier with its `linterOptions`, the plain-JS override and — from Lesson 23.7 —
an `e2e/**` block. **This lesson adds one object and touches nothing else**, and in particular no
second `linterOptions`: `reportUnusedDisableDirectives: 'error'` has been set since Lesson 07.5.

> **Reasoned, not executed.** The plugin's flat-config export names moved between majors —
> `parser`, `configs['flat/…']` and `parserOptions.graphQLConfig` are the v4 spellings. If ESLint
> reports "Cannot read properties of undefined", print the export map with
> `node -e "import('@graphql-eslint/eslint-plugin').then(m => console.log(Object.keys(m.default ?? m)))"`
> and adjust. The *shape* — one object, scoped to `**/*.graphql`, pointing at the committed schema
> — does not change.

**Verify §9:**

- [ ] `npm run lint` passes, and `npx eslint src/graphql --no-ignore -f json | head -c 200` shows
      the `.graphql` files were actually visited. A silent pass can mean "clean" or "linted
      nothing", and those look identical from the exit code.
- [ ] **NEGATIVE.** On a probe copy, `sed -i.bak 's/blameScore/blameScoreTypo/'
      src/graphql/incidents.graphql`, run `npm run lint; echo "exit=$?"`, restore from the `.bak`.
      Expect exit `1` naming the field and the line. A pass means the `schema:` path is wrong and
      the plugin is validating every document against nothing.
- [ ] `prettier` is still the **last** element of the exported array.


---

## Verification

```bash
cd wordpress-headless
export PLUGIN=wp-content/plugins/blame-the-tech-core
# WP_TESTS_DB_PASSWORD must still be exported in this shell — Step 1.

# 1. Both suites exist and are separately addressable
docker compose run --rm composer exec -- pest --list-test-suites
# Expected: unit and integration, in that order

# 2. Suite 3 is unaffected by everything this lesson added
docker compose run --rm composer run test:unit
# Expected: 30 passed, in under a second of test time. WP_TESTS_DB_PASSWORD is not
#           set inside the `composer` service, so tests/bootstrap.php returns early
#           and Brain Monkey never meets a real WordPress.

# 3. Suite 4 boots and runs, in the container that HAS WordPress
docker compose exec -T \
  -e WP_TESTS_DB_PASSWORD="$WP_TESTS_DB_PASSWORD" \
  -w /var/www/html/wp-content/plugins/blame-the-tech-core \
  wordpress php vendor/bin/pest --testsuite=integration
# Expected: several seconds of "Installing…" — WordPress installing itself into
#           wp_test — then 17 tests. READ THE SKIP COUNT: every skip is a plugin
#           this environment does not have, and a skipped test is not a passing one.

# 4. The transaction isolation is real, not assumed
docker compose exec -T -e WP_TESTS_DB_PASSWORD="$WP_TESTS_DB_PASSWORD" \
  -w /var/www/html/wp-content/plugins/blame-the-tech-core wordpress \
  php vendor/bin/pest --testsuite=integration --filter="rolled back"
# Expected: 1 passed. The paired test before it creates an incident; this one
#           asserts there are zero. Every other assertion in the suite rests on
#           that, so it is worth having as its own check.

# 5. NEGATIVE — the most valuable assertion in the module
docker compose exec -T -e WP_TESTS_DB_PASSWORD="$WP_TESTS_DB_PASSWORD" \
  -w /var/www/html/wp-content/plugins/blame-the-tech-core wordpress \
  php vendor/bin/pest --testsuite=integration --filter="cannot publish"
# Expected: 1 passed. `incident_reporter` holds create_incidents and edit_incidents
#           and NOT publish_incidents — true because map_meta_cap generated the
#           names and the role's array is in wp_options. A Brain Monkey test with a
#           stubbed current_user_can() could never have made that claim.

# 6. NEGATIVE — no unit test crossed the line into this suite's territory
grep -rn 'user_can\|get_post_type_object\|get_taxonomy\|WP_UnitTestCase' $PLUGIN/tests/Unit/
# Expected: no output. Suite 3 mocks WordPress out; anything reaching for a real
#           registration or a real capability belongs in tests/Integration/.
grep -rn 'Brain\\Monkey\|Functions\\when' $PLUGIN/tests/Integration/
# Expected: no output. The reverse direction, and it FATALS rather than fails:
#           Brain Monkey redefining a function core has already defined is a
#           PHP-level redeclaration error, not a test failure.

# 7. NEGATIVE — the wp_test user cannot reach the development database
docker compose exec -T -e P="$WP_TESTS_DB_PASSWORD" db \
  sh -c 'mysql -uwp_test -p"$P" -e "SHOW TABLES" btt'; echo "exit=$?"
# Expected: "Access denied" and a non-zero exit. `wp-phpunit` DROPS AND RECREATES
#           every table on each run — a wp_test user who can see `btt` is one typo
#           in DB_NAME away from truncating your development content.

# 8. NEGATIVE — no credential is in any tracked file
grep -rnE "(secret|token|password)\s*[:=]\s*['\"][A-Za-z0-9/+_-]{16,}" $PLUGIN/tests/
# Expected: no output
grep -c 'getenv' $PLUGIN/tests/wp-tests-config.php
# Expected: 4 or more — DB_NAME, DB_USER, DB_PASSWORD and DB_HOST all read the
#           environment, and the password reaches the container only through
#           `docker compose exec -e`, from the shell that exported it.
git status --short $PLUGIN/ | grep -cE 'vendor/|\.phpunit\.cache|\.bak$'
# Expected: 0

# 9. NEGATIVE — WP_CONTENT_DIR points at the real wp-content, not the Composer copy
docker compose exec -T -w /var/www/html/wp-content/plugins/blame-the-tech-core wordpress \
  php -r 'require "tests/wp-tests-config.php"; echo WP_CONTENT_DIR, PHP_EOL;'
# Expected: /var/www/html/wp-content
#           If it prints a path under vendor/roots/, every plugin-dependent test
#           will skip — and forty skips look exactly like a green run.

# 10. The ACF key contract holds, and it holds WITHOUT ACF
docker compose run --rm composer exec -- php -r '
$g = json_decode(file_get_contents("includes/acf-json/group_incident_details.json"), true);
$k = array_column($g["fields"], "key");
echo in_array("field_incident_occurred_at", $k, true) ? "key present" : "KEY MISSING", PHP_EOL;'
# Expected: key present. Run from the `composer` service on purpose: this assertion
#           needs no ACF, no licence key and no database, which is exactly why it is
#           the PRIMARY test rather than the runtime one.

# 11. NEGATIVE — a renamed ACF key fails, on a probe copy
sed -i.bak 's/field_incident_occurred_at/field_incident_happened_at/' \
  $PLUGIN/includes/acf-json/group_incident_details.json
docker compose exec -T -e WP_TESTS_DB_PASSWORD="$WP_TESTS_DB_PASSWORD" \
  -w /var/www/html/wp-content/plugins/blame-the-tech-core wordpress \
  php vendor/bin/pest --testsuite=integration --filter="field key"; echo "exit=$?"
mv $PLUGIN/includes/acf-json/group_incident_details.json.bak \
  $PLUGIN/includes/acf-json/group_incident_details.json
# Expected: exit NON-ZERO, and the failure NAMES the key. Before this test existed,
#           the same rename produced `null` in a typed TypeScript field, on a page
#           that rendered perfectly with a section missing, with no error anywhere.

# 12. NEGATIVE — a malformed block.json fails on the parse, not on a missing key
sed -i.bak 's/"apiVersion": 3,/"apiVersion": 3/' \
  $PLUGIN/../blame-the-tech-blocks/src/incident-callout/block.json
docker compose exec -T -e WP_TESTS_DB_PASSWORD="$WP_TESTS_DB_PASSWORD" \
  -w /var/www/html/wp-content/plugins/blame-the-tech-core wordpress \
  php vendor/bin/pest --testsuite=integration --filter="block.json"; echo "exit=$?"
mv $PLUGIN/../blame-the-tech-blocks/src/incident-callout/block.json.bak \
  $PLUGIN/../blame-the-tech-blocks/src/incident-callout/block.json
# Expected: exit NON-ZERO, failing on toBeArray(). `register_block_type()` on an
#           unparseable block.json skips the block SILENTLY — no notice, no log —
#           so a parse assertion is the only thing that ever notices.

# 13. NEGATIVE — an anonymous caller sees no pending incident
docker compose exec -T -e WP_TESTS_DB_PASSWORD="$WP_TESTS_DB_PASSWORD" \
  -w /var/www/html/wp-content/plugins/blame-the-tech-core wordpress \
  php vendor/bin/pest --testsuite=integration --filter="anonymous caller"
# Expected: 1 passed, or SKIPPED if WPGraphQL is absent. The query carries no
#           `where: { status: PUBLISH }` filter on purpose — with one, the test
#           would assert the filter rather than WPGraphQL's Model layer.

# 14. The schema snapshot is regenerated, committed and gated
cd ../next-app
npm run schema:pull
git diff --exit-code -- ../wordpress-headless/schema.graphql; echo "exit=$?"
# Expected: exit=0 after you have committed the refreshed snapshot, and a reviewable
#           diff before that. The gate in Lesson 24.4's contract job is this exact
#           command, and it is why `--output` is mandatory: without it WPGraphQL
#           writes into the wpcli container's /tmp, which `--rm` then deletes, and
#           the command reports success having produced nothing.
npm run codegen:check
# Expected: exit 0 — regenerates from the FILE and finds no diff in src/gql/

# 15. NEGATIVE — the schema lives in exactly one place
ls schema.graphql 2>/dev/null; echo "exit=$?"
# Expected: a "No such file" and a non-zero exit. The snapshot belongs beside the
#           thing that produces it, at wordpress-headless/schema.graphql, and
#           codegen.ts reaches across the repository for it.

# 16. NEGATIVE — codegen needs no WordPress, no database and no credential
cd ../wordpress-headless && docker compose stop && cd ../next-app
npm run codegen:check; echo "exit=$?"
cd ../wordpress-headless && docker compose start && cd ../next-app
# Expected: exit=0 with the entire stack down. That is appendix 04 §7's promise made
#           real: the contract is a file, so no CI job holds a database password.

# 17. `@graphql-eslint` is live, and it is actually reading the schema
npm run lint
# Expected: no output
npx eslint src/graphql --no-ignore -f json | head -c 120
# Expected: JSON naming .graphql files. A silent pass can mean "clean" or "linted
#           nothing at all", and those are indistinguishable from the exit code.

# 18. NEGATIVE — an invalid document now fails the lint
sed -i.bak 's/blameScore/blameScoreTypo/' src/graphql/incidents.graphql
npm run lint; echo "exit=$?"
mv src/graphql/incidents.graphql.bak src/graphql/incidents.graphql
# Expected: exit=1, with a message naming the field and the line. If it passes, the
#           `schema:` path in eslint.config.mjs is wrong and the plugin is happily
#           validating every document against nothing.
npm run lint
# Expected: no output — restored

# 19. NEGATIVE — one new config object, and prettier is still last
grep -c 'graphql-eslint' eslint.config.mjs
# Expected: 4 or 5 — the import, the `plugins` key, the preset spread and the two
#           explicit rules. If it is 1, the object was added and never wired.
grep -c 'linterOptions' eslint.config.mjs
# Expected: 1 — Lesson 07.5's, with reportUnusedDisableDirectives already at
#           'error'. A second one here would be two lessons editing one key.
tail -3 eslint.config.mjs
# Expected: `prettier,` immediately before the closing `];`. It only DISABLES
#           rules, so anything after it could re-enable a formatting rule.
```

Check 16 is the one to run even if you skip the rest: it is the single sentence this whole lesson
exists to make true. Check 11 is the one to run even if you run nothing else — a renamed ACF key is
the only failure in this stack that produces no error message of any kind, anywhere.


## Control Questions

1. A colleague proposes deleting `tests/Unit/CreateIncidentTest.php` on the grounds that
   `tests/Integration/GraphQLSchemaTest.php` exercises the same mutation through a real schema and
   is therefore strictly better. Give the argument against in terms of what each suite can *make
   happen*, then name one assertion in the unit file that the integration file structurally cannot
   make.
2. `bootstrap.php` calls `Plugin::activate()` after the WordPress bootstrap and before the first
   test. Explain why the role it creates survives every test's rollback, what would happen if the
   call moved into a `beforeEach`, and why `wp_roles()->for_site()` on the next line is not
   optional.
3. The ACF key test reads the JSON file directly and a second test asks ACF what it loaded. Both
   assert the same nine keys. Describe a real failure that the first catches and the second does
   not, and one the second catches and the first does not — then say which you would keep if you
   could only keep one, and why that answer depends on your CI environment rather than on your code.
4. `npm run codegen:check` passes with Docker stopped, and `wordpress-headless/schema.graphql`
   could be six weeks stale while doing so. Explain how both are true at once, name the single
   check that closes the gap, and say what happens to the whole argument in Key Concept 8 if that
   check is ever set to `continue-on-error`.
5. `test:integration` is declared as a Composer script that does not run from the `composer`
   service, and `test:unit` is declared as one that does. A reviewer calls the first misleading and
   wants it deleted from `composer.json`. Argue for keeping it, name the specific consumer that
   would otherwise carry the invocation instead, and give the one thing you would add to the file
   to stop the next person being misled.


## Learn More

- [WordPress — Plugin integration tests](https://make.wordpress.org/cli/handbook/misc/plugin-unit-tests/)
  — the canonical `install-wp-tests.sh` path this lesson replaces; read it to see exactly which
  three moving parts moving to Composer removes
- [`wp-phpunit/wp-phpunit`](https://github.com/wp-phpunit/wp-phpunit) — core's own test library as
  a package, including the `WP_PHPUNIT__DIR` and `WP_PHPUNIT__TESTS_CONFIG` environment variables
  the bootstrap uses
- [`roots/wordpress-no-content`](https://github.com/roots/wordpress-no-content) — WordPress core
  minus `wp-content`, which is exactly the shape you want when `wp-content` is the repository
- [Yoast PHPUnit Polyfills](https://github.com/Yoast/PHPUnit-Polyfills) — the compatibility matrix
  in its README is the authoritative answer to Key Concept 4's version triple; check it against
  your WordPress version before you fight the bootstrap
- [WordPress — `WP_UnitTestCase` and the factories](https://make.wordpress.org/core/handbook/testing/automated-testing/phpunit/)
  — the factory API and the transaction-per-test contract, from the people who wrote it
- [WPGraphQL — `graphql()` PHP function](https://www.wpgraphql.com/docs/wp-graphql-vs-wp-rest-api/)
  — in-process execution, and the reminder that WPGraphQL's Model layer applies capability checks
  regardless of how the query arrived
- [WPGraphQL — `graphql generate-static-schema`](https://www.wpgraphql.com/docs/wp-cli) — the CLI
  command and its flags; the `--output` behaviour in Key Concept 7 is the one worth reading twice
- [`@graphql-eslint/eslint-plugin`](https://the-guild.dev/graphql/eslint/docs) — flat-config setup,
  the `graphQLConfig` key and the rule presets, including which rules ship at `warn` and therefore
  fail a `--max-warnings=0` build
- [ACF — Local JSON](https://www.advancedcustomfields.com/resources/local-json/) — how
  `acf-json/` loading works, and the paragraph on field keys that explains why a rename is a
  different field rather than a renamed one

