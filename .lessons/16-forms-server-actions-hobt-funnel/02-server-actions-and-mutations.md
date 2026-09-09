---
title: 'Server Actions & Mutations'
module: 16
lesson: 2
teaches: [server-actions, use-action-state, five-step-skeleton, rate-limiting, trust-boundaries]
produces: ['next-app/src/actions/incidents.ts', 'next-app/src/lib/rate-limit.ts', 'next-app/src/lib/rate-limit.test.ts', 'next-app/src/components/incidents/IncidentSubmitForm.tsx', 'next-app/src/app/[locale]/incidents/submit/page.tsx']
requires: [6.3, 16.1]
---

# Lesson 16.2 — Server Actions & Mutations

## Quick Overview

This is the lesson that turns Blame The Tech from a reader into an application, and it is the
lesson whose output every later mutation copies. You will write **one** Server Action —
`submitIncident` — as five explicit steps, in this order, every time: (1) rate-limit and **fail
closed** if the limiter is unreachable; (2) `schema.safeParse` and return typed field errors
rather than throwing; (3) authenticate and authorise from the session, not from anything the form
sent; (4) call the `createIncident` mutation with the user's Bearer token; (5) `revalidateTag`,
then redirect or return typed state. Lessons 16.3 and 16.4 repeat that skeleton verbatim. If a
future action of yours skips a step, the skip is the bug — which is the entire reason the skeleton
is fixed rather than idiomatic.

Step 4 is where the trust boundary lives, and it is worth being blunt about what WordPress does
with your carefully validated payload: it does not trust a byte of it. `createIncident`
re-validates every field independently, re-checks `create_incidents` with `current_user_can()`,
**forces** `post_status` to `pending` and `post_author` to the authenticated user, and **silently
ignores** any client-supplied `is_verified` — see
[appendix 03 §4.1](../appendix/03-content-model-reference.md#41-incident-details). A field being
present in a GraphQL input type is not permission to set it. Rate limiting follows the same
double-enforcement logic: `src/lib/rate-limit.ts` uses Upstash Redis per IP to shed load at the
edge, and WordPress keeps its own per-user transient limit which is the **authoritative** one,
because your Next-side limiter is bypassed the instant someone finds the WordPress origin — and
media `sourceUrl` values mean they will.

By the end of this lesson you will have:

- `src/lib/rate-limit.ts` — a per-IP Upstash limiter with an explicit fail-closed branch and a
  unit test for the Redis-is-down path
- `src/actions/incidents.ts` — `submitIncident` written as the five numbered steps, with the step
  numbers as comments so a reviewer can see a missing one
- `IncidentSubmitForm.tsx` on `useActionState`, with a pending state, field errors from step 2 and
  a working no-JavaScript submit
- A live `/en/incidents/submit` that creates a real `pending` incident visible in wp-admin
- A per-user rate limit in the plugin, enforced with transients, proven to still bite when the
  Next-side limiter is disabled
- Negative proofs: a direct `curl` at `/graphql` with a reporter token that tries
  `status: PUBLISH` and `is_verified: true` and gets neither

## Classic WP Analogy

The Classic WordPress equivalent of a Server Action is `admin-post.php`. You register
`admin_post_btt_submit_incident`, point a form's `action` at `admin-post.php` with a matching
`action` hidden field, add `wp_nonce_field()`, and your handler receives `$_POST`, validates it,
calls `wp_insert_post()`, and finishes with `wp_safe_redirect()`. A Server Action is that with the
routing and the nonce plumbing deleted: `'use server'` makes the function itself the endpoint,
React generates the reference the form posts to, and Next checks the request's `Origin` against
`Host` before it runs.

| Classic WordPress | This stack |
|---|---|
| `admin_post_*` / `wp_ajax_*` handler | an exported `async function` in `src/actions/incidents.ts` |
| the hidden `action` field + `admin-post.php` | the action reference React puts in `<form action={…}>` |
| `wp_nonce_field()` + `check_admin_referer()` | Next's Origin/Host check + `SameSite` (Lesson 15.5) |
| `wp_insert_post( ['post_status' => 'pending'] )` | the `createIncident` mutation, which forces `pending` itself |
| `wp_safe_redirect()` + `exit` | `redirect()` from `next/navigation` |
| a transient-based throttle | `src/lib/rate-limit.ts`, **plus** the WordPress-side transient |
| `WP_Error` back into the template | the typed state object returned to `useActionState` |

Two questions come up here, and both have a real answer. *Why a Server Action and not a route
handler?* Because a Server Action can set cookies, receives `FormData` from a plain HTML form, and
therefore still works with JavaScript disabled or still loading — for a lead-capture CTA on the
page whose conversion rate marketing is measuring, progressive enhancement is a revenue argument,
not a purity one. *Why does WordPress re-validate what Next already validated?* Because Next is
not a trusted client. It is trusted *infrastructure* and it is still a client.

**Where the analogy breaks down:** in `admin-post.php` you are already inside WordPress. `$_POST`
arrives, `current_user_can()` reads the same session, `wp_insert_post()` runs in the same request,
and there is exactly one place where authorization can be enforced or forgotten. A Server Action
runs on a completely different machine and calls WordPress over HTTP as an authenticated client.
Every guard you write in the action is a **second** guard; the real one is in PHP. Code that reads
like `if ( session.roles.includes('editor') ) { publish() }` is not a security control, it is a
comment with syntax.

The second break: `admin-post.php` handlers run once per submit and nothing is cached. A Server
Action mutates state that Next has probably already cached as static HTML, so step 5 —
`revalidateTag` — is not housekeeping. Skip it and the user submits successfully, is redirected,
and sees a page that convincingly claims their submission does not exist. Module 18 makes that
mechanism precise.

---

## Key Concepts

### 1. `'use server'`, mechanically — and the consequence people miss

`'use server'` at the top of a file marks **every export in it** as a Server Action. That is not a
hint to the bundler; it is a build instruction with three concrete effects:

```
src/actions/incidents.ts        'use server'
        │
        ├─ 1. the build assigns each export a stable ID and registers a HANDLER
        │      for it in the server runtime
        │
        ├─ 2. the client bundle receives a REFERENCE, not the function body.
        │      `<form action={submitIncident}>` renders
        │      <form action="/en/incidents/submit" method="POST"> plus a
        │      hidden field carrying that ID
        │
        └─ 3. on submit, Next matches the ID, checks Origin against Host,
               deserialises the FormData and calls your function on the server
```

So a Server Action is an **HTTP endpoint whose URL you never chose**. Everything true of a route
handler is true of it: unauthenticated callers can reach it, the arguments are attacker-controlled,
and there is no framework asking whether that is sensible. Lesson 06.2 §2 said the same thing about
`register_graphql_mutation`, in PHP. The lesson generalises.

Now the consequence:

> **Every exported function in a `'use server'` file is a public endpoint.** An accidentally
> exported helper is an accidentally exposed one. `export function mapEnvironment(kebab)` looks
> harmless; `export async function writeMeta(postId, key, value)` is a remote arbitrary-metadata
> write, reachable by anyone who can POST to your site. There is no `private` keyword that saves
> you and no lint rule on by default.

The discipline is one line long: **in a `'use server'` file, export only actions.** Everything else
is a `function` with no `export`, or it lives in `src/lib/`. Verification greps for the export
count and expects exactly the number of intended endpoints, and that grep is a security check, not
a tidiness check.

### 2. `useActionState`, and why the state must be serialisable

```ts
// (illustration) the signature, and the three things it gives back
const [state, formAction, isPending] = useActionState(submitIncident, { status: 'idle' });
```

| Returned | Is | Notes |
|---|---|---|
| `state` | the last value your action returned | the *initial* value on first render |
| `formAction` | the thing you put in `<form action={…}>` | React binds the previous state as the first argument for you |
| `isPending` | `true` between submit and response | use it to disable the button, never to hide the form |

Which is why the action's signature is `(previousState, formData)` and not `(formData)`. React
prepends the previous state on every invocation; you rarely read it, and it must still be in the
parameter list.

**The state crosses the network, so it must be serialisable.** A `Date`, a `Map`, a class instance,
a function or an `Error` either fails to serialise or arrives as something you did not send. Zod's
`error.flatten().fieldErrors` is a plain `Record<string, string[]>` for exactly this reason. So the
state type for this module is:

```ts
// (illustration) the shape every action in Module 16 returns. Lesson 15.4's
// AuthFormState is the same shape with the same three members.
export type IncidentFormState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string; readonly fieldErrors?: Readonly<Record<string, readonly string[]>> }
  | { readonly status: 'success'; readonly slug: string; readonly title: string };
```

A discriminated union rather than `{ ok: boolean; error?: string; slug?: string }`, because the
union makes "success with no slug" a type error instead of a runtime `undefined` in a heading.

### 3. Server Action or Route Handler — the decision, with a verdict

Both are server code reached over HTTP. They are not interchangeable.

| | Server Action | Route Handler (`route.ts`) |
|---|---|---|
| Reached by | `<form action>` or a call from a client component | any HTTP client, at a URL you chose |
| Arguments | `FormData`, or serialisable values | a `Request` |
| Can set cookies | ✅ | ✅ |
| Can `redirect()` | ✅ | ✅ |
| Works with JavaScript absent | ✅ **the browser submits the form** | ❌ needs a `fetch` you wrote |
| Callable by a third party | technically yes, practically awkward — the ID is a build artifact | ✅ that is the point |
| CSRF posture | Next enforces Origin/Host on action POSTs (Lesson 15.5) | you enforce it |
| Right for | a form your own app renders | a webhook, a health check, an OAuth callback |

**Verdict: forms are Server Actions in this application, and there are no exceptions.** The
argument that decides it is not architectural purity, it is the third-from-last row. `/hobt` is the
page whose conversion rate marketing measures. A lead form built as a `fetch` inside an `onSubmit`
converts zero visitors whose JavaScript failed to load — on a flaky mobile connection, behind a
corporate proxy that mangles bundles, or during the two seconds before hydration finishes. A lead
form built as a Server Action converts them. That is a revenue argument.

The counter-case is real and this app has three of them: `/api/health` (a liveness probe must not
depend on the abstraction it is probing), `/api/auth/refresh` (called by proxy, not a form),
and `/api/revalidate` in Module 18 (called by WordPress, cookieless, HMAC-signed). Notice what they
have in common: **no human is on the other end.**

### 4. The five steps, each with its failure mode

This is the module README's table, expanded into what each step actually does. The numbers are
comments in every action file so a reviewer can see a missing one by reading, not by reasoning.

```
 FormData arrives
      │
 ┌────▼──────────────────────────────────────────────────────────────────┐
 │ 1  RATE LIMIT   limit(`incident:${ip}`)                               │
 │    fails when   Redis is unreachable   → REFUSE (fail closed, §5)     │
 │    fails when   the bucket is empty    → refuse with a retry-after    │
 └────┬──────────────────────────────────────────────────────────────────┘
 ┌────▼──────────────────────────────────────────────────────────────────┐
 │ 2  VALIDATE     refineTerms(allowed).safeParse(...)                   │
 │    fails when   any field is wrong     → return typed fieldErrors     │
 │    NEVER throws. A throw here loses the user's input (16.1 §6)        │
 └────┬──────────────────────────────────────────────────────────────────┘
 ┌────▼──────────────────────────────────────────────────────────────────┐
 │ 3  AUTHENTICATE, then AUTHORISE   getSession() + readAccessToken()    │
 │    fails when   no session         → error state with a sign-in link  │
 │    fails when   wrong role         → error state. UX, NOT a boundary  │
 └────┬──────────────────────────────────────────────────────────────────┘
 ┌────▼──────────────────────────────────────────────────────────────────┐
 │ 4  CALL WORDPRESS   fetchGraphQLAuthed(..., { kind: 'user', jwt })    │
 │    fails when   WordPress disagrees → surface it. It is the AUTHORITY │
 └────┬──────────────────────────────────────────────────────────────────┘
 ┌────▼──────────────────────────────────────────────────────────────────┐
 │ 5  REVALIDATE, then return or redirect                                │
 │    fails when   you skip it        → the user sees a page that says   │
 │                                      their submission does not exist  │
 └───────────────────────────────────────────────────────────────────────┘
```

Two orderings are deliberate and both cost something.

**Rate limit before validate.** Parsing eleven fields is real CPU on an endpoint anyone can reach.
The cost: a user who is rate limited never learns their email was also malformed, so they fix one
problem at a time. That is the correct trade on a public endpoint and the wrong one on an internal
tool.

**Validate before authenticate.** This looks backwards next to Lesson 06.2 §3, where PHP
authenticates first. It is deliberate and the reason is different at each layer: WordPress is
protecting a database, so it refuses unknown callers before doing any work; the Server Action is
protecting a *form*, and a user whose 300-second access token expired while they typed should get
their field errors back along with "sign in again", not an empty form and a redirect. The cost: the
action parses input for callers it is about to reject. Step 1 already capped how often that can
happen.

### 5. Fail closed, argued rather than asserted

When the limiter cannot reach Redis, it has two options.

| | Fail **open** — allow the write | Fail **closed** — refuse the write |
|---|---|---|
| During an Upstash outage | the form works, unlimited | the form is down |
| An attacker who can degrade Redis | **has switched your rate limiting off** | has caused an outage, and gained nothing |
| Blast radius | your WordPress origin, unmetered | your submit form |
| Recovery | you find out from your database bill | you find out from a 500-rate alert in ten seconds |
| **Verdict** | ❌ | ✅ **this course** |

The argument in one sentence: **a limiter that opens when Redis is unreachable is a limiter an
attacker turns off by attacking Redis**, and Redis is a smaller, cheaper target than WordPress.

The cost, stated plainly: an Upstash outage takes your incident submission form and your Get Demo
form down, and neither of those failures is your code's fault. That is the trade you are choosing,
and it is only defensible because the WordPress-side limit in Key Concept 6 means the *application*
is still protected while the *form* is unavailable. If the Next-side limiter were the only one, the
honest answer would be to fail open and alert loudly.

> **Fail closed also means fail closed on a missing environment variable.** No
> `UPSTASH_REDIS_REST_URL` is indistinguishable from an unreachable one, and a developer who
> forgot to copy `.env.example` must not get an unlimited endpoint. Lesson 06.2's
> `require_app_token()` makes the same choice in PHP for the same reason: an empty expected
> token must not authenticate everybody.

### 6. Double enforcement, and which limiter is authoritative

Two limiters, and the interesting question is which one you would keep if forced to choose.

```
   Browser ──▶ Next.js Server Action ──────────────▶ WordPress /graphql
                    │                                     │
              limit(`incident:${ip}`)              require_submission_budget( user_id )
              Upstash, keyed on IP                 transient, keyed on USER
              runs BEFORE auth                     runs AFTER authorisation
              sheds load at the edge               ← THE AUTHORITATIVE ONE
                    ▲                                     ▲
                    │                                     │
              bypassed the moment              reachable only with a valid JWT,
              someone finds the origin          therefore never bypassed
```

The WordPress-side limit is authoritative because it is the one an attacker cannot route around.
And they will find the origin: appendix 04 §6 says so plainly — every media `sourceUrl` in every
GraphQL response is an absolute URL on the WordPress host. Keeping `WP_GRAPHQL_ENDPOINT` server-only
removes the endpoint from your client bundle and your app's own traffic. It is **not** obscurity as
security and this course does not pretend it is.

So the two limiters do different jobs, and their keys prove it:

| | Next-side | WordPress-side |
|---|---|---|
| Key | IP | user id |
| Runs | before authentication | after authorisation |
| Catches | a botnet hammering the form, before you pay for a GraphQL round trip | one authenticated reporter submitting forty incidents |
| Storage | Upstash Redis, shared across serverless instances | `wp_options` transient, or the object cache |
| Bypassed by | knowing the origin | nothing |
| If you had to delete one | delete this one | never delete this one |

An IP key cannot catch a single logged-in abuser behind a rotating mobile IP. A user-id key cannot
catch an unauthenticated flood, because there is no user yet. Neither is redundant.

### 7. The trust boundary at step 4, and what WordPress does with your payload

Step 4 sends WordPress a payload you have just validated in two layers. WordPress does not trust a
byte of it, and that is the design.

| Your action sends | WordPress does | Where |
|---|---|---|
| every field | re-validates independently: `sanitize_*`, `is_email`, ranges, `strtotime` | `mutation-create-incident.php` §3–§4 |
| a `Bearer` JWT | re-checks `create_incidents` with `current_user_can()` | §2 |
| nothing about status | **forces** `post_status = 'pending'` | the `wp_insert_post()` literal |
| nothing about the author | **forces** `post_author = get_current_user_id()` | the same array |
| `status: PUBLISH`, if you sent it | **discards it, always** | Lesson 06.2 §5 |
| `isVerified: true`, if you sent it | discards it unless the caller holds `edit_others_incidents` | §5, and appendix 03 §4.1 |
| `scapegoatSlug: "the-hacker"` | rejects it — the slug is shaped correctly and is not a term | `require_term_id()` |

> **A field being present in a GraphQL input type is not permission to set it.** The input type
> describes what the API will *parse*. The resolver decides what the API will *honour*, per caller.
> [Appendix 03 §4.1](../appendix/03-content-model-reference.md#41-incident-details) marks
> `is_verified` as the field that teaches this.

And the backstop underneath all of it: even a resolver that forgot the forced `pending` would not
publish, because `wp_insert_post()` downgrades the status itself when the author lacks
`publish_incidents` — and `incident_reporter` does not have it
([appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities)). Three
independent mechanisms, one outcome. The Verification block proves it with one `curl` carrying a
real reporter token and `status: PUBLISH` in the input.

Which is also why the role check in step 3 is labelled UX and not security. `session.roles` came
from WordPress a moment ago and is honest, but the code reading it runs on a machine an attacker can
skip. Lesson 15.5 made the same point about `guards.ts`.

One mechanical detail makes "surface its error" possible rather than aspirational, and it was
settled in Lesson 15.2. **Reads tolerate a partial response; writes do not.** Lesson 10.4's policy —
log the `errors` array, return whatever `data` arrived — is right for a query, where a page missing
one section still beats a page missing everything. It is wrong for a mutation: a WPGraphQL mutation
field is nullable, so a refused write arrives as `data: { createIncident: null }` **with** `errors`,
`data` is technically present, and the partial-response rule would hand the action a null payload
and put WordPress's actual sentence in a log nobody is reading.

So `fetchGraphQL` keeps the partial policy and **`fetchGraphQLAuthed` is strict**: any `errors`
entry becomes a thrown `GraphQLRequestError`. Note what that removes — **no call site chooses the
policy.** The function you call decides, so there is no `{ strict: true }` option to forget on the
one mutation that mattered.

| | `fetchGraphQL` | `fetchGraphQLAuthed` |
|---|---|---|
| Used for | reads | **writes** |
| `data` present, `errors` present | log, return the partial `data` | **throw `GraphQLRequestError`** |
| `data` null or absent | throw | throw |
| Chosen by | the function, not the call site | the function, not the call site |

The action therefore reads WordPress's refusal out of the exception with `isGraphQLRequestError()`
and `formatGraphQLErrors()` from Lesson 10.4's `src/lib/graphql/errors.ts`, and returns it as form
state. Those messages are safe to show by construction: Lesson 06.2 §8 fixed the set, and every one
is a single sentence with no path, plugin name, class name or SQL fragment in it. Anything that is
**not** a `GraphQLRequestError` — a timeout, a DNS failure, a proxy hanging up — gets a generic
message instead, because in that case there is no WordPress sentence to surface and an opaque
failure is the honest answer.

### 8. Step 5 is not housekeeping

Skip `revalidateTag` and nothing breaks. The write succeeds, the action returns, the user is told
"queued for review", they click through to their account, and the page tells them — convincingly,
with a rendered empty state and no error anywhere — that they have submitted nothing.

That is the worst class of bug in a cached application: **correct data, confidently wrong page, no
error to search for.**

What `submitIncident` actually invalidates is a decision, not a ritual, and the honest answer is
narrower than you would guess:

| Surface | Invalidate it? | Why |
|---|---|---|
| `/en/account` — the reporter's own submissions | **yes**, with `revalidatePath` | the data comes from `fetchGraphQLAuthed`, which is `cache: 'no-store'`, so there is no data-cache entry to expire — but the **browser's Router Cache** still holds the RSC payload it rendered two minutes ago |
| `/en/incidents` — the public list | **no** | the new incident is `pending` and therefore invisible. Expiring `incidents` would throw away a good cache entry to change nothing |
| the scapegoat term page | **no** | same reason; the term count does not include pending posts |
| all of the above, **on publish** | yes — and that is Module 18 | `transition_post_status` fires in WordPress, which is the only system that knows publication happened |

> **Tag names come from `src/lib/graphql/tags.ts` and are never hand-typed.** `listTag('incident')`
> returns `incidents`; the singular goes in and the plural comes out, and the one place that
> knows that is the module Lesson 10.3 wrote. A hand-typed `revalidateTag('incidents')` is correct
> today and silently wrong the day the convention changes. Which is also why step 5 for *this*
> action is `revalidatePath` and not `revalidateTag` at all: there is no `accountTag()` in
> `tags.ts`, and inventing one would be inventing a tag for data that was never cached. The module
> README's five-step table says the same thing in one line.

### 9. The credential, and why the type system now says so

`submitIncident` acts **as a user**. It has a session, and the write must be attributed to that
human. So it passes `{ kind: 'user', jwt }` and the JWT comes from the httpOnly cookie via
`readAccessToken()`.

Reaching for the app token here would be a serious bug that *works*:

```
{ kind: 'user', jwt }        Authorization: Bearer <jwt>
                             → is_user_logged_in() true, post_author = that reporter  ✅

{ kind: 'app' }              X-BTT-App-Token: <token>
                             → createIncident's step 1 refuses: "You must be signed in"  ✅
```

`createIncident` checks `is_user_logged_in()` first, so the app token simply fails — this time. The
reason it is worth a whole concept anyway is what happens on the *next* mutation somebody writes: an
app token proves "the Next.js application is calling", which is a claim with no user attached and no
capability limit. Substitute it into a mutation that does not check `is_user_logged_in()` and you
have an endpoint where every caller is effectively an administrator.

Lesson 15.2 made that substitution a **compile error** by turning `fetchGraphQLAuthed`'s third
parameter into a discriminated union. Note what `kind: 'app'` deliberately does not carry:

```ts
// (illustration) the union from Lesson 15.2 — src/lib/graphql/client.ts
export type Credential =
  | { readonly kind: 'user'; readonly jwt: string }   // Authorization: Bearer <jwt>
  | { readonly kind: 'app' };                         // X-BTT-App-Token, read from WP_APP_TOKEN
```

No token field. The function reads `WP_APP_TOKEN` from the environment itself, so an app token can
never arrive **from a call site** — and therefore never from a request, a form field or a client
component. Verification greps `src/actions/incidents.ts` for `kind: 'app'` and expects zero.

### 10. The `incident_submission_open` kill switch, and where it is checked

[Appendix 03 §4.5](../appendix/03-content-model-reference.md#45-site-settings-options-page) puts a
`incident_submission_open` true/false field on the Site Settings options page. It is a real kill
switch: flip it in wp-admin and public submission stops.

It is checked in the **Server Action**, not in the mutation, and Lesson 06.2 argued why in a comment
you can still read in `mutation-create-incident.php`:

> a mutation that fails closed when an ACF options page has never been saved takes the submission
> form down for a reason nobody can see

An unsaved ACF options page returns `null`, `null` is falsy, and a mutation treating that as
"closed" is a site-wide outage caused by an editor never having clicked Update. In the action the
same `null` is a rendering decision with a visible cause.

That also makes the switch a **content setting rather than an authorisation decision**, and the
distinction has a test: an authorisation decision must hold against a caller who skips your code, so
it belongs in PHP. A content setting only has to hold against your own UI. Turning the switch off
does not stop a determined reporter with a valid JWT from calling `createIncident` directly, and
that is fine — it was never meant to.

Lesson 16.4 wires it: `submitIncident` reads it and fails *politely*, and the submit page renders an
explanatory message instead of the form. This lesson builds the action without it, so that the wiring
arrives as one anchored edit you can read rather than a branch buried in a file you are meeting for
the first time.

---

## Task

### Step 1: Install the limiter and declare its two variables

```bash
cd next-app

npm install @upstash/redis @upstash/ratelimit
npm ls @upstash/redis @upstash/ratelimit
```

Both are MIT and neither pulls a native module, which matters because this code runs in a serverless
function. Check the licence before you add a dependency to a proprietary module — that is a policy,
not a preference.

Then the two variables. `.env.local` is gitignored; `.env.example` is tracked and gets **names
only**.

```bash
git check-ignore -v .env.local
# Expected: a .gitignore rule. NO OUTPUT MEANS STOP — appendix 04 §1 rule 2.
```

```dotenv
# next-app/.env.local  — GITIGNORED.
# Both values come from your Upstash database's "REST API" panel. Replace each
# placeholder with the real value; do not leave a placeholder in place, because
# the limiter treats a missing variable as "unavailable" and refuses every write.
UPSTASH_REDIS_REST_URL=__CHANGE_ME__
UPSTASH_REDIS_REST_TOKEN=__CHANGE_ME__
```

```dotenv
# next-app/.env.example  — TRACKED. Names and __CHANGE_ME__, never a value,
# not even a plausible-looking one (appendix 04 §1 rule 1).
UPSTASH_REDIS_REST_URL=__CHANGE_ME__
UPSTASH_REDIS_REST_TOKEN=__CHANGE_ME__
```

> **No Upstash account? Leave both unset and read on.** The limiter fails **closed**, so every
> submit is refused with `Submissions are temporarily unavailable.` — which is Key Concept 5
> behaving exactly as designed, and it is the first NEGATIVE check in the Verification block. You
> cannot complete Step 7's happy path without a real Redis, and the free tier is enough. What you
> must not do is add a fail-open branch to get past it.

**Verify §1:**

- [ ] `grep -c '__CHANGE_ME__' .env.example` increased by 2.
- [ ] `git status --short .env.local` prints nothing.

### Step 2: Write the limiter, with the fail-closed branch in plain sight

```ts
// next-app/src/lib/rate-limit.ts
// Per-IP rate limiting on Upstash Redis, used by every Server Action.
//
// NO `import 'server-only'` in this file, and the reason is the same one that
// keeps it off tags.ts and errors.ts (Lesson 12.2 §6): Module 12's runner
// executes in plain Node, where the `server-only` package throws, and this
// module has a unit test that must run there. It holds no endpoint and no
// credential of its own — UPSTASH_* are read from process.env and are not
// NEXT_PUBLIC_, so they are never inlined into a client bundle. Verification
// greps to prove no client component imports this file.
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/** Five writes per ten minutes per IP. Tuned for a form a human fills in. */
export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW = '10 m';

/** A verdict, not a boolean — the caller has to handle all three cases. */
export type LimitVerdict =
  | { readonly ok: true; readonly remaining: number }
  | { readonly ok: false; readonly reason: 'exceeded'; readonly retryAfterSeconds: number }
  | { readonly ok: false; readonly reason: 'unavailable' };

/**
 * The one method this module needs from a limiter. Declaring it ourselves is
 * what makes the unit test possible WITHOUT vi.mock — see rate-limit.test.ts.
 */
export interface RateLimitBackend {
  limit(key: string): Promise<{ success: boolean; remaining: number; reset: number }>;
}

/**
 * Wrap a backend in the fail-closed policy.
 *
 * `null` means "there is no backend", which happens when the environment
 * variables are absent. A misconfigured deployment must not get an unlimited
 * endpoint, so that case is `unavailable` too — exactly like
 * require_app_token()'s empty-token branch in Lesson 06.2.
 */
export function createRateLimiter(backend: RateLimitBackend | null): (key: string) => Promise<LimitVerdict> {
  return async function limitWith(key: string): Promise<LimitVerdict> {
    if (backend === null) {
      return { ok: false, reason: 'unavailable' };
    }

    try {
      const result = await backend.limit(key);

      if (result.success) {
        return { ok: true, remaining: result.remaining };
      }

      // `reset` is an epoch in milliseconds. Never return 0 — a client that
      // retries immediately is a client that gets refused immediately.
      return {
        ok: false,
        reason: 'exceeded',
        retryAfterSeconds: Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
      };
    } catch {
      // ── FAIL CLOSED ──────────────────────────────────────────────────
      // Redis is unreachable, or timed out, or returned nonsense. The write
      // is REFUSED. A limiter that opens here is a limiter an attacker turns
      // off by attacking Redis (Lesson 16.2 §5). Nothing is logged: the
      // caller's key is derived from an IP address (Lesson 16.3 §7).
      return { ok: false, reason: 'unavailable' };
    }
  };
}

let resolved: RateLimitBackend | null | undefined;

/** The real backend, built once, lazily, and never at import time. */
function upstashBackend(): RateLimitBackend | null {
  if (resolved !== undefined) {
    return resolved;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    resolved = null;

    return resolved;
  }

  const ratelimit = new Ratelimit({
    redis: new Redis({ url, token }),
    // A SLIDING window, not a fixed one: a fixed window lets a caller spend
    // the whole budget at 09:59:59 and the whole budget again at 10:00:01.
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW),
    prefix: 'btt:rl',
  });

  resolved = { limit: (key) => ratelimit.limit(key) };

  return resolved;
}

/** What every action calls. One key namespace per action, e.g. `incident:1.2.3.4`. */
export function limit(key: string): Promise<LimitVerdict> {
  return createRateLimiter(upstashBackend())(key);
}
```

**Verify §2:**

- [ ] `grep -c 'reason: .unavailable.' src/lib/rate-limit.ts` returns `3` — the null backend, the
      `catch`, and the type. If the `catch` returns `{ ok: true }`, you have written a fail-open
      limiter and the rest of this lesson is decoration.
- [ ] `grep -c "import 'server-only'" src/lib/rate-limit.ts` returns `0`, on purpose.
- [ ] `npm run type-check` is silent.

### Step 3: Test the Redis-is-down path

```ts
// next-app/src/lib/rate-limit.test.ts
// The fail-closed branch is the whole point of the module, and it is the branch
// you cannot reach by hand without breaking your own Redis.
import { describe, expect, it, vi } from 'vitest';

import { createRateLimiter, type RateLimitBackend } from '@/lib/rate-limit';

/**
 * Dependency injection, deliberately, rather than vi.mock('@upstash/redis').
 *
 * A vi.mock couples this test to the SDK's module shape: an Upstash release
 * that renames a class or moves an export breaks the test without breaking the
 * code, which is the definition of a test that costs more than it earns. A
 * hand-written backend couples the test to OUR RateLimitBackend interface,
 * which is one method wide and ours to keep stable. It also needs no runner
 * magic, so the test reads as ordinary code.
 */
function backend(impl: RateLimitBackend['limit']): RateLimitBackend {
  return { limit: impl };
}

describe('createRateLimiter', () => {
  it('allows a request the backend allows', async () => {
    const limit = createRateLimiter(backend(async () => ({ success: true, remaining: 4, reset: Date.now() + 60_000 })));

    await expect(limit('incident:1.2.3.4')).resolves.toEqual({ ok: true, remaining: 4 });
  });

  it('refuses with a retry-after when the bucket is empty', async () => {
    const limit = createRateLimiter(backend(async () => ({ success: false, remaining: 0, reset: Date.now() + 30_000 })));
    const verdict = await limit('incident:1.2.3.4');

    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: 'exceeded' });
    expect(verdict.ok === false && verdict.reason === 'exceeded' ? verdict.retryAfterSeconds : 0).toBeGreaterThan(25);
  });

  it('never returns a retry-after of zero, even for a reset in the past', async () => {
    const limit = createRateLimiter(backend(async () => ({ success: false, remaining: 0, reset: Date.now() - 5_000 })));
    const verdict = await limit('incident:1.2.3.4');

    expect(verdict).toEqual({ ok: false, reason: 'exceeded', retryAfterSeconds: 1 });
  });

  // ── THE ONE THAT MATTERS ────────────────────────────────────────────
  it('FAILS CLOSED when the backend rejects', async () => {
    const limit = createRateLimiter(
      backend(async () => {
        throw new Error('fetch failed');
      })
    );

    await expect(limit('incident:1.2.3.4')).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('fails closed when the backend rejects with something that is not an Error', async () => {
    const limit = createRateLimiter(backend(async () => Promise.reject('ECONNREFUSED')));

    await expect(limit('incident:1.2.3.4')).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('fails closed when there is NO backend, which is a missing env var', async () => {
    const limit = createRateLimiter(null);

    await expect(limit('incident:1.2.3.4')).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('passes the key through unchanged, so one action cannot spend another action budget', async () => {
    const seen = vi.fn(async () => ({ success: true, remaining: 4, reset: Date.now() + 60_000 }));
    const limit = createRateLimiter(backend(seen));

    await limit('lead:1.2.3.4');

    expect(seen).toHaveBeenCalledWith('lead:1.2.3.4');
  });
});
```

**Verify §3:**

- [ ] `npm test -- --run src/lib/rate-limit.test.ts` reports **7 passed**.
- [ ] Change the `catch` in `rate-limit.ts` to `return { ok: true, remaining: 0 }` and two tests go
      red. Put it back. That is the assertion earning its place.

### Step 4: Write `submitIncident` as the five numbered steps

```ts
// next-app/src/actions/incidents.ts
'use server';

// EVERY EXPORT IN THIS FILE IS A PUBLIC HTTP ENDPOINT (Lesson 16.2 §1).
// One action is exported. Everything else below has no `export` keyword, and
// that is a security decision, not a style one — Verification counts them.
import { revalidatePath, revalidateTag } from 'next/cache';
import { headers } from 'next/headers';

import { CreateIncidentDocument, IncidentTermOptionsDocument, type CreateIncidentInput } from '@/gql/graphql';
import { readAccessToken } from '@/lib/auth/cookies';
import { getSession } from '@/lib/auth/session';
import { fetchGraphQL, fetchGraphQLAuthed } from '@/lib/graphql/client';
import { formatGraphQLErrors, isGraphQLRequestError } from '@/lib/graphql/errors';
import { listTag, taxonomyListTag } from '@/lib/graphql/tags';
import { limit } from '@/lib/rate-limit';
import { refineTerms, type IncidentInput, type IncidentTermAllowlist } from '@/lib/validation/schemas';

/** Serialisable, because `useActionState` sends it across the wire (§2). */
export type IncidentFormState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'error';
      readonly message: string;
      readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
    }
  | { readonly status: 'success'; readonly slug: string; readonly title: string };

/**
 * The stored kebab-case ACF value → the GraphQL enum NAME on the wire.
 * Appendix 03 §3: enum values are SCREAMING_SNAKE, the ACF select values are
 * kebab, and the resolver maps between them. So the wire format is the enum.
 *
 * If your codegen emits TypeScript `enum`s rather than string unions, these
 * values are `IncidentEnvironment.Production` and friends. Check
 * src/gql/graphql.ts and use whichever your generator produced.
 */
const ENVIRONMENT: Record<IncidentInput['environment'], NonNullable<CreateIncidentInput['environment']>> = {
  production: 'PRODUCTION',
  staging: 'STAGING',
  development: 'DEVELOPMENT',
  'works-on-my-machine': 'WORKS_ON_MY_MACHINE',
};

const RESOLUTION: Record<IncidentInput['resolutionStatus'], NonNullable<CreateIncidentInput['resolutionStatus']>> = {
  open: 'OPEN',
  mitigated: 'MITIGATED',
  blamed: 'BLAMED',
  wontfix: 'WONTFIX',
};

/**
 * The caller's IP, for the rate-limit key.
 *
 * `x-forwarded-for` is set by the proxy in front of the app. It is trustworthy
 * on Vercel, where the platform overwrites it, and forgeable behind a proxy
 * that merely appends to it — so this is a load-shedding key, never an identity.
 * Locally the header is absent and every submit shares one bucket, which is
 * exactly why the limit is easy to observe in development.
 */
async function clientIp(): Promise<string> {
  const store = await headers();

  return store.get('x-forwarded-for')?.split(',')[0]?.trim() || store.get('x-real-ip') || '0.0.0.0';
}

/**
 * The term allowlist, from WordPress, at submit time.
 *
 * NOT from the form, and not hard-coded. `severity` is closed at four terms;
 * `scapegoat` is free-form and editors add to it, so a hard-coded list means a
 * content change needs a deploy. Cached for 60 seconds and tagged, so a term
 * deleted a moment ago is still accepted here for up to a minute — and then
 * refused by WordPress, which is the authority (Lesson 16.1 §5).
 */
async function termAllowlist(): Promise<IncidentTermAllowlist> {
  const data = await fetchGraphQL(IncidentTermOptionsDocument, undefined, {
    revalidate: 60,
    tags: [taxonomyListTag('scapegoat'), taxonomyListTag('severity')],
  });

  return {
    scapegoats: (data.scapegoats?.nodes ?? []).flatMap((n) => (n?.slug ? [n.slug] : [])),
    severities: (data.severities?.nodes ?? []).flatMap((n) => (n?.slug ? [n.slug] : [])),
  };
}

/**
 * Submit an incident for moderation.
 *
 * The five steps, in this order, with the numbers as comments. Module 23's
 * src/actions/incidents.test.ts imports this function by name.
 */
export async function submitIncident(
  _previous: IncidentFormState,
  formData: FormData
): Promise<IncidentFormState> {
  // ── 1. RATE LIMIT ──────────────────────────────────────────────────
  // Before parsing, because parsing eleven fields is real CPU on an endpoint
  // anybody can reach. Fails CLOSED (§5).
  const verdict = await limit(`incident:${await clientIp()}`);

  if (!verdict.ok) {
    return {
      status: 'error',
      message:
        verdict.reason === 'exceeded'
          ? `Too many submissions. Try again in ${verdict.retryAfterSeconds} seconds.`
          : 'Submissions are temporarily unavailable. Try again shortly.',
    };
  }

  // ── 2. VALIDATE ────────────────────────────────────────────────────
  // safeParse, never parse: a throw here becomes a generic error boundary and
  // the user loses eleven fields of typing (Lesson 16.1 §6).
  const parsed = refineTerms(await termAllowlist()).safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Check the fields below.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const input = parsed.data;

  // ── 3. AUTHENTICATE, then AUTHORISE ────────────────────────────────
  const session = await getSession();

  if (!session.isLoggedIn) {
    // Deliberately NOT a redirect. The 300-second access token can expire
    // while somebody fills in a long form, and a redirect would throw their
    // answers away. 15.5's route guard already stopped the anonymous case
    // from ever rendering this form.
    return { status: 'error', message: 'Your session expired. Sign in again in another tab, then submit.' };
  }

  const jwt = await readAccessToken();

  if (jwt === null) {
    return { status: 'error', message: 'Your session expired. Sign in again in another tab, then submit.' };
  }

  // A UX check, NOT a security boundary. `session.roles` is honest — it came
  // from WordPress — but this code runs on a machine an attacker can skip.
  // The enforcement is current_user_can('create_incidents') in PHP (§7).
  if (!session.roles.some((role) => role === 'incident_reporter' || role === 'editor' || role === 'administrator')) {
    return { status: 'error', message: 'Your account is not allowed to submit incidents.' };
  }

  // ── 4. CALL WORDPRESS ──────────────────────────────────────────────
  // { kind: 'user', jwt } — never the app token. Lesson 15.2 made the wrong
  // one a compile error (§9).
  try {
    const data = await fetchGraphQLAuthed(
      CreateIncidentDocument,
      {
        input: {
          title: input.title,
          body: input.body,
          scapegoatSlug: input.scapegoatSlug,
          severitySlug: input.severitySlug,
          occurredAt: input.occurredAt,
          downtimeMinutes: input.downtimeMinutes,
          estimatedCostUsd: input.estimatedCostUsd,
          environment: ENVIRONMENT[input.environment],
          resolutionStatus: RESOLUTION[input.resolutionStatus],
          blameConfidence: input.blameConfidence,
          stackTrace: input.stackTrace,
          reporterDisplayName: input.reporterDisplayName,
          // NOT SENT: `status` and `isVerified`. They are in the input type and
          // WordPress discards them (§7). Not sending them is not a control —
          // it is honesty about what this caller is asking for.
        },
      },
      { kind: 'user', jwt }
    );

    const incident = data.createIncident?.incident;

    if (!incident?.slug) {
      // Defensive only. A REFUSAL never reaches this line: Lesson 15.2 made
      // fetchGraphQLAuthed strict, so any `errors` entry is thrown and handled
      // in the catch below. A null payload with NO errors would be a WordPress
      // bug rather than a rejection, and there is no message to surface for it.
      return { status: 'error', message: 'WordPress returned no incident. Nothing was saved.' };
    }

    // ── 5. REVALIDATE, then return ───────────────────────────────────
    // The new incident is `pending`, so NO public page changes and the public
    // list tag is deliberately left alone (§8). What is stale is the browser's
    // Router Cache entry for the reporter's own account page.
    revalidatePath(`/${input.locale}/account`);

    // Named for the reader: this is the tag Module 18's webhook expires when an
    // editor publishes. It is NOT expired here, and that is the decision.
    void listTag('incident');

    return { status: 'success', slug: incident.slug, title: input.title };
  } catch (error) {
    if (isGraphQLRequestError(error)) {
      // WORDPRESS SPOKE. Lesson 15.2 made fetchGraphQLAuthed strict — writes do
      // not tolerate a partial response — so a UserError from
      // create_incident_payload() arrives here rather than as a null payload.
      // Surface its own wording: Lesson 06.2 §8 fixed the message set, and
      // every one is a single safe sentence. "Too many submissions. Try again
      // later." is worth ten times a generic string to the person reading it.
      return { status: 'error', message: formatGraphQLErrors(error.errors) };
    }

    // NOT a GraphQL failure: a timeout, a DNS failure, a proxy hanging up.
    // There is no WordPress sentence to surface, so the caller gets an opaque
    // one — and `error` is deliberately not logged here, because a fetch error
    // object can carry the request options and those carry a Bearer token.
    return {
      status: 'error',
      message: 'We could not reach the moderation queue. Nothing was saved — try again shortly.',
    };
  }
}
```

> **`void listTag('incident')` is a comment with a type check.** It documents which tag *would* be
> expired, and `npm run type-check` fails if `tags.ts` ever renames the helper — which a prose
> comment would not. If it offends you, delete it and put the sentence in the comment; what you must
> not do is call `revalidateTag` on a tag whose data did not change.

**Verify §4:**

- [ ] `grep -cE '^export ' src/actions/incidents.ts` returns `2`: one `async function` and one
      `type`. A type is erased at build time and is not an endpoint.
- [ ] `grep -cE '^export (async )?function ' src/actions/incidents.ts` returns `1`.
- [ ] The five `// ── N.` comments appear in order 1, 2, 3, 4, 5. If a number is missing, so is a
      step.
- [ ] `grep -c "kind: 'user'" src/actions/incidents.ts` returns `1`;
      `grep -c "kind: 'app'" src/actions/incidents.ts` returns `0`.

### Step 5: Add the mutation document and regenerate

```graphql
# next-app/src/graphql/incidents.graphql — append
# `status` is a String on the way OUT, carrying the raw post_status (`pending`).
# The INPUT `status` field is PostStatusEnum, is accepted, and is always
# discarded — Lesson 06.2 §5. Selecting the output field is how the
# Verification block proves it.
mutation CreateIncident($input: CreateIncidentInput!) {
  createIncident(input: $input) {
    incident {
      databaseId
      slug
      title
      status
    }
  }
}
```

```bash
cd next-app
npm run codegen
npm run type-check
```

**Verify §5:**

- [ ] `grep -c 'CreateIncidentDocument' src/gql/graphql.ts` returns `1` or more.
- [ ] `grep -c 'CreateIncidentInput' src/gql/graphql.ts` returns `1` or more. If the type is absent,
      Lesson 06.2 Step 1's `graphql_exclude_mutations` removed the generated mutation and its input
      type without your custom one replacing it — re-check the plugin loaded.

### Step 6: Write the form

`Textarea` is not one of the nine shadcn components Lesson 11.2 generated, and this lesson does not
add it: two `<textarea>` elements with the same classes as `Input` do not justify another file in
`src/components/ui/` you then own forever. If you disagree, `npx shadcn@latest add textarea` is one
command and nothing else changes.

```tsx
// next-app/src/components/incidents/IncidentSubmitForm.tsx
'use client';

import { useActionState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { submitIncident, type IncidentFormState } from '@/actions/incidents';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { incidentSchema, type IncidentInput } from '@/lib/validation/schemas';

export type TermOption = { readonly slug: string; readonly name: string };

const INITIAL: IncidentFormState = { status: 'idle' };

const ENVIRONMENTS: readonly TermOption[] = [
  { slug: 'production', name: 'Production' },
  { slug: 'staging', name: 'Staging' },
  { slug: 'development', name: 'Development' },
  { slug: 'works-on-my-machine', name: 'Works on my machine' },
];

export function IncidentSubmitForm({
  locale,
  scapegoats,
  severities,
  reporterDisplayName,
}: {
  readonly locale: string;
  // The SAME lists the action validates against, fetched by the page. Two
  // fetches, not one: the form's copy is for rendering and the action's copy is
  // for deciding, and a value the browser sends is never the allowlist.
  readonly scapegoats: readonly TermOption[];
  readonly severities: readonly TermOption[];
  readonly reporterDisplayName: string;
}) {
  const [state, formAction, isPending] = useActionState(submitIncident, INITIAL);

  const form = useForm<IncidentInput>({
    resolver: zodResolver(incidentSchema),
    mode: 'onBlur',
    defaultValues: {
      title: '',
      body: '',
      scapegoatSlug: '',
      severitySlug: '',
      occurredAt: '',
      downtimeMinutes: '' as unknown as number,
      estimatedCostUsd: '' as unknown as number,
      environment: 'production',
      resolutionStatus: 'open',
      blameConfidence: '73' as unknown as number,
      stackTrace: '',
      reporterDisplayName,
      locale: locale as IncidentInput['locale'],
    },
  });

  // One path to a visible error, whichever layer produced it (Lesson 16.1 §8).
  useEffect(() => {
    if (state.status !== 'error' || !state.fieldErrors) {
      return;
    }

    const entries = Object.entries(state.fieldErrors) as [keyof IncidentInput, readonly string[] | undefined][];

    for (const [name, messages] of entries) {
      if (messages?.[0]) {
        form.setError(name, { type: 'server', message: messages[0] });
      }
    }

    const first = entries.find(([, messages]) => Boolean(messages?.[0]));

    if (first) {
      form.setFocus(first[0]);
    }
  }, [state, form]);

  if (state.status === 'success') {
    return (
      <div className="mt-8 rounded-lg border border-border bg-card p-6">
        <h2 className="text-xl font-semibold tracking-tight">Queued for review</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          “{state.title}” is waiting for a moderator. It is not public yet, and you will get an email when its
          status changes.
        </p>
      </div>
    );
  }

  return (
    <Form {...form}>
      {/* No onSubmit. The browser submits this natively with JavaScript off,
          and step 2 of the action is the boundary either way (16.1 §9). */}
      <form action={formAction} className="mt-8 space-y-6">
        <input type="hidden" name="locale" value={locale} />

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>What happened</FormLabel>
              <FormControl>
                <Input maxLength={200} {...field} />
              </FormControl>
              <FormDescription>One sentence, 200 characters or fewer.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="body"
          render={({ field }) => (
            <FormItem>
              <FormLabel>The full story</FormLabel>
              <FormControl>
                <textarea
                  rows={6}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="scapegoatSlug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Who is to blame</FormLabel>
                {/* Radix Select renders a listbox, not a <select>, so it needs a
                    real <input name> beside it for the no-JavaScript POST. */}
                <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a scapegoat" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {[...scapegoats]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((term) => (
                        <SelectItem key={term.slug} value={term.slug}>
                          {term.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="severitySlug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>How bad</FormLabel>
                <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a severity" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {severities.map((term) => (
                      <SelectItem key={term.slug} value={term.slug}>
                        {term.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="occurredAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>When it happened</FormLabel>
                <FormControl>
                  <Input type="datetime-local" {...field} />
                </FormControl>
                <FormDescription>Not the future. WordPress checks this too.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="environment"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Environment</FormLabel>
                <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ENVIRONMENTS.map((option) => (
                      <SelectItem key={option.slug} value={option.slug}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="downtimeMinutes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Downtime (minutes)</FormLabel>
                <FormControl>
                  <Input type="number" inputMode="numeric" min={0} max={100000} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="estimatedCostUsd"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Estimated cost (USD)</FormLabel>
                <FormControl>
                  <Input type="number" inputMode="decimal" min={0} {...field} />
                </FormControl>
                <FormDescription>Optional. Leave it empty if you would rather not guess.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="blameConfidence"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Blame confidence</FormLabel>
                <FormControl>
                  <Input type="number" min={0} max={100} {...field} />
                </FormControl>
                <FormDescription>0 to 100. The default is 73.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="stackTrace"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Stack trace</FormLabel>
              <FormControl>
                <textarea
                  rows={5}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  {...field}
                />
              </FormControl>
              <FormDescription>Optional. Rendered escaped inside a code block, never as HTML.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <input type="hidden" name="reporterDisplayName" value={reporterDisplayName} />
        <input type="hidden" name="resolutionStatus" value="open" />

        {state.status === 'error' ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {state.message}
          </p>
        ) : null}

        <Button type="submit" variant="blame" size="xl" disabled={isPending}>
          {isPending ? 'Submitting…' : 'Submit for review'}
        </Button>
      </form>
    </Form>
  );
}
```

**Verify §6:**

- [ ] `grep -c 'preventDefault' src/components/incidents/IncidentSubmitForm.tsx` returns `0`.
- [ ] Each `Select` has a `name={field.name}`. Without it the Radix listbox posts nothing and the
      no-JavaScript path submits an empty scapegoat.

### Step 7: Replace the submit page body, keeping Lesson 15.5's guard

```tsx
// next-app/src/app/[locale]/incidents/submit/page.tsx
// Rebuilt in Lesson 16.2. The GUARD is Lesson 15.5's and is unchanged: it is a
// UX redirect, not the security boundary, and the boundary is
// current_user_can('create_incidents') in PHP.
import { IncidentTermOptionsDocument } from '@/gql/graphql';
import { requireCapability } from '@/lib/auth/guards';
import { IncidentSubmitForm } from '@/components/incidents/IncidentSubmitForm';
import { fetchGraphQL } from '@/lib/graphql/client';
import { taxonomyListTag } from '@/lib/graphql/tags';

export default async function SubmitIncidentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  // Anonymous → 307 to /{locale}/login?next=/{locale}/incidents/submit.
  const session = await requireCapability(locale, `/${locale}/incidents/submit`, 'incident_reporter');

  const terms = await fetchGraphQL(IncidentTermOptionsDocument, undefined, {
    revalidate: 60,
    tags: [taxonomyListTag('scapegoat'), taxonomyListTag('severity')],
  });

  const options = (nodes: ReadonlyArray<{ slug?: string | null; name?: string | null } | null> | null | undefined) =>
    (nodes ?? []).flatMap((node) => (node?.slug && node.name ? [{ slug: node.slug, name: node.name }] : []));

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Submit an incident</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Every submission is reviewed by a moderator before it appears. Nothing you send here is published
        automatically — your account has no publishing capability at all.
      </p>

      <IncidentSubmitForm
        locale={locale}
        scapegoats={options(terms.scapegoats?.nodes)}
        severities={options(terms.severities?.nodes)}
        reporterDisplayName={session.displayName}
      />
    </main>
  );
}
```

### Step 8: Add the authoritative limit in WordPress, and write the skeleton down

Two anchored edits to `mutation-create-incident.php`. First the helper, next to
`require_past_datetime()`:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/mutation-create-incident.php
/** Five submissions per ten minutes per user. Lesson 16.2 §6. */
const SUBMISSION_LIMIT  = 5;
const SUBMISSION_WINDOW = 600;

/**
 * The AUTHORITATIVE rate limit.
 *
 * The Next.js limiter (src/lib/rate-limit.ts) is keyed on IP, runs before
 * authentication, and sheds load at the edge. It is also bypassed the moment
 * somebody finds this origin, which every media sourceUrl in every response
 * makes inevitable (appendix 04 §6). This one is keyed on the USER, runs after
 * authorisation, and cannot be routed around.
 *
 * set_transient() RESETS the expiry, so the window SLIDES forward on every
 * hit rather than staying fixed: a reporter who submits four times every nine
 * minutes never returns to zero. That is acceptable here — the goal is to
 * blunt a burst, not to bill anyone — and a fixed window would need a stored
 * start timestamp. With a persistent object cache a transient can also be
 * evicted early, so this is best-effort by construction. Say which one you
 * built; never let a reader assume the other.
 *
 * @throws \GraphQL\Error\UserError When the budget is spent.
 */
function require_submission_budget( int $user_id ): void {
	$key  = 'btt_ci_' . $user_id;
	$hits = (int) get_transient( $key );

	if ( $hits >= SUBMISSION_LIMIT ) {
		throw new UserError( __( 'Too many submissions. Try again later.', 'blame-the-tech-core' ) );
	}

	set_transient( $key, $hits + 1, SUBMISSION_WINDOW );
}
```

Then the call, inside `create_incident_payload()`, immediately after the `current_user_can`
block and **before** the first `sanitize_*` call:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/mutation-create-incident.php
	// ── 2b. RATE LIMIT ─────────────────────────────────────────────────
	// After authorisation, because the key is the user id. Lesson 16.2 §6.
	require_submission_budget( get_current_user_id() );

	// ── 3. SANITISE ────────────────────────────────────────────────────
```

Then the written notes.

```markdown
<!-- docs/api-contract.md — append -->
## Server Actions — the five-step skeleton (Lesson 16.2)

Every Server Action in this application is these five steps, in this order, with the numbers as
comments. If an action skips a step, the skip is a bug, and a reviewer must be able to see the
gap by reading the comments.

| # | Step | Failure mode | Response |
|---|---|---|---|
| 1 | `limit(key)` by IP | Redis unreachable | **fail closed** — refuse the write |
| 2 | `schema.safeParse(formData)` | invalid input | typed field errors. **Never `throw`** |
| 3 | `getSession()` then the capability read | no session / wrong role | error state, not a redirect — a redirect loses the input |
| 4 | `fetchGraphQLAuthed(..., credential)` | WordPress disagrees | surface it. WordPress is the authority |
| 5 | `revalidatePath` / `revalidateTag`, then return | stale page | tag names come from `src/lib/graphql/tags.ts`, never hand-typed |

Step 5 is a decision, not a ritual. `submitIncident` creates a `pending` post, so no public page
changes and the `incidents` list tag is deliberately **not** expired; what is stale is the Router
Cache entry for `/{locale}/account`. Module 18's webhook expires the public tags at the moment
publication actually happens.

## Reads tolerate a partial response; writes do not (Lesson 15.2)

Lesson 10.4's policy — log the `errors` array, return whatever `data` arrived — is right for a
query and wrong for a mutation. A WPGraphQL mutation field is nullable, so a refused write arrives
as `data: { createIncident: null }` **with** `errors`; `data` is technically present, so the
partial-response rule would return a null payload and leave WordPress's own sentence in a log.

| | `fetchGraphQL` | `fetchGraphQLAuthed` |
|---|---|---|
| Used for | reads | writes |
| `data` present, `errors` present | log, return partial `data` | **throw `GraphQLRequestError`** |
| `data` null or absent | throw | throw |

**No call site chooses the policy.** The function you call decides, so there is no option to forget
on the one mutation where it mattered. Lesson 15.2 wrote the split into `client.ts` as an
`execute()` policy parameter that only those two wrappers set.

Every action therefore ends with the same catch:

| Thrown | Response |
|---|---|
| `GraphQLRequestError` | `formatGraphQLErrors(error.errors)` — **WordPress's own wording**, safe by construction because Lesson 06.2 §8 fixed the message set to single sentences with no path, plugin, class or SQL in them |
| anything else | a generic sentence. A timeout has no WordPress message, and an opaque failure is the honest answer |

The error object itself is never logged or serialised: a `fetch` error can carry the request
options, and those carry a Bearer token or the app token.

## Entry points added in Module 16

Add these rows to the entry-point matrix Lesson 15.5 put in `docs/quality-gates.md`:

| Entry point | AuthN | AuthZ | Validation | Rate limit | CSRF |
|---|---|---|---|---|---|
| `submitIncident` (action) | session cookie → `{ kind: 'user', jwt }` | `create_incidents` **in PHP**; the role read in the action is UX | `refineTerms(...).safeParse`, then PHP re-validates | Upstash per IP (fail closed) **plus** a per-user transient in PHP | Next Origin/Host on action POSTs + `SameSite` |
```

**Verify §8:**

- [ ] `docker compose logs --tail=40 wordpress` shows no fatal after the edit. A duplicate `const`
      declaration means you pasted the helper twice.
- [ ] `grep -c 'require_submission_budget' includes/graphql/mutation-create-incident.php` returns
      `2` — one declaration, one call.
- [ ] The call sits **after** `current_user_can( 'create_incidents' )` and **before** the first
      `sanitize_text_field`. Before the capability check there is no user id to key on.

---

## Verification

```bash
cd wordpress-headless

# 0. One shell session. Nothing here goes into a dotfile.
export WORDPRESS_DB_PASSWORD="$(grep -E '^WORDPRESS_DB_PASSWORD=' .env | cut -d= -f2-)"
export BTT_REPORTER_PASSWORD='<the value the seeder used — from your password manager>'
test -n "$BTT_REPORTER_PASSWORD" && echo 'reporter password loaded' || echo 'MISSING — appendix 04 §2'
# Expected: reporter password loaded

# 1. Baseline. Every count below is a DELTA against this number.
BEFORE=$(docker compose run --rm -T wpcli wp post list --post_type=incident --format=count | tr -d '\r')
echo "incidents before: $BEFORE"
# Expected: 40 on a freshly seeded database

# 2. Submit one through the browser: sign in at http://localhost:3000/en/login as
#    `reporter`, go to http://localhost:3000/en/incidents/submit, fill the form,
#    submit. You should see "Queued for review".
docker compose run --rm wpcli wp post list --post_type=incident --post_status=pending --format=count
# Expected: 1
docker compose run --rm wpcli wp post list --post_type=incident --format=count
# Expected: BEFORE + 1

# 3. Both suites, including the new spec
cd ../next-app && npm test -- --run
# Expected: 0 failed, and rate-limit.test.ts contributing 7 tests
npm run type-check && npm run lint
# Expected: no output from either
cd ../wordpress-headless

# 4. NEGATIVE — an empty submit returns typed field errors and writes nothing.
#    Submit the form with every field blank. Each field shows a message under it.
docker compose run --rm wpcli wp post list --post_type=incident --format=count
# Expected: unchanged from check 2. Validation ran before anything was written.

# 5. NEGATIVE — a 201-character title is refused. Paste 201 characters into the
#    title and submit.
docker compose run --rm wpcli wp post list --post_type=incident --format=count
# Expected: still unchanged. The bound is 200 in schemas.ts AND in
#           mutation-create-incident.php, and the second one is the control.

# 6. NEGATIVE — anonymous cannot reach the form, and cannot reach the mutation.
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/en/incidents/submit
# Expected: 307 http://localhost:3000/en/login?next=/en/incidents/submit
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"mutation($i:CreateIncidentInput!){createIncident(input:$i){incident{databaseId}}}",
       "variables":{"i":{"title":"Anon probe 162","scapegoatSlug":"the-intern","severitySlug":"s2-major",
                         "occurredAt":"2024-01-01 10:00:00","downtimeMinutes":10,"environment":"PRODUCTION"}}}' \
  | jq -r '.errors[0].message'
# Expected: You must be signed in to submit an incident.
#           A GraphQL refusal arrives with HTTP 200 and an `errors` array — read
#           `.errors`, never the status code.

# 7. NEGATIVE — THE ONE THAT MATTERS. A real reporter Bearer token, straight at
#    /graphql, asking for PUBLISH and isVerified true. This bypasses your form,
#    your Zod schema and your Server Action entirely.
JWT=$(curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "{\"query\":\"mutation{login(input:{username:\\\"reporter\\\",password:\\\"$BTT_REPORTER_PASSWORD\\\"}){authToken}}\"}" \
  | jq -r '.data.login.authToken')
test "$JWT" != null && echo 'jwt issued' || echo 'LOGIN FAILED — check BTT_REPORTER_PASSWORD'
# Expected: jwt issued

curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $JWT" \
  -d '{"query":"mutation($i:CreateIncidentInput!){createIncident(input:$i){incident{databaseId slug status}}}",
       "variables":{"i":{"title":"Forced status probe 162","scapegoatSlug":"the-intern","severitySlug":"s1-catastrophic",
                         "occurredAt":"2024-06-01 09:00:00","downtimeMinutes":42,"environment":"WORKS_ON_MY_MACHINE",
                         "status":"PUBLISH","isVerified":true}}}' \
  | jq '.data.createIncident.incident'
# Expected: an object whose `status` is "pending". In NO case "publish".

ID=$(docker compose run --rm -T wpcli wp post list --post_type=incident \
  --title='Forced status probe 162' --field=ID --format=ids | tr -d '\r')
docker compose run --rm wpcli wp post get "$ID" --field=post_status
# Expected: pending   ← the client asked for PUBLISH and PHP did not listen
docker compose run --rm wpcli wp post meta get "$ID" is_verified
# Expected: empty or 0   ← the client sent true and it was discarded
docker compose run --rm wpcli wp post get "$ID" --field=post_author
# Expected: the reporter's user id, not 0 and not the administrator's

# 8. NEGATIVE — fail closed. Point the limiter at a host that does not exist and
#    the action must REFUSE, not allow. Copy the file first; never revert a file
#    from git in a verification block.
cd ../next-app
cp .env.local /tmp/btt-env-local.bak
sed -i.orig 's#^UPSTASH_REDIS_REST_URL=.*#UPSTASH_REDIS_REST_URL=https://127.0.0.1:1#' .env.local
rm -f .env.local.orig
#    Restart `npm run dev` so the new value is read, then submit a VALID incident.
#    Expected in the browser: "Submissions are temporarily unavailable."
cd ../wordpress-headless && docker compose run --rm wpcli wp post list --post_type=incident --format=count
# Expected: unchanged. A fail-OPEN limiter would have written the post.
cd ../next-app && cp /tmp/btt-env-local.bak .env.local && rm /tmp/btt-env-local.bak
#    Restart `npm run dev` again.

# 9. NEGATIVE — the WordPress-side limit still bites with the Next limiter out of
#    the picture. Six rapid calls with the same token; the sixth is refused.
cd ../wordpress-headless
for i in 1 2 3 4 5 6; do
  curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $JWT" \
    -d "{\"query\":\"mutation(\$i:CreateIncidentInput!){createIncident(input:\$i){incident{databaseId}}}\",
         \"variables\":{\"i\":{\"title\":\"Burst probe $i\",\"scapegoatSlug\":\"dns\",\"severitySlug\":\"s4-cosmetic\",
                              \"occurredAt\":\"2024-06-01 09:00:00\",\"downtimeMinutes\":1,\"environment\":\"STAGING\"}}}" \
    | jq -r '.errors[0].message // "created"'
done
# Expected: created, created, created, created, created, Too many submissions. Try again later.
#           SUBMISSION_LIMIT is 5, and this path never touched Upstash.

# 9b. NEGATIVE — WordPress'S OWN WORDING reaches the form. Two halves.
#
#     (a) The SHAPE. A 201-character title, straight at /graphql with the
#         reporter token, bypassing your form and your Zod schema entirely:
LONG=$(printf 'x%.0s' $(seq 1 201))
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $JWT" \
  -d "{\"query\":\"mutation(\$i:CreateIncidentInput!){createIncident(input:\$i){incident{slug}}}\",
       \"variables\":{\"i\":{\"title\":\"$LONG\",\"scapegoatSlug\":\"dns\",\"severitySlug\":\"s4-cosmetic\",
                            \"occurredAt\":\"2024-06-01 09:00:00\",\"downtimeMinutes\":1,\"environment\":\"STAGING\"}}}" \
  | jq -c '{message: .errors[0].message, payload: .data.createIncident}'
# Expected: {"message":"The title is too long.","payload":null}
#           Read that twice. `errors` is populated AND `data` is present,
#           carrying a null. Lesson 10.4's partial-response policy would hand an
#           action that null and log the sentence; Lesson 15.2's STRICT policy on
#           fetchGraphQLAuthed turns it into a thrown GraphQLRequestError, which
#           is why the catch in step 4 has a message to return at all.
#
#     (b) The FORM. An over-long title cannot demonstrate this through the UI,
#         because step 2 refuses it first — which is the design, not a gap. So
#         use a refusal only WordPress can produce: the per-user transient limit
#         from Step 8. Check 9 just spent the budget, so submit a VALID incident
#         through http://localhost:3000/en/incidents/submit now.
# Expected in the browser: "Too many submissions. Try again later."
#           That is PHP's string, from mutation-create-incident.php, rendered in
#           the form-level <p role="alert">. A generic "something went wrong"
#           here would be a support ticket instead of an answer.
docker compose run --rm wpcli wp transient delete --all
# Expected: Success — resets the window so the rest of the block behaves

# 10. NEGATIVE — the app token appears nowhere in this action, and neither does
#     a hand-typed cache tag.
cd ../next-app
grep -c "kind: 'app'" src/actions/incidents.ts
# Expected: 0
grep -cE "revalidateTag\('" src/actions/incidents.ts
# Expected: 0 — every tag comes from src/lib/graphql/tags.ts

# 11. NEGATIVE — the export count IS the endpoint count. Every exported function
#     in a 'use server' file is a public HTTP endpoint, so this grep is a
#     security check: a number larger than 1 means you shipped an endpoint you
#     did not design.
grep -cE '^export (async )?function ' src/actions/incidents.ts
# Expected: 1
grep -cE '^export const ' src/actions/incidents.ts
# Expected: 0
grep -c "'use server'" src/actions/incidents.ts
# Expected: 1

# 12. NEGATIVE — the limiter is not reachable from the client, and holds no
#     NEXT_PUBLIC_ secret.
grep -rl 'rate-limit' src/components/ | wc -l
# Expected: 0
npm run build && grep -rl "$UPSTASH_REDIS_REST_TOKEN" .next/static/ 2>/dev/null | wc -l
# Expected: 0

# 13. Clean up the probes and confirm the count returns to where it started
cd ../wordpress-headless
for t in 'Forced status probe 162' 'Burst probe 1' 'Burst probe 2' 'Burst probe 3' 'Burst probe 4' 'Burst probe 5'; do
  PID=$(docker compose run --rm -T wpcli wp post list --post_type=incident --title="$t" --field=ID --format=ids | tr -d '\r')
  test -n "$PID" && docker compose run --rm wpcli wp post delete "$PID" --force
done
docker compose run --rm wpcli wp transient delete --all
# Expected: Success — and the per-user submission window is reset with it
git status --short
# Expected: no .env or .env.local anywhere in the output
```

Checks 7, 8, 9 and 11 are the four that define this lesson: WordPress re-validates and
re-authorises a caller who skipped every layer you wrote, the limiter refuses rather than allows
when it cannot see Redis, the authoritative limit is the one in PHP, and the number of endpoints you
shipped is the number you meant to. Check 9b is the one that makes step 4's "WordPress is the
authority" line mean something to a user rather than only to a reviewer.

## Control Questions

1. A colleague adds `export function toEnumName(kebab: string)` to `src/actions/incidents.ts`
   because two actions need it. Describe what they have just deployed, write the grep that finds it,
   and say where the function should live instead.
2. `submitIncident` rate limits **before** it validates, while `create_incident_payload()` in PHP
   authenticates before it does anything at all. Explain why the two orderings are both correct,
   and name the concrete cost of each choice.
3. The Next-side limiter is keyed on IP and the WordPress-side limiter is keyed on user id. Give one
   abuse pattern each one catches and the other misses, and say which one you would keep if you
   could only have one.
4. Change the `catch` in `rate-limit.ts` to return `{ ok: true, remaining: 0 }`. Name the two tests
   that go red, then describe the attack that becomes available and why Redis is the cheaper target.
5. `submitIncident` calls `revalidatePath` for `/{locale}/account` and deliberately does **not**
   expire the `incidents` list tag. Justify both halves, then say what would go wrong if you expired
   the list tag on every submission instead.

## Learn More

- [React: `'use server'`](https://react.dev/reference/rsc/use-server) — read the security section
  twice; it states Key Concept 1's consequence in React's own words
- [React: `useActionState`](https://react.dev/reference/react/useActionState) — the signature, and
  why the previous state is the first argument
- [Next.js: updating data with server functions](https://nextjs.org/docs/app/getting-started/mutating-data) —
  forms, pending states and the redirect-versus-return decision
- [Next.js: `serverActions.allowedOrigins`](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions) —
  the configuration behind the Origin/Host check Lesson 15.5's matrix relies on
- [Next.js: `revalidateTag`](https://nextjs.org/docs/app/api-reference/functions/revalidateTag) —
  and `revalidatePath` beside it, which is the one this action actually needs
- [`@upstash/ratelimit`](https://upstash.com/docs/redis/sdks/ratelimit-ts/overview) — the algorithms,
  and the reason `slidingWindow` beats `fixedWindow` for a form
- [WordPress: the Transients API](https://developer.wordpress.org/apis/transients/) — read the
  "Transients are not guaranteed to persist" note, which is why Step 8's helper says best-effort
- [OWASP: Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/) — the
  category an unexported-by-accident action falls into
- [OWASP: Denial of Service cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html) —
  the fail-open versus fail-closed argument, generalised beyond rate limiting
