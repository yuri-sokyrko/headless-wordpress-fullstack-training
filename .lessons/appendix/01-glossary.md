# Appendix 01 — Glossary

Terms in the order you meet them is useless when you are stuck, so this is alphabetical. The
**Module** column tells you where the term is actually taught.

Where a term has a Classic WordPress counterpart, it is named — the full translation table is
[appendix 02](02-classic-to-headless-map.md).

---

| Term | Meaning | Module |
|---|---|---|
| **Accessibility tree** | The parallel structure a browser derives from your DOM, where every node has a role, an accessible name, a value and a set of states. It is what assistive technology reads — not your JSX. `<div onClick>` produces role `generic` with no name; `<button>` produces role `button` with a name and focusability, for free. | 22 |
| **Accessible name** | The string assistive technology announces for an element, computed in order from `aria-labelledby`, then `aria-label`, then content, then `title`. `aria-label` on an element that already has text content silently **replaces** it. | 22 |
| **SCF Local JSON** | SCF writing field-group definitions to `.json` files in your plugin instead of the database, so the content model is code, is diffable, and needs no migration on deploy. | 04 |
| **App Router** | Next.js's file-convention routing system under `app/`. Directories are URL segments; special filenames (`page.tsx`, `layout.tsx`, `loading.tsx`) have defined roles. The template hierarchy, made explicit. | 09 |
| **`aria-live` / live region** | An element whose changes are announced without moving focus. It must exist in the DOM **before** the update — a region created by the update is frequently never announced. The incident filter's result count is the canonical case. | 22 |
| **`asPreview`** | A WPGraphQL argument that reads the latest *revision* of a post instead of the published version. Without it, previewing a published post silently shows the live content. | 17 |
| **axe-core** | The accessibility rules engine inside the axe DevTools extension, Lighthouse's accessibility category and `@axe-core/playwright` — so a finding made interactively can be pinned by a test in the same vocabulary. Severities are `minor`, `moderate`, `serious`, `critical`. | 22 |
| **Block Bindings** | A WordPress API letting a block's attributes read from a data source (like an SCF field) instead of storing their own copy. | 13 |
| **`block.json`** | The metadata file that registers a Gutenberg block for both PHP and JavaScript — name, attributes, supports, scripts. `register_post_type()` for blocks. | 13 |
| **BlockRenderer** | This app's component that walks the `editorBlocks` tree and dispatches each block to a React component via a registry keyed on `__typename`. | 14 |
| **Blue-green deployment** | Booting a new machine alongside the old one, waiting for its health check to pass, then shifting traffic — which is what makes rollback a redeploy of the previous image rather than a restore. Your **code** rolls back this way; your **database** does not. | 24 |
| **Brain Monkey** | A PHP library that stubs the WordPress function set as controllable doubles, so plugin logic can be unit-tested with no database, no container boot and no fixture. It will let you mock things you should not — a mocked `current_user_can()` tests your `if` statement, not authorisation. | 23 |
| **Cache tag** | A string label attached to a `fetch` so it can be invalidated later by name — `revalidateTag('incident:dns')`. | 10, 18 |
| **Charter** | An exploratory-testing instruction that gives an agent a goal and a boundary rather than a script — "explore incident submission; try to publish without moderator approval; report surprises". A script can only find the failures its author already imagined. | 23 |
| **`cn()`** | The `clsx` + `tailwind-merge` helper shadcn uses to compose class names and let later utilities win over earlier ones. | 11 |
| **Codegen** | `graphql-codegen` reading `schema.graphql` plus your `.graphql` documents and generating TypeScript types, so a query and its result type can never disagree. | 10 |
| **Connection** | The Relay pagination shape WPGraphQL uses: `edges`/`nodes` plus `pageInfo` with cursors. Replaces `posts_per_page` + `paged`. | 05 |
| **CSP** | Content Security Policy — a response header restricting where scripts, styles, images and connections may come from. A per-request **nonce** is the strong form, and in the App Router it costs you static rendering, because reading it requires `headers()` in a layout. | 24 |
| **`cva`** | `class-variance-authority` — declares component variants (size, tone) as typed props instead of conditional class strings. | 11 |
| **Cursor** | An opaque pointer to a position in a result set. Stable when rows are inserted mid-list, unlike a numeric offset. | 05 |
| **`dangerouslySetInnerHTML`** | React's escape hatch for injecting raw HTML. In this codebase it appears in exactly one sanitizing component, `RichText.tsx`. | 14 |
| **DataLoader** | WPGraphQL's request-scoped batching layer that collapses N per-node lookups into one query. The fix for N+1. | 06 |
| **Discriminated union** | A TypeScript union whose members share a literal-typed field (here `__typename`) so a `switch` narrows the type in each branch. What makes the BlockRenderer type-safe. | 07, 14 |
| **`draftMode()`** | Next's API for marking a request as a preview, which bypasses all caching for that request. | 17 |
| **Dynamic block** | A Gutenberg block whose front-end output is generated by PHP at render time (`render.php`, `save: () => null`) rather than saved into `post_content`. | 13 |
| **`editorBlocks`** | The WPGraphQL Content Blocks field returning a post's block tree as structured, typed data. The structured replacement for `the_content()`. | 14 |
| **`generateMetadata`** | The Next function that produces a route's `<head>` — title, canonical, Open Graph. `wp_head()`, as a typed return value. | 19 |
| **`generateStaticParams`** | Tells Next which dynamic-segment values to pre-render at build time. Must be scoped — enumerating everything makes builds unusable. | 09, 18 |
| **gitleaks** | A secret scanner run over the full history on first pass and the diff thereafter. Its finding is not "remove this": **a secret that has been in git is compromised even after deletion — rotate it.** | 24 |
| **GraphiQL** | The in-browser IDE at `/wp-admin/admin.php?page=graphiql-ide` for exploring and testing the schema. Your first manual test harness. | 05 |
| **hreflang** | Link relations telling search engines which URL serves which language. Must form a complete, mutually-referencing cluster or it is ignored. | 20 |
| **HMAC** | A keyed hash proving a message came from someone holding the shared secret. Signs the revalidation webhook. Compared with a timing-safe function, never `==`. | 18 |
| **httpOnly** | A cookie flag making the cookie unreadable by JavaScript. The reason an XSS cannot steal this app's session. | 15 |
| **Hydration** | The browser attaching React event handlers to server-rendered HTML. Costs JavaScript and main-thread time, which is why only islands hydrate here. | 09, 21 |
| **`InnerBlocks`** | The Gutenberg component letting a block contain other blocks. Produces a nested tree the BlockRenderer must recurse into. | 13, 14 |
| **ISR** | Incremental Static Regeneration — serve a cached static page, regenerate it in the background on a timer or on demand. The full-page cache plugin, done properly. | 18 |
| **JWT** | JSON Web Token. A signed, self-describing credential. Here it represents **a user**, lives in an httpOnly cookie, and is verified only by WordPress. | 15 |
| **Lab vs field data** | Lab = a synthetic Lighthouse run. Field = real users' measurements. They routinely disagree, and both matter. | 21 |
| **Landmark** | A region with an implicit role a screen reader can jump between — `<main>`, `<nav>`, `<header>`, `<footer>`, `<aside>`. Exactly one `<main>` per page, and an `<aside>` inside it needs an accessible name or it is an audit finding. | 22 |
| **LCP / INP / CLS** | Core Web Vitals: Largest Contentful Paint (loading), Interaction to Next Paint (responsiveness), Cumulative Layout Shift (visual stability). | 21 |
| **`map_meta_cap`** | The `register_post_type()`argument that makes WordPress derive per-object capabilities from your `capability_type`. What makes `incident` moderation structural. | 03 |
| **MCP** | Model Context Protocol — how an AI agent is given tools. Playwright MCP gives an agent a real browser. | 23 |
| **`meta_query` self-join** | Each meta clause adds another `JOIN` on `wp_postmeta`. Three clauses, three joins, and no index on `meta_value`. The performance trap this app deliberately contains. | 02 |
| **MSW** | Mock Service Worker — intercepts at the **network** layer rather than mocking your GraphQL client, matching by operation name, so a component under test runs its real fetching code against a fake WordPress. Type the handlers with the codegen'd types and the fake becomes a contract check. | 23 |
| **`__typename`** | GraphQL's built-in field returning the concrete type name of an object. The discriminator the BlockRenderer switches on. | 14 |
| **`nodeByUri`** | The WPGraphQL query resolving an arbitrary URI to whatever content node lives there. `url_to_postid()`, generalised. | 05 |
| **`NEXT_PUBLIC_`** | An env-var prefix instructing Next to inline the literal value into the client bundle. Not a hint — an instruction. There is no such thing as a secret `NEXT_PUBLIC_` variable. | 09 |
| **N+1** | Fetching a list, then making one more query per item. The dominant performance bug in GraphQL APIs. | 06 |
| **Patch coverage** | Coverage measured on the lines a pull request **changed**, not on the whole codebase. A reviewer can act on "78% of your new lines are untested"; nobody can act on a total that moved 0.1%. | 23, 24 |
| **Performance budget / ratchet** | A threshold with a consequence, set at "no worse than today" and raised only in a dedicated pull request whose only content is the new number. A gate introduced at an aspirational number is red on arrival and disabled within a week. | 21, 24 |
| **Persisted query** | Registering allowed operations by hash so production executes only known queries. The strongest available control on a public GraphQL endpoint. | 24 |
| **Pest** | A PHP test runner sitting on top of PHPUnit — same assertions, same coverage, same CI — whose declarations read as sentences: `it('rejects anonymous submissions')`. Chosen for legibility, because the people who most need to read your tests often did not write them. | 23 |
| **PHPStan baseline** | A file recording a codebase's existing static-analysis violations so a strict level can be switched on today without a stop-the-world cleanup. It is **shrink-only**: a pull request that adds an entry fails. | 24 |
| **PPR** | Partial Prerendering — a static shell streamed immediately with dynamic holes filled in. Awareness-level in this course. | 18 |
| **`prefers-reduced-motion`** | A media feature exposing an OS-level accessibility setting, addressed in Tailwind with the `motion-reduce:` variant. It means **reduce**, not remove: an instant state change is fine, a 400 ms slide is not. | 11, 22 |
| **`release_command`** | A Fly.io hook that runs **once, before any new machine takes traffic, and aborts the deploy on a non-zero exit**. This app's runs `wp core update-db`, activates plugins, flushes rewrites and ensures languages — four idempotent commands, which is the only kind that belongs there. | 24 |
| **Request ID** | An identifier minted at the Next edge, sent onward as `X-BTT-Request-Id` and logged on both sides, so one string retrieves a user action's whole path across four tiers, two hosts and two clocks. It has to be designed in before there is an incident to debug. | 24 |
| **RSC** | React Server Component. Renders on the server, ships no JavaScript, can `await` data directly. The default in the App Router. | 09 |
| **`revalidateTag` / `revalidatePath`** | Next's on-demand cache invalidation. Called by the signed webhook when WordPress content changes. | 18 |
| **Route handler** | A `route.ts` file exporting HTTP-method functions. `register_rest_route()`, on the Next side. | 09 |
| **`SameSite`** | A cookie flag controlling whether the cookie is sent on cross-site requests. `Lax` for the session, `Strict` for the refresh token. | 15 |
| **`schema.graphql`** | The committed snapshot of the GraphQL schema. Because it is in git, CI can run codegen without a running WordPress and without a single credential. | 06, 10 |
| **Sentry** | Error and performance tracking on both applications, sharing the request ID, with source maps uploaded at build time so a minified stack trace becomes a filename and a line. Its client DSN lives behind `NEXT_PUBLIC_` deliberately — a DSN is a write-only ingest key, not a secret. | 24 |
| **Server Action** | A `'use server'` function callable directly from a form. Can set cookies and works with JavaScript disabled. `admin-post.php`, typed. | 16 |
| **`server-only`** | An import that makes a module fail the build if it is ever pulled into a client component. How secrets are kept out of the bundle structurally. | 10 |
| **Streaming** | Sending HTML in chunks as it becomes ready, so a slow query does not block the whole page. | 10 |
| **`storageState`** | Playwright's saved browser session, so E2E specs skip logging in every time. | 23 |
| **Structured data / JSON-LD** | Machine-readable page metadata (`Article`, `Review`) that drives rich search results. | 19 |
| **Trivy** | A container image vulnerability scanner. The gate fails on HIGH and CRITICAL **that have a fix available** — without that qualifier it goes permanently red on a base-image CVE nobody can act on, and then somebody turns it off. | 24 |
| **`TypedDocumentNode`** | A GraphQL document that carries its result and variable types, so `fetchGraphQL` infers both with no manual annotation. | 10 |
| **`use client`** | The directive marking a module and its imports as part of the client bundle. Push it as deep into the tree as possible. | 09 |
| **WPGraphQL** | The plugin that exposes WordPress as a GraphQL API. | 05 |
| **WPGraphQL Content Blocks** | The extension exposing Gutenberg blocks as structured data instead of HTML. | 14 |
| **`wp-phpunit`** | The WordPress core test library, letting PHPUnit boot a real WordPress against a real database. | 23 |
| **Zod** | A TypeScript schema validator. One schema, used by the client form for UX and by the Server Action as the actual boundary check. | 16 |

---

## Three distinctions worth memorising

**Server Component vs Client Component.** Not "backend vs frontend". Both are React, both
produce HTML. A Server Component runs once on the server, can `await`, and ships zero
JavaScript. A Client Component ships to the browser and can hold state and handle events. The
boundary is the `'use client'` directive, and you push it as far down the tree as possible.

**The user JWT vs the app token.** `btt_at` represents **a person** and lets Next act *as*
them. `BTT_APP_TOKEN` represents **the application** and is used for operations with no logged-in
user — registration, lead submission, preview verification. Confusing them is the most
consequential mistake available in this architecture. See
[appendix 04 §4](04-env-reference.md#4-the-two-credentials).

**Validation vs authorisation.** Zod validates *shape*. `current_user_can()` authorises
*action*. Passing a Zod schema tells you the request is well-formed, not that the caller is
allowed to make it — and a field appearing in a GraphQL input type is not permission to set
it. Which is why `createIncident` accepts `is_verified` in its input and silently discards it.
