---
title: 'Testing WordPress PHP with Pest'
module: 23
lesson: 4
teaches: [pest, brain-monkey, php-unit-testing, mocking-wordpress, readable-test-names]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Unit/BlameScoreTest.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/tests/Pest.php', 'wordpress-headless/composer.json']
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

- Pest and Brain Monkey as dev dependencies in `wordpress-headless/composer.json`, the plugin's
  PSR-4 autoload wired for `tests/`, and `tests/Pest.php` starting and stopping Brain Monkey
  around every test
- `tests/Unit/BlameScoreTest.php` — the severity-weight computation, its boundaries, and its
  behaviour on missing meta
- Unit tests for the enum mapper from [appendix 03 §3](../appendix/03-content-model-reference.md),
  covering every value in both directions plus an unknown input
- A test proving the revalidation webhook builder signs the payload correctly and never logs the
  secret
- A test asserting `is_verified` is discarded from mutation input, using `Functions\expect` to show
  the update never receives it
- `composer test:unit` runnable inside the existing `wordpress` container, in under a second

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
