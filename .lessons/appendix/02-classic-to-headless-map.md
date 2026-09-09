# Appendix 02 — Classic WordPress → Headless Map

The translation table. When you know how to do something in Classic WordPress and need the
headless equivalent, look here.

**Read the third column.** Every analogy in this course breaks down somewhere, and the place
it breaks is usually more instructive than the place it holds.

---

## 1. The request lifecycle

### Classic WordPress

```
Browser ──▶ index.php ──▶ wp-load.php ──▶ parse_request()
                                              │
                                              ▼
                                      WP_Query (the main query)
                                              │
                                              ▼
                                      template_redirect
                                      template hierarchy picks
                                      single-incident.php
                                              │
                                              ▼
                                      the Loop → HTML → wp_head/wp_footer
                                              │
                                              ▼
                                      Browser gets a complete HTML page
```

### Headless

```
Browser ──▶ Vercel ──▶ middleware.ts ──▶ app/[locale]/incidents/[slug]/page.tsx
                                              │
                                              ▼
                                      await fetchGraphQL(IncidentBySlug)
                                              │
                                              ▼  POST /graphql   (server-to-server)
                                      WordPress: WPGraphQL → WP_Query → SQL
                                              │
                                              ▼  JSON
                                      React Server Components render on the server
                                              │
                                              ▼
                                      Browser gets HTML + a small RSC payload,
                                      hydrates only the interactive islands
```

Two things moved. **The query moved to the client of the API** (Next asks for exactly the
fields it needs), and **the template moved out of PHP** (a React component tree renders it).
WordPress still runs `WP_Query` and still hits MySQL — that part did not change at all, which
is why the MySQL knowledge in Module 02 still pays.

---

## 2. Templating and routing

| Classic WordPress | Headless equivalent | Where the analogy breaks |
|---|---|---|
| `single-incident.php` | `app/[locale]/incidents/[slug]/page.tsx` | The template hierarchy is *implicit fallback*; App Router file conventions are *explicit*. There is no "if this file is missing, try that one" — you write the route or it 404s. |
| `archive-incident.php` | `app/[locale]/incidents/page.tsx` | — |
| `index.php` | `app/[locale]/page.tsx` | — |
| `404.php` | `not-found.tsx` | Also callable imperatively with `notFound()` from inside a component, which the template hierarchy cannot do. |
| `header.php` / `footer.php` | `layout.tsx` | Layouts **nest** and **persist across navigation** — the header does not re-render when you change page. `get_header()` re-runs on every request. |
| `get_template_part('parts/card', 'incident')` | `<IncidentCard {...props} />` | Props are typed and checked at build time. `$args` was a loose array nobody validated. |
| `page-templates/hobt.php` + template selector | ACF `page_template == templates/hobt.php` drives which fields appear; Next renders from blocks | The PHP template file still exists in the theme, but only so WordPress has something to name. It renders nothing. |
| `while (have_posts()) { the_post(); }` | `incidents.map((incident) => <IncidentCard key={incident.id} … />)` | No global `$post`. Nothing is implicit. `the_title()` has no idea which post you mean; `incident.title` does. |
| `url_to_postid()` | `nodeByUri(uri: "/incidents/dns/")` | — |
| `wp_nav_menu()` | `menuItems(where: { location: PRIMARY })` + your own React markup | You get data, not markup. Every walker class and `nav_menu_css_class` filter you have written is gone — and so is the fight to get semantic markup out of it. |
| `body_class()` | `cn()` / `clsx()` on a `<body>` or wrapper | — |
| `.htaccess` redirects | `next.config.ts` `redirects()`, or a redirect map fetched from WordPress | — |

---

## 3. Querying content

| Classic WordPress | Headless equivalent | Where the analogy breaks |
|---|---|---|
| `new WP_Query(['post_type' => 'incident'])` | `query { incidents { nodes { … } } }` | GraphQL forces you to name the fields you want. `$post->post_title` was free; over-fetching is now a deliberate act you can see in a diff. |
| `'posts_per_page' => 10, 'paged' => 2` | `incidents(first: 10, after: $cursor)` | **Cursors, not offsets.** Offset pagination re-scans rows and drifts when content is inserted mid-list. Lesson 05.2 covers why WPGraphQL made this choice. |
| `'tax_query' => [...]` | `incidents(where: { severityIn: [...] })`, or traverse: `severity(id: "s1-catastrophic", idType: SLUG) { incidents { ... } }` | **Not a generic builder.** `where: { taxQuery: ... }` comes from the third-party `wp-graphql-tax-query` extension, which is deliberately **not installed** — a taxonomy-join builder on a public endpoint is exactly the surface core WPGraphQL declines to ship. Lesson 05.2 §6 argues it. What exists instead is one narrow, allowlisted argument, `severityIn`, registered in Lesson 06.1 §9: one taxonomy, four slugs intersected server-side against the closed term set, one `IN` clause. Every other facet is a term traversal or client-side narrowing (Lesson 09.2). |
| `'meta_query' => [...]` | **no equivalent** | Core WPGraphQL exposes neither `metaQuery` nor `taxQuery`, deliberately: a generic builder on a public endpoint lets any caller construct arbitrary unindexed scans. Lesson 05.2 §6 argues it. The underlying slowness is unchanged either way — `wp_postmeta.meta_value` has no index, and headless does not fix that, it hides it one layer further away. See Lesson 02.3. |
| `get_post_meta($id, 'downtime_minutes', true)` | `incident { incidentDetails { downtimeMinutes } }` | Field names are camelCase in the schema and snake_case in the database. The mapping is in [appendix 03](03-content-model-reference.md). |
| `get_field('severity', $id)` (ACF) | `incident { incidentDetails { … } }` | ACF repeaters become generated **object list types**, not `string[]`. This is the most common "why is my type `any`?" moment. |
| `get_the_terms($id, 'scapegoat')` | `incident { scapegoats { nodes { name slug } } }` | — |
| `get_option('some_setting')` | `siteSettings { siteChrome { … } }` via an ACF options page | — |
| `wp_get_attachment_image($id, 'large')` | `mediaItem { sourceUrl mediaDetails { … } }` → `<Image />` | `next/image` re-optimises and serves from the CDN. You must add the media host to `remotePatterns` or you get a runtime error, not a broken image. |
| `$wpdb->get_results(...)` | still `$wpdb`, in a custom resolver | The one place this course writes raw SQL is the leads table. Always `$wpdb->prepare()`. |
| `the_content()` | `editorBlocks { … }` → `<BlockRenderer />` | **The biggest shift in the whole course.** `the_content()` returns an HTML blob; `editorBlocks` returns a structured tree you map to React components. Module 14. |

---

## 4. Extending WordPress

| Classic WordPress | Headless equivalent | Where the analogy breaks |
|---|---|---|
| `functions.php` | a versioned plugin (`blame-the-tech-core`) with Composer PSR-4 autoloading | `functions.php` is coupled to a theme, untestable, and dies when the theme changes. A plugin is deployable and unit-testable — which matters once Module 23 exists. |
| `register_post_type()` | the same call, plus `show_in_graphql`, `graphql_single_name`, `graphql_plural_name` | Four new arguments. That's it. This is the most reassuring lesson in Module 03. |
| `register_taxonomy()` | the same, plus the GraphQL args | — |
| `add_meta_box()` + `save_post` | `register_post_meta()` with `show_in_graphql`, or an ACF field group | Registered meta has a **schema** — a type, a default, a sanitize callback. A hand-rolled meta box had none of that, which is why half of them silently store the wrong type. |
| `add_shortcode()` | a Gutenberg block | A shortcode is a string parsed at render time. A block has typed attributes stored in `post_content` as structured comments — so the front end can read them without executing PHP. |
| `add_filter('the_content', …)` | a resolver, or a component in the `BlockRenderer` registry | Filters are a global mutation chain in unknown order. The registry is an explicit dispatch table you can read top to bottom. |
| `register_rest_route()` | `register_graphql_field()` / `register_graphql_mutation()`, or a Next `route.ts` | Decide by owner: content logic belongs in WordPress; app logic (webhooks, preview, session cookies) belongs in Next. Lesson 09.5. |
| `wp_enqueue_script()` / `wp_enqueue_style()` | `import` — the bundler resolves the dependency graph | No more manual dependency arrays and no more `wp_localize_script`. Also no more "which plugin enqueued jQuery twice". |
| `add_theme_support()` | `theme.json` | Even a headless site needs a minimal block theme so the editor knows your colours and typography. Lesson 13.5. |
| `wp_localize_script()` | props | — |
| WP-CLI | still WP-CLI, run through `docker compose exec` | Unchanged, and it becomes your migration and seeding tool. Lesson 04.4. |

---

## 5. Forms, auth and security

| Classic WordPress | Headless equivalent | Where the analogy breaks |
|---|---|---|
| `<form action="admin-post.php">` + `wp_nonce_field()` | a Server Action | Actions work with JavaScript disabled, so progressive enhancement survives. The Origin check plus `SameSite` replaces the nonce. |
| `wp_verify_nonce()` | Next's Origin/Host check on Action POSTs + `SameSite` cookies | Two independent layers, neither of which is a complete policy alone. Lesson 15.5. |
| `wp_set_auth_cookie()` | a JWT in an httpOnly cookie, set by a route handler | WordPress's auth cookie is domain-scoped and cannot authenticate a cross-origin front end. The JWT can. |
| `is_user_logged_in()` | `await getSession()` reading `cookies()` in a Server Component | Server-side only. There is deliberately no session React context, so a token can never reach client JavaScript. |
| `current_user_can('edit_post', $id)` | `current_user_can()` — **still, in WordPress** | This is the important one: authorisation did **not** move. Next checks a session to decide what to *show*; WordPress decides what is *allowed*. Never the other way round. |
| `wp_create_user()` | the custom `registerDeveloper` mutation | `users_can_register` stays off so there is one registration door, not two. |
| `sanitize_text_field()` / `wp_kses_post()` | Zod on the Next side **and** the WordPress sanitizers on the WordPress side | Both. Next validates for UX and load-shedding; WordPress validates because Next is not a trusted client. |
| `esc_html()` | React escapes by default | The exception is `dangerouslySetInnerHTML`, which appears in exactly one sanitizing component in this codebase — `RichText.tsx`. |
| Contact Form 7 / Gravity Forms | react-hook-form + Zod + a Server Action + the `wp_btt_leads` table | You own the pipeline, including the spam defence. Honeypot, form-render timing, Turnstile, rate limit. |

---

## 6. Performance and caching

| Classic WordPress | Headless equivalent | Where the analogy breaks |
|---|---|---|
| WP Super Cache / W3TC full-page cache | ISR — `next: { revalidate }` | Per-route granularity instead of per-site, and the cache lives at the CDN edge. |
| `wp_cache_flush()` on `save_post` | `revalidateTag()` from a signed webhook | Tag-scoped, so publishing one incident does not dump the whole cache. |
| Transients | `unstable_cache` / the Next Data Cache | — |
| Object cache (Redis/Memcached) | still useful, on the WordPress side | Headless does not remove WordPress's own caching needs — every GraphQL request still loads the `wp_options` autoload set. |
| Varnish / Cloudflare in front of WordPress | Vercel's edge network in front of Next | WordPress moves *behind* Next and stops serving public traffic entirely. |
| Image optimisation plugins | `next/image` | Build-time and request-time control, `srcSet` generation, and CLS prevention through required dimensions. |
| "Dequeue the scripts you don't need" | server-component-first discipline + `next/dynamic` | Same instinct, better tools. The default is now zero JavaScript, and you opt *into* interactivity. |

---

## 7. Things with no classic analogue

Be honest with yourself about these — they are genuinely new, and treating them as variations
on something you know will slow you down.

| New discipline | Why it has no analogue | Where it lands |
|---|---|---|
| **Type systems** | PHPDoc was advisory. TypeScript fails the build. | Module 07 |
| **The server/client component boundary** | PHP is always server, jQuery is always client, and the line was the network. Now the line is a `'use client'` directive inside one codebase. | Lesson 09.2 |
| **Automated testing** | You have probably never had a safety net on `functions.php`. | Module 12, Module 23 |
| **A build step** | Files no longer map one-to-one to URLs or to what ships. | Module 07 |
| **CI/CD** | FTP had no gates. | Module 24 |
| **Accessibility auditing** | You may write semantic HTML already, but auditing it systematically is a separate skill. | Module 22 |
| **Core Web Vitals as numbers** | "The site feels slow" becomes LCP ≤ 2500 ms as a merge gate. | Module 21 |
| **Agentic QA** | Genuinely new to everyone. | Lessons 23.7–23.9 |

---

## 8. Vocabulary quick-swap

| You say | The course says |
|---|---|
| the Loop | `.map()` over a connection's `nodes` |
| template part | component |
| `$args` | props |
| hook / filter | (no direct equivalent — usually a component boundary or a resolver) |
| post meta | ACF field, exposed as a GraphQL field |
| CPT | post type with `show_in_graphql` |
| `wp-admin` | the editor, and only the editor — it serves no public traffic |
| the theme | `next-app/` — plus a near-empty WordPress theme that exists only for the editor |
| plugin | still a plugin. Two of them, both yours. |
| permalink | route |
| `wp_head()` | `generateMetadata()` |
| shortcode | block |
| staging site | a Vercel preview deployment, one per pull request |

---

## 9. Where to look next

| Question | Document |
|---|---|
| "What is the exact field name for X?" | [appendix 03 — content model](03-content-model-reference.md) |
| "Which env var holds Y, and is it public?" | [appendix 04 — env reference](04-env-reference.md) |
| "What does this GraphQL syntax mean?" | [appendix 05 — GraphQL cheatsheet](05-graphql-cheatsheet.md) |
| "What does this term mean?" | [appendix 01 — glossary](01-glossary.md) |
| "It broke." | [appendix 06 — troubleshooting](06-troubleshooting.md) |
