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
