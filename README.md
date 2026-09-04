# Headless WordPress Fullstack Training

You know WordPress. You have written `functions.php` hooks, custom post types, `WP_Query`
loops, meta boxes and theme templates. You have styled sites with CSS and wired up behaviour
with jQuery.

This course takes that knowledge and rebuilds it on a headless stack: **WordPress as a typed
content API, Next.js as the front end.** You will not be told to forget what you know — every
module bridges from the classic technique to the headless one, because the classic technique
is usually still there, just wearing different clothes.

By the end you will have built and deployed a complete application.

## The application: Blame The Tech

A satirical **Dev Incident Scapegoat Portal**. Developers officially record production bugs
and pin the blame on inanimate objects, tech stacks, or solar flares.

| Feature | What it exercises |
|---|---|
| Incident submission + admin moderation | Authenticated mutations, custom capabilities, Server Actions |
| `scapegoat` taxonomy with a blame leaderboard | Taxonomy modelling, term counts, indexed reads |
| Satirical blog | Gutenberg blocks as structured data, ISR |
| Admin-authored tech-company reviews | ACF repeaters, ratings, JSON-LD `Review` schema |
| "HOBT — How To Omit Blaming Tech" promo funnel | Editor-composed landing page, lead capture, "Get Demo" / "Start Now" CTAs |

The end-state architecture is in **[.lessons/PROJECT.md](.lessons/PROJECT.md)**. Read it for
orientation — then ignore it and follow the lessons in order. You build the app gradually.

## Who this is for

**You should already know:**

- WordPress development — hooks and filters, plugins, `WP_Query`, custom post types, wp-admin
- PHP — functions, classes, arrays, `$_POST` handling
- HTML and CSS — semantic markup, the box model, responsive layout
- Enough JavaScript to have used jQuery in anger

**You do not need to know** (the course teaches all of it): React, Next.js, TypeScript,
GraphQL, Docker, npm and the modern JS toolchain, automated testing, CI/CD.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Docker Desktop | latest | WordPress + MySQL + Adminer + Mailpit run in containers (Module 02) |
| Node.js | **22 LTS** — see `.nvmrc` | Next.js 15, the block build, every test runner |
| Git | any recent | You commit after every lesson |
| A code editor | VS Code recommended | `.editorconfig` is respected by all major editors |

```bash
# 1. Node — use nvm so the version matches .nvmrc
nvm install && nvm use
node -v
# Expected: v22.x.x

# 2. Docker
docker --version && docker compose version
# Expected: two version lines, no errors

# 3. Docker is actually running
docker ps
# Expected: an empty table with CONTAINER ID / IMAGE / ... headers.
#           "Cannot connect to the Docker daemon" means Docker Desktop is not started.
```

## What you get, and what you build

When you clone this repo you get **the course, not the code**:

```
headless-wordpress-fullstack-training/
├── .lessons/               ← the course. 24 modules, 117 lessons. This is all of it.
│   ├── README.md               course index — start here
│   ├── PROJECT.md              end-state architecture of Blame The Tech
│   ├── 01-kickoff/ … 24-ship-it/
│   └── appendix/               glossary, the content-model contract, env reference, …
├── wordpress-headless/     ← EMPTY. You build it. See its README.
├── next-app/               ← EMPTY. You build it. See its README.
├── docs/                       YOURS — the architecture notes, ADRs and runbooks that
│                            lessons ask you to write. Created by Lesson 01.1.
├── .github/                    pull_request_template.md ships; workflows/ you add in M24
├── .vscode/                    editor settings you add in M07 (format on save, PHPCS)
├── .gitignore .nvmrc .editorconfig LICENSE
└── commitlint.config.mjs .husky/   ← you add these in M24 (conventional commits, hooks)
```

Every line of code is inlined in the lessons. There are no `examples/` folders to copy from
and no `solutions/` to peek at — you type it, and each lesson ends with a `## Verification`
block that tells you exactly what correct looks like.

## How to work

1. **Read [.lessons/README.md](.lessons/README.md)** and skim
   [.lessons/PROJECT.md](.lessons/PROJECT.md) for orientation.
2. **Open the module README** (e.g. `.lessons/02-docker-mysql-and-infrastructure/README.md`).
   It states the exact state your repo should be in before you start.
3. **Work the lessons in order.** Each one is: `## Quick Overview` → `## Classic WP Analogy`
   → `## Key Concepts` (read) → `## Task` (build) → `## Verification` (prove it) →
   `## Control Questions` (check yourself).
4. **Run the `## Verification` block before moving on.** It is not optional. In a course with
   no test suite, verification blocks *are* the test suite, and module N+1 assumes module N
   verified clean.
5. **Commit after every lesson**, using conventional commits — `feat(wp): register the
   incident post type`. Module 24 turns this habit into a CI gate, and a per-lesson history
   is the fastest way to bisect your own mistakes.
6. **Stuck?** `.lessons/appendix/06-troubleshooting.md` collects the failure modes that
   actually happen. `appendix/02-classic-to-headless-map.md` translates the WordPress API you
   already know into its headless equivalent.

> **Do not skip ahead to the interesting modules.** The dependency chain is real: Module 14
> cannot work without the plugin from Module 03 and the codegen from Module 10. Module 09 is
> the first module where you see a page in a browser — that is by design, and it arrives
> sooner than it looks.

## Security ground rules

The application handles credentials, user submissions and lead data, so the course holds
itself to production standards from Module 02 onward. Three rules you will see enforced
repeatedly:

- **No secret ever enters git, a Docker image, or a log.** `.env.example` is the only env
  file in the repo, and it contains variable names and `__CHANGE_ME__` placeholders. Real
  values are injected at runtime by the platform's secret store.
- **No token is ever readable by JavaScript.** Sessions are httpOnly cookies. Never
  `localStorage`, never a `NEXT_PUBLIC_` variable, never a query string.
- **Every boundary validates its own input.** Next validates with Zod; WordPress
  re-validates and re-authorises independently, because Next is not a trusted client.

## License

MIT — see [LICENSE](LICENSE).

---

**Start here → [.lessons/README.md](.lessons/README.md)**
