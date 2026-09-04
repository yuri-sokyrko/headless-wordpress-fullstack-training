---
title: 'Route Handlers & Middleware'
module: 9
lesson: 5
teaches: [route-handlers, middleware, edge-runtime, next-public-boundary, health-endpoint]
produces: ['next-app/src/app/api/health/route.ts', 'next-app/src/middleware.ts']
requires: [9.4]
---

# Lesson 09.5 — Route Handlers & Middleware

## Quick Overview

Not everything a front end needs is a page. Next.js has two non-page entry points, and this
lesson builds one of each. A **Route Handler** is a `route.ts` file exporting `GET`, `POST` and
friends — a real HTTP endpoint, the direct counterpart of `register_rest_route()`. **Middleware**
is a single `middleware.ts` that runs before every matched request and can rewrite, redirect or
pass through — the counterpart of a `template_redirect` or `init` hook, running at the edge
before any page code executes.

You will build `/api/health`, a liveness endpoint that reports whether Next can reach WordPress
without echoing a single configuration value, and a `middleware.ts` that normalises the locale
prefix so `/incidents` redirects to `/en/incidents`. That middleware is the second half of the
`[locale]` decision from Lesson 09.1: the segment is required, so something has to add it, and
doing that in middleware means Module 15's auth gate and Module 20's locale negotiation both
have a place to live that already exists. The lesson closes by proving the client bundle holds
no secrets, with the `grep` from
[the env reference](../appendix/04-env-reference.md#32-public-next_public_--all-four-of-them) —
the same check Module 24 turns into a CI gate.

By the end of this lesson you will have:

- `next-app/src/app/api/health/route.ts` — `GET` returning JSON status, with no endpoint URL or token in the body
- `next-app/src/middleware.ts` — locale prefix normalisation with an explicit `matcher` that excludes `/api` and static assets
- `/incidents` redirecting to `/en/incidents`, verified with `curl -I`
- A production build whose `.next/static/` contains none of your server-only variables
- A written note of what middleware must never be used for, and why the auth gate in Module 15 is only half of a check

## Classic WP Analogy

Both new concepts map onto hooks and APIs you already use:

| Classic WordPress | Next.js |
|---|---|
| `register_rest_route('btt/v1','/health',…)` | `src/app/api/health/route.ts` exporting `GET` |
| `permission_callback` on that route | an explicit check inside the handler |
| `add_action('template_redirect', …)` | `middleware.ts` |
| `wp_safe_redirect()` + `exit` | `NextResponse.redirect()` |
| `add_rewrite_rule()` internal rewrite | `NextResponse.rewrite()` |
| `wp_get_environment_type()` branching | `process.env.NODE_ENV` branching |
| `$_SERVER['HTTP_ACCEPT_LANGUAGE']` sniffing | `request.headers.get('accept-language')` |

The Route Handler comparison is almost exact, including the part people skip.
`register_rest_route()` without a `permission_callback` is a public endpoint, and a `route.ts`
without an auth check is the same thing. That is why this course treats
"every endpoint is authenticated or deliberately public" as a rule with no exceptions, and why
`/api/health` is written the way it is: it is intentionally public, so it
must return no information an attacker could use. It reports `ok` or `degraded` and a
timestamp. It does not report which endpoint it tried, what the error said, or which
environment variables are set.

The analogy breaks hardest on middleware, in two ways that matter.

**Middleware runs everywhere, including on requests you did not think about** — RSC payload
fetches, prefetches, static assets, `/api` routes. WordPress's `template_redirect` fires only
on front-end page loads. This is why `matcher` is not an optimisation but a correctness
requirement: middleware without one will run on your own asset requests and produce redirect
loops that are very hard to read.

**Middleware runs in a restricted runtime with no database and no Node APIs.** It cannot call
`WP_Query`, cannot open a socket to MySQL, and cannot verify a JWT signature against
WordPress's secret — because, as
[appendix 04 §5](../appendix/04-env-reference.md#5-why-graphql_jwt_auth_secret_key-must-differ-from-auth_key)
states, Next never holds that secret at all. So middleware can cheaply check whether a session
cookie is *present* and redirect if it is not, but it can never decide whether a session is
*valid*. Treating a middleware check as authorisation is the single most common security
mistake in Next.js applications. Module 15 states the rule precisely: middleware is a
convenience redirect, and the real check happens where the data is.

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
