---
title: 'Error Handling, Loading & Suspense'
module: 10
lesson: 4
teaches: [error-boundaries, error-tsx, not-found-tsx, suspense, streaming, graphql-error-shape]
produces: ['next-app/src/lib/graphql/errors.ts', 'next-app/src/app/[locale]/loading.tsx', 'next-app/src/app/[locale]/error.tsx', 'next-app/src/app/[locale]/not-found.tsx', 'next-app/src/app/global-error.tsx']
requires: [10.1, 10.3]
---

# Lesson 10.4 — Error Handling, Loading & Suspense

## Quick Overview

Everything built so far assumes WordPress answers, answers quickly, and answers correctly.
This lesson removes all three assumptions. You will map GraphQL's genuinely awkward error shape
into a single typed error class, add an `error.tsx` boundary that shows a useful page instead of
a blank one, add `not-found.tsx` so a bad slug looks deliberate, and add `loading.tsx` so a slow
query streams a skeleton instead of stalling the whole response.

The GraphQL detail worth arriving prepared for: **a GraphQL error is an HTTP 200.** Ask for a
field that does not exist, hit a depth limit, get a permission denial from a resolver, and the
transport says "fine" while the body says otherwise. So `if (!response.ok) throw` — the check
every HTTP client tutorial teaches — catches essentially none of the errors this stack actually
produces. Worse, partial success is normal: WPGraphQL will happily return `data` with one field
resolved and one field `null`, plus an `errors` array explaining why. Deciding what your client
does with a partial response is a design decision, and this lesson makes it explicitly rather
than by accident.

By the end of this lesson you will have:

- `next-app/src/lib/graphql/errors.ts` — a `GraphQLRequestError` carrying the operation name, the `errors` array and the HTTP status
- `next-app/src/app/[locale]/error.tsx` — a Client Component boundary with a working `reset()`
- `next-app/src/app/[locale]/not-found.tsx` and `next-app/src/app/global-error.tsx`
- `next-app/src/app/[locale]/loading.tsx` plus one in-page `<Suspense>` boundary around a slow section
- A written policy on partial responses, and a verified case where WordPress returns HTTP 200 with errors and the page fails safely

## Classic WP Analogy

WordPress's error story is `WP_Error`, and it trains a habit that transfers well:

| Classic WordPress | Next.js / React |
|---|---|
| `WP_Error` returned, not thrown | `GraphQLRequestError` thrown, caught by a boundary |
| `is_wp_error($result)` at every call site | one `throw` in the client, one boundary per route |
| `wp_die('Something went wrong')` | `error.tsx` |
| `status_header(404); get_404_template();` | `notFound()` and `not-found.tsx` |
| `WP_DEBUG` deciding how much detail to show | `process.env.NODE_ENV` deciding the same |
| A white screen from a fatal in a plugin | `global-error.tsx`, the last line of defence |

The valuable transfer is the discipline: `is_wp_error()` teaches you that a function returning
something is not the same as a function succeeding, which is exactly the lesson GraphQL's
200-with-errors response is trying to teach. And the `WP_DEBUG` habit — verbose locally, opaque
in production — is the right habit here too, for the same reason. A stack trace on a public
error page tells an attacker your file paths, your plugin versions, and often your queries.

The analogy breaks on **where** errors get handled, and it is a real conceptual shift.
`is_wp_error()` is checked at the call site, so error handling is scattered through the code
that does the work. React inverts it: you `throw`, and the nearest `error.tsx` above you in the
route tree catches it. Nothing in between needs a check. That is far less code, and it has one
sharp edge — the boundary catches errors thrown during **rendering**, and nothing else. An
error inside an event handler, a `setTimeout`, or a Server Action does not reach `error.tsx`,
and neither does an error thrown while a boundary is itself rendering, which is why
`global-error.tsx` exists.

The second break is that WordPress has no streaming equivalent. PHP builds the whole page and
then sends it, so a slow query is a slow blank browser tab. `loading.tsx` and `<Suspense>` let
Next send the shell immediately and stream the slow part in when it resolves — meaning the user
sees a header, a nav and a skeleton within milliseconds even when WordPress is thinking.
Combined with the Module 11 skeleton components, that turns a slow query from a bounce into a
non-event, and it is the single largest perceived-performance difference between this stack and
Classic WordPress.

---

## Key Concepts

### 1. A GraphQL error is an HTTP 200

The single most consequential fact in this lesson, and it is a design decision rather than an
accident: GraphQL treats the HTTP layer as transport only. If the server parsed your request,
the transport succeeded, and the transport says `200`. Whether the *query* succeeded is a
property of the body.

```
   ┌────────────────────────────────────────────────────────────────────┐
   │ HTTP/1.1 200 OK                                                   │
   │ content-type: application/json                                    │
   │                                                                   │
   │ { "errors": [                                                     │
   │     { "message": "Cannot query field \"notARealField\" on type    │
   │                   \"Incident\"." } ],                             │
   │   "data": null }                                                  │
   └────────────────────────────────────────────────────────────────────┘
              ▲
              └── `if (!response.ok) throw` sees nothing wrong here.
```

Which of this stack's failures produce a 200 with `errors`? Almost all of them:

| Failure | HTTP | Where it comes from |
|---|---|---|
| A field that does not exist | **200** | validation, before any resolver runs |
| A malformed variable type | **200** | validation |
| Depth or complexity refusal | **200** | Lesson 06.4's rules |
| A resolver denying permission | **200** | Module 06's guarded mutations |
| A resolver throwing a PHP exception | **200** | WPGraphQL catches it and reports it |
| A slug that matches nothing | **200**, `errors` absent, `data.incident` **null** | a successful query with an empty answer |
| WordPress container down | no response | transport |
| Apache 502 from a proxy | 502 | transport |

The house rule, stated in the same words every module uses: **read `.errors`, never the status
code.** And note the sixth row — a missing incident is not an error at all. It is a successful
query whose answer is `null`, which is why `notFound()` and `error.tsx` are different mechanisms
handling different things.

### 2. The error object's real shape

The GraphQL specification guarantees one field. Everything else is conventional, and WPGraphQL
follows the convention.

| Field | Guaranteed | What it holds |
|---|---|---|
| `message` | **yes** | a human-readable string, and the only thing you can rely on |
| `locations` | no | line and column **in your query text** — useless in production, useful in GraphiQL |
| `path` | no | the response path that failed, e.g. `["incident","incidentDetails"]` |
| `extensions` | no | anything the server wants; WPGraphQL puts `category` here |

`extensions.category` is WPGraphQL's own three-value classification, and it is the closest thing
you get to a machine-readable error code:

| `category` | Means | What you should do |
|---|---|---|
| `user` | the caller did something wrong | show a message; do not retry |
| `internal` | WordPress did something wrong | log it, show a boundary, page someone |
| `graphql` | the document is invalid | this is a **bug in your build**, not a runtime condition |

A `graphql` category in production means a document reached production that does not match the
schema in production — which is exactly the state `npm run codegen:check` and the committed
schema exist to make impossible. If you ever see one, the schema drifted and nobody ran
`npm run schema:pull`.

`locations` is worth one warning: it describes **your query**, so putting it in a log line puts
fragments of your query text in your logs, and putting it on a page puts them in a browser.
Key Concept 10 is about not doing that.

### 3. Partial responses are normal, and you must pick a policy

WPGraphQL will happily return this:

```json
{
  "data": { "incident": { "title": "DNS took down checkout", "incidentDetails": null } },
  "errors": [{ "message": "Internal server error", "extensions": { "category": "internal" } }]
}
```

One field resolved, one did not, and the response contains both halves. That is legal, common,
and the point at which a client has to make a decision. Three options:

| Option | Behaviour | Cost |
|---|---|---|
| **A.** Throw whenever `errors` is non-empty | loudest. Every partial becomes an error page | one null ACF sub-field takes down a whole page that could have rendered 95% of itself |
| **B.** Throw only when `data` is null or missing; otherwise log and render | the page renders; the failure is in the log | a silent degradation if nobody reads logs |
| **C.** Return `{ data, errors }` and let every caller decide | maximum flexibility | nineteen call sites each get it slightly differently — the exact problem Lesson 10.1 existed to remove |

**The verdict is B**, and the reason is proportionality. The errors this stack actually produces
in a partial response are small and local: one ACF sub-field a plugin could not resolve, one
node the caller may not read, one deprecated field. Failing a whole route because a sidebar
statistic came back null is a worse outcome for a reader than a page with a gap in it. Meanwhile
every failure that genuinely makes a page meaningless — validation, depth refusal, WordPress
down — produces `data: null`, and therefore throws under option B anyway.

The cost, stated plainly: **a partial response is a silent degradation until somebody reads the
log.** That is a real, accepted debt. Module 24 wires the log line into Sentry so that "somebody
reads the log" becomes true, and this lesson writes the policy into `docs/api-contract.md` so
that the decision is a decision rather than the shape of whatever got typed first.

Option C is worth naming as the one you would pick if this app had a route where partial data
was routinely meaningful — a dashboard aggregating six independent feeds, say. Blame The Tech
does not, and a per-caller policy that is "throw" nineteen times is nineteen chances to forget.

### 4. `GraphQLRequestError` — the error as data

A plain `Error` carrying a formatted string forces every consumer to parse prose. The class
carries the parts:

| Member | Type | Why |
|---|---|---|
| `operationName` | `string` | the one thing that makes a log line searchable |
| `status` | `number` | so a 502 and a 200-with-errors are distinguishable after the fact |
| `errors` | `readonly GraphQLErrorEntry[]` | the raw array, so `category` and `path` survive |
| `message` | `string` | the formatted summary, from `formatGraphQLErrors` |
| `toString()` | `string` | one line, safe to log — no query text, no `locations` |
| `cause` | `unknown` | the original transport failure, when there was one |

`toString()` being safe to log is not decoration. It is the method that gets called when someone
writes `console.error(\`failed: ${err}\`)` at four in the morning, and the whole point is that
the safe thing is the easy thing.

`isGraphQLRequestError()` exists because `catch` gives you `unknown`
(`useUnknownInCatchVariables`, on since Lesson 07.3) and `instanceof` in one place beats
`instanceof` in nineteen.

### 5. `error.tsx` is always a Client Component, and catches rendering only

Two constraints, and both surprise people.

**It must be a Client Component.** `'use client'` at the top, always, no exceptions. The reason
is `reset` — the boundary has to attach an event handler to a button and re-render its subtree
in the browser, which is client behaviour by definition. This is the one file in the App Router
whose directive is not a judgement call.

**It catches errors thrown during rendering, and nothing else.**

| Thrown from | Reaches `error.tsx`? |
|---|---|
| a Server Component's body, during render | ✅ |
| a Client Component's render | ✅ |
| `generateMetadata` | ✅ |
| an `onClick` handler | ❌ — nothing catches it; the browser logs it |
| a `setTimeout` or a promise you did not await | ❌ |
| a Server Action | ❌ — it returns a rejected promise to the caller (Module 16 handles this) |
| a Route Handler | ❌ — it is not in a React tree at all |
| the segment's own `layout.tsx` | ❌ — see Key Concept 6 |
| `error.tsx` itself | ❌ — see Key Concept 7 |

The first row is what matters here: every WordPress read in this app happens in a Server
Component's body, so `fetchGraphQL` throwing during render is exactly the case `error.tsx`
covers. That is not luck — it is why the data layer was built to `throw` rather than to return a
`WP_Error`-shaped result.

### 6. Where each boundary sits in the tree

This is the part people get wrong, and drawing it once fixes it permanently. `error.tsx` wraps
its segment's `page.tsx` **inside** that segment's `layout.tsx`. So the layout is not protected
by the error boundary that sits beside it.

```
   <GlobalError>                          src/app/global-error.tsx
     │                                    renders its own <html>/<body>
     └── [locale]/layout.tsx  ◀───────────  NOT wrapped by the error.tsx below it
           │
           └── <ErrorBoundary>             src/app/[locale]/error.tsx
                 │
                 └── <Suspense>            src/app/[locale]/loading.tsx
                       │
                       └── page.tsx  ──▶ incidents/page.tsx ──▶ [slug]/page.tsx
                             ▲
                             └── a throw here lands in the nearest boundary ABOVE it
```

Read the consequences off the diagram:

- A throw in `incidents/[slug]/page.tsx` is caught by `[locale]/error.tsx`, because that is the
  nearest boundary above it. Adding `incidents/error.tsx` later would catch it closer, keeping
  the incidents list chrome on screen.
- A throw in `[locale]/layout.tsx` is **not** caught by `[locale]/error.tsx`. It goes to the
  boundary above the layout — and `[locale]/layout.tsx` is the root layout of this app
  (there is no `src/app/layout.tsx`), so the only thing above it is `global-error.tsx`.
- `loading.tsx` sits *inside* the error boundary, which is the right order: a route that fails
  while streaming should show the error, not a spinner forever.

### 7. `global-error.tsx`, the last line of defence

`src/app/global-error.tsx` replaces the **entire** document when it renders, so it must supply
its own `<html>` and `<body>` — nothing above it will.

It is the only file in this app that sits outside `[locale]`, and that is deliberate. It has to
be reachable when the `[locale]` layout is the thing that broke, and it has no locale to read
because the route may never have matched one.

It catches three things nothing else does:

1. an error thrown by the root layout, `[locale]/layout.tsx`
2. an error thrown by `[locale]/error.tsx` while *it* was rendering
3. an error thrown so early that no segment boundary is mounted yet

> **Keep `global-error.tsx` boring, and keep it dependency-free.** It runs when your application
> is already failing, so a component import that itself throws turns the last line of defence
> into a blank page. No data fetching, no context, no design system — plain elements and one
> sentence. Lesson 11.2 will be tempting; resist it.

In development, Next shows its own error overlay in preference to `global-error.tsx`, which is
why check 6 of the Verification asserts the file's *contents* rather than trying to render it.

### 8. `not-found.tsx` and `notFound()`

`notFound()` is a function you call; `not-found.tsx` is the file that renders when you do. They
are a pair and the pair is not an error path.

| | `notFound()` | a thrown `GraphQLRequestError` |
|---|---|---|
| Means | the query worked and the answer was empty | the query did not work |
| HTTP status | **404** | **500** |
| Renders | `not-found.tsx` | `error.tsx` |
| Is it a bug | no | yes, somewhere |
| Should it be logged | no — 404s are traffic | yes |

Mechanically `notFound()` throws a special error that Next recognises, which is why it works
from inside a Server Component's body and why a `try/catch` around your fetch must not swallow
it. Before this lesson, `notFound()` in Module 09's routes fell through to Next's built-in 404
page, because there was no `not-found.tsx` above it. Now it renders yours.

There is no `[locale]` parameter available in `not-found.tsx` — Next renders it without the
route's params — so any link in it has to construct a locale itself. The app has one locale,
`en`, from `NEXT_PUBLIC_DEFAULT_LOCALE` per
[appendix 04 §3.2](../appendix/04-env-reference.md#32-public-next_public_--all-five-of-them);
Module 20 revisits it.

### 9. `loading.tsx`, `<Suspense>`, and where a spinner actually helps

`loading.tsx` is sugar. Next wraps the segment's `page.tsx` in a `<Suspense>` whose fallback is
your file. That is the entire mechanism.

| | `loading.tsx` | an explicit `<Suspense>` in the page |
|---|---|---|
| Granularity | the whole route | one section |
| While it shows, the user sees | the layout, and your fallback where the page would be | the layout **and the page**, with a hole |
| Written as | a file | a component boundary |
| Right for | a route whose page is one query | a page where one section is much slower than the rest |
| This lesson uses | both — the route-level file, plus one section boundary | |

The section boundary is the more interesting one, because it changes what streams. Next sends
the shell — `<html>`, the layout, everything outside the boundary — immediately, then streams
the section's HTML into place when its promise resolves. The reader gets a header, a nav and a
heading in a few tens of milliseconds even when WordPress is thinking.

Now the honest part, because this is where performance advice usually stops being honest:

> **A spinner that appears for 40 ms is worse than no spinner.** It is a flash of layout that
> the reader's eye tracks and then loses. If the section resolves fast, the fallback is visual
> noise; if it resolves slowly, the fallback is the only thing keeping the reader. Two rules
> follow. First, put a boundary around a section because you **measured** it as slow, not
> because boundaries feel tidy. Second, make the fallback the same shape as the content — a
> skeleton with the same box dimensions — so the arrival is a fill rather than a jump. Lesson
> 11.2 installs the shadcn `skeleton` component and Module 21 measures whether any of this
> helped.

The placeholder you write in this lesson is deliberately ugly and deliberately temporary. Lesson
11.2 replaces it, and it will be obvious when it has not been.

### 10. What you show in production, and what you show in development

Transfer the `WP_DEBUG` habit exactly. Verbose locally, opaque publicly, for the same reason.

A stack trace on a public error page tells an attacker your absolute file paths, your Node and
framework versions, your directory layout, often your query text, and occasionally an
environment variable name. That is a reconnaissance gift, and it is the direct equivalent of
`WP_DEBUG_DISPLAY` being on in production — which Lesson 02.2 kept out of the base Compose file
for precisely this reason.

Next already helps: **in a production build, an error thrown in a Server Component does not
reach the browser at all.** The client gets a generic message plus `error.digest`, a hash you can
grep for in the server log. That is the mechanism the boundary should lean on:

| | Development | Production |
|---|---|---|
| `error.message` | the real message | a generic string, replaced by Next |
| `error.digest` | present | **present — this is what you display** |
| Stack trace | in the overlay | not sent |
| Your `error.tsx` should render | the message, for you | your own copy plus the digest |

So `error.tsx` guards the detail block with `process.env.NODE_ENV !== 'production'`. Do not
rely solely on Next's redaction: your own boundary can leak, because anything *you* interpolate
into the page is sent verbatim. Verification check 5 greps a production response for
`/var/www`, an absolute path and an operation name, and expects zero.

---

## Task

### Step 1: Write `src/lib/graphql/errors.ts`

```ts
// next-app/src/lib/graphql/errors.ts
// The GraphQL error shape, one error class, one formatter. Imported by client.ts and,
// from Module 16, by the Server Actions.
//
// No `import 'server-only'` here, deliberately: this file is pure data mapping with no
// secret and no I/O, Module 12 unit-tests it in a plain Node process where the
// `server-only` module throws on purpose, and `error.tsx` is a Client Component that
// may want `isGraphQLRequestError`.

/** One entry from a GraphQL `errors` array. Only `message` is guaranteed by the spec. */
export type GraphQLErrorEntry = {
  readonly message: string;
  readonly locations?: readonly { readonly line: number; readonly column: number }[];
  readonly path?: readonly (string | number)[];
  readonly extensions?: Readonly<Record<string, unknown>>;
};

/** WPGraphQL's own classification, in `extensions.category`. */
export type WpGraphQLCategory = 'user' | 'internal' | 'graphql';

export function categoryOf(entry: GraphQLErrorEntry): WpGraphQLCategory | 'unknown' {
  const value = entry.extensions?.['category'];
  if (value === 'user' || value === 'internal' || value === 'graphql') {
    return value;
  }
  return 'unknown';
}

/**
 * One line per error: category, response path, message. Deliberately does NOT include
 * `locations`, because those are offsets into your query text and this string ends up
 * in logs.
 */
export function formatGraphQLErrors(errors: readonly GraphQLErrorEntry[]): string {
  if (errors.length === 0) {
    return 'no error detail';
  }
  return errors
    .map((entry) => {
      const at =
        entry.path !== undefined && entry.path.length > 0 ? ` at ${entry.path.join('.')}` : '';
      return `[${categoryOf(entry)}]${at} ${entry.message}`;
    })
    .join(' | ');
}

/** Every failure `fetchGraphQL` reports, transport and protocol alike. */
export class GraphQLRequestError extends Error {
  readonly operationName: string;
  readonly status: number;
  readonly errors: readonly GraphQLErrorEntry[];

  constructor(
    operationName: string,
    status: number,
    errors: readonly GraphQLErrorEntry[],
    options?: { readonly cause?: unknown }
  ) {
    super(`${operationName}: ${formatGraphQLErrors(errors)}`, options);
    this.name = 'GraphQLRequestError';
    this.operationName = operationName;
    this.status = status;
    this.errors = errors;
  }

  /** One log-safe line. No query text, no `locations`, no stack. */
  toString(): string {
    return `GraphQLRequestError(${this.operationName}, HTTP ${this.status}): ${formatGraphQLErrors(
      this.errors
    )}`;
  }
}

/** `catch` gives you `unknown`. One narrowing helper beats nineteen `instanceof` checks. */
export function isGraphQLRequestError(value: unknown): value is GraphQLRequestError {
  return value instanceof GraphQLRequestError;
}
```

**Verify §1:**

- [ ] `npm run type-check` is silent.
- [ ] `formatGraphQLErrors([])` returns `'no error detail'` rather than an empty string. An
      empty log line is worse than a useless one, because you cannot search for it.
- [ ] Nothing in this file imports from `src/lib/graphql/client.ts`. The dependency runs one way.

### Step 2: Rework the client's throw sites

Three edits to `src/lib/graphql/client.ts`. This is an edit, not a new file — do not add
`client.ts` to this lesson's `produces:`.

```ts
// next-app/src/lib/graphql/client.ts — replace the local envelope types with imports
import { GraphQLRequestError } from '@/lib/graphql/errors';
import type { GraphQLErrorEntry } from '@/lib/graphql/errors';

// DELETE the local `type GraphQLErrorEntry = { readonly message: string };`
// The imported one carries `path` and `extensions` too.
```

```ts
// next-app/src/lib/graphql/client.ts — the transport throws, now typed
// (inside execute's catch block)
throw new GraphQLRequestError(
  operationName,
  0, // no response, so no status
  [{ message: `no response from WordPress within ${TIMEOUT_MS} ms` }],
  { cause }
);

// (replacing the !response.ok branch)
throw new GraphQLRequestError(operationName, response.status, [
  { message: `HTTP ${response.status} ${response.statusText}` },
]);
```

```ts
// next-app/src/lib/graphql/client.ts — the partial-response policy from Key Concept 3
const hasErrors = parsed.errors !== undefined && parsed.errors.length > 0;
const hasData = parsed.data !== undefined && parsed.data !== null;

if (hasErrors && !hasData) {
  // Nothing usable came back. Throw; the nearest error.tsx renders.
  throw new GraphQLRequestError(operationName, response.status, parsed.errors ?? []);
}
if (hasErrors) {
  // PARTIAL: data AND errors. Policy B — log it, render what arrived. The accepted
  // cost is a silent degradation until someone reads this line; Module 24 ships it
  // to Sentry. Written up in docs/api-contract.md by Step 8.
  console.error(
    new GraphQLRequestError(operationName, response.status, parsed.errors ?? []).toString()
  );
}
if (!hasData) {
  throw new GraphQLRequestError(operationName, response.status, [
    { message: 'the response contained neither data nor errors' },
  ]);
}
return parsed.data;
```

**Verify §2:**

- [ ] `grep -c 'new Error(' src/lib/graphql/client.ts` prints `1` — only `requireEndpoint`
      still throws a plain `Error`, and it throws at module load where no boundary exists yet.
- [ ] `npm run type-check` is silent.
- [ ] `parsed.data` is returned narrowed, without a cast.

### Step 3: Write the route-level boundaries

```tsx
// next-app/src/app/[locale]/error.tsx
// ALWAYS a Client Component: `reset` is an event handler.
'use client';

import { useEffect } from 'react';

type Props = {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
};

export default function RouteError({ error, reset }: Props) {
  useEffect(() => {
    // Module 24 replaces this with a Sentry call.
    console.error(error);
  }, [error]);

  return (
    <main>
      <h1>Something broke on our side.</h1>
      <p>
        The incident log is having an incident. Appropriate, and still annoying. Try again — if
        it keeps failing, the problem is ours and we can see it.
      </p>
      {/* `digest` is the only server-side identifier that is safe to show: a hash you can
          quote to us and we can grep for. The message itself is replaced by Next in a
          production build, and shown here only in development. */}
      {error.digest !== undefined ? <p>Reference: {error.digest}</p> : null}
      {process.env.NODE_ENV !== 'production' ? <pre>{error.message}</pre> : null}
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
```

```tsx
// next-app/src/app/[locale]/not-found.tsx
// A Server Component. 404 is traffic, not an error — nothing is logged here.
import Link from 'next/link';

const LOCALE = process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'en';

export default function NotFound() {
  return (
    <main>
      <h1>No such incident.</h1>
      <p>Nobody has been blamed for this URL yet. You could be the first.</p>
      <Link href={`/${LOCALE}/incidents`}>Back to the incident log</Link>
    </main>
  );
}
```

```tsx
// next-app/src/app/[locale]/loading.tsx
// Next wraps this segment's page in <Suspense fallback={<Loading />}>. That is all it is.
// Lesson 11.2 replaces the placeholder with the shadcn `skeleton` component, and Module
// 22 reviews the aria attributes.
export default function Loading() {
  return (
    <main aria-busy="true">
      <p>Collating blame…</p>
    </main>
  );
}
```

**Verify §3:**

- [ ] `error.tsx` line 1 (after the comments) is `'use client';`. Remove it and read the build
      error, then put it back — that error message is worth seeing once.
- [ ] All three files `export default`. A named export renders nothing and reports nothing.
- [ ] `npm run dev`, then visit `/en/incidents/definitely-not-a-real-slug`. You get **your**
      404 copy, not Next's default page.

### Step 4: Write `src/app/global-error.tsx`

Note the path: **outside** `[locale]`, because it must work when the locale layout is the thing
that failed.

```tsx
// next-app/src/app/global-error.tsx
// The last line of defence. Renders its own <html>/<body> because it REPLACES the
// document — nothing above it will provide them. Keep it dependency-free: this runs
// when the app is already failing.
'use client';

type Props = {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
};

export default function GlobalError({ error }: Props) {
  return (
    <html lang="en">
      <body>
        <h1>Blame The Tech is down.</h1>
        <p>This one is genuinely our fault. Reload in a minute.</p>
        {error.digest !== undefined ? <p>Reference: {error.digest}</p> : null}
      </body>
    </html>
  );
}
```

`reset` is declared in `Props` and deliberately not destructured — `noUnusedLocals` has been on
since Lesson 07.3, and a "try again" button is not useful when the failure is the root layout.

**Verify §4:**

- [ ] The file contains `<html` and `<body`. Without them the page renders as fragments inside
      nothing and browsers do unpredictable things.
- [ ] It imports nothing except React's types.
- [ ] `npm run build` succeeds. In development Next shows its own overlay instead of this file,
      which is why you verify its contents rather than its rendering.

### Step 5: Add one in-page `<Suspense>` boundary

Put a boundary around the slowest section of the homepage, so the shell streams immediately.

```tsx
// next-app/src/app/[locale]/page.tsx — the slow section, behind its own boundary
import { Suspense } from 'react';
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag } from '@/lib/graphql/tags';
import { IncidentsListDocument } from '@/gql/graphql';

// Deliberately ugly and deliberately temporary. Lesson 11.2 replaces this with the
// shadcn `skeleton` component, at the same box dimensions as the real list.
function FeedSkeleton() {
  return <div aria-hidden="true">░░░░░░░░  ░░░░░  ░░░░░░░░░</div>;
}

async function RecentIncidents() {
  const data = await fetchGraphQL(
    IncidentsListDocument,
    { first: 6 },
    { revalidate: 300, tags: [listTag('incident')] }
  );
  return (
    <ul>
      {(data.incidents?.nodes ?? []).map((node) => (
        <li key={node.id}>{node.title}</li>
      ))}
    </ul>
  );
}

// …and in the page body, around that component only:
//   <Suspense fallback={<FeedSkeleton />}>
//     <RecentIncidents />
//   </Suspense>
```

The component is `async` and it is not awaited by the page — that is what makes it suspend
rather than block. Everything outside the `<Suspense>` is sent first.

**Verify §5:**

- [ ] `curl -N http://localhost:3000/en` against `npm run dev` shows the heading arriving before
      the incident list. If the whole body arrives at once, the boundary is not around the
      awaiting component.
- [ ] Removing the `<Suspense>` and reloading makes the whole response wait. Put it back.

### Step 6: Force a real 200-with-errors, and read it

```bash
curl -s -o /tmp/badfield.json -w 'HTTP %{http_code}\n' -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1){ nodes{ notARealField } } }"}'

jq -r '.errors[0].message' /tmp/badfield.json
jq -r '.data' /tmp/badfield.json
jq -r '.errors[0].extensions.category // "absent"' /tmp/badfield.json
```

**Verify §6:**

- [ ] The status line said `HTTP 200`. Sit with that for a second — this is the headline of the
      lesson, and you just produced it in one command.
- [ ] The message begins `Cannot query field "notARealField" on type "Incident".` It may be
      followed by a "Did you mean" suggestion; graphql-php adds one when it can.
- [ ] `.data` is `null`, so this is the non-partial case, and Policy B throws for it.
- [ ] The category is `graphql` — meaning "your document does not match the schema", which in
      production would mean the schema drifted. Locally it means you typed a bad field on
      purpose.

Now the depth refusal from Lesson 06.4, for contrast — also 200, also `errors`, different
category:

```bash
curl -s -o /tmp/deep.json -w 'HTTP %{http_code}\n' -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1){ nodes{ author{ node{ posts(first:1){ nodes{ author{ node{ posts(first:1){ nodes{ author{ node{ posts(first:1){ nodes{ author{ node{ posts(first:1){ nodes{ id } } } } } } } } } } } } } } } } } } }"}'
jq -r '.errors[0].message' /tmp/deep.json
# Expected: a message about query depth naming the limit 10
```

### Step 7: Reach both boundaries

The 404 boundary, against a running app:

```bash
npm run dev & DEV_PID=$!
sleep 6
curl -s -o /tmp/nf.html -w 'HTTP %{http_code}\n' \
  http://localhost:3000/en/incidents/definitely-not-a-real-slug
grep -c 'No such incident' /tmp/nf.html
kill "$DEV_PID"
```

The error boundary, by pointing the app at a port where nothing listens. Next does not overwrite
a variable that is already in the environment, so this beats editing `.env.local`:

```bash
WP_GRAPHQL_ENDPOINT=http://127.0.0.1:9/graphql npm run dev & DEV_PID=$!
sleep 6
curl -s http://localhost:3000/en/incidents | grep -c 'Something broke on our side'
kill "$DEV_PID"
```

**Verify §7:**

- [ ] The 404 returned status **404**, not 200, and the body contains your copy. A soft 404 —
      your page with a 200 status — is an SEO bug Module 19 would have to fix.
- [ ] The error page contains your copy and, in development, the real message in the `<pre>`.
- [ ] Port 9 refuses immediately, so you see the failure in under a second rather than after the
      eight-second timeout. Both paths produce the same boundary.

### Step 8: Write the partial-response policy, then commit

Append to `docs/api-contract.md`, under a new `## GraphQL error policy (Lesson 10.4)` heading:

```markdown
`fetchGraphQL` maps GraphQL's two-hundred-with-errors response as follows.

| Response | Client behaviour |
|---|---|
| `data` present, no `errors` | return `data` |
| `data` present, `errors` present | **log `GraphQLRequestError.toString()`, return `data`** |
| `data` null or absent, `errors` present | throw `GraphQLRequestError` |
| Neither | throw `GraphQLRequestError` |
| Non-2xx, or no response at all | throw `GraphQLRequestError` with `status` 0 or the real status |

Accepted cost: a partial response degrades the page silently until somebody reads the log.
Module 24 sends that log line to Sentry, which is what makes the policy honest.

Never shown to a browser: `error.message` in production, `locations` anywhere, the query
text, a file path, or a stack. The error page shows our own copy plus `error.digest`.
```

```bash
cd next-app
npm run verify
git add -A
git commit -m "feat(next): typed GraphQL errors, route boundaries and a streaming section"
```

---

## Verification

```bash
cd next-app

# 1. THE headline check — a GraphQL failure is an HTTP 200
curl -s -o /tmp/badfield.json -w 'HTTP %{http_code}\n' -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1){ nodes{ notARealField } } }"}'
# Expected: HTTP 200
jq -r '.errors[0].message' /tmp/badfield.json
# Expected: a message starting  Cannot query field "notARealField" on type "Incident".
jq -r '.data' /tmp/badfield.json
# Expected: null
jq -r '.errors[0].extensions.category // "absent"' /tmp/badfield.json
# Expected: graphql

# 2. Types and lint clean, and the client throws only the typed error
npm run type-check && npm run lint
# Expected: no output
grep -c 'new Error(' src/lib/graphql/client.ts
# Expected: 1 — the module-load endpoint check, which no boundary could catch anyway
grep -c 'GraphQLRequestError' src/lib/graphql/client.ts
# Expected: 5 or more

# 3. All four boundary files exist, in the right places
ls 'src/app/[locale]/error.tsx' 'src/app/[locale]/loading.tsx' \
   'src/app/[locale]/not-found.tsx' src/app/global-error.tsx
# Expected: all four listed. Note global-error.tsx is OUTSIDE [locale].

# 4. A bad slug renders YOUR 404, with a 404 status
npm run dev & DEV_PID=$!
sleep 6
curl -s -o /tmp/nf.html -w 'HTTP %{http_code}\n' \
  http://localhost:3000/en/incidents/definitely-not-a-real-slug
# Expected: HTTP 404 — not 200. A soft 404 is an SEO bug.
grep -c 'No such incident' /tmp/nf.html
# Expected: 1
kill "$DEV_PID"

# 5. The error boundary is reachable, and says what you wrote
WP_GRAPHQL_ENDPOINT=http://127.0.0.1:9/graphql npm run dev & DEV_PID=$!
sleep 6
curl -s http://localhost:3000/en/incidents | grep -c 'Something broke on our side'
# Expected: 1 or more
kill "$DEV_PID"

# 6. NEGATIVE — a PRODUCTION error page leaks no stack trace, no path, no query text.
#    Build with WordPress up, then stop it and request a slug that was never
#    prerendered, so the render happens on demand and fails.
npm run build
npm run start & SERVER_PID=$!
sleep 6
docker compose -f ../wordpress-headless/docker-compose.yml stop wordpress
curl -s -o /tmp/prod-error.html -w 'HTTP %{http_code}\n' \
  http://localhost:3000/en/incidents/never-prerendered-slug
# Expected: HTTP 500 — the on-demand render failed, as designed
grep -c 'Something broke on our side' /tmp/prod-error.html
# Expected: 1 — your boundary rendered
grep -c '/Users/\|/var/www\|node_modules\|query IncidentsList\|GraphQLRequestError' /tmp/prod-error.html
# Expected: 0 — no path, no query text, not even the error class name
grep -c 'Reference:' /tmp/prod-error.html
# Expected: 1 — the digest, which is the ONLY server-side identifier you show
docker compose -f ../wordpress-headless/docker-compose.yml start wordpress
kill "$SERVER_PID"

# 7. NEGATIVE — the error boundary carries the client directive
grep -L "'use client'" 'src/app/[locale]/error.tsx'
# Expected: NO OUTPUT. grep -L prints files that do NOT match, so a filename here
#           means the directive is missing and the boundary will not build.
grep -L "'use client'" src/app/global-error.tsx
# Expected: no output

# 8. NEGATIVE — nothing renders a raw message unconditionally
grep -n 'NODE_ENV' 'src/app/[locale]/error.tsx'
# Expected: one hit, guarding the <pre>. If error.message is rendered outside that
#           guard, Next's own redaction is the only thing between you and a leak.
grep -c 'locations' 'src/app/[locale]/error.tsx' src/lib/graphql/errors.ts
# Expected: 0 for error.tsx; 1 for errors.ts (the type declaration only —
#           formatGraphQLErrors never reads it)

# 9. The policy is written down where Module 24 will look for it
grep -c 'GraphQL error policy' ../docs/api-contract.md
# Expected: 1
```

If check 6 returns HTTP 200 rather than 500, the slug you asked for was prerendered by
`generateStaticParams`. Pick a slug that is certainly not in the seed data and try again — the
check needs an on-demand render to have anything to fail.

## Control Questions

1. `if (!response.ok) throw` is the check every HTTP client tutorial teaches. List four failures
   this stack produces that it does not catch, and the one it does.
2. Policy B logs a partial response and renders. State the accepted cost in one sentence, name
   the module that pays it off, and describe the shape of app for which Policy C would be the
   right choice instead.
3. A throw in `src/app/[locale]/layout.tsx` does not reach `src/app/[locale]/error.tsx`.
   Explain why from the boundary tree, and say which file does catch it and what that file must
   render that no other boundary needs to.
4. `error.digest` is safe to display and `error.message` is not, in production. Explain what
   Next does to each one, and why your own `error.tsx` still needs a `NODE_ENV` guard even
   though Next already redacts.
5. A `<Suspense>` boundary around a section that resolves in 40 ms makes the page measurably
   worse. Explain the mechanism, and give the two rules that follow for deciding where a
   boundary goes.

## Learn More

- [Next.js — `error.js`](https://nextjs.org/docs/app/api-reference/file-conventions/error) — the
  props, the `'use client'` requirement, and what the boundary does and does not catch
- [Next.js — `not-found.js`](https://nextjs.org/docs/app/api-reference/file-conventions/not-found)
  and [`notFound()`](https://nextjs.org/docs/app/api-reference/functions/not-found) — the pair
  from Key Concept 8, and the status code each produces
- [Next.js — `loading.js`](https://nextjs.org/docs/app/api-reference/file-conventions/loading) —
  the implicit `<Suspense>`, in the framework's own words
- [Next.js — error handling](https://nextjs.org/docs/app/getting-started/error-handling) — the
  expected-versus-uncaught distinction, which is the same distinction as `notFound()` versus a
  thrown error
- [React — `<Suspense>`](https://react.dev/reference/react/Suspense) — what suspends, what does
  not, and why an `async` component you do not await is the trigger
- [The GraphQL specification](https://spec.graphql.org/October2021/) — the errors section
  defines `message`, `locations`, `path` and `extensions`, and says which are optional
- [WPGraphQL — debugging](https://www.wpgraphql.com/docs/debugging) — what
  `extensions.category` and `extensions.debug` contain, and why `graphql_debug` is off outside
  `local`
- [MDN — `Error.cause`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause)
  — how the transport failure stays attached to the typed error without reaching a page
