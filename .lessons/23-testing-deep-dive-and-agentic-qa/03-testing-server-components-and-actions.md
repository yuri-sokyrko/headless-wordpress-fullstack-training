---
title: 'Testing Server Components & Actions'
module: 23
lesson: 3
teaches: [rsc-testing-rule, vi-mock-next-cache, vi-mock-next-headers, server-action-tests, route-handler-tests, negative-assertions]
produces: ['next-app/src/actions/incidents.test.ts', 'next-app/src/actions/auth.test.ts', 'next-app/src/app/api/auth/refresh/route.test.ts', 'next-app/src/app/api/revalidate/route.test.ts', 'next-app/src/lib/incidents/submission.ts', 'next-app/src/lib/incidents/submission.test.ts']
requires: [23.2, 16.2, 15.3]
---

# Lesson 23.3 — Testing Server Components & Actions

## Quick Overview

Server Actions and route handlers are where the security of this application lives, so they are
the code most worth testing — and they are testable, unlike the components that call them. A
Server Action is an exported async function that takes a `FormData` and returns a result. You can
import it in Vitest and call it. What you cannot do is let it reach the real `next/cache` and
`next/headers`, so you replace those two modules: `vi.mock('next/cache')` gives you a spy on
`revalidateTag` that lets you assert *which tag* was purged, and `vi.mock('next/headers')` gives
you a controllable `cookies()` so you can present a session, present a bad session, or present
none at all.

The tests that matter here are the **negatives**, and they are worth naming individually because
each one pins a security property that is otherwise only enforced by code you might refactor.
The `login` Server Action must **never** hand a token back to the browser — one assertion that
the returned `AuthFormState` carries no token-shaped field, and one that both tokens went to
`setSessionCookies` and nowhere else. (There is no `/api/auth/login` route: `login`, `logout`,
`register` and `verify` are Server Actions, and `/api/auth/refresh` is the only auth route
handler in the course. The cookie **attributes** sit behind two boundaries and are E2E-only —
Key Concept 6 says why.) An unauthenticated `submitIncident` must perform **zero authenticated
mutations** — `fetchGraphQLAuthed` called zero times — and the only requests it may make are the
two credential-free reads Lesson 16.4's kill switch put ahead of the session check. "Zero
requests" would be the weaker claim and it is no longer true; "zero *authenticated* requests" is
the security property, because a rejection that happens after a credentialed call has gone out is
a rejection that leaked a request. And the `incidentSubmissionOpen` kill switch from
[appendix 03 §4.5](../appendix/03-content-model-reference.md) must be honoured, since a feature
flag with no test is a feature flag that stops working.

This is also the lesson that restates the RSC rule with a worked example, because the rule only
becomes obvious once you have seen the refactor it implies.

By the end of this lesson you will have:

- A Vitest setup for the server environment with `next/cache` and `next/headers` mocked centrally
- `src/actions/incidents.test.ts` — valid submission, Zod rejection, unauthenticated rejection
  with **zero** GraphQL calls, kill-switch honoured, and the exact `revalidateTag` arguments asserted
- `src/actions/auth.test.ts` — cookie flags asserted from the `Set-Cookie` header, and a body
  assertion proving no JWT is returned
- A route-handler test calling the exported `POST` with a real `Request`, including the
  HMAC-failure path from Module 18
- One component refactored to satisfy the RSC rule: logic lifted from an async component into a
  `lib/` function, with the function unit-tested and the rendering left to Playwright
- A written note in `docs/testing-strategy.md` recording which behaviours are deliberately
  covered only by E2E

## Classic WP Analogy

You have tested something like this before, and the mapping is close enough to be genuinely useful.

| Classic WordPress | Next.js |
|---|---|
| `admin_post_*` handler processing `$_POST` | A Server Action taking `FormData` |
| `check_admin_referer()` / nonce verification | Server Action origin checks, covered in Lesson 24.2 |
| `current_user_can()` gate at the top | A session read from `cookies()` and a capability check in WordPress |
| `wp_send_json_error()` | A typed result object returned to the form |
| Filtering `pre_http_request` to fake an API | `vi.mock` on the GraphQL client module |
| `wp_cache_flush()` after a write | `revalidateTag()` — and asserting *which* tag |

The instinct that transfers best is the one about **order of checks**. Any WordPress developer
who has written an `admin_post_` handler knows the shape: verify the nonce, check the capability,
sanitize the input, *then* do the work. Getting that order wrong in WordPress meant an
unauthenticated user could trigger a side effect. Getting it wrong here means the same thing,
and the test that proves it is right is the "zero GraphQL calls" assertion.

Where the analogy breaks is the one that costs people the most time: **`the_content()` had no
async equivalent, and Server Components do.** In Classic WordPress every rendering function was
synchronous, so anything that rendered could be called in a test if you loaded enough of core.
An async Server Component cannot be rendered by React Testing Library at all — RTL uses
`react-dom`, which has no server component runtime and no mechanism for awaiting a component
function. There is no flag, no environment and no adapter that fixes this. Accepting it early is
the whole point of the rule from Lesson 23.1, and the compensation is real: it forces the logic
out of the component and into a function that is easier to test than any WordPress code you have
ever written.

---

## Key Concepts

### 1. Write the negatives first, because they are the only tests that pin a security property

A positive test says "the happy path works", which you already know, because you used the form.
A negative test says "this cannot happen", and that is a claim nobody can verify by clicking.

Four of them carry this lesson. Each one exists because the property it pins is currently enforced
only by the *order of statements in a function somebody might refactor*:

| # | The claim | What breaks it | What it would look like in production |
|---|---|---|---|
| 1 | An unauthenticated `submitIncident` performs **zero authenticated mutations** | moving the session check below the WordPress call | an anonymous POST reaches `createIncident`; WordPress refuses it, and you have leaked a request and a rate-limit slot |
| 2 | No response and no returned state ever carries the JWT | a well-meant `return { token }` for a client that "needs it" | a session credential in a place JavaScript can read, and the whole httpOnly design is decoration |
| 3 | The `incidentSubmissionOpen` kill switch is honoured, and `null` means **open** | a `=== true` where the code says `!== false` | a fresh environment with a dead submission form and no error message anywhere |
| 4 | `revalidateTag` is **not** called by `submitIncident` | somebody "fixing" the missing revalidation | a `pending` incident's tag expired on every submission, so every anonymous visitor pays for a cache miss that changes nothing |

Note that three of the four are about **order and absence** rather than output. That is what makes
them unit tests rather than E2E tests: Playwright can tell you the form rejected you, and it
cannot tell you how many requests left the building on the way to that rejection.

> **Write the negative before the implementation is fresh in your mind, not after.** A negative
> written afterwards tends to assert what the code does. A negative written from the *contract* —
> from appendix 04 §4, from Lesson 16.2's step order — asserts what the code should do, and those
> are different tests with the same name.

### 2. What to mock, and what to leave real

`src/actions/incidents.ts` imports ten modules. Mocking all ten leaves you testing nothing;
mocking none of them leaves you unable to run the file. The decision per module:

| Module | Mocked? | Why |
|---|---|---|
| `next/cache` | **yes** | `revalidateTag` and `revalidatePath` throw outside a request scope, and the spy **is** the assertion |
| `next/headers` | **yes** | `headers()` needs a request context. `clientIp()` reads `x-forwarded-for` off it |
| `next/navigation` | **yes**, for the auth actions | `redirect()` works by throwing `NEXT_REDIRECT`, and a spy is far easier to read than a caught exception |
| `@/lib/graphql/client` | **yes** | the call **count** is the assertion for negative 1. MSW would let the request go out, which is the thing being forbidden |
| `@/lib/auth/session` | **yes** | to present a session, a bad session, or none. It also calls the client, so leaving it real makes the call counts meaningless |
| `@/lib/auth/cookies` | **yes** | `readAccessToken()` in the action; `setSessionCookies()` in `login`, where the call is the assertion |
| `@/lib/rate-limit` | **yes** | it is **fail-closed**. With no `UPSTASH_*` variables it returns `{ ok: false, reason: 'unavailable' }`, so every test would exit at step 1 with "Submissions are temporarily unavailable" and pass for the wrong reason |
| `@/lib/validation/schemas` | **no** | the Zod schema is the behaviour under test. Mocking it means asserting your mock |
| `@/lib/graphql/tags` | **no** | pure strings, already covered by 12.2, and `listTag('incident')` must return the real value for negative 4 to mean anything |
| `@/lib/graphql/errors` | **no** | pure. `isGraphQLRequestError` is a type guard you want to actually run |
| `@/gql/graphql` | **no** | generated documents. Mocking them would break the operation names the assertions read |

The rate-limit row is the one that costs people an afternoon. A fail-closed limiter is correct
(Lesson 16.2 §5) and in a test environment it fails closed **every time**, so a suite that forgets
to mock it reports every action as "temporarily unavailable" — and every negative test passes,
because a refused request is also a request that did nothing.

> **The general rule: mock a boundary, never a decision.** `next/cache` is a boundary. Zod is a
> decision. If you find yourself mocking something that returns a *verdict*, you are about to
> assert your own mock, and the test will keep passing after you delete the code it covers.

### 3. `vi.mock` — hoisting, factories, and typed spies

Three mechanics, and getting any of them wrong produces a confusing failure.

**Hoisting.** `vi.mock(path, factory)` is hoisted above every `import` in the file. So the factory
cannot close over a variable declared later — that is a `ReferenceError: Cannot access '…' before
initialization`, which reads like a scoping bug and is a hoisting one. When a mock needs a shared
value, put it in `vi.hoisted()`:

```ts
// (illustration) the only reliable way to share a value with a hoisted factory
const { fakeSession } = vi.hoisted(() => ({ fakeSession: { isLoggedIn: false } }));

vi.mock('@/lib/auth/session', () => ({ getSession: () => fakeSession }));
```

**Factories replace the module wholesale.** Whatever the factory returns *is* the module — so an
export you forget does not exist, and Vitest says so in those words rather than handing you
`undefined`:

```
Error: [vitest] No "cookies" export is defined on the "next/headers" mock.
Did you forget to return it from "vi.mock"?
```

That is a good failure mode and it is worth knowing at 1am, because the factory below declares
only `headers`. It is safe **only** because this lesson also mocks `@/lib/auth/cookies`, so the
cookie jar is read through that module and the real `cookies()` is never reached. Point a factory
like it at a module that calls `cookies()` directly and you get the error above, immediately.
Replacing the module wholesale is also the property that gets you past `import 'server-only'` if
you have not aliased it: with a factory, Vitest never loads the original at all. Lesson 23.2
aliased `server-only` in `vitest.config.ts`, so the choice here is no longer forced — and
factories remain the right answer, because the mocks are the assertions.

**Typed spies.** `vi.mocked(fn)` gives you the mock API with the original signature attached, so
`toHaveBeenCalledWith` is type-checked against the real parameters:

```ts
// (illustration)
import { revalidateTag } from 'next/cache';
expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith('incidents', 'max');
```

Rename `listTag`'s output and this line fails the **type check**, not just the test. That is worth
more than the assertion.

Three habits that go with it: `vi.clearAllMocks()` in `beforeEach` (call counts do not survive
between tests, or negative 1 becomes a lottery), `importOriginal` when you want most of a module
real and one export faked, and never `vi.mock` a module you did not name in the table above.

### 4. Asserting the tag is asserting the contract — and here the contract says "do not call"

`revalidateTag` is the single most consequential call in the application, because a wrong argument
produces **HTTP 200 and permanently stale pages** (Lesson 23.1 §1, seam ④). So the assertion is
never "revalidation happened"; it is *which tag*.

The house facts the assertion has to respect:

| Builder | Signature | Example |
|---|---|---|
| `listTag` | takes a **singular** `ContentType` | `listTag('incident')` → `'incidents'` |
| `taxonomyListTag` | takes a `TaxonomyName` | `taxonomyListTag('scapegoat')` → `'scapegoats'` |
| node tags | locale **infixed** | `incidentTag('incident-01', 'de')` → `'incident:de:incident-01'` |
| list tags | locale **appended** | `listTag('incident', 'de')` → `'incidents:de'` |

And now the interesting part. **No Server Action in this application ever expires a public tag.**
`submitIncident` ends like this, and it has since Lesson 16.2:

```ts
// (illustration) src/actions/incidents.ts, step 5, as Lesson 16.2 wrote it
revalidatePath(`/${input.locale}/account`);

// Named for the reader: this is the tag Module 18's webhook expires when an
// editor publishes. It is NOT expired here, and that is the decision.
void listTag('incident');
```

A submitted incident is `pending`. No public page renders it, so no public cache entry is stale,
so expiring `incidents` would evict a warm entry and rebuild an identical one — a cache miss for
every anonymous visitor, bought with nothing. **So the correct assertion is that `revalidateTag`
was never called**, plus a positive assertion that `revalidatePath` was called with the reporter's
own account path, which *is* stale.

That is a genuinely uncomfortable test to write, because it looks like a missing feature. Write it
with the reason in the test name — `it('does NOT expire the public list tag, because a pending
incident changes no public page')` — and the next person reads the decision instead of
"correcting" it.

`void listTag('incident')` is worth its own sentence. It is a comment with a type check: it
documents which tag *would* be expired, and `npm run type-check` fails if `tags.ts` renames the
helper, which a prose comment would not. A test asserting the tag string is the third layer of
the same idea.

### 5. "Zero calls" is a much stronger claim than "returns an error" — state it precisely

The order of checks in a WordPress `admin_post_` handler is a habit that transfers directly:
verify, authorise, sanitise, *then* act. Getting it wrong meant an unauthenticated user could
trigger a side effect. Here it means the same, and the test that proves the order is a **call
count**, not a return value:

```
   CORRECT                                 SUBTLY WRONG
   ─────────────────────────────────        ─────────────────────────────────
   1. rate limit                            1. rate limit
   1b. kill switch                          1b. kill switch
   2. validate                              2. validate
   3. authenticate → REJECT, return         3. call WordPress ◀── request sent
   4. call WordPress   (never reached)       4. authenticate → REJECT, return
   ─────────────────────────────────        ─────────────────────────────────
   returns { status: 'error' }              returns { status: 'error' }
                                            ▲ IDENTICAL RETURN VALUE
```

Both versions return the same object. Only the call count tells them apart, which is why negative
1 is `expect(vi.mocked(fetchGraphQLAuthed)).not.toHaveBeenCalled()` and not an assertion about
`status`.

**Now be precise, because "zero GraphQL calls" is not literally true.** Lesson 16.4 added the kill
switch as step 1b, and it reads the site settings with `fetchGraphQL` — an unauthenticated,
cacheable **read** that runs before the session is ever consulted. So the honest claim is two
claims:

| Claim | Assertion |
|---|---|
| No **authenticated mutation** is attempted | `fetchGraphQLAuthed` has **zero** calls |
| The only request made was a cacheable read with no credential | `fetchGraphQL` has **one** call, and its document is `SiteChromeDocument` |

The second is not padding. "We only made a read" is a materially different security statement from
"we made no request", and a test that asserts the vaguer one will keep passing when somebody adds
a second, less innocent read.

### 6. There is no `/api/auth/login` route, and the cookie contract sits behind two boundaries

This is worth stating plainly because it contradicts what almost every Next.js authentication
tutorial looks like. In this application:

| Concern | Where it lives | Testable in Vitest? |
|---|---|---|
| `login`, `logout`, `register`, `verify` | **Server Actions** in `src/actions/auth.ts` | yes — import and call them |
| `/api/auth/refresh` | the **only** auth route handler, `POST` and `GET` | yes — call the exported function |
| `/api/auth/session` | a route handler (Lesson 18.1) returning `{ isLoggedIn, displayName }` | yes |
| Setting the cookies | `src/lib/auth/cookies.ts`, which carries `import 'server-only'` | its **call** is testable; its attribute values are not |

So negative 2 — "the JWT is never returned to the client" — is asserted against a Server Action's
**returned state**, which is the thing that actually crosses to the browser. `login` returns an
`AuthFormState`: `{ status, message, fieldErrors }`. A test that serialises that object and greps
it for anything JWT-shaped is the precise form of the claim.

The **attributes** — `HttpOnly`, `Secure`, `SameSite=Lax` and `Path=/` for `btt_at`;
`SameSite=Strict` and `Path=/api/auth` for `btt_rt` (appendix 04 §4) — are constants inside
`cookies.ts`, and they are not exported. Two honest options, and this lesson takes both:

- a structural `grep` over `cookies.ts` in the Verification, which is a text assertion and says so;
- a real assertion in Lesson 23.6, reading `context.cookies()` from a real browser.

That gap is the first entry in the E2E-only list this lesson appends to `docs/testing-strategy.md`.
A gap you have written down is a gap; a gap you have not is a belief.

### 7. Three states, not two — and the third one is a bug that was found the hard way

`/api/auth/refresh` trades the refresh cookie for a fresh access cookie. Its internal helper
returns `'ok' | 'refused' | 'unavailable'`, and the third member is the whole point:

| State | Cause | What must happen |
|---|---|---|
| `'ok'` | WordPress returned a non-empty `authToken` | `btt_at` is replaced; `btt_rt` is **not** rotated |
| `'refused'` | WordPress answered and declined — the refresh token is spent or revoked | clear both cookies. The browser must stop presenting a credential nothing accepts |
| `'unavailable'` | there was no `btt_rt` at all, **or** the request threw — a transport failure | `GET` clears **nothing**. A network blip must not delete a still-valid refresh token |

Collapse `'unavailable'` into `'refused'` and every editor gets logged out whenever WordPress is
briefly unreachable, which is exactly when they are least able to log back in. That distinction
was a real bug found during authoring, and a test is what stops it coming back.

The asymmetry between the two verbs is deliberate and also testable: `POST` clears both cookies on
**any** non-`'ok'` result, because a programmatic caller has nowhere to put the distinction and a
`btt_at` left in place would be handed off to this route again on the very next request — an
infinite redirect loop. `GET` clears only on `'refused'`, so a browser navigating costs the editor
one redirect rather than their session. Two verbs, two policies, one helper: three tests.

### 8. The verification order in `/api/revalidate` *is* the security property

Lesson 18.3's webhook handler does six things and the order is the design. A test that only checks
"a bad signature gives 401" misses the two that matter.

```
   raw = await request.text()          ← ONCE. The bytes signed and the bytes
        │                                parsed must be the SAME bytes.
        ├─▶ X-BTT-E2E-Secret present?  ← the test-only branch, checked FIRST,
        │      404 unless E2E_MODE=1     and absent by default
        │
        ├─▶ 1. timestamp within ±300 s  → 400, with a reason (a timestamp is
        │                                  not a secret)
        ├─▶ 2. HMAC over `${ts}.${raw}` → 401, with NO body and NO reason
        │      timingSafeEqual
        ├─▶ 3. JSON.parse, then Zod     → 400. AFTER the signature, always.
        └─▶ 4. revalidateTag(...)
```

Three properties, each of which is a separate test:

**The raw body is read once, before anything.** Re-reading a consumed stream throws, which is the
runtime enforcing the rule for you. If you parsed first and signed the re-serialised object, a
payload that round-trips differently — key order, a number formatted differently — fails
verification for reasons no log line explains.

**Zod runs after the signature, never before.** Validating first means an unauthenticated caller
can probe your schema: a 400 for one payload and a different 400 for another is an oracle. It also
means you spend CPU parsing attacker-controlled JSON before establishing that the attacker is not
one.

**The signature failure has no body.** `new Response(null, { status: 401 })`. Echoing "signature
mismatch" versus "missing header" tells a forger which half to fix.

A stale timestamp with a **valid** signature must still be a 400. That is the replay test, and it
is the one people leave out, because a valid signature feels like enough. It is not: a captured
request replayed six minutes later is a request an attacker did not have to sign.

### 9. The RSC rule, performed once on a real component

Lesson 23.1 stated the rule. Here is what it costs and what it buys, on a component that exists.

`src/app/[locale]/incidents/submit/page.tsx` is an `async` Server Component. Since Lesson 16.4 it
contains this, and so does `src/actions/incidents.ts`, **verbatim**:

```ts
// (illustration) the same three lines, in two files
if (chrome.siteSettings?.siteChrome?.incidentSubmissionOpen === false) { … }
```

Two copies of one decision, in two files, one of which cannot be unit-tested at all. The rule's
instruction is mechanical: lift the decision into `src/lib/`, unit-test it there, and let both
call sites read the same function.

| | Before | After |
|---|---|---|
| Where the `null`-means-open decision lives | two files, duplicated | `src/lib/incidents/submission.ts`, once |
| Tested by | nothing | three assertions: `true`, `false`, `null` |
| What the page still does | fetch, decide, render | fetch, call the predicate, render |
| Covered by | Playwright only | the predicate in suite 1; the rendering still in Playwright |

The payoff is not tidiness. It is that `null` means **open** for this flag and `undefined` means
**refuse** for the rate limiter (Lesson 16.4 §5), those two are one keystroke apart, and after the
lift there is exactly one place where the wrong keystroke can be made and exactly one test
watching it.

> **A cost, stated honestly.** Lesson 16.4's Verify §3 greps `src/actions/incidents.ts` for
> `=== false` and expects `1`. After this refactor it returns `0` and the behaviour is unchanged.
> That is not a regression, it is a lesson about `grep` as a verification tool: a check written
> against a *text* dates on the first refactor, while a check written against a *predicate*
> survives it. Re-point that assertion at `submission.ts` and move on.

### 10. Writing down what is E2E-only, so a gap stays a gap

Some of this lesson's findings are not "todo" items — they are structural, and they belong in
`docs/testing-strategy.md`, and the "Who owns it" column below is where each is discharged.

| Behaviour | Why no unit test can reach it | Who owns it |
|---|---|---|
| `HttpOnly`, `Secure`, `SameSite`, `Path`, `Max-Age` on the two session cookies | the constants live in a `server-only` module and are not exported | 23.6, reading `context.cookies()` |
| Any `async` Server Component's rendered output | the RSC rule | 23.6 and the `smoke` project |
| `src/proxy.ts` and its redirect decisions | it is a decision about a real request; asserting it in isolation asserts your own `NextRequest` | 23.6 |
| `redirect()` actually navigating | mocked here, so only the *argument* is asserted | 23.6 |
| Whether WordPress accepts `CreateIncidentInput` | the client is mocked; a shape mismatch is invisible | 23.5, in-process `graphql()` |
| Whether the ISR cache really served a stale page | there is no cache in a Vitest worker | 23.6 |

Six rows, each with a named owner. That is what makes it a plan rather than a disclaimer — and
when a reviewer asks "is the cookie flag tested?", the answer is a row rather than a shrug.


---

## Task

Nothing new is installed. Lesson 23.2 already added the `server-only` alias and the MSW setup
file, and everything here is `vi.mock`, which ships with Vitest.

Write the negatives first. Every step below opens with the test that must fail if somebody
reorders the function, and the happy path arrives last.

### Step 1: Test `submitIncident` — zero authenticated mutations, and two credential-free reads

```ts
// next-app/src/actions/incidents.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SiteChromeDocument } from '@/gql/graphql';
import { listTag } from '@/lib/graphql/tags';

// Shared with the hoisted factories below. `vi.mock` is hoisted ABOVE every
// import, so a factory closing over a normal `const` throws
// "Cannot access '…' before initialization" — Key Concept 3.
const { state } = vi.hoisted(() => ({
  state: {
    session: { isLoggedIn: false } as
      | { isLoggedIn: false }
      | { isLoggedIn: true; displayName: string; roles: readonly string[] },
    accessToken: null as string | null,
    submissionOpen: null as boolean | null,
  },
}));

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-forwarded-for': '203.0.113.7' })),
}));

// The FAIL-CLOSED limiter (Lesson 16.2). Unmocked, it returns
// { ok: false, reason: 'unavailable' } because no UPSTASH_* variable is set — and
// every test below would then pass at step 1 for entirely the wrong reason.
vi.mock('@/lib/rate-limit', () => ({
  limit: vi.fn(() => Promise.resolve({ ok: true, remaining: 4 })),
}));

vi.mock('@/lib/auth/session', () => ({
  getSession: () => Promise.resolve(state.session),
}));

vi.mock('@/lib/auth/cookies', () => ({
  readAccessToken: () => Promise.resolve(state.accessToken),
}));

// The COUNT on the second of these is negative 1. Mocked rather than intercepted
// with MSW, deliberately: MSW would let the request leave, and "it left" is the
// thing being forbidden.
//
// ONE fake serves BOTH reads the action performs — SiteChrome for the kill switch
// and IncidentTermOptions for the Zod allowlist — because the action reads
// disjoint keys off them. That is legitimate and it has a cost, named below the
// file: a vi.mock factory is untyped, so nothing checks this shape against
// src/gql/.
vi.mock('@/lib/graphql/client', () => ({
  fetchGraphQL: vi.fn(() =>
    Promise.resolve({
      // read 1 — the kill switch (step 1b)
      siteSettings: { siteChrome: { incidentSubmissionOpen: state.submissionOpen } },
      // read 2 — the term allowlist Zod refines against (step 2)
      scapegoats: { nodes: [{ slug: 'dns' }, { slug: 'the-intern' }] },
      severities: { nodes: [{ slug: 's1-catastrophic' }, { slug: 's2-major' }] },
    })
  ),
  fetchGraphQLAuthed: vi.fn(() =>
    Promise.resolve({ createIncident: { incident: { slug: 'incident-41' } } })
  ),
}));

const { revalidatePath, revalidateTag } = await import('next/cache');
const { fetchGraphQL, fetchGraphQLAuthed } = await import('@/lib/graphql/client');
const { submitIncident } = await import('@/actions/incidents');

/** The minimum a valid submission needs. Field names from Lesson 16.1's schema. */
function validForm(overrides: Readonly<Record<string, string>> = {}): FormData {
  const data = new FormData();

  for (const [key, value] of Object.entries({
    title: 'The certificate expired again',
    body: 'It was DNS. It is always DNS.',
    scapegoatSlug: 'dns',
    severitySlug: 's2-major',
    occurredAt: '2024-01-01T09:00:00Z',
    downtimeMinutes: '42',
    environment: 'production',
    blameConfidence: '73',
    locale: 'en',
    ...overrides,
  })) {
    data.set(key, value);
  }

  return data;
}

beforeEach(() => {
  // Call counts do NOT survive between tests. Without this, negative 1 becomes a
  // lottery decided by test order.
  vi.clearAllMocks();

  state.session = { isLoggedIn: false };
  state.accessToken = null;
  state.submissionOpen = null;
});

describe('submitIncident — NEGATIVE: an anonymous caller mutates nothing', () => {
  it('performs ZERO authenticated mutations', async () => {
    const result = await submitIncident({ status: 'idle' }, validForm());

    // Not "returns an error" — ZERO CALLS. A rejection that happens after the
    // request has gone out is a rejection that leaked a request, and both
    // versions return this identical object. Key Concept 5.
    expect(vi.mocked(fetchGraphQLAuthed)).not.toHaveBeenCalled();
    expect(result.status).toBe('error');
  });

  it('makes exactly TWO requests, and both are credential-free reads', async () => {
    await submitIncident({ status: 'idle' }, validForm());

    // Be precise. "Zero GraphQL calls" is not literally true: the kill switch
    // (step 1b) reads the site settings and Zod's term allowlist (step 2) reads
    // the taxonomy options, and BOTH run before the session is consulted. Two
    // cacheable, credential-free reads and zero mutations is a materially
    // different — and honest — security statement from "no requests", and the
    // vaguer assertion would keep passing when somebody adds a third, less
    // innocent one. Key Concept 5.
    expect(vi.mocked(fetchGraphQL)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchGraphQL).mock.calls[0]?.[0]).toBe(SiteChromeDocument);
  });

  it('rejects a session with no access token, without calling WordPress', async () => {
    // A session object with no readable `btt_at` is the near-expiry window from
    // Lesson 15.5. Two separate branches in the action, same message, and the
    // call count must be zero in both.
    state.session = { isLoggedIn: true, displayName: 'Dev', roles: ['incident_reporter'] };
    state.accessToken = null;

    const result = await submitIncident({ status: 'idle' }, validForm());

    expect(result.status).toBe('error');
    expect(vi.mocked(fetchGraphQLAuthed)).not.toHaveBeenCalled();
  });

  it('rejects a signed-in user without the role, without calling WordPress', async () => {
    state.session = { isLoggedIn: true, displayName: 'Reader', roles: ['subscriber'] };
    state.accessToken = 'header.payload.signature';

    const result = await submitIncident({ status: 'idle' }, validForm());

    expect(result.status).toBe('error');
    expect(vi.mocked(fetchGraphQLAuthed)).not.toHaveBeenCalled();
  });
});

describe('submitIncident — NEGATIVE: the kill switch, and what `null` means', () => {
  it('refuses when the switch is explicitly false, before validating anything', async () => {
    state.submissionOpen = false;
    state.session = { isLoggedIn: true, displayName: 'Dev', roles: ['incident_reporter'] };
    state.accessToken = 'header.payload.signature';

    // Deliberately INVALID input as well. The kill switch is step 1b, before
    // validation, so the message must be the paused one and not "Check the
    // fields below" — which is how this test also pins the ORDER.
    const result = await submitIncident({ status: 'idle' }, validForm({ title: '' }));

    expect(result.status).toBe('error');
    expect(result).toMatchObject({ message: expect.stringContaining('paused') });
    expect(vi.mocked(fetchGraphQLAuthed)).not.toHaveBeenCalled();
  });

  it('treats `null` as OPEN, because an unsaved options page is not a decision', async () => {
    state.submissionOpen = null;
    state.session = { isLoggedIn: true, displayName: 'Dev', roles: ['incident_reporter'] };
    state.accessToken = 'header.payload.signature';

    const result = await submitIncident({ status: 'idle' }, validForm());

    // `!== false`, never `=== true`. A fresh environment where nobody has clicked
    // Update in wp-admin must still accept submissions — Lesson 16.4 §5. The
    // opposite default belongs to the rate limiter, one keystroke away.
    expect(result.status).toBe('success');
  });
});

describe('submitIncident — the cache decision', () => {
  beforeEach(() => {
    state.session = { isLoggedIn: true, displayName: 'Dev', roles: ['incident_reporter'] };
    state.accessToken = 'header.payload.signature';
  });

  it('does NOT expire the public list tag, because a pending incident changes no public page', async () => {
    await submitIncident({ status: 'idle' }, validForm());

    // Reads like a missing feature and is a decision. The new incident is
    // `pending`: no public page renders it, so expiring `incidents` would evict
    // a warm entry and rebuild an identical one — a cache miss for every
    // anonymous visitor, bought with nothing. Lesson 16.2 §8.
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
    expect(listTag('incident')).toBe('incidents');
  });

  it('DOES expire the reporter own account path, which is genuinely stale', async () => {
    await submitIncident({ status: 'idle' }, validForm({ locale: 'de' }));

    // The locale comes from the form, so this also pins that the path is built
    // per-locale rather than hard-coded to /en.
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/de/account');
  });
});
```

> **The cost of `vi.mock` over MSW, stated once.** A factory is untyped. The `fetchGraphQL` fake
> above is shaped for two operations at once and nothing checks it against `src/gql/`. If the term
> allowlist comes back empty because your `IncidentTermOptions` document selects a different
> shape, every test in the third `describe` returns `status: 'error'` with "Check the fields
> below" — a confusing failure with no compiler help at all. Lesson 23.2's MSW handlers are typed
> precisely so they cannot do this. Reshape the fake against
> `src/graphql/incidents.graphql` if it happens, and notice that you had to.

**Verify §1:**

- [ ] `npx vitest run src/actions/incidents.test.ts` reports **eight** passing tests.
- [ ] If the two `null`-is-open and `revalidatePath` tests fail with "Check the fields below", the
      term-allowlist half of the fake does not match your document. That is the untyped-factory
      cost from the note above, arriving on schedule.
- [ ] Delete the `@/lib/rate-limit` mock and re-run. Every test still passes, and **all eight are
      now passing for the wrong reason** — the fail-closed limiter refused before anything else
      ran. Put it back. This is the single most useful thing in the step.
- [ ] `grep -c 'not.toHaveBeenCalled' src/actions/incidents.test.ts` is **5**. If a refactor makes
      that number drop, the security property dropped with it.
- [ ] `npm run type-check` is silent. `vi.mocked(revalidateTag)` carries the real signature, so
      `toHaveBeenCalledWith('incidents-de')` would be a **compile** error, not a test failure.

### Step 2: Test the auth actions — NEGATIVE: nothing token-shaped crosses the wire

```ts
// next-app/src/actions/auth.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Generated per run, so no token-shaped literal is ever written into a tracked
// file. `crypto` is a Node global, which matters: a hoisted factory runs above
// every import and cannot use one.
const { state } = vi.hoisted(() => ({
  state: {
    authToken: `header.${crypto.randomUUID()}.signature`,
    refreshToken: crypto.randomUUID(),
  },
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-forwarded-for': '203.0.113.7' })),
}));

// `redirect()` works by THROWING NEXT_REDIRECT (Lesson 16.2 §5), which is why
// `login` calls it outside its try/catch. A spy is far easier to read than a
// caught exception, and the ARGUMENT is what the open-redirect test needs.
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

vi.mock('@/lib/auth/cookies', () => ({
  setSessionCookies: vi.fn(),
  clearSessionCookies: vi.fn(),
}));

vi.mock('@/lib/graphql/client', () => ({
  fetchGraphQL: vi.fn(() =>
    Promise.resolve({
      login: { authToken: state.authToken, refreshToken: state.refreshToken },
    })
  ),
  fetchGraphQLAuthed: vi.fn(),
}));

const { redirect } = await import('next/navigation');
const { clearSessionCookies, setSessionCookies } = await import('@/lib/auth/cookies');
const { login, logout } = await import('@/actions/auth');

/** Anything with three dot-separated base64url runs — the shape of a JWT. */
const TOKEN_SHAPED = /[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/;

function loginForm(next = '/en/account'): FormData {
  const data = new FormData();

  data.set('email', 'dev@blamethe.tech');
  // min: 1, not 12 — this is a LOGIN, and rejecting a short password here would
  // tell an attacker their guess was too short to be yours (Lesson 15.4).
  data.set('password', 'x');
  data.set('locale', 'en');
  data.set('next', next);

  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('login — NEGATIVE: the JWT never reaches the client', () => {
  it('returns a state with nothing token-shaped anywhere in it', async () => {
    const result = await login({ status: 'idle', message: '', fieldErrors: {} }, loginForm());

    // The returned AuthFormState is what actually crosses to the browser through
    // useActionState. Serialise the whole thing and search it, rather than
    // checking a field list that a future member could slip past.
    const serialised = JSON.stringify(result);

    // Two assertions, because either alone is weak. The exact values catch a leak
    // of THESE tokens; the shape catches a leak of any other one.
    expect(serialised).not.toContain(state.authToken);
    expect(serialised).not.toContain(state.refreshToken);
    expect(serialised).not.toMatch(TOKEN_SHAPED);
    expect(Object.keys(result).sort()).toEqual(['fieldErrors', 'message', 'status']);
  });

  it('hands both tokens to the cookie module and nowhere else', async () => {
    await login({ status: 'idle', message: '', fieldErrors: {} }, loginForm());

    // The tokens go to ONE place: a server-only module that sets httpOnly
    // cookies. The attribute VALUES are asserted in Lesson 23.6 from a real
    // browser context — see the note this lesson appends to the strategy doc.
    expect(vi.mocked(setSessionCookies)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setSessionCookies)).toHaveBeenCalledWith(
      state.authToken,
      state.refreshToken
    );
  });

  it('sets the cookies BEFORE it redirects', async () => {
    await login({ status: 'idle', message: '', fieldErrors: {} }, loginForm());

    // Order, not presence. `redirect()` throws, so a redirect issued before the
    // cookies were written would land the user on a guarded page with no session
    // — which looks like a login that silently failed.
    const cookieCall = vi.mocked(setSessionCookies).mock.invocationCallOrder[0] ?? Infinity;
    const redirectCall = vi.mocked(redirect).mock.invocationCallOrder[0] ?? 0;

    expect(cookieCall).toBeLessThan(redirectCall);
  });

  it('NEGATIVE: refuses an off-site `next`, and does not echo it back', async () => {
    await login({ status: 'idle', message: '', fieldErrors: {} }, loginForm('https://evil.test/phish'));

    // `?next=` is attacker-chosen. The guard has to reject an absolute URL AND a
    // protocol-relative one — `//evil.test` is an absolute URL as far as a
    // browser is concerned, and it is the case people forget.
    expect(vi.mocked(redirect)).not.toHaveBeenCalledWith('https://evil.test/phish');
    expect(vi.mocked(redirect).mock.calls[0]?.[0]).toMatch(/^\/(?![/\\])/);
  });

  it('NEGATIVE: a protocol-relative `next` is refused too', async () => {
    await login({ status: 'idle', message: '', fieldErrors: {} }, loginForm('//evil.test'));

    expect(vi.mocked(redirect).mock.calls[0]?.[0]).toMatch(/^\/(?![/\\])/);
  });
});

describe('logout', () => {
  it('clears the session and then redirects to the unprefixed root', async () => {
    await logout();

    expect(vi.mocked(clearSessionCookies)).toHaveBeenCalledTimes(1);
    // `'/'`, not `'/en'` — proxy normalises it, and hard-coding a locale in
    // a logout would send a German editor to an English page (Lesson 15.4).
    expect(vi.mocked(redirect)).toHaveBeenCalledWith('/');
  });
});
```

**Verify §2:**

- [ ] `npx vitest run src/actions/auth.test.ts` reports **six** passing tests.
- [ ] Change `TOKEN_SHAPED` to `/nothing-matches-this/` and re-run. The first test **still
      passes**, because the two `not.toContain` assertions carry it — which is exactly why they
      are there. Now delete those two lines as well and re-run: still green. Put both back, then
      add a temporary `token: state.authToken` to `login`'s returned object and confirm the test
      **fails**. A negative you have not seen fail is a negative that is decorating the file.
- [ ] `grep -c 'password' src/actions/auth.test.ts` counts the fixture uses only. No test asserts
      on a password value, and none appears in an `# Expected:` line anywhere.

### Step 3: Test the refresh route — all three states, both verbs

```ts
// next-app/src/app/api/auth/refresh/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Generated per run. See src/actions/auth.test.ts for why `crypto` and not an
// import: a hoisted factory runs above every import in the file.
const { PRESENT, state } = vi.hoisted(() => {
  const present = crypto.randomUUID();

  return {
    PRESENT: present,
    state: {
      refreshToken: present as string | null,
      /** 'ok' | 'refused' | 'transport' — what WordPress does when asked. */
      wordpress: 'ok' as 'ok' | 'refused' | 'transport',
    },
  };
});

vi.mock('@/lib/auth/cookies', () => ({
  readRefreshToken: () => Promise.resolve(state.refreshToken),
  setAccessCookie: vi.fn(),
  clearSessionCookies: vi.fn(),
}));

vi.mock('@/lib/graphql/client', () => ({
  fetchGraphQL: vi.fn(() => {
    if (state.wordpress === 'transport') {
      return Promise.reject(new Error('ECONNREFUSED'));
    }

    return Promise.resolve({
      refreshJwtAuthToken: {
        authToken: state.wordpress === 'ok' ? 'header.payload.signature' : null,
      },
    });
  }),
  fetchGraphQLAuthed: vi.fn(),
}));

const { clearSessionCookies, setAccessCookie } = await import('@/lib/auth/cookies');
const { GET, POST } = await import('@/app/api/auth/refresh/route');

beforeEach(() => {
  vi.clearAllMocks();
  state.refreshToken = PRESENT;
  state.wordpress = 'ok';
});

describe('POST /api/auth/refresh — 204 or 401, and never a body', () => {
  it('mints a new access cookie and answers 204 with no body', async () => {
    const response = await POST();

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(vi.mocked(setAccessCookie)).toHaveBeenCalledTimes(1);
  });

  it('NEGATIVE: never returns a body, on any branch', async () => {
    state.wordpress = 'refused';

    const response = await POST();

    // A refresh endpoint has nothing to say that the status code does not
    // already say, and a body is a place for detail to leak into.
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
  });

  it('clears BOTH cookies on any failure, because the alternative is a redirect loop', async () => {
    state.wordpress = 'transport';

    await POST();

    // Lesson 15.5's proxy hands off to this route whenever `btt_at` is near
    // expiry. A failed refresh that left `btt_at` in place would be handed off
    // again on the very next request — forever. Deleting the cookie terminates it.
    expect(vi.mocked(clearSessionCookies)).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/auth/refresh — three states, and the third is why it exists', () => {
  it("'ok' redirects to the requested path", async () => {
    const response = await GET(
      new Request('http://localhost:3000/api/auth/refresh?next=/en/account') as never
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/en/account');
    expect(vi.mocked(clearSessionCookies)).not.toHaveBeenCalled();
  });

  it("'refused' clears the session — the token is spent or revoked", async () => {
    state.wordpress = 'refused';

    const response = await GET(
      new Request('http://localhost:3000/api/auth/refresh?next=/en/account') as never
    );

    expect(response.status).toBe(307);
    expect(vi.mocked(clearSessionCookies)).toHaveBeenCalledTimes(1);
  });

  it("NEGATIVE: 'unavailable' clears NOTHING — a transport failure is not a refusal", async () => {
    state.wordpress = 'transport';

    const response = await GET(
      new Request('http://localhost:3000/api/auth/refresh?next=/en/account') as never
    );

    // THE test in this file. Collapse 'unavailable' into 'refused' and every
    // editor is logged out whenever WordPress is briefly unreachable — which is
    // exactly when they are least able to log back in. This distinction was a
    // real bug found during authoring.
    expect(response.status).toBe(307);
    expect(vi.mocked(clearSessionCookies)).not.toHaveBeenCalled();
  });

  it("NEGATIVE: no cookie at all is 'unavailable', not 'refused'", async () => {
    state.refreshToken = null;

    await GET(new Request('http://localhost:3000/api/auth/refresh?next=/en/account') as never);

    // Nothing was refused; there was simply nothing to present.
    expect(vi.mocked(clearSessionCookies)).not.toHaveBeenCalled();
  });

  it('NEGATIVE: an off-site `next` never reaches the Location header', async () => {
    const response = await GET(
      new Request('http://localhost:3000/api/auth/refresh?next=https://evil.test') as never
    );

    expect(response.headers.get('location')).toBe('http://localhost:3000/en');
  });
});
```

The `as never` on each `Request` is the one wart in this file, and it is worth naming rather than
hiding: the handler's parameter is typed `NextRequest`, which adds `nextUrl` on top of `Request`.
Constructing a real `NextRequest` in a test means importing `next/server`, which pulls in more of
the framework than this test wants. The alternative — `new NextRequest(url)` — does work and is
the better choice the moment you need `nextUrl.searchParams` to behave exactly as it does in
production. Reasoned, not executed: if `request.nextUrl` throws in your run, switch to
`NextRequest` and delete the casts.

**Verify §3:**

- [ ] `npx vitest run src/app/api/auth/refresh/route.test.ts` reports **nine** passing tests.
- [ ] `grep -c "'unavailable'" src/app/api/auth/refresh/route.ts` is **2 or more** — the no-cookie
      branch and the `catch`. A `1` means the transport failure is being reported as a refusal.
- [ ] `npx vitest run -t "transport failure is not a refusal"` runs exactly that one test.
      Appendix 07 §5 promises the `-t` filter works; this is the test worth having it for.

### Step 4: Test the revalidation webhook — the order is the security property

```ts
// next-app/src/app/api/revalidate/route.test.ts
import { createHmac, randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

const { revalidateTag } = await import('next/cache');
const { POST } = await import('@/app/api/revalidate/route');

/** Generated per run. No token-shaped literal is ever written into a tracked file. */
const SECRET = randomUUID();

const BODY = JSON.stringify({
  type: 'post',
  postType: 'incident',
  slug: 'incident-01',
  locale: 'en',
});

/** The exact string Revalidate.php signs: `${timestamp}.${rawBody}`. */
function sign(timestamp: string, body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

function post(headers: Readonly<Record<string, string>>, body = BODY): Promise<Response> {
  return POST(
    new Request('http://localhost:3000/api/revalidate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    })
  );
}

function now(): string {
  return String(Math.floor(Date.now() / 1000));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('REVALIDATE_SECRET', SECRET);
  vi.stubEnv('E2E_MODE', '0');
});

describe('POST /api/revalidate — the happy path, so the negatives mean something', () => {
  it('derives both tags from tags.ts and expires them', async () => {
    const ts = now();
    const response = await post({ 'x-btt-timestamp': ts, 'x-btt-signature': sign(ts, BODY) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      revalidated: ['incident:incident-01', 'incidents'],
    });

    // WordPress sends IDENTIFIERS; the route derives every tag from tags.ts. That
    // is what turned a two-sided contract into a one-sided one (Lesson 18.2).
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith('incident:incident-01', 'max');
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith('incidents', 'max');
  });
});

describe('POST /api/revalidate — NEGATIVE: verification, in order', () => {
  it('rejects a STALE timestamp even with a perfect signature', async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 400);

    // A valid signature feels like enough. It is not: a captured request
    // replayed six minutes later is a request the attacker never had to sign.
    // The window is ±300 s, so 400 s is outside it.
    const response = await post({
      'x-btt-timestamp': stale,
      'x-btt-signature': sign(stale, BODY),
    });

    expect(response.status).toBe(400);
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it('rejects a wrong signature with 401 and NO body', async () => {
    const ts = now();
    const response = await post({
      'x-btt-timestamp': ts,
      'x-btt-signature': 'sha256=' + 'a'.repeat(64),
    });

    expect(response.status).toBe(401);
    // No reason, deliberately. "Signature mismatch" versus "missing header"
    // tells a forger which half to fix.
    expect(await response.text()).toBe('');
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it('rejects a signature computed over a DIFFERENT body', async () => {
    const ts = now();
    const other = JSON.stringify({ type: 'options', locale: 'en' });

    // Sign one payload, send another. This is the test that proves the signature
    // covers the raw body rather than just the timestamp.
    const response = await post(
      { 'x-btt-timestamp': ts, 'x-btt-signature': sign(ts, other) },
      BODY
    );

    expect(response.status).toBe(401);
  });

  it('NEGATIVE: fails closed when REVALIDATE_SECRET is unset', async () => {
    vi.stubEnv('REVALIDATE_SECRET', '');
    const ts = now();

    // A server with no secret configured authenticates nobody. The opposite
    // default — treat an empty secret as "skip verification" — is the same
    // mistake as `hash_equals('', '')` in PHP, which is `true`.
    const response = await post({ 'x-btt-timestamp': ts, 'x-btt-signature': sign(ts, BODY) });

    expect(response.status).toBe(401);
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it('NEGATIVE: Zod runs AFTER the signature, never before', async () => {
    const bad = JSON.stringify({ type: 'post', postType: 'sprocket', slug: '' });
    const ts = now();

    // Unsigned garbage must be a 400 about the TIMESTAMP, not about the schema.
    // If an unauthenticated caller can tell a schema failure from a signature
    // failure, you have built a schema oracle.
    const unsigned = await post({}, bad);

    expect(unsigned.status).toBe(400);
    await expect(unsigned.json()).resolves.toMatchObject({
      error: expect.stringContaining('timestamp'),
    });

    // Correctly signed garbage IS a schema failure, and only then.
    const signed = await post(
      { 'x-btt-timestamp': ts, 'x-btt-signature': sign(ts, bad) },
      bad
    );

    expect(signed.status).toBe(400);
    await expect(signed.json()).resolves.toMatchObject({ error: 'payload failed validation' });
  });

  it('NEGATIVE: the test-only hook is a 404 unless E2E_MODE is exactly "1"', async () => {
    const response = await post({ 'x-btt-e2e-secret': 'anything' }, JSON.stringify({ type: 'all' }));

    // 404, not 401 and not 403: in production this branch does not exist and the
    // response says so. A 401 would confirm there is something here to
    // authenticate against (Lesson 18.3).
    expect(response.status).toBe(404);
  });
});
```

**Verify §4:**

- [ ] `npx vitest run src/app/api/revalidate/route.test.ts` reports **seven** passing tests.
- [ ] The happy-path assertion lists the tags in the order `tagsFor` returns them. If it fails on
      ordering, use `expect.arrayContaining` — but read the failure first: an order change means
      somebody edited `tagsFor`, and that is worth knowing.
- [ ] `grep -c 'x-btt-e2e-secret' src/app/api/revalidate/route.test.ts` is `1`, and it is in the
      404 test. Nothing in this file exercises the E2E branch **positively** — that is Lesson
      23.6's, and it needs `E2E_MODE=1` in a place a test file should not be setting.

### Step 5: Perform the RSC refactor — lift the decision out of the async component

Two files carry the same three lines since Lesson 16.4. One of them cannot be unit-tested at all.

```ts
// next-app/src/lib/incidents/submission.ts
// The `incident_submission_open` decision, in one place.
//
// Lifted out of src/app/[locale]/incidents/submit/page.tsx — an async Server
// Component, which no unit test can render (Lesson 23.1's RSC rule) — and out of
// src/actions/incidents.ts, which had a byte-identical copy. The rule's real
// instruction: an async component should await and arrange, and nothing else.
//
// NO `import 'server-only'`. This is pure logic over a value, it holds no secret
// and does no I/O, so the guard belongs on the modules that fetch rather than on
// this one. Same reasoning as tags.ts and errors.ts (Lesson 12.2 §7).

/** The narrowest shape this decision needs. Structural, so any SiteChrome fits. */
export type SubmissionSettings = {
  readonly incidentSubmissionOpen?: boolean | null;
} | null | undefined;

/**
 * Is incident submission open?
 *
 * `!== false`, never `=== true`. An SCF options page nobody has saved returns
 * `null`, and `null` means "nobody has decided" — so the pre-switch behaviour is
 * the honest default. Treating `null` as closed gives a fresh environment a dead
 * submission form for a reason no error message mentions.
 *
 * Compare `src/lib/rate-limit.ts`, one keystroke away in shape and the exact
 * opposite in policy: a missing UPSTASH_* variable must REFUSE, because a rate
 * limiter is a security control and a submission form is a content setting.
 * Lesson 16.4 §5 has the question that tells them apart.
 */
export function isSubmissionOpen(settings: SubmissionSettings): boolean {
  return settings?.incidentSubmissionOpen !== false;
}
```

Then replace both call sites. The behaviour is unchanged; the decision now has one home:

```ts
// next-app/src/actions/incidents.ts — anchored edit, replacing the 1b condition
  if (!isSubmissionOpen(chrome.siteSettings?.siteChrome)) {
```

```tsx
// next-app/src/app/[locale]/incidents/submit/page.tsx — anchored edit, same shape
  if (!isSubmissionOpen(chrome.siteSettings?.siteChrome)) {
```

**Verify §5:**

- [ ] `grep -rc 'incidentSubmissionOpen === false' src/` returns `0` for every file. There is now
      exactly one comparison, and it is in `submission.ts`.
- [ ] Lesson 16.4's Verify §3 greps `src/actions/incidents.ts` for `=== false` and expects `1`. It
      now returns `0`, **and the behaviour is identical.** That is not a regression — it is a
      lesson about `grep` as a verification tool. A check written against a *text* dates on the
      first refactor; a check written against a *predicate* survives it.
- [ ] `npm run type-check` is silent, and `npx vitest run src/actions/incidents.test.ts` still
      reports eight passing. The kill-switch tests did not change, which is what "behaviour
      unchanged" means.

### Step 6: Unit-test the lifted predicate — three lines, three states

```ts
// next-app/src/lib/incidents/submission.test.ts
import { describe, expect, it } from 'vitest';

import { isSubmissionOpen } from '@/lib/incidents/submission';

describe('isSubmissionOpen — three states, and only one of them closes the form', () => {
  it('is open when the switch is true', () => {
    expect(isSubmissionOpen({ incidentSubmissionOpen: true })).toBe(true);
  });

  it('is CLOSED only when the switch is explicitly false', () => {
    expect(isSubmissionOpen({ incidentSubmissionOpen: false })).toBe(false);
  });

  it('is open when nobody has saved the options page', () => {
    // The three ways WPGraphQL and the codegen'd type can say "no value":
    // an explicit null, an absent key, and a null settings object.
    expect(isSubmissionOpen({ incidentSubmissionOpen: null })).toBe(true);
    expect(isSubmissionOpen({})).toBe(true);
    expect(isSubmissionOpen(null)).toBe(true);
    expect(isSubmissionOpen(undefined)).toBe(true);
  });
});
```

Four assertions in the last test, and they are the same behaviour rather than four behaviours —
which is the documented exception to "one behaviour per `it()`" (Lesson 12.2 §10): a table of
inputs is fine, a branch is a second test pretending to be one.

**Verify §6:**

- [ ] Three tests, all passing, in under fifty milliseconds.
- [ ] Change `!== false` to `=== true` in `submission.ts` and re-run. **Two** tests fail, not one,
      and the failure names the `null` case. Change it back. That is the outage from Lesson 16.4
      §5, now caught by a test that runs in fifty milliseconds instead of by a support ticket.

### Step 7: Demonstrate the RSC failure, so nobody spends an afternoon on it

This is the only step whose deliverable is a **deleted** file. Write it, run it, read the error,
delete it. The point is the error message.

```tsx
// next-app/src/components/_rsc-probe.test.tsx  (TEMPORARY — deleted at the end)
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('the RSC rule, demonstrated', () => {
  it('cannot render an async component through react-dom', () => {
    async function AsyncThing() {
      await Promise.resolve();

      return <p>never rendered</p>;
    }

    // No flag, environment or adapter changes this. `react-dom` is the CLIENT
    // renderer: it has no mechanism for awaiting a component function, so it
    // receives a Promise where it expects an element.
    expect(() => render(<AsyncThing /> as never)).toThrow(/Promise|not valid as a React child/);
  });
});
```

```bash
cd next-app
npx vitest run src/components/_rsc-probe.test.tsx
rm src/components/_rsc-probe.test.tsx
```

**Verify §7:**

- [ ] The test passes, which means the render **did** throw. Read the message rather than the
      green tick: it is some form of `Objects are not valid as a React child (found: [object
      Promise])`. That string is the whole of Lesson 23.1 §3, and recognising it on sight is worth
      more than this test.
- [ ] The file is gone. `git status --short src/components/` shows nothing new — a probe that gets
      committed becomes a test asserting that React has a limitation, which is not your bug to
      pin.
- [ ] If it does **not** throw, and instead reports a rendered `<p>`, your React version has
      changed behaviour and Lesson 23.1's rule needs re-reading against the release notes rather
      than trusted. Report it before writing tests that depend on it.

### Step 8: Record what is deliberately covered only by E2E

One appended section, continuing the numbering Lesson 23.1 left at `## 11.`.

```markdown
<!-- docs/testing-strategy.md — append -->
## 12. Covered only by E2E (Lesson 23.3)

Not a to-do list. Each row is a behaviour a unit test structurally cannot reach, with the suite
that owns it. When a reviewer asks "is that tested?", the answer is a row.

| Behaviour | Why no unit test reaches it | Owner |
|---|---|---|
| `HttpOnly`, `Secure`, `SameSite`, `Path`, `Max-Age` on `btt_at` and `btt_rt` | the values are unexported constants inside a `server-only` module | 23.6, reading `context.cookies()` |
| Any `async` Server Component's rendered output | the RSC rule — `react-dom` cannot await a component function | 23.6, `smoke` project |
| `src/proxy.ts` redirect decisions | TODO |
| `redirect()` actually navigating | mocked here, so only the ARGUMENT is asserted | 23.6 |
| Whether WordPress accepts `CreateIncidentInput` | TODO |
| Whether ISR really served a stale page | TODO |

TODO: one more row of your own, and say which suite you would give it to if you could.
```

**Verify §8:**

- [ ] `grep -c '^## 12\.' ../docs/testing-strategy.md` is `1`, and `grep -c '^## ' ` is now `12`.
      Lesson 23.1's eleven sections are untouched.
- [ ] Every row names an **owner**. A row with no owner is a disclaimer, and Lesson 24.5's "Known
      gaps" list already runs past six without help.
- [ ] `grep -c 'TODO' ../docs/testing-strategy.md` is `0` before you commit.


---

## Verification

```bash
cd next-app

# 1. Everything this lesson wrote, by name
npx vitest run src/actions src/app/api src/lib/incidents --reporter=verbose
# Expected: four files —
#             src/actions/incidents.test.ts               (8)
#             src/actions/auth.test.ts                    (6)
#             src/app/api/auth/refresh/route.test.ts      (9)
#             src/app/api/revalidate/route.test.ts        (7)
#           plus src/lib/incidents/submission.test.ts     (3)
#           Thirty-three assertions' worth of behaviour, in under two seconds.

# 2. The whole suite is still green, and the count went UP by five files
npm run test:run
# Expected: 14 test files passed. Lesson 12.2 left five, Lesson 23.2 added four,
#           this lesson adds five. A count of 9 means `include` never grew — but
#           these are all .ts, so that would be a different bug: check the paths.

# 3. NEGATIVE — an unauthenticated submission performs zero MUTATIONS. This is the
#    single most important assertion in the module, so count it rather than trust it.
grep -c 'not.toHaveBeenCalled' src/actions/incidents.test.ts
# Expected: 5 — four in the anonymous describe, one in the kill-switch describe.
#           If a refactor makes this number fall, the security property fell with it.
npx vitest run -t "performs ZERO authenticated mutations"
# Expected: 1 passed, the rest reported as skipped

# 4. NEGATIVE — the JWT is never in a returned state. Prove the test can fail.
sed -i.bak "s/const TOKEN_SHAPED = .*/const TOKEN_SHAPED = \/nothing-matches-this\/;/" \
  src/actions/auth.test.ts
npx vitest run src/actions/auth.test.ts | tail -3
mv src/actions/auth.test.ts.bak src/actions/auth.test.ts
# Expected: STILL 6 passed, with the neutered regex — the two `not.toContain`
#           assertions on the generated token values carry the test on their own.
#           That layering is deliberate: a shape regex alone can be neutered by a
#           one-character edit nobody reviews. Verify §2 has you delete BOTH and then
#           add a real `token:` field, so you see the test go red at least once.

# 5. NEGATIVE — no test reaches the real next/cache. A single missed vi.mock means
#    revalidateTag throws "Invariant: static generation store missing in
#    revalidateTag <tag>", which reads like a Next bug rather than a missing mock.
#    Match `next/cache` in ANY form. These files reach it with `await import(...)`,
#    never `from '...'`, because vi.mock is hoisted above static imports (Key
#    Concept 3) — so a grep for `from 'next/cache'` matches nothing, the loop body
#    never runs, and "no output" would be true whether or not anything were mocked.
grep -rl "next/cache" src --include='*.test.ts' | while read -r f; do
  grep -q "vi.mock('next/cache'" "$f" || echo "UNMOCKED: $f"
done
# Expected: no output, from a loop that DID run — the file list is non-empty.

# 6. NEGATIVE — the replay window is enforced even for a VALID signature
npx vitest run -t "rejects a STALE timestamp even with a perfect signature"
# Expected: 1 passed. This is the check people leave out, because a valid signature
#           feels like enough — and a captured request replayed six minutes later is
#           a request the attacker never had to sign.

# 7. NEGATIVE — a signature over a different body is refused
npx vitest run -t "rejects a signature computed over a DIFFERENT body"
# Expected: 1 passed. Together with check 6 this proves the signed string really is
#           `${timestamp}.${rawBody}` and not just the timestamp.

# 8. NEGATIVE — Zod cannot be reached without a signature. The order IS the property.
grep -n 'JSON.parse\|safeParse\|timingSafeEqual\|equals(' src/app/api/revalidate/route.ts
# Expected: the line numbers ascend in the order timestamp check → equals() →
#           JSON.parse → safeParse. If safeParse appears ABOVE equals(), an
#           unauthenticated caller can tell a schema failure from a signature
#           failure, and you have built a schema oracle.

# 9. NEGATIVE — the test-only branch is absent by default
npx vitest run -t "the test-only hook is a 404 unless E2E_MODE"
# Expected: 1 passed. 404, not 401: a 401 confirms there is something here to
#           authenticate against, which turns "does this deployment have a test
#           hook?" into a question with an answer.

# 10. The RSC refactor landed, and the decision now has exactly one home
grep -rn 'incidentSubmissionOpen !== false\|incidentSubmissionOpen === false' src/
# Expected: exactly ONE hit, in src/lib/incidents/submission.ts. Two files carried a
#           byte-identical copy of this comparison from Lesson 16.4 until now.
grep -rc 'isSubmissionOpen' src/actions/incidents.ts src/app/[locale]/incidents/submit/page.tsx
# Expected: 1 for each — both call sites read the same function

# 11. NEGATIVE — the lifted module has no server-only guard, and should not
grep -c "import 'server-only'" src/lib/incidents/submission.ts
# Expected: 0. It holds no secret and does no I/O — the same reasoning that keeps the
#           guard off tags.ts and errors.ts (Lesson 12.2 §7). Adding it here would
#           make the three-state test impossible for no benefit.

# 12. Break the predicate on purpose and count the failures
sed -i.bak 's/!== false/=== true/' src/lib/incidents/submission.ts
npx vitest run src/lib/incidents/submission.test.ts; echo "exit=$?"
mv src/lib/incidents/submission.ts.bak src/lib/incidents/submission.ts
# Expected: exit=1, and TWO tests fail, not one — the null case and the
#           absent-key case. That is the outage from Lesson 16.4 §5, caught in
#           fifty milliseconds instead of by a support ticket.

# 13. NEGATIVE — no RSC probe was committed
git status --short src/components/
# Expected: no output. The Step 7 probe is deleted. A committed probe becomes a test
#           asserting that React has a limitation, which is not your bug to pin.

# 14. NEGATIVE — no literal credential anywhere in the new tests
grep -rnE "SECRET *= *'|token *= *'[A-Za-z0-9]{20}" src --include='*.test.ts'
# Expected: no output. Every secret-shaped value in these files is `randomUUID()` at
#           run time or an obviously structural placeholder like
#           'header.payload.signature'. `__CHANGE_ME__` is the only placeholder
#           permitted in a tracked file, and no test needs one.

# 15. The strategy document gained one section and lost nothing
grep -c '^## ' ../docs/testing-strategy.md
# Expected: 12 — Lesson 12.1's six, Lesson 23.1's five, this lesson's one
grep -c 'flaky test is a broken test' ../docs/testing-strategy.md
# Expected: 1 — still there, still 12.1's sentence
grep -c 'TODO' ../docs/testing-strategy.md
# Expected: 0

# 16. Compiler and linter, including every new file
npm run type-check && npm run lint
# Expected: no output from either. `vi.mocked(revalidateTag)` carries the real
#           signature, so a wrong argument in toHaveBeenCalledWith is a COMPILE
#           error — which is a better place to find it than a test failure.

# 17. Coverage now reaches src/actions/ and the two route handlers
npm run test:coverage 2>&1 | grep -E 'actions|api/revalidate|api/auth|submission'
# Expected: rows for src/actions/incidents.ts, src/actions/auth.ts,
#           src/lib/incidents/submission.ts at or near 100%, and non-zero figures
#           for both route handlers. Lesson 23.2 widened coverage.include to
#           src/actions/**; this is the lesson that puts something in it.
```

Check 4 is the uncomfortable one and it is deliberately uncomfortable: it shows a passing negative
that proves nothing. Every regex-based assertion has that failure mode, and the only defence is
the discipline in Verify §2 — add the field you are forbidding, watch the test go red, take it
out again.


## Control Questions

1. `submitIncident` returns the identical `{ status: 'error', message }` object whether the session
   check runs before or after the WordPress call. Explain, in terms of what actually happens on
   the network, why those two versions are not equivalent — then say which assertion distinguishes
   them and why a Playwright spec structurally cannot.
2. The `incidentSubmissionOpen` kill switch treats `null` as **open**, and `src/lib/rate-limit.ts`
   treats a missing `UPSTASH_REDIS_REST_URL` as **refuse**. Both are "the value is absent". Give
   the one question that decides which default is correct, apply it to a third case of your own
   choosing, and say what the wrong answer costs in each direction.
3. `revalidateTag` is imported by `src/actions/incidents.ts` and never called, and this lesson's
   test asserts the absence. A reviewer calls that a missing feature and asks you to expire
   `incidents` on every submission. Give the argument against in terms of what a visitor pays,
   then name the one change to the moderation flow that would make the reviewer right.
4. `/api/revalidate` returns `400` with a reason for a bad timestamp and `401` with no body at all
   for a bad signature. Justify the asymmetry, then describe what an attacker learns if you make
   both of them `400 {"error": "..."}` with distinct messages — and say whether the same reasoning
   applies to the `404` on the test-only branch.
5. This lesson lifts three lines out of an async Server Component and Lesson 16.4's `grep`-based
   Verify check now returns `0` where it expected `1`, with the behaviour unchanged. Decide
   whether 16.4's check was wrong when it was written, and state the general rule you would give
   somebody about what a `## Verification` block should assert against.


## Learn More

- [Vitest — `vi.mock` and mocking](https://vitest.dev/api/vi.html#vi-mock) — hoisting, factories,
  `importOriginal` and `vi.hoisted`; read the hoisting paragraph before you write your first
  factory, not after the `ReferenceError`
- [Vitest — `vi.mocked`](https://vitest.dev/api/vi.html#vi-mocked) — how the original signature is
  preserved, which is what makes `toHaveBeenCalledWith` a compile-time check as well as a runtime one
- [Next.js — Server Actions and Mutations](https://nextjs.org/docs/app/getting-started/mutating-data)
  — the framework's own security guidance, including the reminder that a Server Action is a public
  HTTP endpoint whether or not anything on your site calls it
- [Next.js — `revalidateTag`](https://nextjs.org/docs/app/api-reference/functions/revalidateTag) —
  the exact semantics of a tag, and the note that it invalidates rather than refetches, which is
  the mechanism behind Key Concept 4's "warm entry, identical rebuild" argument
- [Next.js — Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route) —
  the exported-method convention that makes `POST` importable and callable, and the `dynamic`
  option both handlers set
- [MDN — Request](https://developer.mozilla.org/en-US/docs/Web/API/Request) — the standard object
  you construct in the webhook test, including why the body can only be read once
- [Node.js — `crypto.timingSafeEqual`](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b)
  — the length-mismatch throw that makes the explicit length check in `equals()` mandatory rather
  than an optimisation
- [OWASP — Unvalidated Redirects and Forwards Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html)
  — why `?next=//evil.test` is the case people forget, and the allowlist-shaped defence the two
  `safeNextPath` implementations use
- [Standard Webhooks — the specification](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)
  — signature-over-raw-body, timestamp tolerance for replay, and constant-time comparison, which is
  the checklist Lesson 18.3's handler was built against and this lesson's tests pin. OWASP has no
  webhook cheat sheet; this is the closest thing to a normative source

