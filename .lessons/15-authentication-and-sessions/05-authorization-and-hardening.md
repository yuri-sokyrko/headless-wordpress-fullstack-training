---
title: 'Authorization & Hardening'
module: 15
lesson: 5
teaches: [route-guards, entry-point-matrix, csrf-defence-in-depth, rate-limiting, wordpress-as-authority]
produces: ['next-app/src/lib/auth/guards.ts', 'next-app/src/middleware.ts', 'next-app/src/app/[locale]/account/layout.tsx', 'next-app/src/app/[locale]/account/page.tsx', 'next-app/src/app/[locale]/incidents/submit/page.tsx']
requires: [15.3, 15.4]
---

# Lesson 15.5 — Authorization & Hardening

## Quick Overview

Authentication answers "who is this?". Authorization answers "may they do this?", and in this
architecture the answer always comes from WordPress. Next.js gets to make exactly one kind of
decision — whether to render a page or redirect the browser to `/login` — and that is a **user
experience** decision, not a security boundary. If your guard in `guards.ts` were deleted, the
worst outcome would be an ugly empty account page; the mutation behind it would still refuse,
because `create_incidents` is checked in PHP by WordPress's own authorization layer. Say that out
loud before you write the guard, because the opposite belief — that the middleware is the
protection — is how headless apps ship with an unprotected mutation behind a protected page.

The centrepiece of this lesson is an artifact rather than a feature: an **entry-point
verification matrix** listing every route handler and every Server Action in the app against five
columns — AuthN, AuthZ, Validation, Rate limit, CSRF — with a real answer in every cell,
including "n/a, and here is why". You will fill in the rows that exist today (`/api/health`,
`/api/auth/refresh`, `login`, `logout`, `register`) and leave stubs for the ones Modules 16, 17
and 18 add. On CSRF specifically, be precise about the layering: Next enforces an Origin/Host
match on Server Action POSTs and you configure `experimental.serverActions.allowedOrigins` to
match your deployment; `SameSite` on the session cookies is the second layer; and
`/api/revalidate` (Module 18) is cookieless and HMAC-signed, so CSRF against it is structurally
impossible rather than merely blocked. Neither layer alone is a policy — the matrix is the policy.

By the end of this lesson you will have:

- `src/lib/auth/guards.ts` — `requireSession()` and `requireCapability()`, both server-only, both
  documented as UX redirects rather than security boundaries
- `middleware.ts` extended to gate `/account` and `/incidents/submit`, refresh a near-expiry
  `btt_at`, and preserve the `[locale]` segment on redirect
- A guarded `/en/account` (layout + page) showing the viewer's display name and roles, rendered
  `force-dynamic` and never cached
- A guarded `/en/incidents/submit` shell that says the form arrives in Module 16
- The filled-in entry-point verification matrix — every entry point × AuthN / AuthZ / Validation /
  Rate limit / CSRF, with the Module 16–18 rows stubbed
- Negative proofs: an anonymous `curl` to `/api/auth/refresh` returns `401`, an anonymous browser
  hit on `/en/account` lands on `/en/login`, and a cross-origin Server Action POST is rejected

## Classic WP Analogy

Classic WordPress has this exact split, and most developers get it right there without thinking
about it. `is_user_logged_in()` decides whether to show a template or `wp_redirect()` to
`wp_login_url()`. `current_user_can( 'publish_posts' )` decides whether the operation is allowed.
Nobody sensible protects a `wp_insert_post()` call by only hiding the button — the capability
check lives next to the write. And CSRF has its own layer entirely: `wp_nonce_field()` /
`check_admin_referer()` on the form, independent of who the user is.

| Classic WordPress | This stack |
|---|---|
| `is_user_logged_in()` + `wp_redirect( wp_login_url() )` | `requireSession()` in a layout, `middleware.ts` for the redirect |
| `current_user_can( 'publish_incidents' )` | unchanged — still `current_user_can()`, still in PHP |
| `check_admin_referer()` / `wp_verify_nonce()` | Next's Origin/Host check on Server Actions + `SameSite` |
| `map_meta_cap` narrowing `edit_post` to one post | unchanged — WordPress still owns per-object authorization |
| `admin_init` capability bouncer | `middleware.ts` matcher |
| A REST `permission_callback` | the AuthZ column of the entry-point matrix |

**Where the analogy breaks down:** in Classic WordPress the page and the write happen in the same
PHP request, so a capability check placed anywhere in that request protects both. Here they are
in different runtimes on different machines, potentially in different data centres, and an
attacker can call the write without ever requesting the page. The page guard and the mutation
guard are no longer two views of one check — they are two separate checks, and only one of them
is load-bearing. Treating middleware as security is the single most common headless
authorization failure, and it is comfortable precisely because it *feels* like `admin_init`.

The second break: WordPress nonces are tied to a user and an action and expire, so they double as
a weak replay guard. Next's CSRF story is not nonce-based at all — it is an origin check plus
cookie `SameSite` attributes. That is strictly less expressive, which is why the endpoints that
carry real authority in this app do not rely on it: `/api/revalidate` takes no cookie and verifies
an HMAC with a timestamp window instead (Lesson 18.3), and `/api/preview` exchanges a single-use
token server-to-server (Lesson 17.2). When an endpoint cannot be defended by an origin check,
change the endpoint's design rather than trusting the origin check harder.

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
