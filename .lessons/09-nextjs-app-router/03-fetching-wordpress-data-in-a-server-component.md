---
title: 'Fetching WordPress Data in a Server Component'
module: 9
lesson: 3
teaches: [async-server-components, server-side-fetch, hand-written-response-types, type-drift, html-blob-rendering]
produces: ['next-app/src/types/graphql-responses.ts', 'next-app/src/app/[locale]/incidents/page.tsx', 'next-app/src/app/[locale]/incidents/[slug]/page.tsx']
requires: [9.2, 5.5]
---

# Lesson 09.3 — Fetching WordPress Data in a Server Component

## Quick Overview

This is the lesson where the fixtures go away and Blame The Tech starts showing real content.
A Server Component can be declared `async` and `await` anything, so fetching WordPress data is
a `fetch` call to `POST /graphql` written directly inside the component that renders the
result. No `useEffect`, no loading flag, no client-side request, no CORS. The browser receives
finished HTML and never learns that a GraphQL endpoint was involved.

The second half of this lesson is deliberately built to fail. To hand a fetch result to
TypeScript you need a type for it, and you do not have codegen yet — so you will **hand-write
the response types by reading the GraphiQL result panel**, twice: once for the incidents list
and once for a single incident by slug. Then you will get one of them subtly wrong, exactly the
way everyone gets it wrong in production, and watch `npm run type-check` pass on a type that
does not match the schema. TypeScript will happily compile a lie, because a hand-written
interface is an assertion about data you did not check. Do not fix it by hand. Lesson 10.2
deletes every one of these types in a single commit, and this lesson is the argument for why
that commit is worth its churn.

By the end of this lesson you will have:

- `next-app/src/types/graphql-responses.ts` — two hand-written response types, `IncidentsQueryResponse` and `IncidentBySlugQueryResponse`
- `next-app/src/app/[locale]/incidents/page.tsx` — the list route on live WPGraphQL data
- `next-app/src/app/[locale]/incidents/[slug]/page.tsx` — one incident, with its body rendered as an HTML blob from `content`
- A route that typechecks clean and crashes at runtime, because `downtimeMinutes` is nullable in the schema and not in your type
- A written note listing every hand-written type in the repo, for Lesson 10.2 to delete

## Classic WP Analogy

You are writing the same code you have always written, one layer further out:

```
single-incident.php                        src/app/[locale]/incidents/[slug]/page.tsx
──────────────────────────────────────     ──────────────────────────────────────────
$q = new WP_Query([                        const data = await fetch(endpoint, {
  'post_type' => 'incident',                 method: 'POST',
  'name'      => get_query_var('name'),      body: JSON.stringify({ query, variables }),
]);                                        }).then(r => r.json());

if (!$q->have_posts()) { get_404(); }      if (!data.incident) notFound();
$q->the_post();
the_title();                               <h1>{incident.title}</h1>
the_content();                             <div dangerouslySetInnerHTML={{ __html:
                                              incident.content ?? '' }} />
```

The shape is identical: read the slug from the URL, ask the data layer for one record, 404 if
there is nothing, render the fields. `the_content()` and `dangerouslySetInnerHTML` are even
doing the same job — dumping stored post HTML into the page — and both are the reason your
front end currently has no idea what a block is.

The analogy breaks on **who checks the data**. `WP_Query` returns `WP_Post` objects that
WordPress constructed and guarantees; if a field is missing you get `null` and PHP tells you
at the point of use. A GraphQL response is untyped JSON, and the type you write over it is a
promise you are making to the compiler, not a check the compiler performs. Get the promise
wrong — say a nullable `Float` as `number` — and TypeScript will confidently let you call
`.toFixed(0)` on `null`, and the page will 500 in production for exactly the incidents where
an editor left the field blank. This is the specific failure that makes codegen worth a whole
lesson in Module 10: generated types are derived from the committed schema, so they cannot
disagree with it.

The second break is the one to keep in mind for the next five modules: **`the_content()` is a
dead end in a headless build.** In Classic WordPress it is fine, because the theme's CSS was
written for the classes WordPress emits and the links are ordinary server-rendered anchors.
Here that blob arrives with `wp-block-*` classes Tailwind has never compiled, raw `<a>` tags
that skip client-side navigation, and `<img>` tags that skip image optimisation. You are going
to render it that way for five modules anyway, because the fix only makes sense once you have
felt the problem. Module 14 removes it.

---

## Key Concepts

### 1. An `async` component is the data layer

A Server Component may be declared `async` and may `await` anything in its body. There is no other
mechanism to learn: no data-fetching hook, no lifecycle method, no `getServerSideProps`, no
provider to configure.

```tsx
// The whole pattern. Everything else in this lesson is detail. — (illustration)
export default async function Page() {
  const data = await fetchIncidents(20);
  return <IncidentList incidents={data.incidents.nodes} />;
}
```

Compare that with the client-side version you are not writing:

| Client-side fetching | `async` Server Component |
|---|---|
| `useEffect` + `useState` + an `isLoading` flag | one `await` |
| A request from the browser to WordPress | a request from your server to WordPress |
| Therefore a **CORS** policy on `/graphql` | no CORS — this is not a browser request |
| The endpoint is in the JavaScript bundle | the endpoint is in `process.env` on the server |
| A flash of empty state, then data | HTML that already contains the data |
| Two round trips before first content | one |

The CORS row is why appendix 03 §8 lists **WPGraphQL CORS** as deliberately *not installed*.
Nothing in the browser ever calls `/graphql`, so there is no cross-origin policy to get wrong.

Be precise about what this buys, though.
[Appendix 04 §6](../appendix/04-env-reference.md#6-the-honest-caveat-about-hiding-the-wordpress-origin)
states the caveat: media `sourceUrl` values are public, so the WordPress host is discoverable
whatever you do. Server-side fetching removes the endpoint from your bundle and from your app's
own traffic. It is not a firewall, and the real controls — depth limits, persisted queries,
introspection off in production — are Module 24's.

### 2. The `fetch` shape for a GraphQL POST

GraphQL over HTTP is one endpoint, one method, one content type. The query is data in the body,
not a path.

| Part | Value |
|---|---|
| Method | `POST` — always, for this course |
| URL | `process.env.WP_GRAPHQL_ENDPOINT`, e.g. `http://localhost:8080/graphql` |
| Header | `Content-Type: application/json` |
| Body | `JSON.stringify({ query, variables })` |
| Response | `{ "data": { … } }`, or `{ "data": …, "errors": [ … ] }`, or `{ "errors": [ … ] }` |

The `/* GraphQL */` comment before a template literal is a convention, not syntax:

```ts
// It buys editor highlighting and, from Module 10, codegen document discovery. — (illustration)
const INCIDENTS_LIST = /* GraphQL */ `query IncidentsList($first: Int!) { … }`;
```

Two things stay true from Module 05 and will bite if you forget them. Slug lookups are
`id: $slug, idType: SLUG` — a bare `id:` with a slug returns `null`, which your code will read as
"no such incident" and turn into a 404 you cannot explain. And `status` is asymmetric: the *input*
enum is `PostStatusEnum` (`PUBLISH`), while the *output* field is a `String` carrying the raw
`post_status` (`publish`).

### 3. GraphQL errors arrive with HTTP 200

This is the single most important line in the lesson. A GraphQL server that understood your
request and failed to fulfil it answers **200 OK** with an `errors` array.

```
Bad field name          → 200  { "errors": [ { "message": "Cannot query field ..." } ] }
Missing required var    → 200  { "errors": [ … ] }
Permission denied       → 200  { "data": { "incident": null }, "errors": [ … ] }
Endpoint URL wrong      → 404  (a WordPress 404 page, in HTML)
WordPress down          → the fetch itself rejects
```

So `if (!res.ok) throw` catches almost nothing that will actually go wrong. It catches a wrong
URL and a crashed PHP process; it does not catch a typo in your query, a renamed ACF field, or a
capability check that fired. Every failure check in this course reads `.errors`, never the status
code — that is a house rule and it comes from this row of the table.

**Partial success is normal and is the case people forget.** `data` populated *and* `errors`
present, together, is a valid GraphQL response: the resolver for one field threw, so that field is
`null` and the rest of the response is intact. A client that treats "any errors" as total failure
throws away a page that could have rendered; a client that ignores `errors` renders a page with
silent holes in it. Lesson 10.4 writes the policy that decides between those two. This lesson logs
them on the server and renders what it got — which is a decision, not a default, and you should
know you are making it.

> **Read `.errors`, never the status code.** Every failure check in this course — in a route file,
> in a `curl` pipeline, in a Playwright assertion from Module 23 — reads the `errors` array. A
> check written against `res.status` passes while the response contains nothing but an error
> message, which is the most expensive kind of green test.

### 4. Read the environment variable properly, or the error is unreadable

`fetch(undefined)` and `fetch('')` produce errors that name neither your variable nor your file.
Check once, throw with a sentence a tired human can act on:

```ts
// The four lines that turn a 20-minute mystery into a 20-second fix. — (illustration)
const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
if (!endpoint) {
  throw new Error('WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local.');
}
```

Two properties of that check are deliberate. It runs on the server, so the message can safely name
the variable — it is going to your terminal and your logs, not to a visitor. And it throws rather
than falling back to a hard-coded `http://localhost:8080/graphql`, because a default that works on
your laptop and silently points production at nothing is worse than a crash.

Note what it does **not** do: it does not check the *value*. A typo in the URL is a runtime 404
whose body is WordPress's HTML 404 page, and `res.json()` on that throws
`Unexpected token '<'` — a genuinely confusing error whose real meaning is "your endpoint is
wrong". Recognise it now and you will save the afternoon later.

### 5. A hand-written response type is an assertion, not a check

This is the pedagogical core of the module. TypeScript does not validate anything at runtime. When
you write

```ts
// next-app/src/types/graphql-responses.ts (fragment — the assertion, in full in the Task)
readonly downtimeMinutes: number;
```

you are not asking the compiler to confirm that WordPress sends a number. You are *telling* it,
and it believes you, permanently, everywhere that value flows.

[Appendix 03 §4.1](../appendix/03-content-model-reference.md#41-incident-details) says
`downtime_minutes` is a Number field exposed as GraphQL `Float` with a range of 0–100000. GraphQL
`Float` — with no `!` — is **nullable**. An editor who leaves the field empty produces `null`. So:

```
Your type says          number
The schema says         Float          (nullable → number | null)
GraphiQL showed you     47             (because the row you clicked had a value)
Production sends        null           (for the incident nobody finished filling in)
```

And the failure is not a type error. It is this:

```
TypeError: Cannot read properties of null (reading 'toFixed')
    at IncidentPage (src/app/[locale]/incidents/[slug]/page.tsx:63:41)
```

A 500, on one route, for a subset of content, discovered by a user. `npm run type-check` exits 0
the whole time, because from the compiler's point of view nothing is wrong — you promised.

| | Hand-written type | Generated type (Module 10) |
|---|---|---|
| Derived from | your reading of one GraphiQL response | the committed `wordpress-headless/schema.graphql` |
| Nullability | whatever you assumed | exactly what the schema declares |
| Drifts when the schema changes | silently, forever | the next codegen run changes the type, and the build fails where it mattered |
| Cost | free today | a build step, a committed `src/gql/`, one lesson |

You will write the wrong version on purpose in Step 6, watch it typecheck, and watch it crash.
**Do not fix the type by hand.** The point is not that you cannot spot a nullable field; it is
that a repository full of types nobody can mechanically check against the schema will drift the
moment an editor adds a field, and no amount of care prevents it. That evidence is what makes
Lesson 10.2's single commit obviously worth its churn.

> **When Step 6 crashes, resist the two-character fix.** Changing `number` to `number | null` here
> makes this one field safe and leaves the other eight, plus the five types Lesson 09.4 adds, plus
> every field an editor adds next quarter. The fix is structural, it is one commit, and it is
> Lesson 10.2. Annotate and move on.

### 6. `notFound()` throws, so nothing after it runs

`notFound()` comes from `next/navigation` and its return type is `never`. It raises a special error
Next catches to render the nearest `not-found.tsx` and send **HTTP 404**.

```tsx
// Two consequences in three lines. — (illustration)
const incident = data.incident;
if (!incident) notFound();          // no `return` needed — this throws
return <h1>{incident.title}</h1>;   // and TypeScript knows incident is non-null here
```

The narrowing is a real benefit: because `notFound()` is `never`, the compiler treats everything
after the `if` as the non-null branch, so you get correct types without an `else` or a
non-null assertion.

There is no `not-found.tsx` in this project yet, so Next's built-in 404 answers. That is
deliberate — Lesson 10.4 adds the file, and the status code is already correct today. Compare with
Classic WordPress, where the equivalent is `status_header(404)` *plus* `get_404_template()` *plus*
remembering to `exit`, and forgetting any of the three produces a 200 that Google will happily
index.

### 7. The `content` blob, and its three concrete costs

`content` is the post body as one HTML string, produced by `the_content()` filters on the
WordPress side. Rendering it needs `dangerouslySetInnerHTML`, and this module does it in three
route files with a comment naming Module 14 at each one.

```tsx
// The debt, and it is written down in the module README. — (illustration)
<div dangerouslySetInnerHTML={{ __html: incident.content ?? '' }} />
```

The costs are not theoretical. They are the three reasons Module 14 exists:

| Cost | What you see |
|---|---|
| `wp-block-*` classes Tailwind has never compiled | Module 11 styles the app and the post bodies stay unstyled. The classes are in the HTML; no CSS matches them. |
| Raw `<a href>` instead of `<Link>` | Every in-content link is a full document load. Client-side navigation stops at the edge of the blob. |
| Raw `<img>` instead of `next/image` | No sizing, no format negotiation, no lazy loading. Module 21's Core Web Vitals work cannot reach inside the string. |

There is a fourth, which is about trust rather than performance: an HTML string is opaque, so you
cannot render *part* of it, reorder it, or put a component in the middle of it. Every "can we show
the CTA after the second paragraph?" request dies here.

> **`content` is the only blob this course tolerates, and only until Module 14.** Never render
> `renderedHtml` — it is untrusted and unsanitized. `dangerouslySetInnerHTML` ends up in exactly
> one file in the finished application, `src/components/blocks/RichText.tsx`, which sanitizes with
> a strict allowlist. The three occurrences you write in this module are a dated debt, not a
> pattern to copy.

### 8. This is not `getServerSideProps`, and the difference is structural

If you have seen the Pages Router, the temptation is to read an `async` Server Component as
`getServerSideProps` with nicer syntax. It is not.

| | `getServerSideProps` (Pages Router) | `async` Server Component |
|---|---|---|
| Where the data is fetched | in a special exported function, per **page** | in **any** component, at any depth |
| How it reaches the component | serialized to JSON, embedded in the HTML, hydrated as props | it never leaves the server; only rendered output crosses |
| Data in the page source | ✅ yes — the whole props object is in `__NEXT_DATA__` | ❌ no |
| Nested components needing their own data | prop-drilled from the page, or a second client fetch | fetch where you render |
| Cost of one more field | bigger payload for every visitor | none on the client |

The second row is the one that changes how you design. There is no props tunnel, so there is no
pressure to hoist every query to the top of the page and thread the results down. In Module 11's
`Header` you will fetch the menu *inside* the component that renders the menu, three levels below
the route, and no page has to know about it.

### 9. What this lesson deliberately does not do

Four omissions, all listed as debts in the module README, each with an owner:

| Missing | Consequence today | Paid off |
|---|---|---|
| A shared GraphQL client | the same twelve lines of `fetch` in every route file | Lesson 10.1 |
| Generated types | `src/types/graphql-responses.ts`, hand-written and already lying | Lesson 10.2 |
| A cache policy | see below | Lesson 10.3 |
| `loading.tsx` / `error.tsx` | a slow WordPress means a blank page, and a thrown error means Next's default error screen | Lesson 10.4 |

The cache row deserves a sentence, because Next 15 changed the default. **`fetch` is no longer
cached by default** — a plain `fetch` behaves as `cache: 'no-store'`, so every request to
`/en/incidents` really does hit WordPress. That is the right default for a course: nothing is
mysteriously stale, and reloading shows the edit you just made in wp-admin. It is also why the
route table in `npm run build` marks these routes dynamic rather than prerendered. Lesson 10.3
chooses cache lifetimes and tags deliberately, and Module 18 wires WordPress to invalidate them.

---

## Task

### Step 1: Get a real slug from the seeded content

Do not hard-code a slug you cannot guarantee. Ask WordPress:

```bash
cd next-app

curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"query IncidentsList($first:Int!){ incidents(first:$first, where:{status:PUBLISH}){ nodes { slug title } } }","variables":{"first":3}}' \
  | jq '.data.incidents.nodes'
```

**Verify §1:**

- [ ] Three objects, each with a `slug` and a `title` — the seeder's 40 incidents from
      [appendix 03 §9](../appendix/03-content-model-reference.md#9-seed-data).
- [ ] `jq '.errors'` on the same response is `null`. If it is not, fix that before writing any
      TypeScript — an `errors` array here means the query is wrong, not the code.

Keep the first slug on your clipboard. Every check below uses it.

### Step 2: Write the hand-written response types

One file, two exported response types, and a header that names its own expiry date.

```ts
// next-app/src/types/graphql-responses.ts
//
// HAND-WRITTEN GraphQL response types, transcribed by eye from the GraphiQL result
// panel in Module 05.
//
// ⚠️ EVERY TYPE IN THIS FILE IS AN ASSERTION, NOT A CHECK. Nothing verifies it against
// wordpress-headless/schema.graphql. Lesson 10.2 DELETES this file and generates its
// replacement from the committed schema, in one commit. Lesson 09.4 makes it longer,
// on purpose, because length is the argument.

import type {
  IncidentEnvironment,
  IncidentResolutionStatus,
  PageInfo,
  SeverityLevel,
} from '@/types/content';

/** A `severity` term as selected by the incident queries. */
interface SeverityNode {
  readonly id: string;
  readonly name: string;
  readonly slug: SeverityLevel;
  readonly count: number;
}

/** A `scapegoat` or `tech_stack` term as selected by the incident queries. */
interface TermNode {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly count: number;
}

/**
 * The `incidentDetails` ACF group.
 *
 * Every field here is declared non-null because every field had a value in the response
 * that was on screen when this was written. The schema disagrees about all nine of them —
 * see appendix 03 §4.1. `downtimeMinutes` is the one this lesson makes you feel.
 */
interface IncidentDetailsResponse {
  readonly occurredAt: string;
  readonly downtimeMinutes: number; // ⚠️ schema says Float — NULLABLE. Key Concept 5.
  readonly estimatedCostUsd: number;
  readonly environment: IncidentEnvironment;
  readonly resolutionStatus: IncidentResolutionStatus;
  readonly blameConfidence: number;
  readonly stackTrace: string;
  readonly reporterDisplayName: string;
  readonly isVerified: boolean;
}

/** One node of the `IncidentsList` connection. Shaped to satisfy `Incident`. */
export interface IncidentNodeResponse {
  readonly id: string;
  readonly databaseId: number;
  readonly title: string;
  readonly slug: string;
  readonly date: string;
  readonly blameScore: number;
  readonly incidentDetails: IncidentDetailsResponse;
  readonly severities: { readonly nodes: readonly SeverityNode[] };
  readonly scapegoats: { readonly nodes: readonly TermNode[] };
  readonly techStacks: { readonly nodes: readonly TermNode[] };
}

/** `query IncidentsList($first: Int!, $after: String, $search: String)` */
export interface IncidentsQueryResponse {
  readonly incidents: {
    readonly pageInfo: PageInfo;
    readonly nodes: readonly IncidentNodeResponse[];
  };
}

/** `query IncidentBySlug($slug: ID!)` — `incident` is null for an unknown slug. */
export interface IncidentBySlugQueryResponse {
  readonly incident: (IncidentNodeResponse & { readonly content: string | null }) | null;
}

/** The envelope every WPGraphQL response arrives in. Key Concept 3. */
export interface GraphQLPayload<TData> {
  readonly data?: TData;
  readonly errors?: readonly { readonly message: string }[];
}
```

Note the one field that *is* declared nullable: `content`. That is not inconsistency, it is the
shape of the lie. You believed the fields you saw filled in and hedged on the one you knew editors
leave empty — which is exactly how this kind of type gets written in real projects, and exactly
why it cannot be trusted.

`IncidentBySlugQueryResponse` declares `incident` as nullable because
[Lesson 05.3](../05-wpgraphql-fundamentals/03-variables-fragments-and-directives.md) proved it:
an unknown slug resolves to `null`, not to an error.

### Step 3: Switch `/[locale]/incidents` to live data

The components do not change. Only the source of the array does — which is the promise Module 08
made when its fixtures were shaped like real WPGraphQL responses.

```tsx
// next-app/src/app/[locale]/incidents/page.tsx
import { IncidentBrowser } from '@/components/incidents/IncidentBrowser';
import { IncidentFilterProvider } from '@/components/incidents/IncidentFilterProvider';
import type { GraphQLPayload, IncidentsQueryResponse } from '@/types/graphql-responses';

// Inline for now. Lesson 10.5 moves every document into src/graphql/*.graphql files and
// splits the repeated selections into fragments. The operation NAME is the one you saved
// in Lesson 05.2; the selection set is wider, because IncidentCard's prop type is the
// whole `Incident` and a query has to satisfy the type that consumes it.
const INCIDENTS_LIST = /* GraphQL */ `
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
        blameScore
        incidentDetails {
          occurredAt
          downtimeMinutes
          estimatedCostUsd
          environment
          resolutionStatus
          blameConfidence
          stackTrace
          reporterDisplayName
          isVerified
        }
        severities(first: 1) {
          nodes {
            id
            name
            slug
            count
          }
        }
        scapegoats(first: 1) {
          nodes {
            id
            name
            slug
            count
          }
        }
        techStacks(first: 5) {
          nodes {
            id
            name
            slug
            count
          }
        }
      }
    }
  }
`;

// These twelve lines are about to appear in six route files. That duplication is the
// argument for Lesson 10.1's src/lib/graphql/client.ts — do not extract it yet.
async function fetchIncidents(first: number): Promise<IncidentsQueryResponse> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
  if (!endpoint) {
    throw new Error('WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local.');
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: INCIDENTS_LIST, variables: { first } }),
  });

  // Catches a wrong URL and a dead PHP process. Catches nothing else — Key Concept 3.
  if (!res.ok) throw new Error(`WPGraphQL transport failure: HTTP ${res.status}`);

  const payload = (await res.json()) as GraphQLPayload<IncidentsQueryResponse>;

  // Server-side log. Never rendered: an error message can name internal fields.
  if (payload.errors?.length) {
    console.error('[btt] IncidentsList errors:', payload.errors.map((e) => e.message).join('; '));
  }
  if (!payload.data) throw new Error('WPGraphQL returned no data for IncidentsList');

  return payload.data;
}

export default async function IncidentsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const data = await fetchIncidents(40);
  const incidents = data.incidents.nodes;

  console.log(`[btt] /${locale}/incidents rendered on the server`);

  return (
    <main>
      <h1>Incidents</h1>
      <p>{incidents.length} incidents, live from WordPress.</p>

      <IncidentFilterProvider>
        <IncidentBrowser incidents={incidents} />
      </IncidentFilterProvider>
    </main>
  );
}
```

**Verify §3:**

- [ ] `/en/incidents` lists real seeded titles, not the fixture titles from Lesson 08.2.
- [ ] The terminal shows the render log once per full page load.
- [ ] The search box and the severity filter still work. Not one component changed.
- [ ] `npm run type-check` passes. Note that it would also pass if you had misspelled every
      nullability in the file.

### Step 4: Build the incident detail route

```tsx
// next-app/src/app/[locale]/incidents/[slug]/page.tsx
import { notFound } from 'next/navigation';
import type { GraphQLPayload, IncidentBySlugQueryResponse } from '@/types/graphql-responses';

const INCIDENT_BY_SLUG = /* GraphQL */ `
  query IncidentBySlug($slug: ID!) {
    incident(id: $slug, idType: SLUG) {
      id
      databaseId
      title
      slug
      date
      content
      blameScore
      incidentDetails {
        occurredAt
        downtimeMinutes
        estimatedCostUsd
        environment
        resolutionStatus
        blameConfidence
        stackTrace
        reporterDisplayName
        isVerified
      }
      severities(first: 1) {
        nodes {
          id
          name
          slug
          count
        }
      }
      scapegoats(first: 1) {
        nodes {
          id
          name
          slug
          count
        }
      }
      techStacks(first: 5) {
        nodes {
          id
          name
          slug
          count
        }
      }
    }
  }
`;

async function fetchIncident(slug: string): Promise<IncidentBySlugQueryResponse> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
  if (!endpoint) {
    throw new Error('WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local.');
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // `id: $slug, idType: SLUG` — a bare `id:` with a slug returns null (Lesson 05.3).
    body: JSON.stringify({ query: INCIDENT_BY_SLUG, variables: { slug } }),
  });

  if (!res.ok) throw new Error(`WPGraphQL transport failure: HTTP ${res.status}`);

  const payload = (await res.json()) as GraphQLPayload<IncidentBySlugQueryResponse>;
  if (payload.errors?.length) {
    console.error('[btt] IncidentBySlug errors:', payload.errors.map((e) => e.message).join('; '));
  }
  if (!payload.data) throw new Error('WPGraphQL returned no data for IncidentBySlug');

  return payload.data;
}

export default async function IncidentPage({
  params,
}: {
  readonly params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;
  const { incident } = await fetchIncident(slug);

  // Throws. Nothing below runs, and TypeScript narrows `incident` for the rest of the file.
  if (!incident) notFound();

  const details = incident.incidentDetails;
  const severity = incident.severities.nodes[0];
  const scapegoat = incident.scapegoats.nodes[0];

  return (
    <main>
      <h1>{incident.title}</h1>

      <dl>
        <dt>Severity</dt>
        <dd>{severity?.name ?? 'unclassified'}</dd>

        <dt>Blamed on</dt>
        <dd>{scapegoat?.name ?? 'nobody, yet'}</dd>

        <dt>Environment</dt>
        <dd>{details.environment}</dd>

        <dt>Downtime</dt>
        {/* Step 6 breaks this line on purpose. The type says `number`; the schema says
            Float, which is nullable. Do not add `?.` — that would hide the lesson. */}
        <dd>{details.downtimeMinutes.toFixed(0)} minutes</dd>

        <dt>Blame confidence</dt>
        <dd>{details.blameConfidence}%</dd>
      </dl>

      <pre>{details.stackTrace}</pre>

      {/* DEBT (Module 09 → Module 14): the entire post body as one opaque HTML string.
          Module 14 replaces this with BlockRenderer over structured block data. Never
          render `renderedHtml`, and never put a user-supplied string in here. */}
      <div dangerouslySetInnerHTML={{ __html: incident.content ?? '' }} />
    </main>
  );
}
```

`stackTrace` goes in a `<pre>` as **escaped text**, not through `dangerouslySetInnerHTML` —
appendix 03 §4.1 says so explicitly, and it is the field most likely to contain something that
looks like markup.

**Verify §4:**

- [ ] `/en/incidents/<the slug from Step 1>` renders a title, a definition list and a post body.
- [ ] `/en/incidents/definitely-not-a-real-slug` returns Next's 404 page — and check the Network
      tab: the status is really `404`, not a 200 with 404-shaped content.

### Step 5: Put the home page on live data too

The module README promises `/en` renders the latest incidents from WordPress, so make good on it.
Reuse the same operation with `first: 6` — copy the `INCIDENTS_LIST` document and `fetchIncidents`
helper from Step 3 into the home page file, and replace the fixtures import:

```tsx
// next-app/src/app/[locale]/page.tsx (fragment — imports, then the body. The
// INCIDENTS_LIST document and the fetchIncidents helper are copied in from Step 3.)
import { IncidentCard } from '@/components/incidents/IncidentCard';
import type { GraphQLPayload, IncidentsQueryResponse } from '@/types/graphql-responses';

export default async function HomePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Module 10 replaces this with `HomepageFeeds`, one request with `catastrophic:` and
  // `recent:` aliases, so the home page stops paying for two round trips.
  const data = await fetchIncidents(6);

  return (
    <main>
      <h1>Blame The Tech</h1>
      <p>The six most recent incidents. Locale: {locale}.</p>
      <ul>
        {data.incidents.nodes.map((incident) => (
          <li key={incident.id}>
            <IncidentCard incident={incident} />
          </li>
        ))}
      </ul>
    </main>
  );
}
```

Yes, that is the same document and the same helper in a second file. Copying it is the assignment.
By the end of Lesson 09.4 you will have six copies, and Lesson 10.1 deletes five of them.

Delete the now-unused `SEED_INCIDENTS` import — `noUnusedLocals` from Lesson 07.3 will remind you.
`fixtures.ts` itself stays: Module 12 tests against it.

### Step 6: Introduce the drift on purpose, and watch it typecheck

Your type already says `downtimeMinutes: number`. Prove the compiler is happy, then make WordPress
tell the truth.

```bash
npm run type-check
echo "exit=$?"
# Expected: exit=0. The type contradicts the schema and nothing on this machine can tell.
```

Now blank the field on one incident, exactly as an editor in a hurry would:

```bash
SLUG=$(curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"query IncidentsList($first:Int!){ incidents(first:$first, where:{status:PUBLISH}){ nodes { slug } } }","variables":{"first":1}}' \
  | jq -r '.data.incidents.nodes[0].slug')

ID=$( (cd ../wordpress-headless && docker compose run --rm wpcli wp post list \
        --post_type=incident --name="$SLUG" --field=ID) | tr -d '\r' )

(cd ../wordpress-headless && docker compose run --rm wpcli wp post meta delete "$ID" downtime_minutes)

curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3000/en/incidents/$SLUG"
# Expected: 500
```

Read the dev server terminal. `TypeError: Cannot read properties of null (reading 'toFixed')`,
with the file and line. Then restore the data so the rest of the course has a working route:

```bash
(cd ../wordpress-headless && docker compose run --rm wpcli wp post meta update "$ID" downtime_minutes 47)
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3000/en/incidents/$SLUG"
# Expected: 200
```

**Do not change the type.** Restoring the data fixed the symptom and left the bug — which is worse
than the crash, because now it is latent and waiting for the next editor. Add one comment above the
field instead:

```ts
// next-app/src/types/graphql-responses.ts (fragment — the annotation, not a fix)
  // KNOWN WRONG. Schema: Float (nullable). Proven with a 500 on 2 <today>. The fix is not
  // `number | null` here — it is deleting this file. Lesson 10.2.
  readonly downtimeMinutes: number;
```

### Step 7: Write the hand-written-type inventory

Append to `docs/api-contract.md`, the document you started in Module 06. Lesson 10.2 works from
this list, so it has to be complete rather than representative:

```markdown
## Hand-written GraphQL response types (Module 09 debt)

Every type below is an assertion about WPGraphQL's output that nothing verifies. Lesson 10.2
deletes the file and regenerates the equivalents from wordpress-headless/schema.graphql.

| Type | Operation | Known to disagree with the schema |
|---|---|---|
| `IncidentNodeResponse` | `IncidentsList` | all nine `incidentDetails` fields declared non-null; schema says nullable |
| `IncidentBySlugQueryResponse` | `IncidentBySlug` | inherits the above, plus `content` guessed |
| … | … | Lesson 09.4 adds five more rows |

### Why we are keeping them for one module
(Your own two sentences. If you cannot write them, re-read Key Concept 5.)
```

Write the two sentences yourself. A debt you recorded without being able to say why you took it
on is indistinguishable from a debt you did not notice, and Lesson 10.2 opens by reading this
section back to you. Add a row every time Lesson 09.4 adds a type.

---

## Verification

```bash
cd next-app

# 1. Capture a real slug, and prove the list query is error-free
SLUG=$(curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"query IncidentsList($first:Int!){ incidents(first:$first, where:{status:PUBLISH}){ nodes { slug } } }","variables":{"first":1}}' \
  | jq -r '.data.incidents.nodes[0].slug')
echo "slug=$SLUG"
# Expected: slug=<one of the 40 seeded incident slugs>, never "null"

curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"query IncidentsList($first:Int!){ incidents(first:$first){ nodes { slug } } }","variables":{"first":5}}' \
  | jq '.errors'
# Expected: null   — the house rule: read .errors, never the status code

# 2. The three live routes answer
curl -s -o /dev/null -w 'home=%{http_code}\n' http://localhost:3000/en
curl -s -o /dev/null -w 'list=%{http_code}\n' http://localhost:3000/en/incidents
curl -s -o /dev/null -w 'detail=%{http_code}\n' "http://localhost:3000/en/incidents/$SLUG"
# Expected: home=200, list=200, detail=200

# 3. The data is in the server-rendered HTML, not fetched by the browser
curl -s "http://localhost:3000/en/incidents/$SLUG" | grep -c 'minutes'
# Expected: at least 1 — the downtime rendered before any JavaScript ran

# 4. NEGATIVE — an unknown slug is a real 404, from notFound()
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/incidents/definitely-not-a-real-slug
# Expected: 404

# 5. NEGATIVE — type-check passes on a type that contradicts the schema.
#    This is the module's headline debt, printed as a success. It is evidence for
#    Lesson 10.2, not breakage.
npm run type-check; echo "exit=$?"
# Expected: exit=0

# 6. NEGATIVE — and here is what that exit=0 is worth. Blank one field, get a 500.
ID=$( (cd ../wordpress-headless && docker compose run --rm wpcli wp post list \
        --post_type=incident --name="$SLUG" --field=ID) | tr -d '\r' )
(cd ../wordpress-headless && docker compose run --rm wpcli wp post meta delete "$ID" downtime_minutes)
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3000/en/incidents/$SLUG"
# Expected: 500. Terminal: TypeError: Cannot read properties of null (reading 'toFixed')
(cd ../wordpress-headless && docker compose run --rm wpcli wp post meta update "$ID" downtime_minutes 47)
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3000/en/incidents/$SLUG"
# Expected: 200 — data restored, type still wrong, bug now latent

# 7. NEGATIVE — the endpoint never reached the client bundle
npm run build
grep -r 'WP_GRAPHQL_ENDPOINT' .next/static/
# Expected: no output
grep -r 'localhost:8080' .next/static/
# Expected: no output

# 8. The blob is where the module says it is, and nowhere else
grep -rc 'dangerouslySetInnerHTML' src/app/\[locale\]/incidents/\[slug\]/page.tsx
# Expected: 1
grep -rl 'renderedHtml' src/ | wc -l
# Expected: 0   — never render that field, in any module

# 9. Lint stays clean, including the new Next rules
npm run lint
# Expected: no output
```

Checks 5 and 6 are the two most important lines in Module 09. Read them together: a green
type-check and a 500 on the same code, on the same afternoon.

## Control Questions

1. `if (!res.ok) throw` is in both route files, and it will almost never fire. Name three failures
   it does not catch, say what the code does instead in each case, and name the field every check
   in this course reads instead of the status code.
2. `npm run type-check` exits 0 while `downtimeMinutes` is declared `number` and the schema says
   nullable `Float`. Explain precisely what TypeScript was asked to verify, what it did verify, and
   why restoring the meta value in Step 6 made the situation worse rather than better.
3. The detail page calls `notFound()` with no `not-found.tsx` anywhere in the project. Describe
   what the browser receives, what the status code is, and what Lesson 10.4 changes about it.
4. `stackTrace` is rendered inside `<pre>{details.stackTrace}</pre>` while `content` goes through
   `dangerouslySetInnerHTML`. Justify the difference in terms of who authored each string, and say
   what would have to be true about `content` for the same treatment to be safe.
5. This lesson fetches the same `IncidentsList` document from two files, with a copied helper.
   Name the two distinct problems that duplication causes — one for correctness, one for caching —
   and say which lesson fixes each.

## Learn More

- [Fetching data in the App Router](https://nextjs.org/docs/app/getting-started/fetching-data) —
  Next's own guide to `async` components; skim the sequential-versus-parallel section for Module 11
- [GraphQL over HTTP](https://graphql.org/learn/serving-over-http/) — the specification's own
  account of why errors come back with 200, from the people who decided it
- [`notFound()`](https://nextjs.org/docs/app/api-reference/functions/not-found) — the `never`
  return type and the boundary it looks for
- [`dangerouslySetInnerHTML`](https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html)
  — React's own warning, worth reading once so the name stops feeling like hyperbole
- [MDN: `Element.innerHTML` security considerations](https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML#security_considerations)
  — what you are actually accepting when you hand a string to the parser
- [`the_content()`](https://developer.wordpress.org/reference/functions/the_content/) — the filter
  chain that produced the blob, and therefore the list of plugins that can change it under you
- [GraphQL Code Generator](https://the-guild.dev/graphql/codegen/docs/getting-started) — read the
  first page now, with Key Concept 5 fresh, then again in Lesson 10.2
- [Next.js caching](https://nextjs.org/docs/app/guides/caching) — the reference for the Next 15
  default in Key Concept 9; Lesson 10.3 works through it properly
