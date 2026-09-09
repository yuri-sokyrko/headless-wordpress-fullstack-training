# Module 15 — Authentication & Sessions

## Prerequisites

Before starting this module you should have completed:

- **Module 03** — the `incident_reporter` role and the capability matrix in [appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities)
- **Module 06** — the guarded mutations `createIncident` and `registerDeveloper` ([appendix 03 §7](../appendix/03-content-model-reference.md#7-custom-graphql-fields-and-mutations))
- **Module 09** — `middleware.ts`, route handlers, the `[locale]` segment
- **Module 10** — `fetchGraphQL`, `fetchGraphQLAuthed` and the `import 'server-only'` guard
- **Module 14** — `BlockRenderer`, so editor-composed pages already render

> ⚠️ **If you have ever stored a JWT in `localStorage`, unlearn it before Lesson 15.4.**
> Almost every headless WordPress tutorial online does it, and it is the reason this module
> spends a whole lesson on cookie attributes. The session in this app is never readable by
> JavaScript — not by an injected script, and not by your own components.

## Starting State

Module 14 complete: editor-composed pages render through `BlockRenderer`, `/hobt` is driven by
blocks, images go through `next/image`, `npm test` and `npx playwright test` green.

```bash
# 1. The stack is up and WordPress answers
docker compose ps                     # Expected: wordpress, db, adminer, mailpit running
curl -s http://localhost:3000/api/health
# Expected: {"status":"ok",...}

# 2. Blocks still render as React, not HTML blobs
curl -s http://localhost:3000/en/hobt | grep -c 'data-block'
# Expected: a number greater than 0

# 3. Both suites are green before you add auth
cd next-app && npm test -- --run && npx playwright test
# Expected: 0 failures
```

## What You'll Learn

- **Session vs token** — why `wp_set_auth_cookie()` has no equivalent here, and what replaces it
- **WPGraphQL JWT Authentication** — the `login` and `refreshJwtAuthToken` mutations, and `Authorization: Bearer`
- **The two credentials** — a user JWT and the **application token**, which are not interchangeable ([appendix 04 §4](../appendix/04-env-reference.md#4-the-two-credentials))
- **httpOnly cookie sessions** — `cookies()` in Server Actions and route handlers, `SameSite`, `Path` scoping and refresh
- **Why Next.js does not verify JWTs** — token opacity as a blast-radius decision, not laziness
- **Structural authorization** — a missing capability beats a remembered `if`
- **Hardening** — CSRF layers, rate limits, and an entry-point verification matrix you fill in yourself

## What You'll Build

- JWT configuration in WordPress with a signing secret that is **not** `AUTH_KEY`
- A hardened `incident_reporter` role: no wp-admin, no media, no `publish_incidents`
- `registerDeveloper` wired to a public `/register` page, with `users_can_register` still off
- `src/lib/auth/{cookies,session,guards}.ts` and `src/actions/auth.ts`
- `/api/auth/refresh`, plus middleware that refreshes a near-expiry token without a round trip per request
- Guarded `/account` and `/incidents/submit` routes that redirect anonymous visitors to `/login`

After this module the app has real users. They register, verify, log in, see their own name in
the header, and reach routes anonymous visitors cannot. They cannot yet submit anything — that
is Module 16.

## Lessons

| #  | Lesson | New Technology | What You Build |
|----|--------|----------------|----------------|
| 01 | [Auth Concepts for WordPress Developers](01-auth-concepts-for-wordpress-developers.md) | JWT anatomy, threat modelling | The two-audience threat model and a credential inventory |
| 02 | [WPGraphQL JWT Authentication](02-wpgraphql-jwt-authentication.md) | WPGraphQL JWT, `Authorization: Bearer` | Working `login` / `refreshJwtAuthToken`, secrets split |
| 03 | [Public Registration & Roles](03-public-registration-and-roles.md) | `registerDeveloper`, `map_meta_cap` | `/register`, `/verify`, a locked-down reporter role |
| 04 | [httpOnly Cookie Sessions in Next.js](04-httponly-cookie-sessions-in-next.md) | `cookies()`, `SameSite`, refresh rotation | `src/lib/auth/`, `src/actions/auth.ts`, `/api/auth/refresh` |
| 05 | [Authorization & Hardening](05-authorization-and-hardening.md) | Route guards, CSRF, rate limits | `guards.ts`, middleware gate, the entry-point matrix |

## Who Decides What

The single most important table in this module. Every row is a decision that could plausibly
live on either side, and every one of them lives in WordPress.

| Decision | Decided by | Why not the other side |
|---|---|---|
| Is this password correct? | WordPress | Next never sees a password hash |
| Is this JWT signed and unexpired? | WordPress, on every call | Next holds no signing secret — see [appendix 04 §5](../appendix/04-env-reference.md#5-why-graphql_jwt_auth_secret_key-must-differ-from-auth_key) |
| May this user create an incident? | WordPress (`create_incidents`) | A capability check in Next is advisory decoration |
| May this user publish it? | WordPress — and the answer is no, structurally | The capability does not exist for the role |
| Should the browser be sent to `/login`? | Next (middleware + guards) | Purely a UX redirect, never the security boundary |
| Is this token close to expiry? | Next, by reading `exp` | A cheap heuristic, not a verification |

## The Login Flow

```
Browser                Next.js (:3000)                    WordPress (:8080)
   │                          │                                   │
   │ POST /en/login  (form)   │                                   │
   ├─────────────────────────▶│ Server Action 'login'             │
   │                          │  1. rate limit (fail closed)      │
   │                          │  2. validate (Zod in 16.1)        │
   │                          ├── mutation login ────────────────▶│
   │                          │   server-to-server only           │ authenticate
   │                          │◀── { authToken, refreshToken } ───┤ sign with
   │                          │                                   │ GRAPHQL_JWT_
   │                          │  3. cookies().set(btt_at)  300s   │ AUTH_SECRET_KEY
   │                          │     cookies().set(btt_rt)  30d    │
   │                          │        Path=/api/auth  Strict     │
   │◀── 303 → /en/account ────┤                                   │
   │    Set-Cookie ×2 httpOnly│                                   │
   │                          │                                   │
   │ GET /en/account          │                                   │
   ├─────────────────────────▶│ cookies().get('btt_at')           │
   │  Cookie: btt_at=…        │ decode exp only — NEVER verify    │
   │  (JavaScript cannot      ├── viewer  Authorization: Bearer ──▶│ verifies
   │   read this)             │◀── { name, roles } ───────────────┤ signature
   │◀── HTML (no token) ──────┤                                   │  + caps
```

The token crosses exactly two boundaries: WordPress → Next, and Next → WordPress. It never
reaches a client component, a props payload, or the RSC flight stream.

## How to Work

1. **Read the lesson `## Quick Overview` and `## Classic WP Analogy` first.** This module leans
   hardest on the analogy sections — you already know WordPress auth, and most of the confusion
   comes from assuming the pieces map one-to-one.
2. **Work `## Task` in order.** Lesson 15.2 configures WordPress, 15.3 creates users, 15.4 makes
   the session real, 15.5 locks it down. Skipping ahead to 15.4 leaves you with no users to log in.
3. **Run `## Verification` every time, including the negative cases.** In an auth module the
   assertions that matter are the ones that must fail: anonymous requests, expired tokens, a
   forged app token header.
4. **Commit after every lesson.** `git commit -m "feat(auth): set the session cookie in a Server Action"`
