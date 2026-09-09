# Module 09 — Next.js 16 App Router Foundations

## Prerequisites

Before starting this module you should have completed:

- **Module 08** — `IncidentCard`, `IncidentList`, `IncidentSearch` and `IncidentFilters` render and filter against fixtures
- **Module 07** — strict TypeScript, ESLint, and a Node script that queries WPGraphQL
- **Module 05 and 06** — the queries this module fires are the documents you saved in GraphiQL, and the committed `schema.graphql` is the contract they honour

> ⚠️ **This is the first of the two conceptual jumps in the course** (Module 14 is the other).
> If Module 08's components still feel unfamiliar, go back. Server Components are hard to
> reason about if plain components are not yet boring.

## Starting State

```bash
# 1. Toolchain green, fixtures rendering
cd next-app && npm run lint && npm run type-check
# Expected: no errors from either

# 2. WordPress is up and seeded
docker compose -f ../wordpress-headless/docker-compose.yml ps
# Expected: wordpress, db, adminer, mailpit all "running", db "(healthy)"
```

```
next-app/
├── package.json  tsconfig.json  eslint.config.mjs  .prettierrc
├── scripts/blame.mjs
└── src/
    ├── types/                            (M07)
    └── components/incidents/             (M08 — IncidentCard, IncidentList,
                                           IncidentSearch, IncidentFilters,
                                           IncidentFilterProvider, fixtures)
```

There is no `src/app/`, no `next.config.ts` and no `proxy.ts`. Lesson 09.1 creates them
and removes the Vite harness.

## What You'll Learn

- **The App Router** — a file-system router, and why it is the template hierarchy with the guessing removed
- **File conventions** — `layout.tsx`, `page.tsx`, `route.ts`, dynamic `[slug]` and catch-all `[...slug]` segments
- **The `[locale]` segment** — reserved on day one with a single locale, because retrofitting it in Module 20 would rewrite every route file
- **React Server Components** — the default, running on the server, never shipped to the browser
- **Client Components** — `'use client'` as a bundle boundary, not a feature flag
- **`async` components** — `await` a GraphQL query directly inside a component
- **`next/link` and `next/navigation`** — client-side navigation, `useRouter`, `notFound()`
- **Route Handlers and `proxy.ts`** — the Next equivalents of a REST controller and a `template_redirect` hook

## What You'll Build

The first version of Blame The Tech you can open in a browser: a home page, `/en/incidents`,
`/en/incidents/[slug]`, `/en/blog`, `/en/blog/[slug]`, `/en/reviews`, `/en/reviews/[slug]` and
`/en/scapegoats`, all rendering **live WordPress data** over HTTP from a Server Component,
plus `/api/health` and a `proxy.ts` that normalises the locale prefix.

After this module the site exists. It is unstyled, its GraphQL response types are hand-written
by eye, and page bodies are an HTML blob. Modules 10, 11 and 14 fix exactly those three things,
in that order.

## Lessons

| #  | Lesson | New Technology | What You Build |
|----|--------|----------------|----------------|
| 01 | [The App Router & File Conventions](01-app-router-and-file-conventions.md) | `next` 16, Turbopack, `app/[locale]/` | The scaffold by hand, root layout, home page, `.env.example` |
| 02 | [Server vs Client Components](02-server-vs-client-components.md) | RSC, `'use client'`, the server/client boundary | `/incidents` as a server page with the M08 filter as an island |
| 03 | [Fetching WordPress Data in a Server Component](03-fetching-wordpress-data-in-a-server-component.md) | `async` components, `fetch`, hand-written response types | Live incidents, and a type that lies |
| 04 | [Navigation, Linking & Layouts](04-navigation-linking-and-layouts.md) | `next/link`, `generateStaticParams`, `notFound()` | Blog, reviews and scapegoat routes, plus site nav |
| 05 | [Route Handlers & Proxy](05-route-handlers-and-proxy.md) | `route.ts`, `proxy.ts`, `NEXT_PUBLIC_` boundary | `/api/health`, locale proxy, a secrets-in-bundle check |

## Route inventory after this module

| Route | File | Renders |
|---|---|---|
| `/en` | `src/app/[locale]/page.tsx` | Latest incidents (`IncidentsList`, `first: 6`; becomes `HomepageFeeds` in Module 10) |
| `/en/incidents` | `src/app/[locale]/incidents/page.tsx` | The full list plus the client filter island |
| `/en/incidents/[slug]` | `src/app/[locale]/incidents/[slug]/page.tsx` | One incident, body as an HTML blob |
| `/en/blog` | `src/app/[locale]/blog/page.tsx` | `posts` connection |
| `/en/blog/[slug]` | `src/app/[locale]/blog/[slug]/page.tsx` | One post, body as an HTML blob |
| `/en/reviews` | `src/app/[locale]/reviews/page.tsx` | `techReviews` with ACF ratings |
| `/en/reviews/[slug]` | `src/app/[locale]/reviews/[slug]/page.tsx` | One review with the `pros` / `cons` repeaters |
| `/en/scapegoats` | `src/app/[locale]/scapegoats/page.tsx` | The blame leaderboard from term counts |
| `/api/health` | `src/app/api/health/route.ts` | JSON liveness, no secrets echoed |

Env variables introduced here are `WP_GRAPHQL_ENDPOINT` and `NEXT_PUBLIC_SITE_URL` — see
[the env reference](../appendix/04-env-reference.md#3-nextjs--next-appenvlocal).

## Three debts this module takes on deliberately

Each one is paid off by a specific later module. They are listed here so that when a lesson
tells you to write something you can see is wrong, you know it is on purpose.

| Debt | Why it is taken on | Paid off in |
|---|---|---|
| GraphQL response types hand-written by reading GraphiQL | Codegen without having felt the problem it solves teaches a ritual, not a reason | Lesson 10.2, in one commit |
| Page bodies rendered from `content` with `dangerouslySetInnerHTML` | The structured alternative only makes sense once the blob has cost you something | Module 14 |
| No loading states, no error boundaries, no cache policy | Adding them before the routes exist means adding them twice | Module 10 |

## How to Work

1. **Read the module README** and confirm Starting State. There is no `create-next-app` in this course — Lesson 09.1 explains why and adds Next.js to the Module 07 project by hand.
2. **Work the lessons in order.** 09.1 through 09.5 are sequential; skipping 09.2 makes 09.3's fetch fail in a way that is genuinely confusing.
3. **Keep `npm run dev` and the browser open.** Turbopack recompiles on save, and the terminal shows which component rendered on the server.
4. **Run `## Verification` before moving on**, then commit: `git commit -m "feat(next): app router routes on live wordpress data"`.
