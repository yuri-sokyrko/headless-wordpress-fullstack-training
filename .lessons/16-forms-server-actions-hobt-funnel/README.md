# Module 16 — Forms, Server Actions & the HOBT Funnel

## Prerequisites

Before starting this module you should have completed:

- **Module 11** — shadcn/ui, `cva`, and the `/hobt` shell with inert CTAs
- **Module 12** — Vitest and Playwright, so a new form arrives with tests instead of hope
- **Module 15** — httpOnly sessions, `guards.ts`, and the entry-point verification matrix
- **Module 06** — `createIncident` and `submitHobtLead` ([appendix 03 §7](../appendix/03-content-model-reference.md#7-custom-graphql-fields-and-mutations))
- **Appendix 03 §5** — the [`wp_btt_leads` table](../appendix/03-content-model-reference.md#5-the-one-thing-that-is-not-a-post-wp_btt_leads)

> ⚠️ **Do not start this module with the entry-point matrix from Lesson 15.5 unfilled.** Every
> Server Action you write here adds a row to it, and the matrix is the only place that will tell
> you which one you forgot to rate-limit.

## Starting State

Module 15 complete: `registerDeveloper` creates `incident_reporter` users, `login` sets `btt_at`
and `btt_rt` as httpOnly cookies, `/en/account` and `/en/incidents/submit` redirect anonymous
visitors to `/en/login`, `/api/auth/refresh` rejects anonymous callers with `401`, and both
suites are green.

```bash
# 1. Anonymous visitors are bounced from the guarded routes
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/en/account
# Expected: 307 http://localhost:3000/en/login?next=/en/account

# 2. The refresh endpoint refuses callers with no cookie
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/auth/refresh
# Expected: 401

# 3. Suites green before you add mutations
cd next-app && npm test && npx playwright test
# Expected: 0 failures
```

## What You'll Learn

- **react-hook-form + Zod** — uncontrolled inputs, `zodResolver`, and schemas shared with the server
- **Server Actions** — `'use server'`, `useActionState`, progressive enhancement, and why not a route handler
- **One five-step skeleton** — taught once in Lesson 16.2, then repeated verbatim for every action
- **Trust boundaries in practice** — WordPress re-validating and re-authorising every field Next already checked
- **Spam control that does not punish users** — honeypot, render-timing, **Cloudflare Turnstile**, rate limits
- **PII minimisation** — `ip_hash` as an HMAC, and a logging rule with no exceptions
- **Accessible form errors** — `aria-describedby`, `role="alert"`, focus moved to the first invalid field

## What You'll Build

- `src/lib/validation/schemas.ts` — every Zod schema in the app, imported by both client and server
- `src/lib/rate-limit.ts` — Upstash Redis per-IP limiting that **fails closed**
- `src/actions/incidents.ts` and `src/actions/leads.ts`, both following the same five steps
- The incident submit form on the guarded `/incidents/submit` route
- The Get Demo dialog on `/hobt`, writing leads into `wp_btt_leads`
- The Start Now CTA, and the wp-admin side of the moderation queue

After this module **the core loop is complete**: a registered developer submits an incident, an
editor approves it in wp-admin, and it appears publicly. Get Demo captures real leads. The
revalidation that makes "appears publicly" instant is Module 18 — until then, the ISR window.

## Lessons

| #  | Lesson | New Technology | What You Build |
|----|--------|----------------|----------------|
| 01 | [Forms with react-hook-form & Zod](01-forms-with-react-hook-form-and-zod.md) | react-hook-form, Zod, `zodResolver` | `schemas.ts`, accessible form primitives, `/register` rebuilt |
| 02 | [Server Actions & Mutations](02-server-actions-and-mutations.md) | `'use server'`, `useActionState` | The five-step skeleton, `src/actions/incidents.ts`, the submit form |
| 03 | [The Get Demo Lead Form](03-the-get-demo-lead-form.md) | Turnstile, Upstash, `$wpdb` writes | `src/actions/leads.ts`, the Get Demo dialog, `wp_btt_leads` rows |
| 04 | [The Moderation Loop & the Start Now CTA](04-moderation-loop-and-the-start-now-cta.md) | Status transitions, admin columns | The wp-admin queue, Start Now, the loop closed end to end |

## The Five-Step Skeleton

Every Server Action in this application is these five steps in this order. Lesson 16.2 teaches
it; 16.3 and 16.4 repeat it without variation. If an action skips a step, the skip is a bug.

| # | Step | Failure mode | On failure |
|---|---|---|---|
| 1 | Rate-limit by IP | Redis unreachable | **Fail closed** — refuse the write |
| 2 | `schema.safeParse(formData)` | invalid input | Return typed field errors. Never `throw` |
| 3 | Authenticate, then authorise | no session / wrong role | Redirect to `/login`, or return a permission error |
| 4 | Call WordPress | WordPress disagrees | Surface its error — WordPress is the authority |
| 5 | `revalidateTag()`, then redirect or return state | stale page | Tag names come from `src/lib/graphql/tags.ts` |

## The Core Loop

```
 Public developer                 Next.js                        WordPress
        │                            │                               │
        │ fills the submit form      │                               │
        ├───────────────────────────▶│ Server Action submitIncident   │
        │                            │  1 rate limit  2 Zod           │
        │                            │  3 session + create_incidents  │
        │                            ├── createIncident  Bearer ─────▶│  re-validates
        │                            │                               │  re-authorises
        │                            │                               │  FORCES status=pending
        │                            │                               │  FORCES post_author
        │                            │                               │  IGNORES is_verified
        │                            │◀── { id, status: PENDING } ────┤
        │◀── "queued for review" ────┤  5 revalidateTag('account')    │
        │                            │                               │
                                     │                          ┌────▼──────────────┐
   Editor in wp-admin ───────────────┼─────────────────────────▶│ moderation queue  │
        │  clicks Approve            │                          │ publish_incidents │
        │                            │                          └────┬──────────────┘
        │                            │   transition_post_status ─────┤
        │                            │◀── POST /api/revalidate ──────┤  (Module 18)
        │                            │    HMAC-signed, cookieless    │
   Anyone ──────────────────────────▶│ /en/incidents — it is there   │
```

Notice which side forces `post_status` and `post_author`. Next asks; WordPress decides. Nothing
the client sends can move an incident past `pending`, because `incident_reporter` has no
`publish_incidents` capability at all.

## How to Work

1. **Read `## Quick Overview` and `## Classic WP Analogy`.** Lesson 16.2's analogy — `admin-post.php`
   and nonces — is the one that makes Server Actions stop feeling like magic.
2. **Work `## Task` in order.** 16.1 is the schemas and the primitives, 16.2 is the skeleton, 16.3
   reuses it, 16.4 closes the loop. Building 16.3 before 16.2 means writing the skeleton twice.
3. **Run `## Verification` including the negatives.** For every form: an empty submit, an
   over-long field, a missing session, a tripped rate limit, and a `curl` straight at
   `/graphql` bypassing your form entirely. That last one is the only test that proves WordPress
   re-validates.
4. **Commit after every lesson.** `git commit -m "feat(forms): submit an incident through a Server Action"`
