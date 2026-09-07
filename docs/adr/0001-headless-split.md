<!-- docs/adr/0001-headless-split.md -->

# ADR 0001 — Split WordPress and the front end

- **Status:** Accepted
- **Date:** 2026-09-02
- **Deciders:** Yuri Sokyrko
- **Supersedes:** —
- **Superseded by:** —

## Context

Blame The Tech needs a moderated user-generated post type, three taxonomies, a satirical blog,
an editor-composed marketing landing page, and a lead-capture funnel. Editors are WordPress
users and will not be retrained. The public front end needs component-level interactivity,
per-route caching, a typed data layer, and Core Web Vitals good enough to be a merge gate.

Classic WordPress can serve every content requirement today. What it cannot do without
significant fighting is the front-end half: PHP templates plus jQuery islands give no type
safety, no build-time dependency graph, no component testing story, and no per-route cache
granularity. Meanwhile the editorial requirements — Gutenberg, ACF, roles and capabilities,
revisions, moderation — are exactly what WordPress is best at, and rebuilding them in a
headless CMS would be a year of work to reach parity.

## Decision

WordPress keeps the whole editorial half — post types, taxonomies, ACF field groups, roles,
revisions, moderation, media — and stops rendering pages entirely; Next.js 15 on the App Router
takes over routing, rendering, caching and every pixel the public sees. Exactly one channel
crosses the boundary: `POST /graphql`, issued by the Next.js **server runtime** and never by a
browser, a client component or a `useEffect`, which is why this project has no CORS
configuration and no GraphQL endpoint in its client bundle. Authorisation does not move with the
rendering: WordPress still owns it, via `current_user_can()` inside every mutation, and the
session Next reads in `middleware.ts` decides only what to _show_ — it is a UX affordance, not a
security boundary.

## Alternatives Considered

| Alternative                                             | How it would work                                                                                                                                                                                                                                                                                         | Why not                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stay Classic: child theme + jQuery islands              | `single-incident.php` renders the page; a page cache in front; progressive enhancement with jQuery for the filters                                                                                                                                                                                        | Fastest to ship and genuinely adequate for the content, but no type system, no component tests, no per-route revalidation, and no path to the front-end skills this project exists to build                                                                                                                                                                                                                                                       |
| Headless with WPGraphQL + Next.js App Router            | A project plugin registers the content model as code; WPGraphQL exposes it; `schema.graphql` is committed and drives codegen; Next fetches per route from the server runtime with tagged `fetch` calls, blocks arrive as structured data, and a signed webhook from WordPress revalidates tags on publish | **Chosen.** What I get: one typed contract from PHP registration through codegen to TSX, per-route cache granularity with tag invalidation, a front end that hydrates only its islands, and an editing experience that does not change at all. What I pay is the whole cost table below — the plugin ecosystem permanently, preview and forms until Modules 16–17, and a second deployment target forever                                         |
| Headless with the WP REST API + a static site generator | Pull `/wp-json/wp/v2/*` at build time and emit a fully static site; rebuild the site on publish                                                                                                                                                                                                           | REST hands back fixed payload shapes, so I over-fetch the fields I do not want and still need `_embed` or extra round trips per entity for ACF, terms and media — an N+1 at build time instead of one shaped query. Worse, an editor publishing a typo fix at 3pm waits for a whole-site rebuild before it is live, with no per-route granularity, and user-submitted incidents are runtime writes that a build-time generator has nowhere to put |

## Consequences

### Positive

- **One typed contract, enforced by tooling rather than by memory.** The plugin registers the
  names, `wp graphql generate-static-schema` commits `schema.graphql`, codegen turns that into
  TypeScript, and a rename that breaks a consumer shows up as a red build in a pull request
  instead of as an `undefined` in production.
- **Cache granularity per route instead of per site.** Tagged fetches plus a signed
  revalidation webhook mean publishing one incident invalidates that incident, not the whole
  front end, and each route gets to choose its own `revalidate` value — `/hobt` short because
  `seats_left` drives an urgency badge, an archived incident long.
- **The editors do not have to be retrained.** Gutenberg, ACF, revisions, roles and the
  moderation queue are untouched, which was a hard requirement. Headless changes my job, not
  theirs.
- **Very little JavaScript reaches the browser.** Server Components render on the server and
  only the genuinely interactive islands — nav, filters, dialogs — hydrate, so Core Web Vitals
  can be a merge gate rather than an aspiration.
- **A smaller attack surface, almost by accident.** Because the only channel is
  server-to-server, there is no CORS policy to misconfigure, no `/graphql` URL in the shipped
  bundle, and no token JavaScript can read. Those are consequences of the topology, not
  features I have to maintain.
- **The content model is code in git.** ACF Local JSON means field groups are diffable and
  reviewable, and deploying a model change needs no database import step.

### Negative

Drawn from the cost table in Lesson 01.2, with the module that pays each one back — or an
honest admission that nothing does.

- **The front-end plugin ecosystem is gone, and this one is never paid back.** Sliders, related-
  post widgets, page builders, cookie banners and most SEO front-end output have nowhere to
  render. Only plugins that touch data (ACF, Polylang) or the editor (Yoast's metadata UI)
  survive. On a client project this is the row that decides whether headless is even viable.
- **Preview breaks immediately and comes back only partly, in Module 17.** The replacement is a
  single-use, 120-second token exchanged server-to-server, so reloading a preview URL 404s.
  Editors have to be told that explicitly; it is a behaviour change, not a bug I can fix.
- **Forms become mine, permanently — Module 16 builds them, but nothing hands them back.**
  Contact Form 7 and Gravity Forms render their own front end and therefore cannot be used, so I
  own the entire pipeline: honeypot, render timing, Turnstile, rate limiting and server-side
  re-validation.
- **Cache invalidation turns into code I own and have to test — Module 18.** There is no
  `wp_cache_flush()` that reaches a CDN in someone else's network. The failure mode is quiet: a
  webhook that 401s leaves stale content served happily, with nothing on screen to say so.
- **Debugging spans two processes, two log streams and a network hop — Modules 02 and 24, and
  only partly.** Locally `docker compose logs -f wordpress` alongside the Next terminal is
  enough; production needs Sentry and structured logging before it is honestly workable.
- **Comments are not in this course at all.** The data is queryable, but moderation UI, spam
  handling and rendering would all be mine to build, so the feature is simply absent.
- **Two deployment targets, two platforms, two sets of secrets — Module 24, accepted rather than
  restored.** The CI work in Module 24 exists because of this row and does not remove it.

### Neutral

- **Menus stop being markup and become data.** Every walker class and `nav_menu_css_class`
  filter I ever wrote is now useless — and so is the fight to get semantic HTML out of
  `wp_nav_menu()`. I do more work and get exactly the markup I asked for, which is a trade
  rather than a win.
- **Next is no longer the only writer, and never was.** wp-admin writes content directly and
  WP-CLI writes it from a container, neither passing through Next. That is neither better nor
  worse than Classic, where the same was true invisibly, but it does mean no part of the front
  end may assume it has seen every change.
- **The WordPress front end still exists; the theme just redirects it.** `incident` stays
  `publicly_queryable` so permalinks and `preview_post_link` behave, so there is a
  WP-rendered surface that is real but never user-visible. Slightly odd to explain, harmful to
  no one.

## Related

- Lesson 01.2 — the contract and the cost table this ADR draws on
- ADR 0002 — containerise WordPress but not Next (Lesson 02.1)
