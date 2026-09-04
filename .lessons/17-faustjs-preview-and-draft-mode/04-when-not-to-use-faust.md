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
choice and hand-rolling would be the expensive mistake. Then you delete the `/faust` spike — which
is why it never appears in the expected tree in `next-app/README.md` — and keep the 120 lines from
Lesson 17.2 that do ship.

By the end of this lesson you will have:

- An ADR with the standard sections — context, options considered, decision, consequences,
  reversal conditions — recording preview-only adoption
- A decision table with a verdict row and, next to it, a second table of the four situations that
  flip the verdict
- The stated cost of the decision: you own the preview code, the auth code and every route file,
  and no editor can change a template without a developer
- The `/faust` route group, its config and its `@faustwp/*` dependencies removed, with a clean
  `npm test` and `npx playwright test` afterwards
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
