---
title: 'Repository Layout & Toolchain'
module: 1
lesson: 3
teaches: [monorepo-layout, toolchain-versions, adr-habit, gitignore-allowlist]
produces: []
requires: [1.1]
---

# Lesson 01.3 — Repository Layout & Toolchain

## Quick Overview

This repository holds two applications that deploy to two different platforms and share
nothing but a contract: `wordpress-headless/` goes to Fly.io as a Docker image,
`next-app/` goes to Vercel as a Node runtime. Keeping them in one repo is a deliberate
trade — one clone, one `git log`, one pull request when a schema change and its consumer change
together — paid for with a slightly awkward CI setup that Module 24 untangles. This lesson
walks the skeleton, explains why `next-app/` runs on the host while everything else runs in
Compose, and reads the two `.gitignore` rules that are themselves lessons.

Then you verify the toolchain and write your first Architecture Decision Record. An ADR is a
short dated file that says what was decided, what the alternatives were, and what the decision
costs — the last part being the one everybody skips and the only one that helps a future
reader. You will write ADR 0001 in your own words, recording the headless-over-classic choice
from Lesson 01.2, including its price. Nothing in this lesson starts a process: the commands
are `--version` checks and `git check-ignore`, and they are the last commands you run before
Module 02 boots the stack for real.

By the end of this lesson you will have:

- Verified versions of Docker, Docker Compose, Node 22, npm and Git
- An annotated understanding of the repository skeleton and of both application placeholders
- A written explanation of the `.gitignore` allowlist pattern — ignore the directory, then
  re-include your own plugins with `!` — and why the negation must come second
- Confirmation that `wordpress-headless/.env` and `next-app/.env.local` are already ignored,
  before either file exists
- ADR 0001 in your own words, with an explicit "what this costs us" section

## Classic WP Analogy

Your Classic WordPress repository was almost certainly one of two shapes. Either you committed
`wp-content/` — or the whole of WordPress — and deployed with SFTP or a Git push to a host that
runs `wp-content` in place; or you kept a child theme and a plugin in git and installed
everything else through wp-admin. Both shapes share an assumption: the deployable artifact
*is* the working directory, and the machine that serves the site is the machine you edit files
on. That assumption is what MAMP, `wp-admin` plugin installs and "just FTP the fix" all rest on.

This repository breaks that assumption on purpose. WordPress core is not in git — it comes from
the `wordpress:6.8-php8.3-apache` image. Third-party plugins are not in git — they are
installed by a pinned bootstrap command. `wp-config.php` is not in git — it is generated from
environment variables when the container boots. What *is* in git is exactly the code you wrote,
plus the declarative description of the environment that runs it. The ADR habit is the same
move applied to reasoning: the decision itself becomes a versioned file instead of a memory.

**Where the analogy breaks down:** in the Classic setup you could always fix production by
editing a file on the server, and that escape hatch quietly shaped how you worked. Here it is
gone by construction — Module 24 sets `DISALLOW_FILE_EDIT` and `DISALLOW_FILE_MODS` to `true`,
and the container filesystem is thrown away on every deploy. Anything not reproducible from the
repository does not survive the next release. That is a real loss of convenience, and the thing
you get for it is that "works on my machine" becomes a statement about a pinned image rather
than a statement about your laptop.

---

## Key Concepts

### 1. Two applications, one repository

Here is the repository exactly as it ships. Every directory is annotated with who owns it and
when it fills up.

```
headless-wordpress-fullstack-training/
├── .lessons/                  THE COURSE. Ships complete. You never edit it.
│   ├── README.md                  the index — 24 modules, 117 lessons
│   ├── PROJECT.md                 end-state architecture (read once, then close)
│   ├── 01-kickoff/ … 24-ship-it/  the modules
│   └── appendix/                  the four contracts you keep in a second tab
├── docs/                      YOURS. Lessons ask you to write architecture.md,
│   └── adr/                   content-model.md, api-contract.md and more —
│                              starting with adr/0001-headless-split.md below.
├── wordpress-headless/        YOU BUILD IT. Currently: README.md only.
│                              → a Docker image → Fly.io          (Module 24)
├── next-app/                  YOU BUILD IT. Currently: README.md only.
│                              → a Node 22 build → Vercel         (Module 24)
├── .github/                   pull_request_template.md ships;
│                              workflows/ arrives in Module 24.
├── .gitignore                 ALREADY WRITTEN — two of its rules are lessons
│                              in themselves. Key Concepts 4 and 5.
├── .nvmrc                     the Node version. `nvm use` reads it.
└── .editorconfig  LICENSE  README.md
```

Two application directories, two deployment targets, two runtimes, one `git log`:

| Directory | What deploys from it | Target platform | Runtime | Built by |
|---|---|---|---|---|
| `wordpress-headless/` | a Docker image | Fly.io (Railway taught alongside) | PHP 8.3 + Apache in a container | Modules 02–06, 13, 15, 17–18, 20, 23–24 |
| `next-app/` | a Node build output | Vercel | Node 22 on the platform's serverless/edge runtime | Modules 07–24 |
| `.lessons/` | nothing | — | — | ships complete |
| `docs/` | nothing | — | — | you, one file per decision |
| `.github/` | nothing (it *is* the CI) | GitHub Actions | Ubuntu runners | Module 24 |

The two applications share exactly one artifact: `wordpress-headless/schema.graphql`, the
committed GraphQL contract that Module 06 generates and Module 10's codegen reads across the
directory boundary with a relative path. That file is the whole coupling — everything else each
side knows about the other is an environment variable.

> **Note where `schema.graphql` lives.** It is in `wordpress-headless/`, not `next-app/`,
> because WordPress *owns* the schema — it is produced there by
> `wp graphql generate-static-schema` in Module 06. `next-app/codegen.ts` reaches across to
> read it. Generated TypeScript in `next-app/src/gql/` is committed too, which means no CI job
> ever needs a running WordPress or a database credential.

### 2. Why one repository and not two

This is a real decision with a real cost, so it gets a real comparison.

| Concern | One repo (this course) | Two repos + a published schema package |
|---|---|---|
| Cloning to start work | one clone | two clones, kept in sync by hand |
| A schema change and its consumer | **one pull request, reviewed together** | two PRs, merged in the right order, or you ship a break |
| `git log` / `git bisect` | one timeline across both apps | two timelines you correlate by timestamp |
| Schema distribution | a relative path to a committed file | publish, version, `npm install`, wait for the registry |
| CI | one workflow that must not run everything on every change | naturally scoped per repo |
| Independent release cadence | awkward — you tag the whole repo | clean |
| Team ownership boundaries | fuzzy — both teams see both trees | enforced by access control |
| **Verdict for this course** | **✅ chosen.** One learner, one timeline, a schema that changes weekly | ❌ correct at 15+ engineers on two teams with separate on-call |

The cost, stated plainly: CI has to know which paths matter. A change to a PHP file must not
rebuild the Next bundle, and a change to a React component must not run PHPStan. Module 24
fixes this with GitHub Actions `paths:` filters and per-app jobs — roughly thirty lines of YAML,
which at this scale is cheap.

The two-repo answer becomes right the moment the schema stops changing weekly and the two sides
get separate release cadences and separate on-call rotations. You will know when you cross that
line, because coordinating merges will start to hurt more than the CI filters do.

### 3. Why `next-app/` is not in Docker

The obvious instinct is to containerise both applications for symmetry. This course
deliberately does not, and [PROJECT.md](../PROJECT.md) states the reasoning: you edit
TypeScript constantly, and Next's hot reload through a bind mount on macOS is slow and
unreliable. WordPress is what actually benefits from containerisation — a pinned PHP version,
the right extensions compiled in, and a real MySQL 8 instead of whatever your laptop happens
to have.

| Question | `wordpress-headless/` | `next-app/` |
|---|---|---|
| Does the runtime version matter? | yes — PHP 8.3, specific extensions, MySQL 8 | yes, but `.nvmrc` + `nvm` already pins it |
| How often do you edit its files? | occasionally (plugin PHP) | constantly, with a watcher running |
| Cost of a bind mount on macOS | acceptable — three directories | severe — `node_modules` and `.next` are tens of thousands of small files |
| Is the local runtime the production runtime? | yes, literally the same image (Module 24) | no — Vercel's runtime is not something you run locally anyway |
| **Verdict** | **✅ containerise** | **✅ run on the host with `npm run dev`** |

That decision has a second-order consequence, and planting it here is half the reason this
Key Concept exists. Because Next runs on the **host** and WordPress runs in a **container**,
the two are in different network namespaces:

```
┌─ YOUR HOST ────────────────────────────────────────────────────────────┐
│                                                                       │
│   next-app       `npm run dev`         :3000                          │
│      ▲                                                                │
│      │  WordPress reaches Next at http://host.docker.internal:3000    │
│      │  NEVER at localhost:3000 — inside a container, localhost       │
│      │  is that container.                                            │
│   ┌──┴──────────────────────────────────────────────────────┐         │
│   │  docker compose   project: btt   network: btt-net       │         │
│   │   wordpress :8080 ──▶ db :3306    adminer :8081         │         │
│   │        │                          mailpit :8025 / :1025 │         │
│   │        └── inside here, the database host is `db:3306`  │         │
│   └─────────────────────────────────────────────────────────┘         │
│   Browser talks to :3000, :8080, :8081 and :8025 — all on the host    │
└───────────────────────────────────────────────────────────────────────┘
```

You will not use `host.docker.internal` until Module 18's revalidation webhook, but Lesson 02.2
adds the `extra_hosts` entry that makes it work on Linux — and knowing *why* it is there is the
difference between a five-minute fix and an afternoon.

> **Module 24 does containerise Next — once, on purpose, and not for development.** It adds an
> optional Compose overlay that runs `next-app` in a container purely to prove the production
> image builds and boots. You never develop against it. Building an image you do not deploy
> from is a smoke test, not a workflow.

### 4. The `.gitignore` allowlist pattern

Open `.gitignore` in your editor now. It is already written, and two of its sections are
labelled `LESSON` because they teach something non-obvious. This is the first.

```
# .gitignore lines 46–48 (already in your clone — read it, do not rewrite it)
wordpress-headless/wp-content/plugins/*
!wordpress-headless/wp-content/plugins/blame-the-tech-core/
!wordpress-headless/wp-content/plugins/blame-the-tech-blocks/
```

The problem it solves: `wp-content/plugins/` will hold WPGraphQL, ACF, Yoast, Polylang and
half a dozen other third-party plugins that must **never** enter git — they are somebody else's
code, they are installed by a pinned command, and committing them makes every dependency
upgrade a 40,000-line diff. But the same directory also holds `blame-the-tech-core` and
`blame-the-tech-blocks`, which are yours and must be committed.

So: ignore the whole directory, then re-include your own two by name. Two rules make this work,
and both are easy to get backwards.

| Rule | Why | What breaks if you get it wrong |
|---|---|---|
| The negation comes **after** the broad ignore | git evaluates patterns top to bottom and **the last matching pattern wins** | Reversed, the broad ignore wins. Your plugins vanish from `git status` — silently, with no error, and you discover it when a colleague clones and the plugin is missing |
| The pattern is `plugins/*`, not `plugins/` | `plugins/` excludes the *directory*, and **git cannot re-include a path inside an excluded directory** | With `plugins/`, the `!` lines have no effect whatsoever. git never descends into the directory, so it never evaluates them |
| The negations name **directories** and end in `/` | makes the intent explicit and matches everything beneath | — |

That middle row is the one that catches everyone, including people who have used git for a
decade. It is documented in `gitignore(5)`: *"It is not possible to re-include a file if a
parent directory of that file is excluded."* The trailing `*` is what keeps the directory
itself un-excluded so git will look inside it.

> **Verify, do not assume.** `git check-ignore -v <path>` prints the file, line number and
> pattern that decided a path's fate, and prints nothing at all when the path is not ignored.
> It is the only way to be sure, and Step 3 makes you run it three times.

### 5. The `!.env.example` rule

The second labelled lesson in the same file, and the one with a security consequence.

```
# .gitignore lines 72–74 (already in your clone — read it, do not rewrite it)
.env
.env.*
!.env.example
```

Every real environment file in the repository is ignored, at any depth —
`wordpress-headless/.env`, `next-app/.env.local`, `.env.production`, all of them. Then exactly
one file is re-included: `.env.example`, a tracked, reviewable list of **what must be
supplied**, containing variable *names* plus `__CHANGE_ME__` placeholders. Never a value. The
same last-match-wins ordering from Key Concept 4 applies, for the same reason.

> **Not even a fake-looking value.** A plausible-looking placeholder gets copied into
> production by somebody in a hurry, and now a value that was never meant to be a secret is
> protecting one. The five rules governing all of this are in
> [appendix 04 §1](../appendix/04-env-reference.md#1-the-five-rules) — read them before Lesson
> 02.5.

The ordering rule is the part to internalise, and it is why this appears in Module 01 rather
than Module 02: **set up the ignore rule before the secret exists.** Not "check afterwards".
Not "I will remember". Before. A secret committed once is compromised even after you delete it,
because it lives in the object database, in every reflog, and in every clone anyone has pulled.
`git rm` removes it from the working tree and from the next commit; it does not remove it from
history. The remedy is **rotation**, not deletion — and rotating a production database password
at 6pm on a Friday is a genuinely bad evening.

That is why Step 3 runs `git check-ignore` against files that do not exist yet. The check is
free, it is read-only, and it is the last cheap moment to catch a misordered `.gitignore`.

### 6. What is deliberately not in git, and where it comes from instead

A Classic WordPress repository usually contains WordPress. This one does not contain any of
the following, and each absence has a named replacement:

| Not committed | Where it comes from instead | Introduced |
|---|---|---|
| WordPress core | the `wordpress:6.8-php8.3-apache` image | Lesson 02.1 |
| Third-party plugins | a pinned bootstrap: `wp plugin install <slug> --version=x.y.z --activate` | Module 03 |
| `wordpress-headless/wp-config.php` | generated from environment variables at container boot | Lesson 02.4 |
| `wp-content/uploads/` | the `btt-uploads` named volume locally; R2/S3 in production | Lessons 02.2, Module 24 |
| `wp-content/plugins/blame-the-tech-blocks/build/` | `npm run build` in the blocks plugin | Module 13 |
| `vendor/` | `composer install` through a `composer` service | Module 03 |
| `node_modules/`, `.next/` | `npm install`, `npm run build` | Modules 07, 09 |
| `.env`, `.env.local` | you generate them; only `.env.example` is tracked | Lesson 02.5 |
| `ANSWERS.md` | nowhere — it is ignored so a teacher's answer key never leaks into a learner's clone | — |

What *is* in git, then, is exactly two things: **the code you wrote, and a declarative
description of the environment that runs it.** `docker-compose.yml`, `.nvmrc` and
`composer.json` are all the second category. Nothing in the repository is a snapshot of a
machine's state; everything is an instruction for producing that state — which is what makes
"works on my machine" stop being a sentence anybody says, and what makes the escape hatch from
your Classic workflow (SFTP a fixed file to the server) impossible by construction.

### 7. Conventional commits

Every commit message in this course follows one grammar:

```
type(scope): subject

  feat(wp): register the incident post type
  fix(graphql): guard createIncident against anonymous callers
  chore(deps): bump next to 15.1.2
  feat(graphql)!: rename Incident.scapegoats to Incident.blamedOn
  └──┬─┘ └──┬──┘│ └──────────────────┬───────────────────────┘
     │       │  │                    └── imperative, lower case, no full stop
     │       │  └── `!` marks a breaking change
     │       └── which part of the system
     └── what kind of change
```

The vocabulary is fixed by [appendix 07 §9](../appendix/07-command-reference.md#9-git):

| Field | Allowed values |
|---|---|
| `type` | `feat` `fix` `docs` `style` `refactor` `test` `chore` `ci` `perf` |
| `scope` | `wp` `block` `graphql` `web` `auth` `i18n` `e2e` `ci` `docker` `seed` `deps` |

Messages that pass review, and messages that do not:

| Message | Verdict | Why |
|---|---|---|
| `feat(wp): register the incident post type` | ✅ | type, scope, imperative subject |
| `fix(auth): send btt_rt only on /api/auth` | ✅ | says what changed, not which file |
| `docs(adr): record the headless split as ADR 0001` | ✅ | — |
| `feat(graphql)!: rename Incident.scapegoats to blamedOn` | ✅ | `!` flags the consumer break |
| `updates` / `fix bug` / `WIP` | ❌ | no type, no scope, no information |
| `feat(wp): Added the incident post type.` | ❌ | past tense and a full stop; the convention is imperative |
| `feat: rename Incident.scapegoats to blamedOn` | ❌ | a breaking rename with no `!` — CI will not warn a consumer |

What the discipline buys you, concretely:

- **Module 24 turns it into a gate.** `commitlint` plus a Husky `commit-msg` hook rejects a
  non-conforming message locally, and a CI job rejects it on the pull request.
- **The changelog generates itself** from `feat`/`fix`/`!` entries. You never write one.
- **`git bisect` becomes usable.** Commit after every lesson and a regression is a handful of
  bisect steps away from the exact lesson that introduced it — which, in a course with 117
  lessons and no test suite until Module 12, is the closest thing you have to a safety net.

### 8. The ADR habit

An **Architecture Decision Record** is a short, dated, numbered markdown file that records one
decision: the context that forced it, what was decided, what else was considered, and what the
decision costs. It lives in `docs/adr/`, in the repository, next to the code it governs.

Two conventions make ADRs work, and both are counterintuitive. **Numbers are permanent and
sequential** — `0001`, `0002`, `0003`, never reused and never renumbered, because the number is
how other documents cite the decision. And **an accepted ADR is never edited**: if the decision
changes you write a *new* ADR that supersedes it and set the old one's status to
`Superseded by ADR 0007`. The value of the archive is that it shows what you believed at the
time, and rewriting it destroys exactly the information a future reader needs.

The section everybody skips is **Consequences**, and it is the only section that reliably helps
a future reader. Six months later nobody needs to be told what was decided — that is visible in
the code. What they need is the sentence "we knew preview would break and accepted it, and here
is the module that fixed it", so they do not spend a day re-litigating a decision you already
thought about. **Write the negative consequences. All of them.**

| Where the "why" ends up | Discoverable from a clone | Survives a tool migration | Reviewed | Dated | Correlated with the code |
|---|---|---|---|---|---|
| An ADR in `docs/adr/` | ✅ | ✅ | ✅ in the PR | ✅ | ✅ same commit |
| A wiki / Confluence page | ❌ needs a URL and an account | ❌ dies with the tool | rarely | sometimes | ❌ drifts immediately |
| A long commit message | ✅ | ✅ | ✅ | ✅ | ✅ |
| Nobody's memory | ❌ | ❌ | ❌ | ❌ | ❌ |

The commit-message row is genuinely close, and if you only ever record small decisions that way
you are doing fine. An ADR wins for the big ones because it is **findable by browsing** —
`ls docs/adr/` is a table of contents for how the system got this shape, and `git log` is not.

You will write two ADRs in the next two lessons: `0001` here, for the headless split itself,
and `0002` in Lesson 02.1, for containerising WordPress but not Next.

---

## Task

Everything below is read-only except the two files you write yourself. **Module 01 is the only
module in this course where nothing executes** — no container starts, no server boots, and not
one line of code you write here runs. That is worth stating plainly because it is unusual.

It does *not* mean there are no commands. The `--version` checks, `git status` and
`git check-ignore` in this lesson are real commands that really run against your real machine
and your real repository. They just do not start anything.

### Step 1: Verify the toolchain

Run these from the repository root, in order. Each one answers a question that would otherwise
surface as a confusing failure several modules from now.

```bash
# Docker CLI is installed
docker --version
# Expected: Docker version 27.x.x (or newer), build ...

# Compose v2 is available as a `docker` subcommand
docker compose version
# Expected: Docker Compose version v2.x.x

# The Docker DAEMON is actually running — not just the CLI installed
docker ps
# Expected: a header row: CONTAINER ID   IMAGE   COMMAND   ...
#           "Cannot connect to the Docker daemon" = Docker Desktop is not started

# Node, pinned by .nvmrc
cat .nvmrc
# Expected: 22

nvm install && nvm use
node -v
# Expected: v22.x.x

npm -v
# Expected: 10.x.x or newer

git --version
# Expected: git version 2.3x.x or newer
```

**Verify §1:**

- [ ] `node -v` prints `v22.` — **not** `v20.`, **not** `v23.`. Next.js 15, the block build and
      every test runner in this course are exercised against 22 LTS.
- [ ] `docker compose version` prints `v2.` If your machine only has the hyphenated
      `docker-compose` binary, that is Compose v1 and it is end-of-life. This course uses the
      `docker compose` subcommand exclusively — install Docker Desktop or the
      `docker-compose-plugin` package.
- [ ] `docker ps` printed a table header, not a connection error.
- [ ] `git --version` succeeded and you are inside a git repository (`git status` in Step 3
      confirms the second part).

> **A wrong Node version costs five minutes now and an afternoon in Module 09.** The failure
> mode is not a clean "unsupported version" message — it is a Turbopack crash, or a peer
> dependency that resolves differently, or a test that passes locally and fails in CI. Fix it
> here, where the only cost is one `nvm install`.

### Step 2: Walk the skeleton

```bash
ls -la
# Expected: .lessons  docs  next-app  wordpress-headless  .github
#           .gitignore  .nvmrc  .editorconfig  LICENSE  README.md

ls wordpress-headless/ next-app/
# Expected: README.md under each heading — and nothing else

# Read both placeholder READMEs' "Expected final tree" sections. You are not
# memorising them — they are the answer to "have I drifted?" at the end of
# every module.
sed -n '/^## Expected final tree/,/^## /p' wordpress-headless/README.md | head -60
sed -n '/^## Expected final tree/,/^## /p' next-app/README.md | head -60
```

> ⚠️ **Do not scaffold anything yet.** No `create-next-app`, no `docker compose up`, no
> `composer init`, no `npm init`. Every one of those happens in a specific later lesson with
> specific flags, and doing it early means Modules 02 and 09 fight you for five lessons. If you
> have already run one, delete the result before continuing.

### Step 3: Read the two `.gitignore` lessons, then prove them

Find the two labelled sections:

```bash
grep -n 'LESSON' .gitignore
# Expected: two hits — line 39 (the allowlist pattern) and line 64 (.env.example)

# Read the allowlist block in full, comments included
sed -n '37,62p' .gitignore

# Read the env block in full
sed -n '62,80p' .gitignore
```

Now prove both rules with `git check-ignore -v`. Note that **none of these three files exists
yet** — that is the entire point. `git check-ignore` evaluates patterns against a path, not
against a file on disk, so you can confirm the rule before there is anything to protect.

```bash
# 1. A real WordPress env file — MUST be ignored
git check-ignore -v wordpress-headless/.env
# Expected: .gitignore:72:.env	wordpress-headless/.env

# 2. A real Next env file — MUST be ignored (different pattern, same rule)
git check-ignore -v next-app/.env.local
# Expected: .gitignore:73:.env.*	next-app/.env.local

# 3. The tracked example — MUST NOT be ignored, because of the `!` re-include
git check-ignore -v wordpress-headless/.env.example
echo "exit=$?"
# Expected: NO pattern output, and exit=1
#           exit=1 from check-ignore means "this path is not ignored" — which is
#           correct here and is what makes .env.example committable.

# 4. Your own plugin directory — MUST NOT be ignored, despite plugins/* above it
git check-ignore -v wordpress-headless/wp-content/plugins/blame-the-tech-core/
echo "exit=$?"
# Expected: no output, exit=1 — the `!` on line 47 wins over `plugins/*` on line 46

# 5. Somebody else's plugin — MUST be ignored
git check-ignore -v wordpress-headless/wp-content/plugins/wp-graphql/
# Expected: .gitignore:46:wordpress-headless/wp-content/plugins/*	...wp-graphql/
```

**Verify §3:**

- [ ] Checks 1, 2 and 5 each printed a `.gitignore:<line>:<pattern>` match.
- [ ] Checks 3 and 4 printed **nothing** and exited `1`. The asymmetry is the lesson: the same
      file governs both, and `!` reverses the verdict for exactly the paths you named.
- [ ] You can state, without looking, why line 46 ends in `/*` rather than `/`. If you cannot,
      re-read Key Concept 4 — this is the one that silently loses your work.

### Step 4: Write ADR 0001

```bash
mkdir -p docs/adr
```

Here is the template. **Context and one alternative are filled in for you; everything marked
`TODO` is yours to write in your own words.** Copying the filled sections is fine — the
`TODO`s are not optional, and the verification below checks for them.

```markdown
<!-- docs/adr/0001-headless-split.md -->
# ADR 0001 — Split WordPress and the front end

- **Status:** Accepted
- **Date:** 2026-01-15   <!-- TODO: today's date, ISO 8601 -->
- **Deciders:** you
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

TODO: state the decision in two or three sentences, in your own words. Name both sides of the
boundary, name the single channel that crosses it, and say who owns authorisation.

## Alternatives Considered

| Alternative | How it would work | Why not |
|---|---|---|
| Stay Classic: child theme + jQuery islands | `single-incident.php` renders the page; a page cache in front; progressive enhancement with jQuery for the filters | Fastest to ship and genuinely adequate for the content, but no type system, no component tests, no per-route revalidation, and no path to the front-end skills this project exists to build |
| Headless with WPGraphQL + Next.js App Router | TODO: describe it | TODO: this is the one you chose — say what you get and what you pay |
| Headless with the WP REST API + a static site generator | TODO: describe it | TODO: think about over-fetching, the number of round trips, and what happens when an editor publishes at 3pm |

## Consequences

### Positive

- TODO: at least three.

### Negative

TODO: at least **three**, drawn from the cost table in Lesson 01.2. Name the module that pays
each one back, or say plainly that it is never paid back.

- TODO
- TODO
- TODO

### Neutral

- TODO: at least one — a genuine change that is not obviously better or worse.

## Related

- Lesson 01.2 — the contract and the cost table this ADR draws on
- ADR 0002 — containerise WordPress but not Next (Lesson 02.1)
```

Fill in every `TODO` before continuing. Writing the negatives is the exercise: if you can name
three things this architecture makes worse, you understand the decision. If you cannot, go back
to Lesson 01.2 and re-read the costs.

**Verify §4:**

- [ ] `docs/adr/0001-headless-split.md` exists, with a `**Status:** Accepted` line and a
      `**Date:**` line carrying a real ISO 8601 date, not the placeholder.
- [ ] The Alternatives table has at least **three** data rows.
- [ ] The Negative consequences list has at least **three** bullets.
- [ ] No `TODO` remains anywhere in the file.

### Step 5: Commit

```bash
git add docs/adr/0001-headless-split.md
git commit -m "docs(adr): record the headless split as ADR 0001"
git log --oneline -1
# Expected: <sha> docs(adr): record the headless split as ADR 0001
```

That message is a conventional commit: type `docs`, scope `adr`, imperative subject, no full
stop. Module 24 adds the `commitlint` hook that would have rejected `added adr`.

---

## Verification

```bash
# 1. Docker CLI and daemon
docker --version
# Expected: Docker version 27.x.x (or newer)

docker compose version
# Expected: Docker Compose version v2.x.x

docker ps >/dev/null 2>&1 && echo "daemon: up" || echo "daemon: DOWN"
# Expected: daemon: up

# 2. Node matches .nvmrc, and npm and git exist
node -v
# Expected: v22.x.x

npm -v && git --version
# Expected: two version lines, npm 10.x or newer

# 3. Neither application has been scaffolded early
ls wordpress-headless/ next-app/
# Expected: README.md under each heading — and nothing else

# 4. Real env files ARE ignored, before either exists
git check-ignore -v wordpress-headless/.env
# Expected: .gitignore:72:.env	wordpress-headless/.env

git check-ignore -v next-app/.env.local
# Expected: .gitignore:73:.env.*	next-app/.env.local

# 5. THE NEGATIVE — .env.example must NOT be ignored, or it can never be committed
git check-ignore wordpress-headless/.env.example; echo "exit=$?"
# Expected: no output, and exit=1
#           exit=1 means "not ignored", which is correct: the `!.env.example` line
#           re-includes it. If this prints a MATCH, the `!` line is missing or sits
#           ABOVE the broad ignore — and Lesson 02.5 will silently fail to commit
#           the one env file that is supposed to be in git.

# 6. The allowlist pattern works in both directions
git check-ignore wordpress-headless/wp-content/plugins/blame-the-tech-core/; echo "ours exit=$?"
# Expected: no output, ours exit=1   (re-included by the `!` on line 47)

git check-ignore -v wordpress-headless/wp-content/plugins/wp-graphql/ >/dev/null; echo "theirs exit=$?"
# Expected: theirs exit=0            (ignored by plugins/* on line 46)

# 7. ADR 0001 exists and is actually finished
test -f docs/adr/0001-headless-split.md && echo "adr: present"
# Expected: adr: present

grep -c '^| ' docs/adr/0001-headless-split.md
# Expected: 4 or more — the Alternatives table header plus at least three alternative rows
#           (the |---|---| separator line does not match this pattern)

grep -c 'TODO' docs/adr/0001-headless-split.md
# Expected: 0. Any other number means you left the template unfinished.

grep -q '^- \*\*Status:\*\* Accepted' docs/adr/0001-headless-split.md && echo "status: ok"
# Expected: status: ok

# 8. Nothing unexpected is staged or modified
git status --short
# Expected: no output if you committed in Step 5; otherwise only
#           ?? docs/adr/0001-headless-split.md
```

Check 5 is the one people get wrong, and it fails in the most expensive direction: a
misordered `.gitignore` does not error, it just quietly refuses to track `.env.example`. You
find out three lessons later when a colleague clones the repo and has no idea which variables
to set.

## Control Questions

1. `.gitignore` line 46 is `wordpress-headless/wp-content/plugins/*`, with a `*`. Explain what
   would break if it were `wordpress-headless/wp-content/plugins/` instead, and why the two `!`
   lines below it would stop having any effect at all.
2. `wp-config.php` and `.env` are both gitignored, but for different reasons and with different
   replacements. Name each reason and each replacement, and say which of the two would still be
   gitignored if the project moved to a single-server FTP deploy.
3. This repository holds two applications that deploy to two platforms. Name the single file
   that couples them, say which directory it lives in and why *that* directory, and describe
   what would have to change if the two applications moved to separate repositories.
4. You commit a real `AUTH_KEY` value to `.env.example`, notice within a minute, and run
   `git rm --cached` plus a new commit. Explain why the value is still compromised and what the
   actual remediation is.
5. Six months from now someone asks why the front end is not just a WordPress theme. Which
   section of ADR 0001 answers that usefully, which section they will actually read first, and
   what you would have to have written for the answer to be worth anything.

## Learn More

- [`gitignore(5)` — the pattern format](https://git-scm.com/docs/gitignore) — the authoritative
  statement of last-match-wins and of the "cannot re-include inside an excluded directory" rule
  from Key Concept 4
- [`git check-ignore`](https://git-scm.com/docs/git-check-ignore) — why the `-v` flag prints the
  deciding line number, and what a `1` exit status actually means
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) — the full spec,
  including the `!` marker and the footer syntax Module 24's changelog generator reads
- [adr.github.io](https://adr.github.io/) — a survey of ADR formats; read it to see how little
  ceremony an ADR actually needs before you are tempted to add more
- [joelparkerhenderson/architecture-decision-record](https://github.com/joelparkerhenderson/architecture-decision-record)
  — dozens of real templates; the "decision record" and "MADR" variants are the two worth
  comparing against Step 4's
- [The Twelve-Factor App — Config](https://12factor.net/config) — the source of the "config in
  the environment, never in the code" rule that `.env` plus `getenv()` implements in Lesson 02.4
- [nvm](https://github.com/nvm-sh/nvm) — how `.nvmrc` is discovered, and the shell hook that
  runs `nvm use` automatically when you `cd` into the repository
