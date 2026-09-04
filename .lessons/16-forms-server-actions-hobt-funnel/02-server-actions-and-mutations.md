---
title: 'Server Actions & Mutations'
module: 16
lesson: 2
teaches: [server-actions, use-action-state, five-step-skeleton, rate-limiting, trust-boundaries]
produces: ['next-app/src/actions/incidents.ts', 'next-app/src/lib/rate-limit.ts', 'next-app/src/components/incidents/IncidentSubmitForm.tsx', 'next-app/src/app/[locale]/incidents/submit/page.tsx']
requires: [6.3, 16.1]
---

# Lesson 16.2 — Server Actions & Mutations

## Quick Overview

This is the lesson that turns Blame The Tech from a reader into an application, and it is the
lesson whose output every later mutation copies. You will write **one** Server Action —
`submitIncident` — as five explicit steps, in this order, every time: (1) rate-limit and **fail
closed** if the limiter is unreachable; (2) `schema.safeParse` and return typed field errors
rather than throwing; (3) authenticate and authorise from the session, not from anything the form
sent; (4) call the `createIncident` mutation with the user's Bearer token; (5) `revalidateTag`,
then redirect or return typed state. Lessons 16.3 and 16.4 repeat that skeleton verbatim. If a
future action of yours skips a step, the skip is the bug — which is the entire reason the skeleton
is fixed rather than idiomatic.

Step 4 is where the trust boundary lives, and it is worth being blunt about what WordPress does
with your carefully validated payload: it does not trust a byte of it. `createIncident`
re-validates every field independently, re-checks `create_incidents` with `current_user_can()`,
**forces** `post_status` to `pending` and `post_author` to the authenticated user, and **silently
ignores** any client-supplied `is_verified` — see
[appendix 03 §4.1](../appendix/03-content-model-reference.md#41-incident-details). A field being
present in a GraphQL input type is not permission to set it. Rate limiting follows the same
double-enforcement logic: `src/lib/rate-limit.ts` uses Upstash Redis per IP to shed load at the
edge, and WordPress keeps its own per-user transient limit which is the **authoritative** one,
because your Next-side limiter is bypassed the instant someone finds the WordPress origin — and
media `sourceUrl` values mean they will.

By the end of this lesson you will have:

- `src/lib/rate-limit.ts` — a per-IP Upstash limiter with an explicit fail-closed branch and a
  unit test for the Redis-is-down path
- `src/actions/incidents.ts` — `submitIncident` written as the five numbered steps, with the step
  numbers as comments so a reviewer can see a missing one
- `IncidentSubmitForm.tsx` on `useActionState`, with a pending state, field errors from step 2 and
  a working no-JavaScript submit
- A live `/en/incidents/submit` that creates a real `pending` incident visible in wp-admin
- A per-user rate limit in the plugin, enforced with transients, proven to still bite when the
  Next-side limiter is disabled
- Negative proofs: a direct `curl` at `/graphql` with a reporter token that tries
  `status: PUBLISH` and `is_verified: true` and gets neither

## Classic WP Analogy

The Classic WordPress equivalent of a Server Action is `admin-post.php`. You register
`admin_post_btt_submit_incident`, point a form's `action` at `admin-post.php` with a matching
`action` hidden field, add `wp_nonce_field()`, and your handler receives `$_POST`, validates it,
calls `wp_insert_post()`, and finishes with `wp_safe_redirect()`. A Server Action is that with the
routing and the nonce plumbing deleted: `'use server'` makes the function itself the endpoint,
React generates the reference the form posts to, and Next checks the request's `Origin` against
`Host` before it runs.

| Classic WordPress | This stack |
|---|---|
| `admin_post_*` / `wp_ajax_*` handler | an exported `async function` in `src/actions/incidents.ts` |
| the hidden `action` field + `admin-post.php` | the action reference React puts in `<form action={…}>` |
| `wp_nonce_field()` + `check_admin_referer()` | Next's Origin/Host check + `SameSite` (Lesson 15.5) |
| `wp_insert_post( ['post_status' => 'pending'] )` | the `createIncident` mutation, which forces `pending` itself |
| `wp_safe_redirect()` + `exit` | `redirect()` from `next/navigation` |
| a transient-based throttle | `src/lib/rate-limit.ts`, **plus** the WordPress-side transient |
| `WP_Error` back into the template | the typed state object returned to `useActionState` |

Two questions come up here, and both have a real answer. *Why a Server Action and not a route
handler?* Because a Server Action can set cookies, receives `FormData` from a plain HTML form, and
therefore still works with JavaScript disabled or still loading — for a lead-capture CTA on the
page whose conversion rate marketing is measuring, progressive enhancement is a revenue argument,
not a purity one. *Why does WordPress re-validate what Next already validated?* Because Next is
not a trusted client. It is trusted *infrastructure* and it is still a client.

**Where the analogy breaks down:** in `admin-post.php` you are already inside WordPress. `$_POST`
arrives, `current_user_can()` reads the same session, `wp_insert_post()` runs in the same request,
and there is exactly one place where authorization can be enforced or forgotten. A Server Action
runs on a completely different machine and calls WordPress over HTTP as an authenticated client.
Every guard you write in the action is a **second** guard; the real one is in PHP. Code that reads
like `if ( session.roles.includes('editor') ) { publish() }` is not a security control, it is a
comment with syntax.

The second break: `admin-post.php` handlers run once per submit and nothing is cached. A Server
Action mutates state that Next has probably already cached as static HTML, so step 5 —
`revalidateTag` — is not housekeeping. Skip it and the user submits successfully, is redirected,
and sees a page that convincingly claims their submission does not exist. Module 18 makes that
mechanism precise.

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
