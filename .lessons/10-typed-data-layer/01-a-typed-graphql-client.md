---
title: 'A Typed GraphQL Client'
module: 10
lesson: 1
teaches: [graphql-client, typed-document-node, server-only, fetch-graphql, fetch-graphql-authed]
produces: ['next-app/src/lib/graphql/client.ts']
requires: [9.5, 6.4]
---

# Lesson 10.1 — A Typed GraphQL Client

## Quick Overview

Right now every route calls `fetch` with a hand-assembled body and its own error handling.
This lesson collapses all of that into one module, `src/lib/graphql/client.ts`, exporting
exactly two functions. It is about fifty lines of native `fetch` — no Apollo Client, no urql,
no `graphql-request`. That is a deliberate, opinionated choice and the lesson argues it in
full, because it is the decision that makes the rest of Module 10 and all of Module 18
possible.

The short version: those libraries exist to solve problems React Server Components do not
have. A normalised client-side cache is worthless when the component runs once on the server
and never re-renders. What you actually need is precise control over Next's own `fetch` cache —
`next: { revalidate, tags }` — and every wrapper either hides those options or requires a
custom exchange to reach them. Fifty lines you own beats forty kilobytes that fights you. The
second half of the lesson is the security shape: `fetchGraphQL` is public and cacheable,
`fetchGraphQLAuthed` hard-codes `cache: 'no-store'` with no way to override it, and the module
opens with `import 'server-only'` so importing it from a Client Component is a build error
rather than a leaked token.

By the end of this lesson you will have:

- `next-app/src/lib/graphql/client.ts` guarded by `import 'server-only'`
- `fetchGraphQL(document, variables, options)` — public reads, accepting `revalidate` and `tags`
- `fetchGraphQLAuthed(document, variables, token)` — authenticated calls, `cache: 'no-store'` not overridable
- A generic signature over `TypedDocumentNode<Result, Variables>`, so no call site passes a type argument
- Every route from Module 09 migrated off inline `fetch`, and a written decision record for why the client is not Apollo

## Classic WP Analogy

Every serious WordPress plugin you have written contains this file. It is the thin wrapper
around `wp_remote_post()` that sets the headers, JSON-encodes the body, checks
`is_wp_error()`, decodes the response and hands back either data or an error — so that
nineteen call sites do not each get it slightly wrong.

| Classic WordPress | This client |
|---|---|
| `wp_remote_post($url, $args)` | `fetch(endpoint, { method: 'POST', … })` |
| `'headers' => ['Content-Type' => 'application/json']` | the same, set once in the wrapper |
| `wp_json_encode($body)` | `JSON.stringify({ query, variables })` |
| `is_wp_error($res)` then `wp_remote_retrieve_body()` | one `try` / `throw` path in the wrapper |
| `get_transient()` / `set_transient()` around the call | `next: { revalidate, tags }` on the same call |
| `$args['timeout']` | `AbortSignal.timeout()` |

The reason you wrote that wrapper in PHP is exactly the reason you are writing this one:
consistency at the boundary. One place to add a timeout, one place to add a header, one place
to decide what an error looks like.

The analogy breaks at the cache, and the break is the whole point of the module. Around
`wp_remote_post()` you write your caching yourself: pick a transient key, decide an expiry,
remember to delete it. Next's `fetch` **is** the cache — it keys entries on the full request
(URL, method, body and headers), so you never choose a key, and you get request memoization
inside a single render for free. That is more powerful and much less obvious, and it is why
wrapping `fetch` in something that owns its own cache is actively harmful here: two caches
disagreeing about the same data is worse than one cache you understand.

The second break has no WordPress counterpart at all. In PHP there is one process, one user,
one request, and a transient you set during an authenticated request is visible to the next
anonymous visitor only if you were careless with the key. In Next, the `fetch` cache is
**shared across users and persists across requests**, so caching an authenticated response is
not a bug you might get away with — it is one user seeing another user's data. That is why
there are two functions and not one with an `authenticated: true` flag. A flag is something you
can forget; a separate function whose cache mode is not a parameter is something you cannot get
wrong. See [appendix 04 §4](../appendix/04-env-reference.md#4-the-two-credentials) for which
credential each one carries.

---

## Key Concepts

### 1. `server-only` is a package, not a convention

A comment saying "do not import this on the client" is enforced by nobody. `import 'server-only'`
is enforced by the module resolver.

The package is about eight lines long. Its `package.json` maps the same specifier to two
different files depending on the **export condition** the bundler is resolving under:

```
                         resolving `import 'server-only'`
                                      │
              ┌───────────────────────┴───────────────────────┐
              │                                               │
   condition "react-server"                          condition "default"
   (the server graph)                                (the browser graph)
              │                                               │
        ./empty.js                                      ./index.js
        does nothing                          throws at module evaluation:
                                        "This module cannot be imported from a
                                         Client Component module."
```

So the guard is not a runtime check that fires when a user does something. It fires when
**webpack or Turbopack builds the client graph**, discovers a throwing module at the root of it,
and refuses to emit a bundle. You find out at `npm run build`, in CI, before anything ships.

| | A comment | `import 'server-only'` |
|---|---|---|
| Catches an accidental import | no | **yes** |
| Catches it when | never | at build time |
| Survives a refactor | no | yes |
| Survives a new team member | no | yes |
| Cost | zero | one line, one dependency |

Two consequences bite later. The guard protects the whole **import graph**, not just the file —
a Client Component importing a helper that imports `client.ts` still fails the build, because
the transitive path is what the bundler walks. And the throwing module also throws under **plain
Node**, which resolves the `default` condition too: Module 12 unit-tests pure functions in a
plain Node process, so a file that is genuinely just string manipulation must **not** be marked
`server-only`. This lesson marks `client.ts`, which reads `process.env` and opens sockets;
Lesson 10.3's `tags.ts` and Lesson 10.4's `errors.ts` are deliberately left unmarked, and each
says why in one line.

> **Do not reach for `server-only` as a substitute for keeping a secret out of the client.**
> It stops an import; it does not classify data. The reason `WP_GRAPHQL_ENDPOINT` never reaches
> the browser is that it has no `NEXT_PUBLIC_` prefix — that is the actual control, and
> [appendix 04 §1 rule 4](../appendix/04-env-reference.md#1-the-five-rules) states it. The
> `server-only` import is the belt to that pair of braces.

### 2. Why the client is not Apollo, urql or `graphql-request`

The [module README](README.md#why-the-client-is-not-apollo-urql-or-graphql-request) records the
verdict. Here is the argument, because "we wrote our own" needs to survive a code review.

Apollo Client and urql are excellent, and almost all of what they are excellent at is **client
side**: a normalised cache keyed by `__typename` and `id`, so that a mutation returning an
updated `Incident` silently refreshes the fourteen components rendering it; optimistic updates;
subscriptions; a React hook that manages loading and error state across re-renders.

Now count how many of those a React Server Component can use. The component runs once, on the
server, produces HTML, and is gone. There is no second render for a cache to serve, no
component tree to notify, no local state to reconcile. A normalised cache in that setting is a
`Map` that is populated and then discarded.

Meanwhile the thing you genuinely need is `next: { revalidate, tags }` on the `fetch` call — the
mechanism Lesson 10.3 builds the cache policy on and Module 18 invalidates from WordPress.
Reaching it through a client library means writing a custom Apollo link or urql exchange whose
entire job is to pass two options through to a `fetch` you no longer control. `graphql-request`
is smaller and closer to the metal, but it still owns the `fetch` call and does not surface
Next's extensions.

| | Apollo Client / urql | `graphql-request` | **`fetch` + codegen** |
|---|---|---|---|
| Normalised cache | yes, and unused in an RSC | no | not needed |
| `next: { revalidate, tags }` | custom link / exchange | not exposed | a plain `fetch` option |
| Bundle cost if it leaks client-side | tens of kilobytes | small | zero |
| Lines you own | zero, until you debug them | zero | about a hundred and twenty |
| Hooks, optimistic updates, subscriptions | yes | no | no |
| Verdict | ❌ solves problems RSC does not have | ❌ hides the caching story | ✅ |

And the honest counter-case, because the verdict is conditional on this app:

**If Blame The Tech were a heavily interactive client-side application** — a dashboard where a
mutation must update eleven views, an editor with optimistic writes, anything with GraphQL
subscriptions — **Apollo would be the right answer and this chapter would be wrong.** The
decision is not "hand-rolled is better". It is "a normalised cache is a client-side tool, and
this app's reads all happen on the server". That distinction is what goes in ADR 0007, and the
ADR also names the condition that would reverse it: the first time a Client Component needs to
issue a GraphQL request, reopen the decision rather than smuggling a second data layer in.

### 3. `TypedDocumentNode<TResult, TVariables>` — a document that carries its own types

Lesson 07.4 wrote this signature:

```ts
// next-app/scripts/blame.ts — Lesson 07.4 (illustration)
const data = await fetchGraphQL<BlameBoardData, { first: number }>(QUERY, { first: 10 });
```

Two type arguments, supplied by the caller. `BlameBoardData` is a promise the caller made to the
compiler about a string the compiler never read. That is the Lesson 09.3 drift problem exactly,
one layer up: nothing connects `QUERY` to `BlameBoardData`, so editing one and forgetting the
other compiles cleanly.

`TypedDocumentNode` attaches the types to the document instead:

```ts
// (illustration) — the phantom property is the whole trick
type TypedDocumentNode<TResult, TVariables> = DocumentNode & {
  readonly __apiType?: (variables: TVariables) => TResult;
};
```

`__apiType` is never assigned, never called, and does not exist at runtime. Its only job is to
give the two type parameters somewhere to live so TypeScript can recover them at a call site:

```ts
// (illustration) — no type arguments, and both sides are checked
const data = await fetchGraphQL(IncidentsListDocument, { first: 12 });
//    ^? IncidentsListQuery                             ^ checked against IncidentsListQueryVariables
```

Walk the signature you are about to write:

| Part | Meaning |
|---|---|
| `<TResult, TVariables extends Record<string, unknown>>` | inferred, never written at the call site |
| `document: TypedDocumentNode<TResult, TVariables>` | the single argument that decides both |
| `variables?: TVariables` | optional, because `SiteChrome` takes none |
| `options?: FetchGraphQLOptions` | cache posture only — no `headers`, no `method`, no `cache` |
| `Promise<TResult>` | the `data` field, unwrapped, never the envelope |

> **Notice that `__apiType` is *optional*, and sit with what that implies.** A plain
> `DocumentNode` — anything `parse()` returns — therefore satisfies
> `TypedDocumentNode<Anything, Anything>` structurally, with no cast. That is not a flaw in the
> pattern; it is the pattern's honest boundary. The type is only trustworthy when a tool that
> read the schema produced the document. Step 2 exports a `untypedDocument()` helper that
> exploits exactly this hole so the Module 09 routes keep working for one more lesson, and
> Lesson 10.2 deletes it.

### 4. Two functions, and why not one with a flag

The tempting API is one function with an option:

```ts
// (illustration) — the version this course does NOT ship
fetchGraphQL(document, variables, { token, revalidate: 3600 });
```

It is smaller. It is also a data leak waiting for a distracted afternoon, because
`{ token, revalidate: 3600 }` is a request to put an authenticated response into a cache shared
by every visitor, and it is spelled exactly like something reasonable.

| | `fetchGraphQL` | `fetchGraphQLAuthed` |
|---|---|---|
| Credential | none | `Authorization: Bearer <token>` |
| Cache posture | caller's choice: `revalidate`, `tags` | **`cache: 'no-store'`, written in the function body** |
| Can a caller override it | n/a | **no — there is no options parameter** |
| Callers | Server Components, `generateStaticParams`, public Route Handlers | Server Actions, authenticated Route Handlers |
| Introduced by | this lesson | this lesson; the token arrives in Module 15 |

The rule this expresses is worth naming, because it recurs in Modules 15 and 16: **make the
dangerous state unrepresentable rather than discouraged.** A flag is something you can forget. A
function whose cache mode is not a parameter is something you cannot get wrong, and the proof is
mechanical — `fetchGraphQLAuthed`'s signature has three parameters and none of them is an
options bag.

`token` is a **parameter**, not an environment read. `client.ts` never learns where credentials
come from. Module 15 passes a user JWT read from an httpOnly cookie; Module 16 passes the app
token for server-to-server mutations. Both are described in
[appendix 04 §4](../appendix/04-env-reference.md#4-the-two-credentials), and neither is this
lesson's business.

### 5. You do not choose the cache key

Next's `fetch` cache keys an entry on the **whole request** — method, URL, body, headers.

```
   fetchGraphQL(IncidentsListDocument, { first: 12 })
        │
        ▼
   POST http://localhost:8080/graphql
   content-type: application/json
   {"query":"query IncidentsList($first: Int!, ...) {...}","variables":{"first":12}}
        │
        ▼
   ┌──────────────────────────── data cache key ───────────────────────────┐
   │  hash( method + url + body + headers )                               │
   └───────────────────────────────────────────────────────────────────────┘
```

Two consequences, both of which surprise people who arrive from transients.

**Collisions are impossible.** You never name a key, so you can never reuse one by accident.
That removes a whole class of WordPress bug — the transient key that forgot to include the
paged offset.

**Precise invalidation is impossible too.** You cannot say "drop the entry for
`IncidentsList` with `first: 12`", because you do not have a handle on it. Tags exist purely to
give you one, and Lesson 10.3 is about nothing else.

The corollary that catches everyone: **two calls with the same document and the same variables
are the same cache entry.** Same query, `{ first: 12 }` twice, one entry — which is why the
layout and a page can both ask for site settings and WordPress sees one request. Change
`first` to `13` and it is a different entry, even though the second result contains the first.
Add a variable your query ignores and you have silently doubled your cache footprint.

### 6. The cache is shared across users and outlives the request

A WordPress transient is per-site and per-installation, and the mental model that comes with it
is roughly "a cache my code owns". Next's data cache is **per deployment**, persists across
requests, and is read by every visitor.

| | `set_transient()` | Next data cache |
|---|---|---|
| Scope | one WordPress install | one deployment |
| Lifetime | until expiry or `delete_transient()` | until `revalidate` elapses or a tag is invalidated |
| Who reads it | the next request to that site | **every visitor, including anonymous ones** |
| Keyed by | a string you chose | the full request, hashed |
| Cleared from outside | not possible | `revalidateTag()`, from a Route Handler |

Put those together with an `Authorization` header and the failure mode is not subtle. Cache the
response to `viewer { email }` for user A and user B gets it. Not "might, under load, if the CDN
misbehaves" — deterministically, because the second request produces the same cache key and the
cache does its job.

> **This is the one mistake in Module 10 that is a security incident rather than a bug.**
> Everything else in this module produces a wrong page. This produces one user reading another
> user's data, and the logs show two ordinary 200s. It is why `fetchGraphQLAuthed` does not
> accept a cache option, why Lesson 10.3's verification greps `client.ts` to prove it, and why
> Module 15 does not revisit the decision.

### 7. Two failure classes at the boundary

GraphQL over HTTP has two entirely separate ways to fail, and code that handles one and not the
other looks correct until it is in production.

```
   ┌─ TRANSPORT ─────────────────────────────────────────────────────────┐
   │  fetch() rejects            connection refused, DNS, TLS, timeout   │
   │  response.ok === false      502 from a proxy, 500 from Apache       │
   │  body is not JSON           a PHP notice printed before the JSON    │
   └─────────────────────────────────────────────────────────────────────┘
   ┌─ PROTOCOL ──────────────────────────────────────────────────────────┐
   │  HTTP 200 + { "errors": [ … ] }                                     │
   │    · a field that does not exist        (validation)                │
   │    · a depth or complexity refusal      (Lesson 06.4)               │
   │    · a resolver denying permission      (Module 06)                 │
   │    · a resolver that threw              (WordPress fatal, caught)   │
   └─────────────────────────────────────────────────────────────────────┘
```

The upper block is what every HTTP client tutorial teaches. The lower block is where nearly
everything this stack actually produces lives, and `if (!response.ok) throw` catches none of it.
The house rule stands: **read `.errors`, never the status code.**

Both classes throw in this lesson, with the operation name in the message so a log line is
useful. Two deliberate limitations, stated now:

- The error is a plain `Error`, so a caller cannot distinguish "WordPress is down" from "you
  asked for a field that does not exist" without parsing a string. **Lesson 10.4 replaces it
  with `GraphQLRequestError`**, carrying the operation name, the HTTP status and the `errors`
  array as data.
- A **partial** response — `data` populated *and* `errors` non-empty — throws here, discarding
  data that arrived. That is the wrong default, and Lesson 10.4 makes it a written policy rather
  than an accident.

The timeout is `AbortSignal.timeout(8_000)`. Eight seconds is longer than WordPress needs for
any query in this app and shorter than a user will wait. Without it, a hung WordPress hangs a
Next request until the platform's own limit, which on a serverless host means you pay for the
silence.

### 8. Reading the endpoint once, at module load

```ts
// (illustration)
const ENDPOINT: string = requireEndpoint();   // throws immediately if unset
```

The alternative — check inside each function — is one line shorter and worse. A missing
`WP_GRAPHQL_ENDPOINT` is a **deployment** mistake, not a request-level one, and the useful time
to hear about it is when the module is first imported: during `npm run build`, or on the first
request after a deploy, in a stack trace naming `client.ts`. Deferring the check turns one loud
failure at boot into the same failure repeated per request, per route, forever, and it puts the
throw inside a component instead of at the boundary that owns the concern. The check is
`value === undefined || value === ''`, because an empty string is what a `.env.local` line
reading `WP_GRAPHQL_ENDPOINT=` gives you — a typo, not a configuration, and `fetch('')` fails
unhelpfully.

The variable itself is introduced in Module 09 and lives in
[appendix 04 §3.1](../appendix/04-env-reference.md#31-server-only-no-prefix). This module adds
one more, `WP_REST_BASE`, which you will not use until Module 17 — put it in `.env.local` now so
the file matches the contract.

### 9. Why there is no `fetchGraphQLClientSide`

The browser never talks to `/graphql`. Every read in this app happens in a Server Component, a
Server Action or a Route Handler, and the browser receives HTML or a serialised RSC payload.

What that actually buys you, precisely:

| Buys you | Does not buy you |
|---|---|
| No GraphQL endpoint string in the client bundle | secrecy — see below |
| No CORS policy to maintain, and no WPGraphQL CORS plugin | protection from someone who found the host another way |
| No introspection surface reachable from the app's own traffic | protection from introspection if you leave it on |
| One place to add a timeout, a header or a tag | anything about rate limiting |

Be honest about the limit, because the course does not sell obscurity as security:
[appendix 04 §6](../appendix/04-env-reference.md#6-the-honest-caveat-about-hiding-the-wordpress-origin)
points out that media `sourceUrl` values are public, so the WordPress host is discoverable
whatever you do with the endpoint variable. The controls that matter — depth and complexity
limits, introspection off outside `local`, persisted queries, edge rate limiting — are the ones
Lesson 06.4 started and Module 24 finishes.

What the rule does buy is architectural. **WPGraphQL CORS is deliberately not installed**
([appendix 03 §8](../appendix/03-content-model-reference.md#8-plugin-inventory)), and it can
stay uninstalled only while nothing in a browser needs the endpoint. Add a
`fetchGraphQLClientSide` and you have signed up for a CORS policy, a public endpoint and an
allowlist to maintain. Not adding the function is how the property stays true.

---

## Task

### Step 1: Check the licences, then install two packages

```bash
cd next-app

npm view graphql license
# Expected: MIT

npm view server-only license
# Expected: MIT

npm install graphql server-only
```

Both are runtime dependencies, not dev dependencies: `graphql` because `print()` runs when a
query is sent, and `server-only` because its build-time behaviour depends on it being resolvable
in the production dependency tree.

`graphql` is here as the peer dependency the codegen client preset will need in Lesson 10.2, and
because `print()` and `Kind` are the only two things this client needs from it. Nothing else in
the package is used.

While you are in the environment files, add the one variable this module owns. `WP_REST_BASE`
is not used until Module 17 asks WordPress to verify a preview token, but
[appendix 04 §9](../appendix/04-env-reference.md#9-which-module-introduces-what) assigns it to
Module 10, and a `.env.example` that disagrees with the contract is how the contract stops being
one:

```bash
# Confirm the ignore rule BEFORE writing a value. No output means STOP.
git check-ignore -v .env.local

printf 'WP_REST_BASE=http://localhost:8080/wp-json\n' >> .env.local
printf 'WP_REST_BASE=http://localhost:8080/wp-json\n' >> .env.example
```

**Verify §1:**

- [ ] Both licences printed `MIT`. `next-app` is MIT and takes no GPL dependency — the habit
      Lesson 07.1 established.
- [ ] `npm ls graphql` shows one version, not two. Two copies of `graphql` in one tree is the
      classic cause of "Cannot use GraphQLSchema from another module or realm".
- [ ] `git check-ignore -v .env.local` named a rule **before** you appended to it, and
      `git status --short` does not list `.env.local`.
- [ ] `.env.example` now holds `WP_REST_BASE` with a real, non-secret local value — it is not a
      credential, so `__CHANGE_ME__` would be wrong here.

### Step 2: Write `src/lib/graphql/client.ts`

Create the directory and the file. Read the comments — they carry the teaching.

```bash
mkdir -p src/lib/graphql
```

```ts
// next-app/src/lib/graphql/client.ts
// The only place in this app that talks to WordPress. Two exported functions and no
// third. Regenerate nothing here: this file is hand-written and stays that way.
//
// Lesson 10.3 adds the cache-tag builders that feed `options.tags`.
// Lesson 10.4 replaces the plain `Error` throws with `GraphQLRequestError`.
import 'server-only';

import { Kind, parse, print } from 'graphql';
import type { DocumentNode } from 'graphql';

/** Longer than any query in this app needs; shorter than a reader will wait. */
const TIMEOUT_MS = 8_000;

/**
 * A `DocumentNode` that also remembers what it returns and what it takes.
 *
 * `__apiType` is never assigned and never called — it is a phantom property whose
 * only job is to carry the two type parameters so a call site can recover them.
 * Codegen's client preset emits exactly this shape, so from Lesson 10.2 the
 * generated documents satisfy this type structurally, with no adapter.
 */
export type TypedDocumentNode<TResult, TVariables> = DocumentNode & {
  readonly __apiType?: (variables: TVariables) => TResult;
};

/** Everything `fetchGraphQL` accepts. Note what is absent: `cache`, `headers`, `method`. */
export type FetchGraphQLOptions = {
  /** Seconds. `false` caches until a tag invalidates it. Omit and Next 15 does not cache. */
  readonly revalidate?: number | false;
  /** Built by `src/lib/graphql/tags.ts` from Lesson 10.3 — never hand-typed at a call site. */
  readonly tags?: readonly string[];
};

type GraphQLErrorEntry = { readonly message: string };

type GraphQLResponseBody<TData> = {
  readonly data?: TData | null;
  readonly errors?: readonly GraphQLErrorEntry[];
};

// A type predicate: a claim about shape, not a validation. Lesson 07.4 Key Concept 3.
function isGraphQLResponseBody<TData>(value: unknown): value is GraphQLResponseBody<TData> {
  return typeof value === 'object' && value !== null && ('data' in value || 'errors' in value);
}

/**
 * Read the endpoint once, when this module is first imported. A missing endpoint is a
 * deployment mistake, so it should stop the process that noticed rather than the
 * request that happened to be first. An empty string counts as missing.
 */
function requireEndpoint(): string {
  const value = process.env.WP_GRAPHQL_ENDPOINT;
  if (value === undefined || value === '') {
    throw new Error(
      'WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local and fill it in.'
    );
  }
  return value;
}

const ENDPOINT: string = requireEndpoint();

/** The operation name, for error messages and logs. */
function operationNameOf(document: DocumentNode): string {
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION && definition.name !== undefined) {
      return definition.name.value;
    }
  }
  return '(anonymous)';
}

/** Only the two keys Next reads, so a typo in `revalidat` is a compile error. */
function nextOptions(options: FetchGraphQLOptions | undefined): {
  revalidate?: number | false;
  tags?: string[];
} {
  const next: { revalidate?: number | false; tags?: string[] } = {};
  if (options?.revalidate !== undefined) {
    next.revalidate = options.revalidate;
  }
  if (options?.tags !== undefined) {
    // Next wants a mutable array; the caller gave us a readonly one. Copy, do not cast.
    next.tags = [...options.tags];
  }
  return next;
}

/** One request, one response, two failure classes. Both public functions funnel here. */
async function execute<TResult>(
  operationName: string,
  body: string,
  init: RequestInit
): Promise<TResult> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      ...init,
      method: 'POST',
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    // TRANSPORT: connection refused, DNS, TLS, or our own deadline. `cause` keeps the
    // original for the server log without putting it in the message a page might show.
    throw new Error(`${operationName}: no response from WordPress within ${TIMEOUT_MS} ms`, {
      cause,
    });
  }

  if (!response.ok) {
    // Also TRANSPORT, and never a GraphQL error: a proxy 502, or Apache on fire.
    throw new Error(`${operationName}: HTTP ${response.status} ${response.statusText}`);
  }

  const parsed: unknown = await response.json();
  if (!isGraphQLResponseBody<TResult>(parsed)) {
    throw new Error(`${operationName}: the response was not a GraphQL envelope`);
  }

  // PROTOCOL: HTTP 200 carrying an `errors` array. This is the branch that fires.
  if (parsed.errors !== undefined && parsed.errors.length > 0) {
    throw new Error(`${operationName}: ${parsed.errors.map((e) => e.message).join('; ')}`);
  }

  if (parsed.data === undefined || parsed.data === null) {
    throw new Error(`${operationName}: neither data nor errors came back`);
  }
  return parsed.data;
}

/**
 * Public reads. Cacheable, shareable, no credential. Every Server Component,
 * `generateStaticParams` and public Route Handler in this app uses this one.
 */
export function fetchGraphQL<TResult, TVariables extends Record<string, unknown>>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables?: TVariables,
  options?: FetchGraphQLOptions
): Promise<TResult> {
  return execute<TResult>(
    operationNameOf(document),
    JSON.stringify({ query: print(document), variables: variables ?? {} }),
    {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      next: nextOptions(options),
    }
  );
}

/**
 * Authenticated calls. `cache: 'no-store'` is written here, not passed in, and there is
 * no options parameter through which a caller could override it. Module 15 supplies a
 * user JWT; Module 16 supplies the app-token variant (appendix 04 section 4).
 */
export function fetchGraphQLAuthed<TResult, TVariables extends Record<string, unknown>>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables,
  token: string
): Promise<TResult> {
  return execute<TResult>(
    operationNameOf(document),
    JSON.stringify({ query: print(document), variables }),
    {
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }
  );
}

/**
 * TEMPORARY. Lesson 10.2 deletes this export and every call to it.
 *
 * Turns a query string into a document whose result and variable types you supplied by
 * hand. No cast is needed, and that is the point: `__apiType` is optional, so a plain
 * `DocumentNode` satisfies `TypedDocumentNode<Anything, Anything>`. The type argument is
 * a promise with no evidence behind it — exactly the Lesson 09.3 problem, relocated.
 */
export function untypedDocument<TResult, TVariables extends Record<string, unknown>>(
  source: string
): TypedDocumentNode<TResult, TVariables> {
  return parse(source);
}
```

> **`print()` versus a string.** Codegen's client preset can be configured to emit query
> **strings** instead of parsed ASTs (`documentMode: 'string'`), and some teams prefer that
> because it skips a parse at boot. This course keeps the default AST form, so `print(document)`
> is what turns a document into the `query` field of the request body. If you ever switch the
> preset to string mode, `print(document)` is the one line that changes. Naming the operation
> also depends on the AST — `operationNameOf` walks `document.definitions` — so string mode
> would cost you that too.

### Step 3: Migrate the incidents list route

The routes still use the hand-written types from Lesson 09.3, because codegen is the **next**
lesson. So the document's types are instantiated by hand for one more lesson, via
`untypedDocument`. Say that out loud as you type it: this is the last lesson in which a type
describing WordPress data is something a human asserted.

Replace the fetch preamble at the top of the route file:

```tsx
// next-app/src/app/[locale]/incidents/page.tsx — replace the fetch preamble
import { fetchGraphQL, untypedDocument } from '@/lib/graphql/client';
import type { IncidentsQueryResponse } from '@/types/graphql-responses';

// Lesson 10.2 replaces this with a generated document from `@/gql/graphql`.
const IncidentsListDocument = untypedDocument<
  IncidentsQueryResponse,
  { first: number; after?: string; search?: string }
>(`
  query IncidentsList($first: Int!, $after: String, $search: String) {
    incidents(
      first: $first
      after: $after
      where: { status: PUBLISH, search: $search, orderby: { field: DATE, order: DESC } }
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        databaseId
        title
        slug
        date
        severities(first: 1) {
          nodes {
            name
            slug
          }
        }
        scapegoats(first: 1) {
          nodes {
            name
            slug
          }
        }
        incidentDetails {
          downtimeMinutes
          environment
        }
      }
    }
  }
`);
```

Then, inside the component, the whole `fetch` block collapses to one line:

```tsx
// next-app/src/app/[locale]/incidents/page.tsx — inside the component body
const data = await fetchGraphQL(IncidentsListDocument, { first: 12 });
```

No type argument. No `method`, no `headers`, no `JSON.stringify`, no `res.ok` check, no
`res.json()`, no `data.errors` check. Delete all of it — Step 4 is a checklist for exactly that.

**Verify §3:**

- [ ] Hover `data` in your editor. It is `IncidentsQueryResponse`, inferred from the document.
- [ ] Change `{ first: 12 }` to `{ first: '12' }`. `npm run type-check` fails. Change it back.
- [ ] The route file no longer contains the string `fetch(`.

### Step 4: Migrate the remaining Module 09 routes, and delete their error handling

Every route from Module 09 gets the same three edits. The documents are the ones you wrote in
Lesson 05.3 and kept in the scratch `queries.graphql` — reuse the names exactly, because
Lesson 10.2 generates types from them and Lesson 10.5 gives each one a file.

| Route | Operation | Variables |
|---|---|---|
| `[locale]/page.tsx` | `HomepageFeeds` | `{ featuredCount, recentCount }` |
| `[locale]/incidents/page.tsx` | `IncidentsList` | `{ first, after?, search? }` |
| `[locale]/incidents/[slug]/page.tsx` | `IncidentBySlug` | `{ slug }` |
| `[locale]/blog/page.tsx` | `PostsList` | `{ first, after? }` |
| `[locale]/blog/[slug]/page.tsx` | `PostBySlug` | `{ slug }` |
| `[locale]/reviews/page.tsx` | `ReviewsList` | `{ first, after? }` |
| `[locale]/reviews/[slug]/page.tsx` | `ReviewBySlug` | `{ slug }` |
| `[locale]/scapegoats/page.tsx` | `ScapegoatLeaderboard` | `{ first }` |

Slug lookups stay `id: $slug, idType: SLUG`. A bare `id:` with a slug returns `null`, which
Lesson 05.3 taught and this lesson does not reintroduce.

The three edits, per file:

1. Import `fetchGraphQL` and `untypedDocument` from `@/lib/graphql/client`.
2. Move the query string into a module-level `const …Document = untypedDocument<…, …>(\`…\`)`.
3. Replace the `fetch` block with one `await fetchGraphQL(...)`.

Then delete, from every route file:

- the `if (!res.ok) throw new Error(...)` line
- the `if (json.errors) ...` block
- any local `GraphQLResponse`/envelope type — the client owns the envelope now
- any `process.env.WP_GRAPHQL_ENDPOINT` read

**One route is deliberately not migrated: `src/app/api/health/route.ts`.** Leave its raw
`fetch` and its own `process.env.WP_GRAPHQL_ENDPOINT` read exactly as Lesson 09.5 wrote them.

> **A liveness probe must not depend on the abstraction it is probing.** Three reasons, and
> they are the reasons real health checks look different from real application code. The client
> **throws** on a GraphQL error, but `/api/health` needs to *report* rather than propagate —
> and it needs to distinguish "WordPress is unreachable" from "the query was rejected", which
> a thrown `Error` has already flattened. The client's timeout is eight seconds, chosen so a
> page render does not give up on a slow query; a health check that blocks for eight seconds is
> itself an outage, which is why 09.5 set two. And a probe that imports the data layer stops
> answering the moment the data layer has a bug, which is exactly when you most need it to
> answer. So the duplication is the point: two reads of the same variable, deliberately, with a
> comment in each saying why.
>
> The cost, stated plainly: `WP_GRAPHQL_ENDPOINT` is now read in two places, and if you ever
> rename it you have to change both. That is a worse trade for application code and a better
> one for a probe.

**Verify §4:**

- [ ] `grep -rln 'WP_GRAPHQL_ENDPOINT' src/` names exactly two files — `src/lib/graphql/client.ts`
      and `src/app/api/health/route.ts`. Any third is a route you did not finish migrating.
- [ ] `grep -rn 'errors' src/app/` returns nothing. Error handling lives at the boundary now.
- [ ] `npm run type-check` and `npm run lint` are both silent.

### Step 5: Prove the `server-only` guard is a build error

A guard you have not seen fire is a guard you do not trust. Create a Client Component that
imports the client, watch the build refuse, then delete it.

```bash
cat > src/components/incidents/_leak-probe.tsx <<'EOF'
// next-app/src/components/incidents/_leak-probe.tsx
// TEMPORARY. Deleted at the end of this step. Proves the server-only guard fires.
'use client';

import { fetchGraphQL } from '@/lib/graphql/client';

export function LeakProbe(): string {
  return typeof fetchGraphQL;
}
EOF

# Import it from a route so it enters the client graph, then build.
npm run build
```

You need the probe to be **reachable** from a Client Component boundary for the bundler to walk
it, so add a temporary `import { LeakProbe } from '@/components/incidents/_leak-probe';` plus a
`<LeakProbe />` in `src/app/[locale]/incidents/page.tsx` before building.

The build fails. The message names the module:

```
   ./src/lib/graphql/client.ts
   Error:   x You're importing a component that needs "server-only". That only works in a
              Server Component which is not supported in the pages/ directory. Read more: …
```

The exact wording moves between Next releases and between webpack and Turbopack. What does not
move is that it is a **build** failure, that it names `client.ts`, and that the word
`server-only` appears. Do not memorise the sentence; memorise the shape.

Now undo it:

```bash
rm src/components/incidents/_leak-probe.tsx
# …and remove the two temporary lines from src/app/[locale]/incidents/page.tsx
npm run build
# Expected: a clean build
```

**Verify §5:**

- [ ] The failing build mentioned `server-only` and named `src/lib/graphql/client.ts`.
- [ ] `_leak-probe.tsx` is gone and `git status --short` is clean apart from your real work.
- [ ] The build after the removal succeeds.

### Step 6: Record ADR 0007

`docs/adr/0001`–`0005` are taken by Modules 01–04, and Lesson 09.1 wrote `0006`. **ADR numbers
are permanent and never reused.** Yours is `0007`.

Write `docs/adr/0007-hand-rolled-graphql-client.md`:

```markdown
# 0007 — A hand-rolled GraphQL client, not Apollo

## Status
Accepted (Lesson 10.1)

## Context
Every WordPress read in this app happens on the server: a Server Component, a Server
Action, or a Route Handler. We need precise control of `next: { revalidate, tags }`,
because Module 18 invalidates cached responses by tag from a WordPress webhook.

## Options considered
| Option | Normalised cache | Reaches `next: { … }` | Bundle | Verdict |
|---|---|---|---|---|
| Apollo Client | yes, unused in an RSC | custom link | tens of kB | rejected |
| urql | yes, unused in an RSC | custom exchange | smaller | rejected |
| graphql-request | no | not exposed | small | rejected |
| `fetch` + graphql-codegen | no | it is a plain option | zero | **chosen** |

## Decision
`src/lib/graphql/client.ts` — two functions over native `fetch`, typed by
`TypedDocumentNode` documents that graphql-codegen generates from the committed
`wordpress-headless/schema.graphql`.

## Consequences
Good: the caching story is one `fetch` option; nothing GraphQL-related is in the client
bundle; there is no CORS policy to maintain; an authenticated response cannot be cached
because `fetchGraphQLAuthed` has no cache parameter.

What it costs us: we own about a hundred and twenty lines, including retry behaviour we
have not written and instrumentation we will want in Module 21. We get no hooks, no
optimistic updates and no subscriptions.

## What would reverse this
The first Client Component that genuinely needs to issue a GraphQL request. At that point
reopen this decision rather than adding a second data layer beside the first.
```

### Step 7: Typecheck, lint, commit

```bash
npm run verify
git add -A
git commit -m "feat(next): one typed GraphQL client, server-only, replacing inline fetch"
```

`npm run verify` is the Module 07 aggregate — `type-check`, then `lint`, then `format:check`.

---

## Verification

```bash
cd next-app

# 1. The client exists, and `server-only` is the FIRST line of it
head -n 6 src/lib/graphql/client.ts | grep -n "server-only"
# Expected: a line number and `import 'server-only';`
#           If it is not in the first six lines, move it — order is the contract.

# 2. Exactly two functions are exported, and there is no third
grep -c '^export function fetchGraphQL' src/lib/graphql/client.ts
# Expected: 2   (fetchGraphQL and fetchGraphQLAuthed)

# 3. Types and lint are clean
npm run type-check && npm run lint
# Expected: no output from either

# 4. A real query goes through the client and renders a page
npm run build && npm run start & SERVER_PID=$!
sleep 6
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/incidents
# Expected: 200
curl -s http://localhost:3000/en/incidents | grep -c 'incidents/'
# Expected: a number greater than 0 — real incident links, from real WordPress data
kill "$SERVER_PID"

# 5. The endpoint is read in exactly two places, and you can name both
grep -rln 'WP_GRAPHQL_ENDPOINT' src/ | sort
# Expected: exactly these two lines, in this order:
#   src/app/api/health/route.ts     the probe, deliberately independent (Step 4)
#   src/lib/graphql/client.ts       every application read
# A third file is a route you did not finish migrating.

# 6. NEGATIVE — no PAGE builds its own GraphQL request any more
grep -rn 'fetch(' src/app/ --include='page.tsx' --include='layout.tsx'
# Expected: no output. Every GraphQL call from a page goes through src/lib/graphql/.
grep -rlc 'fetch(' src/app/api/health/route.ts
# Expected: 1 — the probe keeps its own fetch, on purpose. Step 4 says why.

# 7. NEGATIVE — `fetchGraphQLAuthed` cannot be told to cache
grep -n 'no-store' src/lib/graphql/client.ts
# Expected: one hit, inside fetchGraphQLAuthed's init object
grep -n 'FetchGraphQLOptions' src/lib/graphql/client.ts
# Expected: hits on the type declaration and on fetchGraphQL's signature ONLY.
#           fetchGraphQLAuthed must not appear on any of those lines: it has no
#           options parameter, so `cache` is not reachable from its call sites.

# 8. NEGATIVE — the endpoint string never reached the browser bundle
npm run build
grep -rn 'localhost:8080' .next/static/ ; echo "exit=$?"
# Expected: no matches and `exit=1`. A hit means something server-only leaked —
#           re-read appendix 04 section 1 rule 4 before doing anything else.

# 9. NEGATIVE — a Client Component importing the client fails the BUILD, not the request
#    (Step 5 walked this; this is the copy-pasteable version.)
cat > src/components/incidents/_leak-probe.tsx <<'EOF'
// next-app/src/components/incidents/_leak-probe.tsx
'use client';
import { fetchGraphQL } from '@/lib/graphql/client';
export function LeakProbe(): string {
  return typeof fetchGraphQL;
}
EOF
cp 'src/app/[locale]/incidents/page.tsx' /tmp/incidents-page.bak
printf "\nexport { LeakProbe } from '@/components/incidents/_leak-probe';\n" \
  >> src/app/[locale]/incidents/page.tsx
npm run build 2>&1 | grep -c 'server-only'
# Expected: 1 or more. The build FAILED and said why.
# Restore from the copy, NOT with `git checkout --`: this lesson's edits are not
# committed yet, and git would happily give you back the Lesson 09.3 version.
mv /tmp/incidents-page.bak 'src/app/[locale]/incidents/page.tsx'
rm src/components/incidents/_leak-probe.tsx
npm run build
# Expected: a clean build again

# 10. The decision record is on disk with the right number
test -f docs/adr/0007-hand-rolled-graphql-client.md && echo present
# Expected: present
ls docs/adr/
# Expected: 0001 through 0007, no gaps and no duplicates
```

If check 8 prints a match, stop and fix it before Lesson 10.2. Everything after this point
assumes the endpoint is a server-side fact.

## Control Questions

1. `import 'server-only'` is one line and one dependency. Explain the mechanism precisely —
   what does the resolver do differently for the browser graph than for the server graph, and
   why does that make an accidental import a **build** failure rather than a runtime one?
2. `fetchGraphQLAuthed` hard-codes `cache: 'no-store'`. Describe the exact sequence of two
   requests by two different users that would leak data if it accepted a `revalidate` option,
   and say which part of the sequence is impossible to observe in the access log.
3. `untypedDocument()` returns `parse(source)` with no cast, and it compiles. Explain why the
   compiler accepts it, and say what that tells you about how much trust a
   `TypedDocumentNode<T, V>` deserves when the document did not come from codegen.
4. Two calls to `fetchGraphQL(IncidentsListDocument, { first: 12 })` in one render produce one
   WordPress request. Two calls with `{ first: 12 }` and `{ first: 13 }` produce two. Explain
   both outcomes from the cache-key rule, and say what happens if you add an unused variable to
   the operation.
5. Name the situation in which this lesson's decision is wrong and Apollo Client is the right
   answer. Then say what would have to become true of Blame The Tech for that situation to
   arrive, and which single file you would reopen first.

## Learn More

- [Next.js — `fetch` API reference](https://nextjs.org/docs/app/api-reference/functions/fetch) —
  the `next.revalidate` and `next.tags` options your `FetchGraphQLOptions` type is a facade over
- [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
  — read the "keeping server-only code out of the client environment" part, which is exactly
  Key Concept 1 in Next's own words
- [React — Server Components](https://react.dev/reference/rsc/server-components) — why a
  component that renders once has no use for a normalised cache
- [`typed-document-node` plugin](https://the-guild.dev/graphql/codegen/plugins/typescript/typed-document-node)
  — the tool that will produce the documents this client's signature is designed around
- [GraphQL — serving over HTTP](https://graphql.org/learn/serving-over-http/) — the reason a
  GraphQL failure arrives as HTTP 200, stated by the people who decided it
- [MDN — `AbortSignal.timeout()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
  — the one-line deadline, and what it does and does not abort
- [MDN — `Error.cause`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause)
  — how to keep the original failure attached without putting it in a user-visible message
- [WPGraphQL — Fragments](https://www.wpgraphql.com/docs/fragments) — worth re-skimming before
  Lesson 10.5 restructures the documents this lesson just moved into route files
