---
title: 'Observability, Logging & Error Tracking'
module: 24
lesson: 3
teaches: [structured-logging, pii-minimization, sentry, source-maps, request-id-correlation, uptime-checks, alert-thresholds, log-retention]
produces: ['next-app/instrumentation.ts', 'next-app/instrumentation-client.ts', 'next-app/src/lib/logger.ts', 'next-app/src/lib/logger.test.ts', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/observability.php']
requires: [24.2, 18.4]
---

# Lesson 24.3 — Observability, Logging & Error Tracking

## Quick Overview

When a user reports "the incident I submitted didn't appear", the answer lives in one of four
places: the browser, the Next.js runtime, WPGraphQL, or MySQL. Without correlation you check all
four by hand, in different tools, with different clocks. With correlation you generate a request
ID at the Next edge, attach it to the `X-BTT-Request-Id` header on every outbound GraphQL call,
log it on the WordPress side, and then one identifier retrieves the whole path. That single
discipline is worth more than any dashboard.

Structured logging is the other half: JSON lines with a level, a message, a request ID and a
small set of typed fields, so logs are queryable instead of greppable. The rule that governs
every log call is short and absolute — **logs never carry PII or tokens.** No email addresses, no
raw IP addresses (the leads table already stores an HMAC, per
[appendix 03 §5](../appendix/03-content-model-reference.md#5-the-one-thing-that-is-not-a-post-wp_btt_leads)),
no JWTs, no app token, no full request bodies. A log aggregator is a copy of your data in someone
else's system with different access controls and a long retention period; anything you log, you
have exported. Then Sentry on both sides with uploaded source maps so a minified stack trace
becomes a filename and a line number, uptime checks against a health endpoint that checks
something real, and alert thresholds tuned so that a page at 3am means something is actually broken.

By the end of this lesson you will have:

- `src/lib/logger.ts` — structured JSON logging with levels, a request ID, and a redaction list
  applied before serialisation
- A request ID generated in middleware, propagated on `X-BTT-Request-Id`, and logged on both sides
- `instrumentation.ts` plus Sentry configured for the Next server, edge and client runtimes, with
  source maps uploaded at build time and **not** served publicly
- Sentry for PHP wired through `includes/observability.php`, sharing the same request ID
- A `beforeSend` scrubber on both sides with a test proving a token in an error context is
  redacted, and uptime checks against `/wp-json/btt/v1/health` and `/api/health`, not against `/`
- Written alert thresholds — error rate, revalidation-webhook failures, 5xx rate, response time —
  and a written log retention period with the reason for it

## Classic WP Analogy

Your Classic observability stack was `WP_DEBUG_LOG`, a `debug.log` file you tailed over SSH, maybe
Query Monitor in the admin bar, and a host's error log you could reach if you had cPanel access.
It worked because there was one process, one server, one log file, and a bug reproduced by loading
the page.

| Classic WordPress | Headless |
|---|---|
| `error_log()` / `WP_DEBUG_LOG` → `debug.log` | Structured JSON to stdout, collected by the platform |
| `tail -f wp-content/debug.log` | `fly logs`, Vercel logs, or an aggregator query |
| Query Monitor in the admin bar | Sentry performance plus the timings in your own logs |
| A white screen and a PHP fatal in the log | A Sentry issue with a stack trace and release tag |
| Uptime monitor hitting the homepage | A health endpoint asserting DB, plugins and GraphQL |
| One log file, one machine, one clock | **Four tiers, two hosts, two clocks** |

The last row is the break, and it is the reason this lesson exists as its own slot rather than a
paragraph in the deployment lesson. In Classic WordPress, "the request" was a single PHP process
with a single log stream, so causality was implicit — the fatal was fifteen lines below the query
that caused it. Here a single user action crosses Vercel's edge, a Node runtime, an HTTP hop to
Fly.io, PHP, and MySQL. Each tier logs to its own place. Two of them are ephemeral. Regeneration
of an ISR page happens **later than the request that triggered it**, so the WordPress-side log
entry may be minutes away from the user-visible symptom, on a different day's log page.

Nothing in Classic WordPress practice prepares you for that, and no amount of log-reading skill
compensates. The fix is not better logs, it is **a shared identifier** — which has to be designed
in, at the edge, before there is an incident to debug. There is also a second break worth naming:
`debug.log` sat on a server you controlled and nobody else read. A log aggregator and an error
tracker are third-party systems holding whatever you send them, which is why the no-PII rule is a
data-protection control and not a tidiness preference.

---

## Key Concepts

### 1. Four tiers, two hosts, two clocks

One user action crosses five boundaries. Each keeps its own log, in its own format, with its own
notion of what time it is.

```
browser ──▶ Vercel edge ──▶ Next Node runtime ──▶ Fly.io: Apache/PHP ──▶ MySQL
   │            │                  │                      │                │
console      edge log         stdout → Vercel        error_log() →      slow query
             (retained         (retained             wp-content/        log, if
              hours)            days)                debug.log         enabled
   ▲            ▲                  ▲                      ▲
   └── your clock  └── Vercel's     └── same             └── the container's,
       (wrong)         (NTP)            process             which drifts
```

The row that has no Classic equivalent is the two clocks. On a Classic site the fatal was fifteen
lines below the query that caused it, in one file, so **causality was implicit in line order**.
Here two of the four streams are ephemeral, one lands in a file you have to `exec` into a
container to read, and ordering across them is a guess unless something in the payload says which
lines belong together.

That something is a shared identifier, and it has to be designed in before there is an incident
to debug. You cannot retrofit correlation onto logs that have already been written.

### 2. `X-BTT-Request-Id`, and where it does and does not exist

One header, minted in middleware, forwarded on every outbound GraphQL call that happens **inside
a request**, logged on both sides. It is the only new `X-BTT-*` header in Modules 21 to 24 — the
others are `X-BTT-App-Token`, `X-BTT-Signature`, `X-BTT-Timestamp` and `X-BTT-E2E-Secret`.

```
POST /en/incidents/submit
  middleware:  id = 3f9a…                          → x-btt-request-id on request AND response
  Server Action: logger({ requestId: '3f9a…' })    → {"lvl":"info","rid":"3f9a…","msg":"submit"}
  execute():    X-BTT-Request-Id: 3f9a…            → outbound to /graphql
  WordPress:    error_log('[btt] rid=3f9a… …')     → wp-content/debug.log
```

**And here is the part every tutorial omits.** A request id exists only where there is a request:

| Context | Has a request id? | What correlates instead |
|---|---|---|
| Route handler, Server Action | **yes** — read it off `request.headers` | — |
| Middleware | **yes** — it mints it | — |
| Dynamic (personalised) route render | yes | — |
| **Static prerender at build time** | **no. There is no request.** | build id + route |
| **ISR regeneration** | **no** — see §8 | revalidation event id + tag |

So the logger **never reads `headers()` itself.** The caller passes the id. That is not fussiness:
a `headers()` call inside a shared logging utility would opt every route that logs anything out of
the Full Route Cache, which is precisely the failure Lesson 18.1 spent a whole lesson undoing.
A logging library is not worth forfeiting static rendering for.

The alternative is `AsyncLocalStorage` from `node:async_hooks`, which threads the id invisibly
and is genuinely nicer at the call sites. Its cost: it does not exist in the edge runtime, so
middleware cannot participate; and an invisible dependency is one a future refactor breaks
without a type error. This course threads an explicit optional parameter instead, so
`requestId: null` shows up in the log and in the type when there is no request — **which is
information, not a defect.**

### 3. Structured logging: the field set, and why `console.log` is not it

A log line is a record with a schema, not a sentence. One JSON object per line, so a query
language can filter it instead of a regular expression guessing at it.

| Field | Type | Always present | Why |
|---|---|---|---|
| `lvl` | `'debug' \| 'info' \| 'warn' \| 'error'` | yes | the only thing an alert rule can key on cheaply |
| `msg` | `string`, a **fixed** string | yes | fixed so you can count occurrences; the variable part goes in fields |
| `rid` | `string \| null` | yes | §2. `null` is a value, not an omission |
| `t` | ISO 8601 with milliseconds | yes | your clock is not the aggregator's |
| `svc` | `'web' \| 'wp'` | yes | which of the two applications |
| `err` | `{ name, message }` | on error | never the raw `Error`, whose `cause` chain can hold anything |
| `dur` | number, ms | on a timed operation | the cheapest performance signal you will ever add |

`msg` being a fixed string is the rule people break first. `` `submitted incident ${slug}` ``
produces one distinct message per slug, so "how often does this happen" becomes unanswerable.
`{ msg: 'incident submitted', slug }` answers it in one query.

On both hosts the transport is the same and it is not a file: **write to stdout and let the
platform collect it.** Vercel and Fly both capture stdout. A log file inside a container is a log
file that vanishes with the container.

### 4. Logs never carry PII or tokens, and the reason is not tidiness

The rule is short and absolute. **No email addresses. No raw IP addresses. No JWTs, no app token,
no session cookie. No full request bodies.**

The reason is the part that makes it stick: **a log aggregator is a copy of your data in someone
else's system, with different access controls and a long retention period. Anything you log, you
have exported.** `debug.log` sat on a server you controlled and nobody else read. A hosted error
tracker is a third party holding whatever you send it, searchable by everyone with a seat, for as
long as the plan retains it. That makes the no-PII rule a data-protection control, not a style
preference — and it means a stray `console.log(formData)` in a form handler is a data export
nobody reviewed.

The project already has the right primitive: `wp_btt_leads.ip_hash` is an **HMAC** keyed with
`BTT_LEAD_IP_HMAC_KEY`, never a raw address
([appendix 03 §5](../appendix/03-content-model-reference.md#5-the-one-thing-that-is-not-a-post-wp_btt_leads),
Lesson 16.3). Logs get the same treatment or nothing at all.

| Tempting to log | Log instead |
|---|---|
| `email` | nothing. If you must group by user, log the numeric user ID |
| `x-forwarded-for` | nothing, or the HMAC the leads table already computes |
| the whole `formData` | the **field names** that failed validation, never their values |
| `Authorization` / `X-BTT-App-Token` | `'redacted'`, produced by the scrubber, not by remembering |
| a Zod error | `error.issues.map(i => i.path.join('.'))` — paths, not `received` |

**Redaction happens before serialisation, not after.** A regular expression over a rendered JSON
string is a post-hoc filter that fails on the first token that happens to contain a `"`; walking
the object and replacing values by key name is deterministic. And it must run on **both** sides —
a scrubber in TypeScript does nothing for a PHP `error_log()`.

### 5. Where each stream actually lands. This table has cost people hours.

| What logs | Goes to | How you read it |
|---|---|---|
| `logger.info()` in the Next Node runtime | stdout | `vercel logs` / the aggregator |
| `logger.info()` in middleware (edge) | edge stdout | same, different retention |
| `console.*` in a client component | the browser console only | not collected at all |
| PHP `error_log()` in WordPress | **`wp-content/debug.log`** | `docker compose exec wordpress tail -f /var/www/html/wp-content/debug.log` |
| An uncaught PHP fatal | `debug.log` **and** Apache's error log | both |
| A captured exception, either side | Sentry | the Sentry issue |

**The fourth row is the one that costs afternoons.** Lesson 02.2's `docker-compose.dev.yml` sets
`WP_DEBUG_LOG`, so PHP output is redirected to `wp-content/debug.log` and
`docker compose logs wordpress` **never sees it**. That was step 1 of the troubleshooting list for
the most common Module 18 failure, and
[appendix 06 §4](../appendix/06-troubleshooting.md#4-nextjs) had it wrong once and was corrected.
If you are tailing `docker compose logs wordpress` waiting for a `[btt]` line, you will wait
forever.

`WP_DEBUG_DISPLAY` is `false` even locally, also deliberately: a PHP notice injected into a
GraphQL JSON body is a parse error on the Next side and sends you hunting in entirely the wrong
tier.

### 6. A Sentry DSN belongs behind `NEXT_PUBLIC_`, and that is the whole point

`NEXT_PUBLIC_SENTRY_DSN` looks exactly like the mistake Lesson 24.8's review checklist warns
about — "a secret behind `NEXT_PUBLIC_`". It is not one, and knowing why is more useful than the
rule it appears to violate.

| Identifier | What it lets the holder do | Public? |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | **submit** an event to one project | **yes, correctly** |
| `SENTRY_AUTH_TOKEN` | read every issue, upload source maps, create releases | **never** |
| `WP_APP_TOKEN` | perform authenticated mutations against WordPress | never |
| `NEXT_PUBLIC_SITE_URL` | nothing | yes |

A DSN is a **write-only ingest key**. It cannot read an issue, list a project or change a setting.
The browser must hold it, because the browser is what reports a client-side error, and any value
the browser holds is public whether you prefix it or not — the prefix only decides whether you
are honest about it.

So the rule is not "nothing public". **The rule is: know which of your identifiers are
capabilities.** A DSN is not a capability worth protecting; the worst an abuser does with it is
submit junk events to your project, which is rate limiting's problem and not a breach.
`SENTRY_AUTH_TOKEN` *is* a capability, it stays server-only, and it lives in a GitHub Actions
secret used at build time only.

The residual risk, named: an abuser with your DSN can burn your event quota. Sentry's inbound
filters and per-key rate limits are the mitigation, and rotating a DSN is a config change rather
than an incident.

### 7. Source maps: symbolicate the server, and do not serve anything

A minified stack trace is `a.b is not a function` at `4f2c-9a1.js:1:38210`. Source maps turn that
into a filename and a line. They must be **uploaded** to the error tracker and must **not** be
publicly fetchable, because a browser-fetchable source map is your application's source code on
the open internet.

This course ships **server-side symbolication only**, and that is a deliberate, narrower choice
than the Sentry wizard makes:

| | Server / RSC / route handlers / Server Actions | Client islands |
|---|---|---|
| Maps generated by default | **yes**, in `.next/server` | **no** |
| Symbolicated stack traces | yes | no — minified |
| Requires `productionBrowserSourceMaps: true` | no | yes |
| Publicly fetchable | never — `.next/server` is not served | **yes if you enable it**, and Next serves them |

`productionBrowserSourceMaps: true` both generates browser maps **and serves them**, so the honest
version of "upload then delete" is a build step that removes the `.map` files after upload — and
`next.config.ts` is a one-key-per-lesson file whose key for Module 24 is already spent on Lesson
24.2's headers. So the course does not enable it.

**What that costs:** a client-side error arrives with an unreadable stack. Most of the interesting
errors in this application are on the server — GraphQL failures, revalidation, Server Actions,
auth — so the loss is real but small. **The reversal condition:** the first time a client island
produces an error you cannot diagnose, enable `productionBrowserSourceMaps` in a dedicated pull
request **and** add the upload-then-delete step in the same PR. Never one without the other.

### 8. ISR regeneration happens later than the request that triggered it

This is the structural fact that breaks naive correlation, and it is worth its own concept because
nothing in Classic WordPress prepares you for it.

```
14:02:11  user requests /en/incidents/incident-07   → STALE HTML served, 200, fast
14:02:11  Next schedules a background regeneration
14:02:11  the user's request COMPLETES. rid=3f9a… ends here.
   …
14:02:19  regeneration runs. New request id. Calls WordPress.
14:02:19  WordPress logs rid=b71c… — eight seconds and one identifier away
```

Consequences you have to design around:

- The WordPress-side log entry for a page a user complained about may be **minutes** away from
  their request, and on a different day's log page if the revalidation was triggered by a webhook
  overnight.
- A regeneration has **no user**. There is no session, no IP, no locale preference beyond the
  route. Logging "who" is not merely forbidden, it is meaningless.
- So the correlating key for a regeneration is the **cache tag** that triggered it, not a request
  id. Lesson 18.3's webhook already sends identifiers from which `tags.ts` derives tags; logging
  the derived tag is what lets you answer "why did this page change at 03:14".

Write the regeneration's own id and its triggering tag on the same line, and the chain
user-report → tag → webhook → WordPress change becomes walkable. Omit the tag and it does not.

### 9. Uptime checks target a health endpoint, never `/`

`GET /` on the WordPress host returns 200 from Apache while WordPress cannot reach MySQL, because
Apache is happy to serve a PHP error page with a 200. A monitor pointed at `/` reports green
through a total database outage. This is the single most common monitoring mistake in the
WordPress world.

| Target | Built by | Asserts | On failure |
|---|---|---|---|
| `GET /api/health` | **Lesson 09.5** — already exists | Next can POST `{ __typename }` to WPGraphQL within 2 s | `503` + `{ status: 'degraded', checkedAt }` |
| `GET /wp-json/btt/v1/health` | **Lesson 24.6** — forward reference, do not build it here | WordPress reaches MySQL, required plugins are active | `503` |
| `GET /` | — | that a web server is running | **nothing useful** |

`/api/health` returns `{ status: 'ok' \| 'degraded', checkedAt }` and **the key names are frozen**
— Module 15's Starting State asserts on `status: "ok"`. Never rename either. It is also
deliberately public and deliberately **not** rate limited (Lesson 15.5's entry-point matrix says
so on its own row): throttling your own monitor turns a health check into a source of alerts.

Two health endpoints rather than one, because they fail independently. Next can be up while
WordPress is down — that is exactly the `degraded` state — and WordPress can be up while Vercel
is having a bad afternoon.

### 10. Thresholds and retention, with the number's reason attached

An alert with no threshold is a dashboard. A threshold with no stated reason is a number somebody
will halve during the next noisy week.

| Signal | Threshold | Window | Why this number |
|---|---|---|---|
| Unhandled error rate (web) | > 1% of requests | 5 min | below ~1% is indistinguishable from bot traffic hitting removed URLs |
| 5xx rate (either host) | > 0.5% | 5 min | a user-visible failure; tighter than the error rate because a 5xx is always real |
| **Revalidation webhook failures** | **any 3 in 15 min** | 15 min | a count, not a rate: the webhook fires rarely, so a rate never trips. Three failures means published content is not reaching the site, which is silent and worse than an outage |
| `/api/health` | 2 consecutive failures | 2 min | one failure is a cold start or a deploy |
| p95 response time (web) | > 1500 ms | 15 min | Module 21's LCP budget is 2500 ms; the server half must fit inside it |
| p95 GraphQL duration | > 1000 ms | 15 min | Lesson 18.4's client timeout is 8000 ms — a p95 near it means every slow page is one hiccup from a hard failure |
| Sentry: a **new** issue type | immediately, low priority | — | new is more interesting than frequent |

The revalidation row is the one worth arguing about, and it is the reason this table is not
copied from a template. A failing revalidation webhook produces **no user-visible error at all**:
the site serves stale content, cheerfully, indefinitely. Nothing 5xxs. Nothing times out. Editors
publish, see nothing change, and file a ticket about caching three days later. It is the only
signal here where the alert *is* the detection mechanism.

**Retention: 30 days for application logs, 90 days for Sentry issues.** The reasons, in order:
30 days covers "it happened last week and nobody mentioned it", which is the realistic reporting
lag; it is short enough that an accidental PII leak has a bounded life, which matters because §4
is a control and not a guarantee; and it is long enough for a month-over-month comparison. Sentry
gets 90 because an issue is already aggregated and carries no request payload, so it is cheap and
carries less risk. Any retention longer than your ability to justify it in a data-protection
review is a liability, not an asset.

---

## Task

### Step 1: Write the structured logger and its redaction list

```ts
// next-app/src/lib/logger.ts
// Structured JSON logging. One object per line, to stdout, collected by the
// platform. No file, no transport, no dependency.
//
// NO `import 'server-only'` — the same reason as tags.ts and rate-limit.ts
// (Lesson 12.2 §6): this module has a unit test that runs in plain Node, where
// the `server-only` package throws.
//
// AND NO `headers()` CALL, ANYWHERE IN THIS FILE. A headers() read inside a
// shared logging utility opts every route that logs anything out of the Full
// Route Cache — the exact failure Lesson 18.1 spent a lesson undoing. The
// caller passes the request id. Key Concept 2.

export type Level = 'debug' | 'info' | 'warn' | 'error';

/** Key names whose VALUES are replaced, at any depth. Compared lower-cased. */
const REDACT_KEYS: readonly string[] = [
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'x-btt-app-token',
  'x-btt-signature',
  'x-btt-e2e-secret',
  'secret',
  'email',
  'ip',
  'x-forwarded-for',
];

/** Value shapes that are PII or a credential regardless of the key they sit under. */
const REDACT_VALUES: readonly RegExp[] = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/, // an email address
  /\beyJ[A-Za-z0-9_-]{10,}\./, // a JWT: base64url `{"alg"` then a dot
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/, // an IPv4 address
];

const REDACTED = '[redacted]';

/**
 * Walk the object and replace values BEFORE serialisation.
 *
 * Not a regex over the rendered JSON string: that is a post-hoc filter and it
 * fails on the first token containing a quote. Walking by key is deterministic.
 * Key Concept 4.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';

  if (typeof value === 'string') {
    return REDACT_VALUES.some((re) => re.test(value)) ? REDACTED : value;
  }

  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.includes(k.toLowerCase()) ? REDACTED : redact(v, depth + 1);
    }

    return out;
  }

  return value;
}

export interface LogContext {
  /** null when there is no request: a static prerender or an ISR regeneration. */
  readonly requestId: string | null;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/**
 * `msg` is a FIXED string. `submitted incident ${slug}` produces one distinct
 * message per slug and makes "how often does this happen" unanswerable. Put the
 * slug in `fields`. Key Concept 3.
 */
export function createLogger(context: LogContext): Logger {
  const emit = (lvl: Level, msg: string, fields?: Record<string, unknown>): void => {
    const line = {
      lvl,
      msg,
      rid: context.requestId,
      t: new Date().toISOString(),
      svc: 'web' as const,
      ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    };

    // stdout, always. `console.error` for warn/error so the platform's own
    // severity split agrees with ours.
    const sink = lvl === 'error' || lvl === 'warn' ? console.error : console.log;
    sink(JSON.stringify(line));
  };

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

/** Read the id middleware set. No headers() call — the caller holds the Request. */
export function requestIdFrom(request: Request): string | null {
  return request.headers.get('x-btt-request-id');
}

/** An Error, flattened to two safe fields. Never the Error itself: `cause` can hold anything. */
export function errorFields(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { err: { name: error.name, message: error.message } }
    : { err: { name: 'Unknown', message: String(error) } };
}
```

**Verify §1:**

- [ ] `grep -c 'headers()' src/lib/logger.ts` is `0`. This is the check that protects every
      static route in the application.
- [ ] `grep -c "server-only" src/lib/logger.ts` is `0`, on purpose — Step 3's unit test runs in
      plain Node.
- [ ] `npm run type-check` passes. `redact` returns `unknown` deliberately; the cast at the one
      call site is where the narrowing is documented.

### Step 2: Mint the id in middleware, as concern **one**

The frozen order is: **(1) mint the request id, (2) next-intl, (3) the auth gate, (4) attach
response headers.** This step inserts concern 1 at the very top. It must be first because the id
has to be on **every** response including a redirect — mint it after next-intl and a locale
redirect leaves the trace.

```ts
// next-app/src/middleware.ts — an anchored insertion at the TOP of the existing
// middleware() body, ABOVE Lesson 20.3's `const response = handleLocale(request)`.
// Concerns 2, 3 and 4 are unchanged. `config.matcher` is unchanged.
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // ── 1. REQUEST ID — first, so it is on every response including a redirect ──
  // crypto.randomUUID() is available in the edge runtime with no import.
  // Honour an inbound id so a load balancer or a client that already has a trace
  // keeps it; mint one otherwise. Length-capped because an unbounded header from
  // the internet is a header you have not validated.
  const inbound = request.headers.get('x-btt-request-id') ?? '';
  const requestId =
    /^[A-Za-z0-9-]{8,64}$/.test(inbound) ? inbound : crypto.randomUUID();

  request.headers.set('x-btt-request-id', requestId);

  // … concern 2 (handleLocale), concern 3 (the gate) unchanged …
```

Then one line in concern 4, beside Lesson 24.2's headers:

```ts
// next-app/src/middleware.ts — inside concern 4, beside the CSP lines from 24.2.
  // On the RESPONSE too, so a browser bug report can quote the id. This is the
  // only X-BTT-* header that is deliberately visible to a client.
  response.headers.set('x-btt-request-id', requestId);
```

**Verify §2:**

- [ ] `git diff src/middleware.ts | grep -cE '^[-+].*matcher'` is `0`. Lesson 15.5 §4 forbids
      editing the matcher and Lesson 20.3 obeyed it.
- [ ] The mint is **above** `handleLocale(request)`. If it is below, `curl -sI` on a path that
      redirects (`http://localhost:3000/incidents`) shows no `x-btt-request-id` on the 307 — and
      that redirect is the hop you most want to trace.
- [ ] `grep -c 'crypto.randomUUID' src/middleware.ts` is `1`.
- [ ] The inbound id is validated against a pattern. An unvalidated header from the internet
      lands verbatim in your log aggregator, which is a log-injection surface.

### Step 3: Prove the redaction, before you rely on it

```ts
// next-app/src/lib/logger.test.ts
import { describe, expect, it, vi } from 'vitest';

import { createLogger, redact } from '@/lib/logger';

describe('redact', () => {
  it('replaces a token by key name, at any depth', () => {
    expect(redact({ headers: { Authorization: 'Bearer abc' } })).toEqual({
      headers: { Authorization: '[redacted]' },
    });
  });

  it('replaces a JWT by value shape even under an innocent key', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig';
    expect(redact({ note: jwt })).toEqual({ note: '[redacted]' });
  });

  it('replaces an email address by value shape', () => {
    expect(redact({ subject: 'from editor@blamethe.tech' })).toEqual({ subject: '[redacted]' });
  });

  it('replaces an IPv4 address by value shape', () => {
    expect(redact({ note: 'seen from 203.0.113.7' })).toEqual({ note: '[redacted]' });
  });

  it('leaves a slug alone — over-redaction makes logs useless', () => {
    expect(redact({ slug: 'incident-01', count: 3 })).toEqual({ slug: 'incident-01', count: 3 });
  });

  it('terminates on a cyclic-ish deep structure instead of recursing forever', () => {
    let deep: Record<string, unknown> = { end: 'x' };
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };
    expect(JSON.stringify(redact(deep))).toContain('[depth]');
  });
});

describe('createLogger', () => {
  it('emits one JSON line carrying rid, and redacts fields on the way out', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    createLogger({ requestId: '3f9a' }).info('incident submitted', {
      slug: 'incident-01',
      token: 'super-secret',
    });

    const line = JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({
      lvl: 'info',
      msg: 'incident submitted',
      rid: '3f9a',
      svc: 'web',
      slug: 'incident-01',
      token: '[redacted]',
    });
    spy.mockRestore();
  });

  it('records rid: null rather than omitting it when there is no request', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    createLogger({ requestId: null }).info('static render');
    expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toMatchObject({ rid: null });
    spy.mockRestore();
  });
});
```

**Verify §3:**

- [ ] `npm test -- --run src/lib/logger.test.ts` reports **8 passed**.
- [ ] Delete one entry from `REDACT_VALUES` and exactly one test goes red. If none does, the
      test is asserting the key list twice and the value list not at all.
- [ ] The "leaves a slug alone" case matters as much as the others. A scrubber that redacts
      everything produces logs nobody can debug with, and the first person to hit that turns the
      scrubber off.

### Step 4: Forward the id on the outbound GraphQL call

```ts
// next-app/src/lib/graphql/client.ts — an anchored edit. `execute()` already
// takes an options object and already sets `AbortSignal.timeout(TIMEOUT_MS)`
// (Lesson 18.4 §1 — TIMEOUT_MS is 8000 and there is exactly one deadline).
// Add ONE optional field and ONE header. Nothing else in this file changes.

export interface ExecuteOptions {
  // … every existing field, unchanged …
  /**
   * From middleware, via the route handler or Server Action that holds the
   * Request. Absent during a static prerender and during an ISR regeneration —
   * both have no request, and `undefined` is the honest value (Key Concept 2).
   */
  readonly requestId?: string;
}

// … inside execute(), in the headers object:
      ...(options.requestId ? { 'X-BTT-Request-Id': options.requestId } : {}),
```

**Verify §4:**

- [ ] `grep -c 'X-BTT-Request-Id' src/lib/graphql/client.ts` is `1`.
- [ ] The header is spread conditionally. `exactOptionalPropertyTypes` (Lesson 07.3) rejects
      assigning `undefined` to an optional property, and a literal `'undefined'` string in a
      header is worse than no header.
- [ ] `grep -c 'Promise.race\|setTimeout' src/lib/graphql/client.ts` is still `0`. You did not
      add a second deadline while you were in the file.
- [ ] `grep -c 'headers()' src/lib/graphql/client.ts` is `0`.

### Step 5: Write `observability.php` and load it **first**

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/observability.php
/**
 * Structured logging and error reporting for the WordPress side.
 *
 * WHERE THIS OUTPUT GOES: wp-content/debug.log, not `docker compose logs
 * wordpress`. Lesson 02.2 sets WP_DEBUG_LOG, which redirects PHP error output
 * to that file. Key Concept 5 — and appendix 06 §4 had this wrong once.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

/** Key names whose values are replaced. Mirrors REDACT_KEYS in src/lib/logger.ts. */
const LOG_REDACT_KEYS = array(
	'authorization',
	'cookie',
	'password',
	'token',
	'secret',
	'email',
	'ip',
	'x_btt_app_token',
	'x_btt_signature',
);

/** The request id from Next, or null. Read once per request. */
function request_id(): ?string {
	static $id = false;

	if ( false !== $id ) {
		return $id;
	}

	$raw = isset( $_SERVER['HTTP_X_BTT_REQUEST_ID'] )
		? sanitize_text_field( wp_unslash( (string) $_SERVER['HTTP_X_BTT_REQUEST_ID'] ) )
		: '';

	// Same pattern middleware validates against. An unbounded header from the
	// internet in a log line is a log-injection surface.
	$id = (bool) preg_match( '/^[A-Za-z0-9-]{8,64}$/', $raw ) ? $raw : null;

	return $id;
}

/**
 * Redact by key, then by value shape, BEFORE json_encode. Key Concept 4.
 *
 * @param mixed $value Anything.
 * @param int   $depth Recursion guard.
 * @return mixed
 */
function log_redact( $value, int $depth = 0 ) {
	if ( $depth > 6 ) {
		return '[depth]';
	}

	if ( is_string( $value ) ) {
		$patterns = array(
			'/[^\s@]+@[^\s@]+\.[^\s@]+/',      // email
			'/\beyJ[A-Za-z0-9_-]{10,}\./',      // JWT
			'/\b(?:\d{1,3}\.){3}\d{1,3}\b/',    // IPv4
		);

		foreach ( $patterns as $pattern ) {
			if ( preg_match( $pattern, $value ) ) {
				return '[redacted]';
			}
		}

		return $value;
	}

	if ( is_array( $value ) ) {
		$out = array();

		foreach ( $value as $key => $item ) {
			$out[ $key ] = in_array( strtolower( (string) $key ), LOG_REDACT_KEYS, true )
				? '[redacted]'
				: log_redact( $item, $depth + 1 );
		}

		return $out;
	}

	return is_scalar( $value ) || null === $value ? $value : '[object]';
}

/**
 * One JSON line, the same field names the Next logger uses, so one query
 * language reads both sides.
 *
 * @param string               $level  debug|info|warn|error.
 * @param string               $msg    A FIXED string. Variables go in $fields.
 * @param array<string, mixed> $fields Extra fields.
 */
function log_line( string $level, string $msg, array $fields = array() ): void {
	$line = array_merge(
		array(
			'lvl' => $level,
			'msg' => $msg,
			'rid' => request_id(),
			't'   => gmdate( 'c' ),
			'svc' => 'wp',
		),
		(array) log_redact( $fields )
	);

	error_log( // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- the logging transport; WP_DEBUG_LOG routes it to wp-content/debug.log.
		'[btt] ' . (string) wp_json_encode( $line )
	);
}

/**
 * Sentry, if the SDK is present and a DSN is configured.
 *
 * Guarded on class_exists rather than required: the SDK is a production
 * dependency installed by Lesson 24.6's image build, and a local install
 * without it must not fatal. `before_send` is the second scrubber — a payload
 * Sentry assembles itself never passed through log_redact().
 */
function boot_sentry(): void {
	$dsn = (string) getenv( 'SENTRY_DSN' );

	if ( '' === $dsn || ! function_exists( '\\Sentry\\init' ) ) {
		return;
	}

	\Sentry\init(
		array(
			'dsn'          => $dsn,
			'environment'  => wp_get_environment_type(),
			'release'      => (string) ( getenv( 'BTT_RELEASE' ) ?: 'unknown' ),
			'send_default_pii' => false, // the default; stated because it is the control
			'before_send'  => static function ( $event ) {
				// Same rule as the logger: nothing PII-shaped leaves this process.
				$event->setExtra( (array) log_redact( $event->getExtra() ) );

				return $event;
			},
		)
	);

	\Sentry\configureScope(
		static function ( $scope ): void {
			$rid = request_id();

			if ( null !== $rid ) {
				// The same identifier, so one search spans both applications.
				$scope->setTag( 'request_id', $rid );
			}
		}
	);
}
add_action( 'plugins_loaded', __NAMESPACE__ . '\\boot_sentry', 1 );

/**
 * Log every GraphQL operation with its request id and query count.
 *
 * Distinct from Lesson 06.4's local-only counter, which logs to a different
 * prefix and is gated on `local`. This one runs everywhere and carries `rid`.
 *
 * @param mixed  $response  The response.
 * @param mixed  $schema    The schema.
 * @param string $operation The operation name.
 * @return mixed The response, unchanged.
 */
function log_graphql_operation( $response, $schema, $operation = '' ) {
	global $wpdb;

	log_line(
		'info',
		'graphql operation',
		array(
			// The operation NAME, never the document: a document can carry
			// variables, and variables carry user input.
			'op'      => '' !== (string) $operation ? (string) $operation : 'anonymous',
			'queries' => (int) $wpdb->num_queries,
		)
	);

	return $response;
}
add_filter( 'graphql_request_results', __NAMESPACE__ . '\\log_graphql_operation', 20, 3 );
```

Then load it — and this is **one added line, not a reprint.** Lessons 17.2 and 18.3 both use the
elision form for exactly this reason: a full reprint is the thing that rots. Lesson 16.3 dropped
two entries once and Lesson 20.1 dropped twelve, and in both cases the fence looked authoritative
while being wrong. **Your own `Plugin.php` is the authority for what is in that array.** Lesson
24.6 keeps the one full listing in this course, as its closing inventory; this is not the place
for a second.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
// Fragment — ONE line added to the existing INCLUDES array, and it is the only
// entry in the whole course that goes FIRST rather than last: an error tracker
// loaded last cannot report an error in anything that loaded before it, and
// this file depends on no other include. Every other entry is unchanged, in the
// order Modules 03 to 20 left them.
	private const INCLUDES = array(
		'includes/observability.php',   // Lesson 24.3  ← FIRST, deliberately
		// … every entry Modules 03 to 20 added, unchanged, in order …
	);
```

The array holds **nineteen** entries before this line and **twenty** after. If your count differs,
count your file rather than trusting this sentence — that is the whole argument for the elision
form.

**Verify §5:**

- [ ] `grep -c "^\s*'includes/" includes/Plugin.php` is **`20`**, and `observability.php` is the
      first of them. Nineteen means the require did not land; twenty-one means you added a line
      twice. `INCLUDES` has grown across ten lessons — 03.2, 03.3, 03.4 (twice), 03.5, 04.1,
      06.1 (twice), 06.2 (four times), 06.4, 15.3, 16.3, **16.4**, 17.2, 18.3, 20.1 — and your
      file is the authority, not this lesson.
- [ ] `docker compose run --rm wpcli wp plugin deactivate blame-the-tech-core && docker compose run --rm wpcli wp plugin activate blame-the-tech-core`
      succeeds with no fatal. A `Failed opening required` here is a typo in the new path.
- [ ] `docker compose run --rm wpcli wp eval 'echo function_exists("Blame\\Core\\log_line") ? "loaded" : "NOT LOADED", PHP_EOL;'`
      prints `loaded`.
- [ ] `grep -c 'error_log' includes/observability.php` is `1`. One transport, one place to change
      it.

### Step 6: Sentry on the Next side, server and edge

```ts
// next-app/instrumentation.ts
// Runs once per runtime before anything else. Next calls `register()` for the
// `nodejs` and `edge` runtimes; `NEXT_RUNTIME` says which one you are in.
//
// NO withSentryConfig() wrapper around next.config.ts, deliberately. That
// wrapper hides three behaviours — source-map upload, release creation and a
// tunnel route — inside the build, and `next.config.ts` is a one-key-per-lesson
// file whose Module 24 key is spent on Lesson 24.2's headers. Lesson 21.3's
// nesting bug is what happens when two wrappers meet. Key Concept 7.
import * as Sentry from '@sentry/nextjs';

const REDACT_HEADERS = ['authorization', 'cookie', 'x-btt-app-token', 'x-btt-signature'];

export function register(): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  if (!dsn) return; // no DSN, no reporting, no crash

  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? 'development',
    // A stack trace is only useful if it maps to a commit.
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
    tracesSampleRate: 0.1,
    // Off. Sentry's own PII collection would undo Key Concept 4 in one flag.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        for (const key of REDACT_HEADERS) {
          if (key in event.request.headers) event.request.headers[key] = '[redacted]';
        }
      }
      // A query string can carry ?next=/en/account and, in a bug report, worse.
      if (event.request?.query_string) event.request.query_string = '[redacted]';

      return event;
    },
  });
}

export function onRequestError(...args: Parameters<typeof Sentry.captureRequestError>): void {
  Sentry.captureRequestError(...args);
}
```

```ts
// next-app/instrumentation-client.ts
// The browser half. Loaded by Next on the client; `register()` is not used here.
import * as Sentry from '@sentry/nextjs';

// A DSN is a WRITE-ONLY INGEST KEY, not a secret, so NEXT_PUBLIC_ is correct —
// and arguing that is the point of Key Concept 6. SENTRY_AUTH_TOKEN is the
// capability, and it never leaves the build environment.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  release: process.env.NEXT_PUBLIC_RELEASE ?? 'local',
  tracesSampleRate: 0.1,
  // No replay, no profiling. Session Replay records the DOM, which on
  // /en/incidents/submit means recording what a user typed into a form.
  // That is a Key Concept 4 violation with a nice UI on it.
  sendDefaultPii: false,
});
```

**Verify §6:**

- [ ] `grep -c 'withSentryConfig' next.config.ts` is `0`, and `grep -c 'withNextIntl' next.config.ts`
      is still `2`.
- [ ] `grep -rc 'productionBrowserSourceMaps' next.config.ts` is `0`. Enabling it both generates
      browser source maps **and serves them** — Key Concept 7 has the reversal condition and it
      requires the delete step in the same pull request.
- [ ] `grep -c 'Replay\|replayIntegration' instrumentation-client.ts` is `0`.
- [ ] `npm run build` succeeds and prints no Sentry warning about a missing auth token. The token
      is a CI-only concern; Lesson 24.4 adds the upload step to `_web.yml`.

### Step 7: Point the monitors at the health endpoints, and write the numbers down

Uptime configuration lives in your monitoring provider, so what goes in git is the decision.
Append one section to `docs/runbook.md` — created by Lesson 15.2, appended to by 16.3, 17.2 and
18.4. **Lesson 24.7 extends it with the deployment runbook; that is a different section.**

```markdown
<!-- docs/runbook.md — append ONE section. -->

## Observability and alerting (Lesson 24.3)

### Monitors

| Target | Interval | Fails when | Never point a monitor at |
|---|---|---|---|
| `https://<web>/api/health` | 60 s | 2 consecutive non-200 | `/` — Next serves a static page while WordPress is down |
| `https://<wp>/wp-json/btt/v1/health` | 60 s | 2 consecutive non-200 | `/` — Apache returns 200 through a total MySQL outage |

`/api/health` returns `{ status, checkedAt }` with 200 or 503. **The key names are frozen** —
Module 15's Starting State asserts `status: "ok"`.

### Alert thresholds

| Signal | Threshold | Window | Route to |
|---|---|---|---|
| unhandled error rate (web) | > 1% | 5 min | on-call |
| 5xx rate (either host) | > 0.5% | 5 min | on-call |
| **revalidation webhook failures** | **any 3** | 15 min | on-call — this failure is SILENT to users |
| `/api/health` | 2 consecutive | 2 min | on-call |
| p95 response time (web) | > 1500 ms | 15 min | daily digest |
| p95 GraphQL duration | > 1000 ms | 15 min | daily digest |
| new Sentry issue type | first occurrence | — | daily digest |

### Retention

| Store | Period | Reason |
|---|---|---|
| application logs | **30 days** | covers the realistic reporting lag; bounds the life of an accidental leak |
| Sentry issues | **90 days** | aggregated, no request payload, cheaper risk |
| Sentry replays | **not enabled** | recording the DOM on a form page records what a user typed |

### Finding one request across both applications

1. Get `x-btt-request-id` from the response headers, or from the user's bug report.
2. Query the web logs for `rid` equal to it.
3. Query the WordPress logs for the same value — same field name, same format.
4. If the WordPress side has nothing, the symptom is an **ISR regeneration**: search by the cache
   tag instead, and expect a timestamp minutes later. Lesson 24.3 §8.
```

**Verify §7:**

- [ ] Neither monitor targets `/`. That is the single most common WordPress monitoring mistake
      and it reports green through a database outage.
- [ ] Every threshold row has a window and a destination. A threshold with no destination is a
      dashboard.
- [ ] The retention rows have reasons. A number you cannot justify in a data-protection review is
      a liability, not an asset.

### Step 8: Correlate one real request end to end, then commit

```bash
cd next-app && npm run build && npm start &
sleep 8

# Drive one request that reaches WordPress, capture the id from the response,
# then look for the SAME value on both sides.
rid=$(curl -sI http://localhost:3000/en/incidents | tr -d '\r' | awk -F': ' '/x-btt-request-id/{print $2}')
echo "rid=$rid"
docker compose -f ../wordpress-headless/docker-compose.yml exec -T wordpress \
  grep -c "$rid" /var/www/html/wp-content/debug.log

git add -A
git commit -m "feat: correlated structured logging, request ids and Sentry on both sides"
```

**Verify §8:**

- [ ] `rid` is a non-empty UUID-shaped string. Empty means concern 1 is not first in middleware,
      or you are looking at a route the matcher excludes.
- [ ] The `grep -c` is `1` or more **for a dynamic route**. For `/en/incidents`, which is
      prerendered, expect `0` — the page was rendered at build time and no WordPress call
      happened during your request. That is Key Concept 2 and Key Concept 8, observed rather than
      asserted. Repeat against `/en/account` while signed in to see a non-zero count.
- [ ] `git diff HEAD~1 --stat` includes `logger.ts`, `logger.test.ts`, `middleware.ts`,
      `client.ts`, `instrumentation.ts`, `instrumentation-client.ts`, `observability.php`,
      `Plugin.php` and `docs/runbook.md`.

---

## Verification

```bash
cd next-app
npm run build && npm start &   # `next start`, not dev — dev logs differently
sleep 8

# 1. The request id is on the response of a matched path
curl -sI http://localhost:3000/en | tr -d '\r' | grep -i 'x-btt-request-id'
# Expected: x-btt-request-id: <36-char uuid>

# 2. ...and on a REDIRECT too. This is what proves concern 1 runs FIRST.
curl -sI http://localhost:3000/incidents | tr -d '\r' | grep -ciE '^(HTTP/1.1 307|x-btt-request-id)'
# Expected: 2 — a 307 line and an id line. If the id is missing, minting sits
#           below handleLocale() and the redirect hop is untraceable (Step 2).

# 3. An inbound id is honoured, so an upstream trace is not broken
curl -sI -H 'x-btt-request-id: aaaabbbbccccdddd' http://localhost:3000/en \
  | tr -d '\r' | awk -F': ' '/x-btt-request-id/{print $2}'
# Expected: aaaabbbbccccdddd

# 3b. NEGATIVE — an unvalidated inbound id is NOT trusted verbatim
curl -sI -H 'x-btt-request-id: ../../etc/passwd", "lvl":"error' http://localhost:3000/en \
  | tr -d '\r' | awk -F': ' '/x-btt-request-id/{print $2}'
# Expected: a fresh uuid, NOT the injected string. A header from the internet
#           reaching a log line verbatim is a log-injection surface.

# 4. THE CORRELATION CHECK — one id, three places, all matching.
#    /en/account is dynamic (Lesson 15.5 guards it), so a WordPress call really
#    happens inside the request. Sign in first; the password comes from the shell.
rid=$(curl -sI -b /tmp/btt-cookies.txt http://localhost:3000/en/account \
        | tr -d '\r' | awk -F': ' '/x-btt-request-id/{print $2}')
echo "rid=$rid"
# Expected: a uuid
grep -c "\"rid\":\"$rid\"" /tmp/btt-web.log
# Expected: 1 or more — the Next side (redirect stdout to /tmp/btt-web.log)
docker compose -f ../wordpress-headless/docker-compose.yml exec -T wordpress \
  grep -c "$rid" /var/www/html/wp-content/debug.log
# Expected: 1 or more — the WordPress side, SAME value, SAME field name

# 4b. NEGATIVE — a PRERENDERED route has no request id in the WordPress log,
#     because no WordPress call happened during your request.
rid2=$(curl -sI http://localhost:3000/en/incidents | tr -d '\r' | awk -F': ' '/x-btt-request-id/{print $2}')
docker compose -f ../wordpress-headless/docker-compose.yml exec -T wordpress \
  grep -c "$rid2" /var/www/html/wp-content/debug.log
# Expected: 0 — and that is correct, not a bug. Key Concepts 2 and 8.

# 5. NEGATIVE — a token in an error context is redacted
node --input-type=module -e "
  const { redact } = await import('./src/lib/logger.ts');
  console.log(JSON.stringify(redact({ headers: { Authorization: 'Bearer abc.def.ghi' } })));"
# Expected: {"headers":{"Authorization":"[redacted]"}}
#           If your Node cannot import .ts directly, the same assertion is
#           logger.test.ts case 1 — run `npm test -- --run src/lib/logger.test.ts`.

# 5b. NEGATIVE — an email address is redacted even under an innocent key name
npm test -- --run src/lib/logger.test.ts
# Expected: 8 passed — including the email, JWT and IPv4 value-shape cases

# 6. NEGATIVE — no logger call passes a whole request body
grep -rnE 'logger\.(debug|info|warn|error)\([^)]*(formData|await request\.json\(\)|req\.body|\bbody\b)' src/
# Expected: no output. A body is user input in bulk; log the field NAMES that
#           failed validation, never their values (Key Concept 4).

# 6b. NEGATIVE — and nothing logs a raw IP or an email by variable name
grep -rnE "logger\.(debug|info|warn|error)\([^)]*(\bemail\b|x-forwarded-for|clientIp)" src/
# Expected: no output

# 7. NEGATIVE — a source map is not publicly fetchable
curl -s -o /dev/null -w '%{http_code}\n' \
  "http://localhost:3000/_next/static/chunks/main-app.js.map"
# Expected: 404. Browser source maps are not generated at all, because
#           productionBrowserSourceMaps would also SERVE them (Key Concept 7).
find .next/static -name '*.map' | wc -l
# Expected: 0
find .next/server -name '*.map' | head -1
# Expected: at least one path — SERVER maps exist and are never served. That is
#           the asymmetry the lesson chose deliberately.

# 8. Plugin::INCLUDES has TWENTY entries and the plugin still activates
cd ../wordpress-headless
grep -c "^\s*'includes/" wp-content/plugins/blame-the-tech-core/includes/Plugin.php
# Expected: 20 — nineteen before this lesson, plus observability.php. A 19 means
#           the require never landed and every log_line() call below is a fatal.
docker compose run --rm wpcli wp plugin deactivate blame-the-tech-core
docker compose run --rm wpcli wp plugin activate blame-the-tech-core
# Expected: "Success:" twice, and no "Failed opening required"
docker compose run --rm wpcli wp eval 'echo function_exists("Blame\\Core\\log_line") ? "loaded" : "NOT LOADED", PHP_EOL;'
# Expected: loaded

# 8b. NEGATIVE — observability.php is FIRST, not appended last
head -3 <(grep -A20 'const INCLUDES' wp-content/plugins/blame-the-tech-core/includes/Plugin.php) | grep -c observability
# Expected: 1 — an error tracker loaded last cannot report an error in
#           anything that loaded before it (Step 5)

# 9. The WordPress logger writes to debug.log, and NOT to `docker compose logs`
docker compose run --rm wpcli wp eval 'Blame\Core\log_line( "info", "probe", array( "email" => "e@x.dev", "slug" => "incident-01" ) );'
docker compose exec -T wordpress tail -n 3 /var/www/html/wp-content/debug.log | grep -o '"msg":"probe".*'
# Expected: a JSON line where "email" is "[redacted]" and "slug" is "incident-01"
docker compose logs --tail=50 wordpress | grep -c '"msg":"probe"'
# Expected: 0 — Key Concept 5. If you are tailing container logs waiting for
#           this line, you will wait forever.

# 10. NEGATIVE — the health endpoints are the monitor targets and `/` is not
curl -s -o /dev/null -w 'next-health %{http_code}\n' http://localhost:3000/api/health
# Expected: next-health 200
curl -s http://localhost:3000/api/health | jq -r 'keys | join(",")'
# Expected: checkedAt,status — the two frozen key names (Lesson 09.5)
docker compose stop db >/dev/null 2>&1
sleep 3
curl -s -o /dev/null -w 'root-with-db-down %{http_code}\n' http://localhost:8080/
# Expected: root-with-db-down 200 — APACHE IS FINE. This is why a monitor on
#           `/` reports green through a total database outage.
curl -s -o /dev/null -w 'next-health-with-db-down %{http_code}\n' http://localhost:3000/api/health
# Expected: next-health-with-db-down 503 — the endpoint that tells the truth
docker compose start db >/dev/null 2>&1

# 11. NEGATIVE — the auth token is not in the client bundle, but the DSN is
grep -rc "$SENTRY_AUTH_TOKEN" ../next-app/.next/static/ 2>/dev/null | grep -v ':0' | wc -l
# Expected: 0 — SENTRY_AUTH_TOKEN is the capability and never ships
grep -rl 'ingest.sentry.io' ../next-app/.next/static/ | head -1
# Expected: a path. The DSN IS in the bundle, correctly: it is a write-only
#           ingest key, and the browser is what reports a browser error (§6).

# 12. NEGATIVE — no replay integration, and no default PII on either side
grep -rc 'replayIntegration\|Replay' ../next-app/instrumentation-client.ts
# Expected: 0
grep -c "send_default_pii' => false" wp-content/plugins/blame-the-tech-core/includes/observability.php
# Expected: 1

# 13. NEGATIVE — the logger reads no request context of its own
grep -c 'headers()' ../next-app/src/lib/logger.ts
# Expected: 0. A headers() call here opts every route that logs anything out of
#           the Full Route Cache (Lesson 18.1).

# 14. The gates still pass
cd ../next-app && npm run type-check && npm run lint && npm run test:run
# Expected: all three exit 0
cd ../wordpress-headless && docker compose run --rm composer run phpcs
# Expected: exits 0

kill %1
```

Check 4b and check 9 are the two that teach rather than merely pass. 4b says out loud that a
prerendered route produces no WordPress log line during your request, so an empty `grep` is the
architecture working; and check 9 demonstrates the `debug.log` redirection that has cost this
course's readers more time than any other single fact.

## Control Questions

1. The logger takes `requestId` as an explicit parameter rather than reading `headers()`. Name the
   concrete thing that would break if it read `headers()` instead, say which lesson established
   that constraint, and describe what a Module 21 budget report would look like the day after
   somebody "simplified" it.
2. `NEXT_PUBLIC_SENTRY_DSN` is public and `SENTRY_AUTH_TOKEN` is not. Give the general rule those
   two cases are instances of, then apply your rule to `NEXT_PUBLIC_SITE_URL` and to
   `BTT_LEAD_IP_HMAC_KEY` and say what each one is.
3. An editor reports that a post they published two hours ago still shows the old title. Using
   only the identifiers this lesson introduces, describe the sequence of queries you would run —
   and say at which step a request id stops being the right key and what replaces it.
4. Redaction runs by key name **and** by value shape, on both sides. Construct a payload that the
   key-name pass would miss and the value-shape pass would catch, then one that both would miss,
   and say what you would change to catch the second.
5. The revalidation-webhook alert is a **count** (any 3 in 15 minutes) while every other alert is
   a **rate**. Explain why a rate cannot work for that signal, and name one other signal in this
   system that would need the same treatment for the same reason.

## Learn More

- [Next.js — `instrumentation.ts`](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation) —
  when `register()` runs, which runtimes it runs in, and why `NEXT_RUNTIME` is the only reliable
  way to tell where you are
- [Next.js — `instrumentation-client.ts`](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client) —
  the browser half, and how it differs from the server file that shares its name
- [Sentry — Next.js manual setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/) —
  read this rather than running the wizard; the wizard adds `withSentryConfig`, and Key Concept 7
  explains why this course declines it
- [Sentry — data scrubbing and `beforeSend`](https://docs.sentry.io/platforms/javascript/configuration/filtering/) —
  the server-side scrubbing Sentry does for you, which is a second net and never the first one
- [Sentry — PHP SDK](https://docs.sentry.io/platforms/php/) — `init()`, `configureScope` and
  `before_send`, which is what `observability.php` wires up
- [WordPress — `WP_DEBUG_LOG`](https://developer.wordpress.org/advanced-administration/debug/debug-wordpress/#wp_debug_log) —
  one paragraph, and the reason `docker compose logs wordpress` never shows a PHP notice in this
  project
- [OWASP — Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) —
  the "what not to log" list, and log injection, which is why Step 2 validates an inbound header
  against a pattern
- [W3C — Trace Context](https://www.w3.org/TR/trace-context/) — the standard `traceparent` header
  this lesson deliberately does **not** use; read it before you decide whether `X-BTT-Request-Id`
  should be replaced by it in a system with more than two services
- [Google SRE Workbook — alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) — the
  argument behind every window in Key Concept 10, and the reason a five-minute window and a
  one-hour window detect different failures
