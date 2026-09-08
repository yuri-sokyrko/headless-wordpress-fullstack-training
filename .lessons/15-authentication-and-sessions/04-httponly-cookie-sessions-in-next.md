---
title: 'httpOnly Cookie Sessions in Next.js'
module: 15
lesson: 4
teaches: [httponly-cookies, samesite-scoping, token-opacity, refresh-rotation, server-side-session]
produces: ['next-app/src/lib/auth/jwt.ts', 'next-app/src/lib/auth/cookies.ts', 'next-app/src/lib/auth/session.ts', 'next-app/src/actions/auth.ts', 'next-app/src/app/api/auth/refresh/route.ts', 'next-app/src/app/[locale]/(auth)/login/page.tsx']
requires: [10.1, 15.2]
---

# Lesson 15.4 — httpOnly Cookie Sessions in Next.js

## Quick Overview

WordPress hands you two strings. This lesson decides where they live, and that decision is the
whole security posture of the front end. `btt_at` — the 300-second user JWT — goes into an
httpOnly, `Secure`, `SameSite=Lax` cookie scoped to `/`, set by a Server Action with
`cookies().set()`. `btt_rt` — the 30-day refresh token — goes into a cookie that is httpOnly,
`Secure`, **`SameSite=Strict`** and scoped to **`Path=/api/auth`**, so the browser does not
attach it to page loads, block fetches or Server Action posts. It travels on exactly one
endpoint. That is a five-word config change that removes the refresh token from every request
except the one that needs it, and it is the cheapest blast-radius reduction available in the
whole app. The full attribute table is the contract in
[appendix 04 §4](../appendix/04-env-reference.md#session-cookies) — read it, do not memorise it.

Two rules make this lesson short and everything downstream simple. First: **no `localStorage`,
no `sessionStorage`, no token in a URL, query string, hash or `NEXT_PUBLIC_` variable.** Anything
JavaScript can read, an injected script can exfiltrate. Second: **Next.js does not verify the
JWT.** It could — `jose` is three lines — but that would mean Vercel holding
`GRAPHQL_JWT_AUTH_SECRET_KEY`, and a Vercel compromise would then mint valid WordPress
administrator tokens. So Next treats the token as opaque and decodes the payload for one purpose
only: reading `exp` as a cheap "should I refresh?" heuristic. Every real authorization decision
happens in WordPress when the token is presented. There is also deliberately **no session React
context** in this app: the session is read server-side with `cookies()` in the layout, and client
components receive a plain serialisable `{ isLoggedIn, displayName, roles }` prop. The token
never crosses into a client component, so there is no component that *could* leak it.

By the end of this lesson you will have:

- `src/lib/auth/cookies.ts` — one module that owns every cookie name and attribute set, so the
  attributes cannot drift between call sites
- `src/lib/auth/session.ts` — `getSession()` reading `cookies()` in a Server Component, plus
  `decodeExpiry()` that reads `exp` and verifies nothing
- `src/actions/auth.ts` — `login`, `logout` and `register` Server Actions that set and clear
  cookies and redirect
- `/api/auth/refresh` — the only route the `btt_rt` cookie is ever sent to, rotating `btt_at`
- `/en/login` posting to the login action, with a working session visible in the header via a
  serialisable prop and no client-side token anywhere
- A DevTools screenshot habit: `document.cookie` in the console returns nothing useful, and
  `Application → Cookies` shows `HttpOnly` ticked on both session cookies

## Classic WP Analogy

`wp_set_auth_cookie( $user_id, $remember )` is the function this lesson replaces, and it is worth
remembering what it actually does: it sets **two** cookies with different scopes.
`wordpress_logged_in_<hash>` is scoped to `COOKIEPATH` and proves identity site-wide;
`wordpress_sec_<hash>` is scoped to `SITECOOKIEPATH` — `/wp-admin` — and is the one that
authorises administrative requests. Core deliberately narrows where the more powerful credential
is sent. `btt_at` and `btt_rt` are the same pattern with the same reasoning: a broad,
short-lived credential for normal traffic, and a narrow, long-lived one pinned to a single path.

| Classic WordPress | This stack |
|---|---|
| `wp_set_auth_cookie()` | `cookies().set()` in a Server Action (Lesson 15.4) |
| `wordpress_logged_in_*`, `COOKIEPATH` | `btt_at`, `Path=/`, 300 s |
| `wordpress_sec_*`, `SITECOOKIEPATH` | `btt_rt`, `Path=/api/auth`, `SameSite=Strict`, 30 d |
| `AUTH_COOKIE_EXPIRATION` / `auth_cookie_expiration` filter | `Max-Age` in `cookies.ts` |
| `is_user_logged_in()` in `header.php` | `getSession()` in `app/[locale]/layout.tsx` |
| `wp_destroy_current_session()` | cookie deletion — **and that is not the same thing** |

**Where the analogy breaks down, in the one place it really matters:**
`wp_destroy_current_session()` removes the session token from `wp_usermeta`, so the cookie the
attacker copied stops working immediately. Deleting `btt_at` does nothing of the kind. A JWT is a
signed claim; nothing in Next.js can un-issue one. Logout in this app clears the cookies, which
ends the session *for that browser*, and a token already stolen keeps working until its 300
seconds run out. That is precisely why the access token's lifetime is 300 seconds rather than two
weeks — the expiry **is** the revocation mechanism — and why the real emergency brake is rotating
the eight WordPress salts, which invalidates everything at once.

The second break is about where "the session" lives. In a classic theme, `wp_get_current_user()`
is available anywhere because PHP re-runs the whole request. In React the temptation is to hoist
the session into a context provider so components can read it. Do not. Context lives on the
client, a provider's value is serialised into the RSC payload, and a token in that payload is a
token in the page source. Read the session on the server, pass down a boolean and a display name,
and the leak becomes unrepresentable rather than merely unlikely.

---

## Key Concepts

### 1. `cookies()` from `next/headers`: where you may read, and where you may write

One function, several behaviours depending on where you call it. In Next 15 it is **async**, so
every call is `await cookies()`.

| Called from | Read | Write | Notes |
|---|---|---|---|
| Server Action | ✅ | ✅ | the main write path; this is where `login` and `logout` live |
| Route Handler | ✅ | ✅ | `/api/auth/refresh` writes here |
| Server Component / layout / page | ✅ | ❌ | reading is fine and makes the route dynamic |
| Middleware | ❌ | ❌ | uses `request.cookies` and `response.cookies` instead — a different API entirely |
| Client Component | ❌ | ❌ | there is no such API, and `document.cookie` cannot see an `httpOnly` cookie |

The write-from-a-Server-Component error is worth causing once, because the reason is architectural
rather than arbitrary:

```
Error: Cookies can only be modified in a Server Action or Route Handler.
```

A Server Component can be re-rendered and streamed during one navigation; response headers are
sent once and cannot be recalled once streaming has begun. Next forbids the write rather than
letting you discover that a `Set-Cookie` sometimes lands and sometimes does not.

One consequence shapes this whole lesson: **reading `cookies()` in
`src/app/[locale]/layout.tsx` opts every route into dynamic rendering.** Task Step 6 does exactly
that, and Key Concept 8 argues why the alternative is worse. The cost, stated plainly: no route
below that layout can be prerendered to static HTML. Data caching survives — `fetchGraphQL`'s
`revalidate` and `tags` still mean WordPress is queried once per window — but the HTML is
assembled per request. Module 18 is where that bill arrives.

### 2. The attribute set, argued attribute by attribute

**[Appendix 04 §4](../appendix/04-env-reference.md#session-cookies) is the contract. Read the
attribute table there — it is not reproduced here.** What follows is the argument for each line,
which is the part the appendix does not carry.

**`httpOnly` on both.** `document.cookie` cannot see the cookie, so an injected script cannot read
it. This is the single most important attribute in `cookies.ts`, and it is why `localStorage` is
not merely discouraged but unnecessary.

**`SameSite` differs between the two, and `Path` differs too.** Key Concepts 3 and 4: two
different answers to two different questions, and the narrowest useful scope for each.

**`Max-Age` rather than `Expires`.** `Expires` is an absolute date, evaluated against the
*client's* clock. A user whose laptop clock is two hours slow gets a session that has already
expired, or one that lives two hours too long, and you will never reproduce it. `Max-Age` is a
duration the browser measures itself.

**`Domain` deliberately unset.** That produces a **host-only** cookie, sent to
`app.example.com` and nothing else. `Domain=.example.com` would send both session cookies to every
subdomain — `blog.`, `staging.`, a marketing page someone spins up on `promo.` — so one XSS on any
of those becomes a session compromise on the app. **Never widen a cookie's domain to make
something convenient work.**

> **`Secure` is derived from `NODE_ENV`, and that is a compromise you should understand rather
> than copy.** In production both cookies are `Secure`, which is what appendix 04 §4 requires. In
> development they are not, and the reason is `curl`: modern browsers make an exception for
> `http://localhost` and will store and send a `Secure` cookie there, but `curl`'s cookie engine
> honours the flag strictly and will not send a `Secure` cookie over `http://`. Half of this
> lesson's Verification block is `curl` against `http://localhost:3000`. So the flag is
> conditional, the production value matches the contract exactly, and the one line that decides it
> lives in `cookies.ts` where it can be read in three seconds.

### 3. `Path=/api/auth` plus `SameSite=Strict` on `btt_rt`

The cheapest blast-radius reduction in the whole application: two attributes, no code, and the
refresh token disappears from almost every request the browser makes.

```
   btt_rt WITH Path=/                        btt_rt WITH Path=/api/auth
   ─────────────────────────────────         ─────────────────────────────────
   GET /en                      ✓ sent      GET /en                      ✗
   GET /en/incidents/incident-01 ✓ sent      GET /en/incidents/…          ✗
   RSC payload fetch             ✓ sent      RSC payload fetch            ✗
   POST a Server Action          ✓ sent      POST a Server Action         ✗
   GET /_next/image?url=…        ✓ sent      GET /_next/image?url=…       ✗
   GET /api/health               ✓ sent      GET /api/health              ✗
   POST /api/auth/refresh        ✓ sent      POST /api/auth/refresh       ✓ sent
                                              └── one path, and it is the one
                                                  that needs it
```

Every `✗` is a request that no longer carries a 30-day credential. The token is absent from your
own access logs for page views, from any CDN or proxy log in front of the app, from the request
headers an error tracker captures on a page render, and from anything a future browser `fetch`
might accidentally forward. None of those is exotic; all are places credentials end up.

`SameSite=Strict` answers a different question. The browser attaches the cookie to **no** request
initiated from another site — not a form post, not a link click, not an image, not a `fetch`. For
a refresh endpoint that is exactly right: there is no legitimate cross-site reason to refresh
someone else's session.

> **The trap that comes with a narrow `Path`, and it is a good one.** `cookies().delete('btt_rt')`
> writes a deletion with `Path=/`, and the browser treats a cookie's identity as **name plus path
> plus domain**. So the deletion misses, the `Path=/api/auth` cookie survives, and you have a
> logout that does not log out. `clearSessionCookies()` therefore deletes each cookie with the
> **same attributes it was set with**. This is the most commonly shipped bug in path-scoped
> cookies and it is invisible in code review.

### 4. `SameSite=Lax` on `btt_at`, and why not `Strict`

The instinct is that `Strict` is the safer choice everywhere, so `Lax` needs a defence.

`SameSite=Strict` means the cookie is withheld on **top-level cross-site navigations**. Concretely:

```
   Editor emails a colleague:  "look at this — http://localhost:3000/en/account"
                                                        │
                                      colleague clicks from their mail client
                                                        ▼
   btt_at SameSite=Strict  →  cookie NOT sent  →  guard redirects to /login
                                                   ...even though they are logged in
   btt_at SameSite=Lax     →  cookie sent on the GET  →  page renders
```

A `Strict` session cookie makes every inbound link from an email, a chat client or a search result
land the user logged out. They log in, the next click works, and the bug reads as "the site
randomly logs me out" — nearly impossible to report.

`Lax` is the right trade because of what it still refuses. It sends the cookie on a top-level
cross-site `GET` navigation — the case `Strict` breaks — and withholds it from a cross-site `POST`
(including a form on an attacker's page), from a cross-site `fetch` or XHR, and from a cross-site
iframe, image or script.

So `Lax` withholds the cookie from every request shape a CSRF attack actually uses, and sends it
for the one shape that is just a person clicking a link. That is why it is the browser default,
and why the course pairs it with Next's Origin check rather than reaching for `Strict` (Lesson
15.5 §8).

The rule generalises: **`Strict` for a credential that only ever travels on requests your own app
initiates; `Lax` for a credential that has to survive a link.**

### 5. Token opacity: Next *could* verify, and deliberately does not

`jose` is well maintained and verifying a HS256 token with it is about three lines. This
application does not, and the reason is neither laziness nor bundle size.

```ts
// (illustration — the three lines this course deliberately does NOT write)
import { jwtVerify } from 'jose';
const secret = new TextEncoder().encode(process.env.GRAPHQL_JWT_AUTH_SECRET_KEY);
const { payload } = await jwtVerify(token, secret);
```

Read line two. To verify locally, **Vercel would have to hold WordPress's signing key** — and a
signing key is not a read credential, it is a *minting* credential. Anyone holding it can produce
a valid token for `data.user.id = 1`.

| | Next verifies locally | Next treats the token as opaque |
|---|---|---|
| Where the signing key lives | WordPress **and** Vercel | WordPress only |
| A Vercel compromise yields | the ability to **mint** administrator tokens | the sessions currently in flight |
| Cost per session check | zero network calls | one WordPress round trip |

The middle row settles it, and it is
[appendix 04 §5](../appendix/04-env-reference.md#5-why-graphql_jwt_auth_secret_key-must-differ-from-auth_key)'s
argument in one line. The third row is the honest cost: `getSession()` costs a WordPress request,
which is why Task Step 2 memoizes it per render pass with React's `cache()` and why Lesson 15.5's
guard lives on a layout rather than on every component that wants a display name.

There is a subtler benefit too. With one verifier there is no version of "Next thinks the token is
fine and WordPress disagrees" — every authorization answer comes from the party that owns the
data, every time.

### 6. `decodeExpiry()` reads `exp` and makes no claim about anything

Next does not verify. It decodes, for one purpose: deciding whether it is worth asking for a new
token. That function needs a name that makes its limits obvious.

```
   decodeExpiry(jwt)
        │
        ├── split on '.', take segment 2
        ├── base64url → JSON
        ├── read `exp`
        └── return a number, or null

   WHAT IT DOES NOT DO
        ✗ verify the signature        ✗ check `nbf`
        ✗ check the issuer            ✗ look at `data.user.id`
        ✗ tell you the user is real   ✗ authorise ANYTHING
```

It returns `number | null` and never throws, so a malformed token is `null` and every caller has
to treat that as "assume expired". It makes no authorization claim, so nothing it returns can
deny or grant access. And it is named for what it **reads** rather than for what you wish it
meant: `isValidToken()` would be a lie, and somebody would eventually trust it.

An attacker can hand you a token with `exp` a year in the future. `decodeExpiry()` will cheerfully
report that. Nothing bad happens, because the only consequence is that this application **skips a
refresh it did not need** and then presents the token to WordPress, which rejects it. Trace that
through: the worst outcome of lying to `decodeExpiry()` is one wasted request. That is what makes
it safe to write by hand rather than pulling in a library.

> **`decodeExpiry()` and the two cookie names live in `src/lib/auth/jwt.ts`, which does NOT carry
> `import 'server-only'`.** That is not an oversight. `src/middleware.ts` runs in a restricted
> runtime that is not a React Server Component context, and the `server-only` package throws
> outside the `react-server` condition — the same reasoning that keeps the guard off
> `src/lib/graphql/tags.ts` and `errors.ts`. So the auth library is split in two: `jwt.ts` is pure,
> runtime-agnostic and importable from middleware; `cookies.ts` and `session.ts` touch credentials,
> carry the guard, and re-export what the frozen surface promises. Lesson 15.5's middleware imports
> from `jwt.ts` and the invariant "one module owns the cookie names" holds.

### 7. Refresh rotation: the sequence, the race, and the part this design does not do

```
  t=0     login                      Set-Cookie btt_at (300s), btt_rt (30d, Path=/api/auth)
  t=290   middleware sees exp is 10s away on a guarded route          (Lesson 15.5)
          └─▶ 307 /api/auth/refresh?next=/en/account
  t=290   GET /api/auth/refresh      the ONLY path the browser sends btt_rt to
          └─▶ mutation refreshJwtAuthToken { jwtRefreshToken }
          ◀─▶ { authToken }          a FRESH 300s token. No new refresh token.
          └─▶ Set-Cookie btt_at, then 307 to /en/account
  t=290   GET /en/account            renders, with 300 seconds of headroom
```

Two honest notes, and both are costs rather than features.

**A concurrent double refresh is harmless here, and it is worth knowing why.** Two tabs both near
expiry both call `/api/auth/refresh`. WordPress issues two independent access tokens; both are
valid; the browser keeps whichever `Set-Cookie` arrived last. Nothing is invalidated by the
second call because **the refresh token is not consumed**. If this implementation *did* rotate
refresh tokens, that same race would be a bug: one tab would present a refresh token the other had
already spent, get a refusal, and log the user out.

**This implementation does not rotate the refresh token, and that is a real weakness.**
`refreshJwtAuthToken` returns `authToken` and nothing else (Lesson 15.2 §1), so a stolen `btt_rt`
remains usable for its whole lifetime.

Without rotation a stolen refresh token is usable for up to 30 days and the theft is
undetectable. With rotation it would be usable until the legitimate client refreshed once, and a
reused old token would be a signal — but it would require a per-user refresh-token generation
stored in `wp_usermeta` and compared on every refresh, which is exactly the server-side session
state Lesson 15.1 §3 said statelessness had bought us. The course does not build it, states the
cost, and points at the mitigation it *does* have: `Path=/api/auth` plus `SameSite=Strict` mean
the token is almost never transmitted in the first place.

### 8. No session context, ever

The React instinct is to hoist the session into a provider so any component can read it. Do not.

```
  ❌  <SessionProvider value={{ token, user }}>          ✅  layout reads getSession() on the server
        <Header />                                             │
      </SessionProvider>                                       └─▶ <Header session={{ isLoggedIn, displayName, roles }} />

      A provider is a CLIENT component. Its `value`             A plain object. Serialised into the RSC
      is serialised into the RSC payload, which is              payload too — and there is nothing in it
      in the page source. `token` is now published.             worth stealing.
```

The mechanism matters more than the rule: **anything you pass into a Client Component is
serialised into the RSC flight payload, and that payload is fetchable.** It is not "in memory on
the client"; it is in the bytes the browser downloaded. The question is never "will a component
leak this?" but "is this in the payload at all?".

That is why the session prop is exactly three fields. `isLoggedIn` is one bit the user already
knows, and it chooses between "Sign in" and a logout form. `displayName` is a string WordPress
already publishes on every post, and it renders "Sam Reporter" in the header. `roles` names a role
without granting one, and it is **display only**.

**`roles` is present for display and never for decisions.** Two independent reasons. First, the
module's thesis: authorization lives in PHP, and a role check in TypeScript is advisory
decoration. Second, a practical one from Lesson 15.2 §1: WPGraphQL gates `User.roles` behind
`list_users`, so a reporter asking for its own roles may get an **empty array**. A guard that
denied on an empty `roles` would lock out exactly the users it was written for. Lesson 15.5's
`requireCapability()` is built around that fact and fails **open** on purpose.

And the token itself never appears in the prop, in the payload, or in any component. There is no
component that *could* leak it, which is a stronger property than a component that is careful.

### 9. Logout's honesty

```ts
// (illustration of what logout actually is)
await clearSessionCookies();
redirect('/');
```

That is the whole function, and the interesting part is what it cannot do. It deletes both cookies
**with their original paths**, ends the session for **this browser**, and returns the user to a
public page. It does not invalidate the JWT, does not end the session for a copy of `btt_at` taken
earlier, and does not tell WordPress anything at all.

A token already stolen keeps working until `exp`. There is no revocation list in WPGraphQL JWT
Authentication (Lesson 15.2 §9), and nothing in Next.js can un-issue a signed claim. This is not
a gap in the implementation; it is the property of the credential.

**Which is precisely why `btt_at` lives 300 seconds.** A JWT cannot be revoked → logout cannot
revoke it → the expiry *is* the revocation window → the window should be as short as a user will
tolerate → five minutes, with a refresh token to make it invisible. Every step is forced by the
one before it. The emergency brake, when 300 seconds is not enough, is `docs/runbook.md` from
Lesson 15.2: rotate `GRAPHQL_JWT_AUTH_SECRET_KEY` and every token stops verifying at once.

### 10. The in-memory rate limiter is a debt with an expiry date

The Module 15 README's login-flow diagram shows the `login` action rate-limiting and failing
closed, and it is right to — but `src/lib/rate-limit.ts` and `@upstash/ratelimit` are **Lesson
16.2's**. So this lesson ships a `Map` inside `src/actions/auth.ts`, labelled with the lesson that
deletes it, exactly the way Module 08 dated its debts.

State the failure modes before writing it, because a stopgap you have not characterised is a
stopgap somebody will trust:

| Failure mode | Consequence |
|---|---|
| **A `Map` does not survive a cold start** | on Vercel, a new lambda instance starts with an empty limiter, so the attacker's budget resets |
| **A `Map` does not span instances** | with four instances, the effective limit is four times what you configured |
| **`x-forwarded-for` is client-controlled** without a trusted proxy rewriting it | an attacker sends a different value per request and is never limited at all |
| **The `Map` grows without bound** | one entry per distinct IP string, never evicted. A memory leak with an attacker-controlled growth rate. |
| Locally, `x-forwarded-for` is usually absent | every request shares one `'unknown'` bucket, so the limit is global in development. Honest, and it makes the limiter easy to test. |

Lesson 16.2's replacement is Upstash Redis: shared across instances, surviving cold starts,
evicting by TTL, failing **closed** when the store is unreachable, and used by every Server Action
rather than by `login` and `register` only.

So what is this one worth? It stops a naive script from ten thousand login attempts in a minute
against a single-instance dev server, and — more importantly — it puts the **step** in the right
place, so Lesson 16.2's change is one import and a deletion rather than a redesign. That is the
honest value of a stopgap: it fixes the *shape* now and the *substance* later. Lesson 15.5's
matrix records it as `in-memory, per instance`, not as "yes".

---

## Task

Eight steps: five new files, two anchored edits to files earlier lessons own, and one browser
walkthrough that is not optional — DevTools is the only place you see `httpOnly` doing its job.

### Step 1: Write the runtime-agnostic half, then the cookie module

Two files, and the split between them is the point. `jwt.ts` is pure: two string constants and one
decoder, no `next/headers`, no credentials, **no `import 'server-only'`** — because Lesson 15.5's
middleware has to import it and the middleware runtime is not a React Server Component context.

```bash
cd next-app
mkdir -p src/lib/auth src/app/api/auth/refresh
```

```ts
// next-app/src/lib/auth/jwt.ts
// The runtime-agnostic half of the auth library. Importable from a Server
// Component, a Server Action, a Route Handler, src/middleware.ts and a Vitest
// test in plain Node.
//
// DELIBERATELY NO `import 'server-only'`: the package throws outside the
// react-server condition, and src/middleware.ts is not a react-server context.
// Same reasoning as src/lib/graphql/tags.ts and errors.ts (Lesson 10.3).
// Nothing in this file touches a credential store, so there is nothing to guard.

/** The user JWT. Appendix 04 §4. Re-exported by cookies.ts. */
export const AT_COOKIE = 'btt_at';

/** The refresh token, scoped to Path=/api/auth. Appendix 04 §4. */
export const RT_COOKIE = 'btt_rt';

/**
 * Read the `exp` claim. VERIFIES NOTHING.
 *
 * Not the signature, not `nbf`, not the issuer, not `data.user.id`. It answers
 * exactly one question — "is it worth asking for a new token?" — and it is
 * named for what it reads so that nobody is tempted to trust it with more.
 *
 * A forged `exp` in the far future costs this application ONE wasted request:
 * it skips a refresh it did not need, presents the token to WordPress, and
 * WordPress rejects it. That bounded worst case is why hand-writing this is
 * safe and why `jose` is not a dependency (Lesson 15.4 §5).
 *
 * @returns Unix seconds, or `null` for anything malformed. Never throws.
 */
export function decodeExpiry(jwt: string): number | null {
  const segments = jwt.split('.');

  if (segments.length !== 3) {
    return null;
  }

  const payload = segments[1];

  // noUncheckedIndexedAccess from Lesson 07.3 is why this check is not optional.
  if (payload === undefined || payload === '') {
    return null;
  }

  try {
    // base64url → base64: swap the alphabet, then restore the '=' padding.
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (base64.length % 4)) % 4;
    const claims: unknown = JSON.parse(atob(base64 + '='.repeat(padding)));

    if (typeof claims !== 'object' || claims === null) {
      return null;
    }

    const exp = (claims as { readonly exp?: unknown }).exp;

    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
  } catch {
    // Malformed base64, malformed JSON, a payload that is not an object.
    // "Assume expired" is the only safe interpretation and every caller
    // treats null that way.
    return null;
  }
}

/** Seconds until `exp`, or `0` for a token that is unreadable or already dead. */
export function secondsUntilExpiry(jwt: string, now: number = Date.now()): number {
  const exp = decodeExpiry(jwt);

  if (exp === null) {
    return 0;
  }

  return Math.max(0, exp - Math.floor(now / 1000));
}
```

Now the module that owns every cookie attribute in the application. Nothing else in `next-app`
calls `cookies().set()` for a session cookie, ever.

```ts
// next-app/src/lib/auth/cookies.ts
// The ONE module that names a session cookie's attributes. Every other file
// calls into it, so the attributes cannot drift between call sites.
//
// The contract is appendix 04 §4. It is not restated here — one home per
// contract — but every attribute below is argued in Lesson 15.4 §2.
import 'server-only';

import { cookies } from 'next/headers';

import { AT_COOKIE, RT_COOKIE } from './jwt';

// Re-exported so the frozen surface `@/lib/auth/cookies` promises holds, while
// the literals themselves live in the runtime-agnostic half (Lesson 15.4 §6).
export { AT_COOKIE, RT_COOKIE };

/** 300 s. The expiry IS the revocation window — Lesson 15.1 §3. */
const AT_MAX_AGE = 300;

/** 30 days. The BROWSER's limit; WordPress's own refresh expiry is longer (15.2 §2). */
const RT_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * `Secure` in production, which is what appendix 04 §4 requires. Not in
 * development, because curl's cookie engine honours the flag strictly and will
 * not send a Secure cookie over http://localhost — and half of this lesson's
 * Verification block is curl. Browsers are more forgiving; curl is the honest
 * arbiter. One line, one place to read it.
 */
const SECURE = process.env.NODE_ENV === 'production';

/** Broad and short-lived. `Lax` so a link from an email does not land logged out (§4). */
const AT_ATTRS = {
  httpOnly: true,
  secure: SECURE,
  sameSite: 'lax',
  path: '/',
  maxAge: AT_MAX_AGE,
} as const;

/** Narrow and long-lived. One path, `Strict`, and absent from every other request (§3). */
const RT_ATTRS = {
  httpOnly: true,
  secure: SECURE,
  sameSite: 'strict',
  path: '/api/auth',
  maxAge: RT_MAX_AGE,
} as const;

/** Called by `login` after WordPress issues the pair. */
export async function setSessionCookies(authToken: string, refreshToken: string): Promise<void> {
  const jar = await cookies();

  jar.set(AT_COOKIE, authToken, AT_ATTRS);
  jar.set(RT_COOKIE, refreshToken, RT_ATTRS);
}

/** Called by /api/auth/refresh. The refresh token is NOT reissued — §7. */
export async function setAccessCookie(authToken: string): Promise<void> {
  (await cookies()).set(AT_COOKIE, authToken, AT_ATTRS);
}

/**
 * Delete both cookies WITH THE ATTRIBUTES THEY WERE SET WITH.
 *
 * A cookie's identity is name + path + domain. `cookies().delete(RT_COOKIE)`
 * writes a deletion for Path=/ , which does not match the Path=/api/auth cookie
 * the browser is holding — so the refresh token survives and you have a logout
 * that does not log out. This is the most commonly shipped bug in path-scoped
 * cookies and it is invisible in review. Lesson 15.4 §3.
 */
export async function clearSessionCookies(): Promise<void> {
  const jar = await cookies();

  jar.set(AT_COOKIE, '', { ...AT_ATTRS, maxAge: 0 });
  jar.set(RT_COOKIE, '', { ...RT_ATTRS, maxAge: 0 });
}

/** `null` when the cookie is absent or empty. Callers treat both the same way. */
export async function readAccessToken(): Promise<string | null> {
  const value = (await cookies()).get(AT_COOKIE)?.value;

  return value === undefined || value === '' ? null : value;
}

/** Only ever non-null inside /api/auth/*, because of the cookie's Path. */
export async function readRefreshToken(): Promise<string | null> {
  const value = (await cookies()).get(RT_COOKIE)?.value;

  return value === undefined || value === '' ? null : value;
}
```

**Verify §1:**

- [ ] `grep -c 'httpOnly: true' src/lib/auth/cookies.ts` is `2` **today** — Lesson 17.2 adds
      `btt_preview_jwt` and makes it `3`, and noticing that is what this grep is for. One per
      attribute set, which is
      what makes that grep meaningful.
- [ ] `grep -c "import 'server-only'" src/lib/auth/jwt.ts` is `0`; on `cookies.ts` it is `1`.
- [ ] `grep -rn "'btt_at'\|'btt_rt'" src/` names **only** `src/lib/auth/jwt.ts`, and
      `clearSessionCookies()` passes the full attribute set to both deletions.

### Step 2: Write `session.ts`

`getSession()` is the only function in the application that answers "who is this?", and it answers
it by asking WordPress.

```ts
// next-app/src/lib/auth/session.ts
// Reads the access cookie, presents it to WordPress, and returns a plain
// serialisable object. There is NO session React context anywhere in this app
// (Lesson 15.4 §8) — client components receive this shape as a prop.
import 'server-only';

import { cache } from 'react';

import { ViewerDocument } from '@/gql/graphql';
import { fetchGraphQLAuthed } from '@/lib/graphql/client';

import { readAccessToken } from './cookies';
import { decodeExpiry } from './jwt';

// Re-exported so `@/lib/auth/session` exposes the surface Lesson 15.5's
// middleware and Module 16 were promised. The implementation is in jwt.ts,
// which has no server-only guard and is therefore importable from middleware.
export { decodeExpiry };

/**
 * A discriminated union, so `session.displayName` does not type-check until
 * `session.isLoggedIn` has been narrowed. The logged-out member carries NO
 * fields at all — there is no `displayName: ''` to render by accident.
 */
export type Session =
  | { readonly isLoggedIn: true; readonly displayName: string; readonly roles: readonly string[] }
  | { readonly isLoggedIn: false };

const ANONYMOUS: Session = { isLoggedIn: false };

/**
 * Memoized per request pass with React's cache().
 *
 * Request memoization (Lesson 10.3) applies to `fetch`, and GraphQL calls are
 * POSTs, so Next does NOT dedupe them for us. Without this, the layout, the
 * guard and the account page would each cost a WordPress round trip on the same
 * render. cache() keys on the argument, so a token change is a new entry.
 */
const loadViewer = cache(async (jwt: string) =>
  fetchGraphQLAuthed(ViewerDocument, {}, { kind: 'user', jwt })
);

/**
 * Who is this request from?
 *
 * Every branch that is not a confirmed WordPress `viewer` returns ANONYMOUS.
 * A missing cookie, an expired token, a malformed token, a revoked user and an
 * unreachable WordPress all produce the same answer, and that is correct: the
 * only safe interpretation of "I could not confirm who you are" is "nobody".
 */
export async function getSession(): Promise<Session> {
  const token = await readAccessToken();

  if (token === null) {
    return ANONYMOUS;
  }

  try {
    const data = await loadViewer(token);
    const viewer = data.viewer;

    if (viewer === null || viewer === undefined) {
      // WordPress verified the signature and the expiry and said "nobody".
      // That null IS the authentication check (Lesson 15.2 §1).
      return ANONYMOUS;
    }

    // WPGraphQL gates User.roles behind list_users, so a reporter asking for
    // its OWN roles can legitimately get an empty connection. Display data.
    // Nothing in this app branches on it — Lesson 15.4 §8.
    const roles = (viewer.roles?.nodes ?? [])
      .map((node) => node?.name)
      .filter((name): name is string => typeof name === 'string' && name !== '');

    return {
      isLoggedIn: true,
      displayName: viewer.name ?? 'Signed in',
      roles,
    };
  } catch (error) {
    // fetchGraphQLAuthed throws on a transport failure and on a GraphQL
    // `errors` array — which is what an expired token produces. Detail to the
    // log, nothing to the caller: the policy Lesson 10.4 wrote into
    // docs/api-contract.md.
    console.error('[btt] getSession: could not confirm the session', error);

    return ANONYMOUS;
  }
}
```

**Verify §2:**

- [ ] `grep -c 'jose\|jsonwebtoken' src/lib/auth/session.ts` is `0`. Next does not verify, and it
      could not: `grep -c 'GRAPHQL_JWT_AUTH_SECRET_KEY' .env.local` is `0`.
- [ ] `getSession()` has exactly one `return { isLoggedIn: true` and three paths to `ANONYMOUS`:
      no cookie, `viewer` null, a thrown error.
- [ ] `loadViewer` is wrapped in `cache()`. Remove the wrapper and watch the WordPress log grow by
      one `Viewer` query per component that asks.

### Step 3: Extend `src/actions/auth.ts` with `login`, `logout` and the limiter

Three anchored edits to the file Lesson 15.3 created. First the imports, at the top, alongside the
existing ones:

```ts
// next-app/src/actions/auth.ts — add to the imports
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { LoginDocument } from '@/gql/graphql';
import { clearSessionCookies, setSessionCookies } from '@/lib/auth/cookies';
import { fetchGraphQL } from '@/lib/graphql/client';
```

Then the limiter and the redirect guard, above the actions:

```ts
// next-app/src/actions/auth.ts — insert above `register`
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DATED DEBT — DELETED in Lesson 16.2, replaced by src/lib/rate-limit.ts
 * (Upstash Redis, shared by every Server Action, failing closed).
 *
 * A Map in a serverless function does not survive a cold start and does not
 * span instances, so the real limit is (this number) × (instances) and it
 * resets whenever the platform starts a new one. `x-forwarded-for` is
 * client-controlled unless a trusted proxy rewrites it, so a determined
 * attacker rotates the header and is never limited at all. And this Map grows
 * without bound: one entry per distinct IP string, never evicted.
 *
 * What it IS worth: the rate-limit STEP is now the first thing every action
 * does, so Lesson 16.2 is an import swap rather than a redesign. Lesson 15.5's
 * entry-point matrix records it as "in-memory, per instance", not as "yes".
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ATTEMPTS = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

async function clientIp(): Promise<string> {
  const forwarded = (await headers()).get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();

  // Locally this header is usually absent, so every request shares the
  // 'unknown' bucket and the limit is effectively global in development. That
  // is honest, and it makes the limiter trivial to exercise by hand.
  return first === undefined || first === '' ? 'unknown' : first;
}

function allowAttempt(key: string): boolean {
  const now = Date.now();
  const entry = ATTEMPTS.get(key);

  if (entry === undefined || entry.resetAt <= now) {
    ATTEMPTS.set(key, { count: 1, resetAt: now + WINDOW_MS });

    return true;
  }

  if (entry.count >= MAX_ATTEMPTS) {
    return false;
  }

  entry.count += 1;

  return true;
}

const TOO_MANY = 'Too many attempts. Wait a minute and try again.';

/** One message for a wrong password AND an unknown account. Lesson 15.3 §1. */
const INVALID_CREDENTIALS = 'That email and password combination was not recognised.';

/**
 * OPEN REDIRECT DEFENCE.
 *
 * `?next=` arrives from the query string, so it is attacker-chosen. Only a
 * same-origin absolute path is accepted. The second character may not be `/`
 * or `\`: browsers treat `//evil.test` and `/\evil.test` as absolute URLs with
 * a host, and a redirect to either one is a phishing primitive with your domain
 * in the address bar of the page that sent the user there.
 */
function safeNextPath(raw: FormDataEntryValue | null, fallback: string): string {
  if (typeof raw !== 'string' || !/^\/(?![/\\])[\w\-./?=&%]*$/.test(raw)) {
    return fallback;
  }

  return raw;
}

/** One locale today. Module 20 replaces this with the real list. */
function safeLocale(raw: FormDataEntryValue | null): string {
  return raw === 'en' ? 'en' : 'en';
}
```

Now the two new actions, appended:

```ts
// next-app/src/actions/auth.ts — append
/**
 * Trade an email and a password for a cookie pair.
 *
 * `fetchGraphQL`, not `fetchGraphQLAuthed`: there is no credential to present.
 * This is the call that CREATES one. The password travels in the mutation
 * variables over the server-to-server connection and is never stored, logged or
 * echoed. No `options` argument, so no `revalidate` and no `tags` — and Next
 * 15's fetch default is `cache: 'no-store'`, so nothing is cached.
 */
export async function login(
  _previous: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  // ── 1. RATE LIMIT, first, before any work ──────────────────────────
  if (!allowAttempt(`login:${await clientIp()}`)) {
    return { status: 'error', message: TOO_MANY, fieldErrors: {} };
  }

  // ── 2. VALIDATE ────────────────────────────────────────────────────
  const locale = safeLocale(formData.get('locale'));
  const nextPath = safeNextPath(formData.get('next'), `/${locale}`);

  const fields = {
    email: field(formData, 'email', { label: 'Email', min: 5, max: 190, email: true }),
    // min: 1, not 12. This is a LOGIN: an old account may have a short password
    // and refusing to even try would lock out a user WordPress would accept.
    // Password policy belongs where the password is set, not where it is used.
    password: field(formData, 'password', {
      label: 'Password',
      min: 1,
      max: 200,
      keepWhitespace: true,
    }),
  };

  const fieldErrors = errorsOf(fields);

  if (Object.keys(fieldErrors).length > 0) {
    return { status: 'error', message: 'Check the fields below.', fieldErrors };
  }

  // ── 3. ASK WORDPRESS ───────────────────────────────────────────────
  let authToken: string;
  let refreshToken: string;

  try {
    // `username` carries an EMAIL. wp_authenticate_email_password resolves it,
    // and registerDeveloper never tells the user their generated login, so an
    // email is the only identifier a public developer has (Lesson 15.2 Step 5).
    const data = await fetchGraphQL(LoginDocument, {
      username: fields.email.value,
      password: fields.password.value,
    });

    const payload = data.login;

    if (
      payload?.authToken === null ||
      payload?.authToken === undefined ||
      payload.refreshToken === null ||
      payload.refreshToken === undefined
    ) {
      return { status: 'error', message: INVALID_CREDENTIALS, fieldErrors: {} };
    }

    authToken = payload.authToken;
    refreshToken = payload.refreshToken;
  } catch (error) {
    // WordPress returns HTTP 200 with an `errors` array for a bad password, and
    // the client turns that into a throw. One message covers a wrong password,
    // an unknown account and WordPress being unreachable — the first two must
    // be indistinguishable, and the third is not worth a separate oracle.
    console.error('[btt] login failed', error);

    return { status: 'error', message: INVALID_CREDENTIALS, fieldErrors: {} };
  }

  // ── 4. SET THE COOKIES ─────────────────────────────────────────────
  await setSessionCookies(authToken, refreshToken);

  // ── 5. REDIRECT ────────────────────────────────────────────────────
  // OUTSIDE the try/catch, and this is not a style choice: redirect() works by
  // THROWING a NEXT_REDIRECT error. Call it inside the block above and the
  // catch swallows it, the user stays on the login page, and the cookies are
  // set — a bug that looks like "login does nothing" while login worked.
  redirect(nextPath);
}

/**
 * End the session for THIS browser.
 *
 * Honest about its limits: a copy of `btt_at` taken earlier keeps working until
 * `exp`. There is no revocation list in WPGraphQL JWT Authentication and
 * nothing in Next can un-issue a signed claim (Lesson 15.4 §9). That is exactly
 * why the access token lives 300 seconds.
 *
 * Takes no arguments. `<form action={logout}>` passes a FormData that this
 * function does not want, and a zero-parameter function is assignable to the
 * form's one-parameter action type.
 */
export async function logout(): Promise<void> {
  await clearSessionCookies();

  // '/' rather than '/en': Lesson 09.5's middleware normalises the locale
  // prefix, so the two gates compose instead of duplicating the locale list.
  redirect('/');
}
```

Finally, add the limiter to `register`, which is just as abusable as `login` — one line, at the
very top of the function:

```ts
// next-app/src/actions/auth.ts — first statement inside `register`
  if (!allowAttempt(`register:${await clientIp()}`)) {
    return { status: 'error', message: TOO_MANY, fieldErrors: {} };
  }
```

**Verify §3:**

- [ ] `redirect(nextPath)` is **outside** the `try` block. Move it inside and the catch swallows
      `NEXT_REDIRECT`, which is the single most common Server Action bug in the ecosystem.
- [ ] `login` and `register` both call `allowAttempt()` as their first statement. `verify` does
      not, on purpose: its rate limit is the single-use code itself.
- [ ] `grep -c 'INVALID_CREDENTIALS' src/actions/auth.ts` is `3` — the constant and its two uses.
      One message, two failure modes, no enumeration oracle. And `safeNextPath` rejects
      `//evil.test`: the `(?![/\\])` is the whole defence.

### Step 4: Write `/api/auth/refresh`

The only endpoint the browser ever sends `btt_rt` to, by construction.

```ts
// next-app/src/app/api/auth/refresh/route.ts
// The ONLY path the browser sends btt_rt to, because of the cookie's
// Path=/api/auth. That has a consequence Lesson 15.5 leans on: middleware
// running on /en/account never sees the refresh token and therefore CANNOT
// refresh. This route is the only place in the application that can.
import { NextResponse, type NextRequest } from 'next/server';

import { RefreshTokenDocument } from '@/gql/graphql';
import { clearSessionCookies, readRefreshToken, setAccessCookie } from '@/lib/auth/cookies';
import { fetchGraphQL } from '@/lib/graphql/client';

// A refresh is never a cached answer. Next 15 does not cache GET handlers by
// default; this states the intent so no future default can change it.
export const dynamic = 'force-dynamic';

/** Belt and braces on top of `dynamic`: no proxy or CDN may hold this response. */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** One locale today. Module 20 replaces the test with the real list. */
function localeOf(pathname: string): string {
  const first = pathname.split('/')[1] ?? '';

  return /^[a-z]{2}$/.test(first) ? first : 'en';
}

/**
 * OPEN REDIRECT DEFENCE, the same rule as `safeNextPath` in src/actions/auth.ts.
 * `?next=` is attacker-chosen. A leading `//` or `/\` is an absolute URL with a
 * host as far as a browser is concerned.
 */
function safeNextPath(raw: string | null): string {
  if (raw === null || !/^\/(?![/\\])[\w\-./?=&%]*$/.test(raw)) {
    return '/en';
  }

  return raw;
}

/**
 * Trade the refresh cookie for a fresh access cookie.
 *
 * `fetchGraphQL`, not `fetchGraphQLAuthed`: the refresh token travels in the
 * mutation VARIABLES, not in a header, so there is no `Credential` to
 * discriminate. No `options`, so nothing is cached.
 */
async function rotateAccessToken(): Promise<'ok' | 'refused' | 'unavailable'> {
  const refreshToken = await readRefreshToken();

  // No cookie at all: nothing was refused, there was simply nothing to present.
  if (refreshToken === null) {
    return 'unavailable';
  }

  try {
    const data = await fetchGraphQL(RefreshTokenDocument, { refreshToken });
    const authToken = data.refreshJwtAuthToken?.authToken;

    // WordPress answered and declined. The refresh token is spent or revoked.
    if (authToken === null || authToken === undefined || authToken === '') {
      return 'refused';
    }

    await setAccessCookie(authToken);

    return 'ok';
  } catch (error) {
    console.error('[btt] refresh: WordPress refused or was unreachable', error);

    // THREE states, not two, and this is the branch that needs the third.
    // A transport failure is not a refusal: WordPress being briefly
    // unreachable must not delete a refresh token that is still perfectly
    // valid. `POST` clears on any failure because a programmatic caller has
    // nowhere to put the distinction; `GET` clears only on 'refused', so a
    // network blip costs the editor a redirect rather than their session.
    return 'unavailable';
  }
}

/**
 * The PROGRAMMATIC contract. 401 on any failure, 204 on success. Module 16's
 * Starting State asserts the anonymous 401.
 *
 * No response body in any branch. A refresh endpoint has nothing to say that
 * the status code does not already say, and a body is a place for detail to
 * leak into.
 */
export async function POST(): Promise<Response> {
  if ((await rotateAccessToken()) !== 'ok') {
    // Clear BOTH cookies on ANY failure, whatever the cause. Two reasons, and
    // the second is the one that matters. The browser should stop presenting a
    // credential nothing will accept — and Lesson 15.5's middleware hands off
    // to this route whenever `btt_at` is near expiry, so a failed refresh that
    // left `btt_at` in place would be handed off again on the very next
    // request. That is an infinite redirect loop, and deleting the cookie is
    // what terminates it.
    await clearSessionCookies();

    return new NextResponse(null, { status: 401, headers: NO_STORE });
  }

  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

/**
 * The BROWSER hand-off. Lesson 15.5's middleware redirects a navigation here
 * when the access cookie on a guarded route is missing or nearly expired.
 *
 * A GET that changes state is normally wrong, so here is the argument. What it
 * changes is issuing the caller a fresh copy of a credential they already hold;
 * it is idempotent; it requires a cookie the browser only sends to this exact
 * path, with SameSite=Strict, so it cannot be triggered from another site at
 * all; and the alternative is shipping JavaScript to the browser whose only job
 * is to POST here. The cost, stated plainly: a link previewer that follows this
 * URL with the user's cookies would consume a refresh. Nothing breaks — the
 * refresh token is not rotated — but it is a real, if harmless, side effect.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const nextPath = safeNextPath(request.nextUrl.searchParams.get('next'));
  const result = await rotateAccessToken();

  if (result === 'ok') {
    return NextResponse.redirect(new URL(nextPath, request.nextUrl.origin), {
      status: 307,
      headers: NO_STORE,
    });
  }

  if (result === 'refused') {
    await clearSessionCookies();
  }

  // A browser NAVIGATING gets a page, not a JSON 401. Same 307 target shape the
  // guards and the middleware use: /{locale}/login?next={pathname}.
  //
  // `search =` rather than `searchParams.set()`, and this is not a style choice.
  // URLSearchParams serialises with form-urlencoding, which percent-encodes `/`
  // — you would get `?next=%2Fen%2Faccount`. Assigning `search` runs the URL
  // parser's query-encode set instead, which leaves `/` alone. Module 16's
  // Starting State asserts the UNENCODED form.
  const login = new URL(`/${localeOf(nextPath)}/login`, request.nextUrl.origin);
  login.search = `?next=${nextPath}`;

  return NextResponse.redirect(login, { status: 307, headers: NO_STORE });
}

// No PUT, PATCH or DELETE export. Next answers 405 for a method a route file
// does not implement, which is the correct answer and costs no code.
```

**Verify §4:**

- [ ] `POST /api/auth/refresh` with no cookie is `401` — Module 16's Starting State asserts exactly
      this — and `DELETE` on the same path is `405`, from a method you did not write.
- [ ] Neither branch returns a body, and `grep -c 'no-store'` on the route file is `1` — one
      constant, used in every response.

### Step 5: Write `/en/login`

```tsx
// next-app/src/app/[locale]/(auth)/login/page.tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { login } from '@/actions/auth';
import { AuthForm } from '@/components/auth/AuthForm';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSession } from '@/lib/auth/session';

export default async function LoginPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{ readonly next?: string }>;
}) {
  const { locale } = await params;
  const { next = '' } = await searchParams;

  // Already signed in? There is nothing to do here. This is a UX redirect and
  // nothing more — the pages this sends people to guard themselves.
  const session = await getSession();

  if (session.isLoggedIn) {
    redirect(next !== '' && next.startsWith('/') ? next : `/${locale}`);
  }

  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Use the email address you registered with. Sessions last five minutes and renew
        automatically while you are using the site.
      </p>

      <AuthForm action={login} submitLabel="Sign in" pendingLabel="Signing in…">
        {/* Both hidden fields are re-validated in the action. `next` is
            attacker-chosen and goes through safeNextPath(); `locale` goes
            through an allowlist. A hidden input is a request parameter, not a
            fact. */}
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="locale" value={locale} />

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
      </AuthForm>

      <p className="mt-6 text-sm text-muted-foreground">
        No account? <Link href={`/${locale}/register`} className="underline">Register</Link>.
      </p>
    </section>
  );
}
```

**Verify §5:**

- [ ] `http://localhost:3000/en/login` renders, and Lesson 15.3's dangling link is no longer a 404.
- [ ] `autoComplete="current-password"` here and `new-password` on `/verify`. Password managers
      read these, and getting them backwards makes the manager save the wrong thing.
- [ ] A wrong password shows one message, and it is the same message an unknown email produces.

### Step 6: Mount the session in the layout and the header

Two anchored edits to files earlier lessons own. Neither goes in this lesson's `produces:`.

```tsx
// next-app/src/app/[locale]/layout.tsx — add the import, the read, and the prop
import { getSession } from '@/lib/auth/session';

// …inside LocaleLayout, after the existing SiteChrome fetch:

  // Read the session ONCE, here, and pass a plain serialisable object down.
  // There is no session context in this application (Lesson 15.4 §8).
  //
  // The cost, stated plainly: reading cookies() in the root layout makes EVERY
  // route below it dynamic. `npm run build` will now mark them ƒ (Dynamic).
  // The DATA is still cached — fetchGraphQL's revalidate and tags are
  // untouched, so WordPress is queried once per window, not once per request —
  // but the HTML is assembled per request. Module 18 is where that bill arrives
  // and where a cached shell around a streamed personal region is the answer.
  const session = await getSession();

// …and in the JSX, replacing the existing <Header …/>:

        <Header
          locale={locale}
          siteTitle={chrome.generalSettings?.title ?? 'Blame The Tech'}
          session={session}
        />
```

```tsx
// next-app/src/components/layout/Header.tsx — add the import, the prop, and the controls
import { logout } from '@/actions/auth';
import type { Session } from '@/lib/auth/session';

// …extend the props of the existing async Header component:

export async function Header({
  locale,
  siteTitle,
  session,
}: {
  readonly locale: string;
  readonly siteTitle: string;
  /**
   * A plain serialisable object: `{ isLoggedIn, displayName, roles }` and no
   * token. Header is a Server Component, so nothing here reaches the client
   * bundle — but the shape is deliberately safe to serialise anyway, because
   * MobileNav is a Client Component and props travel through the RSC payload.
   */
  readonly session: Session;
}) {

// …and immediately after the closing </nav> of the desktop navigation:

        <div className="ml-auto flex items-center gap-2 md:ml-4">
          {session.isLoggedIn ? (
            <>
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {session.displayName}
              </span>
              {/* A plain form posting to a Server Action. No 'use client', no
                  onClick, no fetch — it works with JavaScript disabled, and
                  there is nothing here that COULD read an httpOnly cookie. */}
              <form action={logout}>
                <Button type="submit" variant="outline" size="sm">
                  Log out
                </Button>
              </form>
            </>
          ) : (
            <Link href={`/${locale}/login`} className="text-sm underline">
              Sign in
            </Link>
          )}
        </div>
```

Add `import { Button } from '@/components/ui/button';` to the header if it is not there, and move
the existing `ml-auto` off the mobile-nav wrapper so one element pushes the right-hand group.

**Verify §6:**

- [ ] `grep -c "'use client'" src/components/layout/Header.tsx` is still `0` — it fetches the
      menu, so it must stay a Server Component (Lesson 11.3 §3).
- [ ] `grep -rn 'createContext' src/lib/auth/ 'src/app/[locale]/layout.tsx'` returns nothing, and
      the logout control is a `<form>`, not a `<button onClick>`.
- [ ] `npm run build` marks the routes `ƒ (Dynamic)`. Expected — do not look for `● SSG`.

### Step 7: See `httpOnly` with your own eyes

A flag you have not observed is a flag you are trusting. Ninety seconds, and the only step in the
module that cannot be automated.

1. Open `http://localhost:3000/en/login` and sign in as the user you registered in Lesson 15.3.
2. Open DevTools → **Console** and run `document.cookie`.
3. Open DevTools → **Application** (Chrome) or **Storage** (Firefox) → **Cookies** →
   `http://localhost:3000`.
4. Find the row for `btt_at` and read across it. Then find `btt_rt` and read its `Path` column.
5. Open the **Network** tab, reload the page, and click the document request. Look at the
   **Request Headers**: `Cookie: btt_at=…` is there and `btt_rt` is **not**.

**Verify §7:**

- [ ] `document.cookie` returns `''` or, at most, `NEXT_LOCALE=en`. **Neither session cookie
      appears**, and no amount of JavaScript can make them appear.
- [ ] `HttpOnly` is ticked for both. `btt_rt` shows `Path` `/api/auth` and `SameSite` `Strict`;
      `btt_at` shows `/` and `Lax`.
- [ ] `Secure` is **unticked** locally — Key Concept 2's callout, not a bug.
- [ ] The document request's `Cookie` header carries `btt_at` and not `btt_rt`. That single
      observation is the whole of Key Concept 3.

### Step 8: Log in, reload, and run the suites

```bash
# From next-app, with `npm run dev` in another terminal.
npm run verify
npm test -- --run
```

Then, in the browser: sign in, land on `/en`, read the header. Your display name is there. Reload.
Still there. Wait six minutes without touching anything, reload again, and the header says **Sign
in** — `btt_at` expired and nothing refreshed it. Not a bug: the middleware that closes the gap is
Lesson 15.5, and watching the gap exist first is why it lands in that order.

**Verify §8:**

- [ ] `npm run verify` and `npm test -- --run` are both clean. `npm test` alone is Vitest **watch
      mode** and never returns.
- [ ] The header shows your display name after a reload, and no token appears in **View Source**.
      After six idle minutes it shows `Sign in` — a concrete reason to want Lesson 15.5.
- [ ] `git add -A && git commit -m "feat(auth): httpOnly cookie sessions, refresh endpoint, login"`.

---

## Verification

Two paths need proving and only one is `curl`-able: Server Action POSTs carry a build-specific
action identifier, so there is no reliable copy-pasteable `curl` for the login form. **Checks 1 to
10 verify the route handler and the cookie attributes; checks 11 to 16 plus Task Step 7 verify the
Server Action path in the browser.**

```bash
cd next-app
# `npm run dev` running in a second terminal.

# 1. NEGATIVE — the refresh endpoint refuses a caller with no cookie.
#    Module 16's Starting State asserts exactly this.
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/auth/refresh
# Expected: 401

# 2. NEGATIVE — a method the route does not implement
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:3000/api/auth/refresh
# Expected: 405   — from a method you did not export, which costs no code

# 3. NEGATIVE — a garbage refresh cookie is refused, and BOTH cookies are cleared
curl -si -X POST -b 'btt_rt=not-a-real-refresh-token' http://localhost:3000/api/auth/refresh \
  | sed -n '1p;/^[Ss]et-[Cc]ookie/p'
# Expected: HTTP/1.1 401, then two Set-Cookie lines with Max-Age=0 — one per cookie.
#           A dead refresh token means stop presenting a credential nothing accepts.

# 4. Get a REAL token pair from WordPress, playing the browser's part by hand.
cd ../wordpress-headless
export BTT_REPORTER_PASSWORD="$(openssl rand -base64 24)"
docker compose run --rm wpcli wp user update reporter --user_pass="$BTT_REPORTER_PASSWORD" >/dev/null
LOGIN_JSON=$(curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg p "$BTT_REPORTER_PASSWORD" '{
       query: "mutation Login($u:String!,$p:String!){ login(input:{username:$u,password:$p}){ authToken refreshToken } }",
       variables: { u: "reporter@blamethe.tech", p: $p } }')")
export RT=$(echo "$LOGIN_JSON" | jq -r '.data.login.refreshToken')
test -n "$RT" -a "$RT" != null && echo 'refresh token captured' || echo 'NO TOKEN — check the password'
# Expected: refresh token captured
#           A token in a shell variable is fine for five minutes of learning and is
#           NOT a storage strategy. It dies with this terminal.
cd ../next-app

# 5. THE COOKIE ATTRIBUTES, ON THE WIRE. This is the check the whole lesson is for.
curl -si -X POST -b "btt_rt=$RT" http://localhost:3000/api/auth/refresh \
  | sed -n '1p;/^[Ss]et-[Cc]ookie/p;/^[Cc]ache-[Cc]ontrol/p'
# Expected: HTTP/1.1 204
#           Set-Cookie: btt_at=<jwt>; Path=/; Max-Age=300; HttpOnly; SameSite=Lax
#           Cache-Control: no-store
#           Note what is ABSENT: no Secure (http://localhost, Key Concept 2's
#           callout) and no second Set-Cookie — the refresh token is NOT rotated.

# 6. HttpOnly really is on both cookies, asserted from the module that owns them
grep -c 'httpOnly: true' src/lib/auth/cookies.ts
# Expected: 2   — one per attribute set, which is why the grep is meaningful
grep -c "sameSite: 'strict'" src/lib/auth/cookies.ts
# Expected: 1
grep -c "path: '/api/auth'" src/lib/auth/cookies.ts
# Expected: 1

# 7. The browser hand-off: a navigation with a live refresh token lands where it asked
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  -b "btt_rt=$RT" 'http://localhost:3000/api/auth/refresh?next=/en'
# Expected: 307 http://localhost:3000/en

# 8. NEGATIVE — a navigation with NO refresh token gets a login page, not a JSON 401
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  'http://localhost:3000/api/auth/refresh?next=/en/account'
# Expected: 307 http://localhost:3000/en/login?next=/en/account
#           Unencoded, because the handler assigns `search` rather than using
#           URLSearchParams.set(). Module 16's Starting State asserts this shape.

# 9. NEGATIVE — OPEN REDIRECT. An attacker-chosen `next` is refused, not followed.
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  -b "btt_rt=$RT" 'http://localhost:3000/api/auth/refresh?next=https://evil.test/phish'
# Expected: 307 http://localhost:3000/en   — the host is YOURS, not evil.test
curl -s -o /dev/null -w '%{redirect_url}\n' \
  -b "btt_rt=$RT" 'http://localhost:3000/api/auth/refresh?next=//evil.test'
# Expected: http://localhost:3000/en   — a leading // is an absolute URL to a browser

# 10. The refresh response is not cacheable by anything in front of it
curl -si -X POST -b "btt_rt=$RT" http://localhost:3000/api/auth/refresh | grep -ci 'cache-control: no-store'
# Expected: 1

# 11. NEGATIVE — ONE MODULE OWNS THE COOKIE NAMES
grep -rn "'btt_at'\|'btt_rt'" src/ | grep -v 'src/lib/auth/jwt.ts'
# Expected: no output. cookies.ts imports the constants; nothing hand-types a name.
#           jwt.ts holds them rather than cookies.ts because src/middleware.ts
#           (Lesson 15.5) has to import them and cannot import a server-only
#           module. Key Concept 6.

# 12. NEGATIVE — nothing JavaScript can read holds a credential
grep -rn 'localStorage\|sessionStorage' src/ ; echo "exit=$?"
# Expected: no output, exit=1
grep -rn 'createContext' src/lib/auth/ src/actions/ 'src/app/[locale]/layout.tsx' ; echo "exit=$?"
# Expected: no output, exit=1   — there is no session provider in this application

# 13. NEGATIVE — Next does not verify, and could not
grep -rn 'jose\|jsonwebtoken' src/lib/auth/ package.json ; echo "exit=$?"
# Expected: no output, exit=1
grep -rn 'verify' src/lib/auth/
# Expected: no output. If `verify(` ever appears here it is a bug: the only
#           verifier of a WordPress token is WordPress (appendix 04 §5).
grep -c 'GRAPHQL_JWT_AUTH_SECRET_KEY' .env.local
# Expected: 0

# 14. NEGATIVE — NO COOKIE NAME AND NO TOKEN REACHED THE CLIENT BUNDLE
npm run build
grep -rc 'btt_at' .next/static/ 2>/dev/null | grep -v ':0$' ; echo "exit=$?"
# Expected: no output, exit=1
grep -rc 'btt_rt' .next/static/ 2>/dev/null | grep -v ':0$' ; echo "exit=$?"
# Expected: no output, exit=1
grep -rl 'http://localhost:3000' .next/static/ | head -1
# Expected: one .js file — the control. A grep that finds nothing proves nothing
#           until you have shown it can find something (Lesson 09.5 checks 7-8).

# 15. Only ONE file in the app writes a session cookie
grep -rln 'cookies()' src/ | sort
# Expected: src/lib/auth/cookies.ts and src/lib/auth/session.ts only.
#           session.ts reads through cookies.ts, so the second hit is the import
#           line, not a second attribute set. Any third file is a drift.

# 16. The health endpoint is untouched — it keeps its own fetch and its own key
curl -s http://localhost:3000/api/health | jq -r 'keys | join(",")'
# Expected: checkedAt,status
grep -rln 'WP_GRAPHQL_ENDPOINT' src/ | sort
# Expected: src/app/api/health/route.ts and src/lib/graphql/client.ts — exactly two,
#           unchanged since Lesson 10.1. A liveness probe must not depend on the
#           abstraction it is probing.

# 17. Gates stay green
npm run codegen:check
# Expected: no output
npm run verify
# Expected: no output from type-check, lint or format:check
npm test -- --run
# Expected: 0 failures.  `npm test` alone is Vitest WATCH mode and never returns.

# 18. The two guarded routes do NOT redirect yet. That is Lesson 15.5's job, and
#     knowing it is currently open is the reason 15.5 exists.
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/account
# Expected: 404 — the route does not exist at all yet
```

Checks 5, 11 and 14 define this lesson: the attribute set on the wire where you can read it, a
single module owning the names so the attributes cannot drift, and proof that the credential never
crossed into anything the browser downloads — the last of which Module 24 turns into a CI gate.
Task Step 7's DevTools walkthrough covers what `curl` cannot.

## Control Questions

1. `cookies().delete('btt_rt')` compiles, runs without error, and leaves the user logged in.
   Explain what a cookie's identity consists of, what the browser does with the deletion Next
   actually sent, and which function in `cookies.ts` gets this right and how.
2. `btt_at` is `SameSite=Lax` and `btt_rt` is `SameSite=Strict`. Give the concrete user-visible
   failure that `Strict` on `btt_at` would cause, then name the three request shapes `Lax` still
   withholds the cookie from — and say why that makes it an acceptable pairing with an origin
   check.
3. `redirect(nextPath)` is deliberately outside the `try` block in `login`. Describe the mechanism
   that makes its position matter, what the user would experience if it were inside, and why the
   bug reads as "login does nothing" rather than as an error.
4. A colleague adds `jose` and verifies the JWT in `getSession()`, cutting a WordPress round trip
   from every page render. Name the environment variable that change requires, describe precisely
   what an attacker who compromises your Vercel project can then do that they could not before,
   and give the one row of Key Concept 5's table that settles the argument.
5. `getSession()` returns `roles`, and no guard in the application branches on it. Give the two
   independent reasons — one architectural, one a concrete WPGraphQL behaviour — and say what
   would break for an `incident_reporter` if `requireCapability()` denied on an empty `roles`
   array.

## Learn More

- [Next.js — `cookies()`](https://nextjs.org/docs/app/api-reference/functions/cookies) — the read
  and write rules, the async signature, and the `delete` options object Control Question 1 is about
- [MDN — `Set-Cookie`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) —
  every attribute in Key Concept 2, including why an unset `Domain` is host-only
- [MDN — `SameSite` cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie/SameSite) —
  the exact request shapes `Lax` and `Strict` differ on; read this before choosing either
- [RFC 6265bis — cookie path matching](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis) —
  §5.1.4 is the path-match algorithm that makes a mismatched deletion silently do nothing
- [OWASP — Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) —
  read the "Cookies" and "Token expiration" sections next to Key Concepts 7 and 9
- [React — `cache`](https://react.dev/reference/react/cache) — the per-request memoization
  `getSession()` relies on, and why it is not the same thing as Next's fetch deduplication
- [Next.js — Server Actions security](https://nextjs.org/blog/security-nextjs-server-components-actions) —
  what crosses into the RSC payload; Key Concept 8 is this argument applied to a session
- [`jose`](https://github.com/panva/jose) — the library this lesson deliberately does not install;
  read the `jwtVerify` example and notice the first argument you must supply is the secret
- [OWASP — Unvalidated Redirects and Forwards](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html) —
  the attack `safeNextPath()` defends against, including the `//host` form check 9 exercises
