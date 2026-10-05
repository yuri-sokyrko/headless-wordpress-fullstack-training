## Status

Accepted (Lesson 10.1)

## Context

Every WordPress read in this app happens on the server: a Server Component, a Server
Action, or a Route Handler. We need precise control of `next: { revalidate, tags }`,
because Module 18 invalidates cached responses by tag from a WordPress webhook.

## Options considered

| Option                    | Normalised cache      | Reaches `next: { … }` | Bundle     | Verdict    |
| ------------------------- | --------------------- | --------------------- | ---------- | ---------- |
| Apollo Client             | yes, unused in an RSC | custom link           | tens of kB | rejected   |
| urql                      | yes, unused in an RSC | custom exchange       | smaller    | rejected   |
| graphql-request           | no                    | not exposed           | small      | rejected   |
| `fetch` + graphql-codegen | no                    | it is a plain option  | zero       | **chosen** |

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
