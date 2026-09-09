---
title: 'Testing WordPress PHP with Pest'
module: 23
lesson: 4
teaches: [pest, brain-monkey, php-unit-testing, mocking-wordpress, readable-test-names]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Unit/BlameScoreTest.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Unit/EnumsTest.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Unit/RevalidateTest.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Unit/CreateIncidentTest.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Unit/VerifiedGateTest.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Pest.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/phpunit.xml.dist', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/composer.json']
requires: [23.1, 06.2]
---

# Lesson 23.4 — Testing WordPress PHP with Pest

## Quick Overview

Half of this application is PHP, and it contains the parts that must not be wrong: the
capability checks, the enum mapping, the `blameScore` computation, the HMAC signature builder,
the lead validation. All of that is testable **without WordPress**, if you mock WordPress out —
and that is what Brain Monkey does. It stubs the WordPress function set so `add_action()`,
`get_post_meta()`, `wp_remote_post()` and friends exist as controllable doubles, letting you
assert `Functions\expect('wp_remote_post')->once()` or `Actions\has('init', ...)` and then run in
milliseconds with no database, no container boot and no fixture.

The runner is **Pest**, not raw PHPUnit, and the reason is legibility rather than features. Pest
sits on top of PHPUnit — same assertions, same coverage tooling, same CI integration — but its
test declarations read as sentences: `it('rejects anonymous submissions')`. That matters
disproportionately in a WordPress codebase, because the people who most need to read your tests
are frequently not the people who wrote them, and `it('rejects anonymous submissions')` is
legible as an acceptance criterion to someone who has never written a test in their life. A
`public function testSubmitIncidentRejectsWhenCurrentUserIdIsZero()` is not. The recommendation
is Pest; PHPUnit remains available underneath if you need a construct Pest does not express, and
nothing in the setup prevents you from mixing the two.

By the end of this lesson you will have:

- Pest and Brain Monkey as dev dependencies in the plugin's `composer.json`, its PSR-4 autoload
  wired for `tests/`, and `tests/Pest.php` starting and stopping Brain Monkey around every test
- `tests/Unit/BlameScoreTest.php` — the severity-weight computation, its boundaries, and its
  behaviour on missing meta
- Unit tests for the enum mapper from [appendix 03 §3](../appendix/03-content-model-reference.md),
  covering every value in both directions plus an unknown input
- A test proving the revalidation webhook builder signs the payload correctly and never logs the
  secret
- A test asserting `is_verified` is discarded from mutation input, using `Functions\expect` to show
  the update never receives it
- A `test:unit` Composer script, run as `docker compose run --rm composer run test:unit` — the
  `composer` service, not the `wordpress` container, because these tests need no WordPress at all
  and the stock image has no Composer binary. Under a second, start to finish.

## Classic WP Analogy

If you have written WordPress tests before, you wrote them with `WP_UnitTestCase` — the core test
framework, which boots WordPress, creates a test database, wraps each test in a transaction and
gives you `$this->factory->post->create()`. It is a genuinely good tool and Lesson 23.5 uses it.
It is also the reason most WordPress plugins have no tests: it needs MySQL, a WordPress
checkout, a `wp-tests-config.php` and about eight seconds of boot time before your first
assertion runs.

| Classic WordPress | Pest + Brain Monkey |
|---|---|
| `WP_UnitTestCase` — boots WordPress | No WordPress at all; the functions are doubles |
| `$this->factory->post->create()` | You do not need a post; you mock the accessor |
| `wp_set_current_user( $id )` | `Functions\when('get_current_user_id')->justReturn(0)` |
| Test DB, transaction per test | No database. Milliseconds per test. |
| `remove_all_filters()` in `setUp` | `Monkey\tearDown()` resets every stub |
| `$this->assertTrue(...)` | `expect(...)->toBeTrue()` |

The distinction that makes this lesson worth its own slot is the one WordPress developers most
often collapse: **a unit test asserts your logic; an integration test asserts WordPress's
behaviour.** `blameScore` computing 87.3 from a severity weight and a confidence value is your
logic — mock the meta accessor and test the arithmetic. `incident` actually appearing in the
GraphQL schema with the right `graphql_single_name` is WordPress's behaviour, and mocking
`register_post_type` to assert you called it proves only that you called it, which is nearly
worthless. That is Lesson 23.5's job, with a real WordPress.

Where the analogy breaks, and it is a trap worth naming: **Brain Monkey lets you mock anything,
including things you should not.** Mocking `current_user_can()` to return `true` and then
asserting your handler proceeds tests nothing about authorisation — it tests that your `if`
statement works. The capability matrix in
[appendix 03 §6](../appendix/03-content-model-reference.md) is enforced by WordPress's own
authorisation layer, so it must be tested against a real WordPress with real roles. Use unit
tests for arithmetic, branching and data shaping. Never use them to prove a security property
that only exists because WordPress enforces it.

---

## Key Concepts

### 1. What Brain Monkey actually does

WordPress is a five-thousand-function global namespace with no dependency injection. Brain Monkey's
answer is not a framework, it is a **function-definition service**: it defines the WordPress
functions your code calls, in the global namespace, as doubles you control, for the duration of one
test.

```
   WITHOUT Brain Monkey                     WITH Brain Monkey
   ─────────────────────────────────        ─────────────────────────────────
   require 'includes/graphql/fields.php'    Monkey\setUp()
        │                                        │  defines add_action, add_filter,
        ▼                                        │  do_action, apply_filters, …
   PHP Fatal error: Call to undefined       Functions\when('get_post_meta')
   function add_action()                         ->justReturn(42)
                                                 │
   …so you load WordPress. Eight seconds,        ▼
   a MySQL, a wp-tests-config.php.          require 'includes/graphql/fields.php'
                                            → the file's top-level add_action()
                                              calls land in a container you can
                                              inspect. Milliseconds. No database.
```

Three APIs carry every test in this lesson:

| API | What it does | Reach for it when |
|---|---|---|
| `Functions\when('x')->justReturn(v)` | defines `x()`, returns `v`, **asserts nothing** | you need the function to exist so the code under test can run |
| `Functions\expect('x')->once()->with(…)` | defines `x()` **and fails the test** if it is not called exactly that way | the *call* is the behaviour — "the update never receives `is_verified`" |
| `Actions\has('init', 'Ns\\fn')` / `Actions\expectAdded('init')` | inspects what was registered on a hook | rarely. See Key Concept 6 |

The distinction between the first two is the whole discipline. `when()` is scaffolding — it exists
so the arithmetic can run. `expect()` is an assertion, and an `expect()` you forgot to satisfy
fails the test, which is why over-using it produces tests that break on every refactor.

`Functions\stubs(['a', 'b' => static fn ($x) => $x])` is the bulk form and it is the right tool for
the dozen sanitising and translating helpers that every WordPress file calls and no test cares
about: `__()`, `sanitize_key()`, `untrailingslashit()`, `wp_json_encode()`.

### 2. Pest over PHPUnit, for legibility rather than features

Pest sits **on top of** PHPUnit. Same assertions underneath, same coverage tooling, same
`--filter`, same exit codes, same CI integration. There is no feature in this lesson that PHPUnit
could not express. The reason is legibility, and in a WordPress codebase legibility has an
unusually high return:

```php
// (illustration) the same test, twice
public function testDenyCreateIncidentsUntilVerifiedReturnsDoNotAllowWhenMetaIsZero(): void
it('denies create_incidents while btt_verified is the string "0"');
```

The people who most need to read your tests are frequently not the people who wrote them — a
client's in-house developer, the contractor after you, the reviewer on a Friday. The second form is
legible as an **acceptance criterion** to somebody who has never written a test in their life. The
first is legible to somebody who has already read the implementation.

| | PHPUnit | **Pest** |
|---|---|---|
| Test declaration | a `public function test…` in a class | `it('…')` at file scope |
| Assertions | `$this->assertSame(…)` | `expect(…)->toBe(…)`, and every PHPUnit assertion still available |
| Shared setup | `setUp()` in a base class you extend | `uses()->beforeEach()` in `Pest.php`, applied by **directory** |
| Runs PHPUnit underneath | it is PHPUnit | ✅ yes — so `--filter`, `--testsuite`, coverage and CI are unchanged |
| Ecosystem familiarity | ✅ larger; every WordPress testing article assumes it | smaller, and the syntax is not what upstream docs show |

The concession is real and worth stating: **every WordPress testing article you will find is
PHPUnit.** When you read the core handbook or a plugin's `tests/` directory, you will see
`class Foo extends WP_UnitTestCase`. Pest does not remove that — Lesson 23.5's integration suite
still extends `WP_UnitTestCase`, and Pest just wraps the declaration. Nothing here prevents you
from mixing the two in one suite, and if your team already reads PHPUnit fluently, the return on
switching is smaller than this section implies.

### 3. The `Pest.php` lifecycle, and why `Monkey\tearDown()` is not optional

`tests/Pest.php` is Pest's configuration file. It runs before anything else and its job here is
four lines: start Brain Monkey, install the boring stubs, tear Brain Monkey down, and say **which
directory** the whole arrangement applies to.

```
   per test, in this order
   ────────────────────────────────────────────────────────
   Monkey\setUp()      hook functions defined; the container is empty
   Functions\stubs()   __(), sanitize_key(), … defined as no-ops or identities
   ▸ your it(…) body   Functions\when / expect / the code under test
   Monkey\tearDown()   EVERY definition and expectation removed
```

Drop the last line and the suite does not fail — it **lies**, and it lies in the direction that is
hardest to notice:

| Without `tearDown()` | Consequence |
|---|---|
| A `Functions\when('get_post_meta')->justReturn(99)` from test 1 survives | test 2 asserts arithmetic against 99 and passes without stubbing anything |
| An unmet `Functions\expect('update_post_meta')->once()` from test 1 | still fails in **test 1** — Mockery is verified per test either way. `tearDown()` is not what catches this one |
| Patchwork's redefinitions accumulate | the suite gets slower, then non-deterministic in file order |

The **first** row is the one to internalise, and it is the only one of the three that is silent. A
leaked `when()` is a *definition* that survives, so the next test computes against a stub it never
wrote and **passes**. Nothing goes red; the suite simply stops asserting what you think it asserts.
Measured, so you do not have to take it on faith: a leaked unmet `expect()` does **not** surface in
a later file, because Mockery's verification runs at the end of every test whether or not
`Monkey\tearDown()` is there. Green is the failure mode here, which is why Step 9 exists.

`->in('Unit')` is the other load-bearing detail. Brain Monkey and a real WordPress cannot coexist
in one process — Brain Monkey redefines the functions core has already defined — so the `uses()`
chain is scoped to `tests/Unit` by directory, and Lesson 23.5's `tests/Integration` is deliberately
outside it.

### 4. Your logic versus WordPress's behaviour — the distinction that decides every test

This is the one WordPress developers most often collapse, and getting it wrong produces a suite
that is fast, green and worthless.

> A unit test asserts **your** logic. An integration test asserts **WordPress's** behaviour.

| Statement | Whose behaviour | Suite |
|---|---|---|
| `0.6 × (99/100) × 500` rounds to `297.0` | yours — arithmetic | **3** (Pest) |
| `'works-on-my-machine'` maps to `WORKS_ON_MY_MACHINE` and back | yours — a lookup table | **3** |
| `hash_hmac('sha256', "$ts.$body", $secret)` matches what Next computes | yours — string assembly | **3** |
| `btt_verified` of `''` must not deny `create_incidents` | yours — PHP truthiness | **3** |
| `incident` appears in the schema as `graphql_single_name: Incident` | WordPress's + WPGraphQL's | **4** (`wp-phpunit`) |
| `map_meta_cap` turns `capability_type: 'incident'` into `publish_incidents` | WordPress's | **4** |
| `incident_reporter` cannot `publish_incidents` | WordPress's authorisation layer | **4** |
| `register_block_type` found `build/incident-callout/block.json` | WordPress's | **4** |

Row 5 is the one to sit with. You could write `Functions\expect('register_post_type')->once()`
and assert the argument array contained `'graphql_single_name' => 'Incident'`. That test would
pass, take one millisecond, and prove **that you called a function with an array** — not that the
post type registered, not that WPGraphQL picked it up, not that the schema contains the type. If
WPGraphQL changes which argument key it reads, your test stays green and the front end gets
`null`. Lesson 23.5 does it with a real WordPress, and the test is three lines longer and worth
infinitely more.

### 5. The trap: Brain Monkey lets you mock things you must not

Brain Monkey will happily define `current_user_can()` and make it return whatever you like. That
capability is a loaded gun.

```php
// (illustration) ❌ This test proves your `if` statement works. Nothing more.
Functions\when('current_user_can')->justReturn(true);
$result = create_incident_payload($input, $context, $info);
expect($result['id'])->not->toBeNull();
```

Read what that asserts: *given a function I wrote that returns `true`, my code takes the `true`
branch*. It is a test of PHP's `if`. The capability matrix in
[appendix 03 §6](../appendix/03-content-model-reference.md) exists **because WordPress enforces
it** — `map_meta_cap`, the `capability_type` mapping, the role's stored capability array in
`wp_options` — and none of that machinery is present in a Brain Monkey process.

The rule, and it is worth writing on the wall:

| Use a unit test for | Never use a unit test for |
|---|---|
| arithmetic, rounding, boundaries | whether a role holds a capability |
| branching on a value you were given | whether `map_meta_cap` generated a capability name |
| data shaping and lookup tables | whether a nonce verifies |
| string assembly — signatures, tags, URLs | whether a post type or taxonomy registered |
| what your code *does with* an authorisation answer | what the authorisation answer *is* |

The last row is the subtle and useful one, because it is not a blanket ban. Stubbing
`current_user_can()` to return **`false`** and asserting that `is_verified` is nevertheless written
as `false` is a legitimate unit test: the thing under test is how *your* code combines a
capability answer with attacker-controlled input, and that combination is your logic. What you must
never assert is the answer itself. The practical test: **if the assertion would still be true with
WordPress's authorisation layer deleted, it is a unit test. If it would not, it belongs in
suite 4.**

Verification check 5 greps for this, and it greps for the right thing — `current_user_can` inside
an `expect()`, not `current_user_can` anywhere.

### 6. Two hazards that make a Pest suite lie, and both are process-scoped

Neither of these is in the documentation and both will cost you an hour.

**`static` inside the function under test.** `incident_severity_slug()` and
`incident_blame_breakdown()` both memoise into a `static $memo = array();` keyed by post ID
(Lesson 06.1). A `static` lives for the **PHP process**, and PHPUnit runs every file in one
process by default. So:

```
   test 1: incident_blame_breakdown(1)   → stubs meta as 500 min, memo[1] = {score: 297}
   test 2: incident_blame_breakdown(1)   → stubs meta as 0 min, expects 0
                                         → returns memo[1] = 297.  FAILS.
   test 3: incident_blame_breakdown(1)   → expects null for missing severity
                                         → returns 297.  PASSES for the wrong reason.
```

Three fixes, in order of preference: **use a different post ID per test** (free, obvious, and what
this lesson does); enable `processIsolation` in `phpunit.xml.dist` (correct, and roughly ten times
slower); or refactor the memo out of the function (best, and a change to production code that a
test should not be driving on its own).

**`require_once` is also process-scoped.** The `includes/` files are procedural and are **not**
autoloaded — PSR-4 maps `Blame\Core\` to `includes/` for *classes*, and only `Plugin.php` is one.
So each test file `require_once`s the file it tests, and the file's top-level `add_action()` calls
therefore execute **exactly once per run**, inside whichever test happened to load it first. Two
consequences: `Actions\expectAdded('graphql_register_types')` can only ever be satisfied in one
test, and you should not write it — which is the same conclusion Key Concept 4 reached from the
other direction.

### 7. `btt_verified` is three-state, and a falsy check locks out your editors

This is the best unit-test target in the plugin, because it is pure PHP truthiness with a
security-shaped consequence, and it is exactly what Brain Monkey is for.

`includes/roles.php` filters `map_meta_cap` to withhold `create_incidents` from an unverified
public signup. The read is:

```php
// (illustration) includes/roles.php, and the `'0' !==` is the whole point
if ( '0' !== get_user_meta( $user_id, 'btt_verified', true ) ) {
    return $caps;
}
```

Now the three states, because `get_user_meta()` with `$single = true` does not return a boolean:

| Stored | `get_user_meta` returns | Meaning | With `'0' !==` | With a falsy check |
|---|---|---|---|---|
| `1` (verified, 15.3) | `'1'` | verified | allowed ✅ | allowed ✅ |
| `0` (registered, 06.2) | `'0'` | explicitly unverified | **denied** ✅ | denied ✅ |
| nothing at all | **`''`** | the meta was never written | allowed ✅ | **DENIED** ❌ |

The third row is the bug. `'' == 0` is `true` in PHP, so `if (!get_user_meta(...))` denies every
account whose meta was never written — which is every account created by WP-CLI, every account
created by the seeder before Lesson 04.5 wrote the meta, and the `editor` who holds
`edit_others_incidents` and has no business being in this code path at all. A whole class of
account silently loses the ability to submit, and the only symptom is a capability that is absent.

Three assertions, milliseconds, no database. `get_user_meta` is stubbed, `user_can` is stubbed,
and what is being tested is a string comparison — which is your logic, unambiguously.

### 8. The signature test, and how to assert "it never logged the secret"

`revalidate_send()` in `includes/Revalidate.php` is the PHP half of contract seam ③. Its whole job
is string assembly:

```
   $body      = wp_json_encode($payload)          ← encode ONCE, into a variable
   $timestamp = (string) time()
   $signature = hash_hmac('sha256', "$timestamp.$body", $secret)
   wp_remote_post($base . '/api/revalidate', [ headers: X-BTT-Timestamp, X-BTT-Signature ])
```

Every one of those is testable with `Functions\expect('wp_remote_post')` and an independently
computed HMAC. The independence matters: compute the expected value in the test with
`hash_hmac()` directly, from the same `$secret` and the same `$body`, rather than calling the
function under test twice. A test that derives its expectation from the code it is testing asserts
that the code is consistent, not that it is right.

Two properties beyond the signature, and both are why this test exists:

**Fail closed and quiet.** With `BTT_REVALIDATE_SECRET` empty, or still `__CHANGE_ME__`, the
function must return without sending anything. An unsigned request that Next answers with a 401
nobody is watching is worse than no request: it looks like a caching bug for as long as it takes
somebody to read the Next logs.

**The secret never appears in anything that leaves the function.** `revalidate_send()` calls
`error_log()` under `WP_DEBUG`, and what it logs is the **body** and the URL. The assertion is
therefore about `wp_remote_post`'s arguments: the secret must appear in **no** header, **no** body
and **no** query string — only its HMAC does. `error_log()` is a native PHP function and Brain
Monkey does not intercept it, so the honest form of that half is a structural `grep` in the
Verification, labelled as a grep and not as a test.

And the secret itself: generate it in the test with `bin2hex(random_bytes(16))`. Nothing
token-shaped belongs in a tracked file, and a generated value also proves the assertion is about
the algorithm rather than about a fixture somebody could have copied from the expectation.

### 9. `is_verified` is discarded, and the assertion is the *absence* of a value

`create_incident_payload()` takes attacker-controlled input and writes post meta. Two fields in
that input are moderation facts the client must not be able to set:

| Input field | What the resolver does | Test |
|---|---|---|
| `status` | discarded unconditionally; `post_status` is forced to `'pending'` | assert `wp_insert_post` received `'post_status' => 'pending'` |
| `isVerified` | honoured **only** for a caller who could set it in wp-admin anyway; otherwise written `false` | assert `update_post_meta` received `false` |

The `isVerified` rule is conditional, not absolute, and the code says so:

```php
// (illustration) includes/graphql/mutation-create-incident.php
$verified = current_user_can( 'edit_others_incidents' ) && ! empty( $input['isVerified'] );
update_post_meta( $post_id, 'is_verified', $verified );
```

So the unit test stubs `current_user_can` to **`false`**, passes `isVerified: true` in the input,
and asserts the meta write received `false`. Per Key Concept 5, that is a legitimate unit test:
the assertion would still hold with WordPress's authorisation layer deleted, because what is under
test is the `&&`, not the capability.

`Functions\expect('update_post_meta')->once()->with($id, 'is_verified', false)` is the shape, and
`->with()` is doing the work — `->once()` alone would pass on `true`. A negative test whose
assertion is only "it was called" is a positive test with a misleading name.

The mirror-image test is the one worth adding for yourself: stub `current_user_can` to `true`,
pass `isVerified: true`, and assert `true` is written. Two tests, one `&&`, and between them they
pin both halves — which is what "test the branching, never the authorisation" looks like in
practice.


---

## Task

Everything here runs in the **`composer` service**, not the `wordpress` container. These tests mock
WordPress out entirely, so they need no WordPress — and the stock `wordpress` image has no Composer
binary. Lesson 23.5's integration suite is invoked the other way round, and §7 of that lesson
explains why the asymmetry is a teaching point rather than a wart.

### Step 1: Extend the plugin's `composer.json`

Lesson 03.1 created this file for the autoloader; Lesson 07.5 added `require-dev` for PHPCS and the
two `scripts` entries. Nothing has ever printed the whole file, so here it is complete, with the
five new keys marked:

```json
{
  "name": "blame-the-tech/core",
  "description": "Server-side content model and API surface for Blame The Tech.",
  "type": "wordpress-plugin",
  "license": "GPL-2.0-or-later",
  "require": {
    "php": ">=8.1"
  },
  "require-dev": {
    "wp-coding-standards/wpcs": "^3.1",
    "phpcompatibility/phpcompatibility-wp": "^2.1",
    "dealerdirect/phpcodesniffer-composer-installer": "^1.0",
    "pestphp/pest": "^1.0",
    "brain/monkey": "^2.6"
  },
  "autoload": {
    "psr-4": {
      "Blame\\Core\\": "includes/"
    }
  },
  "autoload-dev": {
    "psr-4": {
      "Blame\\Core\\Tests\\": "tests/"
    }
  },
  "config": {
    "optimize-autoloader": true,
    "sort-packages": true,
    "platform": {
      "php": "8.3"
    },
    "allow-plugins": {
      "dealerdirect/phpcodesniffer-composer-installer": true,
      "pestphp/pest-plugin": true
    }
  },
  "scripts": {
    "phpcs": "phpcs",
    "phpcbf": "phpcbf",
    "test:unit": "pest --testsuite=unit"
  }
}
```

Five changes, and one of them fixes something that was already broken:

| Key | Why |
|---|---|
| `require-dev`: `pestphp/pest`, `brain/monkey` | the runner and the doubles |
| `autoload-dev` PSR-4 for `tests/` | so a helper class under `tests/` is autoloadable without a `require`. Pest's own files do not need it; a shared fixture builder does |
| `config.allow-plugins` | **Composer 2.2+ refuses to execute a plugin that is not allowlisted**, and it *throws* rather than warning — which is why the `config` command below has to run before the `require`. Both `phpcodesniffer-composer-installer` and `pest-plugin` are Composer plugins. Without this, `composer phpcs` reports zero installed standards and `pest` never resolves its own binary |
| `scripts.test:unit` | the command Lesson 24.4's `_php.yml` calls verbatim |
| — | `pestphp/pest:^1.0` is deliberate and it is not conservatism. Pest 3 pins PHPUnit 11 and Pest 2 pins PHPUnit 10; WordPress core's own test library needs PHPUnit **9**, so Pest 1 is the newest major that lets one `composer.json` serve both suites. Lesson 23.5 Key Concept 4 has the measured reason. `config.platform.php` still pins resolution to 8.3 |

```bash
cd wordpress-headless

# ALLOWLIST FIRST. `composer require` executes pest-plugin as part of the install
# step, so with the allowlist still empty the require THROWS — "pestphp/pest-plugin
# contains a Composer plugin which is blocked by your allow-plugins config",
# PluginManager.php line 821 — and exits non-zero having written composer.json and
# composer.lock but no vendor/. Recoverable, but only if you know why.
docker compose run --rm composer config --no-plugins allow-plugins.pestphp/pest-plugin true
docker compose run --rm composer require --dev pestphp/pest:^1.0 brain/monkey:^2.6
docker compose run --rm composer install

# The resolved set, measured on PHP 8.3 — record it, because Lesson 23.5 depends on
# every one of these numbers and the reason for the Pest major is in that lesson's
# Key Concept 4:
#   pestphp/pest 1.23.1   phpunit/phpunit 9.6.36   brain/monkey 2.7.0
# Pest 1 runs on PHP 8.0-8.3 and DIES on 8.4+ with a wall of "Implicitly marking
# parameter as nullable is deprecated". So the runner has to be PHP 8.3. If your
# `composer` service is newer than that, run the suite in the `wordpress` container
# instead — it is PHP 8.3, it sees vendor/ through the same bind mount, and a CLI
# process there does NOT load WordPress, so Brain Monkey is still safe:
#   docker compose exec -T -w /var/www/html/$PLUGIN wordpress php vendor/bin/pest --testsuite=unit
```

**Verify §1:**

- [ ] `docker compose run --rm composer show --direct` lists `pestphp/pest` and `brain/monkey`
      under require-dev.
- [ ] `docker compose run --rm composer exec -- phpcs -i` still lists `WordPress` and
      `PHPCompatibilityWP`. If it now lists **nothing**, `allow-plugins` is missing an entry and
      the sniffer installer never ran — which means Lesson 07.5's `composer phpcs` has quietly
      been checking against the PEAR default this whole time. Worth knowing.
- [ ] `git check-ignore -v wp-content/plugins/blame-the-tech-core/vendor` names a rule.
      `composer.json` and `composer.lock` are committed; `vendor/` never is.

### Step 2: Write `phpunit.xml.dist` with the `unit` suite

Pest reads PHPUnit's configuration, so this is the file that makes `--testsuite=unit` a thing.

```xml
<?xml version="1.0"?>
<!-- wordpress-headless/wp-content/plugins/blame-the-tech-core/phpunit.xml.dist -->
<phpunit
  bootstrap="vendor/autoload.php"
  colors="true"
  failOnWarning="true"
  failOnRisky="true"
  cacheDirectory=".phpunit.cache"
>
  <testsuites>
    <!-- No WordPress. Brain Monkey redefines the functions core would define, so
         the two cannot share a process — which is why the suites are separate
         here and not merely separate directories. Lesson 23.5 adds `integration`
         to this same list, with a DIFFERENT bootstrap. -->
    <testsuite name="unit">
      <directory>tests/Unit</directory>
    </testsuite>
  </testsuites>

  <source>
    <include>
      <directory>includes</directory>
    </include>
  </source>
</phpunit>
```

`bootstrap="vendor/autoload.php"` and nothing more. The unit suite loads no WordPress, so there is
nothing else to bootstrap — Lesson 23.5's `integration` suite is the one that needs
`tests/bootstrap.php`, and giving the two suites different bootstraps is the whole reason they are
separate `<testsuite>` elements.

**Verify §2:**

- [ ] `docker compose run --rm composer exec -- pest --list-suites` prints `unit` and nothing
      else. The flag is `--list-suites`; `--list-test-suites` is PHPUnit's XML element name and
      Pest answers it with `Unknown option`. If it errors on the XML, check that `.phpunit.cache`
      is gitignored — PHPUnit writes it on first run and it must not be committed.
- [ ] `git check-ignore -v wp-content/plugins/blame-the-tech-core/.phpunit.cache` names a rule. If
      it does not, add one before the first run rather than after.

### Step 3: Write `tests/Pest.php` — the lifecycle, scoped by directory

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Pest.php
/**
 * Pest configuration for the UNIT suite.
 *
 * Everything here is scoped `->in('Unit')`. Brain Monkey redefines the WordPress
 * function set, and a real WordPress has already defined it, so the two cannot
 * coexist in one process — Lesson 23.5's tests/Integration is deliberately
 * outside this chain.
 *
 * @package Blame\Core\Tests
 */

declare( strict_types=1 );

use Brain\Monkey;
use Brain\Monkey\Functions;

uses()
	->beforeEach(
		function (): void {
			// Defines add_action, add_filter, do_action, apply_filters and the rest
			// of the hook API, in the global namespace, with an inspectable
			// container behind them.
			Monkey\setUp();

			// The boring ones. Every WordPress file calls these and no test in this
			// suite asserts on them, so they are `stubs` (scaffolding) rather than
			// `expect` (assertions) — Key Concept 1.
			Functions\stubs(
				array(
					'__'                => static fn( $text ) => $text,
					'esc_html__'        => static fn( $text ) => $text,
					'sanitize_key'      => static fn( $key ) => strtolower(
						(string) preg_replace( '/[^A-Za-z0-9_\-]/', '', (string) $key )
					),
					'sanitize_text_field' => static fn( $value ) => trim( (string) $value ),
					'untrailingslashit' => static fn( $value ) => rtrim( (string) $value, '/' ),
					'wp_json_encode'    => static fn( $data ) => json_encode( $data ),
				)
			);
		}
	)
	->afterEach(
		function (): void {
			// NOT OPTIONAL. A leaked `when()` makes the NEXT test pass without
			// stubbing anything; a leaked unmet `expect()` makes the next test fail
			// naming a function it never mentioned. Key Concept 3.
			Monkey\tearDown();
		}
	)
	->in( 'Unit' );

/**
 * Load a procedural plugin file, once per process.
 *
 * The `includes/` files are NOT autoloaded — PSR-4 maps `Blame\Core\` to
 * `includes/` for CLASSES, and `Plugin.php` is the only one. So a test that
 * exercises a namespaced function has to load its file, and `require_once` means
 * the file's top-level `add_action()` calls run exactly once per run, inside
 * whichever test happened to get there first. Key Concept 6: do not write an
 * assertion about those calls.
 */
function load_plugin_file( string $relative ): void {
	// THE ONE THAT COSTS YOU AN AFTERNOON. Every includes/ file opens with
	// WordPress's direct-access guard, `defined( 'ABSPATH' ) || exit;`. The unit
	// suite has no WordPress, so without this the require EXITS THE PROCESS with
	// status 0: Pest prints nothing, fails nothing, and `composer run test:unit`
	// returns 0 having run no tests at all. CI reads that silence as green.
	// Lazily, and guarded: Lesson 23.5's bootstrap defines the REAL ABSPATH
	// (the Composer WordPress copy) before any integration test runs, and this
	// must not pre-empt it.
	defined( 'ABSPATH' ) || define( 'ABSPATH', dirname( __DIR__ ) . '/' );

	require_once dirname( __DIR__ ) . '/' . $relative;
}
```

**Verify §3:**

- [ ] `docker compose run --rm composer run test:unit` prints `No tests found` and exits non-zero.
      That is correct — `tests/Unit/` is empty — and it proves the configuration resolves before
      any test can mislead you about it.
- [ ] `grep -c 'Monkey\\tearDown' tests/Pest.php` is `1`. Step 9 removes it on purpose and watches
      the suite lie.
- [ ] `grep -c "->in( 'Unit' )" tests/Pest.php` is `1`. Without the scope, Lesson 23.5's
      integration tests inherit `Monkey\setUp()` and fatal on a redefined core function.

### Step 4: `BlameScoreTest.php` — the arithmetic, its boundaries, and the memo trap

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Unit/BlameScoreTest.php
/**
 * `incident_blame_breakdown()` — Lesson 06.1's severity-weighted score.
 *
 * score = SEVERITY_WEIGHTS[slug] × (blame_confidence / 100) × downtime_minutes
 *
 * @package Blame\Core\Tests
 */

declare( strict_types=1 );

use Brain\Monkey\Functions;

use function Blame\Core\incident_blame_breakdown;

beforeEach(
	function (): void {
		load_plugin_file( 'includes/graphql/fields.php' );
	}
);

/**
 * Stub the three reads the function performs for one post.
 *
 * EVERY test uses a DIFFERENT $post_id, because both functions memoise into a
 * `static $memo` keyed by post ID and a static lives for the PHP process.
 * Reusing an ID means the second test reads the first test's answer. Key Concept 6.
 */
function stub_incident( int $post_id, ?string $severity, float $confidence, float $downtime ): void {
	Functions\when( 'get_the_terms' )->justReturn(
		null === $severity ? array() : array( (object) array( 'slug' => $severity ) )
	);

	Functions\when( 'get_post_meta' )->alias(
		static function ( int $id, string $key ) use ( $confidence, $downtime ) {
			return 'blame_confidence' === $key ? $confidence : $downtime;
		}
	);
}

it( 'computes weight × confidence × downtime, rounded to two places', function (): void {
	stub_incident( 101, 's2-major', 99.0, 500.0 );

	// 0.6 × 0.99 × 500 = 297. The same number Lesson 06.1's own Verification
	// block asserts against a live GraphQL response, which is the point: one
	// arithmetic, two suites, and if they disagree one of them is wrong.
	expect( incident_blame_breakdown( 101 )['score'] )->toBe( 297.0 );
} );

it( 'weights the four severities exactly as appendix 03 §2 lists them', function (): void {
	$cases = array(
		's1-catastrophic' => 1.0,
		's2-major'        => 0.6,
		's3-minor'        => 0.3,
		's4-cosmetic'     => 0.1,
	);

	$post_id = 200;

	foreach ( $cases as $slug => $weight ) {
		// A loop over a fixed table is fine; a BRANCH would be a second test
		// pretending to be one (Lesson 12.2 §10). And ++ keeps the memo honest.
		++$post_id;
		stub_incident( $post_id, $slug, 100.0, 100.0 );

		expect( incident_blame_breakdown( $post_id ) )
			->toMatchArray(
				array(
					'severityWeight' => $weight,
					'score'          => round( $weight * 100.0, 2 ),
				)
			);
	}
} );

it( 'returns 0.0 at both boundaries, and does not divide by anything', function (): void {
	stub_incident( 301, 's1-catastrophic', 0.0, 500.0 );
	expect( incident_blame_breakdown( 301 )['score'] )->toBe( 0.0 );

	stub_incident( 302, 's1-catastrophic', 100.0, 0.0 );
	expect( incident_blame_breakdown( 302 )['score'] )->toBe( 0.0 );
} );

it( 'NEGATIVE: returns null when the incident has no severity term', function (): void {
	stub_incident( 401, null, 99.0, 500.0 );

	// `null`, not 0.0 — and the difference matters at the GraphQL boundary.
	// A 0.0 says "we scored this incident and it scored zero"; a null says
	// "there is no score", which is the truth when nobody has triaged it.
	expect( incident_blame_breakdown( 401 ) )->toBeNull();
} );

it( 'NEGATIVE: returns null for a severity slug outside the closed set', function (): void {
	stub_incident( 402, 's5-invented-by-an-editor', 99.0, 500.0 );

	// A taxonomy is editorial input and an editor can add a term. `SEVERITY_WEIGHTS`
	// is a closed set, so an unknown slug must fall out rather than default to a
	// weight — a default here would score an untriaged incident as if it were minor.
	expect( incident_blame_breakdown( 402 ) )->toBeNull();
} );

it( 'treats missing meta as zero rather than throwing', function (): void {
	Functions\when( 'get_the_terms' )->justReturn(
		array( (object) array( 'slug' => 's3-minor' ) )
	);

	// `get_post_meta` returns '' for a key that was never written. The cast to
	// (float) makes that 0.0, which is why the function has no guard — and this
	// test is what says that was a decision.
	Functions\when( 'get_post_meta' )->justReturn( '' );

	expect( incident_blame_breakdown( 501 )['score'] )->toBe( 0.0 );
} );
```

**Verify §4:**

- [ ] `docker compose run --rm composer run test:unit` reports **six** passing tests, in well
      under a second including Composer's own startup.
- [ ] Change one test to reuse post ID `101` and re-run. It fails, or worse, **passes for the
      wrong reason**. That is the static memo from Key Concept 6, and it is worth seeing once.
- [ ] `grep -c 'register_post_type\|register_graphql' tests/Unit/BlameScoreTest.php` is `0`. This
      file tests arithmetic. Registration is Lesson 23.5's, with a real WordPress.

### Step 5: `EnumsTest.php` — both directions, plus the input nobody sends on purpose

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Unit/EnumsTest.php
/**
 * The GraphQL enum mappers from Lesson 06.1.
 *
 * `normalize_stored_value()` reads:  SCREAMING or kebab → the stored kebab value
 * `stored_to_enum_name()` writes:    the stored value   → the SCREAMING name
 *
 * @package Blame\Core\Tests
 */

declare( strict_types=1 );

use function Blame\Core\normalize_stored_value;
use function Blame\Core\stored_to_enum_name;

beforeEach(
	function (): void {
		load_plugin_file( 'includes/graphql/enums.php' );
	}
);

/** Every value of every enum, from appendix 03 §3. Sixteen pairs. */
dataset(
	'enum values',
	array(
		array( 'IncidentEnvironment', 'PRODUCTION', 'production' ),
		array( 'IncidentEnvironment', 'STAGING', 'staging' ),
		array( 'IncidentEnvironment', 'DEVELOPMENT', 'development' ),
		array( 'IncidentEnvironment', 'WORKS_ON_MY_MACHINE', 'works-on-my-machine' ),
		array( 'IncidentResolutionStatus', 'OPEN', 'open' ),
		array( 'IncidentResolutionStatus', 'MITIGATED', 'mitigated' ),
		array( 'IncidentResolutionStatus', 'BLAMED', 'blamed' ),
		array( 'IncidentResolutionStatus', 'WONTFIX', 'wontfix' ),
	)
);

it( 'round-trips every value in both directions', function ( string $enum, string $name, string $stored ): void {
	// The mapping is a contract with `src/gql/graphql.ts`: WPGraphQL sends the
	// NAME and stores the VALUE, and the enum is the only place the two are
	// related. A one-directional test would pass with a broken reverse map.
	expect( normalize_stored_value( $enum, $stored ) )->toBe( $stored );
	expect( stored_to_enum_name( $enum, $stored ) )->toBe( $name );
} )->with( 'enum values' );

it( 'NEGATIVE: returns null for a value outside the enum, in both directions', function (): void {
	// `null`, not the first member and not the empty string. A mapper that
	// silently defaults turns "the client sent something we do not understand"
	// into "the client sent `production`", which is a data-integrity bug with no
	// error attached to it.
	expect( normalize_stored_value( 'IncidentEnvironment', 'in-the-cloud-somewhere' ) )->toBeNull();
	expect( stored_to_enum_name( 'IncidentEnvironment', 'in-the-cloud-somewhere' ) )->toBeNull();
} );

it( 'NEGATIVE: is not case- or punctuation-forgiving in a way that invents a value', function (): void {
	// `sanitize_key()` lowercases and strips, so 'PRODUCTION' normalises to
	// 'production' — that is intended and worth pinning. But an UNDERSCORE is not
	// a hyphen: 'works_on_my_machine' is not a member, and must not become one.
	expect( normalize_stored_value( 'IncidentEnvironment', 'PRODUCTION' ) )->toBe( 'production' );
	expect( normalize_stored_value( 'IncidentEnvironment', 'works_on_my_machine' ) )->toBeNull();
} );

it( 'NEGATIVE: an unknown ENUM name is null rather than a PHP warning', function (): void {
	// `GRAPHQL_ENUMS[$enum] ?? array()` is why. Reaching a mapper with a typo'd
	// enum name is a programming error, and an empty result is a better failure
	// than an undefined-index notice injected into a JSON response.
	expect( normalize_stored_value( 'IncidentSeverity', 'production' ) )->toBeNull();
} );
```

**Verify §5:**

- [ ] Eight dataset cases plus three explicit tests, so **eleven** more passing tests and
      seventeen overall. Each dataset case is reported as its own test, with its arguments in
      the name — that is the reason to prefer a named `dataset()` over a `foreach`.
- [ ] `dataset()` is available on the pinned `pestphp/pest:^1.0` — it landed well before 2.x, and
      all eight cases run. `->with(array(...))` inline is equivalent if you prefer it.
- [ ] `grep -rn "expect( *current_user_can" tests/Unit/` returns nothing. See Verification check 5.

### Step 6: `RevalidateTest.php` — the signature, and the secret that never travels

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Unit/RevalidateTest.php
/**
 * `revalidate_send()` — the PHP half of the webhook signature contract.
 *
 * @package Blame\Core\Tests
 */

declare( strict_types=1 );

use Brain\Monkey\Functions;

use function Blame\Core\revalidate_send;

/** Generated per run. Nothing token-shaped belongs in a tracked file. */
const FAKE_SECRET_LENGTH = 16;

beforeEach(
	function (): void {
		load_plugin_file( 'includes/Revalidate.php' );
	}
);

it( 'signs `timestamp.body` with sha256 and sends both headers', function (): void {
	$secret  = bin2hex( random_bytes( FAKE_SECRET_LENGTH ) );
	$payload = array(
		'type'     => 'post',
		'postType' => 'incident',
		'slug'     => 'incident-01',
	);

	putenv( 'BTT_FRONTEND_URL=http://host.docker.internal:3000' );
	putenv( 'BTT_REVALIDATE_SECRET=' . $secret );

	$captured = null;

	Functions\expect( 'wp_remote_post' )
		->once()
		->andReturnUsing(
			static function ( string $url, array $args ) use ( &$captured ) {
				$captured = array( 'url' => $url, 'args' => $args );

				return array( 'response' => array( 'code' => 200 ) );
			}
		);

	revalidate_send( $payload );

	expect( $captured['url'] )->toBe( 'http://host.docker.internal:3000/api/revalidate' );

	$timestamp = $captured['args']['headers']['X-BTT-Timestamp'];
	$body      = $captured['args']['headers']['Content-Type'] ? $captured['args']['body'] : '';

	// The expectation is computed INDEPENDENTLY, from the same secret and the
	// same body. Calling the function under test twice would assert that it is
	// consistent, not that it is right — and consistency is not the contract.
	// The other side of this exact string is in Lesson 23.3's route test.
	expect( $captured['args']['headers']['X-BTT-Signature'] )
		->toBe( 'sha256=' . hash_hmac( 'sha256', $timestamp . '.' . $body, $secret ) );

	// Encoded ONCE, into a variable, then signed and sent. Re-encoding between
	// signing and sending is how a payload signs one way and arrives another.
	expect( $body )->toBe( json_encode( $payload ) );
	expect( $captured['args']['blocking'] )->toBeFalse();
} );

it( 'NEGATIVE: the secret appears nowhere in the request', function (): void {
	$secret = bin2hex( random_bytes( FAKE_SECRET_LENGTH ) );

	putenv( 'BTT_FRONTEND_URL=http://host.docker.internal:3000' );
	putenv( 'BTT_REVALIDATE_SECRET=' . $secret );

	$captured = null;

	Functions\expect( 'wp_remote_post' )
		->once()
		->andReturnUsing(
			static function ( string $url, array $args ) use ( &$captured ) {
				$captured = $url . ' ' . var_export( $args, true );

				return array( 'response' => array( 'code' => 200 ) );
			}
		);

	revalidate_send( array( 'type' => 'options' ) );

	// Only the HMAC travels. Not the key, not in a header, not in the body, not
	// in a query string. A shared secret that appears in a request is a shared
	// secret that appears in an access log.
	expect( $captured )->not->toContain( $secret );
} );

it( 'NEGATIVE: fails closed and QUIET when the secret is missing or a placeholder', function (): void {
	putenv( 'BTT_FRONTEND_URL=http://host.docker.internal:3000' );

	// `expect(...)->never()` is the assertion. An unsigned request that Next
	// answers with a 401 nobody is watching is worse than no request at all: it
	// looks exactly like a caching bug until somebody reads the Next logs.
	Functions\expect( 'wp_remote_post' )->never();

	putenv( 'BTT_REVALIDATE_SECRET=' );
	revalidate_send( array( 'type' => 'options' ) );

	putenv( 'BTT_REVALIDATE_SECRET=__CHANGE_ME__' );
	revalidate_send( array( 'type' => 'options' ) );
} );

it( 'NEGATIVE: sends nothing when the frontend URL is unset', function (): void {
	putenv( 'BTT_FRONTEND_URL=' );
	putenv( 'BTT_REVALIDATE_SECRET=' . bin2hex( random_bytes( FAKE_SECRET_LENGTH ) ) );

	Functions\expect( 'wp_remote_post' )->never();

	revalidate_send( array( 'type' => 'options' ) );
} );
```

**Verify §6:**

- [ ] Four more passing tests.
- [ ] `grep -c 'BTT_REVALIDATE_SECRET=[A-Za-z0-9]' tests/Unit/RevalidateTest.php` is `0`. Every
      secret in this file is `bin2hex( random_bytes( … ) )` at run time; the only literal is
      `__CHANGE_ME__`, which is the placeholder the function is asked to reject.
- [ ] From `wordpress-headless/`, with `PLUGIN=wp-content/plugins/blame-the-tech-core`:
      `grep -n 'error_log' $PLUGIN/includes/Revalidate.php` — read the format string. It
      interpolates the URL and the **body**, never `$secret`. This is a structural check and not a
      test, because `error_log()` is a native PHP function Brain Monkey does not intercept.
      Labelling it as a grep is the honest form.

### Step 7: `CreateIncidentTest.php` — the fields a client must not be able to set

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Unit/CreateIncidentTest.php
/**
 * `create_incident_payload()` — what it DISCARDS from attacker-controlled input.
 *
 * @package Blame\Core\Tests
 */

declare( strict_types=1 );

use Brain\Monkey\Functions;

use function Blame\Core\create_incident_payload;

beforeEach(
	function (): void {
		load_plugin_file( 'includes/graphql/mutation-create-incident.php' );

		// Scaffolding, not assertions. Everything the resolver needs in order to
		// reach the two lines under test.
		Functions\when( 'get_current_user_id' )->justReturn( 7 );
		Functions\when( 'wp_insert_post' )->justReturn( 4242 );
		Functions\when( 'get_post' )->justReturn( (object) array( 'ID' => 4242, 'post_name' => 'incident-41' ) );
		Functions\when( 'wp_set_object_terms' )->justReturn( array() );
		Functions\when( 'term_exists' )->justReturn( array( 'term_id' => 9 ) );
		Functions\when( 'get_term_by' )->justReturn( (object) array( 'term_id' => 9 ) );
		Functions\when( 'current_time' )->justReturn( '2024-01-01 09:00:00' );
	}
);

/** The minimum valid input. Field names from Lesson 06.2's `CreateIncidentInput`. */
function incident_input( array $overrides = array() ): array {
	return array_merge(
		array(
			'title'            => 'The certificate expired again',
			'body'             => 'It was DNS.',
			'scapegoatSlug'    => 'dns',
			'severitySlug'     => 's2-major',
			'occurredAt'       => '2024-01-01T09:00:00+00:00',
			'downtimeMinutes'  => 42,
			'blameConfidence'  => 73,
			'environment'      => 'PRODUCTION',
			'resolutionStatus' => 'OPEN',
		),
		$overrides
	);
}

it( 'NEGATIVE: discards `isVerified` from a caller who cannot moderate', function (): void {
	// FALSE, deliberately. Per Key Concept 5 this is a legitimate unit test: what
	// is under test is the `&&` that combines a capability answer with
	// client-supplied input, and that assertion would still hold with
	// WordPress's authorisation layer deleted. What must NEVER be asserted here
	// is the capability answer itself.
	Functions\when( 'current_user_can' )->justReturn( false );

	// `->with()` is doing the work. `->once()` alone would pass on `true`, which
	// is the exact bug this test exists to catch.
	Functions\expect( 'update_post_meta' )->once()->with( 4242, 'is_verified', false );
	Functions\when( 'update_post_meta' )->justReturn( true );

	create_incident_payload( incident_input( array( 'isVerified' => true ) ), (object) array(), (object) array() );
} );

it( 'honours `isVerified` for a caller who could set it in wp-admin anyway', function (): void {
	Functions\when( 'current_user_can' )->justReturn( true );

	// The mirror image. Two tests, one `&&`, and between them both halves are
	// pinned — which is what "test the branching, never the authorisation" looks
	// like in practice.
	Functions\expect( 'update_post_meta' )->once()->with( 4242, 'is_verified', true );
	Functions\when( 'update_post_meta' )->justReturn( true );

	create_incident_payload( incident_input( array( 'isVerified' => true ) ), (object) array(), (object) array() );
} );

it( 'NEGATIVE: forces post_status to pending and ignores a client `status`', function (): void {
	Functions\when( 'current_user_can' )->justReturn( false );
	Functions\when( 'update_post_meta' )->justReturn( true );

	$captured = null;

	Functions\expect( 'wp_insert_post' )
		->once()
		->andReturnUsing(
			static function ( array $postarr ) use ( &$captured ) {
				$captured = $postarr;

				return 4242;
			}
		);

	create_incident_payload(
		incident_input( array( 'status' => 'publish', 'authorId' => 1 ) ),
		(object) array(),
		(object) array()
	);

	// FORCED, both of them. `post_status` is not read from input at all, and
	// `post_author` comes from the session rather than the payload — so a
	// self-published incident and an incident attributed to somebody else are
	// both structurally impossible rather than merely unauthorised.
	expect( $captured['post_status'] )->toBe( 'pending' );
	expect( $captured['post_author'] )->toBe( 7 );
} );
```

**Verify §7:**

- [ ] Three more passing tests, twenty-four in total.
- [ ] Delete `->with( 4242, 'is_verified', false )` from the first test, leaving `->once()`, and
      re-run. It **still passes** — and it would pass on `true` too. Put it back. A negative whose
      assertion is only "it was called" is a positive test with a misleading name.
- [ ] If `create_incident_payload` throws on a stub you have not provided, add it to the
      `beforeEach` with `when()`, never with `expect()`. Scaffolding is not an assertion, and an
      unmet `expect()` fails a test for a reason that has nothing to do with the test.

### Step 8: `VerifiedGateTest.php` — three states, and the one that locks out your editors

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Unit/VerifiedGateTest.php
/**
 * `deny_create_incidents_until_verified()` — the `map_meta_cap` filter from 15.3.
 *
 * Pure PHP truthiness with a security-shaped consequence. Key Concept 7.
 *
 * @package Blame\Core\Tests
 */

declare( strict_types=1 );

use Brain\Monkey\Functions;

use function Blame\Core\deny_create_incidents_until_verified;

beforeEach(
	function (): void {
		load_plugin_file( 'includes/roles.php' );
	}
);

/** Run the filter as WordPress would, with the four arguments it passes. */
function run_gate( string $cap, int $user_id, string $meta, bool $can_moderate = false ): array {
	Functions\when( 'get_user_meta' )->justReturn( $meta );
	Functions\when( 'user_can' )->justReturn( $can_moderate );

	return deny_create_incidents_until_verified( array( $cap ), $cap, $user_id, array() );
}

it( 'allows a verified reporter', function (): void {
	expect( run_gate( 'create_incidents', 12, '1' ) )->toBe( array( 'create_incidents' ) );
} );

it( 'denies a reporter whose meta is the STRING "0"', function (): void {
	// The only state that denies. `update_user_meta($id, 'btt_verified', 0)` in
	// Lesson 06.2's registerDeveloper is what writes it.
	expect( run_gate( 'create_incidents', 12, '0' ) )->toBe( array( 'do_not_allow' ) );
} );

it( 'NEGATIVE: does NOT deny an account whose meta was never written', function (): void {
	// THE test in this file. `get_user_meta()` returns '' for an absent key, and
	// `'' == 0` is true in PHP — so a falsy check would deny every CLI-created
	// account, every pre-04.5 seeded account, and the `editor` who holds
	// `edit_others_incidents` and has no business in this code path at all.
	// A whole class of account silently loses a capability, and the only symptom
	// is a capability that is absent.
	expect( run_gate( 'create_incidents', 12, '' ) )->toBe( array( 'create_incidents' ) );
} );

it( 'NEGATIVE: exempts a moderator even with the meta explicitly at "0"', function (): void {
	// Somebody set the meta by hand on an editor. The second guard catches it,
	// because an editor is not a public signup and this filter exists for public
	// signups only.
	expect( run_gate( 'create_incidents', 3, '0', true ) )->toBe( array( 'create_incidents' ) );
} );

it( 'NEGATIVE: touches no capability other than create_incidents', function (): void {
	// The `$cap` name check is the FIRST line of the function, and it has to be:
	// a filter on map_meta_cap runs for every capability check in the request,
	// several hundred of them, and one that inspects user meta on all of them is
	// a per-request query storm as well as a correctness hazard.
	expect( run_gate( 'publish_incidents', 12, '0' ) )->toBe( array( 'publish_incidents' ) );
	expect( run_gate( 'edit_posts', 12, '0' ) )->toBe( array( 'edit_posts' ) );
} );

it( 'NEGATIVE: leaves an anonymous request alone', function (): void {
	// user_id 0 is not an unverified user, it is no user. Returning
	// `do_not_allow` here would be correct-looking and wrong: the anonymous case
	// is already handled by the capability not being granted at all.
	expect( run_gate( 'create_incidents', 0, '' ) )->toBe( array( 'create_incidents' ) );
} );
```

**Verify §8:**

- [ ] Six more passing tests, thirty in total, still under a second.
- [ ] `docker compose run --rm composer exec -- pest --filter=VerifiedGate` runs exactly this file.
      Note the value: appendix 07 §5's example is `--filter=ScapegoatStats`, and no such test
      exists anywhere in this course — use a real one.
- [ ] Change `'0' !==` to `!` in `includes/roles.php` on a `sed -i.bak` copy, re-run, and confirm
      **the third test fails and nothing else does**. Restore it. That is the outage from Key
      Concept 7, isolated to one assertion.

### Step 9: Prove that `Monkey\tearDown()` is load-bearing

The suite is green. Now break the thing that makes it trustworthy, on a probe copy — and note in
advance what you are looking for, because it is **not** a red run. It is one extra pass.

```bash
cd wordpress-headless
PLUGIN=wp-content/plugins/blame-the-tech-core

# A probe that stubs NOTHING and asks a WordPress function a question. It can only
# succeed if a stub from an earlier test is still defined.
printf '%s\n' '<?php' \
  "it('leak probe: reads a stub it never wrote', function (): void {" \
  "    expect(get_post_meta(1, 'blame_confidence', true))->toBe('');" \
  '});' > $PLUGIN/tests/Unit/ZLeakProbeTest.php

sed -i.bak 's|Monkey\\tearDown();|// Monkey\\tearDown();|' $PLUGIN/tests/Pest.php
docker compose run --rm composer run test:unit; echo "exit=$?"   # 31 passed, exit 0
mv $PLUGIN/tests/Pest.php.bak $PLUGIN/tests/Pest.php
docker compose run --rm composer run test:unit; echo "exit=$?"   # 1 failed, 30 passed
rm $PLUGIN/tests/Unit/ZLeakProbeTest.php
docker compose run --rm composer run test:unit                   # 30 passed
```

**Verify §9:**

- [ ] With `tearDown()` commented out the suite is **still green, and that is the finding.** The
      leak is a surviving `Functions\when()` *definition*, so a later test computes against a stub
      it never wrote and passes. Do not expect a red run; expect a run you can no longer trust.
- [ ] Verification check 9 makes that visible with a throwaway probe that stubs nothing and asks
      `get_post_meta` a question. Without `tearDown()` it answers `''`; with `tearDown()` the same
      line fails with `Call to undefined function`. Deleting the safeguard made one MORE test
      pass, which is the whole shape of the hazard.
- [ ] With it restored, thirty passing tests and exit `0`.
- [ ] `git status --short` shows six new files and one modified `composer.json`, plus
      `composer.lock`. No `vendor/`, no `.phpunit.cache`, no `.bak`.


---

## Verification

```bash
cd wordpress-headless
PLUGIN=wp-content/plugins/blame-the-tech-core

# 1. The whole unit suite, from the COMPOSER service — no WordPress involved
time docker compose run --rm composer run test:unit
# Expected: 30 passed, and the wall time dominated by Composer's own startup
#           rather than by the tests. Under a second of test time, no MySQL, no
#           container boot, no fixture. That ratio is the argument for suite 3.

# 2. NEGATIVE — this suite genuinely does not need WordPress. Stop it and re-run.
docker compose stop wordpress db
docker compose run --rm composer run test:unit; echo "exit=$?"
docker compose start wordpress db
# Expected: 30 passed and exit=0 with WordPress and MySQL both down. If it fails,
#           something in tests/Unit/ reached a real WordPress and the suite has
#           quietly become an integration suite that lies about its speed.

# 3. NEGATIVE — the wordpress container cannot run this suite, and that is correct
docker compose exec -T $( echo wordpress ) sh -c 'command -v composer || echo "no composer here"'
# Expected: "no composer here". The stock image ships neither Composer nor WP-CLI
#           (Lesson 02.2), which is why suite 3 runs in the `composer` service and
#           suite 4 runs in this one. `composer test:unit` still works verbatim on
#           a CI runner, where PHP and Composer are both native.

# 4. Pest is really PHPUnit underneath, so every PHPUnit affordance still works
docker compose run --rm composer exec -- pest --list-suites
# Expected: "Available test suite(s):" then a single ` - unit` line. The flag is
#           --list-suites; --list-test-suites is the XML element name and Pest
#           rejects it with `Unknown option`. Lesson 23.5 adds `integration` here.
docker compose run --rm composer exec -- pest --filter=BlameScore; echo "exit=$?"
# Expected: 6 passed, the rest not run, exit=0. NOTE: appendix 07 §5's example is
#           `--filter=ScapegoatStats`, and no such test exists anywhere in this
#           course — the blame leaderboard is a Next-side read of term counts
#           maintained by WordPress, not PHP. Use a filter that names a real file.
#           AND READ THE COUNT, NOT THE EXIT CODE: a --filter that matches nothing
#           prints `No tests executed!` and still exits 0, so every --filter check
#           in this lesson and in 23.5 is a FALSE GREEN when the name is wrong.
#           That is what made the ScapegoatStats example survive review.

# 5. NEGATIVE — no unit test asserts a CAPABILITY OUTCOME. Grep for the assertion,
#    not for the function: stubbing `current_user_can` is legitimate scaffolding
#    (Key Concept 5), asserting on it is not.
grep -rn 'current_user_can' $PLUGIN/tests/Unit/
# Expected: hits ONLY inside `Functions\when( 'current_user_can' )->justReturn( … )`.
#           Every one of them is scaffolding so the code under test can reach the
#           line being asserted.
grep -rnE "Functions\\\\expect\( *'current_user_can'|expect\( *current_user_can" $PLUGIN/tests/Unit/
# Expected: no output. A `Functions\expect('current_user_can')` asserts that YOUR
#           code asked the question; `expect(current_user_can(...))->toBeTrue()`
#           asserts an answer you invented. Neither says anything about whether
#           `incident_reporter` can publish — that needs a real WordPress with real
#           roles, and it is the most valuable assertion in Lesson 23.5.
grep -rn 'user_can' $PLUGIN/tests/Unit/VerifiedGateTest.php
# Expected: one `Functions\when` in the helper. The gate BRANCHES on the answer,
#           and the branch is what is under test.

# 6. NEGATIVE — no unit test asserts that a registration happened
grep -rnE 'register_post_type|register_taxonomy|register_block_type|register_graphql_' $PLUGIN/tests/Unit/
# Expected: no output. Asserting `Functions\expect('register_post_type')->once()`
#           proves you called a function with an array. It does not prove the post
#           type registered, that WPGraphQL read it, or that `Incident` is in the
#           schema. Lesson 23.5, with a real WordPress.

# 7. NEGATIVE — no literal secret anywhere in the suite
grep -rnE "(secret|token|password)\s*[:=]\s*['\"][A-Za-z0-9/+_-]{16,}" $PLUGIN/tests/
# Expected: no output. Every secret-shaped value is `bin2hex( random_bytes( 16 ) )`
#           at run time. The single literal in the suite is `__CHANGE_ME__`, which
#           is there because `revalidate_send()` must REFUSE it.
grep -rn '__CHANGE_ME__' $PLUGIN/tests/
# Expected: one hit, in RevalidateTest.php's fail-closed test

# 8. NEGATIVE — the secret never reaches the wire, only its HMAC does
docker compose run --rm composer exec -- pest --filter="secret appears nowhere"
# Expected: 1 passed. The assertion var_exports the whole wp_remote_post argument
#           array and greps it for the key. A shared secret that appears in a
#           request is a shared secret that appears in an access log.

# 9. NEGATIVE — the tearDown is load-bearing, and its absence is SILENT. Prove it.
sed -i.bak 's|Monkey\\tearDown();|// Monkey\\tearDown();|' $PLUGIN/tests/Pest.php
printf '%s\n' '<?php' \
  "it('leak probe: reads a stub it never wrote', function (): void {" \
  "    expect(get_post_meta(1, 'blame_confidence', true))->toBe('');" \
  '});' > $PLUGIN/tests/Unit/ZLeakProbeTest.php
docker compose run --rm composer exec -- pest --testsuite=unit; echo "exit=$?"
mv $PLUGIN/tests/Pest.php.bak $PLUGIN/tests/Pest.php
rm $PLUGIN/tests/Unit/ZLeakProbeTest.php
# Expected: `31 passed` and exit=0 — AND THAT IS THE FAILURE. The probe stubs
#           nothing, yet reads '' from `get_post_meta`, because the stub leaked out
#           of BlameScoreTest's last test. Removing tearDown() does not turn the
#           suite red; it makes one MORE thing pass. Put tearDown() back and the
#           same probe fails with `Call to undefined function get_post_meta()` —
#           `1 failed, 30 passed`, exit NON-ZERO — which is the correct answer to
#           asking an un-stubbed WordPress function a question.
#           Do NOT expect a leaked unmet `expect()` to surface in a later file:
#           Mockery is verified at the end of every test whether tearDown() is
#           there or not, so that one always fails where it was written. The silent
#           row of Key Concept 3's table is the `when()` row, not the `expect()`.
docker compose run --rm composer run test:unit; echo "exit=$?"
# Expected: 30 passed, exit=0 — restored

# 10. NEGATIVE — the static memo hazard is real. Prove it once.
sed -i.bak 's/401/101/g' $PLUGIN/tests/Unit/BlameScoreTest.php
docker compose run --rm composer exec -- pest --filter=BlameScore; echo "exit=$?"
mv $PLUGIN/tests/Unit/BlameScoreTest.php.bak $PLUGIN/tests/Unit/BlameScoreTest.php
# Expected: exit NON-ZERO, 1 failed and 5 passed, and the failure is `returns null
#           when the incident has no severity term` — which now reads the 297.0 the
#           FIRST test memoised against post ID 101. `static $memo` lives for the
#           PHP PROCESS, and PHPUnit runs every file in one. Key Concept 6.
#           It has to be 401->101 and not 302->301: both halves of the boundary
#           test assert 0.0, so a memo hit there is indistinguishable from a fresh
#           computation and the collision cannot be observed. A demonstration that
#           cannot fail demonstrates nothing.

# 11. PHPCS is clean, and PHPCS finds its own ruleset with NO --standard flag
docker compose run --rm composer run phpcs
# Expected: no errors. The ruleset lives beside composer.json inside the plugin
#           (Lesson 07.5), so PHPCS discovers it from the working directory in
#           both containers and on a CI runner.
#           If it reports dozens of file-comment and naming errors in tests/, the
#           exclude-pattern for tests/ is missing — Lesson 23.5 adds it, and this
#           is the check that tells you it is needed BEFORE CI goes red on arrival.

# 12. NEGATIVE — nothing generated was committed
git status --short wp-content/plugins/blame-the-tech-core/
# Expected: composer.json and composer.lock modified; six new files under tests/
#           and phpunit.xml.dist. NOT vendor/, NOT .phpunit.cache, NOT any .bak.
git check-ignore -v wp-content/plugins/blame-the-tech-core/vendor
# Expected: a rule from the root .gitignore
git status --short | grep -cE 'vendor/|\.phpunit\.cache|\.bak$'
# Expected: 0

# 13. The Composer script is spelled the way Lesson 24.4's workflow will call it
docker compose run --rm composer run --list | grep 'test:unit'
# Expected: a `test:unit` line. It runs `pest --testsuite=unit`, so it works
#           verbatim on a CI runner with PHP and Composer installed natively —
#           which is the whole point of declaring it as a Composer script rather
#           than only writing the docker invocation in a README.
```

Check 2 is the one that proves the claim in the Quick Overview, and check 9 is the one that proves
the suite is trustworthy. Run both. A suite that needs WordPress but says it does not is a suite
whose speed you will stop believing, and a suite with a leaked double is a suite whose green you
should not believe at all.


## Control Questions

1. `Functions\when('current_user_can')->justReturn(false)` appears in this lesson's suite and
   `Functions\expect('current_user_can')` never does. Explain the difference in terms of what each
   test would still prove if WordPress's entire authorisation layer were deleted — then give one
   assertion involving `current_user_can` that you would accept in a unit test and one you would
   move to Lesson 23.5.
2. Two `BlameScoreTest` tests stub identical meta values for two different post IDs, and reusing
   one ID makes a later test pass for the wrong reason. Name the language feature responsible,
   explain why PHPUnit's default execution model makes it visible at all, and rank the three
   available fixes by what each one costs.
3. `revalidate_send()` returns silently when `BTT_REVALIDATE_SECRET` is empty *or* the literal
   `__CHANGE_ME__`. Argue for that behaviour, then argue that it is wrong and that it should log
   loudly instead — and say which environment would make you change your mind.
4. `deny_create_incidents_until_verified()` allows an account whose `btt_verified` meta was never
   written, and denies one where it is the string `'0'`. State the PHP fact that makes those two
   cases identical to a naive check, name two classes of real account the naive check would lock
   out, and say why the symptom would be almost impossible to diagnose from a support ticket.
5. `Monkey\tearDown()` is in `Pest.php`'s `afterEach`, and removing it makes an *unrelated* test
   fail. Describe the mechanism, then generalise: give two other places in this codebase where
   per-test state can leak between tests, and say what each one's equivalent of `tearDown()` is.


## Learn More

- [Pest — Writing tests](https://pestphp.com/docs/writing-tests) — `it`, `test`, `expect` and
  `beforeEach`; skim it once so the `uses()->in('Unit')` scoping in Step 3 reads as an API rather
  than as magic
- [Pest — Datasets](https://pestphp.com/docs/datasets) — the `dataset()` and `->with()` forms used
  for the sixteen enum pairs, including why a named dataset gives you a better failure message than
  a `foreach`
- [Brain Monkey — Functions API](https://giuseppe-mazzapica.gitbook.io/brain-monkey/functions-testing-tools/functions-when)
  — `when`, `expect` and `stubs` in the author's own words, and the paragraph that explains why
  `when` asserts nothing
- [Brain Monkey — WordPress hooks API](https://giuseppe-mazzapica.gitbook.io/brain-monkey/wordpress-specific-tools/wordpress-hooks-added)
  — how `add_action` becomes inspectable, and the `Actions\has` / `expectAdded` distinction Key
  Concept 6 tells you not to lean on
- [Brain Monkey — Setup and teardown](https://giuseppe-mazzapica.gitbook.io/brain-monkey/wordpress-specific-tools/wordpress-setup)
  — read this one properly. It is two pages and it is the whole of Key Concept 3
- [PHPUnit — the XML configuration file](https://docs.phpunit.de/en/11.5/configuration.html) —
  `testsuites`, `failOnRisky`, `cacheDirectory` and `processIsolation`; Pest reads all of it
- [WordPress — `get_user_meta()`](https://developer.wordpress.org/reference/functions/get_user_meta/)
  — the `$single` parameter and what it returns for an absent key, which is the fact behind Key
  Concept 7
- [WordPress — `map_meta_cap` hook](https://developer.wordpress.org/reference/hooks/map_meta_cap/)
  — the four arguments the filter receives, and the reminder that it runs for *every* capability
  check, which is why the `$cap` name test is the first line of the function
- [PHP — `hash_hmac()`](https://www.php.net/manual/en/function.hash-hmac.php) — the exact
  algorithm and output encoding that has to match Node's `createHmac(...).digest('hex')` on the
  other side of contract seam ③

