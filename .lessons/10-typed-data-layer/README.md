# Module 10 — The Typed Data Layer

## Prerequisites

Before starting this module you should have completed:

- **Module 09** — every route in the route inventory renders live WordPress data, `/api/health` answers, `middleware.ts` normalises the locale
- **Module 06** — `schema.graphql` is committed in `wordpress-headless/`, and the API is a designed contract with enums and depth limits
- **Module 07** — you can read a TypeScript union, a generic and a `type` alias without looking them up

> ⚠️ **Do not start this module while any route still uses inline `fetch` with a hand-written
> type and you are happy about it.** Lesson 10.2 deletes all of them in one commit. If you
> have added routes of your own since Module 09, list them first — the deletion is meant to
> be exhaustive.

## Starting State

```bash
# 1. The site runs and every route answers
cd next-app && npm run dev
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/incidents
# Expected: 200

# 2. Typecheck is green — which is the problem this module solves
npm run type-check
# Expected: no errors, even though src/types/graphql-responses.ts disagrees with the schema
```

```
next-app/
├── next.config.ts  .env.example
└── src/
    ├── middleware.ts
    ├── app/[locale]/{layout,page}.tsx  incidents/  blog/  reviews/  scapegoats/
    ├── app/api/health/route.ts
    ├── components/incidents/                       (M08, wired to live data in M09)
    └── types/graphql-responses.ts                  hand-written by eye in Lesson 09.3
```

## What You'll Learn

- **A GraphQL client you own** — roughly fifty lines of native `fetch`, and why Apollo, urql and `graphql-request` are the wrong tool inside React Server Components
- **`TypedDocumentNode`** — how a document can carry its own result and variable types, so `fetchGraphQL` needs no type argument at the call site
- **`graphql-codegen`** — generated types from a committed `schema.graphql`, and why generated code belongs in git
- **`import 'server-only'`** — making a module impossible to import from a Client Component
- **Fetch caching** — `next: { revalidate, tags }`, request memoization within one render, and the difference between the two
- **Cache tags** — a naming scheme (`incident:dns`, `incidents`) that Module 18 invalidates from WordPress
- **Error handling** — GraphQL's two-hundred-with-errors response shape, `error.tsx`, `not-found.tsx` and `global-error.tsx`
- **Streaming** — `loading.tsx`, `<Suspense>` boundaries, and where a spinner actually helps
- **Documents and fragments** — colocated `.graphql` files, fragment reuse, and one query per route

## What You'll Build

`src/lib/graphql/client.ts` with two exported functions and no third; `codegen.ts` plus a
committed `schema.graphql` and `src/gql/`; a `.graphql` document per route in `src/graphql/`
with shared fragments; `src/lib/graphql/tags.ts` as the single place cache tags are constructed;
and loading, error and not-found boundaries on every route.

After this module every WordPress read in the app is typed from the real schema, cached under a
named tag, and wrapped in a boundary that fails visibly rather than blanking the page.

## Lessons

| #  | Lesson | New Technology | What You Build |
|----|--------|----------------|----------------|
| 01 | [A Typed GraphQL Client](01-a-typed-graphql-client.md) | native `fetch`, `server-only`, `TypedDocumentNode` | `fetchGraphQL` and `fetchGraphQLAuthed` |
| 02 | [GraphQL Codegen](02-graphql-codegen.md) | `graphql-codegen`, `client-preset`, `codegen:check` | `codegen.ts`, `schema.graphql`, `src/gql/` — and no hand-written types |
| 03 | [Fetch Caching & Request Memoization](03-fetch-caching-and-request-memoization.md) | `next: { revalidate, tags }`, `cache: 'no-store'` | `src/lib/graphql/tags.ts` and a per-route cache policy |
| 04 | [Error Handling, Loading & Suspense](04-error-handling-loading-and-suspense.md) | `error.tsx`, `not-found.tsx`, `<Suspense>` | Boundaries on every route, plus `GraphQLRequestError` |
| 05 | [Organising Queries & Fragments](05-organising-queries-and-fragments.md) | `.graphql` documents, fragments, `@include` | `src/graphql/` restructured, one document per route |

## The two client functions, and why there are only two

| | `fetchGraphQL` | `fetchGraphQLAuthed` |
|---|---|---|
| Callers | Server Components, `generateStaticParams`, Route Handlers | Server Actions, authenticated Route Handlers |
| Credential | none | `Authorization: Bearer <jwt>` or `X-BTT-App-Token` (Module 15) |
| Cache options | `revalidate` and `tags` accepted | **hard-coded `cache: 'no-store'`, not overridable** |
| Why | Public reads are the only thing safe to share between users | An authenticated response in a shared cache is a data leak, so the API makes it unrepresentable |

There is no `fetchGraphQLClientSide`. The browser never reaches `/graphql` — see
[the env reference](../appendix/04-env-reference.md#6-the-honest-caveat-about-hiding-the-wordpress-origin)
for what that does and does not buy you.

## Why the client is not Apollo, urql or graphql-request

The verdict is recorded here because it is the decision most likely to be questioned in a code
review, and Lesson 10.1 argues it at length.

| | Apollo Client / urql | `graphql-request` | **`fetch` + codegen** |
|---|---|---|---|
| Normalised client cache | yes — and useless in an RSC that renders once | no | not needed |
| `next: { revalidate, tags }` reachable | only through a custom link or exchange | not exposed | it is a plain `fetch` option |
| Bundle cost | tens of kilobytes, for a server-only concern | small | zero |
| Lines you own | zero, until you need to debug them | zero | about fifty |
| Verdict | ❌ solves problems RSC does not have | ❌ hides the caching story | ✅ |

## How to Work

1. **Read the module README** and confirm Starting State, including that `npm run type-check` currently passes on types you know are wrong.
2. **Work the lessons in order.** 10.1 must land before 10.2, because codegen generates the documents that the client's signature depends on.
3. **Commit `src/gql/` and `schema.graphql`.** Generated code in git looks wrong until Lesson 10.2 explains why. Do not add them to `.gitignore`.
4. **Run `## Verification` before moving on**, then commit: `git commit -m "feat(next): codegen-typed, cache-tagged data layer"`.
