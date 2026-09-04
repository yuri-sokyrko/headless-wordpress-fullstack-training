---
title: 'Component Testing with RTL & MSW'
module: 23
lesson: 2
teaches: [react-testing-library, user-event, queries-by-role, msw-v2, graphql-handlers, handler-reuse]
produces: ['next-app/tests/mocks/handlers.ts', 'next-app/tests/mocks/server.ts', 'next-app/src/components/incidents/IncidentFilters.test.tsx']
requires: [23.1, 12.2, 08.4]
---

# Lesson 23.2 — Component Testing with RTL & MSW

## Quick Overview

React Testing Library has one opinion and it is the right one: **test the component the way a
user reaches it.** Not by class name, not by component internals, not by state — by role, by
accessible name, by label text. `getByRole('button', { name: /submit/i })` passes only if there
is something that is genuinely a button and genuinely announces itself as "Submit". That makes
your tests resistant to refactoring and, as a side effect you will feel immediately, makes
inaccessible markup untestable. `user-event` completes the picture by simulating real
interaction sequences — a click is a pointerdown, a focus, a mouseup and a click, in order — so a
component that only works because you fired a synthetic `change` event fails honestly.

The other half is **MSW v2**, which intercepts at the network layer rather than mocking your
GraphQL client. `graphql.query('IncidentsList', resolver)` matches by operation name and returns
whatever you say, which means your component under test runs its real data-fetching code against
a fake WordPress that never has to be running. Type the handler responses with the codegen'd
types from Module 10 and the fake becomes a contract check: change the query, and the handler
stops compiling. Handlers live in `tests/mocks/handlers.ts` once and are reused by every test
file, with per-test overrides via `server.use()` for the error and empty cases — which are the
cases that actually break in production.

By the end of this lesson you will have:

- `tests/mocks/handlers.ts` — typed MSW v2 GraphQL handlers covering the queries the client
  islands issue, built on the `src/gql/` generated types
- `tests/mocks/server.ts` and the Vitest setup wiring, with `onUnhandledRequest: 'error'` so an
  unmocked call is a test failure rather than a silent hang
- `IncidentFilters.test.tsx` — filtering, empty state, and the `aria-live` announcement from
  Lesson 22.2 asserted by role
- Tests for the locale switcher and the mobile nav, queried by role and accessible name only
- Per-test overrides for a GraphQL error response and an empty connection, proving the error and
  empty UI exist
- A `user-event` keyboard-only test for at least one island, so keyboard support has a
  regression test and not just a manual pass

## Classic WP Analogy

The closest thing you have written is a PHPUnit test for a template tag, or more likely nothing
at all — Classic WordPress markup was rendered by PHP, and testing PHP-rendered markup meant
either string comparison (brittle, and everyone abandoned it) or loading WordPress and scraping
the output (slow, and everyone abandoned that too).

| Classic WordPress | RTL + MSW |
|---|---|
| Test the whole page output as a string | Render one component; query its accessibility tree |
| Need a database and a post to render anything | Props, or an MSW handler — no container, no MySQL |
| Mock `wp_remote_get` with `pre_http_request` | `graphql.query(...)` handler in MSW |
| `WP_UnitTestCase` factories for fixtures | Typed fixture objects, plus the seeder for E2E only |
| A jQuery behaviour: tested by clicking staging | `user-event` sequences in a real DOM (jsdom) |

The mocking row is the interesting one, because it is a place headless is straightforwardly
better. Faking HTTP in WordPress means hooking `pre_http_request` — a global filter, applied to
every request in the process, that you must remember to remove. MSW intercepts at the network
layer with per-test scoping and resets between tests automatically. Same idea, none of the
global-state hazard.

Where the analogy breaks: **there is no Classic equivalent of a component boundary, so there is
no Classic equivalent of choosing what to render.** A PHP template was the page. Here you choose
a unit, and choosing wrong is how you end up with a useless suite. Two failure modes to avoid,
both common. Rendering too small — asserting that `IncidentCard` renders a title — tests React,
not your code. Rendering too large — mounting a whole route — runs into the RSC rule from Lesson
23.1 and simply will not work, because the route is an async Server Component.

The sharp edge, stated once: **MSW only helps components that fetch in the browser or in a
jsdom-simulated client environment.** Your Server Components fetch on the server, and you are not
rendering them here. So this suite covers exactly the client islands — the filter, the switcher,
the nav, the dialog, the forms — and nothing else. Everything server-side is Lesson 23.3 or
Playwright. Being clear about that boundary is what stops this suite from silently pretending to
cover the site.

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
