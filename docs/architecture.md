<!-- docs/architecture.md -->

# Blame The Tech — architecture and the headless contract

Written in Module 01, before anything runs. Revisit it at the end of Module 18, when every
row below has been paid for.

## Request lifecycle — Classic WordPress

```
CLASSIC WORDPRESS — one process, one request, one machine

Browser
  │  GET /incidents/dns/
  ▼
index.php
  │
  ▼
wp-load.php ──▶ wp-config.php · active plugins · theme functions.php
  │
  ▼
parse_request()          rewrite rules turn the URL into query vars
  │
  ▼
WP_Query  (the main query)
  │
  ├──── SQL ────▶ MySQL
  │◀─────────────
  ▼
template_redirect
  │
  ▼
template hierarchy picks single-incident.php
  │
  ▼
the Loop  →  get_header() · the_content() · get_footer()
  │          wp_head() / wp_footer() emit <link> and <script> tags
  ▼
Browser gets a complete HTML page
```

## Request lifecycle — headless

```
HEADLESS — two processes, one network hop between them

Browser
  │  GET /en/incidents/dns            :3000 in dev, the Vercel edge in prod
  ▼
middleware.ts                         locale resolution + auth gate
  │
  ▼
ISR cache lookup, tag 'incident:dns'
  │
  ├── HIT ──▶ serve cached HTML ─────────────────────────────┐
  │                                                          │
  └── MISS                                                   │
       │                                                     │
       ▼                                                     │
    app/[locale]/incidents/[slug]/page.tsx                    │
       │  await fetchGraphQL(IncidentBySlug, {               │
       │        next: { tags: ['incident:dns'] } })          │
       │                                                     │
       ▼  POST /graphql   server-to-server, :8080 in dev     │
    WordPress · WPGraphQL                                     │
       │                                                     │
       ▼  WP_Query                                           │
    MySQL · db:3306                                           │
       │                                                     │
       ▼  JSON { incident, editorBlocks[], severity, seo }   │
    React Server Components render on the server              │
    <BlockRenderer blocks={…} /> → a React tree               │
       │                                                     │
       ▼  store under tag 'incident:dns' ───────────────────▶│
       │                                                     │
       ▼                                                     ▼
Browser gets HTML + a small RSC payload ◀────────────────────┘
hydrates only the interactive islands — nav, filters, dialogs
```

## Local topology

```
┌─ YOUR LAPTOP ────────────────────────────────────────────────────────────┐
│                                                                          │
│   Browser                                                                │
│     :3000  the app          :8080  /wp-admin  and  /graphql              │
│     :8081  Adminer          :8025  Mailpit                               │
│                                                                          │
│   ┌─────────────────────────────────────────────────────┐                │
│   │ next-app     `npm run dev`     NOT in Docker        │                │
│   │ Next.js 15 · Node 22 · owns routing and rendering   │                │
│   └─────────┬────────────────────────▲──────────────────┘                │
│             │ POST /graphql          │ POST /api/revalidate              │
│             │ server-to-server       │ from                              │
│             │ never from the browser │ host.docker.internal:3000         │
│   ┌─────────▼────────────────────────┴──────────────────┐                │
│   │ docker compose   project: btt   network: btt-net    │                │
│   │                                                     │                │
│   │ wordpress :8080   adminer :8081   mailpit :8025     │                │
│   │      │                │              ▲  :1025       │                │
│   │      └────────┬───────┘              │              │                │
│   │               ▼ db:3306              │ wp_mail()    │                │
│   │          mysql:8.0  ─────────────────┘              │                │
│   │                                                     │                │
│   │ wpcli   run on demand, zero containers idle         │                │
│   └─────────────────────────────────────────────────────┘                │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## What WordPress guarantees to Next.js

| Guarantee                               | Mechanism                                                                                              | Enforced from |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------- |
| Field names are stable                  | appendix 03 is a contract                                                                              | Module 03     |
| The schema is a reviewable artifact     | `wp graphql generate-static-schema` writes `wordpress-headless/schema.graphql`, which is **committed** | Module 06     |
| Every mutation authorises independently | `current_user_can()` inside `mutateAndGetPayload` — WPGraphQL does **not** do this for you             | Module 06     |
| Errors arrive as data, not exceptions   | GraphQL answers **HTTP 200 with an `errors` array**. `fetch` will never throw                          | Module 10     |
| No markup that must be parsed           | Blocks arrive as structured data with typed attributes, never as an HTML blob to regex                 | Module 14     |
| Enums, not bare strings                 | Registered GraphQL enums so codegen produces union types                                               | Module 06     |
| Content is queryable without a session  | Public reads need no credential; only mutations and drafts do                                          | Module 05     |

## What Next.js guarantees to WordPress

| Guarantee                                  | Mechanism                                                                                                                      | Enforced from |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Input is validated before it is sent       | Zod schemas at the Server Action boundary — **and** Next accepts that WordPress validates again                                | Module 16     |
| It never holds WordPress's signing secret  | Next does not have `GRAPHQL_JWT_AUTH_SECRET_KEY` at all                                                                        | Module 15     |
| It treats the JWT as opaque                | It decodes the payload only to read `exp` as a "should I refresh?" heuristic; every real authorisation decision is WordPress's | Module 15     |
| `/graphql` is never exposed to the browser | Server-only module, guarded with `import 'server-only'`                                                                        | Module 10     |
| Webhooks it receives are authenticated     | HMAC-SHA256 over timestamp and body, `timingSafeEqual`, ±300 s replay window                                                   | Module 18     |
| Tokens are never readable by JavaScript    | httpOnly cookies set by route handlers. No `localStorage`, no query string, no `NEXT_PUBLIC_`                                  | Module 15     |

## What neither side may assume

| Side      | May not assume                         | Consequence in the code                                                                                             |
| --------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
|           | WordPress                              | that a browser is rendering its output                                                                              | No shortcode that emits markup the front end must parse; no `wp_enqueue_*`; no PHP-rendered menu |
| WordPress | that its own front end is ever visited | The theme redirects; the WP-rendered archive is never user-visible                                                  |
| Next.js   | that WordPress is **up**               | Every fetch has an error boundary and a `loading.tsx`. A GraphQL failure renders a degraded page, not a stack trace |
| Next.js   | that WordPress is **fast**             | Timeouts, ISR, and per-route `revalidate` values — a slow origin must not become a slow site                        |
| Next.js   | that WordPress is **fresh**            | Cached content is stale by design until a tag is invalidated. Staleness is a policy, not a bug                      |
| Next.js   | that it is **trusted**                 | A compromised front end is a plausible attacker, so WordPress re-validates and re-authorises every write            |
| Both      | that the clocks agree                  | The revalidation webhook carries a timestamp and accepts a ±300 s window; outside it, replay is rejected            |
| Both      | that the other side is the only client | wp-admin writes content directly, and WP-CLI writes it from a container. Neither goes through Next                  |

## What decoupling costs

| What breaks                    | Why                                                                            | Restored in                          | Fully?                                                                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Preview**                    | The Preview button renders a WordPress template that no longer exists          | Module 17                            | Partly. The mechanism is a **single-use, 120-second** token exchanged server-to-server, not a cookie. Reloading a preview URL consumes an already-consumed token and 404s. Editors must be told this                                                  |
| **Menus**                      | `wp_nav_menu()` returned markup; you now get data                              | Module 05                            | Yes, and arguably better. Every walker class and `nav_menu_css_class` filter you ever wrote is gone — and so is the fight to get semantic markup out of it                                                                                            |
| **Forms**                      | Contact Form 7 and Gravity Forms render their own front end                    | Module 16                            | No. You own the entire pipeline, spam defence included: honeypot, form-render timing, Turnstile, rate limiting, and server-side re-validation                                                                                                         |
| **Search**                     | There is no `s=` query-var behaviour handed to you for free                    | Module 05 (`search:` on connections) | Partly. WPGraphQL exposes a search argument, but relevance ranking, faceting and typo tolerance are yours. A real product reaches for a search service                                                                                                |
| **The plugin ecosystem**       | Anything that renders front-end HTML has nowhere to render it                  | never                                | **No — this is a permanent loss.** Sliders, related-post widgets, page builders, cookie banners and most SEO front-end output stop working. What survives is plugins that only touch **data** (ACF, Polylang) or the **editor** (Yoast's metadata UI) |
| **Comments**                   | Core comments assume a WordPress-rendered page and `comment_form()`            | not in this course                   | No. The data is queryable; the moderation UI, spam handling and rendering would all be yours to build                                                                                                                                                 |
| **Cache invalidation**         | There is no `wp_cache_flush()` that reaches a CDN in another company's network | Module 18                            | Yes, but it becomes code you own and test: a signed webhook, tag names centralised in one module, and a failure mode where a 401 is silent by design                                                                                                  |
| **Debuggability**              | One stack trace becomes two processes, two log streams and a network hop       | Modules 02, 24                       | Partly. `docker compose logs -f wordpress` plus the Next terminal covers local work; production needs Sentry and structured logging                                                                                                                   |
| **One more deployment target** | Two applications, two platforms, two sets of secrets                           | Module 24                            | It is not restored, it is accepted. The CI setup in Module 24 exists because of this row                                                                                                                                                              |

## Where I disagree

Nothing, cause I'm the course creator. See step 4 with potential variants.

## Effects removed from the incident UI (Lesson 08.4)

An effect synchronises React with something outside it. If both sides of the
synchronisation are inside React, the effect buys a second render and a chance for two
values to disagree.

| Removed                                                          | Why it was wrong                                                                              | Replaced by                                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| effect deriving `visible` into state in `IncidentList`           | both inputs were already in React; it produced a frame where the count and the list disagreed | `incidents.filter(...)` during render                                          |
| effect deriving `count` from `visible`                           | derived from derived, and lagging by one more render                                          | `visible.length` during render                                                 |
| effect resetting `query` when `severity` changed, in the harness | indistinguishable from a mount, and it fought the user mid-word                               | nothing. If a reset is ever required, a changing `key` remounts the component. |

The only effect left in the incident UI is the `setTimeout` inside `useDebouncedValue`,
which is legitimate because a browser timer keeps running whether React renders or not
and therefore has to be cancelled.

**Data fetching will never be an effect in this project.** Server Components fetch before
they render (Lesson 09.3), so there is no browser request, no public endpoint, no CORS
policy, and no spinner over content the server already had.

## State inventory: the incident UI (Lesson 08.5)

Fourteen values on screen. Four are state. Eight are derived during render, one is a
prop, and one belongs to the DOM.

| Value                                 | Kind                 | Lives in                                             |
| ------------------------------------- | -------------------- | ---------------------------------------------------- |
| selected severity                     | state                | `IncidentFilterProvider`                             |
| selected scapegoat                    | state                | `IncidentFilterProvider`                             |
| search text                           | state                | `IncidentFilterProvider`                             |
| debounced search text                 | state                | inside `useDebouncedValue`, called by `IncidentList` |
| whether any filter is active          | derived              | one line in `FilterBar`                              |
| the filtered incident array           | derived              | `IncidentList`                                       |
| "N of 40 incidents"                   | derived              | `IncidentList`                                       |
| whether the empty state shows         | derived              | `IncidentList`                                       |
| the forty incidents                   | prop                 | `App` to `IncidentList`                              |
| an incident's severity label          | derived              | `IncidentCard`                                       |
| "Nobody yet" for an unblamed incident | derived              | `IncidentCard`                                       |
| whether the stack-trace block appears | derived              | `IncidentCard`                                       |
| whether "Clear search" is disabled    | derived              | `IncidentSearch`                                     |
| the input's focus                     | the DOM's, via a ref | `IncidentSearch`                                     |

Rules I am applying from here on:

1. If two values on screen could ever disagree, one of them is derived. Compute it.
2. State goes to the lowest component that needs it, and is lifted only when two
   siblings must agree.
3. Context is for shared UI state, props are for data. `incidents` is a prop precisely
   so that Lesson 09.3 can swap fixtures for a live query without touching a component.
4. A context with no sensible default gets `undefined` and a consumer hook that throws.
5. A context publishes facts, not conclusions. `IncidentFilterValue` has seven members:
   three values, three setters and `clear`. Anything derivable is derived by whichever
   component shows it or pays for it.

Known debt, taken on deliberately: the search filters client-side over an array that is
already in memory. That is correct for 40 fixtures and wrong for 4,000 incidents —
Module 10 moves the work behind a cached query and Lesson 18.1 moves the filter state into
`searchParams` so the server does the filtering.

## Proxy: what it is for, and what it must never be

`src/proxy.ts` runs before the router, on every request its `matcher` selects, in the
Node.js runtime. Next 16 renamed this file from `middleware.ts` and pinned it to Node; the
runtime is not configurable. Node APIs being reachable is not permission to use them —
everything here is on the hot path of every request.

**It is for:** normalising URLs (the locale prefix), cheap redirects for the common case, and
setting request-scoped headers.

**It must never be:** an authorisation check.

Proxy cannot verify a session, because Next.js never holds
GRAPHQL_JWT_AUTH_SECRET_KEY — see appendix 04 §5. It can see that a cookie exists. It cannot
know whether the cookie is valid, unexpired, or belongs to a user with the capability being
exercised. Only WordPress can answer that.

So the auth gate Module 15 adds here is **half a check**: it saves a logged-out visitor from
a broken page. Every route that reads user-specific data re-verifies the session where the
data is fetched. If the proxy were deleted tomorrow, no data would become accessible
that was not accessible before — and if that statement ever stops being true, the security
model has been broken.

A missing-cookie redirect stops a logged-out human from seeing a broken page. It stops nothing else.
An attacker sends any cookie value they like, or requests the RSC payload directly,
or crafts a request the matcher does not cover — and the page
renders, because nothing else ever checked.
