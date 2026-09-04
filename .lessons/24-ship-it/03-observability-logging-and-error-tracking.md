---
title: 'Observability, Logging & Error Tracking'
module: 24
lesson: 3
teaches: [structured-logging, pii-minimization, sentry, source-maps, request-id-correlation, uptime-checks, alert-thresholds, log-retention]
produces: ['next-app/instrumentation.ts', 'next-app/src/lib/logger.ts', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/observability.php']
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
