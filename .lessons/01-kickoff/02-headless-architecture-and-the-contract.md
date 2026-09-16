---
title: 'Headless Architecture & the Contract'
module: 1
lesson: 2
teaches: [headless-contract, wpgraphql-as-boundary, decoupled-tradeoffs, server-side-fetching]
produces: []
requires: [1.1]
---

# Lesson 01.2 — Headless Architecture & the Contract

## Quick Overview

Headless is not a feature you switch on; it is a boundary you agree to. On one side WordPress
owns content, editing, authorisation and the database. On the other side Next.js owns routing,
rendering, sessions and the browser. Between them there is exactly one channel: a
`POST /graphql` request made **from the Next.js server**, never from the browser. This lesson
draws that boundary precisely, because every architectural argument in the remaining 23 modules
is an argument about what is allowed to cross it.

The contract has teeth in both directions. WordPress may not assume anything about how its
content is rendered — no shortcodes that emit markup the front end must parse, no
`wp_enqueue_script`, no PHP-rendered menus. Next.js may not assume it is trusted — it
re-validates input before sending it, and WordPress validates again on arrival, because a
compromised front end is a plausible attacker. This lesson also does the unglamorous half:
naming what decoupling costs you. Preview stops working until Module 17. Plugins that render
their own front-end HTML stop working permanently. Search, menus, forms and comments each need
rebuilding. You should know that before Module 02, not in Module 14.

By the end of this lesson you will have:

- The local architecture diagram from [PROJECT.md](../PROJECT.md) redrawn from memory, with the
  four published ports and which process each belongs to
- A written contract listing what WordPress guarantees and what Next.js guarantees
- A list of at least six classic WordPress capabilities decoupling breaks, and the module that
  restores each
- The reason the GraphQL endpoint is server-only, and the name of the anti-pattern that
  publishes it — `NEXT_PUBLIC_WORDPRESS_URL`
- An understanding of why there is no CORS configuration anywhere in this course

## Classic WP Analogy

| Classic WordPress | Headless equivalent | Where it lives |
|---|---|---|
| `WP_Query` in a template | A GraphQL query in a Server Component | Module 05, then 09 |
| `get_field('downtime_minutes')` | `incidentDetails { downtimeMinutes }` in the query | Module 04 |
| `get_header()` / `get_footer()` | `app/[locale]/layout.tsx` | Module 09 |
| `wp_nav_menu()` | `menuItems(where: { location: PRIMARY })` | Module 05 |
| `admin_post_` handler + nonce | A Server Action + a guarded GraphQL mutation | Modules 06, 16 |
| `wp_enqueue_style` / `_script` | The bundler decides; you `import` | Modules 07, 11 |
| Object cache flush on save | `revalidateTag()` triggered by a signed webhook | Module 18 |
| `is_user_logged_in()` | A JWT in an httpOnly cookie, checked in `proxy.ts` | Module 15 |

The most useful way to read that table is as a *relocation* list, not a replacement list.
Almost nothing in it is a new idea — `WP_Query` with `tax_query` becomes a connection with a
`where` argument, and the mental model of "select posts, filter by term, order, paginate" is
untouched. You already know how to think about this data. You are learning a second syntax for
expressing thoughts you can already have.

**Where the analogy breaks down:** every row on the left runs in *one* process, inside *one*
request, with shared memory and a shared database handle. Every row on the right runs in two
processes on two machines, and the wire between them is a network you can lose. That is the
real difference, and it is not syntactic. It means the front end must handle a WordPress that
is slow, down, or answering with stale data; it means a field is either in the schema or
invisible; and it means "just call `get_post_meta()` here" — the move that solves a hundred
Classic WordPress problems — is unavailable to you for the rest of the course.

---

## Key Concepts

### 1. What WordPress stops doing

Decoupling does not make WordPress smaller. It makes WordPress **narrower** — it keeps every
responsibility that involves content and gives up every responsibility that involves a browser.

| Classic responsibility | Who owns it now | Where it lands |
|---|---|---|
| The template hierarchy (`single-incident.php`, `archive-incident.php`, `404.php`) | Next.js file conventions | Module 09 |
| `get_header()` / `get_footer()` | `app/[locale]/layout.tsx` — and layouts **persist across navigation** | Module 09 |
| `wp_head()` / `wp_footer()` | `generateMetadata()` | Module 19 |
| `wp_enqueue_script()` / `wp_enqueue_style()` | the bundler, from your `import` statements | Modules 07, 11 |
| Front-end routing and rewrite-driven URL resolution | the App Router; `nodeByUri()` where WordPress still needs to resolve a path | Module 09 |
| `the_content()` as an HTML blob | `editorBlocks` → `<BlockRenderer />` | Module 14 |
| `wp_nav_menu()` markup, walker classes, `nav_menu_css_class` | `menuItems(where: { location: PRIMARY })` + your own JSX | Module 05 |
| `body_class()` | `cn()` / `clsx()` on a wrapper element | Module 11 |
| Full-page caching (WP Super Cache, W3TC) | ISR at the edge, invalidated by tag | Module 18 |
| Serving public traffic at all | Next.js. WordPress answers `/wp-admin` and `/graphql` only | Module 02 |

Notice what is *not* in that table. **WordPress still runs `WP_Query`, and `WP_Query` still
issues SQL against MySQL.** Nothing about that changed. A `meta_query` that was slow in Classic
WordPress is exactly as slow behind a GraphQL resolver — arguably worse, because a resolver can
run it once per node in a list. That is why Module 02 spends a whole lesson on `EXPLAIN` plans
(Lesson 02.3) and why Module 06 spends a whole lesson on N+1 queries. The database knowledge you
could safely leave implicit is now load-bearing.

> **The theme becomes a stub, not a smaller theme.** `btt-headless`, which you build in
> Lesson 02.4, has three files and no templates. Its entire front end is a `wp_redirect()` to
> the Next.js origin. WordPress refuses to run without an active theme, and a few things —
> permalink generation, `preview_post_link`, block editor asset loading — misbehave when the
> theme is broken rather than merely minimal. That is the only reason it exists.

### 2. What WordPress starts doing

One job, stated precisely: **be a typed content API.** Concretely, that is five additions to
things you already write.

| Classic call | Headless version | What the addition buys |
|---|---|---|
| `register_post_type()` | + `show_in_graphql`, `graphql_single_name`, `graphql_plural_name` | The post type becomes a schema type with a Relay connection |
| `register_taxonomy()` | + the same three arguments | `tax_query` becomes a `where` argument the front end can express |
| An SCF select storing `'production'` | a registered GraphQL **enum**, `IncidentEnvironment` | Codegen emits a union type in TypeScript instead of `string` |
| An SCF field group saved in the database | SCF **Local JSON** in `includes/acf-json/` | The content model is code, in git, and diffable — no DB migration on deploy |
| `add_shortcode()` | a Gutenberg block with typed attributes | The front end reads structured data without executing PHP |

The whole list is specified in [appendix 03](../appendix/03-content-model-reference.md), and the
reason it is a separate contract document rather than a section of a lesson is the property that
makes all of this work:

> **A field is either in the schema or it is invisible.** In a Classic theme you could always
> reach for `get_post_meta()` and pull out anything you had stored, whether or not you had
> planned to expose it. Here, if a field is not registered with `show_in_graphql`, it does not
> exist as far as the front end is concerned — no error, no warning, just absence. That single
> constraint is why Modules 03 to 06 come before any JavaScript at all.

### 3. Both request lifecycles, drawn out

Read these two diagrams together. Every stage name matches
[appendix 02 §1](../appendix/02-classic-to-headless-map.md#1-the-request-lifecycle); these
versions add the local port numbers and the ISR branch.

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

```
HEADLESS — two processes, one network hop between them

Browser
  │  GET /en/incidents/dns            :3000 in dev, the Vercel edge in prod
  ▼
proxy.ts                              locale resolution + auth gate
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

Two things moved and nothing else. **The query moved to the client of the API** — Next asks for
exactly the fields it needs, so over-fetching becomes a deliberate act visible in a diff. **The
template moved out of PHP** — a React component tree renders it. Everything below `WP_Query` in
the second diagram is identical to the first.

### 4. The local topology, and which process owns which port

Four published ports, three of them belonging to containers and one belonging to a process
running directly on your laptop. Getting this picture wrong is the source of the single most
expensive class of error in Module 02.

```
┌─ YOUR LAPTOP ────────────────────────────────────────────────────────────┐
│                                                                          │
│   Browser                                                                │
│     :3000  the app          :8080  /wp-admin  and  /graphql              │
│     :8081  Adminer          :8025  Mailpit                               │
│                                                                          │
│   ┌─────────────────────────────────────────────────────┐                │
│   │ next-app     `npm run dev`     NOT in Docker        │                │
│   │ Next.js 16 · Node 22 · owns routing and rendering   │                │
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
│   │          mysql:8.4  ─────────────────┘              │                │
│   │                                                     │                │
│   │ wpcli   run on demand, zero containers idle         │                │
│   └─────────────────────────────────────────────────────┘                │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

| Port | Owned by | Reached from your browser as | Reached from inside a container as |
|---|---|---|---|
| `3000` | `next-app`, on the host | `http://localhost:3000` | `http://host.docker.internal:3000` |
| `8080` | the `wordpress` container | `http://localhost:8080` | `http://wordpress` |
| `8081` | the `adminer` container | `http://localhost:8081` | — |
| `8025` | the `mailpit` container | `http://localhost:8025` | SMTP on `mailpit:1025` |
| `3306` | the `db` container | `localhost:3306` | **`db:3306`** — never `localhost` |

> **Next.js is not a Compose service, and that asymmetry is deliberate.** You edit TypeScript
> constantly, and Next's hot reload through a bind mount on macOS is slow and unreliable.
> WordPress is what genuinely benefits from containerisation — a pinned PHP version, the right
> extensions, a real MySQL 8. The consequence you will meet in Module 18: WordPress cannot reach
> Next at `localhost:3000`, because inside the `wordpress` container `localhost` *is* the
> `wordpress` container. It reaches it at `host.docker.internal:3000`. See
> [PROJECT.md](../PROJECT.md) for the full argument and Lesson 02.2 §7 for the `extra_hosts`
> line that makes it work on Linux.

### 5. One channel, and why there is no CORS anywhere in this course

Between the two applications there is exactly one channel: `POST /graphql`, issued by the
Next.js **server runtime**. Not from the browser. Not from a client component. Not from a
`useEffect`.

```
✅ WHAT THIS COURSE DOES                  ❌ WHAT EVERY TUTORIAL DOES

Browser                                   Browser
   │ GET /en/incidents                       │ GET /en/incidents
   ▼                                         ▼
Next.js server                            Next.js server
   │ POST /graphql   (server-to-server)      │  returns JS bundle
   ▼                                         ▼
WordPress                                 Browser
   │                                         │ POST /graphql  ← from the client
   ▼  JSON                                   ▼
Next renders HTML                         WordPress
   │                                      · endpoint is public
   ▼                                      · needs a CORS policy
Browser gets HTML                         · introspectable by anyone
                                          · unmetered querying
```

Four consequences follow, and they are worth naming because each one is a whole category of work
you never do:

| Consequence | Why |
|---|---|
| No CORS configuration, anywhere | The browser never issues a cross-origin request to WordPress. There is no preflight to allow and no policy to get wrong |
| No GraphQL endpoint in the client bundle | The URL lives in `WP_GRAPHQL_ENDPOINT`, a server-only variable |
| No introspection surface reachable from the app's own traffic | Nothing in the shipped JavaScript points at `/graphql` |
| No token readable by JavaScript | The JWT is in an httpOnly cookie the browser cannot read, and the app token never leaves the server |

That is also why WPGraphQL CORS is deliberately **not** in the plugin list in
[appendix 03 §8](../appendix/03-content-model-reference.md#8-plugin-inventory).

The named anti-pattern is **`NEXT_PUBLIC_WORDPRESS_URL`**. Nearly every headless WordPress
tutorial on the internet defines it, because it lets the browser query GraphQL directly. The
`NEXT_PUBLIC_` prefix is an *instruction* to Next.js to inline the literal value into JavaScript
that anyone can read — see
[appendix 04 §3.2](../appendix/04-env-reference.md#32-public-next_public_--all-five-of-them),
which lists the only four variables in this application that legitimately carry the prefix.

> **This is not obscurity-as-security, and the course does not pretend it is.** Media
> `sourceUrl` values are public, so the WordPress host is discoverable regardless of whether the
> endpoint URL is a public variable. Keeping it server-only removes the endpoint from your
> client bundle and from your app's own traffic — that is a real reduction in attack surface and
> a real reduction in configuration, but it is not a control. The actual controls are persisted
> queries (an operation allowlist), query depth and complexity limits, edge rate limiting on
> `/graphql`, and media served from a separate domain. All four are named in
> [appendix 04 §6](../appendix/04-env-reference.md#6-the-honest-caveat-about-hiding-the-wordpress-origin)
> and all four land in Module 24.

### 6. The contract: what each side guarantees

This is the section to reread when an argument in a later module feels arbitrary. Almost every
design decision in Modules 05 through 18 is a consequence of one of these rows.

**What WordPress guarantees to Next.js:**

| Guarantee | Mechanism | Enforced from |
|---|---|---|
| Field names are stable | [appendix 03](../appendix/03-content-model-reference.md) is a contract; a lesson that disagrees with it is wrong | Module 03 |
| The schema is a reviewable artifact | `wp graphql generate-static-schema` writes `wordpress-headless/schema.graphql`, which is **committed** | Module 06 |
| Every mutation authorises independently | `current_user_can()` inside `mutateAndGetPayload` — WPGraphQL does **not** do this for you | Module 06 |
| Errors arrive as data, not exceptions | GraphQL answers **HTTP 200 with an `errors` array**. `fetch` will never throw | Module 10 |
| No markup that must be parsed | Blocks arrive as structured data with typed attributes, never as an HTML blob to regex | Module 14 |
| Enums, not bare strings | Registered GraphQL enums so codegen produces union types | Module 06 |
| Content is queryable without a session | Public reads need no credential; only mutations and drafts do | Module 05 |

**What Next.js guarantees to WordPress:**

| Guarantee | Mechanism | Enforced from |
|---|---|---|
| Input is validated before it is sent | Zod schemas at the Server Action boundary — **and** Next accepts that WordPress validates again | Module 16 |
| It never holds WordPress's signing secret | Next does not have `GRAPHQL_JWT_AUTH_SECRET_KEY` at all | Module 15 |
| It treats the JWT as opaque | It decodes the payload only to read `exp` as a "should I refresh?" heuristic; every real authorisation decision is WordPress's | Module 15 |
| `/graphql` is never exposed to the browser | Server-only module, guarded with `import 'server-only'` | Module 10 |
| Webhooks it receives are authenticated | HMAC-SHA256 over timestamp and body, `timingSafeEqual`, ±300 s replay window | Module 18 |
| Tokens are never readable by JavaScript | httpOnly cookies set by route handlers. No `localStorage`, no query string, no `NEXT_PUBLIC_` | Module 15 |

> **The most consequential row is "Next does not hold `GRAPHQL_JWT_AUTH_SECRET_KEY`."** Next
> *could* verify JWTs locally with a library like `jose`, and it would be marginally faster. It
> would also mean Vercel holds WordPress's signing secret, so a Vercel compromise could mint
> valid WordPress administrator tokens. Different blast radii, deliberately kept apart —
> [appendix 04 §5](../appendix/04-env-reference.md#5-why-graphql_jwt_auth_secret_key-must-differ-from-auth_key).

### 7. What neither side may assume — and why authorisation did not move

The guarantee tables say what you get. This one says what you must not take for granted, and it
is the more useful of the two.

| Side | May **not** assume | Consequence in the code |
|---|---|---|
| WordPress | that a browser is rendering its output | No shortcode that emits markup the front end must parse; no `wp_enqueue_*`; no PHP-rendered menu |
| WordPress | that its own front end is ever visited | The theme redirects; the WP-rendered archive is never user-visible |
| Next.js | that WordPress is **up** | Every fetch has an error boundary and a `loading.tsx`. A GraphQL failure renders a degraded page, not a stack trace |
| Next.js | that WordPress is **fast** | Timeouts, ISR, and per-route `revalidate` values — a slow origin must not become a slow site |
| Next.js | that WordPress is **fresh** | Cached content is stale by design until a tag is invalidated. Staleness is a policy, not a bug |
| Next.js | that it is **trusted** | A compromised front end is a plausible attacker, so WordPress re-validates and re-authorises every write |
| Both | that the clocks agree | The revalidation webhook carries a timestamp and accepts a ±300 s window; outside it, replay is rejected |
| Both | that the other side is the only client | wp-admin writes content directly, and WP-CLI writes it from a container. Neither goes through Next |

The last row on trust deserves its own statement, because it is the one people get backwards:

> **Authorisation did not move.** `current_user_can()` still runs inside WordPress, on every
> mutation, exactly as it always did. Next.js reads a session to decide **what to show** —
> whether to render a "Submit an incident" link, whether to redirect `/account` to `/login`.
> WordPress decides **what is allowed**. Never the other way round. A proxy guard is a UX
> affordance; it is not a security boundary, and Module 23 writes tests that call the mutation
> directly, with no front end involved, to prove the boundary holds. This is the single most
> important row in
> [appendix 02 §5](../appendix/02-classic-to-headless-map.md#5-forms-auth-and-security).

### 8. The costs, named honestly

Every architectural decision has a downside, and a course that hides them teaches you to be
surprised in production. Here is the bill for decoupling, with the module that pays it down and
an honest verdict on whether it is ever fully paid.

| What breaks | Why | Restored in | Fully? |
|---|---|---|---|
| **Preview** | The Preview button renders a WordPress template that no longer exists | Module 17 | Partly. The mechanism is a **single-use, 120-second** token exchanged server-to-server, not a cookie. Reloading a preview URL consumes an already-consumed token and 404s. Editors must be told this |
| **Menus** | `wp_nav_menu()` returned markup; you now get data | Module 05 | Yes, and arguably better. Every walker class and `nav_menu_css_class` filter you ever wrote is gone — and so is the fight to get semantic markup out of it |
| **Forms** | Contact Form 7 and Gravity Forms render their own front end | Module 16 | No. You own the entire pipeline, spam defence included: honeypot, form-render timing, Turnstile, rate limiting, and server-side re-validation |
| **Search** | There is no `s=` query-var behaviour handed to you for free | Module 05 (`search:` on connections) | Partly. WPGraphQL exposes a search argument, but relevance ranking, faceting and typo tolerance are yours. A real product reaches for a search service |
| **The plugin ecosystem** | Anything that renders front-end HTML has nowhere to render it | never | **No — this is a permanent loss.** Sliders, related-post widgets, page builders, cookie banners and most SEO front-end output stop working. What survives is plugins that only touch **data** (SCF, Polylang) or the **editor** (Yoast's metadata UI) |
| **Comments** | Core comments assume a WordPress-rendered page and `comment_form()` | not in this course | No. The data is queryable; the moderation UI, spam handling and rendering would all be yours to build |
| **Cache invalidation** | There is no `wp_cache_flush()` that reaches a CDN in another company's network | Module 18 | Yes, but it becomes code you own and test: a signed webhook, tag names centralised in one module, and a failure mode where a 401 is silent by design |
| **Debuggability** | One stack trace becomes two processes, two log streams and a network hop | Modules 02, 24 | Partly. `docker compose logs -f wordpress` plus the Next terminal covers local work; production needs Sentry and structured logging |
| **One more deployment target** | Two applications, two platforms, two sets of secrets | Module 24 | It is not restored, it is accepted. The CI setup in Module 24 exists because of this row |

**The cost, stated plainly:** you are trading a large ecosystem of front-end plugins and a
one-process mental model for type safety, per-route caching, a front end that ships almost no
JavaScript, and an editing experience that is unchanged. That is a good trade for this
application. It is a bad trade for a brochure site that needed a slider and shipped last
Tuesday, and you should be able to say so out loud in a client meeting.

> **Where this breaks, in practice:** the plugin row is the one that ends projects. Before
> committing to headless on real work, list the plugins the site depends on and sort them into
> "touches data only", "touches the editor only" and "renders front-end HTML". If the third pile
> contains something the business considers essential, you have found either a rewrite or a
> reason not to go headless. Finding that out in Module 14 of your own project is expensive;
> finding it out on a whiteboard is free.

---

## Task

Nothing executes in this lesson either — Module 01 is the only module in the course where
nothing runs. What you produce is the document you will point at when someone asks why the
repository is shaped like this.

### Step 1: Write the skeleton of `docs/architecture.md`

Create the file and copy this skeleton. The first row of each table is filled in as a worked
example; every `TODO` is yours.

````markdown
<!-- docs/architecture.md -->
# Blame The Tech — architecture and the headless contract

Written in Module 01, before anything runs. Revisit it at the end of Module 18, when every
row below has been paid for.

## Request lifecycle — Classic WordPress

```
TODO — redraw the Classic lifecycle from Lesson 01.2 Key Concept 3.
Stage names must match: index.php, wp-load.php, parse_request(), WP_Query,
template_redirect, template hierarchy, the Loop, wp_head/wp_footer.
```

## Request lifecycle — headless

```
TODO — redraw the headless lifecycle, including the ISR cache hit branch.
Stage names must match: proxy.ts, page.tsx, fetchGraphQL, POST /graphql,
WPGraphQL, WP_Query, JSON, React Server Components, HTML + RSC payload.
```

## Local topology

```
TODO — Step 2. Draw this from memory first.
```

## What WordPress guarantees to Next.js

| Guarantee | Mechanism | Enforced from |
|---|---|---|
| Field names are stable | appendix 03 is a contract | Module 03 |
| TODO | TODO | TODO |

## What Next.js guarantees to WordPress

| Guarantee | Mechanism | Enforced from |
|---|---|---|
| Input is validated before it is sent | Zod at the Server Action boundary | Module 16 |
| TODO | TODO | TODO |

## What neither side may assume

| Side | May not assume | Consequence in the code |
|---|---|---|
| Next.js | that WordPress is up | Error boundaries and loading states on every fetch |
| TODO | TODO | TODO |

## What decoupling costs

| What breaks | Why | Restored in | Fully? |
|---|---|---|---|
| Preview | The Preview button renders a template that no longer exists | Module 17 | Partly — single-use 120 s token |
| TODO | TODO | TODO | TODO |

## Where I disagree

TODO — Step 4.
````

Rules:

- Each guarantee table needs **at least four** data rows, not one.
- The may-not-assume table needs **at least five**.
- The cost table needs **at least seven**, and every row must name a module or the word `never`.
  A cost with no owner is a cost you have not thought about.
- Write the tables in your own words. Copying Key Concepts 6 to 8 verbatim produces a document
  you will never reread, which defeats the purpose.

### Step 2: Draw the local topology from memory, then diff it

Scroll away from Key Concept 4. In the `## Local topology` fence, draw the local architecture
**from memory**: the host, the Compose network, the five services, the four published ports, and
the two arrows between `next-app` and `wordpress`. Use ASCII box-drawing characters — this
repository has zero diagram-rendering tooling by design, so ASCII in a fenced block is the house
format everywhere.

Only when you have finished, compare it against Key Concept 4 and the local architecture diagram
in [PROJECT.md](../PROJECT.md), and correct it.

**Verify §2:**

- [ ] Four ports appear, and each is attached to the right owner: `3000` → `next-app` **on the
      host**, `8080` → the `wordpress` container, `8081` → `adminer`, `8025` → `mailpit`.
- [ ] `next-app` is drawn **outside** the Compose box.
- [ ] The arrow from `next-app` to WordPress is labelled `POST /graphql` and says
      server-to-server.
- [ ] The arrow from WordPress back to Next is labelled `host.docker.internal:3000`, **not**
      `localhost:3000`. If you wrote `localhost`, you have just made the number-one Module 18
      mistake on paper instead of in code, which is the cheapest possible place to make it.
- [ ] `db` is reachable as `db:3306` and `wpcli` is shown as run-on-demand.

### Step 3: Fill in the four tables

Work through the four tables in order. For the cost table specifically, do not stop at the seven
rows in Key Concept 8 — add anything you personally expect to miss. If you have shipped Classic
WordPress sites, you almost certainly rely on something that is in the third pile from the
callout at the end of Key Concept 8.

**Verify §3:**

- [ ] `grep -c '^|' docs/architecture.md` returns 30 or more.
- [ ] No cell says `TODO`.
- [ ] Every row of the cost table names a module number or the word `never`.
- [ ] The may-not-assume table includes at least one row about **trust** and one about **time**.

### Step 4: Append a "Where I disagree" section

Replace the final `TODO` with at least one paragraph naming something in this architecture you
think is wrong, over-engineered, or under-justified — and say what you would do instead and what
it would cost.

This is not a formality. Real candidates, all defensible:

| A position you could take | The counter-argument this course makes |
|---|---|
| Two applications in one repository is worse than two repositories | One clone, one `git log`, and one pull request when a schema change and its consumer change together |
| `next-app/` should also run in Docker for true parity | Hot reload through a bind mount on macOS is slow and unreliable; Module 24 adds an optional overlay purely to prove the image builds |
| Comments should be in scope | They would add a moderation UI and spam pipeline that teaches nothing the incidents loop does not already teach |
| Next should verify JWTs locally for speed | It would mean Vercel holding WordPress's signing secret — see Key Concept 6 |
| Headless is the wrong choice for a site this size | Correct, and the course says so. The application is a teaching vehicle, not a recommendation |

**Verify §4:**

- [ ] The section is at least eighty words.
- [ ] It names a concrete alternative, not just an objection.
- [ ] It names what your alternative would cost. An objection with no price attached is a
      preference.

---

## Verification

```bash
# Run from the repository root. Every command here is read-only — Module 01 is the only
# module in the course where nothing executes.

# 1. The document exists
test -f docs/architecture.md && echo present
# Expected: present

# 2. All three diagrams are present, and every fence is closed
grep -c '^```$' docs/architecture.md
# Expected: an EVEN number, 6 or more. An odd number means an unclosed fence,
#           which silently swallows the rest of the document in every renderer.

# 3. Every published port is accounted for
for p in 3000 8080 8081 8025; do
  printf 'port %-5s %s\n' "$p" "$(grep -c "$p" docs/architecture.md)"
done
# Expected: four lines, every count 1 or more

# 4. WordPress reaches Next by the only name that works from inside a container
grep -c 'host.docker.internal:3000' docs/architecture.md
# Expected: 1 or more

# 5. The four tables are real tables, not stubs
grep -c '^|' docs/architecture.md
# Expected: 30 or more

# 6. The named anti-pattern is written down so you recognise it in a tutorial later
grep -c 'NEXT_PUBLIC_WORDPRESS_URL' docs/architecture.md
# Expected: 1 or more

# 7. The cost table has at least seven data rows, each owned by a module or by "never"
grep -E '^\|.*\| *(Module [0-9]+|never|Modules [0-9]+)' docs/architecture.md | wc -l
# Expected: 7 or more

# 8. Your own dissent is present and is prose
sed -n '/^## Where I disagree/,$p' docs/architecture.md | wc -w
# Expected: 80 or more

# 9. NEGATIVE — WordPress must never be told to reach Next at localhost
grep -c 'localhost:3000' docs/architecture.md
# Expected: 0
#           `localhost:3000` is correct in YOUR BROWSER and wrong everywhere inside a
#           container. Keep it out of this document entirely so the habit sticks. If this
#           prints anything but 0, find the line and change it to host.docker.internal:3000.

# 10. NEGATIVE — no diagram-rendering tooling, anywhere in this repository
grep -ci mermaid docs/architecture.md
# Expected: 0
#           ASCII box-drawing in a fenced block is the house format. It diffs, it renders
#           in every viewer, and it survives being pasted into a terminal.

# 11. NEGATIVE — no template placeholder survived
grep -c 'TODO' docs/architecture.md
# Expected: 0

# 12. Git sees two new documents and nothing else
git status --short
# Expected: ?? docs/architecture.md and ?? docs/content-model.md
#           Nothing under wordpress-headless/ or next-app/ — Module 02 starts those.
```

Check 9 is the one to take seriously. It is the same mistake, on paper, that
[appendix 06 §4](../appendix/06-troubleshooting.md) records as the single most common cause of
"my page shows stale content after publishing" — and it costs an afternoon in Module 18 rather
than a minute here.

## Control Questions

1. WordPress stops running the template hierarchy but keeps running `WP_Query`. Explain why that
   split means the MySQL lesson in Module 02 is *more* important in a headless build than in a
   Classic one, and name the specific Module 06 problem it sets up.
2. GraphQL answers with HTTP 200 and an `errors` array rather than a 4xx or 5xx status. Say what
   that means for a `fetch` call in a Server Component, and describe the bug you get if you
   write `if (!res.ok) throw`.
3. `NEXT_PUBLIC_WORDPRESS_URL` is the named anti-pattern, yet the course also admits that the
   WordPress host is discoverable anyway from media URLs. Reconcile those two statements, then
   name two of the controls that actually reduce risk on `/graphql`.
4. Next.js checks a session in `proxy.ts` and WordPress checks `current_user_can()` in the
   mutation. Both look like authorisation. Explain which one is the security boundary, and
   describe the test in Module 23 that would catch you if you got it backwards.
5. Pick the two entries in the cost table you consider permanent losses rather than deferred
   work. Defend the choice, then describe a real client project where those two losses would be
   enough to reject a headless architecture outright.

## Learn More

- [The Template Hierarchy](https://developer.wordpress.org/themes/classic-themes/basics/template-hierarchy/) —
  read it once more as a *farewell*; it is the thing Module 09's file conventions replace, and
  the differences are the interesting part
- [Next.js App Router documentation](https://nextjs.org/docs/app) — the routing and rendering
  model that takes over from the template hierarchy; skim "Routing" and "Caching" now, and read
  them properly before Module 09
- [React Server Components](https://react.dev/reference/rsc/server-components) — React's own
  explanation of the model that makes "render on the server, hydrate the islands" the default
- [WPGraphQL documentation](https://www.wpgraphql.com/docs/introduction/) — the plugin that
  *is* the boundary in this architecture; the "Interacting with WPGraphQL" pages are the
  relevant ones
- [GraphQL: Learn](https://graphql.org/learn/) — the query language itself, if the syntax in the
  diagrams was unfamiliar; two hours here saves a day in Module 05
- [MDN: Cross-Origin Resource Sharing](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) —
  worth reading precisely so you understand what Key Concept 5 means when it says this course
  needs none of it
- [OWASP Top Ten](https://owasp.org/www-project-top-ten/) — the framing behind "Next may not
  assume it is trusted"; A01 Broken Access Control is the row that matters most here
