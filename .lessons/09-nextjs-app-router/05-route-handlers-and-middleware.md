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
[the env reference](../appendix/04-env-reference.md#32-public-next_public_--all-five-of-them) —
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

### 1. `route.ts` is `register_rest_route()`, including the part people skip

A file named `route.ts` exports one function per HTTP method, and the folder path is the URL.
`src/app/api/health/route.ts` exporting `GET` serves `GET /api/health`.

| Classic WordPress | Route Handler |
|---|---|
| `register_rest_route('btt/v1', '/health', [...])` | the file's location in `src/app/api/` |
| `'methods' => 'GET'` | `export async function GET() {}` |
| `'callback' => 'btt_health'` | the body of that function |
| `'permission_callback' => '__return_true'` | **nothing at all** — this is the trap |
| `'args' => [...]` with `validate_callback` | Zod at the top of the handler (Module 16) |
| `rest_ensure_response()` | `Response.json()` |

The trap is the fourth row. `register_rest_route()` at least *nags* you: omit
`permission_callback` and WordPress emits a `_doing_it_wrong()` notice. A `route.ts` says nothing.
There is no notice, no default, and no lint rule — the endpoint is simply public, to anyone who
guesses the path, forever.

So the course rule has no exceptions: **every route handler is authenticated, or deliberately
public and provably harmless.** `/api/health` is the second kind, and "provably" is the work in Key
Concept 3. The entry-point matrix in Lesson 15.5 lists every handler in the finished app against
which of the two it is.

One structural constraint: `route.ts` and `page.tsx` cannot coexist in the same folder. A segment is
either a page or an endpoint. That is why `/api/…` is its own subtree outside `[locale]` — an API
response has no locale and no layout.

### 2. `NextRequest`, `NextResponse`, and plain `Response`

Route handlers work with web-standard `Request`/`Response`. Next adds subclasses with extras.

| Use | When |
|---|---|
| `Response.json(body, { status })` | ✅ the default choice. Standard, testable, no import |
| `NextResponse.json(...)` | when you also need `.cookies.set()` — Module 15 |
| `NextRequest` | when you need `request.cookies`, `request.nextUrl`, or `request.headers` |
| `Request` | fine for everything else, including `await request.json()` |

This lesson uses `Response.json()` in the handler and `NextResponse` in the middleware, because
middleware's whole job is redirect/rewrite/continue and those are `NextResponse` static methods.

`Response.json()` sets `Content-Type: application/json` for you. The status code is the second
argument, and choosing it deliberately matters more here than in a page: a monitor reads the status
code, not your JSON.

### 3. `/api/health` is deliberately public, so it must leak nothing

A health endpoint exists to be polled by things that cannot authenticate: a load balancer, an
uptime monitor, a container orchestrator. Making it public is correct. Which means the body is
public too, and every helpful detail in it is reconnaissance.

| Tempting to include | What an attacker learns |
|---|---|
| `"endpoint": "http://localhost:8080/graphql"` | your CMS host and path, straight from your own API |
| `"error": "getaddrinfo ENOTFOUND wp-prod-3.internal"` | internal hostnames and your network topology |
| `"env": { "WP_APP_TOKEN": "set" }` | which secrets exist, and therefore what to phish for |
| `"wpVersion": "6.8"`, `"next": "15.1.2"` | a version to match against a CVE list |
| a stack trace, on failure | file paths, package versions, your directory layout |

So the contract is two keys and nothing else:

```json
{ "status": "ok", "checkedAt": "2026-02-11T09:41:12.184Z" }
```

`status` is `ok` or `degraded`. `checkedAt` is an ISO timestamp, which is genuinely useful — it
tells a monitor whether it is reading a fresh answer or something cached by a proxy. The shape is
identical in both branches; only the word and the HTTP status change.

Two honesties about that claim, because overstating it would be worse than not making it:

- **Body length differs by six characters** between `ok` and `degraded`. That is unavoidable and
  harmless: the status code already announces the same fact.
- **Timing differs.** A degraded check may take the full timeout before answering. That also
  reveals only what the response already says. What must never differ is *detail* — which
  dependency, which host, which error.

The real information discipline is in the code: the reason for a failure is written to the server
log, where an operator can read it, and never to the response body.

> **`ok` and `degraded` are fixed strings, and Module 15's Starting State asserts on them.** Do not
> rename them to `healthy`/`unhealthy`, do not nest them under a `data` key, and do not add a
> `wordpress:` sub-object "just for local debugging". Later modules read this endpoint.

### 4. Route segment config, and why a health check must not be cached

Route handlers accept the same segment config as pages, as exported constants:

| Export | Effect |
|---|---|
| `export const dynamic = 'force-dynamic'` | Never prerendered, never cached. Runs per request. |
| `export const dynamic = 'force-static'` | Rendered once at build; a `GET` becomes a file |
| `export const revalidate = 60` | Cache for 60 seconds |
| `export const runtime = 'nodejs' \| 'edge'` | Which runtime executes it |

A cached health check is not a health check. It is a recording of a moment when things were fine,
served with a fresh timestamp, to a monitor that will believe it. That failure is worse than having
no endpoint at all, because it converts an outage into a silent outage.

In Next 15, `GET` route handlers are **not** cached by default — that changed from Next 14, where a
`GET` with no dynamic APIs was cached and this exact bug was easy to ship. `force-dynamic` is
therefore not a fix here; it is a statement of intent that survives a future default change and
tells the next reader that the absence of caching is deliberate. Write it down.

### 5. Middleware runs on requests you never thought about

`src/middleware.ts` exports one function that runs **before the router**, on every request that
matches its `matcher`. With no matcher, that means every request: pages, RSC payload fetches for
client-side navigations, `<Link>` prefetches, `/api` routes, `/_next/static/*` chunks, images,
`favicon.ico`, `robots.txt`.

`template_redirect` is not comparable in scope. It fires on front-end page loads, after WordPress
has parsed the query, and never on a static asset — because Apache served that without invoking
PHP at all. Next has no such separation.

```
WITHOUT a matcher                        WITH the matcher below
─────────────────────────────────        ─────────────────────────────────
GET /                → middleware        GET /                → middleware → 307 /en
GET /en              → middleware        GET /en              → middleware → next()
GET /api/health      → middleware        GET /api/health      → skipped
GET /_next/static/…  → middleware        GET /_next/static/…  → skipped
GET /favicon.ico     → middleware        GET /favicon.ico     → skipped
GET /robots.txt      → middleware        GET /robots.txt      → skipped
```

Follow the left column through this lesson's logic: `/api/health` has no locale prefix, so the
middleware redirects it to `/en/api/health`, which does not exist, so your monitor gets a 404 and
your on-call engineer gets a page. `/_next/static/chunk.js` becomes `/en/_next/static/chunk.js`,
the browser cannot load the application, and the site is blank with no error in the server log.

That is why the `matcher` is a **correctness requirement, not an optimisation**. The regex is also
the single most likely thing in this lesson to be wrong, which is why Step 4 tests each excluded
class separately rather than trusting one happy-path check.

> **A middleware file with no `matcher` is a redirect loop waiting for a deploy.** The symptom is
> the worst kind: the site loads blank, the server log is clean, and the browser console shows
> asset requests returning HTML. If you ever see that, read the matcher first and everything else
> second.

### 6. The middleware runtime is restricted, and that is not an inconvenience

Middleware runs in a constrained runtime — a small, fast, V8-isolate environment rather than a full
Node process. So:

| Not available | Consequence |
|---|---|
| `fs`, `net`, `child_process` | no file reads, no raw sockets |
| A MySQL driver | **no database.** There is no `WP_Query` equivalent, at any price |
| Long CPU work | a low execution-time budget, enforced |
| Most npm packages with native bindings | including several JWT libraries |

Add one more constraint that is architectural rather than technical, and more important than all of
the above: **Next never holds `GRAPHQL_JWT_AUTH_SECRET_KEY`.**
[Appendix 04 §5](../appendix/04-env-reference.md#5-why-graphql_jwt_auth_secret_key-must-differ-from-auth_key)
explains the reasoning — if Vercel held WordPress's signing secret, a Vercel compromise would mint
valid WordPress administrator tokens. So even in a full Node runtime, this application *could not*
verify a session token locally. It can only ask WordPress.

Therefore middleware can check whether a cookie is **present**. It can never check whether it is
**valid**.

### 7. A middleware check is a convenience redirect, never authorisation

This follows from Key Concept 6, and it is the single most common security mistake in Next.js
applications. The pattern looks like a security control and is not one.

```
❌  WHAT PEOPLE BUILD                     ✅  WHAT IS ACTUALLY TRUE
middleware: no cookie → redirect         middleware: no cookie → redirect
therefore /account is protected          /account is protected by the check
                                         inside /account that asks WordPress
```

A missing-cookie redirect stops a logged-out human from seeing a broken page. It stops nothing
else. An attacker sends any cookie value they like, or requests the RSC payload directly, or
crafts a request the matcher does not cover — and the page renders, because nothing else ever
checked.

Module 15 states the rule precisely and enforces it in code: **every route that reads
user-specific data re-verifies the session where the data is fetched**, by presenting the token to
WordPress, which is the only party able to judge it. Middleware saves a round trip for the common
case. That is its entire contribution to security, and Step 6 of this Task makes you write that
sentence down in `docs/architecture.md`, because it is the sentence people forget.

> **Test for it like this:** if deleting `src/middleware.ts` would make any data reachable that was
> not reachable before, the application is already broken. That question has a yes-or-no answer, it
> takes thirty seconds to ask, and it is the only middleware security review anyone needs.

### 8. `redirect` versus `rewrite` versus `next`, and why 307

Three outcomes, and the difference is what the browser is told.

| Return | Status | Browser URL | Who sees it |
|---|---|---|---|
| `NextResponse.next()` | — | unchanged | nobody; the request continues to the router |
| `NextResponse.rewrite(url)` | 200 | **unchanged** | nobody. The URL stays, different content is served |
| `NextResponse.redirect(url)` | **307** | changes | the user, the address bar, and every crawler |

This lesson uses `redirect` for the locale prefix, deliberately. A rewrite would serve `/en/blog`'s
content at `/blog`, giving you two URLs for one page — a duplicate-content problem for Module 19's
SEO work, and a locale switcher in Module 20 with no idea which locale it is currently in. The
address bar should tell the truth about which locale you are reading.

`NextResponse.redirect()` defaults to **307 Temporary Redirect**, and that default is the one you
want, so there is no status argument to pass. The reason is method and body preservation:

| Status | Method after redirect | Body |
|---|---|---|
| 301 / 302 | may be rewritten to `GET` — historically, and in real clients | dropped |
| **307** | **preserved** | **preserved** |
| 308 | preserved, and cached permanently | preserved |

From Module 16 the site POSTs Server Actions, and a 302 on a POST that silently becomes a GET is a
form submission that vanishes with a 200. 307 is also the status Module 15's auth redirect uses, so
the whole application answers with one redirect status and there is one behaviour to remember.

### 9. The `NEXT_PUBLIC_` boundary, proved rather than asserted

The lesson closes with the check from
[appendix 04 §3.2](../appendix/04-env-reference.md#32-public-next_public_--all-five-of-them):
build for production, then grep the client bundle for the value of a server-only variable.

```bash
npm run build
grep -r "$(grep WP_GRAPHQL_ENDPOINT .env.local | cut -d= -f2)" .next/static/
# Expected: no output
```

Grepping for the **value** rather than the variable name is the point. A leak does not put
`WP_GRAPHQL_ENDPOINT` in your bundle; it puts `http://localhost:8080/graphql` there, inlined as a
string literal, with the name nowhere in sight.

Two properties make this test worth running rather than reasoning about. It is **empirical** — it
inspects the artifact you are about to deploy, not your intentions about it. And it is
**cheap enough to automate**, which is exactly what Module 24 does when it becomes a CI gate that
fails the pull request.

Run it once a module. It takes four seconds and it is the only test in this project that can catch
a mistake nobody made on purpose.

---

## Task

### Step 1: Write `/api/health`

```ts
// next-app/src/app/api/health/route.ts

// A cached health check is a recording, not a check. In Next 15 GET handlers are
// uncached by default; this states the intent so no future default or refactor can
// quietly turn this endpoint into a file. Key Concept 4.
export const dynamic = 'force-dynamic';

/**
 * The entire public contract of this endpoint. Two keys, identical shape in both
 * branches. Nothing about the dependency, the environment, or the failure.
 * Module 15's Starting State asserts on `status: "ok"` — do not rename either key.
 */
interface HealthBody {
  readonly status: 'ok' | 'degraded';
  readonly checkedAt: string;
}

/**
 * Cheapest possible round trip to WordPress: `{ __typename }` resolves without
 * touching the database, so a slow query cannot make a live site look dead.
 */
async function wordpressIsReachable(): Promise<boolean> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;

  // Deliberately does not say WHICH variable is missing. That belongs in the log,
  // not in a response anyone on the internet can read.
  if (!endpoint) {
    console.error('[btt] health: WP_GRAPHQL_ENDPOINT is not set');
    return false;
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
      // Explicit here even though it is the Next 15 default: a health check must
      // never read a cache, and this line says so to the next reader.
      cache: 'no-store',
      // Without a timeout, a hung WordPress hangs your health check, and the monitor
      // that was supposed to detect the outage times out instead of reporting it.
      signal: AbortSignal.timeout(2000),
    });

    if (!res.ok) {
      console.error(`[btt] health: WPGraphQL transport failure HTTP ${res.status}`);
      return false;
    }

    const payload = (await res.json()) as {
      data?: { __typename?: string };
      errors?: readonly unknown[];
    };

    if (payload.errors?.length) {
      console.error('[btt] health: WPGraphQL returned errors for { __typename }');
      return false;
    }

    // Checking the shape rather than a literal type name: the assertion is
    // "a GraphQL server answered a GraphQL question", which is all this proves.
    return typeof payload.data?.__typename === 'string';
  } catch (error) {
    // AbortError (timeout), DNS failure, connection refused. The reason goes to the
    // log; the caller gets one word.
    console.error('[btt] health: WordPress unreachable —', error);
    return false;
  }
}

export async function GET(): Promise<Response> {
  const healthy = await wordpressIsReachable();

  const body: HealthBody = {
    status: healthy ? 'ok' : 'degraded',
    checkedAt: new Date().toISOString(),
  };

  // The status code is what a load balancer reads. 503 means "do not send me traffic".
  return Response.json(body, { status: healthy ? 200 : 503 });
}
```

The handler takes no arguments. A `GET` that needs headers or cookies declares
`(request: NextRequest)` — Module 15's handlers do. This one needs nothing from the request, and a
parameter you do not use is a parameter `noUnusedParameters` will reject.

**Verify §1:**

- [ ] `curl -s http://localhost:3000/api/health | jq` prints exactly two keys.
- [ ] `jq -r '.status'` is `ok`.
- [ ] No locale prefix is involved: this endpoint lives outside `[locale]` and needs no layout.

### Step 2: Prove the failure branch is real, and that it still says nothing

An endpoint that always returns `ok` has not been tested. Stop WordPress:

```bash
cd ../wordpress-headless
docker compose stop wordpress

curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/health
# Expected: 503

curl -s http://localhost:3000/api/health | jq
# Expected: {"status":"degraded","checkedAt":"…"} — the same two keys, nothing added

docker compose start wordpress
cd ../next-app
```

Read your dev server terminal while it was down: the real reason is there, in full, with the
connection error. That asymmetry — everything in the log, one word in the body — is the whole
design.

**Verify §2:**

- [ ] `degraded` came back with **503**, not 200. A monitor watches the status code.
- [ ] The degraded body contains no hostname, no port, no error text and no variable name.
- [ ] After `docker compose start wordpress`, the endpoint returns `ok` again — give it a few
      seconds, and note that the timeout means a slow start looks like `degraded` rather than
      hanging.

### Step 3: Write the middleware

```ts
// next-app/src/middleware.ts
import { NextResponse, type NextRequest } from 'next/server';

// One locale today (Lesson 09.1 Key Concept 6). Module 20 adds 'uk' and 'de' here, plus
// Accept-Language negotiation and the NEXT_LOCALE cookie.
const LOCALES: readonly string[] = ['en'];

// One of the four legitimately public variables (appendix 04 §3.2). Publishing it is
// harmless: it is a two-letter language code that is already in the URL.
const DEFAULT_LOCALE = process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'en';

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // '/en/incidents'.split('/') -> ['', 'en', 'incidents']. noUncheckedIndexedAccess
  // from Lesson 07.3 is why the ?? '' is not optional.
  const firstSegment = pathname.split('/')[1] ?? '';

  // Already localised — including RSC payload requests for client-side navigations,
  // which arrive on these same URLs with a query string.
  if (LOCALES.includes(firstSegment)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${pathname === '/' ? '' : pathname}`;

  // No status argument: redirect() defaults to 307, which preserves the method and the
  // body. Module 16 POSTs Server Actions through paths this middleware may touch, and a
  // 302 that turns a POST into a GET loses the submission silently. Key Concept 8.
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything EXCEPT:
  //   api          — /api/health must answer, unprefixed, to a monitor
  //   _next        — Next's own JS, CSS and image chunks
  //   favicon.ico  — named explicitly because it is requested constantly
  //   .*\..*       — anything with a dot: robots.txt, sitemap.xml, .png, .svg
  // This must be a static literal. Next reads it at build time and cannot evaluate
  // a matcher you computed at runtime.
  matcher: ['/((?!api|_next|favicon\\.ico|.*\\..*).*)'],
};
```

Two details that are easy to get wrong. The file is `src/middleware.ts` — **beside** `src/app/`,
not inside it; a `middleware.ts` in `src/app/` does nothing at all and produces no warning. And
`clone()` keeps the query string and the hash, so `/incidents?severity=s1-catastrophic` redirects
to `/en/incidents?severity=s1-catastrophic` rather than losing the filter.

**Verify §3:**

- [ ] The dev server restarted itself and logged that it compiled the middleware. If it did not,
      the file is in the wrong directory.
- [ ] `http://localhost:3000/` lands on `/en` with the locale visible in the address bar.

### Step 4: Test every excluded class, one at a time

The matcher is one regex with four exclusions, so check four things. A single happy-path test here
is how a broken matcher reaches production.

```bash
# 4a. A locale-less page path redirects
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/incidents
# Expected: 307 http://localhost:3000/en/incidents

# 4b. A path that already has the locale does NOT redirect — no loop
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/incidents
# Expected: 200

# 4c. /api is excluded
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/health
# Expected: 200   — a 307 here means `api` fell out of the matcher

# 4d. A dotted path is excluded
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/robots.txt
# Expected: 404 — Module 19 adds the real one. The point is that it is NOT 307.

# 4e. The query string survives the redirect
curl -s -o /dev/null -w '%{redirect_url}\n' 'http://localhost:3000/incidents?severity=s1-catastrophic'
# Expected: http://localhost:3000/en/incidents?severity=s1-catastrophic
```

**Verify §4:**

- [ ] All five behave as expected. If 4c or 4d returns 307, fix the regex before continuing —
      a redirected asset request is the "blank page, no errors" failure from Key Concept 5.
- [ ] Click through the nav from Lesson 09.4 in the browser. Client-side navigation still works,
      which means the middleware is passing RSC requests through rather than redirecting them.

### Step 5: Grep the production bundle for your endpoint

```bash
npm run build

# The VALUE, not the variable name. A leak inlines the string, not the identifier.
grep -r "$(grep WP_GRAPHQL_ENDPOINT .env.local | cut -d= -f2)" .next/static/
# Expected: no output

# And the name, for completeness
grep -r 'WP_GRAPHQL_ENDPOINT' .next/static/
# Expected: no output

# The control: prove the grep works by finding something that IS public
grep -rl 'http://localhost:3000' .next/static/ | head -3
# Expected: at least one file — NEXT_PUBLIC_SITE_URL is inlined, exactly as instructed
```

That third command matters as much as the first two. A `grep` that finds nothing proves nothing
until you have shown it can find something.

**Verify §5:**

- [ ] The endpoint's value is absent from `.next/static/`.
- [ ] `NEXT_PUBLIC_SITE_URL`'s value is present. Both results are correct, and the difference
      between them is one prefix.

### Step 6: Write down what middleware is not for

Append to `docs/architecture.md`. This is the shortest note in the course and the one most likely
to prevent a real incident:

```markdown
## Middleware: what it is for, and what it must never be

`src/middleware.ts` runs before the router, in a restricted runtime with no database and no
Node APIs, on every request its `matcher` selects.

**It is for:** normalising URLs (the locale prefix), cheap redirects for the common case, and
setting request-scoped headers.

**It must never be:** an authorisation check.

Middleware cannot verify a session, because Next.js never holds
GRAPHQL_JWT_AUTH_SECRET_KEY — see appendix 04 §5. It can see that a cookie exists. It cannot
know whether the cookie is valid, unexpired, or belongs to a user with the capability being
exercised. Only WordPress can answer that.

So the auth gate Module 15 adds here is **half a check**: it saves a logged-out visitor from
a broken page. Every route that reads user-specific data re-verifies the session where the
data is fetched. If the middleware were deleted tomorrow, no data would become accessible
that was not accessible before — and if that statement ever stops being true, the security
model has been broken.

(Add your own sentence naming the concrete attack the redirect does not stop.)
```

Fill in the parenthesis. If you cannot name the attack, re-read Key Concept 7 — the answer is one
sentence about a request that never goes through the browser.

---

## Verification

```bash
cd next-app
# `npm run dev` running in a second terminal.

# 1. The health endpoint answers with exactly the two agreed keys
curl -s http://localhost:3000/api/health | jq
# Expected: {"status":"ok","checkedAt":"<ISO timestamp>"}
curl -s http://localhost:3000/api/health | jq -r 'keys | join(",")'
# Expected: checkedAt,status   (jq sorts keys — two, and only two)

# 2. And with a status code a load balancer can act on
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/health
# Expected: 200

# 3. NEGATIVE — the body leaks no configuration whatsoever
curl -s http://localhost:3000/api/health | grep -c 'localhost:8080'
# Expected: 0
curl -s http://localhost:3000/api/health | grep -cE 'GRAPHQL|TOKEN|SECRET|graphql|8080|wordpress'
# Expected: 0   — no endpoint, no variable name, no dependency name

# 4. The failure branch is real: stop WordPress, and the check notices
(cd ../wordpress-headless && docker compose stop wordpress)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/health
# Expected: 503
curl -s http://localhost:3000/api/health | jq -r '.status'
# Expected: degraded
curl -s http://localhost:3000/api/health | grep -cE 'ECONNREFUSED|ENOTFOUND|AbortError'
# Expected: 0   — the reason is in the server log, never in the body
(cd ../wordpress-headless && docker compose start wordpress)

# 5. Locale normalisation, and no redirect loop
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/incidents
# Expected: 307 http://localhost:3000/en/incidents
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/
# Expected: 307 http://localhost:3000/en
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/incidents
# Expected: 200 — not 307. A second redirect here would be an infinite loop.
curl -sL -o /dev/null -w '%{http_code} %{num_redirects}\n' http://localhost:3000/blog
# Expected: 200 1   — exactly one hop, ending on a real page

# 6. The matcher exclusions, class by class
curl -s -o /dev/null -w 'api      %{http_code}\n' http://localhost:3000/api/health
# Expected: api      200
curl -s -o /dev/null -w 'dotted   %{http_code}\n' http://localhost:3000/robots.txt
# Expected: dotted   404   — anything but 307
curl -s -o /dev/null -w 'favicon  %{http_code}\n' http://localhost:3000/favicon.ico
# Expected: favicon  404 or 200 — anything but 307

# 7. NEGATIVE — no server-only value reached the client bundle
npm run build
grep -r "$(grep WP_GRAPHQL_ENDPOINT .env.local | cut -d= -f2)" .next/static/
# Expected: no output
grep -r 'WP_GRAPHQL_ENDPOINT' .next/static/
# Expected: no output

# 8. The control for check 7 — the grep can find a public value, so silence means something
grep -rl 'http://localhost:3000' .next/static/ | head -1
# Expected: one .js file under .next/static — NEXT_PUBLIC_SITE_URL, inlined on purpose

# 9. NEGATIVE — only the two sanctioned NEXT_PUBLIC_ variables exist in the source
grep -rn 'NEXT_PUBLIC_' src/ | grep -iv 'site_url\|default_locale'
# Expected: no output. Any other NEXT_PUBLIC_ variable is a decision to publish
#           something, and appendix 04 §3.2 lists the only four that ever exist.

# 10. Every route handler in the project is accounted for
find src/app -name 'route.ts'
# Expected: exactly src/app/api/health/route.ts — the only endpoint so far, and it is
#           deliberately public. Module 15 adds the first authenticated one.

# 11. Gates stay green
npm run type-check && npm run lint
# Expected: no output from either
```

Checks 7 and 8 are a pair and neither is useful alone. Run them together, every module, and make
them the first thing you automate in Module 24.

## Control Questions

1. `register_rest_route()` without a `permission_callback` produces a `_doing_it_wrong()` notice;
   `route.ts` without an auth check produces nothing. Describe what that silence costs a team, and
   say which two properties make `/api/health` safe to leave public.
2. The degraded response is `{"status":"degraded","checkedAt":"…"}` with a 503. Name three things
   you could add to that body that would each help you debug faster, and for each one say precisely
   what an attacker would learn from it.
3. Middleware with no `matcher` runs on `/_next/static/chunk.js`. Walk through what this lesson's
   redirect logic would do to that request, what the user sees, and why the server log would not
   tell you what happened.
4. A colleague proposes moving the Module 15 auth check into middleware, "so it is in one place".
   Give the two independent reasons that cannot work — one about the runtime, one about who holds
   the signing secret — and name the request shape that bypasses a middleware-only gate entirely.
5. `NextResponse.redirect()` was used rather than `.rewrite()`, and its default 307 was left alone.
   Explain what would break in Module 19 with a rewrite, and what would break in Module 16 with a
   302.

## Learn More

- [Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route) — the file
  convention, the exported method names, and the `page.tsx` conflict rule
- [`NextRequest` and `NextResponse`](https://nextjs.org/docs/app/api-reference/functions/next-response)
  — `redirect`, `rewrite`, `next` and the cookie helpers Module 15 uses
- [Middleware](https://nextjs.org/docs/app/api-reference/file-conventions/middleware) — the
  `matcher` syntax, the runtime limits, and Next's own warning about using it for authorisation
- [Route segment config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config)
  — `dynamic`, `revalidate` and `runtime`; Lesson 10.3 comes back to the first two
- [`register_rest_route()`](https://developer.wordpress.org/reference/functions/register_rest_route/)
  — read the `permission_callback` section next to Key Concept 1; the analogy is exact
- [MDN: 307 Temporary Redirect](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/307)
  — the method-preservation rule that makes 307 the house default
- [MDN: `AbortSignal.timeout()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
  — the two lines that stop a hung dependency from hanging your health check
- [OWASP: improper error handling](https://owasp.org/www-community/Improper_Error_Handling) — why
  the helpful error message is the vulnerability, in the words of the people who catalogue it
