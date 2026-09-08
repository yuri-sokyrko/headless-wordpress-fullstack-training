# 🎯 Headless WordPress Fullstack Training — Course Index

24 modules. 117 lessons. One application, built from an empty folder to a deployed
production stack.

You already know Classic WordPress. This course rebuilds that knowledge on a headless stack
and fills in everything around it — React, Next.js, TypeScript, GraphQL, Docker, testing,
CI/CD — in the order you need it, using one real application as the spine.

**New here?** Read the root [README.md](../README.md) for prerequisites — including the accounts
and licences table, which is worth five minutes now rather than a surprise in Module 04 — then
[PROJECT.md](PROJECT.md) for what you are building. Then start
[Module 01](01-kickoff/README.md).

---

## 📚 What you'll learn

- **WordPress as a typed content API** — WPGraphQL, custom post types and taxonomies designed
  for a front end that isn't PHP, ACF field groups as version-controlled code
- **A modern JavaScript front end** — TypeScript, React 19, Next.js 15 App Router, React
  Server Components, Tailwind and shadcn/ui
- **Gutenberg blocks that survive the trip** — six custom blocks queried as structured data
  and rendered by real React components, not HTML blobs
- **Production concerns, properly** — authentication, caching and revalidation, SEO,
  internationalization, Core Web Vitals, accessibility
- **Automated testing on both sides** — Vitest, Playwright, PHPUnit, contract tests, and
  AI agents driving a real browser for exploratory QA
- **Shipping it** — Docker, GitHub Actions, Vercel, Fly.io, code review and quality gates

---

<details>
<summary>📋 <strong>View the complete course structure</strong></summary>

### Phase 1 — WordPress as an API (Modules 01–07, 33 lessons)

You stay in familiar PHP for six modules. By the time you cross into JavaScript, the data you
are fetching is data you modelled yourself.

| # | Module | Lessons | New Technology | What You Build |
|---|---|---|---|---|
| 01 | [Kickoff & the Headless Contract](01-kickoff/) | 3 | — | Repo skeleton, content-model doc, the ADR habit |
| 02 | [Docker, MySQL & Local Infrastructure](02-docker-mysql-and-infrastructure/) | 6 | Docker, Compose, MySQL 8, Adminer, Mailpit | WordPress stack on `:8080`, env-driven config |
| 03 | [Plugin, CPTs, Taxonomies & Roles](03-plugin-cpts-taxonomies-roles/) | 5 | Composer/PSR-4, `show_in_graphql`, `map_meta_cap` | `blame-the-tech-core`, the moderation queue |
| 04 | [ACF, Content Modeling & WP-CLI Seeding](04-acf-content-modeling-and-seeding/) | 5 | ACF + Local JSON, `WP_CLI::add_command` | Field groups as code, `wp blame seed` |
| 05 | [WPGraphQL Fundamentals](05-wpgraphql-fundamentals/) | 5 | WPGraphQL, GraphiQL, Relay connections | Every read query the front end will need |
| 06 | [GraphQL API Design & Schema Extensions](06-graphql-api-design/) | 4 | `register_graphql_field`/`_mutation`, DataLoader | `blameScore`, guarded mutations, `schema.graphql` |
| 07 | [The JavaScript Toolchain & TypeScript](07-javascript-toolchain-and-typescript/) | 5 | Node 22, ESM, TypeScript, ESLint, PHPCS | Typed content model, a script that queries WP |

### Phase 2 — Front-end foundations (Modules 08–14, 34 lessons)

| # | Module | Lessons | New Technology | What You Build |
|---|---|---|---|---|
| 08 | [React Fundamentals for WordPress Developers](08-react-fundamentals/) | 5 | React 19, JSX, hooks, context | `IncidentCard`, `IncidentList`, a filter island |
| 09 | [Next.js 15 App Router Foundations](09-nextjs-app-router/) | 5 | Next 15, RSC, file conventions, route handlers | **The first site you can visit**, on live WP data |
| 10 | [The Typed Data Layer](10-typed-data-layer/) | 5 | graphql-codegen, cache tags, Suspense | Fully typed, tagged, error-bounded queries |
| 11 | [UI System: Tailwind & shadcn/ui](11-ui-system-tailwind-shadcn/) | 5 | Tailwind 4, shadcn/ui, Radix, `cva` | Design system, app shell, the `/hobt` shell |
| 12 | [Your First Tests](12-your-first-tests/) | 4 | Vitest, Playwright, WP-CLI seeding | Green unit + smoke suites, deterministic fixtures |
| 13 | [Gutenberg Block Development](13-gutenberg-block-development/) | 5 | `@wordpress/scripts`, `block.json`, `theme.json` | Six custom blocks + a minimal block theme |
| 14 | [Blocks as Data](14-blocks-as-data/) | 5 | WPGraphQL Content Blocks, `next/image` | The `BlockRenderer` registry, optimised media |

### Phase 3 — The application (Modules 15–18, 17 lessons)

| # | Module | Lessons | New Technology | What You Build |
|---|---|---|---|---|
| 15 | [Authentication & Sessions](15-authentication-and-sessions/) | 5 | WPGraphQL JWT, httpOnly cookies, middleware | Dual auth, protected routes |
| 16 | [Forms, Server Actions & the HOBT Funnel](16-forms-server-actions-hobt-funnel/) | 4 | react-hook-form, Zod, Server Actions | **Submit → moderate → publish**, lead capture |
| 17 | [Faust.js, Preview & Draft Mode](17-faustjs-preview-and-draft-mode/) | 4 | Faust.js, `draftMode()` | Editor preview, and a written verdict on Faust |
| 18 | [Rendering, Caching, ISR & Revalidation](18-rendering-caching-and-revalidation/) | 4 | ISR, `revalidateTag`, HMAC webhooks | Publish in WordPress → live in seconds |

### Phase 4 — Production quality (Modules 19–24, 33 lessons)

| # | Module | Lessons | New Technology | What You Build |
|---|---|---|---|---|
| 19 | [SEO: Yoast, Metadata & Structured Data](19-seo-yoast-and-structured-data/) | 4 | WPGraphQL Yoast SEO, Metadata API, JSON-LD | Editor-controlled `<head>`, rich results, sitemap |
| 20 | [Internationalization](20-internationalization/) | 4 | Polylang, WPGraphQL Polylang, next-intl | en/uk/de with a switcher and valid hreflang |
| 21 | [Core Web Vitals & Performance Budgets](21-core-web-vitals-and-performance/) | 4 | Lighthouse CI, `web-vitals`, bundle analyzer | A measured CWV pass and enforced budgets |
| 22 | [Accessibility](22-accessibility/) | 4 | axe, keyboard & screen-reader testing, WCAG 2.2 | An audit, the fixes, and a11y in CI |
| 23 | [Testing Deep Dive & Agentic QA](23-testing-deep-dive-and-agentic-qa/) | 9 | RTL, MSW, Pest, `wp-phpunit`, Playwright MCP | Five green suites + agent-driven exploratory QA |
| 24 | [Ship It: Security, CI/CD, Deployment & Code Review](24-ship-it/) | 8 | GitHub Actions, Fly.io, Vercel, Sentry, Husky | **Live in production**, gated CI, a reviewed PR |

</details>

---

## 🧭 The build arc

Every module leaves the application in a runnable state. If you stop early, you still have
something that works.

| After module | What Blame The Tech can do |
|---|---|
| 01 | Nothing runs yet. Repo, content model and architecture are documented. The one docs-only module. |
| 02 | WordPress installs and persists. Config is env-driven. No secrets in git. |
| 03 | Editors hand-author incidents, reviews and scapegoats, and move incidents through moderation. |
| 04 | One command produces a fully populated site — 40 incidents, 8 reviews, 10 posts, 3 pages. |
| 05 | Every read the front end needs is answerable in GraphiQL and saved as a document. |
| 06 | The API is a designed contract — computed fields, guarded mutations, depth limits, a committed schema. |
| 07 | Lint and typecheck pass, and a Node script prints live incidents from WPGraphQL. |
| 08 | A React scratch route renders incident cards with a working client-side filter. |
| 09 | **The first site you can visit.** Home, incidents, blog and reviews on live WordPress data. |
| 10 | The same site, now codegen-typed, cache-tagged, with loading and error states everywhere. |
| 11 | It looks like a product. Design system, accessible app shell, `/hobt` landing (CTAs inert). |
| 12 | `npm test` and `npx playwright test` are green, against deterministic seeded data. |
| 13 | Editors have six custom blocks in Gutenberg. The front end still ignores them — deliberately. |
| 14 | Editor-composed pages render through `BlockRenderer`. `/hobt` changes with no deploy. |
| 15 | Users register and log in. `/incidents/submit` is protected. Sessions are httpOnly. |
| 16 | **The core loop is complete.** Submit → moderate → publish. Get Demo captures leads. |
| 17 | Editors hit Preview in wp-admin and see the draft rendered by Next.js. |
| 18 | Publishing in WordPress updates the live site in seconds via a signed webhook. |
| 19 | Every page has editor-controlled metadata, JSON-LD, a sitemap, robots and redirects. |
| 20 | The whole site works in en/uk/de with a switcher and a valid hreflang cluster. |
| 21 | Core Web Vitals pass on the key routes, with budgets written down. |
| 22 | Zero serious axe violations, keyboard-navigable end to end. |
| 23 | Five green suites, plus an agent that finds bugs you didn't think to look for. |
| 24 | **Live in production.** WordPress on Fly.io, Next.js on Vercel, CI gating every PR. |

---

## 🔄 Your learning workflow

**Step 1 — Read the module README.** It states the exact state your repo must be in before
you start. If it doesn't match, go back and finish the previous module's Verification.

**Step 2 — Work the lessons in order.** Each lesson runs:

| Section | What you do |
|---|---|
| `## Quick Overview` | Read. Two paragraphs and the list of what you'll be holding at the end. |
| `## Classic WP Analogy` | Read carefully. This is the bridge from what you know — including where the analogy breaks. |
| `## Key Concepts` | Read. Explanation, comparisons, fragments. No build steps here. |
| `## Task` | Build. Numbered, imperative steps in the order you type them. |
| `## Verification` | **Run it.** One bash block, copy-pasteable, with expected output. |
| `## Control Questions` | Five questions, no answers. If you can't answer one, re-read that concept. |
| `## Learn More` | Optional depth. |

**Step 3 — Never skip Verification.** In a course with no test suite, verification blocks
*are* the test suite. Module N+1 assumes module N verified clean.

**Step 4 — Commit after every lesson.**

```bash
git add -A
git commit -m "feat(wp): register the incident post type"
# Conventional commits — Module 24 turns this into a CI gate.
# A per-lesson history is also the fastest way to bisect your own mistakes.
```

---

## 📖 Reference

Keep these open in a second tab. They are the single source of truth — lessons link to them
rather than restating them, so they never drift.

| Document | When you need it |
|---|---|
| [PROJECT.md](PROJECT.md) | The end-state architecture of Blame The Tech |
| [appendix/01-glossary.md](appendix/01-glossary.md) | "What is a Server Component again?" |
| [appendix/02-classic-to-headless-map.md](appendix/02-classic-to-headless-map.md) | "How do I do `wp_nav_menu()` here?" |
| [appendix/03-content-model-reference.md](appendix/03-content-model-reference.md) | **The content contract.** Every field name, term slug and capability. Modules 03–06, 13–16. |
| [appendix/04-env-reference.md](appendix/04-env-reference.md) | **The env & secrets contract.** Every variable, where it lives, why. Modules 02, 09, 15–18, 24. |
| [appendix/05-graphql-cheatsheet.md](appendix/05-graphql-cheatsheet.md) | Query syntax, connections, fragments, variables |
| [appendix/06-troubleshooting.md](appendix/06-troubleshooting.md) | It broke and the error message is unhelpful |
| [appendix/07-command-reference.md](appendix/07-command-reference.md) | Every `docker compose`, `wp`, and `npm` command the course uses |

---

## 💡 Learning tips

1. **Type the code. Don't copy-paste it.** Especially in Modules 07–09, where the syntax is
   new. Muscle memory is the point.
2. **Break things on purpose.** Delete a `revalidateTag` call and watch a stale page. Remove a
   capability check and watch the mutation succeed when it shouldn't. Then put it back.
3. **Read the error message twice before searching.** Next.js and WPGraphQL both have
   unusually good error messages, and learning to read them saves hours later.
4. **Modules 09 and 14 are the two conceptual jumps.** If a module feels hard, it is probably
   one of those two — slow down rather than pushing through.
5. **Do not skip Module 12.** It is four lessons of testing in the middle of the fun part, and
   it changes how you write every component afterward.
6. **The appendix is not optional reading.** Modules 05 onward assume you have the content
   model open.
7. **`## Learn More` links are for after you finish the module**, not during. They will pull
   you down rabbit holes mid-build.

---

## 🤝 Stuck?

1. Re-run the previous lesson's `## Verification` — most breakage is upstream of where it
   surfaces.
2. Check [appendix/06-troubleshooting.md](appendix/06-troubleshooting.md).
3. `docker compose logs -f wordpress` and the browser console are right almost every time.

---

**Start here → [Module 01 — Kickoff & the Headless Contract](01-kickoff/README.md)**
