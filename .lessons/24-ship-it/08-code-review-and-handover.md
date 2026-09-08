---
title: 'Code Review & Handover'
module: 24
lesson: 8
teaches: [pr-template, headless-review-checklist, conventional-commits, husky, lint-staged, ai-code-review, advisory-gates, handover]
produces: ['.github/pull_request_template.md', 'docs/code-review-checklist.md', '.github/workflows/ai-review.yml', 'commitlint.config.mjs', 'package.json', 'docs/going-further.md']
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
| 2 | An unbounded `first:` on a connection | The seeded dataset is 55 incidents, production is not |
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

### 1. What is left for a human after eighteen automated gates

[Lesson 24.5](05-quality-gates-and-branch-protection.md) assembled eighteen gates. Between them
they decide type safety, style, coverage on the patch, bundle weight, LCP, axe severity, secrets,
container CVEs, licences and commit format. That is a lot, and it is all of one kind: **questions
with a mechanical answer.**

| A machine can decide | Only a person can decide |
|---|---|
| is this line indented correctly | is this the right abstraction |
| is total bundle weight under 180 KB | is this feature worth 30 KB |
| does this file have a test | does this test assert the thing that matters |
| is `first:` present | is `first: 100` sensible for *this* connection |
| is the type correct | **is the cache tag the one that will actually be invalidated** |

The last row is the shape of the whole checklist. Every one of the fourteen points is a question
where the code is valid, the types check, the tests pass and the answer is still wrong — and
fourteen is a small enough number to write down and use.

### 2. Half of this checklist you already know

The WordPress-flavoured version of a review checklist is one you could recite: escaping on output,
sanitising on input, nonces on forms, `prepare()` on queries, text domains on strings, no queries
in a loop, no direct `$_POST` access, prefixed function names. Seven of the fourteen points are
that list, wearing different clothes.

| Point | Classic instinct | What changed |
|---|---|---|
| 1 — N+1 | "that's a query in a loop" | the loop now crosses a network boundary, so each iteration costs 10 ms rather than 0.2 ms |
| 2 — unbounded `first:` | "this will break on 10,000 posts" | nothing. Identical |
| 6 — unescaped WordPress HTML | "escape that output" | React escapes by default, so the mistake requires typing `dangerouslySetInnerHTML` |
| 8 — unindexed `meta_query` | "that's a full table scan" | nothing. Identical, and Lesson 02.3 taught you to read the `EXPLAIN` |
| 9 — over-fetching | "don't `SELECT *`" | the waste is bytes over the wire *and* a wider cache surface |
| 12 — a hard-coded string | "wrap that in `__()`" | a message key in a catalogue rather than a gettext call |
| 13 — `$wpdb` interpolation | "use `prepare()`" | nothing. Identical, and PHPCS catches most of it |

**A good WordPress reviewer is already most of a good headless reviewer**, and that should be
reassuring rather than deflating. The instincts transfer; the surface changed.

### 3. The other half shares a property Classic mistakes did not have

Points 3, 4, 5, 10 and 11 are the new ones, and the interesting thing is not *that* they are new
but *how* they fail.

| Point | When it becomes visible | To whom |
|---|---|---|
| 3 — no `revalidate`, no cache tag | days later, as content that is correct today and wrong next week | a reader, who assumes the CMS is broken |
| 4 — an unnecessary `'use client'` | never, as 30 KB nobody attributes to it | the bundle budget, eventually, in aggregate |
| 5 — a secret behind `NEXT_PUBLIC_` | possibly never | whoever reads your JavaScript |
| 10 — a JWT in `localStorage` | on the day an injected script reads it | your users |
| 11 — a `save()` change with no `deprecated` | when an editor opens an old post | an editor, who sees "this block contains unexpected content" |

Compare the Classic failures. A missing `esc_html()` shows up as broken markup **on the page**,
immediately, to the developer who wrote it. An unprepared query shows up in a SQL error. A query
in a loop shows up as a page that takes four seconds. Every one announces itself, locally, at the
moment you made the mistake.

```
   MONOLITH                                DECOUPLED · CACHED · COMPILED
   ────────                                ─────────────────────────────
   mistake → reload → symptom              mistake → build → deploy → cache
   same request. same machine.                 → a week → a reader
   same person. seconds.                    different tier. different day.
                                            different person. no error anywhere.
```

**In a monolith the feedback loop was short and local; in a decoupled, cached, compiled system the
consequence surfaces far from its cause, days later, to someone else.** That is the argument for a
*written* checklist rather than a reviewer's judgement, and it is the argument of the whole module:
when a mistake cannot announce itself, somebody has to go looking for it on purpose — and "on
purpose" means a list, not a mood.

### 4. Point 7 is the sharpest one: WPGraphQL does not authenticate your mutations

`register_graphql_mutation()` takes a name, an input shape, an output shape and a resolver. It
does not take a capability. It will happily expose a resolver that writes to your database for an
anonymous caller, and **nothing warns you** — not a notice, not a lint rule, not a type error.

```php
// Illustrative. Valid, deployable, and an unauthenticated write.
register_graphql_mutation( 'deleteIncident', array(
	'inputFields'         => array( 'id' => array( 'type' => 'ID' ) ),
	'outputFields'        => array( 'deleted' => array( 'type' => 'Boolean' ) ),
	'mutateAndGetPayload' => static function ( array $input ): array {
		wp_delete_post( (int) $input['id'], true );   // no capability check
		return array( 'deleted' => true );
	},
) );
```

Contrast the two frameworks' defaults. `register_rest_route()` **errors** if you omit
`permission_callback` — WordPress made "public" a thing you type, which is exactly why
[Lesson 24.6](06-building-and-deploying-wordpress.md)'s health endpoint has a comment beside its
`__return_true`. `register_graphql_mutation()` has no equivalent. The default is open.

[Lesson 06.2](../06-graphql-api-design/02-custom-mutations-and-input-validation.md) built the
guards — `current_user_can()` inside every resolver, plus independent re-validation of every
field — and [Lesson 23.5](../23-testing-deep-dive-and-agentic-qa/05-wp-integration-and-graphql-contract-tests.md)
tests that an anonymous caller is refused. This checklist is where a **reviewer** is told to look,
and the greppable form is short enough to be a habit:

```bash
# Every mutation registration, and every capability check. The counts must match.
grep -rc 'register_graphql_mutation' wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/
grep -rc 'current_user_can'          wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/
```

### 5. The pull request template: four fields, and the fourth is the one that earns its place

What changed. Why. How it was verified. **What was not covered.**

The first three appear on every template on the internet. The fourth is rare and it is the one
that changes reviews, because it moves the author from advocate to witness. A pull request
description is an argument for merging; "what was not covered" is the one field that asks the
author to argue against themselves, and the answers are the specific things a reviewer would
otherwise have to guess at:

| A real answer in that field | What the reviewer now knows |
|---|---|
| "Not tested with Polylang inactive" | the exact configuration to try |
| "The `de` translation is missing for two new keys" | this cannot ship before Module 20's catalogue is updated |
| "No E2E — the flow needs a logged-in editor and I could not seed one" | there is a testing gap, and where |
| "Nothing" | either the change is tiny, or the author has not thought about it |

The last row is why the field is worth having even when it is answered badly. "Nothing" on a
300-line diff is itself a review finding.

### 6. The template already exists in this repository, and that is the exercise

`.github/pull_request_template.md` **ships with the course.** Its own leading comment says why:
it is the reference version of this lesson's deliverable, present so that any pull request opened
against the course repository gets a template, and you are told to **write your own first from
the fourteen points, then diff.**

Take that instruction seriously: the diff is the lesson, and a lesson you skip by copying is a
lesson you did not have. Two gaps are worth predicting before you look. **The reference has no
"what was not covered" field** — it has "What & why", a Tests checklist and a Rollback note, three
of the four. And **the reference is organised by *surface*** (Schema, Data & caching, Security,
Performance, Tests) while the checklist is organised by *mistake*: surfaces map to the files in a
diff, which is how a reviewer reads; mistakes map to what goes wrong, which is how a checklist
teaches. Both are defensible, and picking one is a real choice.

Its instruction "Delete sections that genuinely do not apply. **Do not delete the Security
section**" is worth noticing as a design pattern: one section is exempt from the escape hatch.
Compare [Lesson 24.5](05-quality-gates-and-branch-protection.md) Key Concept 4, where every gate
has a recorded way past it. A checklist item with **no** escape hatch is a claim that the
exception is never worth its cost — and this is the only place in the repository that makes it.

### 7. Where enforcement belongs: the hook is feedback, CI is the gate

Husky runs commitlint on `commit-msg` and lint-staged on `pre-commit`. Both are **conveniences**,
and it matters that you understand them that way.

| | Git hook | CI job |
|---|---|---|
| Speed | instant | a minute |
| Can be bypassed | `git commit --no-verify` | no |
| Runs for a contributor who never installed it | no | yes |
| Is it the gate | **no** | **yes** |

A git hook is local, opt-in and skippable, so a policy that exists only as a hook is a policy that
exists only for people who cooperate. [Lesson 24.5](05-quality-gates-and-branch-protection.md)
Step 7 already put commitlint in `ci.yml` for exactly this reason. The hook's job is to tell you
in half a second rather than in two minutes, which is worth having and is not a control.

`lint-staged` runs **Prettier** on staged files and deliberately not ESLint. The reasoning, with
its cost: a pre-commit hook has a budget of about two seconds before people start using
`--no-verify` reflexively, and type-aware ESLint on this project is well past that. Formatting is
also the thing worth fixing *before* the commit rather than arguing about in a diff — the class of
review comment nobody should ever have to write. ESLint stays a CI gate at `--max-warnings=0`,
where it is slower and unskippable. And PHP formatting stays out of the hook entirely, because
`phpcbf` needs the container: `docker compose run --rm composer run phpcbf` is a deliberate
action, not something a hook should do behind your back.

**One nice closing observation.** The module README's own last line is
`git commit -m "ci: aggregate required checks into ci-required"`, and **every module README in this
course ends with a conventional-commit example.** Twenty-four modules have taught the convention by
demonstration, and this lesson is the first one that enforces it. That is the right order: a
convention people have already internalised needs a linter to stay consistent, not to be
introduced.

### 8. The AI review gate: advisory, with two exceptions, both of which have a deterministic twin

An AI reviewer reads the diff and posts comments. The framing is the whole design.

| | Value | Failure mode |
|---|---|---|
| Advisory | catches the class of finding in Key Concept 3 that nothing else looks for | comments people learn to scroll past |
| Blocking on everything | a merge gate on a nondeterministic reviewer | disabled within two weeks, exactly as an aspirational threshold is |

So: **advisory, except two findings** — "secret detected" and "unauthenticated mutation". Those two
because their cost is unbounded and irreversible: a leaked secret is compromised the moment it
lands, and an anonymous write is a data-integrity incident, not a bug.

**And both of them are also caught deterministically.**

| Blocking AI finding | Deterministic twin |
|---|---|
| secret detected | `gitleaks` in `ci.yml` — [Lesson 24.5](05-quality-gates-and-branch-protection.md) Step 6 |
| unauthenticated mutation | the anonymous-caller integration test — [Lesson 23.5](../23-testing-deep-dive-and-agentic-qa/05-wp-integration-and-graphql-contract-tests.md) |

That table is the rule, and the rule is enforceable: **no finding may block unless it has a named
deterministic counterpart.** Which makes the AI a **second net and never the only net** — it may
catch something the deterministic check missed, and if it goes down, silent, or wrong, no
guarantee is lost. This is the same argument
[Lesson 23.9](../23-testing-deep-dive-and-agentic-qa/09-from-agent-findings-to-deterministic-specs.md)
makes about the exploratory agent, applied to the other non-human contributor: agents generate;
deterministic checks gate.

Two more properties, both cheap and both load-bearing. **Grounded in the committed checklist**, not
in general good taste: the prompt reads `docs/code-review-checklist.md`, so the reviewer's
standard is the repository's standard, it is reviewable in a pull request, and improving the
reviewer means editing a document. And **scoped to the diff**, because a reviewer that comments on
code the author did not touch is a reviewer people mute.

### 9. `pull_request`, and never `pull_request_target`

This is a security decision with an unpleasant trade, and it deserves the paragraph.

| Trigger | Runs code from | Secrets available | Token |
|---|---|---|---|
| `pull_request` | the pull request's branch | **none, for a fork** | read-only for a fork |
| `pull_request_target` | the **base** branch | **all of them** | write |

`pull_request_target` exists so a workflow can comment on a fork's pull request, and it is the
single most exploited misconfiguration in GitHub Actions. The workflow definition comes from the
base branch — which sounds safe — but the moment it checks out the head, or runs `npm ci` on the
contributor's lockfile, it is executing attacker-supplied code with your secrets and a write
token.

The cost of refusing it is real: **fork pull requests get no AI review.** For this repository that
is the correct trade, and the deterministic gates still run on forks. Say it in the workflow
rather than discovering it later; if you do need review on forks, the answer is a second workflow
triggered by `workflow_run` that reads an uploaded artifact and never checks out untrusted code.

`permissions:` is the same discipline, one level down: `contents: read` and
`pull-requests: write`, and nothing else. No `packages:`, no `id-token:`, and no access to the
environment that holds `FLY_API_TOKEN` or `VERCEL_TOKEN`. A review job that can deploy is a review
job that can be talked into deploying.

### 10. Measure its precision, on ten real pull requests, and write the number down

This is the thing almost nobody does, and without it you cannot tell a useful reviewer from a
harmful one.

**Precision** is the fraction of findings that were real: findings you acted on, divided by
findings raised. Not recall — you cannot measure what it missed without knowing every bug, which
is the problem you were trying to solve. Precision you can measure with a table and an afternoon.

| Precision | What it means | What to do |
|---|---|---|
| **≥ 70%** | most comments are worth reading | keep it; consider promoting one more finding class to blocking, with its deterministic twin |
| **40–70%** | useful, noisy | keep it advisory. Narrow the prompt to the categories that scored well and re-measure |
| **20–40%** | training people to dismiss review comments | cut the scope hard — the two blocking categories only — or turn it off |
| **< 20%** | actively harmful | turn it off. It is costing attention and teaching a habit that will make a human reviewer's comments easier to ignore |

The bottom row is the one to internalise. A bad reviewer is worse than no reviewer: the damage is
not the wasted minute, it is that people learn "review comments are usually noise" and carry that
habit to the comments that were not. That is the same shape as
[Lesson 23.9](../23-testing-deep-dive-and-agentic-qa/09-from-agent-findings-to-deterministic-specs.md)'s
honest-limits table, and the two lessons make one argument about two non-human contributors:
**measure what they are worth, write it down, and let the number decide how much authority they
get.** Ten pull requests is a rough sample and it is still infinitely more than the zero
measurements most teams have.

---

## Task

### Step 1: Write `docs/code-review-checklist.md`

The fourteen points, each with **the failure it prevents** and **the lesson that taught it**. That
third column is what turns a list into a teaching artifact, and this lesson is the only one in a
position to write it — the mapping only exists once all 24 modules do.

```markdown
<!-- docs/code-review-checklist.md -->

# Code review checklist — headless WordPress

Fourteen points. Every one of them is a mistake that passes every gate in
`docs/quality-gates.md`: the code is valid, the types check, the tests are green and the answer
is still wrong. Half transfer directly from Classic WordPress review. The other half share a
property Classic mistakes did not have — **invisible at review time and invisible at runtime.**

| # | Look for | The failure it prevents | Taught in |
|---|---|---|---|
| 1 | An N+1 pattern — a query or `await` per list item | 55 sequential round trips instead of one. Fine on the fixture, four seconds under load | 06.4, and the `EXPLAIN` drills in 02.3 |
| 2 | An unbounded `first:` on a connection | the seeded dataset is **55 incidents**; production is not. 06.4 clamps any `first` to 50, and a new call site can still ask for 10,000 | 06.4, 09.4 |
| 3 | A new fetch with no `revalidate` and no cache tag | a page that is correct today and stale in a week, with no error and nothing in a log | 18.1, 18.2 |
| 4 | `'use client'` on a file with no state and no events | nothing breaks; the bundle grows by 30 KB nobody attributes to it | 09.2, 21.3 |
| 5 | A secret behind `NEXT_PUBLIC_` | it builds, it works, and it is now in every visitor's browser, permanently | 09.1, appendix 04 §3.2, 24.2 |
| 6 | Unescaped WordPress HTML outside `RichText.tsx` | renders perfectly until the content is hostile. `grep -rl 'dangerouslySetInnerHTML' next-app/src/ | wc -l` must print **1** | 14.3, 24.2 |
| 7 | A custom mutation with no capability check | **WPGraphQL does not authenticate your mutations for you.** An anonymous write, with no warning anywhere | 06.2, tested by 23.5 |
| 8 | A `meta_query` on an unindexed meta key | fast on 40 rows, a full table scan on 40,000 | 02.3, 03.4 |
| 9 | Over-fetching — fields queried and never rendered | valid GraphQL, wasted bytes, and a wider cache surface to invalidate | 05.3, 10.5 |
| 10 | A JWT in `localStorage` or a non-`httpOnly` cookie | works; readable by any injected script | 15.1, 15.4 |
| 11 | A block's `save()` markup changed with no `deprecated` entry | every existing post silently becomes invalid in the editor | 13.5 |
| 12 | A user-visible string literal instead of a message key | correct in English, missing in `uk` and `de` | 20.3 |
| 13 | `$wpdb` string interpolation instead of `prepare()` | passes every test, is a SQL injection | 07.5 (PHPCS), 16.3 |
| 14 | A new content type or field the seeder does not create | a green suite, because nothing tests the new thing | 04.5, 12.4 |

## The two halves

Points 1, 2, 6, 8, 9, 12 and 13 are your Classic review instincts on new surfaces. A good
WordPress reviewer is already most of a good headless reviewer.

Points 3, 4, 5, 10 and 11 are the new ones, and they share one property: **the consequence
surfaces far from its cause, days later, to someone else.** A missing `esc_html()` shows up as
broken markup on the page you are looking at. A missing `revalidateTag` shows up next week, to a
reader, as content that is simply wrong. That asymmetry is why this file exists rather than
"reviewers should be careful".

## Greppable forms

Not a substitute for reading the diff. A first pass that takes eight seconds.

    # 6 — exactly one file may render raw HTML
    grep -rc 'dangerouslySetInnerHTML' next-app/src/ | grep -v ':0$'

    # 7 — the two counts must be reconcilable, mutation by mutation
    grep -rc 'register_graphql_mutation' wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/
    grep -rc 'current_user_can' wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/

    # 3 — no cache tag was hand-typed instead of built by tags.ts
    cd next-app && npm run lint:tags

    # 5 — nothing server-only reached the bundle
    grep -rn 'NEXT_PUBLIC_' next-app/src/ | grep -viE 'site_url|default_locale|turnstile_site_key|sentry_dsn'

## AI reviewer precision

Measured over ten real pull requests. Precision is findings acted on, divided by findings raised.
Not recall — we cannot measure what it missed without already knowing every bug.

| PR | Findings | Real | False | Notes |
|---|---|---|---|---|
| #— | — | — | — | |
| #— | — | — | — | |
| #— | — | — | — | |
| #— | — | — | — | |
| #— | — | — | — | |
| #— | — | — | — | |
| #— | — | — | — | |
| #— | — | — | — | |
| #— | — | — | — | |
| #— | — | — | — | |
| **Total** | | | | **precision = real / findings = __%** |

Decision rule, agreed before the number is known so it cannot be rationalised afterwards:

| Precision | Action |
|---|---|
| ≥ 70% | keep; consider promoting one more finding class to blocking — but only with a named deterministic counterpart |
| 40–70% | keep advisory. Narrow the prompt to the categories that scored well, re-measure |
| 20–40% | cut to the two blocking categories only, or turn it off |
| < 20% | turn it off. It is teaching people to dismiss review comments, and that habit does not stay confined to the robot |

Reviewed on: ____. Next review: after ten more pull requests, or after any prompt change.
```

**Verify §1:**

- [ ] Fourteen rows, and **every one names at least one lesson.** A row with no lesson is a rule
      with no argument behind it, and it is the first row somebody deletes.
- [ ] Point 2 says **55 incidents**, not 40. The seeded dataset grew in
      [Lesson 20.1](../20-internationalization/01-multilingual-content-modeling.md)'s translation
      phase, and a checklist quoting the old figure teaches the wrong intuition about scale.
- [ ] The four greppable forms all run and all pass on `main` today. A check that does not pass on
      a clean tree is a check nobody will believe.

### Step 2: Write your own template, then diff it against the one that ships

`.github/pull_request_template.md` **already exists in this repository.** Read its leading comment
before you touch it: it is the reference version of this deliverable, shipped so that any pull
request against the course repository gets a template, and it tells you to write your own first.

So: **write yours from the fourteen points, without looking at it.** Four required fields, then
whatever the checklist makes you want to ask.

```bash
# Your version, somewhere it will not overwrite the reference.
cp .github/pull_request_template.md /tmp/reference-template.md
$EDITOR /tmp/mine.md    # write it from the checklist, not from the reference

diff -u /tmp/reference-template.md /tmp/mine.md
```

The diff is the exercise. Two gaps are worth predicting, and both are real:

| Gap | Which version is better, and why |
|---|---|
| The reference has **no "what was not covered" field** — it has "What & why", a Tests checklist and a Rollback note | **yours**, if you included it. It is the only field that asks the author to argue against themselves, and "Nothing" on a 300-line diff is itself a review finding |
| The reference is organised by **surface** (Schema, Data & caching, Security, Performance, Tests); the checklist is organised by **mistake** | a genuine choice. Surfaces map to the files in the diff, which is how a reviewer reads. Mistakes map to what goes wrong, which is how a checklist teaches. Pick one and say why |

Merge the better version of each into `.github/pull_request_template.md` — you own the file now.
Two things to keep from the reference verbatim:

- **"Do not delete the Security section."** One section exempt from "delete what does not apply"
  is a deliberate statement that the cost of that exception is never worth paying. Compare
  [Lesson 24.5](05-quality-gates-and-branch-protection.md) Key Concept 4, where every *gate* has a
  recorded escape hatch: this is the one place in the repository that refuses to have one.
- The **"ACF field keys unchanged"** line. It is not obvious and it is expensive: a field key
  rename is a public contract change that fails the integration tests from
  [Lesson 23.5](../23-testing-deep-dive-and-agentic-qa/05-wp-integration-and-graphql-contract-tests.md),
  and it is exactly the kind of thing a reviewer will not think to ask about.

**Verify §2:**

- [ ] Your template has all four fields: what changed, why, how it was verified, **what was not
      covered.**
- [ ] `grep -c 'getByTestId' .github/pull_request_template.md` is `0` in your version. The
      reference's Tests section lists `getByTestId` among the acceptable locators, and
      [Lesson 23.7](../23-testing-deep-dive-and-agentic-qa/07-agentic-qa-guardrails-and-setup.md)'s
      selector contract puts it at priority 3 with a stated condition — so a template that offers
      it without the condition contradicts the lint rule that enforces it. Fixing that in your
      own copy is a legitimate finding, and noticing it is the point of the diff.
- [ ] `grep -c 'Do not delete this section' .github/pull_request_template.md` is `1`.

### Step 3: Husky and lint-staged, at the repository root

Git hooks are per **repository**, not per directory, so the tooling that installs them belongs at
the root — not in `next-app/package.json`, which is the front end's manifest and is owned by
[Lesson 24.2](02-security-hardening-next.md) this module.

```json
{
  "name": "blame-the-tech",
  "private": true,
  "description": "Repository-level developer tooling only. The applications live in next-app/ and wordpress-headless/.",
  "license": "MIT",
  "type": "module",
  "engines": {
    "node": ">=22.0.0 <23"
  },
  "scripts": {
    "prepare": "husky"
  },
  "devDependencies": {
    "@commitlint/cli": "^19.5.0",
    "@commitlint/config-conventional": "^19.5.0",
    "husky": "^9.1.0",
    "lint-staged": "^15.2.0",
    "prettier": "^3.3.0"
  },
  "lint-staged": {
    "*.{ts,tsx,js,jsx,mjs,json,md,yml,yaml,css}": "prettier --write"
  }
}
```

That is the repository-root `package.json`. It is new, and the root README's tree does not list it
— it lists `commitlint.config.mjs` and `.husky/` but not the manifest that installs them, which is
worth correcting. `"private": true` makes `npm publish` refuse; `"prepare": "husky"` is what makes
a fresh clone install the hooks on `npm install` rather than relying on somebody remembering.

```bash
npm install
npx husky init
```

```sh
#!/bin/sh
# .husky/pre-commit
# Formatting only, and that is a deliberate limit. A pre-commit hook has a
# budget of about two seconds before people use --no-verify reflexively, and
# type-aware ESLint on this project is well past it. ESLint stays a CI gate at
# --max-warnings=0, where it is slower and unskippable.
npx lint-staged
```

```sh
#!/bin/sh
# .husky/commit-msg
# Fast local feedback. NOT the gate — Lesson 24.5 Step 7 already runs
# commitlint in ci.yml, because `git commit --no-verify` defeats this file and
# a contributor who never ran `npm install` never had it.
npx --no -- commitlint --edit "$1"
```

PHP formatting stays out of the hook entirely. `phpcbf` needs the container, so
`docker compose run --rm composer run phpcbf` is a deliberate action rather than something a hook
does behind your back — and a hook that starts Docker is a hook that gets removed.

**Verify §3:**

```bash
git config core.hooksPath
ls -l .husky/pre-commit .husky/commit-msg
```

- [ ] `core.hooksPath` is `.husky/_`. If it is empty, `husky` never ran — `npm install` at the
      **root**, not in `next-app`.
- [ ] Both hook files are executable. A non-executable hook is silently skipped, which looks
      exactly like a hook that passed.
- [ ] `git check-ignore -v node_modules` names a rule. The root `.gitignore` already has an
      unanchored `node_modules/`, so this needs no change — confirm rather than add.

### Step 4: Write `commitlint.config.mjs`, with the rules **measured** rather than copied

```js
// commitlint.config.mjs
//
// Conventional commits, enforced. Every rule below was derived by grepping the
// commit examples this course has demonstrated for 24 modules — not copied
// from a blog post. That is the ratchet from Lesson 21.4 applied to a linter:
// start at "no worse than today", or the rule rejects your own history.

export default {
  extends: ['@commitlint/config-conventional'],

  // `git revert` writes `Revert "…"`, which is not a conventional header and
  // never will be. An escape hatch, on the record, in the file — Lesson 24.5
  // Key Concept 4's procedure applied to a lint rule.
  ignores: [(message) => message.startsWith('Revert ')],

  rules: {
    // MEASURED: these nine are the types the course actually uses, plus
    // `revert`. appendix 07 §9 lists the first nine; `spike` appears twice
    // (Module 17's Faust evaluation) and is genuinely useful for a timeboxed
    // investigation whose result may be "delete this".
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'ci', 'revert', 'spike'],
    ],

    // OFF, and this is the interesting decision. The course uses 18 distinct
    // scopes across 24 modules — next, web, wp, auth, cache, faust, docker,
    // preview, adr, seo, seed, qa, graphql, forms, ci, blocks, api, agentic —
    // and an enum on a two-application repository with six subsystems becomes
    // a list somebody edits in a pull request every time a new area appears.
    // THE COST, STATED: a typo like `nextt` now passes. Turn this back on with
    // the real set once it stops growing; that is a good later pull request.
    'scope-enum': [0],

    // A warning, not an error. The module READMEs demonstrate scopeless
    // commits — `ci: aggregate required checks into ci-required` is the last
    // line of Module 24's — so an error here would reject the convention as
    // this course taught it. A commitlint warning exits 0, unlike ESLint,
    // where --max-warnings=0 makes a warning fatal.
    'scope-empty': [1, 'never'],

    // MEASURED: the longest commit example in the course is 97 characters
    // ("feat(next): typed GraphQL documents from the committed schema; …").
    // 72 is the fashionable number and would reject the lessons' own examples,
    // which is exactly how a rule gets disabled in week two.
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 100],
  },
};
```

**Verify §4:**

```bash
printf 'ci: aggregate required checks into ci-required' | npx commitlint; echo "exit=$?"
printf 'Update stuff'                                   | npx commitlint; echo "exit=$?"
printf 'feat(next): typed GraphQL documents from the committed schema; delete hand-written response types' | npx commitlint; echo "exit=$?"
```

- [ ] The first exits `0` — the module README's own final line, with one `scope-empty` **warning**.
- [ ] The second exits `1`, with `type may not be empty`.
- [ ] The third, at 97 characters, exits `0`. A `header-max-length` error here means you copied
      `72` from somewhere instead of measuring.

### Step 5: Write `.github/workflows/ai-review.yml`

```yaml
# .github/workflows/ai-review.yml
name: AI review

on:
  # `pull_request`, and NEVER `pull_request_target`. That trigger runs the
  # workflow with repository secrets and a WRITE token against an
  # attacker-supplied diff, and it is the most exploited misconfiguration in
  # GitHub Actions. Key Concept 9. The cost, stated: fork pull requests get no
  # AI review. For this repository that is the correct trade.
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: ai-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    runs-on: ubuntu-latest
    # No `environment:` key, deliberately. This job must not be able to reach
    # the `production` environment that holds FLY_API_TOKEN and VERCEL_TOKEN.
    # A review job that can deploy is a review job that can be talked into
    # deploying.
    #
    # Forks are skipped explicitly rather than failing on an absent secret,
    # because a red X nobody can fix is worse than a skipped job.
    if: github.event.pull_request.head.repo.full_name == github.repository
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Collect the diff, scoped and bounded
        env:
          BASE: ${{ github.event.pull_request.base.sha }}
        run: |
          set -euo pipefail
          # SCOPED TO THE DIFF. A reviewer that comments on code the author did
          # not touch is a reviewer people mute. Lockfiles and generated types
          # are excluded because nobody reviews them and they are most of the
          # bytes.
          git diff "$BASE...HEAD" -- . \
            ':(exclude)**/package-lock.json' \
            ':(exclude)**/composer.lock' \
            ':(exclude)next-app/src/gql/**' \
            > /tmp/diff.patch
          # Truncate rather than fail. A 4000-line diff is a review problem
          # before it is a token-budget problem, and saying that is more useful
          # than a red X.
          head -c 200000 /tmp/diff.patch > /tmp/diff.cut && mv /tmp/diff.cut /tmp/diff.patch
          wc -l /tmp/diff.patch

      - name: Review against the committed checklist
        # Pin a third-party action to a full commit SHA in your own repository:
        # a tag is mutable and this action runs with your token. Reasoned, not
        # executed — check the action's README for the current input names
        # before you rely on this step.
        uses: anthropics/claude-code-action@v1
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        with:
          prompt: |
            You are reviewing a pull request against a written standard, not
            against your own taste. Read docs/code-review-checklist.md. It is
            the ONLY standard. Do not raise style, naming or architecture
            opinions; eighteen automated gates already cover what a machine
            can decide, and a comment outside the checklist trains people to
            ignore you.

            Review only /tmp/diff.patch.

            Write /tmp/findings.json — a JSON array, possibly empty:
              [{ "category": "<one of the 14 point slugs, or
                               secret-detected | unauthenticated-mutation>",
                 "file": "<path>", "line": <number>,
                 "note": "<one sentence: the failure this would cause>" }]

            Raise nothing you cannot point at a line for. An empty array is a
            correct and common answer.

      - name: Enforce two findings, and only those two
        run: |
          set -euo pipefail
          test -f /tmp/findings.json || { echo "No findings file. Treating as no findings."; exit 0; }
          jq -r '.[] | "· \(.category) — \(.file):\(.line) — \(.note)"' \
            /tmp/findings.json >> "$GITHUB_STEP_SUMMARY"

          # THE BLOCKING LIST IS HARD-CODED HERE, IN SHELL, ON PURPOSE. Two
          # entries, and each one has a named deterministic counterpart:
          #   secret-detected          → gitleaks in ci.yml       (Lesson 24.5)
          #   unauthenticated-mutation → the anonymous-caller test (Lesson 23.5)
          # No finding may block without a twin. That rule is what makes this a
          # SECOND net and never the only net — if this job is down, silent or
          # wrong, no guarantee is lost. Key Concept 8.
          blocking=$(jq -r '[.[] | select(.category == "secret-detected"
                              or .category == "unauthenticated-mutation")] | length' \
                       /tmp/findings.json)

          if [ "$blocking" -gt 0 ]; then
            echo "::error::$blocking blocking finding(s). Read the gitleaks job and the"
            echo "::error::integration-test output before you trust this — they are authoritative."
            exit 1
          fi
          echo "Advisory findings only; not blocking. Precision is tracked in docs/code-review-checklist.md."
```

**Verify §5:**

- [ ] `grep -c pull_request_target .github/workflows/ai-review.yml` is `0`.
- [ ] `grep -c 'environment:' .github/workflows/ai-review.yml` is `0`, and
      `grep -cE 'FLY_API_TOKEN|VERCEL_TOKEN' .github/workflows/ai-review.yml` is `0`.
- [ ] The blocking list in the shell step has **exactly two** categories, and both appear in the
      counterpart table in Key Concept 8. A third one without a deterministic twin is the
      regression this design exists to prevent.
- [ ] The job does **not** need adding to `ci-required`'s `needs:` list. It is advisory, and an
      advisory job inside the required aggregation is a blocking job with a misleading name.

### Step 6: Measure precision over ten pull requests

Ten real ones, not ten synthetic ones. Fill the table in `docs/code-review-checklist.md` as they
merge, with one verdict per finding: **real** if you changed the code because of it, **false** if
you did not. Nothing in between — "technically true but not worth doing" is a false positive,
because a comment nobody acts on has changed nothing. That definition is harsher than it feels and
it is the one that makes the number mean something. Then apply the Key Concept 10 rule **without
renegotiating it**: it was written down before the number was known precisely so a disappointing
result cannot be explained away.

**Verify §6:**

- [ ] Ten rows, all filled, with a total precision figure and a date.
- [ ] You applied the rule the band says. If precision came out at 30% and the reviewer is still
      running unchanged, the table is decoration and you have built the thing Key Concept 10
      warns about.

### Step 7: Write `docs/going-further.md`

The last file in the course. It should read like a handover, not a wish list, which means every
item says **why it was deferred** rather than what it is.

```markdown
<!-- docs/going-further.md -->

# Going further

Six things Blame The Tech does not do. Each one was considered and deferred, and the reason is
the useful part — a backlog with no reasons is a list of things that look easy.

## Search

**Deferred because:** WPGraphQL's `search` argument is a `LIKE '%term%'` over `post_content`,
which cannot use an index (Lesson 02.3's `EXPLAIN` drills show you exactly why) and returns
nothing useful for a typo. Real search means Algolia, Typesense or Elasticsearch, which means a
**second data store** and therefore a second consistency problem: an index that drifts from the
database is worse than no search. The hook already exists —
`transition_post_status` in `includes/Revalidate.php` is the same signal an index sync needs.

## Comments

**Deferred because:** comments are user-generated content, so they need moderation, spam defence
and a write path — all three of which the incident submission funnel already taught (Modules 16,
06.2, 16.3). Adding comments is applying a pattern you have, not learning a new one, and it
would double the moderation surface for a product whose content is editorial.

## A mobile app on the same API

**Deferred because:** technically nothing is missing. The API is already client-agnostic and the
schema is committed. What *is* missing is the discipline a second consumer forces: with one
client, a breaking schema change is a refactor; with two, it is a contract negotiation.
Lesson 06.3 wrote the versioning policy for the day that happens.

## WPGraphQL Smart Cache at the edge

**Deferred because:** half of it already shipped. Lesson 24.1 uses Smart Cache for **persisted
queries**, which is the security control. The **edge-caching** half needs a CDN in front of Fly
and a purge path fired from the same hooks Lesson 18.3 already signs a webhook from — so it is a
genuine addition, and it belongs after you have evidence that WordPress response time is the
bottleneck. Measure before you add a cache layer; Module 21 taught you how.

## A design-system package

**Deferred because:** extracting `src/components/ui` into a versioned package buys you two things
— a second consumer, and a release process. At one application it costs a build step, a
changelog and a version bump per change, and buys nothing. Do it on the day a second application
exists, not before.

## Multisite

**Deferred because:** Polylang already solves the axis this product has, which is language.
Multisite solves a different axis — separate brands or tenants — and it changes every query,
every cache tag (`src/lib/graphql/tags.ts` would need a site dimension), the plugin's activation
model and the `release_command`. It is not an upgrade; it is a different architecture.

## What to read next in this repository

| Question | File |
|---|---|
| What does this codebase guarantee? | `docs/quality-gates.md` |
| It is 3am and something is broken | `docs/runbook.md` |
| Why is it built this way? | `docs/architecture.md`, and the ADRs |
| What am I looking for in review? | `docs/code-review-checklist.md` |
| What is the API contract? | `docs/api-contract.md`, `wordpress-headless/schema.graphql` |
| How fast is it, and how do we know? | `docs/perf-baseline.md` |
```

### Step 8: Review one pull request of your own work against the checklist

This is the only step that proves the checklist is usable, and it is the last thing you do in the
course.

Take a real pull request of your own — one of the module commits, opened as a branch against
`main` — and review it. Not skim it: go through all fourteen points, in order, and write a
finding or "n/a" for each. Then fix the findings.

```bash
git switch -c review/self-audit
gh pr create --fill
gh pr view --web
```

**Verify §8:**

- [ ] You found **at least two** real findings. Fourteen points across a real diff, and zero
      findings means you skimmed — the most likely genuine hits are point 3 (a fetch with no tag),
      point 4 (a `'use client'` that could move down the tree) and point 9 (a field queried and
      never rendered).
- [ ] Every finding is fixed, in that pull request, and the pull request body's "what was not
      covered" field is filled in honestly.
- [ ] `npm run verify` and every suite are green, `ci-required` is green, and the AI review job
      ran and posted something you can judge — which is row one of the precision table.

```bash
git add -A
git commit -m "chore(ci): review checklist, PR template, commitlint and the AI review gate"
```

---

## Verification

```bash
cd /path/to/headless-wordpress-fullstack-training

# 1. Fourteen points, and every one names a lesson
sed -n '/^| # | Look for/,/^## The two halves/p' docs/code-review-checklist.md | grep -c '^| [0-9]'
# Expected: 14
sed -n '/^| # | Look for/,/^## The two halves/p' docs/code-review-checklist.md \
  | grep '^| [0-9]' | grep -cE '[0-9]{2}\.[0-9]'
# Expected: 14 — a row with no lesson is a rule with no argument behind it,
#           and it is the first row somebody deletes.

# 2. NEGATIVE — point 2 quotes the CURRENT seeded figure
grep -c '55 incidents' docs/code-review-checklist.md
# Expected: 1
grep -c '40 incidents\|is 40,' docs/code-review-checklist.md
# Expected: 0. The dataset grew to 55 in Lesson 20.1's translation phase; a
#           checklist quoting 40 teaches the wrong intuition about scale, which
#           is the exact mistake point 2 exists to catch.

# 3. The four greppable forms pass on a clean tree
grep -rc 'dangerouslySetInnerHTML' next-app/src/ | grep -v ':0$'
# Expected: exactly one line, ending :1 — src/components/blocks/RichText.tsx
grep -rc 'register_graphql_mutation' \
  wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/ | grep -v ':0$'
# Expected: one line per mutation file. Reconcile it against:
grep -rc 'current_user_can' \
  wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/ | grep -v ':0$'
# Expected: a capability check in every file that registers a mutation.
#           A mutation file with no hit is point 7, live, in your own code.

# 4. The template has all four fields
grep -ciE '^## (What|Type|Surface|Schema|Data|Security|Performance|Tests|Rollback)' \
  .github/pull_request_template.md
# Expected: 8 or more sections
grep -ciE 'not covered|out of scope|not tested' .github/pull_request_template.md
# Expected: 1 or more — the fourth field, which the shipped reference does not
#           have. If this is 0 you merged the reference instead of your version.

# 5. NEGATIVE — the template does not offer a locator the lint rule restricts
grep -c 'getByTestId' .github/pull_request_template.md
# Expected: 0. The SHIPPED reference lists it among the acceptable locators,
#           and Lesson 23.7's selector contract puts it at priority 3 with a
#           stated condition — so offering it unconditionally contradicts the
#           `no-restricted-syntax` rule that enforces the contract. Confirm the
#           reference really did have it, so you know the diff was worth doing:
git show HEAD~1:.github/pull_request_template.md 2>/dev/null | grep -c 'getByTestId'
# Expected: 1

# 6. Husky is installed, and the hooks are executable
git config core.hooksPath
# Expected: .husky/_   — empty means `npm install` ran in next-app, not at the root
test -x .husky/pre-commit && test -x .husky/commit-msg && echo "both executable"
# Expected: both executable. A non-executable hook is silently skipped, which
#           looks exactly like a hook that passed.

# 7. lint-staged runs on commit, on staged files only
printf 'const   x=1\n' > _probe-format.mjs
git add _probe-format.mjs
git commit -q -m "chore: probe lint-staged" && cat _probe-format.mjs
# Expected: "const x = 1;" — Prettier rewrote it BEFORE the commit, which is
#           the class of review comment nobody should ever have to write.
git reset -q --soft HEAD~1 && git restore --staged _probe-format.mjs && rm _probe-format.mjs

# 8. NEGATIVE — commitlint rejects what the course would not have written
printf 'Update stuff' | npx commitlint; echo "exit=$?"
# Expected: "type may not be empty", "subject may not be empty", exit=1
printf 'FEAT: Add Thing.' | npx commitlint; echo "exit=$?"
# Expected: exit=1 — type-case and subject-full-stop from the conventional
#           config, both inherited rather than restated

# 9. And accepts the convention this course has demonstrated for 24 modules
printf 'ci: aggregate required checks into ci-required' | npx commitlint; echo "exit=$?"
# Expected: exit=0, with a scope-empty WARNING. That is the module README's own
#           last line, and a rule that rejected it would be rejecting the
#           convention as it was taught.
printf 'feat(next): typed GraphQL documents from the committed schema; delete hand-written response types' \
  | npx commitlint; echo "exit=$?"
# Expected: exit=0 at 97 characters. A failure here means header-max-length was
#           copied as 72 instead of measured.
printf 'Revert "feat(web): the thing"' | npx commitlint; echo "exit=$?"
# Expected: exit=0 — the `ignores` escape hatch, in the file, on the record.

# 10. NEGATIVE — the AI review never runs untrusted code with your secrets
grep -c pull_request_target .github/workflows/ai-review.yml
# Expected: 0. That trigger runs with repository secrets and a WRITE token
#           against an attacker-supplied diff.
grep -c 'pull_request:' .github/workflows/ai-review.yml
# Expected: 1

# 11. NEGATIVE — minimal permissions, and no path to a deploy credential
sed -n '/^permissions:/,/^$/p' .github/workflows/ai-review.yml
# Expected: exactly `contents: read` and `pull-requests: write`. No packages:,
#           no id-token:, no contents: write.
grep -cE 'FLY_API_TOKEN|VERCEL_TOKEN|environment:' .github/workflows/ai-review.yml
# Expected: 0. A review job that can deploy is a review job that can be talked
#           into deploying.

# 12. NEGATIVE — the blocking list is closed, and both entries name a twin.
#     Probe it with an invented category: a finding with no deterministic
#     counterpart must NOT be able to block.
cat > /tmp/findings.json <<'JSON'
[{"category":"use-client-unnecessary","file":"src/x.tsx","line":3,"note":"probe"},
 {"category":"looks-suspicious","file":"src/y.ts","line":9,"note":"probe: invented category"}]
JSON
jq -r '[.[] | select(.category=="secret-detected" or .category=="unauthenticated-mutation")] | length' /tmp/findings.json
# Expected: 0 — two advisory findings, job passes. An invented category cannot
#           promote itself to blocking, which is the property that makes this a
#           second net and never the only net.
cat > /tmp/findings.json <<'JSON'
[{"category":"secret-detected","file":"src/z.ts","line":1,"note":"probe"}]
JSON
jq -r '[.[] | select(.category=="secret-detected" or .category=="unauthenticated-mutation")] | length' /tmp/findings.json
# Expected: 1 — this one blocks
rm -f /tmp/findings.json

# 13. Each blocking category names its deterministic counterpart, in the file
grep -c 'gitleaks in ci.yml' .github/workflows/ai-review.yml
# Expected: 1
grep -c 'anonymous-caller test' .github/workflows/ai-review.yml
# Expected: 1. Both twins named in the same comment as the blocking list, so
#           adding a third category means noticing there is no twin to name.

# 14. NEGATIVE — the advisory job is not inside the required aggregation
grep -A25 '^  ci-required:' .github/workflows/ci.yml | grep -c 'ai-review'
# Expected: 0. An advisory job inside `needs:` is a blocking job with a
#           misleading name — Lesson 24.5's whole point about consequences.

# 15. NEGATIVE — the hook is convenience, CI is the gate. Prove the bypass
#     exists and does not matter.
printf 'wip\n' > _probe-msg.txt
git commit --no-verify --allow-empty -q -F _probe-msg.txt && echo "hook bypassed locally"
# Expected: "hook bypassed locally" — --no-verify defeats the commit-msg hook,
#           by design, and this is why Lesson 24.5 Step 7 also runs commitlint
#           in ci.yml where nothing can skip it.
npx commitlint --from HEAD~1 --to HEAD; echo "exit=$?"
# Expected: exit=1 — the CI form catches exactly the commit the hook let past
git reset -q --hard HEAD~1 && rm -f _probe-msg.txt

# 16. The precision table is real
sed -n '/^## AI reviewer precision/,/^Reviewed on/p' docs/code-review-checklist.md | grep -c '^| #'
# Expected: 10
grep -cE 'precision = real / findings = [0-9]+%' docs/code-review-checklist.md
# Expected: 1 — a filled-in number, not `__%`

# 17. The handover files exist, and going-further says WHY for every item
grep -c '^## ' docs/going-further.md
# Expected: 7 — six deferred items plus "What to read next"
grep -c 'Deferred because' docs/going-further.md
# Expected: 6. An item with no reason is an item that looks easy, and a backlog
#           of things that look easy is how a handover misleads its reader.

# 18. And the course's own final gate is green
cd next-app && npm run verify && npm test -- --run
# Expected: both exit 0. `npm test` alone is watch mode — the `-- --run` is not
#           optional in a non-interactive shell.
```

Check 15 is the one worth arguing with a colleague about. The instinct on seeing `--no-verify`
work is to close the hole; the correct reading is that the hole is not in the hook, because a hook
was never the control. Everything a git hook does, a contributor who cloned five minutes ago and
has not run `npm install` has already skipped.

## Control Questions

1. Points 3, 4, 5, 10 and 11 are described as invisible at review time and invisible at runtime.
   Pick the one you think is most dangerous in this specific codebase, justify it with a concrete
   sequence of events, and then say which automated gate would have to change — and by how much —
   for the checklist item to become unnecessary.
2. `register_rest_route()` errors when `permission_callback` is missing;
   `register_graphql_mutation()` has no equivalent and defaults to open. Argue that WPGraphQL's
   default is defensible given what it is, then say what you would add to
   `blame-the-tech-core` to close the gap mechanically — and why a reviewer's checklist is what
   this course does instead.
3. The AI reviewer blocks on exactly two findings and both have a deterministic counterpart. A
   colleague proposes adding "SQL injection" as a third blocking category. Say whether it
   qualifies under the rule, name what would have to be true for it to qualify, and describe what
   is lost if the rule is relaxed just this once.
4. `scope-enum` is turned off with a stated cost: a scope typo now passes. `header-max-length` is
   set to 100 because the course's longest example is 97. Both are the same decision procedure
   applied to a linter. Name that procedure, say which lesson owns it, and describe what would
   have gone wrong had each rule been set to the fashionable value instead.
5. Precision is measured; recall is not. Explain why recall is not measurable here without
   assuming the answer, then describe a cheap proxy you could actually collect over six months —
   and say what that proxy would systematically miss.

## Learn More

- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) — the whole spec is
  one short page, and it is what `@commitlint/config-conventional` encodes
- [commitlint — rules reference](https://commitlint.js.org/reference/rules.html) — every rule name,
  its levels and its applicable values; read `ignores` and `defaultIgnores` before you invent your
  own exception for `git revert`
- [Husky](https://typicode.github.io/husky/) — v9 dropped the shim line older tutorials still
  show, and the `prepare` script is what makes a fresh clone install the hooks; pair it with
  [lint-staged](https://github.com/lint-staged/lint-staged) for how staged files reach a command
- [GitHub — `pull_request_target` and untrusted code](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/)
  — GitHub's own security lab on exactly the misconfiguration Key Concept 9 refuses; read it once
  and you will never reach for that trigger casually
- [GitHub Actions — assigning permissions to jobs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/control-permissions-for-github_token)
  — the `permissions:` keys and their defaults, which are broader than most people assume
- [GitHub — about pull request templates](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository)
  — where the file may live, and the multi-template directory form if one template stops fitting
- [Google — the Code Review Developer Guide](https://google.github.io/eng-practices/review/) — the
  standard reference on what a reviewer is for; the "what to look for" and "speed of reviews"
  sections are the two worth arguing with
- [WPGraphQL — `register_graphql_mutation`](https://www.wpgraphql.com/functions/register_graphql_mutation)
  — read the signature and notice what is not in it. That absence is point 7
- [OWASP Top 10](https://owasp.org/www-project-top-ten/) — the categories behind points 5, 6, 10
  and 13, so the checklist reads as an instance of something larger rather than as house rules
