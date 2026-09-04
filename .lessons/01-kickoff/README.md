# Module 01 — Kickoff & the Headless Contract

## Prerequisites

Before starting this module you should have completed:

- Nothing. This is the first module of the course.

What you do need is the toolchain from the root [README.md](../../README.md) — Docker Desktop,
Node 22 (via `nvm`, matching `.nvmrc`), Git and an editor. Lesson 01.3 checks all four with
read-only version commands.

> ⚠️ **Do not scaffold anything yet.** No `create-next-app`, no `docker compose up`, no
> `composer init`. Every one of those happens in a specific later lesson with specific flags,
> and doing it early means Modules 02 and 09 fight you for the rest of the course. If you have
> already run one of them, delete the result before continuing.

## Starting State

**An empty clone.** Everything below ships with the repository; the two application
directories are deliberately empty except for a placeholder README each.

```
headless-wordpress-fullstack-training/
├── .lessons/              the course you are reading
├── docs/                  authoring notes — not learner content
├── .github/               empty until Module 24
├── .gitignore             already written, and two of its rules are lessons
├── .editorconfig  .nvmrc  LICENSE  README.md
├── wordpress-headless/    README.md only — YOU build the rest
└── next-app/              README.md only — YOU build the rest
```

```bash
git status --short
# Expected: no output. A clean clone, nothing staged, nothing modified.
```

## What You'll Learn

- **What "headless" actually means** — WordPress reduced to a content API, and which parts of
  your existing WordPress knowledge survive the change unchanged
- **The headless contract** — the exact boundary between WordPress and Next.js, why it is a
  single `POST /graphql` from the server, and what each side is forbidden to assume
- **Where the request goes** — browser → Next.js → WPGraphQL → MySQL, and which hops are
  cached
- **The costs of decoupling** — preview, menus, forms, plugins and search all get harder; this
  module names the price before you pay it
- **The repository layout** — a two-application repo, why `next-app/` is not in Docker, and
  what the `.gitignore` allowlist pattern is protecting
- **The ADR habit** — recording *why* a decision was made, in the repo, next to the code

## What You'll Build

- A read-through of [PROJECT.md](../PROJECT.md) with the pieces mapped onto modules
- An annotated tour of the repository skeleton and of both `.gitignore` lessons
- Verified tool versions — Docker, Compose, Node 22, npm, Git
- Your first Architecture Decision Record, capturing the headless-over-classic choice in your
  own words
- The two contract documents open in tabs you keep open for the next six modules:
  [appendix 03](../appendix/03-content-model-reference.md) and
  [appendix 04](../appendix/04-env-reference.md)

**Nothing executes in this module.** No container starts, no server boots, and not one line of
code you write here runs. It is the only module in the course like that — the only commands are
read-only version and status checks. After Module 01 the application still does nothing, and
that is the correct end state.

## Lessons

| # | Lesson | New Technology | What You Build |
|---|---|---|---|
| 1 | [What You're Building](01-what-you-are-building.md) | — | The product map: routes, content types, and which module delivers each |
| 2 | [Headless Architecture & the Contract](02-headless-architecture-and-the-contract.md) | — | The request-flow diagram and the written contract between the two apps |
| 3 | [Repository Layout & Toolchain](03-repository-layout-and-toolchain.md) | — | A verified toolchain and ADR 0001 in your own words |

## The Contracts You Are Signing

Four documents govern everything from Module 02 onward. Lessons link to them and never restate
them, which is the only way two copies of a field name stay in agreement.

| Contract | Fixes | First enforced |
|---|---|---|
| [appendix 03 — content model](../appendix/03-content-model-reference.md) | Post types, taxonomies, term slugs, ACF field names, GraphQL names, capabilities | Module 03 |
| [appendix 04 — env & secrets](../appendix/04-env-reference.md) | Every environment variable, which side holds it, which are secret, the `NEXT_PUBLIC_` boundary | Module 02 |
| [PROJECT.md](../PROJECT.md) | The end-state architecture and the local/production topology | Module 02 |
| `.gitignore` | What may never enter git — third-party code, uploads, and any real env file | Module 02 |

> **When a lesson and a contract disagree, the contract wins.** That rule exists because you
> will be typing `downtime_minutes` in PHP in Module 03, querying `downtimeMinutes` in
> Module 05, and generating a TypeScript field from it in Module 10. One source of truth, three
> places it surfaces.

## How to Work

1. **Read the two lessons in order, then work Lesson 01.3.** Lessons 01.1 and 01.2 are
   orientation; 01.3 is the one with a task and a verification block.
2. **Read [PROJECT.md](../PROJECT.md) exactly once, then close it.** It is the end state of 24
   modules. Treating it as a to-do list on day one is the single most common way to stall.
3. **Run the Verification block** at the end of Lesson 01.3 even though nothing is running yet.
   A wrong Node or Docker version discovered now costs five minutes; discovered in Module 09 it
   costs an afternoon.
4. **Commit.** `git add -A && git commit -m "docs: complete module 01 kickoff"` — a per-lesson
   history is the fastest way to bisect your own mistakes, and Module 24 turns this habit into
   a CI gate.
