---
title: 'Authorization & Hardening'
module: 15
lesson: 5
teaches: [route-guards, entry-point-matrix, csrf-defence-in-depth, rate-limiting, wordpress-as-authority]
produces: ['next-app/src/lib/auth/guards.ts', 'next-app/src/proxy.ts', 'next-app/src/app/[locale]/account/layout.tsx', 'next-app/src/app/[locale]/account/page.tsx', 'next-app/src/app/[locale]/incidents/submit/page.tsx']
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
loud before you write the guard, because the opposite belief — that the proxy is the
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
- `proxy.ts` extended to gate `/account` and `/incidents/submit`, refresh a near-expiry
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
| `is_user_logged_in()` + `wp_redirect( wp_login_url() )` | `requireSession()` in a layout, `proxy.ts` for the redirect |
| `current_user_can( 'publish_incidents' )` | unchanged — still `current_user_can()`, still in PHP |
| `check_admin_referer()` / `wp_verify_nonce()` | Next's Origin/Host check on Server Actions + `SameSite` |
| `map_meta_cap` narrowing `edit_post` to one post | unchanged — WordPress still owns per-object authorization |
| `admin_init` capability bouncer | `proxy.ts` matcher |
| A REST `permission_callback` | the AuthZ column of the entry-point matrix |

**Where the analogy breaks down:** in Classic WordPress the page and the write happen in the same
PHP request, so a capability check placed anywhere in that request protects both. Here they are
in different runtimes on different machines, potentially in different data centres, and an
attacker can call the write without ever requesting the page. The page guard and the mutation
guard are no longer two views of one check — they are two separate checks, and only one of them
is load-bearing. Treating proxy as security is the single most common headless
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

### 1. Authentication, authorization, and the one decision Next is allowed to make

Three questions, three owners. Getting the third row wrong is how headless applications ship with
an unprotected mutation behind a protected page.

| Question | Answered by | Where |
|---|---|---|
| Who is this? | the signature over `data.user.id` | **WordPress**, on every call |
| May they do this? | `current_user_can( 'create_incidents' )` | **WordPress**, in PHP |
| Have they verified their email? | the `map_meta_cap` filter on `btt_verified` | **WordPress** (Lesson 15.3) |
| Should the browser be sent to `/login`? | cookie presence and `exp` arithmetic | **Next** — and this is the only row Next owns |

The module README's *Who Decides What* table says the same thing and is worth re-reading before
you write a line of this lesson. Every row lands in WordPress except the last, and the last one is
a **user-experience** decision: it decides whether somebody sees a page or a redirect. It decides
nothing about data.

> **Say the thesis out loud, because the whole lesson is a proof of it.** **If `guards.ts` were
> deleted tomorrow, the worst outcome is an ugly empty account page.** The mutation behind it still
> refuses, in PHP, because `create_incidents` is checked where the write happens (Lesson 06.2 §2)
> and the capability does not exist for an unverified reporter (Lesson 15.3 §4). Verification check
> 11 deletes the proxy and shows exactly that.

### 2. Proxy is not security, and the reason it feels like it is

This is the single most common security mistake in Next.js applications, and the reason it keeps
happening is that a proxy gate **resembles `admin_init`**. In Classic WordPress, a capability
check on `admin_init` really does protect wp-admin, because the page and the write happen in the
same PHP request. Place the check anywhere in that request and both are covered.

Here they are in different runtimes on different machines, potentially in different data centres.

```
   CLASSIC WORDPRESS                          THIS STACK
   ────────────────────────────────           ────────────────────────────────
   one request                                 two independent requests
     admin_init  → capability check              GET  /en/incidents/submit  → Next
     post.php    → wp_insert_post()              POST /graphql              → WordPress
        ▲                                                  ▲
        └── one check protects both                         └── the ONLY load-bearing check

   an attacker cannot reach the write          an attacker calls /graphql directly and
   without going through the request            never requests the page at all
```

The concrete failure it prevents is worth naming precisely: **a protected page in front of an
unprotected mutation.** The page redirects, the demo looks right, the code review passes, and the
mutation behind it has no `current_user_can()` call because "the route is guarded". Then somebody
`curl`s `/graphql`.

Lesson 09.5 §7 gave the thirty-second review for this, and it is still the only one anyone needs:

> **If deleting `src/proxy.ts` would make any data reachable that was not reachable before,
> the application is already broken.** That question has a yes-or-no answer. Ask it of every gate
> you ever add.

Proxy's actual contribution to security is one thing only: it saves a round trip for the
common case, and it saves a logged-out human from a broken page.

### 3. What proxy can and cannot do

Proxy runs in the Node.js runtime on Next 16, so the limits below are **not** the old
edge-isolate limits — every one of them survives a full Node process. Lesson 09.5 §6 explains
why reaching for Node APIs here is still the wrong instinct; what matters in this lesson is
which *auth* operations are possible at all.

| Proxy can | Proxy cannot |
|---|---|
| read `request.cookies` — presence and value | read `cookies()` from `next/headers` (different API) |
| do `exp` arithmetic with a base64url decode | verify a signature |
| redirect, rewrite, or continue | query WordPress cheaply enough to do it per request |
| set a response header | know whether the user still exists |

The last row on the right is the important one, and it is not a runtime limitation at all — it is
architectural. **Next holds no signing key** ([appendix 04 §5](../appendix/04-env-reference.md#5-why-graphql_jwt_auth_secret_key-must-differ-from-auth_key)),
so even a full Node runtime with every npm package installed could not judge a token. There is
nothing to upgrade your way out of.

There is also a concrete import boundary that will bite you the first time:

> **`src/proxy.ts` cannot import a module that carries `import 'server-only'`.** The package
> throws outside the `react-server` condition, and proxy is not a React Server Component
> context. That is why Lesson 15.4 split the auth library in two: `src/lib/auth/jwt.ts` is pure
> and runtime-agnostic — the cookie names and `decodeExpiry` live there — while `cookies.ts`,
> `session.ts` and `guards.ts` all carry the guard. Proxy imports from `jwt.ts`. Reach for
> `@/lib/auth/session` instead and the build fails with a message about `server-only` that will
> not obviously be about proxy. Same reasoning as `tags.ts` and `errors.ts` in Module 10.

### 4. The matcher does not change, and that is the finding

The instinct is that a new gate needs a new matcher. It does not, and looking at why is more
useful than editing the regex.

Lesson 09.5 wrote `matcher: ['/((?!api|_next|favicon\\.ico|.*\\..*).*)']`, which already routes
`/en/account` and `/en/incidents/submit` through proxy — they are page paths with no dot and
no `api` or `_next` prefix. **The set of requests reaching proxy is byte-identical before and
after this lesson. What changed is what proxy does with them.**

| Request | Before | After |
|---|---|---|
| `GET /en` | locale ok → `next()` | locale ok, not guarded → `next()` |
| `GET /account` | → 307 `/en/account` | → 307 `/en/account` |
| `GET /en/account` | locale ok → `next()` | **not guarded? no** → 307 `/en/login?next=/en/account` |
| `GET /api/health` | skipped | skipped |
| `GET /_next/static/…` | skipped | skipped |

Two edits are tempting and both are wrong:

**Adding `'/api/auth/:path*'` to the matcher.** Proxy would then run on
`/api/auth/refresh` — the very endpoint it redirects to when a token is near expiry — and the
redirect would loop. The `api` exclusion is what makes the hand-off in Key Concept 5 terminate.

**Removing the `api` exclusion "so API routes are guarded too".** `/api/health` would be
redirected to `/en/api/health`, your uptime monitor would get a 404, and Lesson 09.5 §5 warned
about exactly this. Route handlers guard themselves, in their own code, where the data is.

> **A gate belongs in the matcher only if it is a page.** Everything else guards itself. That rule
> means the matcher in this application never changes again, and a matcher that never changes is a
> matcher that cannot regress.

### 5. Refreshing from proxy, and the price of a narrow `Path`

Here is the awkward truth this lesson has to state rather than hide. `btt_rt` is scoped to
`Path=/api/auth` (Lesson 15.4 §3), so **proxy running on `/en/account` never receives the
refresh token.** It cannot refresh. Not "should not" — cannot.

```
   GET /en/account          Cookie: btt_at=…      ← btt_rt is NOT sent: wrong Path
        │
   proxy: exp is 40s away, and I hold no refresh token
        │
        └──▶ 307 /api/auth/refresh?next=/en/account
                   │                    ← the browser DOES send btt_rt here
                   ├─ ok      → Set-Cookie btt_at, 307 back to /en/account
                   └─ refused → clear both cookies, 307 /en/login?next=/en/account
```

So the implementation is a **hand-off**: proxy does the `exp` arithmetic, and the one endpoint
that can see the refresh token does the work. Three properties make that safe rather than clever.
The hand-off runs on **every** matched path, not only guarded ones, so a session renews while the
user is reading public pages. A successful refresh returns a token with 300 seconds on it, which is
well outside the 60-second window, so there is no second hand-off. And a *failed* refresh clears
`btt_at`, which is what terminates the loop — Lesson 15.4's route does that in every non-`ok`
branch for exactly this reason.

The three alternatives, and why each is worse:

| Alternative | Why not |
|---|---|
| Give `btt_rt` `Path=/` so proxy can see it | throws away the blast-radius reduction that is the best thing about the cookie design |
| Add a non-secret "you have a session" hint cookie at `Path=/` | works, and appendix 04 §4 does not define one; a fourth cookie is a contract change, not a lesson's decision |
| A client component polling `/api/auth/refresh` | ships JavaScript whose only job is a `POST`, and puts session lifetime in the browser's hands |

**The cost, stated plainly:** an access cookie that has fully expired is indistinguishable, from
proxy, from never having logged in — so five minutes of *complete* inactivity ends the
session even though a 30-day refresh token is sitting in the browser. An active user never notices;
an idle one signs in again. That is the price of the narrowest cookie in the application, it is
worth paying, and it is written into `docs/quality-gates.md` rather than left as a surprise.

And the anti-pattern the module README warns about is avoided by construction: **there is no
WordPress round trip per request in proxy.** The `exp` read is arithmetic on a string.

### 6. Guards on a layout, and what a layout guard does not cover

`requireSession()` goes in `account/layout.tsx`, not in every page under it.

| | Layout guard | Page guard |
|---|---|---|
| New page under `/account` | **guarded automatically** | guarded only if you remember |
| Cost | one call, memoized by `cache()` for the whole render | one call per page |
| Failure mode | none obvious | a new file with no guard, which nothing detects |

A page-level guard is one forgotten file away from an unguarded page, and nothing in the type
system or the linter will tell you. A layout guard is the default-secure arrangement.

But be precise about the boundary, because a layout guard has a real hole:

```
   src/app/[locale]/account/layout.tsx   ← requireSession() runs here
        └── page.tsx                        ✅ covered
        └── settings/page.tsx               ✅ covered, for free
   src/app/api/account/export/route.ts   ← a route handler
                                            ❌ NOT covered. Different tree entirely.
```

A `route.ts` is not inside any `[locale]` layout. It has no layout at all. So **every route
handler authenticates in its own code**, which is why `/api/auth/refresh` reads the cookie itself
and why the entry-point matrix has a row per handler rather than per directory.

### 7. The entry-point verification matrix

The lesson's real artifact is a table, and it lands in `docs/quality-gates.md`. Five columns —
**AuthN · AuthZ · Validation · Rate limit · CSRF** — one row per route handler and per Server
Action, and **a real answer in every cell, including "n/a, and here is why"**.

Why a matrix rather than a rule? Because the questions are independent and the answers are not
uniform. `/api/health` needs no authentication and must not be rate-limited. `logout` needs no
authorization. `/api/revalidate` (Module 18) has no CSRF exposure at all, because it takes no
cookie. A single policy sentence covering all of that would be either false or useless.

| Column | The question | The answer that is a bug |
|---|---|---|
| AuthN | who is calling, and who verified that? | "the cookie is present" |
| AuthZ | may this caller do this? | "the page is guarded" |
| Validation | is the input acceptable, checked **server-side**? | "the form has `required`" |
| Rate limit | what stops ten thousand attempts? | silence |
| CSRF | what stops another site making this request with the user's cookies? | "we use POST" |

**"n/a" is a real answer and it must carry its reason.** `/api/health` reads no cookie, so there is
nothing for a cross-site request to ride and CSRF is `n/a — cookieless`. That is different from
`n/a` meaning "we did not think about it", and the difference is the whole value of the exercise.

Module 16 adds a row per action it writes. The README says so, and it says it as a warning: do not
start Module 16 with this matrix unfilled, because it is the only place that will tell you which
action you forgot to rate-limit.

### 8. CSRF is layers, not a mechanism

Next's story has three layers, and none of them alone is a policy.

**Layer one: Next enforces an Origin/Host match on Server Action POSTs.** A Server Action request
whose `Origin` header does not match the `Host` is rejected before your code runs. Behind a proxy
or on a preview deployment the `Host` Next sees is not the origin the browser used, so you declare
the allowed origins yourself in `experimental.serverActions.allowedOrigins`. That is Task Step 5,
and `127.0.0.1` is in the list because every Playwright address in this course is `127.0.0.1`.

**Layer two: `SameSite` on the session cookies.** `Lax` on `btt_at` withholds it from every
cross-site `POST`, `fetch`, iframe and image; `Strict` on `btt_rt` withholds it from everything
cross-site including a link click (Lesson 15.4 §§3–4). So even a request that got past layer one
would arrive with no credential.

**Layer three, and it is the one worth learning: change the endpoint's design.**
`/api/revalidate` (Module 18) reads **no cookie at all** and verifies an HMAC over the body with a
timestamp window. CSRF against it is not blocked — it is **structurally impossible**, because
there is no ambient credential for an attacker's page to borrow. `/api/preview` (Module 17) does
the same with a single-use token exchanged server-to-server.

| Layer | Protects | Fails when |
|---|---|---|
| Origin/Host check + `allowedOrigins` | Server Action POSTs | the deployment origin is not in the list, or a future Next default changes |
| `SameSite` on the session cookies | anything cookie-authenticated | a browser without `SameSite` support, or a same-site attacker |
| **No cookie, HMAC instead** | `/api/revalidate`, `/api/preview` | never, for CSRF specifically |

**Neither of the first two alone is a policy. The matrix is the policy** — it is the artifact that
records which layer covers which entry point, so that "is this CSRF-safe?" has a per-endpoint
answer rather than a shrug.

### 9. WordPress nonces versus this, and rate limiting as the fourth column

`wp_create_nonce()` produces a token tied to **a user, an action and a time window**. That is
strictly more expressive than an origin check, and it is worth being honest about the gap.

| | WordPress nonce | Next's Server Action check |
|---|---|---|
| Tied to a user | ✅ | ❌ |
| Tied to a specific action | ✅ | ❌ |
| Expires | ✅ 12–24 h | ❌ |
| Doubles as a weak replay guard | ✅ | ❌ |
| Requires server-side state | ❌ (derived from salts) | ❌ |

**Verdict: Next's story is less expressive, and that is exactly why the endpoints carrying real
authority in this application do not rely on it.** When an endpoint cannot be defended by an origin
check, change the endpoint rather than trusting the origin check harder — which is Key Concept 8's
layer three, arrived at from the other direction.

Rate limiting is the fourth column and it is the most honest one in the matrix today.
`src/actions/auth.ts` holds an in-memory `Map` (Lesson 15.4 §10), so the matrix records
`in-memory, per instance` for `login` and `register` — not "yes". `/api/auth/refresh` has **no**
rate limit at all, and that is a real gap the matrix names rather than hides. Lesson 16.2 replaces
the `Map` with an Upstash limiter shared by every action, and the row that says `in-memory, per
instance` today is the row that will remind you to fix the refresh endpoint too.

### 10. An authenticated response must never enter a shared cache

The last hardening, and the one with the widest blast radius if you get it wrong: serving one
user's account page to another user out of a cache.

Three independent mechanisms keep it from happening, and only one of them is a decision you make
in this lesson.

| Mechanism | Where | What it prevents |
|---|---|---|
| `fetchGraphQLAuthed` has `cache: 'no-store'` hard-coded and **no options parameter** | `src/lib/graphql/client.ts` (Lesson 10.1, edited 15.2) | an authenticated *response* entering Next's Data Cache — **unrepresentable**, not merely discouraged |
| `export const dynamic = 'force-dynamic'` | `account/{layout,page}.tsx` | the *route* being prerendered or cached as HTML |
| `Cache-Control: private, no-store` | set by proxy on guarded paths | a CDN or proxy in front of the app holding the HTML |

The first row is the one to notice, because it is a design property rather than a discipline.
There is no argument you can pass to `fetchGraphQLAuthed` that caches its result. A future
colleague cannot get this wrong by being in a hurry; they would have to change the function's
signature, which is a diff a reviewer sees.

The second and third are belt and braces on top. `force-dynamic` is redundant in Next 16 for a
route that reads `cookies()` — it is already dynamic — and it is written anyway, for the same
reason `/api/health` carries it (Lesson 09.5 §4): a statement of intent that survives a future
default change and tells the next reader the absence of caching is deliberate.

Module 18 is where cache tags, ISR and revalidation arrive, and it is where this rule earns its
keep. The forward-reference matters: **nothing in Module 18 may add a tag to an authenticated
response**, and the reason it cannot is the first row of that table.

---

## Task

Eight steps. Two new files, three anchored edits, one artifact, and a negative-proof sweep that
gets a step of its own because in an auth module the assertions that matter are the ones that must
fail.

### Step 1: Write `guards.ts`

```ts
// next-app/src/lib/auth/guards.ts
// UX REDIRECTS. NOT security boundaries.
//
// If this file were deleted, the worst outcome is an ugly empty account page:
// the mutations behind these routes still refuse, in PHP, because
// create_incidents is checked where the write happens (Lesson 06.2 §2) and the
// map_meta_cap filter denies it for an unverified reporter (Lesson 15.3 §4).
// Read that sentence again before you are tempted to put a real check here.
import 'server-only';

import { redirect } from 'next/navigation';

import { getSession, type Session } from './session';

/** The narrowed member, so a caller gets `displayName` without re-checking. */
type LoggedIn = Extract<Session, { readonly isLoggedIn: true }>;

/**
 * Render, or send the browser to the login page with a way back.
 *
 * `nextPath` comes from the CALLING PAGE — a literal like `/en/account` — and
 * never from the request, so it needs no open-redirect check here. The one that
 * DOES arrive from a query string is handled by `safeNextPath()` in
 * src/actions/auth.ts and in the refresh route.
 *
 * The target shape `/{locale}/login?next={pathname}` is frozen: Module 16's
 * Starting State asserts `307 http://localhost:3000/en/login?next=/en/account`
 * exactly, unescaped. So this is a template string, not URLSearchParams, which
 * would percent-encode the slashes.
 */
export async function requireSession(locale: string, nextPath: string): Promise<LoggedIn> {
  const session = await getSession();

  if (!session.isLoggedIn) {
    // redirect() throws NEXT_REDIRECT and is typed `never`, so TypeScript knows
    // the narrowed return below is reachable only for a real session.
    redirect(`/${locale}/login?next=${nextPath}`);
  }

  return session;
}

/**
 * An ADVISORY role check, for choosing which page to render. Read the failure
 * mode below before using it anywhere that matters.
 *
 * WPGraphQL gates `User.roles` behind `list_users` (Lesson 15.2 §1), so an
 * `incident_reporter` asking for its OWN roles can legitimately get an empty
 * array. This function therefore FAILS OPEN on empty roles: it renders the page
 * and lets WordPress refuse the write.
 *
 * That asymmetry is the whole lesson. A SECURITY check that cannot see its data
 * must fail closed. An ADVISORY check that cannot see its data must fail open,
 * because failing closed would hide a page from a user WordPress would have
 * allowed — and the mutation behind the page is guarded either way.
 */
export async function requireCapability(
  locale: string,
  nextPath: string,
  role: string
): Promise<LoggedIn> {
  const session = await requireSession(locale, nextPath);

  if (session.roles.length === 0) {
    // We could not see the roles. Not the same as "does not have the role".
    console.warn(`[btt] requireCapability(${role}): roles unavailable, rendering anyway`);

    return session;
  }

  if (!session.roles.includes(role)) {
    redirect(`/${locale}/account?denied=${role}`);
  }

  return session;
}
```

**Verify §1:**

- [ ] `grep -c 'current_user_can' src/lib/auth/guards.ts` is `0`. There is no capability check in
      TypeScript in this application, anywhere.
- [ ] `requireCapability` returns the session on empty `roles` rather than redirecting. If you
      wrote `if (!session.roles.includes(role)) redirect(...)` alone, every reporter is locked out
      of `/incidents/submit` and the cause is invisible.
- [ ] The login target is a template string, not `URLSearchParams`.

### Step 2: Edit `proxy.ts`

An anchored replacement of the whole `proxy()` body. `config` is shown **unchanged**, and
that is deliberate — Key Concept 4.

```ts
// next-app/src/proxy.ts — the full new proxy() body
import { NextResponse, type NextRequest } from 'next/server';

// From jwt.ts, NOT from session.ts: this file cannot import a module carrying
// `import 'server-only'`, because proxy is not a react-server context.
// Lesson 15.4 §6 and Lesson 15.5 §3.
import { AT_COOKIE, secondsUntilExpiry } from '@/lib/auth/jwt';

// One locale today (Lesson 09.1 §6). Module 20 adds 'uk' and 'de' here.
const LOCALES: readonly string[] = ['en'];
const DEFAULT_LOCALE = process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'en';

/** Prefixes BELOW the locale segment that require a session. A UX gate only. */
const GUARDED: readonly string[] = ['/account', '/incidents/submit'];

/** Hand off to /api/auth/refresh with fewer than this many seconds left. */
const REFRESH_WINDOW_SECONDS = 60;

function isGuarded(pathname: string, locale: string): boolean {
  const rest = pathname.slice(locale.length + 1);

  return GUARDED.some((prefix) => rest === prefix || rest.startsWith(`${prefix}/`));
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const firstSegment = pathname.split('/')[1] ?? '';

  // ── 1. LOCALE NORMALISATION — unchanged from Lesson 09.5 ──────────
  if (!LOCALES.includes(firstSegment)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${DEFAULT_LOCALE}${pathname === '/' ? '' : pathname}`;

    return NextResponse.redirect(url);
  }

  const token = request.cookies.get(AT_COOKIE)?.value ?? '';

  // ── 2. NEAR-EXPIRY HAND-OFF ───────────────────────────────────────
  // On EVERY matched path, not only guarded ones, so a session renews while the
  // user reads public pages. exp ARITHMETIC ONLY — no signature check, because
  // Next holds no signing key. And no WordPress round trip: this is string
  // maths, which is what the module README means by "without a round trip per
  // request".
  if (token !== '' && secondsUntilExpiry(token) <= REFRESH_WINDOW_SECONDS) {
    const handoff = request.nextUrl.clone();
    handoff.pathname = '/api/auth/refresh';
    // Assign `search` rather than using searchParams.set(): URLSearchParams
    // form-urlencodes, which turns `/` into `%2F`.
    handoff.search = `?next=${pathname}`;

    return NextResponse.redirect(handoff);
  }

  // ── 3. THE GATE ───────────────────────────────────────────────────
  if (!isGuarded(pathname, firstSegment)) {
    return NextResponse.next();
  }

  if (token === '') {
    const login = request.nextUrl.clone();
    login.pathname = `/${firstSegment}/login`;
    // FROZEN SHAPE. Module 16's Starting State asserts
    // `307 http://localhost:3000/en/login?next=/en/account` — unescaped.
    login.search = `?next=${pathname}`;

    return NextResponse.redirect(login);
  }

  // ── 4. NO SHARED CACHE FOR AN AUTHENTICATED RESPONSE ──────────────
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');

  return response;
}

// UNCHANGED from Lesson 09.5, and that is the finding rather than an oversight.
// `/en/account` already reaches proxy: it is a page path with no dot and
// no `api` or `_next` prefix. Adding '/api/auth/:path*' would run proxy on
// the endpoint step 2 redirects TO, and the redirect would loop. Removing the
// `api` exclusion would send /api/health to /en/api/health. Lesson 15.5 §4.
export const config = {
  matcher: ['/((?!api|_next|favicon\\.ico|.*\\..*).*)'],
};
```

**Verify §2:**

- [ ] `git diff src/proxy.ts` shows **no change** to `config`. If the matcher moved, re-read
      Key Concept 4 before continuing.
- [ ] The `exp` import is from `@/lib/auth/jwt`. Change it to `@/lib/auth/session` and
      `npm run build` fails with a `server-only` message — worth doing once, then undoing.
- [ ] Both `?next=` values are built by assigning `search`, not by `searchParams.set()`.
- [ ] `grep -c 'fetch(' src/proxy.ts` is `0`. No WordPress round trip, ever.

### Step 3: Write the guarded `/account`

```tsx
// next-app/src/app/[locale]/account/layout.tsx
import type { ReactNode } from 'react';

import { requireSession } from '@/lib/auth/guards';

// Redundant in Next 16 for a route that reads cookies(), and written anyway:
// a statement of intent that survives a future default change. Lesson 15.5 §10.
export const dynamic = 'force-dynamic';

export default async function AccountLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // ONCE, here, for every page under /account. A page-level guard is one
  // forgotten file away from an unguarded page (Lesson 15.5 §6).
  //
  // A layout cannot see the child's pathname, so the `next` value is the
  // section root. The precise path is carried by the proxy redirect; this
  // is the fallback for the case proxy did not catch — an RSC payload
  // request, say.
  await requireSession(locale, `/${locale}/account`);

  return <>{children}</>;
}
```

```tsx
// next-app/src/app/[locale]/account/page.tsx
import Link from 'next/link';

import { requireSession } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

export default async function AccountPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{ readonly denied?: string }>;
}) {
  const { locale } = await params;
  const { denied = '' } = await searchParams;

  // The SAME WordPress call the layout already made: getSession() memoizes the
  // viewer query with React's cache() (Lesson 15.4 §5). Two guards, one round
  // trip. Remove the cache() wrapper and this page costs two.
  const session = await requireSession(locale, `/${locale}/account`);

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>

      {denied !== '' ? (
        <p role="alert" className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-sm">
          That page needs the <code>{denied}</code> role. If you have just confirmed your email,
          try again.
        </p>
      ) : null}

      <dl className="mt-6 space-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Display name</dt>
          <dd className="font-medium">{session.displayName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Roles</dt>
          {/* DISPLAY ONLY. WPGraphQL gates User.roles behind list_users, so this
              can legitimately be empty for your own account — Lesson 15.2 §1.
              Nothing in this app decides anything from it. */}
          <dd className="font-medium">
            {session.roles.length > 0 ? session.roles.join(', ') : 'not reported by WordPress'}
          </dd>
        </div>
      </dl>

      <p className="mt-6 text-sm">
        <Link href={`/${locale}/incidents/submit`} className="underline">
          File an incident
        </Link>
      </p>
    </section>
  );
}
```

**Verify §3:**

- [ ] `grep -c 'force-dynamic' 'src/app/[locale]/account/page.tsx'` is `1`.
- [ ] Signed out, `http://localhost:3000/en/account` lands on `/en/login?next=/en/account` with the
      query string visible in the address bar.
- [ ] Signed in, the page shows your display name. `Roles` may say `not reported by WordPress`, and
      that is correct rather than broken.

### Step 4: Write the guarded `/incidents/submit` shell

The form is Lesson 16.2's. The **guard** is this lesson's, and 16.2 replaces the shell without
touching it.

```tsx
// next-app/src/app/[locale]/incidents/submit/page.tsx
import Link from 'next/link';

import { requireCapability } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

// A STATIC segment beats a dynamic sibling: /en/incidents/submit resolves here
// and not through [slug]/page.tsx with slug="submit". Worth knowing, because the
// symptom of getting it wrong is a 404 for a page that plainly exists.
export default async function SubmitIncidentPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const session = await requireCapability(
    locale,
    `/${locale}/incidents/submit`,
    'incident_reporter'
  );

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">File an incident</h1>

      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {session.displayName}. Every submission is created as <code>pending</code> and
        reviewed by an editor before it appears — that is enforced in WordPress, not here.
      </p>

      <p className="mt-6 rounded-md border border-dashed border-border p-4 text-sm">
        The submission form arrives in Module 16, with Zod validation, a shared rate limiter and an
        accessible error pattern. The <strong>guard</strong> you just walked through is finished:
        Lesson 16.2 replaces this shell and leaves it alone.
      </p>

      <p className="mt-6 text-sm">
        <Link href={`/${locale}/account`} className="underline">
          Back to your account
        </Link>
      </p>
    </section>
  );
}
```

**Verify §4:**

- [ ] Signed out, `/en/incidents/submit` 307s to `/en/login?next=/en/incidents/submit`.
- [ ] Signed in as the reporter you verified in Lesson 15.3, the shell renders.
- [ ] `/en/incidents/submit` does **not** render the incident detail page. If it does, a
      `[slug]/page.tsx` is matching first and your folder is in the wrong place.

### Step 5: Declare the Server Action origins

An anchored edit to `next.config.ts` — the file Lesson 09.1 created and Lesson 14.5 also edits.
Add one block; change nothing else.

```ts
// next-app/next.config.ts — add to the existing nextConfig object
  experimental: {
    serverActions: {
      // Next rejects a Server Action POST whose Origin does not match the Host.
      // Behind a proxy, or on a preview deployment, the Host Next sees is not
      // the origin the browser used — so the allowlist has to say so.
      //
      // 127.0.0.1 is here because EVERY Playwright address in this course is
      // 127.0.0.1, never localhost. Omit it and every Server Action in the E2E
      // suite fails with "Invalid Server Actions request", which reads like a
      // test bug and is a configuration bug.
      //
      // Module 24 adds the production and preview origins from the environment.
      allowedOrigins: ['localhost:3000', '127.0.0.1:3000'],
    },
  },
```

**Verify §5:**

- [ ] `grep -c 'allowedOrigins' next.config.ts` is `1`.
- [ ] The dev server restarted. `next.config.ts` is read at boot, not watched.
- [ ] Sign in through the form again. If you now get `Invalid Server Actions request`, the origin
      in your address bar is not in the list — add it rather than removing the block.

### Step 6: Fill in the entry-point verification matrix

`docs/quality-gates.md` is new here; Module 24 extends it with the CI gate table. Fill in every
cell for what exists today, and stub the rows Modules 16 to 21 will complete.

```markdown
<!-- docs/quality-gates.md -->

# Quality gates

## Entry-point verification matrix (Lesson 15.5)

Every route handler and every Server Action in the application, against five independent
questions. **Every cell has a real answer, and "n/a" always carries its reason.**

| Entry point | AuthN | AuthZ | Validation | Rate limit | CSRF |
|---|---|---|---|---|---|
| `GET /api/health` (09.5) | none — deliberately public | n/a: reads nothing user-specific, writes nothing | n/a: takes no input | **none, on purpose** — a monitor must not be throttled | n/a: reads no cookie, so there is nothing to ride |
| `POST /api/auth/refresh` (15.4) | the `btt_rt` cookie IS the credential; WordPress verifies it | n/a: renewing your own session needs no capability | n/a: no request body is read | **none — a real gap.** See below. | `SameSite=Strict` + `Path=/api/auth`: unreachable cross-site |
| `GET /api/auth/refresh` (15.4) | same | same | `?next=` validated as a same-origin path (open-redirect defence) | **none — same gap** | same |
| `login` action (15.4) | this action creates it | n/a | hand-written `field()`; **Zod in 16.1** | in-memory `Map`, **per instance** — Upstash in 16.2 | Origin/Host check + `allowedOrigins` |
| `logout` action (15.4) | n/a: clearing your own cookies needs no proof | n/a | takes no input | none — the worst case is being signed out | Origin/Host + `SameSite=Lax` |
| `register` action (15.3) | app token, server-side only, `hash_equals()` in PHP | holding the app token IS the authorisation | hand-written; **re-validated in PHP** (06.2) | in-memory `Map`, per instance | Origin/Host |
| `verify` action (15.3) | app token | app token, plus the single-use code | hand-written + `absint()` in PHP | none — the single-use code is the limit | Origin/Host |
| `submitIncident` (16.2) | STUB | STUB | STUB | STUB | STUB |
| `submitLead` (16.3) | STUB | STUB | STUB | STUB | STUB |
| `GET /api/preview` (17.2) | STUB | STUB | STUB | STUB | STUB |
| `GET /api/preview/exit` (17.2) | STUB | STUB | STUB | STUB | STUB |
| `POST /api/revalidate` (18.3) | STUB | STUB | STUB | STUB | STUB — cookieless + HMAC, so structurally immune |
| `POST /api/vitals` (21.x) | STUB | STUB | STUB | STUB | STUB |

### Known gaps, named rather than hidden

1. **`/api/auth/refresh` has no rate limit.** A caller with a stolen refresh token can mint access
   tokens as fast as they like, and an attacker with no token can hammer the endpoint. Lesson 16.2
   builds the shared limiter; this row is the reminder to apply it here too.
2. **The rate limiter is in-memory.** A `Map` does not survive a cold start or span instances, and
   `x-forwarded-for` is client-controlled without a trusted proxy. Lesson 15.4 §10 lists all four
   failure modes. Expires in Lesson 16.2.
3. **Validation is hand-written.** `src/actions/auth.ts` has a local `field()` helper. Expires in
   Lesson 16.1, which replaces it with `src/lib/validation/schemas.ts`.
4. **Session lifetime is strict by construction.** `btt_rt` is scoped to `Path=/api/auth`, so
   proxy cannot tell an expired session from no session. Five minutes of complete inactivity
   ends the session. Accepted: it is the price of the narrowest cookie in the app (15.5 §5).

### The rules behind the columns

- **AuthN.** "The cookie is present" is not authentication. WordPress verifies every user token,
  on every call. Next holds no signing key (appendix 04 §5).
- **AuthZ.** "The page is guarded" is not authorization. `guards.ts` is a UX redirect; deleting it
  makes no data reachable that was not reachable before.
- **Validation.** Client-side validation is a user-experience feature. The server control is
  `safeParse` in the action AND independent re-validation in PHP (Lesson 06.2 §3).
- **Rate limit.** Fails **closed**: if the limiter cannot answer, refuse the write.
- **CSRF.** Three layers: Next's Origin/Host check on Server Actions,
  `experimental.serverActions.allowedOrigins`, and `SameSite` on the session cookies. Where an
  endpoint carries real authority, the design removes the ambient credential instead — no cookie,
  HMAC over the body.

(Add your own row: which entry point would you attack first, and which cell is the reason?)
```

**Verify §6:**

- [ ] Thirteen rows, and no empty cell. A blank cell is the question you have not asked.
- [ ] Every `n/a` carries a reason on the same line.
- [ ] You filled in the parenthesis. Naming the weakest cell yourself is the point of the exercise.

### Step 7: The negative-proof sweep

Give this its own step, because these are the assertions the module exists for. Run all six before
you run anything else.

```bash
cd next-app
# `npm run dev` in a second terminal.

# 1. Anonymous, on both guarded routes. The EXACT frozen shape.
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/en/account
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/en/incidents/submit

# 2. Locale normalisation and the gate COMPOSE rather than fight
curl -sL -o /dev/null -w '%{num_redirects} %{url_effective}\n' http://localhost:3000/incidents/submit

# 3. The matcher did not regress
curl -s -o /dev/null -w 'health   %{http_code}\n' http://localhost:3000/api/health
curl -s -o /dev/null -w 'static   %{http_code}\n' http://localhost:3000/_next/static/chunks/nope.js

# 4. The refresh endpoint still refuses an anonymous caller
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/auth/refresh

# 5. THE MODULE'S THESIS IN ONE GREP
grep -rn 'current_user_can' src/

# 6. The configuration half of the CSRF story
grep -c 'allowedOrigins' next.config.ts
```

**Verify §7:**

- [ ] Check 1 prints `307 http://localhost:3000/en/login?next=/en/account` and
      `307 http://localhost:3000/en/login?next=/en/incidents/submit`. **Unescaped.** A
      `%2Fen%2Faccount` means you used `searchParams.set()` somewhere.
- [ ] Check 2 ends on the login page after **two** hops: one for the locale, one for the gate.
- [ ] Check 3 prints `200` and something that is not `307`.
- [ ] Check 5 prints nothing. A capability check in TypeScript is advisory decoration, and there
      is not one in this codebase.

### Step 8: Run the suites, then commit

```bash
npm run verify
npm test -- --run
npx playwright test
```

`npm run dev` must be running for Playwright, and the smoke spec from Lesson 12.3 exercises public
pages only — it does not sign in, so nothing in it should change. If it fails, the most likely
cause is Step 5: `playwright.config.ts` uses `127.0.0.1`, and a missing `allowedOrigins` entry
turns every Server Action into an `Invalid Server Actions request`.

**Verify §8:**

- [ ] All three are green. `npm test` alone is Vitest **watch mode** and never returns.
- [ ] `git add -A && git commit -m "feat(auth): route guards, the proxy gate, the entry-point matrix"`.

---

## Verification

```bash
cd next-app
# `npm run dev` running in a second terminal.

# 1. NEGATIVE — the frozen redirect shape, exactly. Module 16's Starting State
#    asserts this string.
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/en/account
# Expected: 307 http://localhost:3000/en/login?next=/en/account
#           UNESCAPED. A %2Fen%2Faccount means searchParams.set() got in.

# 2. NEGATIVE — the same for the other guarded route
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/en/incidents/submit
# Expected: 307 http://localhost:3000/en/login?next=/en/incidents/submit

# 3. Locale normalisation and the gate COMPOSE: two hops, ending on the login page
curl -sL -o /dev/null -w '%{num_redirects} %{url_effective}\n' http://localhost:3000/incidents/submit
# Expected: 2 http://localhost:3000/en/login?next=/en/incidents/submit
#           Hop one is Lesson 09.5's locale prefix, hop two is this lesson's gate.
#           A 1 means the gate did not fire; a 3 or more means a loop is forming.

# 4. NEGATIVE — /api/health still answers, unprefixed. This is the exact
#    regression Lesson 09.5 §5 warned about.
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/health
# Expected: 200   — a 307 here means `api` fell out of the matcher
curl -s http://localhost:3000/api/health | jq -r 'keys | join(",")'
# Expected: checkedAt,status   — still two keys, still not renamed

# 5. NEGATIVE — static assets are still excluded
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/_next/static/chunks/does-not-exist.js
# Expected: 404 — anything but 307. A 307 is the "blank page, clean logs" failure.

# 6. NEGATIVE — the refresh endpoint refuses an anonymous caller
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/auth/refresh
# Expected: 401

# 7. Now sign in BY HAND. curl cannot POST a Server Action (the action id is
#    build-specific), so get a token from WordPress and play the browser's part.
cd ../wordpress-headless
export BTT_REPORTER_PASSWORD="$(openssl rand -base64 24)"
docker compose run --rm wpcli wp user update reporter --user_pass="$BTT_REPORTER_PASSWORD" >/dev/null
export JWT=$(curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg p "$BTT_REPORTER_PASSWORD" '{
       query: "mutation Login($u:String!,$p:String!){ login(input:{username:$u,password:$p}){ authToken } }",
       variables: { u: "reporter@blamethe.tech", p: $p } }')" | jq -r '.data.login.authToken')
test -n "$JWT" -a "$JWT" != null && echo 'token captured' || echo 'NO TOKEN — check the password'
# Expected: token captured
cd ../next-app

# 8. A logged-in request reaches /en/account and sees the display name
curl -s -b "btt_at=$JWT" http://localhost:3000/en/account | grep -c 'Sam Reporter'
# Expected: 1 or more   — the guard let it through and getSession() asked WordPress
curl -s -o /dev/null -w '%{http_code}\n' -b "btt_at=$JWT" http://localhost:3000/en/account
# Expected: 200

# 9. NEGATIVE — that response must not be cacheable by anything in front of it
curl -si -b "btt_at=$JWT" http://localhost:3000/en/account | grep -i '^cache-control'
# Expected: a Cache-Control containing no-store. Next adds its own directives for a
#           dynamic route; the proxy header is belt and braces on top.

# 10. NEGATIVE — a garbage cookie is NOT a session. Proxy sees a cookie and
#     lets the request through; the GUARD asks WordPress, WordPress says no.
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  -b 'btt_at=not.a.jwt' http://localhost:3000/en/account
# Expected: 307 http://localhost:3000/api/auth/refresh?next=/en/account
#           decodeExpiry() returned null, so secondsUntilExpiry() is 0, so the
#           hand-off fires. With no btt_rt the refresh route then 307s to
#           /en/login. Proxy never judged the token — it cannot.

# 11. NEGATIVE — THE THESIS. Delete the proxy and nothing becomes reachable.
#     A /tmp copy, not `git checkout`: this file is not committed yet.
cp src/proxy.ts /tmp/btt-proxy.ts
rm src/proxy.ts
sleep 3   # let the dev server recompile
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/en/account
# Expected: 307 http://localhost:3000/en/login?next=/en/account
#           SAME ANSWER. The layout guard produced it this time. Proxy saved
#           a render, not a boundary.
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"mutation($i:CreateIncidentInput!){createIncident(input:$i){incident{databaseId}}}",
       "variables":{"i":{"title":"No proxy probe 155","scapegoatSlug":"dns","severitySlug":"s3-minor",
                         "occurredAt":"2024-06-01 09:00:00","downtimeMinutes":1,"environment":"STAGING"}}}' \
  | jq -r '.errors[0].message'
# Expected: You must be signed in to submit an incident.
#           With Next's proxy DELETED, WordPress still refuses. That is the
#           whole module in two commands.
cp /tmp/btt-proxy.ts src/proxy.ts
rm /tmp/btt-proxy.ts
sleep 3
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/health
# Expected: 200   — proxy is back and the matcher still excludes /api

# 12. NEGATIVE — no capability check in TypeScript, anywhere
grep -rn 'current_user_can' src/ ; echo "exit=$?"
# Expected: no output, exit=1
#           The module's thesis in one grep: authorization lives in PHP.

# 13. The CSRF configuration is declared, including the Playwright address
grep -c 'allowedOrigins' next.config.ts
# Expected: 1
grep -c '127.0.0.1:3000' next.config.ts
# Expected: 1   — omit this and every Server Action in the E2E suite fails

# 14. NEGATIVE — cross-origin Server Action POST. There is no reliable
#     copy-pasteable curl for this: a Server Action request carries a
#     build-specific Next-Action id, so a hand-made request is rejected for the
#     wrong reason and proves nothing. Assert the CONFIGURATION here and verify
#     the runtime check in the browser:
#       1. open https://example.com
#       2. in the console: fetch('http://localhost:3000/en/login', { method: 'POST',
#          mode: 'cors', credentials: 'include' })
#       3. the BROWSER blocks it before Next sees it — that is layer two, and the
#          Origin/Host check is layer one behind it.
grep -c 'serverActions' next.config.ts
# Expected: 1

# 15. Route segment config on the guarded pages
grep -c 'force-dynamic' 'src/app/[locale]/account/page.tsx'
# Expected: 1
grep -c 'force-dynamic' 'src/app/[locale]/account/layout.tsx'
# Expected: 1

# 16. NEGATIVE — the guards are server-only and hold no cookie names
grep -c "import 'server-only'" src/lib/auth/guards.ts
# Expected: 1
grep -rn "'btt_at'\|'btt_rt'" src/ | grep -v 'src/lib/auth/jwt.ts'
# Expected: no output — including proxy.ts, which imports the constant

# 17. NEGATIVE — proxy makes no network call and reads no secret
grep -c 'fetch(' src/proxy.ts
# Expected: 0
grep -cE 'GRAPHQL_JWT_AUTH_SECRET_KEY|WP_APP_TOKEN|jose|jsonwebtoken' src/proxy.ts
# Expected: 0

# 18. The matrix exists, is filled in, and names its gaps
grep -c '^| ' ../docs/quality-gates.md
# Expected: 15 or more — thirteen entry points plus the header rows
grep -c 'STUB' ../docs/quality-gates.md
# Expected: 6 or more — the Module 16-21 rows, deliberately
grep -c 'Known gaps' ../docs/quality-gates.md
# Expected: 1
grep -c 'TODO' ../docs/quality-gates.md
# Expected: 0

# 19. Gates stay green
npm run codegen:check
# Expected: no output
npm run verify
# Expected: no output from type-check, lint or format:check
npm test -- --run
# Expected: 0 failures
npx playwright test
# Expected: 0 failures. The Lesson 12.3 smoke spec touches public pages only.

# 20. Clean up
cd ../wordpress-headless
docker compose run --rm wpcli wp post list --post_type=incident \
  --title='No proxy probe 155' --format=count
# Expected: 0 — check 11's probe was refused, so there is nothing to delete
git status --short
# Expected: no .env file listed
```

Checks 11 and 12 are the two that define this lesson, and they should be read together. Check 11
deletes the proxy and gets the same refusal from two different layers. Check 12 shows there is
no capability check in the TypeScript at all. Together they are the proof that Next.js is making
user-experience decisions and WordPress is making authorization decisions — which is the sentence
the whole module hangs on, and now you have run it rather than read it.

## Control Questions

1. A colleague moves the `/account` guard out of `account/layout.tsx` and into `account/page.tsx`,
   "so the guard is next to the thing it guards". Name the failure that becomes possible, say what
   would detect it, and give the one category of entry point a layout guard never covered anyway.
2. `btt_rt` is scoped to `Path=/api/auth`, and Key Concept 5 says proxy therefore cannot
   refresh. Walk through what actually happens on `GET /en/account` when `btt_at` has 40 seconds
   left, name the two things that stop that hand-off looping, and state the user-visible cost the
   design accepts.
3. `config.matcher` is byte-identical to Lesson 09.5's. Explain why `/en/account` already reached
   proxy, then describe precisely what breaks if you add `'/api/auth/:path*'` and, separately,
   what breaks if you remove the `api` exclusion.
4. `requireCapability()` fails **open** when `roles` is empty, while a rate limiter fails
   **closed** when Redis is unreachable. Both are "the check could not get its data". Justify the
   opposite decisions, and name the WPGraphQL behaviour that makes the empty-`roles` case common
   rather than theoretical.
5. Verification check 11 deletes `src/proxy.ts` and the guarded route still redirects, while
   `createIncident` still refuses. Say which of those two facts is a security property and which is
   a convenience, then describe the request shape that would have bypassed a proxy-only gate
   entirely.

## Learn More

- [Next.js — Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) —
  the `matcher` syntax, the runtime limits, and Next's own warning against using it for authorization
- [Next.js — Authentication](https://nextjs.org/docs/app/guides/authentication) — Vercel's own
  guidance, including the "optimistic checks in proxy, secure checks at the data layer" split
  this lesson implements
- [Next.js — `serverActions.allowedOrigins`](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions) —
  the exact value format (host and port, no scheme) that Task Step 5 depends on
- [OWASP — Cross-Site Request Forgery Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) —
  read the "Verifying Origin" and "SameSite" sections next to Key Concept 8's three layers
- [OWASP — Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/) — the
  category "the page is guarded, so the mutation is guarded" falls into, with real examples
- [`wp_verify_nonce()`](https://developer.wordpress.org/reference/functions/wp_verify_nonce/) — read
  it next to Key Concept 9's table; the user-and-action binding is what Next's check does not have
- [MDN — `Cache-Control: private`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control#private) —
  what `private` actually forbids, and why it is not a substitute for `no-store`
- [Next.js — Route segment config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config) —
  `dynamic`, and the paragraph on which APIs already opt a route out of static rendering
- [MDN — 307 Temporary Redirect](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/307) —
  the method-preservation rule that makes 307 the house redirect status, from Lesson 09.5 onward
