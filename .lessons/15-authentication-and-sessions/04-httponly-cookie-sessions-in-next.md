---
title: 'httpOnly Cookie Sessions in Next.js'
module: 15
lesson: 4
teaches: [httponly-cookies, samesite-scoping, token-opacity, refresh-rotation, server-side-session]
produces: ['next-app/src/lib/auth/cookies.ts', 'next-app/src/lib/auth/session.ts', 'next-app/src/actions/auth.ts', 'next-app/src/app/api/auth/refresh/route.ts', 'next-app/src/app/[locale]/(auth)/login/page.tsx']
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
