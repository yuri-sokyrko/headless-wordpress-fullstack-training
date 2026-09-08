---
title: 'When Not to Use Faust'
module: 17
lesson: 4
teaches: [architecture-decision-record, decision-tables, framework-lock-in, reversibility, spike-cleanup]
produces: []
requires: [17.1, 17.2, 17.3]
---

# Lesson 17.4 — When Not to Use Faust

## Quick Overview

Three lessons of evidence turn into one document. You will write an **ADR** — the habit from
Module 01 — recording the decision this course makes: **adopt Faust's preview patterns, decline
Faust the framework.** The reasoning is not that Faust is bad. It is that Faust's value is
concentrated in exactly the three things you have already built or do not need — templates,
preview and auth — while its cost is concentrated in the one thing this application is actually
about. Everything Module 18 delivers is App-Router-native: per-route rendering strategies,
`generateStaticParams`, tag-based `revalidateTag`, on-demand ISR driven by a signed webhook, and
Server Actions. Those are precisely the capabilities Faust abstracts away behind its own routing
and Apollo's client cache. Add that `@faustwp/*` is in maintenance mode and trails App Router
releases, and adopting it would mean betting the freshest, fastest part of the stack on a
dependency that moves slower than both frameworks under it.

An ADR that only says no is half an ADR. Yours must state the conditions under which the decision
reverses, honestly enough that a future reader could act on them: a WP-first team with limited
Next.js depth, a client who requires editors to control routing and templates from wp-admin, a
project with no bespoke caching requirements, or a straightforward marketing site where the
template hierarchy is worth more than tag invalidation. In those situations Faust is the **right**
choice and hand-rolling would be the expensive mistake. Then you delete `faust-spike/` — which is why it never
appears in the expected tree in `next-app/README.md` — and keep the 120 lines from Lesson 17.2
that do ship.

By the end of this lesson you will have:

- An ADR with the standard sections — context, options considered, decision, consequences,
  reversal conditions — recording preview-only adoption
- A decision table with a verdict row and, next to it, a second table of the four situations that
  flip the verdict
- The stated cost of the decision: you own the preview code, the auth code and every route file,
  and no editor can change a template without a developer
- `faust-spike/` and its whole dependency tree removed, with a clean `npm test` and
  `npx playwright test` in `next-app/` afterwards
- A `git log` showing the spike as a distinct commit, so the evidence stays recoverable even
  though the code is gone
- A one-line note in the module README's scorecard confirming which single lesson's output survived

## Classic WP Analogy

You have made this call before. Elementor, Divi or WPBakery versus building the theme yourself.
The page builder wins the first four weeks by a mile: the client edits layouts, you skip a hundred
template files, and the demo lands. Then a requirement arrives that the builder did not anticipate,
and you discover that every previous shortcut is now load-bearing — the markup, the CSS cascade,
the way content is stored in shortcodes, the plugin's own update cadence. The question was never
"is this tool good?" It was "which of these two costs am I choosing, and for whose benefit?"

The classic analogue of *this* decision is even closer: whether to build on a parent theme. A
parent theme gives you a template hierarchy, sensible defaults and someone else's upgrade path,
at the cost of overriding conventions you did not choose. A blank theme gives you nothing except
the freedom to make the file do exactly what the site needs. Teams with deep PHP skills and unusual
requirements pick the blank theme; teams optimising for delivery speed on conventional sites pick
the parent. Both are correct answers to different questions, and the failure mode is picking one
without noticing you were choosing.

**Where the analogy breaks down:** a parent theme you have outgrown can be flattened. You copy the
templates into a child, delete the dependency, and the site keeps rendering — painful, bounded,
done in a sprint. A framework that owns your routing and your data layer cannot be flattened that
way. Migrating off Faust means rewriting every template as a route, replacing Apollo with your own
client, re-deriving every caching decision that Faust made implicitly, and doing all of it in one
change because the routing cannot be half-migrated. That asymmetry — **how cheaply can I reverse
this?** — is the criterion this ADR is really written against, and it is the one worth carrying
into every framework decision after this course.

The second break, in Faust's favour, and the ADR must say it: a page builder locks in *content*,
which is why it is so hard to escape. Faust locks in *code*. Your content stays in WordPress in
exactly the same shape either way, and it stays queryable by whatever front end you point at it
next. That makes Faust a far better bet than any page builder, and it is the reason the honest
verdict here is "not for this application" rather than "never".

---

## Key Concepts

### 1. An ADR that only says no is half a document

An **Architecture Decision Record** is a short, dated, immutable note that answers one question:
*why is the system like this?* You have written eight of them since Lesson 01.3. Their value is not
the decision — a codebase already shows you the decision. Their value is the **context that was
true at the time** and the **conditions that would change the answer**.

```
   WITHOUT AN ADR                             WITH ONE
   ────────────────────────────────────       ────────────────────────────────────
   "why don't we use Faust?"                  "why don't we use Faust?"
     └─ ask whoever is still here               └─ read ADR 0009, 200 words
     └─ nobody remembers the numbers            └─ the numbers are in the table
     └─ so the debate reopens every year        └─ and the reversal conditions say
                                                   exactly what would change it
```

| Section | The question it answers | The failure mode when it is thin |
|---|---|---|
| Context | what was true when we decided? | a future reader applies the decision to a project it was never about |
| Options considered | what else did we look at? | somebody "discovers" an alternative you rejected for a good reason |
| Decision | what did we do? | the codebase already says this; it is the least valuable section |
| Consequences | what did this cost? | the costs get rediscovered as bugs |
| **Reversal conditions** | **what would change our mind?** | **the decision becomes dogma** |

The last row is the one people omit, and it is the reason to write the document at all. "We chose X"
without "and here is what would change our mind" is not a decision record. It is a position, and
positions calcify. An ADR with reversal conditions is falsifiable — somebody can come back in a year
with evidence that a condition is now met, and the conversation is two minutes instead of two weeks.

### 2. Reversibility is the primary criterion, not capability

The temptation is to score frameworks on features. Resist it, because features are the thing you can
re-evaluate later and reversibility is not.

```
   CHEAP TO REVERSE                           EXPENSIVE TO REVERSE
   ────────────────────────────────────       ────────────────────────────────────
   a component library, copied in             a framework that owns routing
     (Module 11: shadcn, ADR 0008)              (all templates become routes)
   a data-fetching helper you wrote           a data layer with its own cache
     (Module 10: ADR 0007)                      (every freshness decision re-derived)
   a parent theme                             a page builder's stored markup
     (flatten into a child, one sprint)         (the CONTENT is now shortcodes)
```

The question to ask of any dependency is not "is this good?" but **"if this is wrong in eighteen
months, what does it cost to get out?"** Three tiers, and they are worth naming because the middle
one is where most bad decisions live:

| Tier | Example | Exit cost |
|---|---|---|
| A tool you call | `zod`, `date-fns`, `license-checker` | replace the call sites; hours to days |
| **A framework you live inside** | **Faust, and Next.js itself** | **rewrite every route, in one change, because routing cannot be half-migrated** |
| A store of content | a page builder, a proprietary CMS | migrate the data, and the data has lost information |

Next.js is in the middle tier too, and this course chose it anyway — with ADR 0001 recording why.
That is the point: tier two is not forbidden, it is **the tier that requires an ADR**. What makes
Faust different from Next here is not the tier; it is that Faust's value concentrates in three
capabilities this application has already built or does not need, while its cost concentrates in the
one capability the application is actually about.

### 3. Faust locks in *code*; a page builder locks in *content* — and that matters

This is the distinction the ADR must state, because it is the strongest thing that can be said in
Faust's favour and leaving it out would make the document dishonest.

| | A page builder | Faust |
|---|---|---|
| What it owns | the **stored content**: shortcodes, serialised layout, its own markup in `post_content` | the **front-end code**: routes, templates, data fetching |
| Migrating off means | rewriting content that no longer says what it meant, per page, by hand | rewriting code, which is what developers do |
| Your content afterwards | damaged, and there is no clean source to recover it from | **identical** — posts, ACF fields, taxonomies, revisions, untouched |
| Who is blocked | editors, forever | developers, once |

**Your content stays in WordPress in exactly the same shape either way.** The post types from
Module 03, the ACF fields from Module 04, the block markup from Module 13 — Faust reads them and
does not reshape them. Point a different front end at `/graphql` next year and everything is still
queryable.

That asymmetry is why the honest verdict is **"not for this application"** and not **"never"**.
Anyone who writes "Faust locks you in" in a decision record without that paragraph has compared it
to the wrong thing. Migrating off Faust is a rewrite of a front end. Migrating off a page builder
is an archaeology project on your own content.

### 4. A comparison table with no verdict row is a failure

You have two tables to write, and both need a bottom line. The scorecard in the module README has
one; copy the discipline.

```
   ❌ A TABLE THAT DECIDES NOTHING            ✅ A TABLE THAT DECIDES
   ────────────────────────────────────       ────────────────────────────────────
   | Capability | Faust | Ours |              | Capability | Faust | Ours |
   | templates  |  ✅   |  ❌  |              | templates  |  ✅   |  ❌  |
   | caching    |  ❌   |  ✅  |              | caching    |  ❌   |  ✅  |
   |            |       |      |              | Verdict | adopt preview only |
                                                          keep our stack |
   "so, it depends" — and the reader          the reader knows what was decided
   has to redo your reasoning                 and can argue with it specifically
```

A verdict row does three things. It forces you to weigh rather than enumerate; it makes the document
disagreeable in a useful way; and it survives being skimmed, which is how ADRs are actually read.

The same rule applies to the **second** table, the one listing situations that flip the decision.
Its verdict is not a recommendation — it is a threshold. "Two or more of these rows true for a
project" is a decision rule somebody can apply without you in the room.

### 5. The four conditions that flip the verdict, and the threshold

Lesson 17.3 §8 built the table of situations where Faust is the right choice. Do not restate it in
the ADR — cite it, and turn it into something a future reader can *apply* without you: four
conditions and a rule about how many of them it takes.

| Condition | Why it flips the decision | How you would know it is true |
|---|---|---|
| The team is WP-first with limited Next.js depth | the template hierarchy is knowledge they already have, and per-route caching is knowledge nobody would use correctly | count how many people can explain an RSC boundary |
| Editors must control routing or template selection | it is the only option that delivers it without building a product of your own | it is in a contract, or a stakeholder has asked twice |
| No requirement for sub-minute, per-node freshness | a single `revalidate` window is then a defensible policy | ask what happens if a correction goes live in 60 seconds instead of 3 |
| No Server Actions and no bespoke auth | Faust's two remaining layers become free value rather than something to work around | count the write paths; zero is the flipping number |
| **Threshold** | **two or more true → adopt Faust and do not hand-roll.** One true → argue it, because the other three probably dominate | — |

And the mirror image, which is why the verdict here is what it is. Every row is a requirement this
application already has, evidenced by a module that exists:

| Requirement | Evidence | Effect on the decision |
|---|---|---|
| A correction live seconds after Publish, per node | Module 18 exists to do exactly this | rules out a time window |
| Server Actions for submission and moderation | Module 16 | rules out a catch-all router they fight |
| No token JavaScript can read | Module 15, appendix 04 §4, and Lesson 17.3 Step 3's finding | rules out a client-side auth layer |
| One editor-composed page, not fifty | Module 14, `/hobt` | the template capability would be paid for everywhere and used once |

**None of the four flipping conditions is true here, and all four disqualifying requirements are.**
That is not a close call, and an ADR should say when a decision was not close — it saves the next
reader from assuming there was more doubt than there was.

### 6. The cost of the decision you are taking

Every ADR's Consequences section has a Negative list, and a thin one is a tell. Declining Faust has
four costs, all real, all landing on somebody.

| Cost | Who pays it | Paid back by |
|---|---|---|
| You own the preview code — 120 lines, one REST route, three cookies, an open-redirect defence, a token store | you, at every WordPress or Next upgrade | never. It is maintenance, forever |
| You own the auth code — Module 15's five files, the refresh hand-off, the cookie attribute table | you | never, and Module 24's hardening adds to it |
| Every route is a file a developer writes | the delivery schedule | never. Twelve routes today, and each new content type is a pull request |
| **No editor can change a template without a developer** | the editorial team, repeatedly | never — and this is the one that generates tickets |

Two of those four are already paid: Modules 15 and 17.2 exist and are working. The other two are
recurring, and the ADR must say so rather than presenting the decision as free.

> **The test of an honest Negative list.** If you can read yours back and not wince, it is too
> short. The fourth row above should make you slightly uncomfortable — that is what a real cost
> feels like written down.

### 7. Spike hygiene: delete the code, keep the commit

`faust-spike/` has done its job. Two lessons of evidence turned into a table with numbers in it,
which is exactly what a spike is for. Now it goes, and the deletion is part of the discipline rather
than tidying up afterwards.

| Keep | Delete | Why |
|---|---|---|
| The git commit from Lesson 17.1 and the one from 17.3 | the working tree | "we tried it, here is the branch" is a complete answer; a directory nobody runs is a liability |
| The measurements, in `docs/architecture.md` | `faust-spike/node_modules` | the numbers are the deliverable |
| The ADR | the `faustwp` plugin in WordPress | the plugin filters link functions, and a dormant filter is worse than an active one |

Three reasons the directory cannot stay, in increasing order of severity:

1. **It has no tests and no owner.** Module 12 established that everything in this repository is
   covered by one of two suites. `faust-spike/` is in neither, so it rots silently.
2. **It is a second dependency tree to keep patched.** Module 24 adds a CI licence gate and
   Dependabot-style upgrades. A spike in the tree is a stream of pull requests against code nobody
   will run.
3. **The WordPress plugin has opinions.** `faustwp` filters `preview_post_link` when a front-end URL
   is configured. Lesson 17.2 registered at priority 99 specifically so load order could not decide
   the outcome — and Verification's most important check is that removing the plugin changes
   nothing. A dormant plugin that quietly wins a filter after a future update is exactly the class
   of bug nobody finds.

**The evidence lives in git and in `docs/`, not in a directory.** That is the whole rule.

### 8. Which lesson actually shipped, and why that is the interesting question

Module 17 has four lessons and one of them produced code that survives. Being able to say which, and
prove it, is the module's real outcome.

```
   17.1  faust-spike/                     DELETED in 17.4
   17.2  src/app/api/preview/route.ts     SHIPS
         src/app/api/preview/exit/route.ts SHIPS
         src/components/preview/PreviewBanner.tsx SHIPS
         includes/Preview.php             SHIPS
   17.3  measurements in docs/            KEPT, as evidence
   17.4  docs/adr/0009-…                  KEPT, as the decision
```

Notice what 17.2 is built on: `draftMode()`, `preview_post_link`, `asPreview`, a transient, an
httpOnly cookie. **Not one line of it is Faust.** That is not a coincidence and it is the point of
the module: the capability Faust is most often adopted *for* is the one this stack already had, in
about 120 lines, using primitives from Next and WordPress that neither project is going to remove.

Verification's first NEGATIVE is therefore the most important check in the lesson: **the preview
flow still works after `faust-spike/` and the `faustwp` plugin are gone.** If it did not, the module
would have shipped a dependency instead of a decision.

### 9. ADR numbers are permanent, and you supersede rather than edit

`docs/adr/0001`–`0008` are taken by Modules 01, 02, 04, 09, 10 and 11. **This is `0009`, and the
number is never reused** — not if the file is deleted, not if the decision is reversed.

| When the decision changes | What you do | What you never do |
|---|---|---|
| New evidence, same conclusion | append a dated note under Consequences | rewrite Context |
| A reversal condition is met | write a **new** ADR, set its `Supersedes: 0009`, and set 0009's `Superseded by:` to the new number | edit 0009's Decision |
| The wording is embarrassing | leave it | improve it retroactively |

The reason is that an ADR is a record of *when* something was decided and *with what information*.
Editing the decision destroys the only thing the document was for. This is why the template Lesson
01.3 gave you has `Supersedes:` and `Superseded by:` fields that are almost always `—`: they are
there so that reversal has an obvious, cheap, honest shape.

> **A concrete example, and it is in this course.** Adopting Polylang Pro would translate custom
> post type rewrite slugs, which is the stated reversal condition for a decision Module 20 records
> about localised route segments. If that ever happened, the right move is a new ADR citing the
> old one — not a quiet edit that makes the original look like it always said the new thing.

---

## Task

### Step 1: Gather the evidence before you write a word

The ADR cites measurements, not impressions. All of them are already in `docs/architecture.md`, put
there by Lessons 17.1 Step 8 and 17.3 Step 7. Read your own notes back before you start:

```bash
cd "$(git rev-parse --show-toplevel)"
sed -n '/Faust.js evaluation, evidence log/,$p' docs/architecture.md
ls docs/adr/
```

**Verify §1:**

- [ ] `ls docs/adr/` lists `0001` through `0008` and **no** `0009`. That is the next free number and
      this lesson takes it. If a `0009` already exists, stop: numbers are permanent, so you take
      the next free one and report the collision rather than overwriting anything.
- [ ] Your evidence log has the `@faustwp/core` version, its publish date, its peer ranges and its
      **licence** — all four from Lesson 17.1 Step 2. If any is missing, run those `npm view`
      commands again now, while the spike still exists.
- [ ] The four-column table from Lesson 17.3 has no parenthesised placeholders left in it.

### Step 2: Write the ADR's front matter, context and decision

The template is the one Lesson 01.3 gave you, plus a fifth section this decision needs.

```markdown
<!-- docs/adr/0009-preview-only-faust-adoption.md -->
# ADR 0009 — Adopt Faust.js's preview patterns, decline Faust the framework

- **Status:** Accepted
- **Date:** TODO: today's date, ISO 8601
- **Deciders:** you
- **Supersedes:** —
- **Superseded by:** —

## Context

Blame The Tech is a headless WordPress build with a Next.js App Router front end. By Module 17 it
has: a typed `fetch` GraphQL client with cache tags (Module 10), a block renderer (Module 14),
httpOnly-cookie sessions with WordPress as the only authority on capability (Module 15), and
Server Actions for submission and moderation (Module 16). Module 18 will add per-route rendering
strategies and tag invalidation driven by a signed WordPress webhook.

Faust.js is WP Engine's Next.js framework for headless WordPress. It offers three things: a
WordPress template hierarchy in React, editor preview, and auth. It was evaluated as a spike —
`faust-spike/`, a sibling application on port 3001 against the same WordPress, with no change to
`next-app/`'s lockfile — across Lessons 17.1 and 17.3. Measurements are in `docs/architecture.md`.

TODO: add one paragraph naming what was true at the time, in your own words: the versions and
release dates you recorded, whether the App Router is supported, and the licence you found. A
future reader needs to know what information the decision was made with, not just what it was.

## Decision

TODO: state the decision in two or three sentences, in your own words. It must contain both halves
— what is adopted and what is declined — and it must name the ONE capability whose loss drove the
answer.
```

**Verify §2:**

- [ ] The `**Date:**` line carries a real ISO 8601 date, not the placeholder.
- [ ] Your Context paragraph names the version and the licence you actually saw. An ADR whose
      context says "it seemed unmaintained" is worthless in a year.
- [ ] Your Decision says both halves. "We are not using Faust" is not the decision — the preview
      patterns in Lesson 17.2 came straight out of this evaluation.

### Step 3: The two tables — the verdict, and the four conditions that flip it

Key Concept 4 is the rule: **no table without a verdict row.**

```markdown
<!-- docs/adr/0009-preview-only-faust-adoption.md — append -->

## Options Considered

| Option | How it would work | Why not, or why |
|---|---|---|
| **Adopt Faust wholesale** | `pages/[...wordpressNode].js` resolves every URL through a seed query; `wp-templates/` replaces `src/app/[locale]/**`; Apollo replaces `src/lib/graphql/client.ts` | Forfeits per-route rendering strategies, `generateStaticParams` and tag invalidation — the whole of Module 18. Apollo's cache is client-side and `revalidateTag` has no call site to attach to (17.3 Step 6). Server Actions fight the catch-all route. A client-side `useAuth` needs a token JavaScript can read, which appendix 04 §4 forbids |
| **Adopt Faust for preview only, as a dependency** | keep our routes; mount Faust's preview handler | Impossible: preview resolves the node through the same seed query and renders through `WordPressTemplate`. Layer 1 is not optional (17.1 §1) |
| **Adopt Faust's preview PATTERNS, write the code** | `draftMode()`, `preview_post_link`, `asPreview`, a single-use transient, an httpOnly cookie | **Chosen.** About 120 lines, no new dependency, and every primitive belongs to Next or WordPress core. Lesson 17.2 |
| **No preview at all** | editors check content after publishing | Rejected. Editors will not accept it, and they are right not to |
| **Verdict** | — | **adopt the preview patterns; keep our own routing, data layer and auth** |

## When this decision is wrong

Faust is the correct choice for real projects. Four conditions, and the threshold:

| Condition | True here? |
|---|---|
| The team is WP-first with limited Next.js depth | TODO |
| Editors must control routing or template selection from wp-admin | TODO |
| No requirement for sub-minute, per-node content freshness | TODO |
| No Server Actions and no bespoke auth requirement | TODO |
| **Threshold: two or more true → adopt Faust and do not hand-roll** | **TODO: how many are true?** |

TODO: for each row, write one sentence naming the module or requirement that makes it true or
false here. The rows are not rhetorical — a future project of yours will answer them differently,
and this table is what you will reread when it does.
```

**Verify §3:**

- [ ] Both tables have a bold **Verdict** or **Threshold** row, and neither reads "it depends".
- [ ] The Options table has at least **four** data rows, including the option you took and the
      option of doing nothing.
- [ ] Every `TODO` in this step is replaced.

### Step 4: Consequences, reversal conditions, and the licence finding

The Negative list is the exercise. Key Concept 6 has the four costs; write them in your own words
and add any you found yourself.

```markdown
<!-- docs/adr/0009-preview-only-faust-adoption.md — append -->

## Consequences

### Positive

- TODO: at least three. Draw them from `docs/architecture.md`'s four-column table, and cite a
  number where you have one.

### Negative

- TODO: at least four, and one of them must be the editorial cost — **no editor can change a
  template without a developer.** Say who pays it and how often.
- TODO
- TODO
- TODO

### Neutral

- **Content lock-in: none, either way.** A page builder locks in *content*; Faust locks in *code*.
  Post types, ACF fields, taxonomies and block markup are identical whichever front end reads
  them, and stay queryable by whatever we point at `/graphql` next. This is why the verdict is
  "not for this application" rather than "never".
- TODO: at least one more genuine change that is neither better nor worse.

### Licence finding (Lesson 07.1 §9)

- `@faustwp/core`: TODO — the exact value `npm view @faustwp/core license` printed
- `@faustwp/cli`: TODO
- `@apollo/client`: TODO
- `npx license-checker --production --summary` over the spike tree: TODO — note any GPL, AGPL,
  SSPL or BUSL entry, including transitive ones
- TODO: one sentence on what this would have meant if we had installed into `next-app/`, which is
  MIT and takes no copyleft dependency. If any answer above is GPL or AGPL, say plainly that the
  spike living **outside** `next-app/` is what made running it safe at all.

## Reversal Conditions

Rewrite this decision — as a NEW ADR that supersedes this one, never by editing this file — if:

- TODO: at least three, drawn from the four conditions in the second table above, stated so that a
  future reader can check them. "If Faust improves" is not checkable. "If two or more of the
  conditions in §When this decision is wrong become true for a project" is.
- TODO: one that is about Faust rather than about us — a released version whose peer ranges include
  the Next major we are on, with documented App Router support and a data layer we can supply.
- TODO: one about the editorial cost. Name the trigger — a number of template-change tickets per
  quarter, or a client contract clause.

## Related

- Lesson 17.1 — the spike, and why it lived outside `next-app/`
- Lesson 17.2 — the code this decision kept
- Lesson 17.3 — the measurements every row above cites
- ADR 0007 — the hand-rolled GraphQL client this decision keeps
- ADR 0008 — shadcn copied rather than depended on; the same reversibility argument, one tier down
- `docs/architecture.md` — the evidence log and the four-column table
```

**Verify §4:**

- [ ] The Negative list has **four or more** bullets and one of them is the editorial cost.
- [ ] The Licence finding section holds three real licence strings and the `license-checker`
      summary. This is the last moment you can run those commands — Step 6 deletes the tree.
- [ ] Reversal Conditions has **three or more** bullets and every one is checkable by someone who
      was not in the room.
- [ ] `grep -c 'TODO' docs/adr/0009-preview-only-faust-adoption.md` is `0`.

### Step 5: Commit the decision before you delete the evidence

Order matters. The ADR is the artifact that makes the deletion safe, so it lands first, in its own
commit.

```bash
cd "$(git rev-parse --show-toplevel)"
git add docs/adr/0009-preview-only-faust-adoption.md docs/architecture.md
git commit -m "docs(adr): 0009 adopt Faust's preview patterns, decline the framework"
```

**Verify §5:**

- [ ] `git log --oneline -1` shows that commit, and `git status --short` shows `faust-spike/` still
      present and unmodified.
- [ ] `git log --oneline -- faust-spike` lists the commits from Lessons 17.1 and 17.3. **Those are
      what survive the deletion** — check they exist *before* you delete, not after.

### Step 6: Delete the spike

```bash
cd "$(git rev-parse --show-toplevel)"
git rm -r --quiet faust-spike
rm -rf faust-spike
ls | grep -c faust
```

`git rm -r` unstages and removes the tracked files; the `rm -rf` clears `node_modules/`, which was
never tracked. Both, in that order, or you are left with a gitignored directory nobody can see in
`git status`.

**Verify §6:**

- [ ] `test ! -d faust-spike && echo gone` prints `gone`.
- [ ] `git status --short` shows the deletions staged, and **nothing** under `next-app/` or
      `wordpress-headless/`.
- [ ] `git log --oneline -- faust-spike | wc -l` is still greater than `0`. The history is
      untouched by a deletion; that is the whole reason the commit is the deliverable.

### Step 7: Remove the WordPress-side plugin

The plugin is the half people forget, and it is the half that can still change behaviour. It filters
`preview_post_link` when a front-end URL is configured, and a dormant filter that wins after a
future update is exactly the bug nobody finds.

```bash
cd wordpress-headless

# Record the current answer, so Step 8 can prove it did not change.
docker compose run --rm wpcli wp eval '
  $p = get_page_by_path( "incident-01", OBJECT, "incident" );
  wp_set_current_user( get_user_by( "login", "editor" )->ID );
  echo get_preview_post_link( $p->ID ) . PHP_EOL;' | sed 's/token=[^&]*/token=REDACTED/'

docker compose run --rm wpcli wp plugin uninstall faustwp --deactivate

# Belt and braces: the settings row, in case the uninstall hook did not take it.
docker compose run --rm wpcli wp option delete faustwp_settings 2>/dev/null \
  || echo 'faustwp_settings already gone'

docker compose run --rm wpcli wp plugin list --status=active --field=name
```

**Verify §7:**

- [ ] `wp plugin list --status=active --field=name` no longer lists `faustwp`, and **still** lists
      every plugin that was active before it: `wp-graphql`, `wp-graphql-jwt-authentication`,
      `wpgraphql-acf`, `wp-graphql-content-blocks`, `advanced-custom-fields-pro` and
      `blame-the-tech-core`. Lesson 17.1 Verify §4 recorded that list; compare against it.
- [ ] `docker compose run --rm wpcli wp option get faustwp_settings` errors or returns nothing.
- [ ] `docker compose logs --tail=40 wordpress` shows no fatal. Uninstalling a plugin that other
      code referenced would show up here immediately, and nothing in `blame-the-tech-core`
      references it — which is the property Lesson 17.2's priority-99 filter was protecting.

### Step 8: Prove the flow that shipped still works, then commit

This is the check the whole module was building towards. Two lessons of Faust are gone; the preview
flow from Lesson 17.2 must be **completely unaffected**, because not one line of it was Faust.

```bash
cd wordpress-headless

# The preview link is still ours, and still points at :3000
docker compose run --rm -T wpcli wp eval '
  $p = get_page_by_path( "incident-01", OBJECT, "incident" );
  wp_set_current_user( get_user_by( "login", "editor" )->ID );
  echo ( false !== strpos( get_preview_post_link( $p->ID ), "/api/preview?" ) ? "ours" : "NOT OURS" ) . PHP_EOL;'

# And it still redeems, end to end. `npm run dev` running in next-app/.
PREVIEW_URL=$(docker compose run --rm -T wpcli wp eval '
  $p = get_page_by_path( "incident-01", OBJECT, "incident" );
  wp_set_current_user( get_user_by( "login", "editor" )->ID );
  echo get_preview_post_link( $p->ID );' | tr -d '\r')
curl -s -c /tmp/btt-after.jar -b /tmp/btt-after.jar -L -o /tmp/btt-after.html \
     -w 'status=%{http_code}\n' "${PREVIEW_URL/host.docker.internal/localhost}"
grep -c 'Draft preview' /tmp/btt-after.html

cd ../next-app && npm run verify && npm test -- --run && npx playwright test --project=smoke
```

Then commit the removal, and add the one-line note that records which lesson's output survived:

```markdown
<!-- docs/architecture.md — append -->

## Faust evaluation: outcome (Lesson 17.4)

Decided in ADR 0009. `faust-spike/` deleted and the `faustwp` plugin uninstalled in Lesson 17.4;
the spike survives as its own git commit. **The only output of Module 17 that ships is Lesson
17.2's** — `src/app/api/preview/route.ts`, `preview/exit/route.ts`,
`src/components/preview/PreviewBanner.tsx` and `includes/Preview.php` — and none of it is Faust.
Verified after the deletion: the preview flow is unchanged.
```

```bash
cd "$(git rev-parse --show-toplevel)"
git add -A
git commit -m "chore(faust): delete the spike and uninstall the plugin, per ADR 0009"
git log --oneline -4
```

**Verify §8:**

- [ ] The `wp eval` prints `ours`, and the redemption prints `status=200` with `Draft preview` on
      the page. **If this fails, Module 17 shipped a dependency instead of a decision** — start
      with Lesson 17.2 Step 4, because the filter priority is the only thing that could have
      depended on the Faust plugin's presence.
- [ ] All three suites are green, with `npm run dev` running rather than `npm start`.
- [ ] `git log --oneline -4` shows four distinct commits: the spike, the measurements, the ADR, and
      the removal. That sequence is the auditable version of "we evaluated it and here is why not".

---

## Verification

```bash
cd "$(git rev-parse --show-toplevel)"
# `npm run dev` running in next-app/. Nothing needs to run on 3001 any more.

# 1. The spike is gone from the working tree, in both senses
test ! -d faust-spike && echo 'directory: gone'
# Expected: directory: gone
git ls-files faust-spike | wc -l | tr -d ' '
# Expected: 0 — no tracked files remain either

# 2. The ADR exists, with all five sections and no placeholders
test -f docs/adr/0009-preview-only-faust-adoption.md && echo 'adr: present'
# Expected: adr: present
for h in '## Context' '## Decision' '## Options Considered' '## Consequences' '## Reversal Conditions'; do
  printf '%-24s %s\n' "$h" "$(grep -c "^$h\$" docs/adr/0009-preview-only-faust-adoption.md)"
done
# Expected: 1 for each of the five
grep -c 'TODO' docs/adr/0009-preview-only-faust-adoption.md
# Expected: 0
grep -q '^- \*\*Status:\*\* Accepted' docs/adr/0009-preview-only-faust-adoption.md && echo 'status: ok'
# Expected: status: ok

# 3. Both tables decide something, and the Negative list is honest
grep -c '^| \*\*Verdict\*\*\|^| \*\*Threshold' docs/adr/0009-preview-only-faust-adoption.md
# Expected: 2 — one verdict row per table. A table without one is Key Concept 4's failure.
sed -n '/^### Negative/,/^### Neutral/p' docs/adr/0009-preview-only-faust-adoption.md | grep -c '^- '
# Expected: 4 or more
sed -n '/^## Reversal Conditions/,/^## Related/p' docs/adr/0009-preview-only-faust-adoption.md | grep -c '^- '
# Expected: 3 or more

# 4. The licence finding from Lesson 17.1 is recorded, permanently
grep -c 'faustwp/core' docs/adr/0009-preview-only-faust-adoption.md
# Expected: 1 or more, on a line carrying the licence string you saw. The package
#           is uninstalled now, so this file is the only remaining record.

# 5. NEGATIVE — THE MOST IMPORTANT CHECK IN THE LESSON.
#    The preview flow from 17.2 still works with Faust entirely removed.
cd wordpress-headless
PREVIEW_URL=$(docker compose run --rm -T wpcli wp eval '
  $p = get_page_by_path( "incident-01", OBJECT, "incident" );
  wp_set_current_user( get_user_by( "login", "editor" )->ID );
  echo get_preview_post_link( $p->ID );' | tr -d '\r')
echo "$PREVIEW_URL" | sed 's/token=[^&]*/token=REDACTED/'
# Expected: http://host.docker.internal:3000/api/preview?token=REDACTED&id=<id>&next=%2Fen%2Fincidents%2Fincident-01
#           OURS, at priority 99, with nothing else in the filter queue now.
curl -s -c /tmp/btt-after.jar -b /tmp/btt-after.jar -L -o /tmp/btt-after.html \
     -w 'status=%{http_code} url=%{url_effective}\n' "${PREVIEW_URL/host.docker.internal/localhost}"
# Expected: status=200 url=http://localhost:3000/en/incidents/incident-01
grep -c 'Draft preview' /tmp/btt-after.html
# Expected: 1 — the banner from Lesson 17.2, rendering after the framework it was
#           evaluated against has been deleted. This is what "17.2 is the lesson
#           that ships" means, and it is the only proof of it.

# 6. NEGATIVE — the Faust plugin is uninstalled, not merely deactivated
docker compose run --rm wpcli wp plugin list --status=active --field=name | grep -c faust
# Expected: 0
docker compose run --rm wpcli wp plugin list --field=name | grep -c faust
# Expected: 0 — deactivated is not enough. An inactive plugin is one click and one
#           `wp plugin activate` from filtering preview_post_link again.
docker compose exec -T wordpress test ! -d /var/www/html/wp-content/plugins/faustwp \
  && echo 'plugin directory: gone'
# Expected: plugin directory: gone

# 7. NEGATIVE — removing it did not disturb /graphql
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' -d '{"query":"{ generalSettings { title } }"}'
# Expected: 200
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1){ nodes{ slug } } }"}' | jq -r '.data.incidents.nodes[0].slug'
# Expected: a real slug (incident-40 is the newest — Lesson 12.4). Not null, and
#           no `errors` array: GraphQL failures are HTTP 200, so the status code
#           above proves nothing on its own.
docker compose run --rm wpcli wp eval 'echo count( get_option( "active_plugins" ) ) . " active" . PHP_EOL;'
# Expected: one fewer than Lesson 17.3 Verification check 10 reported

# 8. NEGATIVE — no reference to Faust survives anywhere in the app you ship
cd ..
grep -rc 'faustwp\|@faustwp\|faust' next-app/src next-app/package.json 2>/dev/null | grep -v ':0$' | wc -l | tr -d ' '
# Expected: 0 — no file has a hit
grep -c '@faustwp\|@apollo/client' next-app/package-lock.json
# Expected: 0
git diff --stat HEAD~4 -- next-app/package.json next-app/package-lock.json
# Expected: NO OUTPUT. Neither file changed across the four commits of this
#           module. (If /tmp/btt-lockfile-before.txt from Lesson 17.1 Step 1 has
#           survived, `diff` it against
#           `shasum -a 256 next-app/package.json next-app/package-lock.json`
#           too — git is the durable version of that check.)

# 9. NEGATIVE — docs/adr/ has no duplicate 0009 and no reused number
ls docs/adr/ | grep -c '^0009'
# Expected: 1
ls docs/adr/ | sed 's/-.*//' | sort | uniq -d | wc -l | tr -d ' '
# Expected: 0 — no number appears twice. ADR numbers are permanent (Key Concept 9).
ls docs/adr/ | sed 's/-.*//' | sort
# Expected: 0001 … 0009, contiguous, with nothing missing

# 10. Both suites, and the whole application, still green
cd next-app && npm run verify && npm test -- --run && npx playwright test --project=smoke
# Expected: type-check, lint and format clean; all Vitest tests pass; smoke passes.
#           Nothing in this lesson touched src/, and these three commands are how
#           you know rather than assume.

# 11. The git history is the evidence the directory no longer is
cd ..
git log --oneline -- faust-spike | wc -l | tr -d ' '
# Expected: 2 or more — the spike commit and the measurement commit still exist
git log --oneline -4
# Expected: four distinct commits, newest first: the removal, ADR 0009, the
#           measurements, the spike. That sequence IS the decision record's
#           provenance, and it is why deleting the code cost nothing.
git status --short
# Expected: empty. Everything is committed.
```

If check 5 fails, do not proceed to Module 18 — the whole point of Lesson 17.2 was that it depends
on nothing from Lessons 17.1 and 17.3, and a failure here means it does. Start at Lesson 17.2
Step 4: the `preview_post_link` priority is the only place where the Faust plugin's presence could
have mattered.

## Control Questions

1. An ADR's least valuable section is the Decision, and its most valuable is Reversal Conditions.
   Explain why, then write one reversal condition for a decision you have made outside this course
   that would actually be checkable by a colleague.
2. "Faust locks you in" and "a page builder locks you in" describe different things. Name what each
   one owns, say which is cheaper to escape and why, and explain how that distinction changes the
   verdict in ADR 0009 from "never" to "not here".
3. Four of Module 17's artifacts survive this lesson and one directory does not. Name the surviving
   files, then name the primitive each one is built on — and say which project owns that primitive.
4. Verification check 6 insists the plugin is **uninstalled**, not deactivated. Give the specific
   failure that a merely-deactivated `faustwp` could still cause, and say which decision in Lesson
   17.2 was already defending against it.
5. Zero of the four flipping conditions are true for this application. Describe a plausible next
   project of yours where two or more would be, and say which single row you would find hardest to
   assess honestly before the project started.

## Learn More

- [Michael Nygard: documenting architecture decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
  — the original 2011 post that defined the format this course uses; four paragraphs, and still the
  best statement of why the Context section is the valuable one
- [`adr-tools`](https://github.com/npryce/adr-tools) — a shell implementation with a
  `supersede` command, worth reading for the numbering and superseding conventions even if you
  never install it
- [The ADR GitHub organisation](https://adr.github.io/) — a catalogue of templates; compare the
  "MADR" variant's explicit "Decision Drivers" section against the one you just filled in
- [Martin Fowler: Sacrificial Architecture](https://martinfowler.com/bliki/SacrificialArchitecture.html)
  — the argument that some code is *supposed* to be thrown away, which is the frame for
  `faust-spike/` and for Key Concept 7
- [Martin Fowler: Technical Debt Quadrant](https://martinfowler.com/bliki/TechnicalDebtQuadrant.html)
  — the difference between deliberate and inadvertent debt; owning the preview code is the
  deliberate-and-prudent quadrant, and this ADR is what makes it deliberate
- [Faust.js: migrating away](https://faustjs.org/docs/next/migration) — read the migration guide of
  anything before you adopt it. What it does *not* cover is the useful signal
- [WP-CLI `plugin uninstall`](https://developer.wordpress.org/cli/commands/plugin/uninstall/) — the
  `--deactivate` flag and what "uninstall" runs that "deactivate" does not
- [`git rm` documentation](https://git-scm.com/docs/git-rm) — specifically why the index and the
  working tree are separate concerns, and why Step 6 needs both commands
- [Chesterton's Fence, applied to dependencies](https://fs.blog/chestertons-fence/) — the habit an
  ADR institutionalises: the next person finds the fence *and* the note explaining it
