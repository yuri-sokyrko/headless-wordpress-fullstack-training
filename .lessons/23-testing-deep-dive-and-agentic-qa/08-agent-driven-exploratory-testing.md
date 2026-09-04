---
title: 'Agent-Driven Exploratory Testing'
module: 23
lesson: 8
teaches: [exploratory-testing, test-charters, agent-traces, finding-triage, agentic-qa]
produces: ['docs/agentic-qa.md']
requires: [23.7]
---

# Lesson 23.8 — Agent-Driven Exploratory Testing

## Quick Overview

Exploratory testing is the discipline of looking for bugs you did not think to look for. It is
driven by a **charter** — a goal and a boundary, not a script — because a script can only find
the failures its author already imagined. A charter reads like this:

> *You are a QA engineer. Explore incident submission. Try to get an incident published without
> moderator approval. Report anything surprising.*

That is the whole instruction. The agent decides what to click, notices what happened, forms a
hypothesis and tries the next thing. Where an agent beats a script is breadth and patience: it
will try the flow with the field left empty, with the session expired, with the moderation kill
switch off, in German, with the query string still attached — combinations a human tester would
get to eventually and a `spec.ts` file will never get to at all, because somebody had to write
each one.

Expect real findings, because there are real bugs in this application by construction. A pending
incident leaking into the scapegoat term count, because
`wp_term_taxonomy.count` includes statuses you did not intend. The Get Demo dialog not trapping
focus after a styling change, which Lesson 22.2 fixed and a later refactor can silently undo. The
locale switcher dropping `?scapegoat=` so a filtered German list resets. None of those are exotic;
all three are the kind of thing that ships. The job in this lesson is to run the exploration
under the guardrails from Lesson 23.7, read the traces, and **triage** — because an agent report
is raw material, not a bug list. Some findings are real bugs, some are misread intent, some are
duplicates of the same underlying cause, and separating them is human work.

By the end of this lesson you will have:

- Four to six written charters covering submission, moderation, auth, i18n and the HOBT funnel,
  each with an explicit boundary
- A completed exploration run against the local seeded stack, with traces in `.agent-artifacts/`
- `docs/agentic-qa.md` — the charters, the raw findings, and the triage decision for each
- At least three triaged findings with a reproduction, a severity and a verdict: real bug,
  misread intent, or duplicate
- A Playwright trace opened and read for one finding, so you have confirmed the behaviour yourself
  rather than trusting a summary
- A written note on what the agent did *not* find, and why that is the more interesting half of
  the report

## Classic WP Analogy

**Nothing in Classic WordPress practice maps onto this, and the honest version of the analogy is
to say so and then look at what the absence tells you.** The closest thing you have done is
"click around staging before launch and see if anything looks wrong" — which is genuinely
exploratory testing, performed by a human, undocumented, unrepeatable, and skipped whenever the
release was late.

Two things transfer, though, and both are worth naming.

**The mindset is not new, only the operator.** Exploratory testing predates AI by decades and the
skill it requires is entirely human: forming a hypothesis about how something might break, and
then trying it. "What if I submit this as a contributor?" "What if the post is scheduled instead
of published?" "What if the slug has a Cyrillic character?" You have had those thoughts about
WordPress sites for years. The agent does not have better instincts than you — it has more
patience, no fear of repetition, and no ego about being wrong forty times.

**Writing the charter is the skill worth practising.** A charter that is too narrow ("click the
submit button and check for an error") is a script wearing a charter's clothes, and produces
nothing you did not already know. A charter that is too broad ("test the site") produces a
wandering report full of screenshots and no findings. The sweet spot — one flow, one adversarial
goal, one instruction to report surprises — is a real craft, and it is the same craft as writing
a good bug report or a good acceptance criterion.

Where the analogy breaks hardest is **trust**. A human tester who says "I could publish without
approval" is reporting an observation. An agent that says the same thing is producing text that
is *consistent with* an observation, and it may have misread a page, conflated a pending incident
with a published one, or been looking at a stale cache. So every finding gets reproduced by hand
before it becomes a bug — the trace exists precisely so you can check. That verification step has
no Classic counterpart because you never had to ask whether your tester's report was a
hallucination, and building it into the workflow from the first run is what keeps agentic QA
useful rather than noisy.

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
