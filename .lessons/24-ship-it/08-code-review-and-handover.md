---
title: 'Code Review & Handover'
module: 24
lesson: 8
teaches: [pr-template, headless-review-checklist, conventional-commits, husky, lint-staged, ai-code-review, advisory-gates, handover]
produces: ['.github/pull_request_template.md', 'docs/code-review-checklist.md', '.github/workflows/ai-review.yml', 'commitlint.config.mjs', 'docs/going-further.md']
requires: [24.7, 24.5]
---

# Lesson 24.8 — Code Review & Handover

## Quick Overview

The gates in Lesson 24.5 catch everything a machine can decide. Code review is for everything
else — and in a headless WordPress build, "everything else" has a specific and learnable shape.
A reviewer who knows React and a reviewer who knows WordPress will each miss half of it, so this
lesson writes the checklist down: **fourteen points, all of them mistakes that pass every
automated check**, all of them things this course has actually taught you to avoid. An
unauthenticated custom mutation is the sharpest one, because **WPGraphQL does not authenticate
your mutations for you** — `register_graphql_mutation` will happily expose a resolver that writes
to the database for anonymous callers, and nothing warns you.

Around the checklist go the mechanics: a pull request template that asks for the things reviewers
always end up asking for, conventional commits enforced by commitlint through a Husky hook, and
lint-staged so formatting is fixed before the commit rather than argued about in the diff.

Then the AI review gate, framed carefully because the framing is the lesson. It is **advisory,
not blocking — except for two findings: "secret detected" and "unauthenticated mutation". And
both of those are also caught deterministically**, by gitleaks and by an integration test, so the
AI is a second net and never the only net. It is grounded in the committed checklist rather than
general good taste, scoped to the diff, and triggered by `pull_request` and never
`pull_request_target` — which would run untrusted code with repository secrets. And you are asked
to do one thing most teams never do: **measure its precision on ten real pull requests and write
the number down.** A reviewer that is right 30% of the time is training people to dismiss review
comments, and you cannot know which one you have without counting.

By the end of this lesson you will have:

- `.github/pull_request_template.md` — what changed, why, how it was verified, what was not covered
- `docs/code-review-checklist.md` — the 14 points, each with the failure it prevents
- Conventional commits enforced by `commitlint.config.mjs` plus Husky, `lint-staged` on commit,
  and `.github/workflows/ai-review.yml` — diff-scoped, checklist-grounded, minimal
  `permissions:`, advisory except the two blocking findings
- A measured precision figure for the AI reviewer over ten real pull requests, recorded
- One full pull request of your own work, reviewed against the checklist, with the findings fixed
- `docs/going-further.md` — the backlog: search, comments, a mobile app on the same API, WPGraphQL
  Smart Cache at the edge, a design-system package, multisite

The fourteen review points, each a real mistake that passes every gate in Lesson 24.5:

| # | Look for | Why it passes CI |
|---|---|---|
| 1 | An N+1 GraphQL pattern — a query per list item | It works; it is just slow, and only under load |
| 2 | An unbounded `first:` on a connection | The seeded dataset is 40 items, production is not |
| 3 | A new query with no `revalidate` and no cache tag | It renders correctly, then never updates |
| 4 | `'use client'` on a file with no interactivity | Nothing breaks; the bundle just grows |
| 5 | A secret behind `NEXT_PUBLIC_` | Builds fine, and is now in every browser |
| 6 | Unescaped WordPress HTML outside `RichText.tsx` | Renders perfectly until the content is hostile |
| 7 | A custom mutation with no capability check | **WPGraphQL does not auth your mutations for you** |
| 8 | A `meta_query` on an unindexed meta key | Fast on 40 rows, a full scan on 40,000 |
| 9 | Over-fetching — fields queried and never rendered | Valid GraphQL, wasted bytes, wider cache surface |
| 10 | A JWT in `localStorage` | Works; readable by any injected script |
| 11 | A block's `save()` markup changed with no `deprecated` entry | Existing posts silently become invalid |
| 12 | A user-visible string literal instead of a message key | Correct in English, missing in `uk` and `de` |
| 13 | `$wpdb` string interpolation instead of `prepare()` | Passes tests, is a SQL injection |
| 14 | A new content type the seeder does not create | Green suite, because nothing tests the new thing |

## Classic WP Analogy

You have been reviewed and you have reviewed, and the WordPress-flavoured version of this
checklist is one you could recite: escaping on output, sanitising on input, nonces on forms,
`prepare()` on queries, text domains on strings, no queries in a loop, no direct `$_POST` access,
prefixed function names. Same instinct, same rhythm — a written list of the mistakes that keep
happening.

| Classic WordPress review | Headless review |
|---|---|
| "Escape that output" | Points 6 and 13 — plus React's default escaping doing most of it |
| "Use `prepare()`" | Point 13, unchanged, still the same reflex |
| "Add a nonce" | Server Action origin checks and the auth matrix from Lesson 15.5 |
| "That's a query in a loop" | Point 1 — an N+1 that now crosses a network boundary |
| "Wrap that string in `__()`" | Point 12, with the catalogue from Module 20 |
| "This will break on 10,000 posts" | Points 2 and 8, unchanged |
| — | Points 3, 4, 5, 10, 11 — no Classic analogue at all |

Half the list transfers directly, which should be reassuring: a good WordPress reviewer is
already most of a good headless reviewer.

The other half is where the analogy breaks, and the interesting thing is *how* it breaks. The new
points — a missing cache tag, an unnecessary client boundary, a secret behind `NEXT_PUBLIC_`, a
token in `localStorage`, a `save()` change without a `deprecated` entry — share a property that
Classic WordPress mistakes mostly did not have: **they are invisible at review time and invisible
at runtime.** A missing `esc_html()` shows up as broken markup on a page. A missing
`revalidateTag` shows up as a page that is correct today and stale in a week, with no error
anywhere and nothing in a log. A `'use client'` that should not be there shows up as 30 KB
nobody attributes to it. In a monolith the feedback loop was short and local; in a decoupled,
cached, compiled system, the consequence of a mistake surfaces far from its cause, days later, to
someone else.

That is the argument for a written checklist rather than a reviewer's judgement, and it is the
same argument that runs through this whole module: when a mistake cannot announce itself, you have
to go looking for it on purpose. The AI reviewer is an extra pair of eyes on exactly that class of
finding — and it is advisory, because a second net that people trust as the only net is worse than
no net at all.

---

## Key Concepts

<!-- TODO: Phase B -->

---

## Task

<!-- TODO: Phase B -->

---

## Verification

<!-- TODO: Phase B -->

## Control Questions

<!-- TODO: Phase B -->

## Learn More

<!-- TODO: Phase B -->
