# The Blame The Tech Project

> 📌 **This is the end-state architecture. Do not try to build it all at once.**
> Read it once for orientation, then close it and follow the lessons in order. Every piece
> below is introduced by a specific lesson, at the point where it solves a problem you
> already have.

## The product

**Blame The Tech** is a satirical Dev Incident Scapegoat Portal. Developers officially record
production bugs and pin the blame on inanimate objects, tech stacks, or solar flares.

| Section | Route | Who writes it | What it exercises |
|---|---|---|---|
| **Incidents** | `/[locale]/incidents` | public users, moderated by editors | Authenticated mutations, custom capabilities, Server Actions, faceted lists |
| **Incident detail** | `/[locale]/incidents/[slug]` | — | Blocks as data, ISR, tag-based revalidation |
| **Scapegoats** | `/[locale]/scapegoats` | editors | Taxonomy modelling, term counts, the blame leaderboard |
| **Blog** | `/[locale]/blog` | editors | Custom Gutenberg blocks, core block mapping |
| **Tech reviews** | `/[locale]/reviews` | editors only | ACF repeaters, ratings, JSON-LD `Review` schema |
| **HOBT promo** | `/[locale]/hobt` | editors, block-composed | Lead capture, "Get Demo" dialog, "Start Now" CTA, SSG |
| **Auth** | `/[locale]/login`, `/register`, `/account` | — | JWT in httpOnly cookies, middleware guards |

**HOBT** — *How To Omit Blaming Tech* — is the fictional product the site upsells: a course
for PMs and developers. Its landing page is entirely editor-composed from custom blocks, which
is the point: marketing can change the page without a deploy.

## Local architecture

Next.js runs on the **host**. Everything else runs in Docker Compose.

```
┌─ HOST MACHINE ──────────────────────────────────────────────────────────────────┐
│                                                                                 │
│   Browser                                                                       │
│     ├── http://localhost:3000          the app                                  │
│     ├── http://localhost:8080/wp-admin editors                                  │
│     ├── http://localhost:8081          Adminer (SQL + EXPLAIN)                  │
│     └── http://localhost:8025          Mailpit (captured mail)                  │
│           │                                                                     │
│   ┌───────▼───────────────────────────────────────┐                             │
│   │ next-app        `npm run dev`  (NOT in Docker)│                             │
│   │ Next.js 15 App Router · Node 22 · Turbopack   │                             │
│   │ RSC fetch + Server Actions + middleware       │                             │
│   │ :3000                                         │                             │
│   └───────────────┬───────────────────▲───────────┘                             │
│                   │                   │                                         │
│   POST /graphql   │                   │  POST /api/revalidate                   │
│   Bearer <jwt>    │                   │  from host.docker.internal:3000         │
│   (server-side    │                   │  HMAC-SHA256 signed                     │
│    only)          │                   │                                         │
│ ┌─────────────────▼───────────────────┴───────────────────────────────────────┐ │
│ │  docker compose   project: btt   network: btt-net                           │ │
│ │                                                                             │ │
│ │  ┌────────────────────────────┐  ┌─────────────┐  ┌──────────────────────┐  │ │
│ │  │ wordpress                  │  │ adminer     │  │ mailpit              │  │ │
│ │  │ wordpress:6.8-php8.3-apache│  │ :8081       │  │ UI  :8025            │  │ │
│ │  │ :8080 → 80                 │  │             │  │ SMTP :1025           │  │ │
│ │  │                            │  │ raw SQL,    │  └──────────▲───────────┘  │ │
│ │  │ /graphql   /wp-admin       │  │ EXPLAIN     │             │ wp_mail()    │ │
│ │  │ /wp-json/btt/v1/*          │  └──────┬──────┘             │ via SMTP     │ │
│ │  │                            │         │                    │              │ │
│ │  │ bind mounts (you edit):    │         │                    │              │ │
│ │  │   ./wp-content/plugins  ⇄  │         │                    │              │ │
│ │  │   ./wp-content/themes   ⇄  │         │                    │              │ │
│ │  │   ./wp-content/mu-plugins⇄ │         │                    │              │ │
│ │  │ named volume:              │         │                    │              │ │
│ │  │   btt-uploads → uploads/   │         │                    │              │ │
│ │  └─────────────┬──────────────┘         │                    │              │ │
│ │                │ mysqli :3306           │                    │              │ │
│ │  ┌─────────────▼──────────────────────────────────┐──────────┘              │ │
│ │  │ mysql:8.0                                      │                         │ │
│ │  │ :3306 published — for EXPLAIN drills (Mod. 02) │                         │ │
│ │  │ named volume: btt-db-data                      │                         │ │
│ │  │ healthcheck: mysqladmin ping                   │                         │ │
│ │  └────────────────────────────────────────────────┘                         │ │
│ └─────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Why Next.js is not in Docker:** you edit TypeScript constantly, and Next's hot reload
through bind mounts on macOS is slow and unreliable. WordPress is what actually benefits from
containerisation — a pinned PHP version, the right extensions, a real MySQL. Module 24 adds an
optional overlay that runs Next in a container, purely to prove the production image builds.

## Request flow

```
Browser              Next.js (:3000)                  WordPress (:8080)      MySQL
   │                        │                                  │                │
   │ GET /en/incidents/dns  │                                  │                │
   ├───────────────────────▶│                                  │                │
   │                        │ middleware: locale + auth gate   │                │
   │                        │ ISR cache HIT? ── yes ─────────────────────────┐  │
   │                        │        │ no                                   │  │
   │                        │        ▼                                      │  │
   │                        │ RSC page.tsx                                  │  │
   │                        │  fetchGraphQL(IncidentBySlug, {               │  │
   │                        │    next: { tags: ['incident:dns'],            │  │
   │                        │            revalidate: 600 } })               │  │
   │                        ├─── POST /graphql ───────────────▶│            │  │
   │                        │    server-to-server, TLS in prod │ WPGraphQL  │  │
   │                        │    the browser never sees this   │  → WP_Query│  │
   │                        │                                  ├─── SQL ───▶│  │
   │                        │                                  │◀───────────┤  │
   │                        │◀── JSON ─────────────────────────┤            │  │
   │                        │   { incident, editorBlocks[],                 │  │
   │                        │     scapegoat, severity, seo }                │  │
   │                        │        ▼                                      │  │
   │                        │  <BlockRenderer blocks={…}/> → React tree     │  │
   │                        │  cached under tag 'incident:dns' ◀────────────┘  │
   │◀── HTML + RSC flight ──┤                                                  │
   │  hydrate client islands only — nav, filters, dialogs                      │
```

## Cache invalidation

The reason the site can be static *and* fresh.

```
Editor clicks "Update" in wp-admin
   │  transition_post_status / saved_term / acf/save_post
   ▼
blame-the-tech-core → wp_remote_post( BTT_FRONTEND_URL . '/api/revalidate',
      body:    {"type":"post","postType":"incident","slug":"dns","locale":"en"},
      headers: { X-BTT-Timestamp: <unix>,
                 X-BTT-Signature: sha256=<HMAC(ts + "." + body, SECRET)> },
      blocking: false, timeout: 2 )   ← never block an editor on a network call
   │
   ▼
Next /api/revalidate  →  1. timestamp within ±300s   (replay guard)
                         2. timingSafeEqual on HMAC  → 401, no reason echoed
                         3. Zod.parse(body)          → 400
                         4. revalidateTag('incident:dns')
                            revalidateTag('incidents')
                         5. 200 {"revalidated":[...]}
```

## Production topology

```
                        ┌──────────────────────────────────────────┐
   end users  ─────────▶│  Vercel Edge Network (CDN)               │
   (HTTPS)              │  ├─ static assets, ISR HTML cache        │
                        │  └─ Node 22: RSC, Server Actions,        │
                        │     middleware, route handlers           │
                        └────┬──────────────────────────▲──────────┘
                             │ POST /graphql            │ POST /api/revalidate
                             │ TLS 1.2+, server-only    │ HMAC-SHA256 signed
                             ▼                          │
                        ┌──────────────────────────────┴───────────┐
                        │  Fly.io: btt-wp                          │
                        │  THE SAME Docker image as local dev      │
                        │  opcache on · WP_DEBUG off               │
                        │  DISALLOW_FILE_EDIT / FILE_MODS = true   │
                        │  secrets via `fly secrets set` —         │
                        │  never baked into the image              │
                        └────┬──────────────────────────┬──────────┘
                             │ private network          │ S3 API
                             ▼                          ▼
              ┌──────────────────────────┐   ┌────────────────────────────┐
              │ MySQL 8                  │   │ Cloudflare R2 (or S3)      │
              │ Fly app + 10GB volume    │   │ wp-content/uploads offload │
              │ private-network only     │   │ served from cdn.<domain>   │
              │ volume snapshots         │   │ next/image remotePatterns  │
              └──────────────────────────┘   └────────────────────────────┘

  Alternative target taught side by side: Railway — same image, managed MySQL add-on,
  simpler volumes. Module 24 ships both fly.toml and railway.json.
```

> **Three things the course is honest about, because pretending otherwise would teach you
> the wrong lessons:**
>
> - **Fly.io has no managed MySQL.** Running it as a Fly app with a volume is fine for a
>   course and for low-stakes production, but it is a single point of failure with no
>   point-in-time recovery and a snapshot RPO of roughly 24 hours. Module 24 names the managed
>   alternatives and what they cost.
> - **A Fly volume pins the app to one machine.** The moment you scale to two, `uploads/`
>   diverges. That is why media offload to R2/S3 is taught as the correct answer, not an
>   optional extra.
> - **You cannot roll back `wp core update-db`.** Application code rolls back by redeploying
>   a previous immutable image. Schema changes are forward-only, which is why WordPress core
>   is pinned in the `Dockerfile` and core upgrades get their own manual workflow that
>   snapshots the volume first.

## Which module builds what

### `wordpress-headless/`

| Module | What lands |
|---|---|
| 02 | `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`, `php.ini`, the `btt-headless` theme stub |
| 03 | `plugins/blame-the-tech-core/` — post types, taxonomies, custom statuses, roles and capabilities |
| 04 | `includes/acf-json/` field groups, the `wp blame seed` WP-CLI command, the migration runner |
| 06 | `includes/graphql/` — enums, `blameScore`, `createIncident`, `registerDeveloper`, `submitHobtLead` |
| 12 | `mu-plugins/blame-seeder/` — determinism refinements to the seeder, plus the `wp blame fixture` cache |
| 13 | `plugins/blame-the-tech-blocks/` — six blocks, `block.json`, `@wordpress/scripts` build |
| 15 | JWT config and the `incident_reporter` role hardening |
| 17 | `includes/Preview.php` — preview token issue and verify |
| 18 | `includes/Revalidate.php` — the signed webhook |
| 20 | Polylang bootstrap, `wp blame ensure-languages` |
| 23 | `tests/Unit/` (Pest + Brain Monkey), `tests/Integration/` (`wp-phpunit`), `phpcs.xml.dist`, `phpstan.neon` |
| 24 | `Dockerfile` (multi-stage, non-root, opcache), `.dockerignore`, `fly.toml`, `mu-plugins/000-btt-hardening.php` |

### `next-app/`

| Module | What lands |
|---|---|
| 09 | `next` + `next.config.ts`, `app/[locale]/` route shells, `middleware.ts`, `/api/health` |
| 10 | `src/lib/graphql/` client, `codegen.ts`, `src/gql/`, `src/graphql/` documents, error boundaries |
| 11 | `tailwind.config.ts`, `components.json`, `src/components/ui/`, the app shell |
| 12 | `vitest.config.ts`, `playwright.config.ts`, first specs |
| 14 | `src/components/blocks/` — `BlockRenderer`, the registry, one component per block, `RichText.tsx` |
| 15 | `src/lib/auth/`, `src/actions/auth.ts`, `/api/auth/refresh`, route guards |
| 16 | `src/lib/validation/schemas.ts`, `src/actions/incidents.ts`, `src/actions/leads.ts`, the forms |
| 17 | `/api/preview`, `/api/preview/exit`, `PreviewBanner`, the `/faust` spike |
| 18 | `/api/revalidate`, per-route rendering config (`tags.ts` itself lands in Lesson 10.3) |
| 19 | `generateMetadata`, `src/lib/seo/`, `app/sitemap.ts`, `app/robots.ts`, `opengraph-image.tsx` |
| 20 | `src/lib/i18n/`, `src/messages/{en,uk,de}.json`, the locale switcher |
| 21 | `lighthouserc.json`, `/api/vitals`, bundle-analyzer config |
| 22 | Accessibility fixes across components, `a11y.spec.ts` |
| 23 | `tests/mocks/` MSW handlers, component tests, the full E2E suite, `.mcp.json` |
| 24 | `next.config.ts` security headers, Sentry, `.github/workflows/*` |

## The tech stack, in one table

| Layer | Technology | Introduced |
|---|---|---|
| Container runtime | Docker, Docker Compose | 02 |
| Database | MySQL 8, Adminer, `EXPLAIN` | 02 |
| CMS | WordPress 6.8, PHP 8.3 | 02 |
| Content model | Custom post types, taxonomies, ACF (Local JSON) | 03–04 |
| Tooling (PHP) | Composer, PSR-4, WP-CLI, PHPCS, PHPStan | 03, 07, 23 |
| API | WPGraphQL + Content Blocks / ACF / Yoast / Polylang / JWT | 05–06 |
| Language | TypeScript (strict) | 07 |
| UI library | React 19 | 08 |
| Framework | Next.js 15 App Router, RSC, Server Actions | 09 |
| Data layer | `fetch` + graphql-codegen `TypedDocumentNode` | 10 |
| Styling | Tailwind 4, shadcn/ui, Radix, `cva` | 11 |
| Blocks | `@wordpress/scripts`, `block.json`, `@wordpress/data` | 13–14 |
| Auth | WPGraphQL JWT in httpOnly cookies | 15 |
| Forms | react-hook-form + Zod | 16 |
| Preview | Faust.js (evaluated), Next `draftMode()` (adopted) | 17 |
| Caching | ISR, cache tags, HMAC revalidation webhooks | 18 |
| SEO | Yoast, Next Metadata API, JSON-LD | 19 |
| i18n | Polylang + next-intl | 20 |
| Performance | Lighthouse CI, `web-vitals`, `@next/bundle-analyzer` | 21 |
| Accessibility | axe-core, `@axe-core/playwright`, WCAG 2.2 AA | 22 |
| Testing (JS) | Vitest, React Testing Library, MSW v2, Playwright | 12, 23 |
| Testing (PHP) | Pest, Brain Monkey, `wp-phpunit` | 23 |
| Agentic QA | Playwright MCP | 23 |
| CI | GitHub Actions, Codecov, Trivy, gitleaks | 24 |
| Hosting | Vercel (Next), Fly.io (WordPress), Railway (alt) | 24 |
| Observability | Sentry, structured logging | 24 |

## Final layout

When you finish Module 24, your repo looks like this:

```
headless-wordpress-fullstack-training/
├── .lessons/                    the course (shipped with the repo)
├── .github/workflows/           CI/CD — Module 24
├── wordpress-headless/          YOU BUILD THIS
│   ├── docker-compose.yml
│   ├── schema.graphql           the committed GraphQL contract (M06)
│   ├── Dockerfile  fly.toml
│   └── wp-content/
│       ├── plugins/blame-the-tech-core/
│       ├── plugins/blame-the-tech-blocks/
│       ├── mu-plugins/
│       └── themes/btt-headless/
└── next-app/                    YOU BUILD THIS
    ├── src/{app,actions,components,lib,graphql,gql,messages}/
    ├── e2e/
    └── package.json
```

Now go to [Module 01](01-kickoff/README.md) and start with an empty folder.
