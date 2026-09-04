---
title: 'Testing Server Components & Actions'
module: 23
lesson: 3
teaches: [rsc-testing-rule, vi-mock-next-cache, vi-mock-next-headers, server-action-tests, route-handler-tests, negative-assertions]
produces: ['next-app/src/actions/incidents.test.ts', 'next-app/src/actions/auth.test.ts']
requires: [23.2, 16.2, 15.3]
---

# Lesson 23.3 — Testing Server Components & Actions

## Quick Overview

Server Actions and route handlers are where the security of this application lives, so they are
the code most worth testing — and they are testable, unlike the components that call them. A
Server Action is an exported async function that takes a `FormData` and returns a result. You can
import it in Vitest and call it. What you cannot do is let it reach the real `next/cache` and
`next/headers`, so you replace those two modules: `vi.mock('next/cache')` gives you a spy on
`revalidateTag` that lets you assert *which tag* was purged, and `vi.mock('next/headers')` gives
you a controllable `cookies()` so you can present a session, present a bad session, or present
none at all.

The tests that matter here are the **negatives**, and they are worth naming individually because
each one pins a security property that is otherwise only enforced by code you might refactor.
`/api/auth/login` must set the session cookie with `HttpOnly`, `Secure` and `SameSite`, and must
**never** return the JWT in the response body — that is one assertion on `Set-Cookie` and one
assertion that the parsed body contains no token-shaped field. An unauthenticated
`submitIncidentAction` must call the GraphQL client **exactly zero times**: not "return an
error", *zero calls*, because a rejection that happens after the network call has already gone
out is a rejection that leaked a request. And the `incidentSubmissionOpen` kill switch from
[appendix 03 §4.5](../appendix/03-content-model-reference.md) must be honoured, since a feature
flag with no test is a feature flag that stops working.

This is also the lesson that restates the RSC rule with a worked example, because the rule only
becomes obvious once you have seen the refactor it implies.

By the end of this lesson you will have:

- A Vitest setup for the server environment with `next/cache` and `next/headers` mocked centrally
- `src/actions/incidents.test.ts` — valid submission, Zod rejection, unauthenticated rejection
  with **zero** GraphQL calls, kill-switch honoured, and the exact `revalidateTag` arguments asserted
- `src/actions/auth.test.ts` — cookie flags asserted from the `Set-Cookie` header, and a body
  assertion proving no JWT is returned
- A route-handler test calling the exported `POST` with a real `Request`, including the
  HMAC-failure path from Module 18
- One component refactored to satisfy the RSC rule: logic lifted from an async component into a
  `lib/` function, with the function unit-tested and the rendering left to Playwright
- A written note in `docs/testing-strategy.md` recording which behaviours are deliberately
  covered only by E2E

## Classic WP Analogy

You have tested something like this before, and the mapping is close enough to be genuinely useful.

| Classic WordPress | Next.js |
|---|---|
| `admin_post_*` handler processing `$_POST` | A Server Action taking `FormData` |
| `check_admin_referer()` / nonce verification | Server Action origin checks, covered in Lesson 24.2 |
| `current_user_can()` gate at the top | A session read from `cookies()` and a capability check in WordPress |
| `wp_send_json_error()` | A typed result object returned to the form |
| Filtering `pre_http_request` to fake an API | `vi.mock` on the GraphQL client module |
| `wp_cache_flush()` after a write | `revalidateTag()` — and asserting *which* tag |

The instinct that transfers best is the one about **order of checks**. Any WordPress developer
who has written an `admin_post_` handler knows the shape: verify the nonce, check the capability,
sanitize the input, *then* do the work. Getting that order wrong in WordPress meant an
unauthenticated user could trigger a side effect. Getting it wrong here means the same thing,
and the test that proves it is right is the "zero GraphQL calls" assertion.

Where the analogy breaks is the one that costs people the most time: **`the_content()` had no
async equivalent, and Server Components do.** In Classic WordPress every rendering function was
synchronous, so anything that rendered could be called in a test if you loaded enough of core.
An async Server Component cannot be rendered by React Testing Library at all — RTL uses
`react-dom`, which has no server component runtime and no mechanism for awaiting a component
function. There is no flag, no environment and no adapter that fixes this. Accepting it early is
the whole point of the rule from Lesson 23.1, and the compensation is real: it forces the logic
out of the component and into a function that is easier to test than any WordPress code you have
ever written.

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
